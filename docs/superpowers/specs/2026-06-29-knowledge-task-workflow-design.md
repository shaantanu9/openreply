# Knowledge → Task → Sections workflow — design

**Date:** 2026-06-29
**Branch:** public-main (`app-tauri/src/or/` monolith)
**Status:** Approved (user) — ready for implementation plan

## Problem

The Brain graph shows the agent's knowledge but is read-only — you can inspect a
node but can't *act* on it. The Overview "Daily Update" digest surfaces what's
new but each item is a dead end. And there's no place to capture "I should draft
a post about this" / "find replies on this" and route it into the existing
sections (Compose / Inbox / Queue). This adds a lightweight **task** layer that
connects knowledge → an assignable task → the right working surface.

## What already exists (reused, not duplicated)

- **Digest:** `reply_digest` table (`src/openreply/reply/schema.py:134`),
  `build_digest()` (`src/openreply/reply/digest.py:179`), CLI `reply digest`,
  Rust `agent_digest` (`app-tauri/src-tauri/src/commands.rs:3730`),
  `api.agentDigest()` (`api.js:185`), rendered as `#ov-digest` in
  `renderOverview()` (`dynamic.js:244-332`). Items: briefing sections
  `{headline, why, links}` + feed `{title, url, source, snippet, created_utc}`.
- **Brain:** `renderBrain()` (`dynamic.js:3444`), node detail `#br-detail`
  (`dynamic.js:3476`) shows `group / lens / label / excerpt / confidence /
  importance`. Backend `agent_brain` → `{graph:{nodes,links}, tree}`. Links
  exist but aren't surfaced in the panel.
- **Seeding pattern:** Compose already reads `sessionStorage["or-repurpose-ctx"]`
  handed from Watch (`dynamic.js:752`). Inbox/Queue are tab-driven, no handoff.
- **No task table** exists anywhere in `src/openreply/` (confirmed).

## Architecture

Additive throughout. No existing command/table is modified.

### 1. Data model — `reply_tasks` table (`reply/schema.py`)

Agent-scoped, created in the same idempotent `if "reply_tasks" not in names`
block style as `reply_digest`.

| column | type | notes |
|---|---|---|
| `id` | str pk | uuid hex |
| `agent_id` | str | indexed with `status` |
| `title` | str | e.g. "Draft post: <node label>" |
| `kind` | str | `draft_post` `draft_article` `draft_thread` `find_replies` `whats_new` `custom` |
| `status` | str | `todo` `in_progress` `done` |
| `target` | str | `compose` `inbox` `queue` or empty — which section "Open" seeds |
| `payload_json` | str | JSON seed: `{compose_kind, angle, context, url, node_id, node_label, query}` |
| `source` | str | `graph` `digest` `manual` |
| `source_ref` | str | node id / digest day / empty |
| `note` | str | optional |
| `created_at` | int | epoch |
| `updated_at` | int | epoch |
| `done_at` | int | set when status → done, else null |

Index: `["agent_id", "status"]`.

### 2. Backend — Python

New `src/openreply/reply/tasks.py`:
- `create_task(agent_id, title, kind, *, target="", payload=None, source="manual", source_ref="", note="") -> dict`
- `list_tasks(agent_id, status=None) -> {"tasks": [...]}` (ordered by status then created_at desc)
- `update_task(task_id, *, status=None, title=None, note=None, payload=None) -> dict` (sets `done_at`/clears it on status change)
- `delete_task(task_id) -> {"ok": True}`

Agent resolution mirrors digest: default to the active agent when `agent_id`
is None (`get_agent`).

### 3. CLI — `src/openreply/cli/reply_cmds.py`

Commands (all `--json` default, matching existing style):
- `reply task-list [--id <agent>] [--status todo|in_progress|done]`
- `reply task-create --title ... --kind ... [--target ...] [--payload <json>] [--source ...] [--source-ref ...] [--note ...]`
- `reply task-update --task <id> [--status ...] [--title ...] [--note ...] [--payload <json>]`
- `reply task-delete --task <id>`

### 4. Rust — `commands.rs` + `main.rs`

`agent_task_list / agent_task_create / agent_task_update / agent_task_delete`,
each shelling to the matching CLI via `run_cli`, registered in the `main.rs`
`generate_handler!` list (command-registration triangle).

### 5. api.js bindings

- `taskList: (status) => call("agent_task_list", { status })`
- `taskCreate: (obj) => call("agent_task_create", obj)`
- `taskUpdate: (id, fields) => call("agent_task_update", { task: id, ...fields })`
- `taskDelete: (id) => call("agent_task_delete", { task: id })`

