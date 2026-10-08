-- Repair derived club/career aggregates from stored, finished matches.
-- Replay metadata, hashes, chunks, events and original match stats stay immutable.
-- The revision guard makes rerunning this repair a no-op for migrated rooms.
create temporary table mfc_legacy_decisive on commit drop as
with winners as (
  select m.id,m.room_id,m.season,m.replay->'result' as score,
    case when (m.replay->'result'->>0)::int > (m.replay->'result'->>1)::int then 'home' else 'away' end as side,
    least((m.replay->'result'->>0)::int,(m.replay->'result'->>1)::int) as losing_goals,
    summary.value as summary,e.data as events
  from mfc.matches m
  join mfc.game_rooms g on g.id=m.room_id
  join mfc.match_events e on e.room_id=m.room_id and e.id=m.id
  cross join lateral jsonb_array_elements(g.state_data->'matches') summary
  where summary.value->>'id'=m.id and summary.value->>'state'='FINISHED'
    and m.result_locked and (m.replay->'result'->>0)::int <> (m.replay->'result'->>1)::int
)
select id,room_id,season,summary->>side as club_id,
  ((select jsonb_agg(event.value order by event.ordinality)
    from jsonb_array_elements(events) with ordinality event(value,ordinality)
    where event.value->>'type'='GOAL' and event.value->>'side'=winners.side
   )->losing_goals)->>'player' as player_id
from winners;

do $$
declare
  g record;r jsonb;c jsonb;p jsonb;rec record;st jsonb;new_records jsonb;new_clubs jsonb;
  new_players jsonb;new_alumni jsonb;new_market jsonb;new_youth jsonb;mode text;source jsonb;
  appearances integer;seasons integer;last_season integer;injuries integer;decisive integer;
  trophies integer;career_decisive integer;season_decisive integer;first_seen integer;
  tenure jsonb;origin text;previous record;previous_player jsonb;
