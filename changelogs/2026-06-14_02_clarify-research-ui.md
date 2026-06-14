# 2A Slice 2 — Clarify-research UI (clarified brief, end-to-end)

**Date:** 2026-06-14
**Type:** Feature (UI)
**Part of:** WhyBuddy port, Wave 2A. Completes the clarified-brief feature (slice 1 = backend).

## Summary

Adds the in-app surface for the clarified research brief: a "🧭 Clarify
research" button on the topic screen opens a modal to view/edit the brief
(goal, constraints, success criteria, audience) and request LLM-suggested
clarifying questions. The brief is persisted via the backend (slice 1) and is
already injected into the synthesis prompt, so setting it scopes the analysis.
This closes the command-registration triangle for the brief feature.

## Changes (committed)
- **CLI**: `research brief suggest --topic` (LLM clarifying questions, best-effort).
- **Rust (`commands.rs` + `main.rs`)**: `brief_get` / `brief_set` / `brief_suggest`
  Tauri commands (run_cli wrappers) + registration. `cargo check` clean.
- **api.js**: `briefGet` / `briefSet` / `briefSuggest` bindings.
- **topic.js + style.css**: "🧭 Clarify research" header button + `openClarifyModal`
  (4 fields prefilled from `briefGet`, "Suggest questions" via `briefSuggest`,
  Save via `briefSet`, Cancel/Esc/backdrop close). Frontend builds.

## Files Modified
- `src/gapmap/cli/main.py`, `app-tauri/src-tauri/src/{commands,main}.rs`,
  `app-tauri/src/api.js`, `app-tauri/src/screens/topic.js`, `app-tauri/src/style.css`

## Feature status
Clarified brief is now **complete end-to-end**: storage → synthesis-prompt
injection → CLI → MCP → in-app modal.
