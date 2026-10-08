create table mfc.qa_username_sessions(label text primary key, username text not null, password text not null, session jsonb);
alter table mfc.qa_username_sessions enable row level security;
revoke all on mfc.qa_username_sessions from public,anon,authenticated,service_role;
create table mfc.qa_username_results(name text primary key, evidence jsonb not null);
alter table mfc.qa_username_results enable row level security;
revoke all on mfc.qa_username_results from public,anon,authenticated,service_role;
create function mfc.qa_username_call(p_label text, p_action jsonb default '{}'::jsonb, p_public boolean default false, p_path text default 'edge')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s mfc.qa_username_sessions; r extensions.http_response; v_url text; v_auth text;
begin
 select * into s from mfc.qa_username_sessions where label=p_label;
 v_auth=case when p_public then 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlrdm10eHN2cGtvb3VvdGd3emV4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkxMDYwNDksImV4cCI6MjEwNDY4MjA0OX0.g8JZqrfBi5aJfwMRMKBT5U5px9R1yTV1azeMuASMTKc' else s.session->>'access_token' end;
 v_url=case p_path when 'edge' then '/functions/v1/mfc-game' when 'user' then '/auth/v1/user' when 'private_rpc' then '/rest/v1/rpc/mfc_account' else null end;
 if v_url is null then raise exception 'invalid QA endpoint';end if;
 perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS','60000');
 r=extensions.http(row(case when p_path='user' then 'GET' else 'POST' end,'https://ykvmtxsvpkoouotgwzex.supabase.co'||v_url,
 array[extensions.http_header('apikey','eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlrdm10eHN2cGtvb3VvdGd3emV4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkxMDYwNDksImV4cCI6MjEwNDY4MjA0OX0.g8JZqrfBi5aJfwMRMKBT5U5px9R1yTV1azeMuASMTKc'),extensions.http_header('Authorization','Bearer '||v_auth)],
 'application/json',case when p_path='user' then null else p_action::text end)::extensions.http_request);
 return jsonb_build_object('status',r.status,'body',r.content::jsonb);
end $$;
revoke all on function mfc.qa_username_call(text,jsonb,boolean,text) from public,anon,authenticated,service_role;
