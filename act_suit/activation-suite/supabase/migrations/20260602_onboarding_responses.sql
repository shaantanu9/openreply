-- Onboarding responses captured from the desktop app / website.
-- Run this in the Supabase SQL editor (or `supabase db push`) before relying on
-- server-side onboarding storage. Until it exists, the API stores nothing on
-- the hosted path (it returns ok:false, stored:"none") and uses the local file
-- store in dev.

create table if not exists public.onboarding_responses (
  email       text primary key,
  data        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Service-role only (server writes via SERVICE_ROLE_KEY). No public access.
alter table public.onboarding_responses enable row level security;
