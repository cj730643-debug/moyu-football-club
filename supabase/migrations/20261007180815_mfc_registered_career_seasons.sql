-- Earlier deployed players did not count the founding season in career.seasons.
-- Count registered seasons from immutable match statistics, including healthy substitutes.
do $$
declare g record;r jsonb;c jsonb;p jsonb;clubs jsonb;players jsonb;alumni jsonb;years int;has_current boolean;last_played int;
begin
 for g in select * from mfc.game_rooms where coalesce((state_data->>'career_seasons_version')::int,0)<1 for update loop
  r=g.state_data;clubs='[]';
  for c in select value from jsonb_array_elements(r->'clubs') loop
   players='[]';alumni='[]';
   for p in select value from jsonb_array_elements(c->'players') loop
    select count(distinct m.season),coalesce(bool_or(m.season=(r->>'current_season')::int),false) into years,has_current
     from mfc.matches m where m.room_id=g.id and m.result_locked and (m.replay->'stats') ? (p->>'id');
    if years>0 then
     if r->>'state'='SEASON' and not has_current then years=years+1;end if;
     p=jsonb_set(p,'{career,seasons}',to_jsonb(years));
    end if;
    players=players||jsonb_build_array(p);
   end loop;
   for p in select value from jsonb_array_elements(coalesce(c->'alumni','[]')) loop
    select max((played.m->>'season')::int) into last_played from (
     select m,row_number() over(order by (m->>'season')::int,(m->>'round')::int) as appearance
     from jsonb_array_elements(r->'matches') m
     where m->>'state'='FINISHED' and coalesce((m->'stats'->(p->>'id')->>'minutes')::int,0)>0
    ) played where appearance<=coalesce((p->'career'->>'appearances')::int,0);
    select count(distinct m.season) into years from mfc.matches m
     where m.room_id=g.id and m.result_locked and m.season<=last_played and (m.replay->'stats') ? (p->>'id');
    years=greatest(years,coalesce((p->'career'->>'seasons')::int,0),coalesce((p->>'club_seasons')::int,0));
    p=jsonb_set(p,'{career,seasons}',to_jsonb(years));
    alumni=alumni||jsonb_build_array(p);
   end loop;
   c=c||jsonb_build_object('players',players,'alumni',alumni);clubs=clubs||jsonb_build_array(c);
  end loop;
  r=jsonb_set(r,'{clubs}',clubs)||jsonb_build_object('career_seasons_version',1,'revision',g.revision+1);
  update mfc.game_rooms set state_data=r,revision=g.revision+1,updated_at=now() where id=g.id;
  perform mfc.project_room(r);
 end loop;
end $$;
