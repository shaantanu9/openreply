-- Enterprise activity table for daily execution tracking.
-- Keeps insight -> owner/action loops inside a workspace.

create table if not exists public.enterprise_actions (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  insight_id      uuid references public.insights(id) on delete set null,
  owner_user_id   uuid not null references public.profiles(id) on delete cascade,
  owner_name      text,
  title           text not null,
  notes           text,
  priority        text not null default 'medium'
                  check (priority in ('low', 'medium', 'high', 'critical')),
  status          text not null default 'open'
                  check (status in ('open', 'in_progress', 'done', 'blocked')),
  due_at          timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_enterprise_actions_workspace
  on public.enterprise_actions(workspace_id);
create index if not exists idx_enterprise_actions_owner
  on public.enterprise_actions(owner_user_id);
create index if not exists idx_enterprise_actions_status
  on public.enterprise_actions(status);

alter table public.enterprise_actions enable row level security;

drop policy if exists "enterprise_actions_read" on public.enterprise_actions;
drop policy if exists "enterprise_actions_write" on public.enterprise_actions;

create policy "enterprise_actions_read" on public.enterprise_actions
  for select using (
    exists (
      select 1
      from public.workspaces w
      where w.id = workspace_id
        and (w.is_public = true or w.user_id = auth.uid())
    )
  );

create policy "enterprise_actions_write" on public.enterprise_actions
  for all using (
    exists (
      select 1
      from public.workspaces w
      where w.id = workspace_id and w.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1
      from public.workspaces w
      where w.id = workspace_id and w.user_id = auth.uid()
    )
  );

drop trigger if exists trg_enterprise_actions_touch on public.enterprise_actions;
create trigger trg_enterprise_actions_touch before update on public.enterprise_actions
  for each row execute function public.tg_touch_updated_at();
