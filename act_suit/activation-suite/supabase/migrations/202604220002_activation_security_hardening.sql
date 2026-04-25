create extension if not exists pgcrypto with schema extensions;

alter table public.licenses
  add column if not exists password_hash text,
  add column if not exists activation_key_hash text;

update public.licenses
set
  password_hash = coalesce(password_hash, encode(extensions.digest(coalesce(password, ''), 'sha256'), 'hex')),
  activation_key_hash = coalesce(activation_key_hash, encode(extensions.digest(coalesce(activation_key, ''), 'sha256'), 'hex'))
where password_hash is null or activation_key_hash is null;

alter table public.licenses alter column password_hash set not null;
alter table public.licenses alter column activation_key_hash set not null;

create index if not exists idx_licenses_email_password_hash
  on public.licenses(email, password_hash);
create index if not exists idx_licenses_activation_key_hash
  on public.licenses(activation_key_hash);

-- Keep legacy plaintext columns only for backward compatibility / rollback.
alter table public.licenses alter column password drop not null;
alter table public.licenses alter column activation_key drop not null;

create table if not exists public.activation_attempts (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  email text not null,
  license_id uuid null references public.licenses(id) on delete set null,
  device_signature_hash text not null,
  outcome text not null check (outcome in ('success', 'failed')),
  error_code text null,
  http_status integer not null check (http_status >= 100 and http_status <= 599)
);

create index if not exists idx_activation_attempts_occurred_at
  on public.activation_attempts(occurred_at desc);
create index if not exists idx_activation_attempts_email
  on public.activation_attempts(email);

alter table public.activation_attempts enable row level security;

drop policy if exists "anon + service full access licenses" on public.licenses;
drop policy if exists "anon + service full access license_devices" on public.license_devices;
drop policy if exists "service role full access licenses" on public.licenses;
drop policy if exists "service role full access license_devices" on public.license_devices;
drop policy if exists "service role full access activation_attempts" on public.activation_attempts;

create policy "service role full access licenses"
on public.licenses
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

create policy "service role full access license_devices"
on public.license_devices
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

create policy "service role full access activation_attempts"
on public.activation_attempts
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');
