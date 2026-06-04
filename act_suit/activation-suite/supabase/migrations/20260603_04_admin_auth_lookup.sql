-- Look up an auth.users id by email so the admin API can set a user's password
-- via the GoTrue admin API (which needs the user id). service_role only.
create or replace function public.admin_get_auth_user_id(p_email text)
returns uuid
language sql
security definer
set search_path = public, auth
as $$
  select id from auth.users where lower(email) = lower(trim(p_email)) limit 1;
$$;

revoke all on function public.admin_get_auth_user_id(text) from public, anon, authenticated;
grant execute on function public.admin_get_auth_user_id(text) to service_role;
