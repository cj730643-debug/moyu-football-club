-- Football-only username accounts. Password hashing and sessions remain in Auth.
create table mfc.username_accounts (
  name_key text primary key check (char_length(name_key) between 2 and 20),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  email text not null unique,
  created_at timestamptz not null default now()
);
create table mfc.account_rate_limits (
  scope text primary key,
  started_at timestamptz not null default now(),
  hits integer not null default 1
);
alter table mfc.username_accounts enable row level security;
alter table mfc.account_rate_limits enable row level security;
revoke all on mfc.username_accounts, mfc.account_rate_limits from public, anon, authenticated;
grant all on mfc.username_accounts, mfc.account_rate_limits to service_role;

create or replace function public.mfc_account(p_action text, p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_hits integer; v_scope text; v_window interval; v_limit integer; v_allowed boolean := true; v_user uuid;
begin
  if p_action = 'rate' then
    -- Counters return a decision rather than raising: rejected attempts still commit.
    delete from mfc.account_rate_limits where started_at < now() - interval '2 hours';
    for v_scope, v_window, v_limit in
      select 'ip:' || case when (p_data->>'registering')::boolean then 'register:' else 'login:' end || (p_data->>'address'),
        case when (p_data->>'registering')::boolean then interval '1 hour' else interval '5 minutes' end,
        case when (p_data->>'registering')::boolean then 8 else 60 end
      union all
      select 'name:' || (p_data->>'name_key'), interval '5 minutes', 20
    loop
      insert into mfc.account_rate_limits as limits(scope) values(v_scope)
      on conflict(scope) do update set
        started_at = case when limits.started_at < now() - v_window then now() else limits.started_at end,
        hits = case when limits.started_at < now() - v_window then 1 else limits.hits + 1 end
      returning hits into v_hits;
      v_allowed := v_allowed and v_hits <= v_limit;
    end loop;
    return jsonb_build_object('allowed',v_allowed);
  elsif p_action = 'available' then
    return to_jsonb(not exists(select 1 from mfc.username_accounts where name_key=p_data->>'name_key')
      and not exists(select 1 from mfc.profiles where lower(username)=p_data->>'name_key'));
  elsif p_action = 'lookup' then
    return (select jsonb_build_object('user_id',user_id,'email',email) from mfc.username_accounts where name_key=p_data->>'name_key');
  elsif p_action = 'register' then
    v_user := (p_data->>'user_id')::uuid;
    if not exists(select 1 from auth.users where id=v_user and email=p_data->>'email'
      and email_confirmed_at is not null and raw_app_meta_data->>'mfc_username_account'='true') then
      raise exception '账号身份无效';
    end if;
    insert into mfc.profiles(id,username) values(v_user,p_data->>'username');
    insert into mfc.username_accounts(name_key,user_id,email) values(p_data->>'name_key',v_user,p_data->>'email');
    return jsonb_build_object('ok',true);
  end if;
  raise exception '账号操作无效';
end;
$$;
revoke all on function public.mfc_account(text,jsonb) from public, anon, authenticated;
grant execute on function public.mfc_account(text,jsonb) to service_role;

