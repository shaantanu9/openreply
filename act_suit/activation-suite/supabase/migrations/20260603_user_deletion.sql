-- User deletion for the admin console: soft delete (recoverable) + hard delete
-- (permanent, frees the email for reuse). A "user" spans email-keyed activation
-- tables and the auth.users → profiles → community graph, so we do everything
-- in one transactional SECURITY DEFINER function per action.

-- 1) Soft-delete marker on licenses (status check only allows active/revoked/
--    expired, so we use a dedicated nullable column instead of a status value).
alter table public.licenses add column if not exists deleted_at timestamptz null;
create index if not exists idx_licenses_deleted_at on public.licenses(deleted_at);

-- 2) SOFT DELETE — keep all rows, but disable the account so it can be restored.
--    Revokes the licence, frees device seats, and bans the auth user from login.
create or replace function public.admin_soft_delete_user(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  e text := lower(trim(p_email));
  n_lic int := 0;
  n_dev int := 0;
  n_auth int := 0;
begin
  if e is null or e = '' then
    raise exception 'email required';
  end if;

  update public.licenses
    set deleted_at = now(), status = 'revoked'
    where lower(email) = e and deleted_at is null;
  get diagnostics n_lic = row_count;

  delete from public.license_devices
    where license_id in (select id from public.licenses where lower(email) = e);
  get diagnostics n_dev = row_count;

  -- Ban from website login (recoverable by clearing banned_until on restore).
  update auth.users set banned_until = 'infinity'::timestamptz
    where lower(email) = e;
  get diagnostics n_auth = row_count;

  return jsonb_build_object(
    'email', e, 'licenses_disabled', n_lic, 'devices_cleared', n_dev, 'auth_banned', n_auth
  );
end;
$$;

-- 3) RESTORE — undo a soft delete.
create or replace function public.admin_restore_user(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  e text := lower(trim(p_email));
  n_lic int := 0;
  n_auth int := 0;
begin
  if e is null or e = '' then
    raise exception 'email required';
  end if;

  update public.licenses
    set deleted_at = null, status = 'active'
    where lower(email) = e and deleted_at is not null;
  get diagnostics n_lic = row_count;

  update auth.users set banned_until = null
    where lower(email) = e;
  get diagnostics n_auth = row_count;

  return jsonb_build_object('email', e, 'licenses_restored', n_lic, 'auth_unbanned', n_auth);
end;
$$;

-- 4) HARD DELETE — permanent. Removes the auth user (cascades profiles and ALL
--    community data) plus every email-keyed activation/billing row, so the same
--    email is completely free to sign up + activate again.
create or replace function public.admin_hard_delete_user(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  e text := lower(trim(p_email));
  n_auth int := 0;
  n_lic int := 0;
  n_att int := 0;
  n_onb int := 0;
  n_appu int := 0;
  n_coup int := 0;
begin
  if e is null or e = '' then
    raise exception 'email required';
  end if;

  -- auth.users → profiles (on delete cascade) → workspaces/byok_keys/posts/
  -- insights/sweeps/published_research/upvotes/follows/enterprise_actions.
  delete from auth.users where lower(email) = e;
  get diagnostics n_auth = row_count;

  delete from public.coupon_redemptions where lower(redeemed_by_email) = e;
  get diagnostics n_coup = row_count;

  delete from public.activation_attempts where lower(email) = e;
  get diagnostics n_att = row_count;

  -- licenses → license_devices (on delete cascade).
  delete from public.licenses where lower(email) = e;
  get diagnostics n_lic = row_count;

  delete from public.onboarding_responses where lower(email) = e;
  get diagnostics n_onb = row_count;

  -- app_users → user_subscriptions/payment_events/token_wallets/token_ledger.
  delete from public.app_users where lower(email) = e;
  get diagnostics n_appu = row_count;

  return jsonb_build_object(
    'email', e, 'auth_users', n_auth, 'licenses', n_lic, 'activation_attempts', n_att,
    'onboarding', n_onb, 'app_users', n_appu, 'coupon_redemptions', n_coup
  );
end;
$$;

-- Lock these down: callable only by the service_role (the admin API uses the
-- service-role key). Never expose to anon/authenticated clients.
revoke all on function public.admin_soft_delete_user(text) from public, anon, authenticated;
revoke all on function public.admin_restore_user(text)     from public, anon, authenticated;
revoke all on function public.admin_hard_delete_user(text) from public, anon, authenticated;
grant execute on function public.admin_soft_delete_user(text) to service_role;
grant execute on function public.admin_restore_user(text)     to service_role;
grant execute on function public.admin_hard_delete_user(text) to service_role;
