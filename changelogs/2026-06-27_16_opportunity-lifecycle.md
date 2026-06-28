# Opportunities — complete the lifecycle (save / dismiss / mark-replied)

**Date:** 2026-06-27
**Type:** Feature + Fix

## Summary

The Opportunities section could find, score, and draft replies, but its status
lifecycle was half-built: `generate_reply` flipped an opportunity to `drafted`, yet
there was **no way to save, dismiss, or mark-replied**. As a result the Inbox and the
"Show saved" view were permanently empty, dismissed/irrelevant opportunities couldn't
be hidden, and Analytics counts (Saved/Replied) never moved. This change completes the
lifecycle end-to-end and makes those three screens functional. It also gives social
platforms (now that social fetch is wired) their own card tint.

## Changes

- **Backend lifecycle** (`reply/opportunity.py`): added `set_status(id, status)` with a
  validated `OPPORTUNITY_STATUSES = (new, saved, drafted, posted, skipped)` vocabulary;
  returns the updated row or a graceful `{"error": …}` (never raises).
- **CLI** (`cli/reply_cmds.py`): `openreply reply set-status -o <id> --status <s>`.
- **Rust + JS bridge**: `reply_set_status` command (`commands.rs` + `main.rs` register) and
  `api.replySetStatus()` (`or/api.js`).
- **Opportunities UI** (`or/dynamic.js::renderOpportunities`):
  - Per-card lifecycle actions — **☆ Save · Draft reply · ✓ Replied · ✕ Dismiss** — plus a
    live **status pill** on every card.
  - **Status filter chips** — Active (default; hides dismissed) · New · Saved · Drafted ·
    Replied · Dismissed — replacing the old single misleading "Show saved" button (which
    actually showed everything).
  - **Social platform badges** — X, TikTok, Instagram, Threads, YouTube, Bluesky, Mastodon,
    Pinterest, TruthSocial each get a distinct tint (shared `platformBadge()` helper).
  - "Mark replied" also surfaces inline under a freshly generated draft.
- **Inbox** (`renderInbox`): now genuinely the `status=saved` view (was showing all
  opportunities), reuses the Opportunities card + a shared `inboxAction` lifecycle handler
  so Save/Draft/Replied/Dismiss behave identically.
- **Analytics** (`renderAnalytics`): KPIs reworked into a real funnel —
  Opportunities → Saved → Drafted → Replied (+ Dismissed and content counts) — and an
  "Opportunities by status" breakdown; these now populate because the lifecycle works.

## Verification

- `reply/opportunity.py` + `cli/reply_cmds.py` parse · CLI `reply set-status` returns clean
  JSON for a bad id and an invalid status (validation lists the allowed values) · positive
  round-trip (insert → save → appears in saved list → dismiss → hidden from active).
- `vite build` passes (184 KB) · `cargo check` 0 errors.

## Files Modified

- `src/openreply/reply/opportunity.py` — `set_status` + status vocabulary.
- `src/openreply/cli/reply_cmds.py` — `reply set-status` command.
- `app-tauri/src-tauri/src/commands.rs`, `main.rs` — `reply_set_status` command + register.
- `app-tauri/src/or/api.js` — `replySetStatus` wrapper.
- `app-tauri/src/or/dynamic.js` — Opportunities lifecycle actions + filters + badges; Inbox
  saved-only + shared lifecycle handler; Analytics funnel KPIs.

## Follow-up

- **Prod sidecar rebuild** before a DMG so the new `reply set-status` CLI ships (dev `.venv`
  picks it up immediately).
