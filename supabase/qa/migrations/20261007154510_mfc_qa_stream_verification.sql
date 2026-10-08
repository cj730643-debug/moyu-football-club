create table mfc.qa_chunks(match_id text not null,chunk_index int not null,frame_count int not null,event_count int not null,goals_home int not null,goals_away int not null,last_second float8,hash text,primary key(match_id,chunk_index));
alter table mfc.qa_chunks enable row level security;revoke all on mfc.qa_chunks from public,anon,authenticated,service_role;
create function mfc.qa_watch_batch(p_match text,p_start int,p_count int) returns jsonb language plpgsql security invoker set search_path='' as $$
declare idx int;a jsonb;b jsonb;aa jsonb;bb jsonb;dur float8;ts timestamptz;sec float8;fin jsonb;
begin
 if p_count<1 or p_count>12 then raise exception 'invalid qa batch';end if;
 select (replay->>'duration')::float8 into dur from mfc.matches where id=p_match and result_locked;
 for idx in p_start..least(p_start+p_count-1,floor(dur/60)::int) loop
  ts=clock_timestamp();sec=least(idx*60,dur);
  a=mfc.qa_call('A',jsonb_build_object('type',case when idx=0 then 'replay' else 'progress' end,'match_id',p_match,'chunk',idx,'second',sec));
  b=mfc.qa_call('B',jsonb_build_object('type',case when idx=0 then 'replay' else 'progress' end,'match_id',p_match,'chunk',idx,'second',sec));
  if a->>'status'<>'200' or b->>'status'<>'200' then raise exception 'QA HTTP failed: A %, B %',a,b;end if;
  aa=a->'body';bb=b->'body';
  if aa->'frames'<>bb->'frames' or aa->'events'<>bb->'events' or aa->>'replay_hash'<>bb->>'replay_hash' then raise exception 'Replay mismatch at chunk %',idx;end if;
  if sec<dur and (aa->'result'<>'null'::jsonb or bb->'result'<>'null'::jsonb) then raise exception 'Early result leak';end if;
  if exists(select 1 from jsonb_array_elements(aa->'frames')f where (f->'ball'->>0)::float8 not between 0 and 100 or (f->'ball'->>1)::float8 not between 0 and 100) or exists(select 1 from jsonb_array_elements(aa->'frames')f cross join lateral jsonb_array_elements(f->'p')p where (p->>1)::float8 not between 0 and 100 or (p->>2)::float8 not between 0 and 100) then raise exception 'Illegal coordinates';end if;
  insert into mfc.qa_chunks values(p_match,idx,jsonb_array_length(aa->'frames'),jsonb_array_length(aa->'events'),(select count(*) from jsonb_array_elements(aa->'events')e where e->>'type'='GOAL' and e->>'side'='home'),(select count(*) from jsonb_array_elements(aa->'events')e where e->>'type'='GOAL' and e->>'side'='away'),(select max((f->>'t')::float8) from jsonb_array_elements(aa->'frames')f),aa->>'replay_hash') on conflict(match_id,chunk_index) do nothing;
  if sec=dur then fin=aa;end if;
  perform pg_sleep(greatest(0,1.05-extract(epoch from clock_timestamp()-ts)));
 end loop;
 if p_start+p_count-1>=floor(dur/60) and fin is null then
  a=mfc.qa_call('A',jsonb_build_object('type','progress','match_id',p_match,'chunk',floor(dur/60)::int,'second',dur));
  b=mfc.qa_call('B',jsonb_build_object('type','progress','match_id',p_match,'chunk',floor(dur/60)::int,'second',dur));
  if a->>'status'<>'200' or b->>'status'<>'200' or a->'body'->'result'<>b->'body'->'result' or a->'body'->'stats'<>b->'body'->'stats' then raise exception 'Full time mismatch';end if;fin=a->'body';
 end if;
 if fin is not null then
  if fin->'result'<>jsonb_build_array((select sum(goals_home) from mfc.qa_chunks where match_id=p_match),(select sum(goals_away) from mfc.qa_chunks where match_id=p_match)) then raise exception 'Goal log score mismatch';end if;
 end if;
 return jsonb_build_object('match_id',p_match,'next_chunk',least(p_start+p_count,floor(dur/60)::int+1),'duration',dur,'done',fin is not null,'frames_compared',(select sum(frame_count) from mfc.qa_chunks where match_id=p_match),'events_compared',(select sum(event_count) from mfc.qa_chunks where match_id=p_match),'result',fin->'result','hash',fin->>'replay_hash');
end $$;
revoke all on function mfc.qa_watch_batch(text,int,int) from public,anon,authenticated,service_role;;

