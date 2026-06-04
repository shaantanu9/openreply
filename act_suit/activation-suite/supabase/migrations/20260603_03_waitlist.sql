-- Waitlist for code-less visitors (the FOMO fallback). People without a beta
-- invite request access here; the operator invites them from the admin console,
-- which generates a single-use coupon and emails it.

create table if not exists public.waitlist (
  id          uuid primary key default gen_random_uuid(),
  email       text not null unique,
  name        text null,
  role        text null,
  reason      text null,                 -- "what do you want to use Gap Map for"
  status      text not null default 'pending'
                check (status in ('pending','invited','converted','rejected')),
  invite_code text null,                  -- the coupon generated when invited
  created_at  timestamptz not null default now(),
  invited_at  timestamptz null
);

create index if not exists idx_waitlist_status on public.waitlist(status, created_at desc);

-- RLS on. Our API routes use the service-role key (which bypasses RLS), so
-- there is intentionally NO anon/authenticated policy — no direct client access.
alter table public.waitlist enable row level security;
