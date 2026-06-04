-- App version gate, DB-driven so the operator can force an update (or lift the
-- force) by editing one row — no redeploy. The /health + /api/v1/health
-- endpoints read this row (service-role) and fall back to env vars when absent.
--
-- Semantics:
--   force_update = false  → no hard gate; desktop runs on any version
--   force_update = true   → installs BELOW min_app_version are forced to update
--   latest_app_version    → soft "update available" pointer (non-blocking)
--   download_url          → where the update screen sends the user

create table if not exists public.app_config (
  id                 smallint primary key default 1,
  force_update       boolean not null default false,
  min_app_version    text,
  latest_app_version text,
  download_url       text,
  notes              text,
  updated_at         timestamptz not null default now(),
  constraint app_config_singleton check (id = 1)
);

-- Seed the single config row. Force off, latest pointer at the current build.
insert into public.app_config (id, force_update, min_app_version, latest_app_version, download_url)
values (1, false, null, '0.1.19', 'https://gapmap.myind.ai/download')
on conflict (id) do nothing;

-- Lock it down: only the service role (which bypasses RLS) may read/write.
-- The desktop never talks to the DB directly — it goes through /health.
alter table public.app_config enable row level security;

-- Keep updated_at fresh on edits.
create or replace function public.app_config_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_app_config_touch on public.app_config;
create trigger trg_app_config_touch
  before update on public.app_config
  for each row execute function public.app_config_touch_updated_at();
