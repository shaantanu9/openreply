# Reddit read-only OAuth — full JSON with just client_id + secret (2026 approach)

**Date:** 2026-06-06
**Type:** Feature | Fix

## Summary

Reddit's 2026 policy blocks all non-OAuth `.json` (403). The cleanest free path
is **application-only / read-only OAuth**: PRAW with `client_id + client_secret`
(no username, no browser, no refresh token) → 100 req/min, full JSON data.
Previously the code required a refresh token even to read, forcing either the
thin RSS path or a full browser OAuth dance. Now app credentials alone enable
auth mode (read-only); a refresh token upgrades to full user-scoped auth.

## Tiers

| Creds set | Mode | Data |
|---|---|---|
| none | `public` | RSS (thin: no score/comments, ~25/feed) |
| client_id + secret | `auth` (read-only) | **full JSON** — scores, comments, deep search, 100 req/min |
| + refresh_token | `auth` (full) | adds user-scoped actions |

## Changes

- `core/config.py`: new `has_reddit_app` (id+secret); `mode` returns `auth`
  when app creds present (read-only ok); `require_reddit` no longer demands a
  refresh token; clearer setup message.
- `core/client.py`: `get_reddit()` builds a **read-only** PRAW client
  (`read_only = True`, client_credentials grant) when no refresh token is set;
  full client when one is.

## How a user connects (no browser login)

1. https://www.reddit.com/prefs/apps → "create another app" → **script**.
2. Copy the **client_id** (under the app name) + **secret**.
3. Paste both in the app: **Settings → BYOK** (REDDIT_CLIENT_ID / SECRET).
   Reddit now returns full JSON (no refresh token / browser needed).

## Files Modified

- `src/openreply/core/config.py`, `src/openreply/core/client.py`

## Files Created

- `changelogs/2026-06-06_02_reddit-readonly-oauth.md`