### 6. Tasks board view (`dynamic.js` + `shell.js` + `main.js`)

- Nav item in `shell.js` `NAV` under **AGENT**, after Queue:
  `['tasks','list-checks','Tasks']`.
- `renderTasks(view)` in `dynamic.js`, registered in the `DYN` map, routed in
  `main.js` (same triangle as every view). Lives in the dynamic.js view
  monolith for consistency with all other views.
- Layout: three columns **To-do / In progress / Done**. Each card: title,
  `kind` badge, source chip, status-advance button (todo→in_progress→done),
  **"Open in <target>"** (when target set), delete. Header **"+ New task"**
  for a manual task.

### 7. Brain page — richer detail + graph actions (`dynamic.js:3476`)

In `#br-detail`, after the existing fields, add:
- **Related** — neighbour labels resolved from `b.graph.links` by node id
  (top ~5), so the panel shows graph knowledge in detail.
- **Action row** — *Draft post*, *Draft article*, *Find replies*,
  *What's new on this*. Each calls `api.taskCreate(...)` seeded from the node
  (`source:"graph"`, `source_ref:node.id`, `payload:{compose_kind, angle:label,
  context:excerpt, node_id, node_label}`, appropriate `target`), then
  `orToast("Added to Tasks")`. Tasks land in the board's To-do column.

### 8. What's-new → one-click task (`dynamic.js:244-332`)

In the digest render, add a **"+ Task"** button on each feed item / briefing
link → `api.taskCreate({title:item.title, kind:"whats_new", source:"digest",
source_ref:day, target:"compose", payload:{compose_kind:"post",
angle:item.title, context:item.snippet, url:item.url}})`.

### 9. Seeding the sections (the "move to proper sections" part)

Reuse the existing sessionStorage handoff:
- **target=compose** → "Open in Compose" sets
  `sessionStorage["or-task-compose"]={compose_kind, angle, context, title}`,
  navigates `#/compose`; a new read-block in `renderCompose` (twin of the
  repurpose block at `dynamic.js:752`) selects the kind + fills angle/context,
  and the task flips to `in_progress` via `api.taskUpdate`.
- **target=inbox** (find_replies) → set `sessionStorage["or-task-inbox"]=
  {query:node_label}`, navigate `#/inbox`; a read-block in `renderInbox`
  pre-fills the search box (topic filter).
- **target=queue** → navigate `#/queue` (queue lists content; no seed needed).

## Data flow

```
Brain node ──(Draft post)──┐
Digest item ─(+ Task)──────┼──► reply_tasks (todo) ──► Tasks board
Manual + New task ─────────┘                              │
                                            (Open in target) ──► sessionStorage handoff
                                                                  │
                                          Compose (pre-filled) / Inbox (query) / Queue
                                                                  │
                                                       task → in_progress → done
```

## Error handling

- Every `api.task*` call wrapped in try/catch with `orToast` on failure
  (network/db); board shows an empty-state when `tasks` is empty.
- `payload_json` parsed tolerantly (bad JSON → empty seed, task still opens the
  bare section).
- Tasks board degrades to read-only if `api.isTauri()` is false (web preview).

## Testing

- CLI round-trip: `task-create` → `task-list` shows it → `task-update --status
  done` sets `done_at` → `task-delete` removes it.
- Schema idempotency: re-run `init_schema`, table not recreated.
- Frontend: `npx vite build` passes; manual smoke of board columns, graph
  buttons creating tasks, digest "+ Task", and each "Open in <target>" seed.

## Out of scope (YAGNI)

- Due dates, priorities, assignees-to-other-agents, drag-and-drop reordering.
- Auto-running collect/draft from a task (tasks *seed* a section; the user
  drives the action there).
- A third sidebar state (`hidden`) — Track A shipped `full`/`rail` only.

## Affected files

- `src/openreply/reply/schema.py` (table)
- `src/openreply/reply/tasks.py` (new)
- `src/openreply/cli/reply_cmds.py` (4 commands)
- `app-tauri/src-tauri/src/commands.rs` (4 commands)
- `app-tauri/src-tauri/src/main.rs` (registration)
- `app-tauri/src/or/api.js` (4 bindings)
- `app-tauri/src/or/shell.js` (nav item)
- `app-tauri/src/or/dynamic.js` (renderTasks + DYN map + renderCompose/renderInbox
  seed-reads + renderBrain detail/buttons + renderOverview digest "+ Task")
- `app-tauri/src/main.js` (route)
- `changelogs/`, `FEATURES.md` (per repo rules)
</content>
