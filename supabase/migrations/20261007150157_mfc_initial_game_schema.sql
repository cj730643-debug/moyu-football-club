-- Isolated game schema. Existing applications and Auth settings are preserved.
create schema if not exists mfc;
create table mfc.profiles (id uuid primary key references auth.users(id) on delete cascade, username text not null, avatar_seed bigint not null default 1, created_at timestamptz not null default now());
create unique index mfc_username_unique on mfc.profiles(lower(username));
create table mfc.game_rooms (id uuid primary key, join_code text not null unique check(join_code ~ '^[A-Z0-9]{6}$'), host_user_id uuid not null references auth.users(id), guest_user_id uuid references auth.users(id), revision integer not null default 0, state_data jsonb not null, updated_at timestamptz not null default now(), created_at timestamptz not null default now(), check(guest_user_id is null or guest_user_id <> host_user_id));
create index mfc_rooms_host on mfc.game_rooms(host_user_id);
create index mfc_rooms_guest on mfc.game_rooms(guest_user_id);
create table mfc.room_members (room_id uuid not null references mfc.game_rooms(id) on delete cascade, user_id uuid not null references auth.users(id), primary key(room_id,user_id));
create table mfc.action_receipts(room_id uuid not null references mfc.game_rooms(id) on delete cascade, user_id uuid not null, request_id text not null, created_at timestamptz default now(),primary key(room_id,user_id,request_id));
create table mfc.matches(id text primary key,room_id uuid not null references mfc.game_rooms(id) on delete cascade,season integer not null,round integer not null,state text not null default 'GENERATING',lease_token uuid,lease_until timestamptz,match_seed bigint not null,engine_version text,result_locked boolean not null default false,replay_hash text,replay jsonb,created_at timestamptz not null default now(),unique(room_id,season,round));
create index mfc_matches_room on mfc.matches(room_id);
create table mfc.user_match_view_progress(match_id text not null references mfc.matches(id) on delete cascade,user_id uuid not null,last_viewed_second double precision not null default 0,updated_at timestamptz not null default now(),primary key(match_id,user_id));
create table mfc.match_replay_chunks(match_id text not null references mfc.matches(id) on delete cascade,chunk_index integer not null,frames jsonb not null,events jsonb not null,primary key(match_id,chunk_index));
-- Transactional projections support reporting without exposing the aggregate or hidden data.
do $$ declare n text; begin
 foreach n in array array['clubs','seasons','season_rounds','players','player_attributes','player_hidden','player_positions','player_traits','trait_progress','training_plans','lineups','lineup_slots','tactics','drafts','draft_candidates','draft_picks','match_lineups','match_tactics','match_events','match_player_stats','player_season_stats','youth_candidates','transfer_listings','transfer_offers','club_history','player_history'] loop
  execute format('create table mfc.%I (id text not null,room_id uuid not null references mfc.game_rooms(id) on delete cascade,owner_user_id uuid,data jsonb not null,primary key(room_id,id))',n);
 end loop;
end $$;
create table mfc.trait_definitions(id text primary key, data jsonb not null);
create table public.mfc_room_signal(room_id uuid primary key references mfc.game_rooms(id) on delete cascade,revision integer not null default 0,updated_at timestamptz not null default now());
alter table public.mfc_room_signal enable row level security;
create policy mfc_signal_member on public.mfc_room_signal for select to authenticated using (exists(select 1 from mfc.room_members rm where rm.room_id=mfc_room_signal.room_id and rm.user_id=(select auth.uid())));
grant select on public.mfc_room_signal to authenticated;
revoke all on public.mfc_room_signal from anon;
grant usage on schema mfc to service_role,authenticated;
grant all on all tables in schema mfc to service_role;
grant select on mfc.room_members to authenticated;
do $$ declare t record;begin for t in select tablename from pg_tables where schemaname='mfc' loop execute format('alter table mfc.%I enable row level security',t.tablename);execute format('revoke all on mfc.%I from anon,authenticated',t.tablename);end loop;end $$;
grant select on mfc.room_members to authenticated;
create policy mfc_own_membership on mfc.room_members for select to authenticated using (user_id=(select auth.uid()));
do $$ begin if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='mfc_room_signal') then alter publication supabase_realtime add table public.mfc_room_signal;end if;end $$;

create function mfc.project_room(r jsonb) returns void language plpgsql security invoker set search_path='' as $$
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
 insert into mfc.drafts values(rid::text,rid,null,r->'draft'-'candidates'-'picks') on conflict(room_id,id) do update set data=excluded.data;
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

create function public.mfc_rpc(p_action text,p_user uuid,p_data jsonb default '{}') returns jsonb language plpgsql security invoker set search_path='' as $$
declare g mfc.game_rooms;m mfc.matches;r jsonb;rid uuid;mid text;token uuid;idx int;summary jsonb;chunk jsonb;frames jsonb;events jsonb;cursor_sec double precision;elapsed double precision;old_sec double precision;v mfc.user_match_view_progress;req text;
begin
 if current_user not in ('service_role','postgres') then raise exception 'server only';end if;
 if p_user is null or not exists(select 1 from auth.users where id=p_user) then raise exception 'invalid user';end if;
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
 elsif p_action='complete' then
  if m.result_locked then return jsonb_build_object('done',true);end if;
  if m.lease_token is distinct from (p_data->>'token')::uuid then raise exception 'stale generation lease';end if;
  r=p_data->'replay';if r->>'match_id'<>mid or(r->>'seed')::bigint<>m.match_seed then raise exception 'replay identity mismatch';end if;
  update mfc.matches set replay=r,state='GENERATED',result_locked=true,engine_version=r->>'engine_version',replay_hash=r->>'replay_hash',lease_until=null where id=mid;
  for idx in 0..floor((r->>'duration')::numeric/60)::integer loop
   select coalesce(jsonb_agg(f),'[]') into frames from jsonb_array_elements(r->'frames')f where(f->>'t')::float8>=idx*60 and(f->>'t')::float8<idx*60+60;
   select coalesce(jsonb_agg(e),'[]') into events from jsonb_array_elements(r->'events')e where(e->>'time')::float8>=idx*60 and(e->>'time')::float8<idx*60+60;
   insert into mfc.match_replay_chunks values(mid,idx,frames,events);
  end loop;
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

