# Proper Content Engine — YouTube long-form, Follow-ups, editable drafts

**Date:** 2026-06-27
**Type:** Feature

## Summary

Made OpenReply content generation real and properly structured. The Compose
screen previously revealed a hardcoded textarea; it now generates genuine,
per-type-structured content from the agent's blended knowledge and saves
editable, schedulable drafts. Added two new content families — **YouTube
long-form scripts** and **Follow-ups** (reply-to-reply + sequence/part-2) — and
gave every kind a distinct structured template plus platform-aware length.

## Changes

- `content.py`: rewrote `_KIND_SPECS` into structured per-kind instruction
  blocks; added kinds `youtube`, `followup_reply`, `followup_post`; added
  per-platform hints (`_PLATFORM_HINTS`) and dynamic token budgets
  (`_KIND_TOKENS`).
- `generate_content`: added `context_id` / `context_text` params, follow-up
  context assembly (`_load_original`), `parent_id` persistence, and
  platform-hint injection.
- Added `update_content(id, body?, status?, scheduled_at?)` for
  edit / save / schedule; added a guarded `parent_id` ALTER migration in
  `_ensure` so existing DBs upgrade in place.
- CLI `agent_cmds.py`: `content generate` gains `--context-id` / `--context-text`;
  new `content update` command; refreshed help/kind docs.
- Rust `commands.rs`: extended `content_generate` with context passthrough;
  added `content_update` command. Registered `content_update` in `main.rs`.
- Frontend `api.js`: `contentGenerate(kind, platform, angle, ctx)` +
  `contentUpdate(id, fields)`.
- Frontend `dynamic.js` (Compose): new kind buttons (Short script, YouTube,
  Follow-up); Follow-up context panel with Reply/Sequence sub-toggle (paste
  conversation or pick an original draft); real generate with loading state;
  editable cards with Save draft / Schedule wired to `contentUpdate`; cleaner
  kind labels in Queue.

## Files Created

- `docs/superpowers/specs/2026-06-27-openreply-content-engine-design.md`
- `changelogs/2026-06-27_14_content-engine-youtube-followups.md`

## Files Modified

- `src/openreply/reply/content.py` — new kinds, context, platform hints, update_content, parent_id migration
- `src/openreply/cli/agent_cmds.py` — context options + `content update` command
- `app-tauri/src-tauri/src/commands.rs` — context passthrough + `content_update`
- `app-tauri/src-tauri/src/main.rs` — registered `content_update`
- `app-tauri/src/or/api.js` — `contentGenerate` ctx arg + `contentUpdate`
- `app-tauri/src/or/dynamic.js` — Compose: new kinds, follow-up panel, editable/schedulable cards

## Verification

- Python guards tested (unknown kind, follow-up missing context, bad status).
- CLI `--help` confirms new options/commands.
- `cargo check` — 0 errors (with temp placeholder for the pre-existing
  `openreply-cli-onedir` bundle-resource glob).
- `node --check` clean on `dynamic.js` and `api.js`.
