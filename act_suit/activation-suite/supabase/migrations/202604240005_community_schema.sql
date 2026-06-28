-- OpenReply Community schema (per docs/licence/openreply-dual-app-spec.md §4.3–4.4).
-- This is the research-publishing half of the product. All data here is
-- user-owned but defaults to public; privacy is what Pro unlocks.

create extension if not exists pgcrypto with schema extensions;

-- ── profiles ────────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  username        text unique not null,
  display_name    text,
  avatar_url      text,
  bio             text,
  website         text,
  twitter_handle  text,
  research_count  int not null default 0,
  follower_count  int not null default 0,
  is_verified     boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_profiles_username on public.profiles(lower(username));

-- ── workspaces ──────────────────────────────────────────────────────────────
create table if not exists public.workspaces (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references public.profiles(id) on delete cascade,
  name            text not null,
  slug            text unique,
  description     text,
  topic           text,
  is_public       boolean not null default true,
  status          text not null default 'active' check (status in ('active', 'archived')),
  last_sweep_at   timestamptz,
  post_count      int not null default 0,
  insight_count   int not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_workspaces_user on public.workspaces(user_id);
create index if not exists idx_workspaces_public on public.workspaces(is_public) where is_public;

-- ── workspace_sources ───────────────────────────────────────────────────────
create table if not exists public.workspace_sources (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  source_type     text not null,
  config          jsonb,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now()
);
create index if not exists idx_workspace_sources_workspace on public.workspace_sources(workspace_id);

-- ── byok_keys (encrypted at rest) ───────────────────────────────────────────
create table if not exists public.byok_keys (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  provider        text not null check (provider in ('anthropic', 'openai', 'gemini')),
  encrypted_key   text not null,
  key_preview     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique(user_id, provider)
);
create index if not exists idx_byok_user on public.byok_keys(user_id);

-- ── posts (raw sweep output) ────────────────────────────────────────────────
create table if not exists public.posts (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  sweep_id        uuid,
  source_type     text not null,
  source_url      text,
  source_id       text,
  title           text,
  body            text,
  author          text,
  published_at    timestamptz,
  score           int,
  indexed_at      timestamptz not null default now(),
  unique(workspace_id, source_type, source_id)
);
create index if not exists idx_posts_workspace on public.posts(workspace_id);
create index if not exists idx_posts_sweep on public.posts(sweep_id);

-- ── insights (extracted pain points) ────────────────────────────────────────
create table if not exists public.insights (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  sweep_id        uuid,
  post_id         uuid references public.posts(id) on delete set null,
  insight_type    text not null check (insight_type in ('pain', 'workaround', 'request', 'praise')),
  title           text not null,
  description     text,
  severity        int check (severity >= 1 and severity <= 5),
  frequency       int default 0,
  frequency_pct   numeric(5,2) default 0,
  tags            text[] default array[]::text[],
  source_urls     text[] default array[]::text[],
  created_at      timestamptz not null default now()
);
create index if not exists idx_insights_workspace on public.insights(workspace_id);
create index if not exists idx_insights_type on public.insights(insight_type);

-- ── sweeps (audit log + progress) ───────────────────────────────────────────
create table if not exists public.sweeps (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  user_id         uuid references public.profiles(id) on delete set null,
  status          text not null default 'running' check (status in ('running', 'complete', 'failed')),
  sources_swept   text[] default array[]::text[],
  posts_indexed   int not null default 0,
  insights_found  int not null default 0,
  progress_pct    int not null default 0,
  started_at      timestamptz not null default now(),
  completed_at    timestamptz,
  error_message   text
);
create index if not exists idx_sweeps_workspace on public.sweeps(workspace_id);
create index if not exists idx_sweeps_user on public.sweeps(user_id);

-- ── published_research (public explore feed) ────────────────────────────────
create table if not exists public.published_research (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces(id) on delete cascade,
  user_id           uuid references public.profiles(id) on delete set null,
  slug              text unique not null,
  title             text not null,
  description       text,
  insights_snapshot jsonb,
  source_types      text[] default array[]::text[],
  post_count        int default 0,
  insight_count     int default 0,
  view_count        int not null default 0,
  upvote_count      int not null default 0,
  is_featured       boolean not null default false,
  -- Pro users can publish anonymously via the cross-app bridge; we set
  -- `pro_publish=true` and leave `user_id` null in that path.
  pro_publish       boolean not null default false,
  published_at      timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_published_user on public.published_research(user_id);
create index if not exists idx_published_featured on public.published_research(is_featured) where is_featured;

-- ── research_upvotes ────────────────────────────────────────────────────────
create table if not exists public.research_upvotes (
  user_id         uuid not null references public.profiles(id) on delete cascade,
  research_id     uuid not null references public.published_research(id) on delete cascade,
  created_at      timestamptz not null default now(),
  primary key (user_id, research_id)
);

-- ── follows ─────────────────────────────────────────────────────────────────
create table if not exists public.follows (
  follower_id     uuid not null references public.profiles(id) on delete cascade,
  following_id    uuid not null references public.profiles(id) on delete cascade,
  created_at      timestamptz not null default now(),
  primary key (follower_id, following_id),
  check (follower_id <> following_id)
);

-- ── RLS policies ────────────────────────────────────────────────────────────
alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_sources enable row level security;
alter table public.byok_keys enable row level security;
alter table public.posts enable row level security;
alter table public.insights enable row level security;
alter table public.sweeps enable row level security;
alter table public.published_research enable row level security;
alter table public.research_upvotes enable row level security;
alter table public.follows enable row level security;

drop policy if exists "profiles_public_read" on public.profiles;
drop policy if exists "profiles_own_write" on public.profiles;
create policy "profiles_public_read" on public.profiles
  for select using (true);
create policy "profiles_own_write" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "workspaces_public_read" on public.workspaces;
drop policy if exists "workspaces_own_write" on public.workspaces;
create policy "workspaces_public_read" on public.workspaces
  for select using (is_public = true or auth.uid() = user_id);
create policy "workspaces_own_write" on public.workspaces
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "workspace_sources_read" on public.workspace_sources;
drop policy if exists "workspace_sources_own_write" on public.workspace_sources;
create policy "workspace_sources_read" on public.workspace_sources
  for select using (
    exists (
      select 1 from public.workspaces w
      where w.id = workspace_id and (w.is_public = true or w.user_id = auth.uid())
    )
  );
create policy "workspace_sources_own_write" on public.workspace_sources
  for all using (
    exists (
      select 1 from public.workspaces w
      where w.id = workspace_id and w.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.workspaces w
      where w.id = workspace_id and w.user_id = auth.uid()
    )
  );

drop policy if exists "byok_owner_only" on public.byok_keys;
create policy "byok_owner_only" on public.byok_keys
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "posts_read" on public.posts;
drop policy if exists "posts_own_write" on public.posts;
create policy "posts_read" on public.posts
  for select using (
    exists (
      select 1 from public.workspaces w
      where w.id = workspace_id and (w.is_public = true or w.user_id = auth.uid())
    )
  );
create policy "posts_own_write" on public.posts
  for all using (
    exists (
      select 1 from public.workspaces w
      where w.id = workspace_id and w.user_id = auth.uid()
    )
  );

drop policy if exists "insights_read" on public.insights;
drop policy if exists "insights_own_write" on public.insights;
create policy "insights_read" on public.insights
  for select using (
    exists (
      select 1 from public.workspaces w
      where w.id = workspace_id and (w.is_public = true or w.user_id = auth.uid())
    )
  );
create policy "insights_own_write" on public.insights
  for all using (
    exists (
      select 1 from public.workspaces w
      where w.id = workspace_id and w.user_id = auth.uid()
    )
  );

drop policy if exists "sweeps_own_read" on public.sweeps;
drop policy if exists "sweeps_own_write" on public.sweeps;
create policy "sweeps_own_read" on public.sweeps
  for select using (auth.uid() = user_id or exists (
    select 1 from public.workspaces w
    where w.id = workspace_id and w.is_public = true
  ));
create policy "sweeps_own_write" on public.sweeps
  for all using (auth.uid() = user_id);

drop policy if exists "published_public_read" on public.published_research;
drop policy if exists "published_own_write" on public.published_research;
create policy "published_public_read" on public.published_research
  for select using (true);
create policy "published_own_write" on public.published_research
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "upvotes_own" on public.research_upvotes;
create policy "upvotes_own" on public.research_upvotes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "follows_own" on public.follows;
create policy "follows_own" on public.follows
  for all using (auth.uid() = follower_id) with check (auth.uid() = follower_id);

-- ── Triggers ────────────────────────────────────────────────────────────────
-- Auto-update `updated_at` on mutations.
create or replace function public.tg_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_profiles_touch on public.profiles;
create trigger trg_profiles_touch before update on public.profiles
  for each row execute function public.tg_touch_updated_at();

drop trigger if exists trg_workspaces_touch on public.workspaces;
create trigger trg_workspaces_touch before update on public.workspaces
  for each row execute function public.tg_touch_updated_at();

drop trigger if exists trg_published_touch on public.published_research;
create trigger trg_published_touch before update on public.published_research
  for each row execute function public.tg_touch_updated_at();

-- Auto-create a profile row when a new auth user is inserted.
-- Username defaults to the local-part of the email; user can change it later.
create or replace function public.tg_auto_profile()
returns trigger language plpgsql security definer as $$
declare
  base text := split_part(coalesce(new.email, ''), '@', 1);
  candidate text := lower(regexp_replace(base, '[^a-zA-Z0-9_]', '_', 'g'));
begin
  if candidate = '' then candidate := 'user_' || substr(new.id::text, 1, 8); end if;
  -- If username collides, tack on a short uuid fragment.
  if exists (select 1 from public.profiles where username = candidate) then
    candidate := candidate || '_' || substr(new.id::text, 1, 6);
  end if;
  insert into public.profiles (id, username, display_name)
  values (new.id, candidate, coalesce(new.raw_user_meta_data ->> 'full_name', base))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists trg_auth_auto_profile on auth.users;
create trigger trg_auth_auto_profile after insert on auth.users
  for each row execute function public.tg_auto_profile();

-- Keep profiles.research_count in sync with published_research.
create or replace function public.tg_research_count()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' and new.user_id is not null then
    update public.profiles set research_count = research_count + 1 where id = new.user_id;
  elsif tg_op = 'DELETE' and old.user_id is not null then
    update public.profiles set research_count = greatest(0, research_count - 1) where id = old.user_id;
  end if;
  return null;
end $$;

drop trigger if exists trg_research_count on public.published_research;
create trigger trg_research_count after insert or delete on public.published_research
  for each row execute function public.tg_research_count();
