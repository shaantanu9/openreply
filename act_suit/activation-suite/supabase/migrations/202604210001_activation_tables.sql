create table if not exists public.licenses (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  email text not null,
  password text not null,
  activation_key text not null unique,
  status text not null default 'active' check (status in ('active', 'revoked', 'expired')),
  max_devices integer not null default 1 check (max_devices > 0),
  expires_at timestamptz null,
  created_at timestamptz not null default now()
);

create index if not exists idx_licenses_email on public.licenses(email);

create table if not exists public.license_devices (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null references public.licenses(id) on delete cascade,
  signature_hash text not null,
  os text not null default 'unknown',
  arch text not null default 'unknown',
  activated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (license_id, signature_hash)
);

create index if not exists idx_license_devices_license_id on public.license_devices(license_id);

alter table public.licenses enable row level security;
alter table public.license_devices enable row level security;

-- For local-first server-side usage with service role only.
-- This setup allows anon-key server access (Next API routes using anon key).
-- Tighten these policies before exposing this DB directly to client apps.
drop policy if exists "service role full access licenses" on public.licenses;
drop policy if exists "service role full access license_devices" on public.license_devices;

create policy "anon + service full access licenses"
on public.licenses
for all
using (auth.role() in ('anon', 'service_role'))
with check (auth.role() in ('anon', 'service_role'));

create policy "anon + service full access license_devices"
on public.license_devices
for all
using (auth.role() in ('anon', 'service_role'))
with check (auth.role() in ('anon', 'service_role'));