begin
  for g in select * from mfc.game_rooms where coalesce((state_data->>'legacy_records_version')::int,0)<1 for update loop
    r=g.state_data;new_clubs='[]';
    for c in select value from jsonb_array_elements(r->'clubs') loop
      new_records='{}';
      for rec in select key,value from jsonb_each(coalesce(c->'records','{}')) loop
        select count(distinct (m->>'season')::int),max((m->>'season')::int),
          coalesce(sum(case when (m->'stats'->rec.key->>'injured')::int>0 then 1 else 0 end),0)
        into seasons,last_season,injuries
        from jsonb_array_elements(r->'matches') m
        where m->>'state'='FINISHED' and coalesce((m->'stats'->rec.key->>'minutes')::int,0)>0
          and m->>(m->'stats'->rec.key->>'side')=c->>'id';
        select count(*) into decisive from mfc_legacy_decisive where room_id=g.id and club_id=c->>'id' and player_id=rec.key;
        select count(*) into trophies from jsonb_array_elements(r->'champions') champ
        where (champ->>'club'=c->>'id' or champ->>'club'='共同冠军') and exists(
          select 1 from jsonb_array_elements(r->'matches') m
          where m->>'state'='FINISHED' and m->>'season'=champ->>'season'
            and coalesce((m->'stats'->rec.key->>'minutes')::int,0)>0
            and m->>(m->'stats'->rec.key->>'side')=c->>'id');
        st=(rec.value->'stats')||jsonb_build_object('seasons',seasons,'injuries',injuries,'decisive_goals',decisive,'trophies',trophies);
        new_records=new_records||jsonb_build_object(rec.key,rec.value||jsonb_build_object('stats',st,'last_season',last_season));
      end loop;
      c=jsonb_set(c,'{records}',new_records);
      new_players='[]';new_alumni='[]';new_youth='[]';
      foreach mode in array array['players','alumni','youth'] loop
        source=coalesce(c->mode,'[]');
        for p in select value from jsonb_array_elements(source) loop
          appearances=coalesce((p->'career'->>'appearances')::int,0);
          select count(*),count(*) filter(where goal.season=(r->>'current_season')::int)
          into career_decisive,season_decisive
          from mfc_legacy_decisive goal
          join (select m->>'id' as match_id,row_number() over(order by (m->>'season')::int,(m->>'round')::int) as appearance
                from jsonb_array_elements(r->'matches') m
                where m->>'state'='FINISHED' and coalesce((m->'stats'->(p->>'id')->>'minutes')::int,0)>0) played on played.match_id=goal.id
          where goal.room_id=g.id and goal.player_id=p->>'id' and (mode<>'alumni' or played.appearance<=appearances);
          p=jsonb_set(p,'{career,decisive_goals}',to_jsonb(career_decisive));
          if mode='alumni' then
            select max((m->>'season')::int) into last_season from (
              select m,row_number() over(order by (m->>'season')::int,(m->>'round')::int) as appearance
              from jsonb_array_elements(r->'matches') m
              where m->>'state'='FINISHED' and coalesce((m->'stats'->(p->>'id')->>'minutes')::int,0)>0
            ) played where appearance<=appearances;
            select count(*) into season_decisive from mfc_legacy_decisive goal
              where goal.room_id=g.id and goal.player_id=p->>'id' and goal.season=last_season;
          end if;
          p=jsonb_set(p,'{seasonStats,decisive_goals}',to_jsonb(season_decisive));
          select pick->>'club' into origin from jsonb_array_elements(r->'draft'->'picks') pick where pick->'player'->>'id'=p->>'id' limit 1;
          if origin is not null then p=p||jsonb_build_object('founding_club_id',origin); end if;
          tenure=coalesce(p->'club_tenure','{}');
          if mode='players' and not (p ? 'club_tenure') then
            for previous in select other.value as club from jsonb_array_elements(r->'clubs') other where other.value->>'id'<>c->>'id' loop
              select value into previous_player from jsonb_array_elements(coalesce(previous.club->'alumni','[]')) past where past.value->>'id'=p->>'id' limit 1;
              if previous_player is not null then
                tenure=tenure||jsonb_build_object(previous.club->>'id',(previous_player->>'club_seasons')::int);
                select min(m.season) into first_seen from mfc.matches m
                  cross join lateral jsonb_array_elements(r->'matches') summary
                  where m.room_id=g.id and summary->>'id'=m.id and exists(
                    select 1 from jsonb_array_elements(m.replay->'lineups'->(case when summary->>'home'=c->>'id' then 'home' else 'away' end)) registered
                    where registered->>'id'=p->>'id');
                p=jsonb_set(p,'{club_seasons}',to_jsonb(case when first_seen is not null then (r->>'current_season')::int-first_seen+1 when r->>'state'='OFFSEASON' then 0 else 1 end));
              end if;
            end loop;
            if (p->>'id' like '%-youth-%' or p->>'id' like '%-free-%') and appearances>0 then
              select min((m->>'season')::int) into first_seen from jsonb_array_elements(r->'matches') m
                where m->>'state'='FINISHED' and coalesce((m->'stats'->(p->>'id')->>'minutes')::int,0)>0;
              p=jsonb_set(p,'{career,seasons}',to_jsonb((r->>'current_season')::int-first_seen+1));
              p=jsonb_set(p,'{club_seasons}',p->'career'->'seasons');
            end if;
          end if;
          if mode='youth' then
            p=jsonb_set(jsonb_set(p,'{club_seasons}','0'),'{career,seasons}','0');
          else tenure=tenure||jsonb_build_object(c->>'id',(p->>'club_seasons')::int);
          end if;
          p=p||jsonb_build_object('club_tenure',tenure);
          if mode='alumni' and new_records ? (p->>'id') then p=p||jsonb_build_object('club_stats',new_records->(p->>'id')->'stats'); end if;
          if mode='players' then new_players=new_players||jsonb_build_array(p);
          elsif mode='alumni' then new_alumni=new_alumni||jsonb_build_array(p);
          else new_youth=new_youth||jsonb_build_array(p);end if;
        end loop;
      end loop;
      c=c||jsonb_build_object('players',new_players,'alumni',new_alumni,'youth',new_youth);
      new_clubs=new_clubs||jsonb_build_array(c);
    end loop;
    r=jsonb_set(r,'{clubs}',new_clubs);
    new_market='[]';
    for p in select value from jsonb_array_elements(r->'market') loop
      if coalesce((p->'career'->>'appearances')::int,0)=0 and not(p ? 'club_tenure') then
        p=jsonb_set(jsonb_set(p,'{club_seasons}','0'),'{career,seasons}','0');
      end if;
      new_market=new_market||jsonb_build_array(p);
    end loop;
    r=jsonb_set(r,'{market}',new_market)||jsonb_build_object('legacy_records_version',1,'revision',g.revision+1);
    update mfc.game_rooms set state_data=r,revision=g.revision+1,updated_at=now() where id=g.id;
    perform mfc.project_room(r);
  end loop;
end $$;
