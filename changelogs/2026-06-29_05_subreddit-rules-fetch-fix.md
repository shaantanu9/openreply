# Fix subreddit rules fetch — switch from 403-blocked `.json` to old.reddit HTML

**Date:** 2026-06-29
**Type:** Fix

## Summary

Subreddit rules were never being fetched: `fetch_sub_rules` requested
`https://www.reddit.com/r/<sub>/about/rules.json`, which Reddit 403-blocks for
all unauthenticated clients (the same policy that blocks every `www.reddit.com/*.json`
request since 2025). The cookie + custom UA did not help — the connected session
still resolves as logged-out for the `.json` API. Every call silently returned
`{"rules": [], "error": "403 ..."}`, so the ban-proof compliance guardrail had no
rules to check against.

Fixed by reading the `old.reddit.com/r/<sub>/about/rules` HTML page instead, which
returns 200 unauthenticated and carries clean, structured `.subreddit-rule-item`
markup (`data-violation-reason`, `data-description`, `data-kind`). Rules are parsed
from those attributes. The `.json` endpoint is still attempted first as a best
effort (it succeeds if OAuth/PRAW is ever configured), then we fall back to HTML.

Verified live: r/ObsidianMD → 4 rules, r/Notion → 8 rules, r/productivity → 6 rules,
plus the cache read-back path.

## Changes

- `fetch_sub_rules()` now tries the `.json` endpoint, then falls back to scraping
  the old.reddit HTML rules page. Returns a real `error` only when both fail.
- Reuse `public_client._headers()` (rotating browser UA + `Sec-Fetch-*`) instead of
  the single hardcoded `_UA`, plus the connected Reddit cookie.
- New helpers: `_reddit_headers()`, `_parse_html_rules()` (regex over
  `.subreddit-rule-item` `data-*` attrs, `&#32;`→space + HTML-unescape),
  `_fetch_json_rules()`, `_fetch_html_rules()`.
- Empty-result responses now carry the underlying error instead of caching an
  empty rule set.

## Files Modified

- `src/openreply/reply/rules.py` — replaced the single 403-prone `.json` fetch
  with a JSON-then-HTML fallback; added old.reddit HTML parser and header helpers.
