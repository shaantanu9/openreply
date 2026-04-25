create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text not null unique,
  password_hash text not null,
  role text not null default 'researcher',
  created_at timestamptz not null default now()
);

create table if not exists public.user_subscriptions (
  id uuid primary key default gen_random_uuid(),
  app_user_id uuid not null references public.app_users(id) on delete cascade,
  plan_code text not null,
  status text not null check (status in ('active', 'canceled', 'expired')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz null,
  provider text not null default 'manual',
  provider_ref text null
);

create table if not exists public.payment_events (
  id uuid primary key default gen_random_uuid(),
  app_user_id uuid not null references public.app_users(id) on delete cascade,
  provider text not null,
  provider_ref text not null unique,
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null default 'usd',
  status text not null check (status in ('paid', 'failed', 'refunded')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.token_wallets (
  app_user_id uuid primary key references public.app_users(id) on delete cascade,
  balance integer not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.token_ledger (
  id uuid primary key default gen_random_uuid(),
  app_user_id uuid not null references public.app_users(id) on delete cascade,
  delta integer not null,
  reason text not null,
  ref_id text null,
  created_at timestamptz not null default now()
);

alter table public.licenses
  add column if not exists app_user_id uuid null references public.app_users(id) on delete set null;

create index if not exists idx_app_users_email on public.app_users(email);
create index if not exists idx_user_subscriptions_user on public.user_subscriptions(app_user_id, status);
create index if not exists idx_payment_events_user on public.payment_events(app_user_id, created_at desc);
create index if not exists idx_token_ledger_user on public.token_ledger(app_user_id, created_at desc);
create index if not exists idx_licenses_app_user_id on public.licenses(app_user_id);

alter table public.app_users enable row level security;
alter table public.user_subscriptions enable row level security;
alter table public.payment_events enable row level security;
alter table public.token_wallets enable row level security;
alter table public.token_ledger enable row level security;

drop policy if exists "service role full access app_users" on public.app_users;
drop policy if exists "service role full access user_subscriptions" on public.user_subscriptions;
drop policy if exists "service role full access payment_events" on public.payment_events;
drop policy if exists "service role full access token_wallets" on public.token_wallets;
drop policy if exists "service role full access token_ledger" on public.token_ledger;

create policy "service role full access app_users"
on public.app_users
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

create policy "service role full access user_subscriptions"
on public.user_subscriptions
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

create policy "service role full access payment_events"
on public.payment_events
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

create policy "service role full access token_wallets"
on public.token_wallets
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

create policy "service role full access token_ledger"
on public.token_ledger
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');
