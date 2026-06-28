# X (Twitter) publish adapter

**Date:** 2026-06-27
**Type:** Feature

## Summary

Added real outbound publishing to X (Twitter): a draft generated in Compose can
now be posted as a tweet or a native thread via the X API v2. This is the first
`publish/` adapter (mirror of the inbound `sources/` contract) and the reference
implementation for future LinkedIn/Threads/Bluesky adapters. Credential-gated
and opt-in — nothing posts without stored X API write credentials, and a
`--dry-run` previews the exact tweets first.

## Changes

- New `publish/` package: `base.py` (`PublishResult`) + `x.py` — splits a draft
  into ≤280-char tweets on blank lines (the engine's `N/M …` thread format),
  posts the first via `POST /2/tweets`, then replies down the chain to form a
  thread. OAuth 1.0a user-context auth via `requests_oauthlib`.
- New CLI group `openreply publish`: `set-creds` / `status` / `clear-creds` /
  `x --content-id <id> [--dry-run]`. On success flips the content_items row to
  `posted` and records the tweet URL. Registered in `cli/main.py`.
- Tauri bridge: `content_publish_x`, `publish_status`, `publish_set_x_creds`
  commands (commands.rs + main.rs) → `api.js` (`contentPublishX`,
  `publishStatus`, `publishSetXCreds`).
- Compose UI: a **𝕏 Publish** button on X/Twitter content cards (saves the edited
  text, then posts; surfaces a "connect X" hint when credentials are missing).
- Credentials stored locally in `source_credentials["x_publish"]`.
- Also: added `x/linkedin/threads/bluesky` to the active agent's platforms so
  those options appear in Compose/Keywords.

## Files Created

- `src/openreply/publish/__init__.py`, `src/openreply/publish/base.py`, `src/openreply/publish/x.py`
- `src/openreply/cli/publish_cmds.py`
- `docs/manual-todo/x-publishing-setup.md` — the one manual step (X API keys).

## Files Modified

- `src/openreply/cli/main.py` — register the `publish` group.
- `app-tauri/src-tauri/src/commands.rs`, `main.rs` — 3 publish commands.
- `app-tauri/src/or/api.js` — publish API methods.
- `app-tauri/src/or/dynamic.js` — Compose 𝕏 Publish button + handler.
