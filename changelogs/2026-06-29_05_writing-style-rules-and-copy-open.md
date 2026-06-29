# Writing-style rules for replies + "Copy & open" draft action

**Date:** 2026-06-29
**Type:** Feature

## Summary

Replies can now be written in the user's own voice. The user defines free-text
writing-style rules (e.g. "lowercase, casual", "no em-dashes", "never start with
'Great question'") that merge with the reply system prompt at generation time —
so drafts read like the user wrote them rather than like generic AI output.

Rules resolve as **global default + per-agent override**: a global "Writing
style" box in Settings applies to every agent; an agent that has its own
writing-style rules (in Keywords & platforms) overrides the global default. An
empty per-agent box falls back to the global value.

Also adds a one-click **"📋↗ Copy & open"** button on each draft reply that copies
the draft text to the clipboard *and* opens the original post in the browser in a
single action (saves a click vs. Copy → Open thread).

## Changes

- New per-agent `style_rules` column on `agents` (with migration) + global
  `global_style_rules` kv in `reply_state`.
- `effective_style_rules(agent)` resolver: per-agent rules if set, else global.
- `generate_reply` injects a "YOUR WRITING STYLE" block into both the draft
  prompt and the self-critique rewrite pass.
- CLI: `agent update --style-rules`, plus `agent style-get` / `agent style-set`
  for the global value.
- Tauri commands: `style_rules` added to `agent_update`; new `style_rules_get` /
  `style_rules_set` (registered in `main.rs`); `api.js` `styleRulesGet/Set`.
  `agent_update` treats an explicit empty `style_rules` as "clear the override"
  (it is not skipped like other empty fields).
- Frontend: global "Writing style" card in Settings (`buildStyleCard`),
  per-agent "Writing-style rules" textarea in Keywords & platforms, and the
  "Copy & open" button + `copyopen` handler in the Inbox draft editor.

## Files Created

- `changelogs/2026-06-29_05_writing-style-rules-and-copy-open.md`

## Files Modified

- `src/openreply/reply/agent.py` — `style_rules` column + migration; global
  `get/set_global_style_rules`; `effective_style_rules`; `update_agent` accepts
  `style_rules`.
- `src/openreply/reply/generate.py` — inject style block into draft prompt + self-critique.
- `src/openreply/cli/agent_cmds.py` — `agent update --style-rules`; `style-get` / `style-set`.
- `app-tauri/src-tauri/src/commands.rs` — `style_rules` arg on `agent_update`
  (empty = clear); `style_rules_get` / `style_rules_set`.
- `app-tauri/src-tauri/src/main.rs` — register the two new commands.
- `app-tauri/src/or/api.js` — `styleRulesGet` / `styleRulesSet`.
- `app-tauri/src/or/dynamic.js` — Settings "Writing style" card, per-agent style
  textarea + save, and the "Copy & open" draft button/handler.
