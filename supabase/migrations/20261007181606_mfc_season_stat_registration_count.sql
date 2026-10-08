-- Registered players have one current-season entry; unsigned youth/market players remain at zero.
do $$
declare g record;r jsonb;c jsonb;p jsonb;clubs jsonb;players jsonb;alumni jsonb;
begin
 for g in select * from mfc.game_rooms where coalesce((state_data->>'season_stats_version')::int,0)<1 for update loop
  r=g.state_data;clubs='[]';
  for c in select value from jsonb_array_elements(r->'clubs') loop
   players='[]';alumni='[]';
   for p in select value from jsonb_array_elements(c->'players') loop
    if coalesce((p->>'club_seasons')::int,0)>0 then p=jsonb_set(p,'{seasonStats,seasons}','1');end if;
    players=players||jsonb_build_array(p);
   end loop;
   for p in select value from jsonb_array_elements(coalesce(c->'alumni','[]')) loop
    if coalesce((p->'career'->>'seasons')::int,0)>0 then p=jsonb_set(p,'{seasonStats,seasons}','1');end if;
    alumni=alumni||jsonb_build_array(p);
   end loop;
   clubs=clubs||jsonb_build_array(c||jsonb_build_object('players',players,'alumni',alumni));
  end loop;
  r=jsonb_set(r,'{clubs}',clubs)||jsonb_build_object('season_stats_version',1,'revision',g.revision+1);
  update mfc.game_rooms set state_data=r,revision=g.revision+1,updated_at=now() where id=g.id;
  perform mfc.project_room(r);
 end loop;
end $$;
