create or replace function public.mfc_rpc(p_action text,p_user uuid,p_data jsonb default '{}') returns jsonb language plpgsql security invoker set search_path='' as $$
declare g mfc.game_rooms;m mfc.matches;r jsonb;rid uuid;mid text;token uuid;idx int;summary jsonb;chunk jsonb;frames jsonb;events jsonb;cursor_sec double precision;elapsed double precision;old_sec double precision;v mfc.user_match_view_progress;req text;
begin
 if current_user not in ('service_role','postgres') then raise exception 'server only';end if;
 if p_user is null then raise exception 'invalid user';end if;
 if p_action='profile' then
  insert into mfc.profiles(id,username) values(p_user,left(coalesce(nullif(p_data->>'username',''),'教练'||left(p_user::text,6)),20)) on conflict(id) do nothing;
  return (select to_jsonb(p) from mfc.profiles p where id=p_user);
 elsif p_action='list' then
  return coalesce((select jsonb_agg(jsonb_build_object('id',id,'join_code',join_code,'state',state_data->'state','season',state_data->'current_season','clubs',(select jsonb_agg(c->'name') from jsonb_array_elements(state_data->'clubs')c))) from mfc.game_rooms where host_user_id=p_user or guest_user_id=p_user),'[]');
 end if;
 if p_action='create' then r=p_data->'room';rid=(r->>'id')::uuid;if(r->>'host_user_id')::uuid<>p_user then raise exception 'owner mismatch';end if;
  insert into mfc.game_rooms(id,join_code,host_user_id,revision,state_data) values(rid,r->>'join_code',p_user,0,r);perform mfc.project_room(r);return r;
 end if;
 if p_data ? 'room_id' then rid=(p_data->>'room_id')::uuid;elsif p_data ? 'code' then select id into rid from mfc.game_rooms where join_code=upper(p_data->>'code');elsif p_data ? 'match_id' then select room_id into rid from mfc.matches where id=p_data->>'match_id';end if;
 select * into g from mfc.game_rooms where id=rid for update;
 if not found then raise exception 'room not found';end if;
 if p_user<>g.host_user_id and p_user is distinct from g.guest_user_id and not(p_action in ('join_load','commit') and g.guest_user_id is null and (p_data->>'join'='true' or p_action='join_load')) then raise exception 'room membership required';end if;
 if p_action in ('load','join_load') then return g.state_data;end if;
 if p_action='commit' then
  req=p_data->>'request_id';if req is null or length(req)>100 then raise exception 'invalid request id';end if;
  if exists(select 1 from mfc.action_receipts where room_id=rid and user_id=p_user and request_id=req) then return g.state_data;end if;
  if g.revision<>(p_data->>'revision')::int then return jsonb_build_object('conflict',true);end if;
  r=p_data->'room';if(r->>'id')::uuid<>rid or(r->>'host_user_id')::uuid<>g.host_user_id or(r->>'revision')::int<>g.revision+1 then raise exception 'invalid revision';end if;
  update mfc.game_rooms set state_data=r,revision=revision+1,guest_user_id=nullif(r->>'guest_user_id','')::uuid,updated_at=now() where id=rid;
  insert into mfc.action_receipts values(rid,p_user,req,now());perform mfc.project_room(r);
  for summary in select value from jsonb_array_elements(r->'matches') loop
   insert into mfc.matches(id,room_id,season,round,match_seed) values(summary->>'id',rid,(summary->>'season')::int,(summary->>'round')::int,0) on conflict(id) do nothing;
   if summary->>'state'='FINISHED' then update mfc.matches set state='FINISHED' where id=summary->>'id';end if;
  end loop;
  return r;
 end if;
 mid=p_data->>'match_id';select * into m from mfc.matches where id=mid and room_id=rid for update;if not found then raise exception 'match not found';end if;
 if p_action='claim' then
  if m.result_locked then return jsonb_build_object('done',true);end if;
  if m.lease_until>now() then return jsonb_build_object('busy',true);end if;
  if g.state_data->>'active_match'<>mid or exists(select 1 from jsonb_array_elements(g.state_data->'clubs')c where not(c->>'ready')::boolean) then raise exception 'not ready';end if;
  token=gen_random_uuid();update mfc.matches set lease_token=token,lease_until=now()+interval '90 seconds',match_seed=(p_data->>'seed')::bigint where id=mid;return jsonb_build_object('token',token,'room',g.state_data);
 elsif p_action='release_claim' then
  if not m.result_locked and m.lease_token=(p_data->>'token')::uuid then update mfc.matches set lease_until=null,lease_token=null where id=mid;end if;return jsonb_build_object('done',true);
 elsif p_action='complete' then
  if m.result_locked then return jsonb_build_object('done',true);end if;
  if m.lease_token is distinct from (p_data->>'token')::uuid then raise exception 'stale generation lease';end if;
  r=p_data->'replay';if r->>'match_id'<>mid or(r->>'seed')::bigint<>m.match_seed then raise exception 'replay identity mismatch';end if;
  update mfc.matches set replay=r,state='GENERATED',result_locked=true,engine_version=r->>'engine_version',replay_hash=r->>'replay_hash',lease_until=null where id=mid;
  insert into mfc.match_replay_chunks(match_id,chunk_index,frames,events)
  with frame_groups as (select floor((f->>'t')::float8/60)::int as n,jsonb_agg(f order by (f->>'t')::float8) as items from jsonb_array_elements(r->'frames') f group by 1),
  event_groups as (select floor((e->>'time')::float8/60)::int as n,jsonb_agg(e order by (e->>'time')::float8) as items from jsonb_array_elements(r->'events') e group by 1)
  select mid,coalesce(f.n,e.n),coalesce(f.items,'[]'::jsonb),coalesce(e.items,'[]'::jsonb) from frame_groups f full join event_groups e using(n);
  insert into mfc.match_lineups values(mid,rid,null,r->'lineups');insert into mfc.match_tactics values(mid,rid,null,r->'tactics');insert into mfc.match_events values(mid,rid,null,r->'events');insert into mfc.match_player_stats values(mid,rid,null,r->'stats');
  summary=jsonb_build_object('state','GENERATED','score',r->'result','duration',r->'duration','stats',r->'stats','replay_hash',r->'replay_hash','engine_version',r->'engine_version','result_locked',true);
  select ordinality::int-1 into idx from jsonb_array_elements(g.state_data->'matches') with ordinality where value->>'id'=mid;
  chunk=g.state_data->'matches'->idx;g.state_data=jsonb_set(g.state_data,array['matches',idx::text],chunk||summary);g.state_data=jsonb_set(g.state_data,'{revision}',to_jsonb(g.revision+1));
  update mfc.game_rooms set state_data=g.state_data,revision=revision+1,updated_at=now() where id=rid;
  update public.mfc_room_signal set revision=g.revision+1,updated_at=now() where room_id=rid;return jsonb_build_object('done',true);
 elsif p_action in ('replay','progress') then
  if not m.result_locked then return jsonb_build_object('generating',true);end if;
  insert into mfc.user_match_view_progress(match_id,user_id) values(mid,p_user) on conflict do nothing;
  select * into v from mfc.user_match_view_progress where match_id=mid and user_id=p_user for update;
  old_sec=v.last_viewed_second;elapsed=extract(epoch from now()-v.updated_at);
  cursor_sec=coalesce((p_data->>'second')::float8,old_sec);
  if p_action='progress' then
   if cursor_sec<old_sec then cursor_sec=old_sec;end if;
   if cursor_sec>(m.replay->>'duration')::float8 or cursor_sec-old_sec>least(elapsed,15)*72+3 then raise exception 'playback advance too fast';end if;
   update mfc.user_match_view_progress set last_viewed_second=cursor_sec,updated_at=now() where match_id=mid and user_id=p_user;
   g.state_data=jsonb_set(g.state_data,array['view',mid,p_user::text],to_jsonb(cursor_sec),true);
   g.state_data=jsonb_set(g.state_data,'{revision}',to_jsonb(g.revision+1));
   update mfc.game_rooms set state_data=g.state_data,revision=revision+1,updated_at=now() where id=rid;
  end if;
  idx=coalesce((p_data->>'chunk')::int,0);
  if idx<0 or idx*60>old_sec+150 and old_sec<(m.replay->>'duration')::float8 then raise exception 'future replay unavailable';end if;
  return jsonb_build_object('match_id',mid,'duration',m.replay->'duration','lineups',m.replay->'lineups','tactics',m.replay->'tactics','replay_hash',m.replay_hash,'engine_version',m.engine_version,'last_viewed_second',cursor_sec,'frames',coalesce((select c.frames from mfc.match_replay_chunks c where c.match_id=mid and c.chunk_index=idx),'[]'),'events',coalesce((select c.events from mfc.match_replay_chunks c where c.match_id=mid and c.chunk_index=idx),'[]'),'result',case when cursor_sec>=(m.replay->>'duration')::float8 then m.replay->'result' else null end,'stats',case when cursor_sec>=(m.replay->>'duration')::float8 then m.replay->'stats' else null end,'team_stats',case when cursor_sec>=(m.replay->>'duration')::float8 then m.replay->'team_stats' else null end);
 end if;
 raise exception 'unsupported operation';
end $$;
revoke all on function public.mfc_rpc(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.mfc_rpc(text,uuid,jsonb) to service_role;
;

