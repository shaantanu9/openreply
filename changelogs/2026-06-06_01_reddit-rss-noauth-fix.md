# Fix Reddit search/collection — switch no-auth client from `.json` to RSS

**Date:** 2026-06-06
**Type:** Fix

## Summary

Reddit search stopped working in public (no-auth) mode: Reddit now returns
**`403 Blocked`** on every unauthenticated `www.reddit.com/*.json` request
(confirmed across `www`, `old`, search, and subreddit endpoints, with real
browser User-Agents — it is not an IP/User-Agent issue). However, Reddit still
serves its public **RSS** feeds (`/*.rss`) without auth or an API key. Rewrote
`core/public_client.py` to fetch RSS and parse it with `feedparser` (already a
dependency), restoring the free, no-OAuth Reddit path.

## Changes

- `core/public_client.py` rewritten to use RSS instead of `.json`:
  - `public_search` → `/search.rss` (+ `/r/<sub>/search.rss?restrict_sr=1`)
  - `public_get_posts` → `/r/<sub>/<sort>/.rss` (`top`/`controversial` add `t=`)
  - `public_get_comments` → `/comments/<id>/.rss`
  - `public_get_sub_comments` → `/r/<sub>/comments/.rss`
  - `public_get_user` → `/user/<name>/submitted|comments/.rss`
  - New `public_search_subreddits` helper (`type=sr`).
- Entry→row mapping via feedparser: id from `t3_<id>`/permalink, subreddit from
  `tags[0].term`/permalink, author from `/u/<name>`, created from
  `updated_parsed`, self-text from `content[0].value` (HTML stripped).
- Return-row shapes unchanged, so SQLite upserts / exporters / MCP tools are
  unaffected.

## Limitations (documented in the module)

- RSS exposes title/author/permalink/created/self-text/subreddit, but **not**
  score / upvote_ratio / num_comments (returned as `None`).
- ~25 items per search feed, up to ~100 per listing (no deep pagination).
- For score-aware / deep collection, connect Reddit OAuth (`openreply auth login`)
  → flips `config.mode` to "auth" (PRAW). Auth mode is unchanged.

## Verification

Live (no API key): `public_search('saas onboarding frustration')` → 6 posts;
sub-scoped search, `public_get_posts('SaaS', top, month)`, and
`public_get_sub_comments('startups')` all return real rows with correct
id/sub/author/title/body. `py_compile` clean; module imports clean.

## Files Modified

- `src/openreply/core/public_client.py` — RSS rewrite

## Files Created

- `changelogs/2026-06-06_01_reddit-rss-noauth-fix.md`
