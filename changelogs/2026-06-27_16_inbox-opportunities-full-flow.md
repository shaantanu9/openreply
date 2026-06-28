# Inbox + Opportunities — full reply workflow

**Date:** 2026-06-27
**Type:** Feature

## Summary

Built the complete discover → triage → draft → approve → post flow across both
OpenReply screens, closing all 8 gaps from the feature audit. **Opportunities**
is now a discovery triage queue (scan → score → Save/Skip/Snooze) and **Inbox**
is a reply workspace (Saved · Drafting · Ready · Posted tabs with a versioned
draft editor). The status lifecycle gained `snoozed`, `ready`, and `queued`
stages; drafts are now persisted, edited, and versioned (the previous textarea
evaporated on reload). Posting supports both manual-assisted (Copy + Open
thread + Mark posted) and Queue/schedule.

## Changes

- **Schema** (`reply/schema.py`): `reply_opportunities` += `snooze_until`,
  `updated_at`, `scheduled_at`, `posted_at`; `reply_drafts` += `version`,
  `source`, `updated_at` (+ `opportunity_id,version` index). Additive,
  forward-compatible `add_column` migration.
- **Engine** (`reply/opportunity.py`): expanded `OPPORTUNITY_STATUSES`;
  `snooze()`, `approve()`, `queue()`, `mark_posted()`; `_resurface_snoozed()`
  (snoozed → new when the window elapses); `list_opportunities()` gains
  `query`/`sort`/`offset`; `count_opportunities()` for pagination totals.
- **Drafts** (`reply/generate.py`): `save_draft()` persists user-edited replies
  as new versions (gap #1); `_persist_draft()` shared by generate/save;
  `_platform_compliance()` extends brand-safety to non-Reddit platforms (length/
  link/hashtag); `list_drafts()`/`current_draft()` for history.
- **CLI** (`cli/reply_cmds.py`): `save-draft`, `drafts`, `approve`, `queue`,
  `snooze`; `list` gains `--query/--sort/--offset` + `total`.
- **Tauri** (`commands.rs`, `main.rs`): `reply_save_draft`, `reply_drafts`,
  `reply_approve`, `reply_queue`, `reply_snooze`; `reply_list` gains
  query/sort/offset; all registered.
- **API** (`or/api.js`): `replySaveDraft/replyDrafts/replyApprove/replyQueue/
  replySnooze`; `replyList` accepts `{query,sort,offset}`.
- **Opportunities screen** (`or/dynamic.js renderOpportunities`): search, sort,
  min-score filter, New/Snoozed/Dismissed/All, Save/Skip/Snooze, bulk actions,
  Load-more pagination, skeleton/empty/error states.
- **Inbox screen** (`or/dynamic.js renderInbox`): Saved/Drafting/Ready/Posted
  tabs, lazy versioned draft editor, Approve, Queue (schedule), Copy + Open
  thread + Mark posted, compliance badge, draft-version history, search/sort/
  paginate/states.

## Files Created

- `docs/superpowers/specs/2026-06-27-inbox-opportunities-full-flow-design.md`
- `changelogs/2026-06-27_16_inbox-opportunities-full-flow.md`

## Files Modified

- `src/openreply/reply/schema.py`, `src/openreply/reply/opportunity.py`,
  `src/openreply/reply/generate.py`, `src/openreply/cli/reply_cmds.py`
- `app-tauri/src-tauri/src/commands.rs`, `app-tauri/src-tauri/src/main.rs`
- `app-tauri/src/or/api.js`, `app-tauri/src/or/dynamic.js`

## Verification

- Python: backend functions tested end-to-end via `.venv` (versioning, snooze
  resurface, search/sort/paginate, platform compliance) + CLI smoke test.
- Rust: `cargo check` 0 errors. Frontend: `vite build` clean.
