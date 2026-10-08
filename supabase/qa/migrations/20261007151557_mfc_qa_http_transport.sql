create extension if not exists http with schema extensions;
create table mfc.qa_sessions(label text primary key,user_id uuid not null,email text not null,password text not null,token text);
alter table mfc.qa_sessions enable row level security;
revoke all on mfc.qa_sessions from public,anon,authenticated,service_role;
create function mfc.qa_call(p_label text,p_action jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare s mfc.qa_sessions; response extensions.http_response;begin
select * into s from mfc.qa_sessions where label=p_label;
perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS','60000');
response=extensions.http(row('POST','https://ykvmtxsvpkoouotgwzex.supabase.co/functions/v1/mfc-game',array[extensions.http_header('apikey','eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlrdm10eHN2cGtvb3VvdGd3emV4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkxMDYwNDksImV4cCI6MjEwNDY4MjA0OX0.g8JZqrfBi5aJfwMRMKBT5U5px9R1yTV1azeMuASMTKc'),extensions.http_header('Authorization','Bearer '||s.token)],'application/json',p_action::text)::extensions.http_request);
return jsonb_build_object('status',response.status,'body',response.content::jsonb);
end $$;
revoke all on function mfc.qa_call(text,jsonb) from public,anon,authenticated,service_role;;

