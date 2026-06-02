-- Coupons table — single-use OR shared codes that issue free activation keys.
--
-- Design:
--   * One row per coupon code. `max_redemptions = NULL` means unlimited;
--     `max_redemptions = 1` makes the code effectively single-use; values >1
--     allow shared codes (e.g., FRIENDS50 with 50 redemptions).
--   * `current_redemptions` is the live counter, atomically incremented by
--     redeem_coupon() so two concurrent redemptions can never over-grant.
--   * `expires_at` is optional. NULL = no expiry.
--   * `plan_id` controls what plan the issued licence row gets.
--
-- A `coupon_redemptions` audit table records every successful redemption
-- so we can answer "which user got which key from which coupon when".
-- Foreign-keyed to both auth.users (or app_user_id) and licenses.

create table if not exists public.coupons (
  code               text primary key,
  plan_id            text not null default 'pro' check (plan_id in ('free','pro','live_pass','pro_trial')),
  max_redemptions    integer null check (max_redemptions is null or max_redemptions > 0),
  current_redemptions integer not null default 0 check (current_redemptions >= 0),
  expires_at         timestamptz null,
  -- License the redemption produces. Mirrors fields on licenses(...).
  license_max_devices integer not null default 1 check (license_max_devices > 0),
  license_duration_days integer null check (license_duration_days is null or license_duration_days > 0),
  -- Soft-disable without deleting (preserves audit trail).
  disabled           boolean not null default false,
  -- Free-text for the operator (e.g., "EARLYBIRD2026 — sent to first 100 waitlist signups").
  note               text null,
  created_at         timestamptz not null default now(),
  created_by         text null
);

create index if not exists idx_coupons_disabled_expires
  on public.coupons(disabled, expires_at);

-- Audit log: every successful redemption.
-- (No row inserted on failed attempts — those go to server logs only.)
create table if not exists public.coupon_redemptions (
  id                 uuid primary key default gen_random_uuid(),
  coupon_code        text not null references public.coupons(code) on delete restrict,
  license_id         uuid not null references public.licenses(id) on delete cascade,
  redeemed_by_email  text not null,
  redeemed_by_user_id text null,   -- app_users.id if available
  redeemed_at        timestamptz not null default now(),
  unique (coupon_code, license_id)
);

create index if not exists idx_coupon_redemptions_coupon on public.coupon_redemptions(coupon_code);
create index if not exists idx_coupon_redemptions_user on public.coupon_redemptions(redeemed_by_email);

-- RLS — same posture as `licenses`: anon + service-role can read/write.
-- The redeem endpoint runs in a Node route with the service-role key, so
-- this is mostly a belt-and-suspenders measure against an accidental
-- direct-from-client read.
alter table public.coupons enable row level security;
alter table public.coupon_redemptions enable row level security;

drop policy if exists "anon + service full access coupons" on public.coupons;
drop policy if exists "anon + service full access coupon_redemptions" on public.coupon_redemptions;

create policy "anon + service full access coupons"
  on public.coupons for all
  using (auth.role() in ('anon', 'service_role'))
  with check (auth.role() in ('anon', 'service_role'));

create policy "anon + service full access coupon_redemptions"
  on public.coupon_redemptions for all
  using (auth.role() in ('anon', 'service_role'))
  with check (auth.role() in ('anon', 'service_role'));

-- Atomic redeem function — increments the counter ONLY if the coupon is
-- valid (exists, not disabled, not expired, not exhausted). Concurrent
-- callers serialize on the row's update; the second caller sees the
-- already-incremented counter and gets a clean "exhausted" error.
--
-- Returns the coupon row when successful; throws an exception with a
-- specific SQLSTATE code so the caller can map to a friendly error:
--   'P0001' / message='not_found' | 'disabled' | 'expired' | 'exhausted'
create or replace function public.redeem_coupon(p_code text)
returns public.coupons
language plpgsql
security definer
as $$
declare
  v_row public.coupons;
begin
  -- Lock the coupon row so concurrent redeems serialize.
  select * into v_row from public.coupons where code = p_code for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if v_row.disabled then
    raise exception 'disabled' using errcode = 'P0001';
  end if;
  if v_row.expires_at is not null and v_row.expires_at < now() then
    raise exception 'expired' using errcode = 'P0001';
  end if;
  if v_row.max_redemptions is not null
     and v_row.current_redemptions >= v_row.max_redemptions then
    raise exception 'exhausted' using errcode = 'P0001';
  end if;
  update public.coupons
    set current_redemptions = current_redemptions + 1
    where code = p_code
    returning * into v_row;
  return v_row;
end;
$$;

-- Grant execute to anon + authenticated so the API route (using anon key)
-- can call this; the service-role bypass also works.
grant execute on function public.redeem_coupon(text) to anon, authenticated, service_role;

-- ─── Example seed data (commented out — uncomment + edit to bootstrap) ─────
-- insert into public.coupons (code, plan_id, max_redemptions, note)
--   values ('GAPMAP-LAUNCH-EARLY', 'pro', 100,
--           'Early-access cohort — sent via DM, May 2026');
-- insert into public.coupons (code, plan_id, max_redemptions, expires_at, note)
--   values ('GAPMAP-DEMO',         'pro_trial', 1, now() + interval '30 days',
--           'Single-use demo for partner onboarding call');
