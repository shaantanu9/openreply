# Knowledge → Task → Sections workflow

**Date:** 2026-06-29
**Type:** Feature

## Summary

Made the agent's knowledge actionable. Users can now create and assign tasks
(draft a post/article/thread, find replies, "what's new today") and route each
task into the proper working section — Compose, Inbox, or Queue. Tasks can be
created by hand on a new Tasks board, seeded one-click from the Brain knowledge
graph, or captured from the Overview "Daily Update" digest. When a task is
opened, its context is handed to the target section so the user lands ready to
work instead of starting from a blank screen.

## Changes

- **Backend tasks store** — new `reply_tasks` table + `tasks.py` module with
  `create_task` / `list_tasks` / `update_task` / `delete_task`, exposed through
  four Typer CLI commands (`task-list`, `task-create`, `task-update`,
  `task-delete`) and four Tauri commands (`agent_task_list/create/update/delete`).
- **Tasks board** (`#/tasks`) — three-column To-do / In progress / Done board
  with kind badges, advance/open/delete actions, and a "+ New task" modal.
  Added a Tasks item to the sidebar AGENT section.
- **Brain → Tasks** — node detail panel now shows a "Related" neighbour list
  (from graph edges) and an "Act on this" row: Draft post / Draft article /
  Find replies / What's new — each seeds a task from the node (`source: brain`).
- **Daily Update → Tasks** — each briefing section and feed item in the Overview
  digest gets a "+ Task" button that creates a `whats_new` Compose task seeded
  with the item's headline/snippet/url (`source: digest`).
- **Section seeding (sessionStorage handoff)** — opening a task writes its
  payload to `or-task-compose` / `or-task-inbox`; Compose preselects the kind and
  prefills the angle, Inbox prefills the search query; the task flips to
  `in_progress` automatically.

## Files Created

- `src/openreply/reply/tasks.py` — task CRUD over `reply_tasks`
- `docs/superpowers/specs/2026-06-29-knowledge-task-workflow-design.md` — design spec

## Files Modified

- `src/openreply/reply/schema.py` — added `reply_tasks` table + index
- `src/openreply/cli/reply_cmds.py` — 4 task CLI commands + `_parse_payload`
- `app-tauri/src-tauri/src/commands.rs` — 4 `agent_task_*` commands
- `app-tauri/src-tauri/src/main.rs` — registered the 4 task commands
- `app-tauri/src/or/api.js` — `taskList/taskCreate/taskUpdate/taskDelete` bindings
- `app-tauri/src/or/shell.js` — Tasks nav item under AGENT
- `app-tauri/src/or/dynamic.js` — `renderTasks` board + DYN route; Compose &
  Inbox sessionStorage seed-reads; Brain detail Related + action buttons;
  Overview digest "+ Task" buttons
