create or replace function mfc.project_room(r jsonb) returns void language plpgsql security invoker set search_path='' as $$
declare rid uuid=(r->>'id')::uuid;c jsonb;p jsonb;u uuid;n text;obj jsonb;i integer;t jsonb;
begin
 delete from mfc.room_members where room_id=rid;
 for c in select value from jsonb_array_elements(r->'clubs') loop
  u=(c->>'user_id')::uuid;insert into mfc.room_members values(rid,u);
  insert into mfc.clubs values(c->>'id',rid,u,c-'players'-'youth') on conflict(room_id,id) do update set data=excluded.data;
  insert into mfc.lineups values(c->>'id',rid,u,c->'lineup') on conflict(room_id,id) do update set data=excluded.data;
  insert into mfc.tactics values(c->>'id',rid,u,c->'tactic') on conflict(room_id,id) do update set data=excluded.data;
  i=0;for obj in select value from jsonb_array_elements(c->'lineup') loop insert into mfc.lineup_slots values((c->>'id')||':'||i,rid,u,jsonb_build_object('player_id',obj,'slot',i)) on conflict(room_id,id) do update set data=excluded.data;i=i+1;end loop;
  for p in select value from jsonb_array_elements(c->'players') loop
   insert into mfc.players values(p->>'id',rid,u,p-'h') on conflict(room_id,id) do update set data=excluded.data,owner_user_id=excluded.owner_user_id;
   insert into mfc.player_attributes values(p->>'id',rid,u,p->'attrs') on conflict(room_id,id) do update set data=excluded.data,owner_user_id=excluded.owner_user_id;
   insert into mfc.player_hidden values(p->>'id',rid,u,p->'h') on conflict(room_id,id) do update set data=excluded.data,owner_user_id=excluded.owner_user_id;
   insert into mfc.player_positions values(p->>'id',rid,u,jsonb_build_object('main',p->'position','adapted',p->'adapted')) on conflict(room_id,id) do update set data=excluded.data;
   insert into mfc.player_traits values(p->>'id',rid,u,p->'traits') on conflict(room_id,id) do update set data=excluded.data;
   insert into mfc.trait_progress values(p->>'id',rid,u,p->'h'->'progress') on conflict(room_id,id) do update set data=excluded.data;
   insert into mfc.training_plans values(p->>'id',rid,u,p->'training') on conflict(room_id,id) do update set data=excluded.data;
   insert into mfc.player_season_stats values((p->>'id')||':s'||(r->>'current_season'),rid,u,p->'seasonStats') on conflict(room_id,id) do update set data=excluded.data;
   insert into mfc.player_history values(p->>'id',rid,u,jsonb_build_object('career',p->'career','logs',p->'logs')) on conflict(room_id,id) do update set data=excluded.data;
  end loop;
  for p in select value from jsonb_array_elements(c->'youth') loop insert into mfc.youth_candidates values(p->>'id',rid,u,p-'h') on conflict(room_id,id) do update set data=excluded.data;end loop;
  insert into mfc.club_history values(c->>'id',rid,u,c->'history') on conflict(room_id,id) do update set data=excluded.data;
 end loop;
 insert into mfc.drafts values(rid::text,rid,null,(r->'draft')-'candidates'-'picks') on conflict(room_id,id) do update set data=excluded.data;
 for p in select value from jsonb_array_elements(r->'draft'->'candidates') loop insert into mfc.draft_candidates values(p->>'id',rid,null,p-'h') on conflict(room_id,id) do update set data=excluded.data;end loop;
 i=0;for p in select value from jsonb_array_elements(r->'draft'->'picks') loop insert into mfc.draft_picks values(rid||':'||i,rid,null,p) on conflict(room_id,id) do nothing;i=i+1;end loop;
 for t in select value from jsonb_array_elements(r->'transfers') loop insert into mfc.transfer_offers values(t->>'id',rid,null,t) on conflict(room_id,id) do update set data=excluded.data;end loop;
 for p in select value from jsonb_array_elements(r->'market') loop insert into mfc.transfer_listings values(p->>'id',rid,null,p-'h') on conflict(room_id,id) do update set data=excluded.data;end loop;
 insert into mfc.seasons values(rid||':s'||(r->>'current_season'),rid,null,jsonb_build_object('season',r->'current_season','champions',r->'champions','clubs',r->'clubs')) on conflict(room_id,id) do update set data=excluded.data;
 insert into mfc.season_rounds values(rid||':s'||(r->>'current_season')||':r'||(r->>'current_round'),rid,null,jsonb_build_object('round',r->'current_round','active_match',r->'active_match')) on conflict(room_id,id) do update set data=excluded.data;
 insert into public.mfc_room_signal values(rid,(r->>'revision')::int,now()) on conflict(room_id) do update set revision=excluded.revision,updated_at=excluded.updated_at;
end $$;
revoke all on function mfc.project_room(jsonb) from public,anon,authenticated;
grant execute on function mfc.project_room(jsonb) to service_role;


;

