create or replace function mfc.qa_call(p_label text,p_action jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare s mfc.qa_sessions; response extensions.http_response; attempt int;
begin select * into s from mfc.qa_sessions where label=p_label;
perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS','60000');
for attempt in 1..2 loop
 response=extensions.http(row('POST','https://ykvmtxsvpkoouotgwzex.supabase.co/functions/v1/mfc-game',array[extensions.http_header('apikey','eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlrdm10eHN2cGtvb3VvdGd3emV4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkxMDYwNDksImV4cCI6MjEwNDY4MjA0OX0.g8JZqrfBi5aJfwMRMKBT5U5px9R1yTV1azeMuASMTKc'),extensions.http_header('Authorization','Bearer '||s.token)],'application/json',p_action::text)::extensions.http_request);
 if response.status<>401 or attempt=2 then return jsonb_build_object('status',response.status,'body',response.content::jsonb);end if;
 response=extensions.http(row('POST','https://ykvmtxsvpkoouotgwzex.supabase.co/auth/v1/token?grant_type=password',array[extensions.http_header('apikey','eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlrdm10eHN2cGtvb3VvdGd3emV4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkxMDYwNDksImV4cCI6MjEwNDY4MjA0OX0.g8JZqrfBi5aJfwMRMKBT5U5px9R1yTV1azeMuASMTKc')],'application/json',jsonb_build_object('email',s.email,'password',s.password)::text)::extensions.http_request);
 if response.status<>200 then raise exception 'QA session refresh failed';end if;
 s.token=response.content::jsonb->>'access_token';update mfc.qa_sessions set token=s.token where label=p_label;
end loop;return null;end $$;
revoke all on function mfc.qa_call(text,jsonb) from public,anon,authenticated,service_role;;

