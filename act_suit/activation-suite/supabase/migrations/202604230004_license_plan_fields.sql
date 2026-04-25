-- Add plan-shape columns to `licenses` so the JWT can carry the full claim set
-- expected by the desktop binary (see docs/licence/tauri-licence-impl.md §7).
--
-- `plan_id` is the canonical plan identifier ("free" | "pro" | "live_pass" |
-- "team" | "pro_trial"). Existing rows were minted before the billing system
-- existed and are therefore treated as "pro" — they were hand-issued to paid
-- beta users. New rows from the LS webhook will set this explicitly.

alter table public.licenses
  add column if not exists plan_id text not null default 'pro'
    check (plan_id in ('free', 'pro', 'live_pass', 'team', 'pro_trial')),
  add column if not exists live_pass_active boolean not null default false,
  add column if not exists is_trial boolean not null default false,
  add column if not exists trial_ends_at timestamptz null;

create index if not exists idx_licenses_plan_id on public.licenses(plan_id);
