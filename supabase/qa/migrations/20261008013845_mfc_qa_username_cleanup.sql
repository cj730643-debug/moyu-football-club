do $$
declare s mfc.qa_username_sessions; r extensions.http_response;
begin
 for s in select * from mfc.qa_username_sessions loop
  r=extensions.http(row('POST','https://ykvmtxsvpkoouotgwzex.supabase.co/auth/v1/logout',
  array[extensions.http_header('apikey','eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlrdm10eHN2cGtvb3VvdGd3emV4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkxMDYwNDksImV4cCI6MjEwNDY4MjA0OX0.g8JZqrfBi5aJfwMRMKBT5U5px9R1yTV1azeMuASMTKc'),extensions.http_header('Authorization','Bearer '||(s.session->>'access_token'))],
  'application/json','{}')::extensions.http_request);
  if r.status<>204 then raise exception 'QA logout failed';end if;
 end loop;
end $$;
drop function mfc.qa_username_call(text,jsonb,boolean,text);
drop table mfc.qa_username_sessions;
drop table mfc.qa_username_results;
delete from mfc.account_rate_limits where scope in ('ip:login:qa-rate-ip','name:qa-rate-name');
