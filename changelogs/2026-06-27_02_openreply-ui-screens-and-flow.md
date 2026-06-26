# OpenReply — UI screens, command bridge & flow change

**Date:** 2026-06-27
**Type:** Feature

## Summary

Built the OpenReply app UI on top of the repo (used as boilerplate): three new
screens (Agents, Opportunities, Compose) wired through the full command triangle
(JS `invoke` → Rust `#[tauri::command]` → Python `gapmap` CLI), a reworked flow
(Agents is now the landing screen), and new sidebar navigation. Verified: Rust
compiled clean and relaunched with all 12 new commands registered; all new JS
passes syntax checks; the underlying agent/reply/content engine was tested working.

## Changes

- **Rust bridge** (`commands.rs` + `main.rs`): 12 new commands — `reply_platforms`,
  `agent_list/get/create/use/knowledge/refresh`, `reply_find/list/draft`,
  `content_generate/list` — each a thin `run_cli` bridge.
- **api.js**: matching wrappers (`agentList`, `agentCreate`, `replyFind`, `replyDraft`,
  `contentGenerate`, …).
- **Screens** (`app-tauri/src/screens/`):
  - `agents.js` — Agents dashboard: list personas, create agent (name/niche/voice/
    keywords + platform checkboxes), make active, refresh knowledge.
  - `opportunities.js` — find → score → list opportunities; per-item "Draft reply"
    with editable draft + subreddit-compliance flag.
  - `compose.js` — generate post/thread/script/article from agent knowledge; recent
    drafts list.
- **Flow change** (`main.js`): `#/` now renders Agents (was the research dashboard,
  moved to `#/dashboard`); added `#/agents`, `#/opportunities`, `#/compose` routes.
- **Nav** (`index.html`): new Agents / Opportunities / Compose items at the top;
  legacy Dashboard demoted.
- **Styling** (`openreply.css`): dedicated styles for the new `.or-*` UI.

## Files Created

- `app-tauri/src/screens/{agents,opportunities,compose}.js`
- `app-tauri/src/openreply.css`
- `changelogs/2026-06-27_02_openreply-ui-screens-and-flow.md`

## Files Modified

- `app-tauri/src-tauri/src/{commands,main}.rs` — command bridges + registration
- `app-tauri/src/{api.js,main.js}` — wrappers + routes/imports
- `app-tauri/index.html` — nav + flow + css link
