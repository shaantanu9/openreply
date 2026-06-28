# Subreddit Intelligence — complete feature

**Date:** 2026-06-27
**Type:** Feature

## Summary

Shipped the full Subreddit Intelligence feature for OpenReply agents — an
end-to-end "know the rules before you post" workflow. An agent can discover
relevant subreddits, pull per-sub intel (members, rules, self-promo policy,
strictness, best posting time), track/untrack subs, check account-posting
safety, and validate a draft reply against a sub's rules before posting. Wired
from the Python engine through the CLI, the Tauri Rust command layer, the JS
API wrappers, and a full dynamic screen renderer. Backend verified via CLI;
Rust layer compiles clean (`cargo check` finished). Live stats/rules require a
connected Reddit cookie (Connections) — the feature degrades gracefully when
anonymous.

## Changes

- New engine `reply/subreddit.py`: `account_status`, `discover_for_agent`
  (reuses `research.discover.discover_subs`), `intel` (stats + rules + derived
  self_promo/strictness/best_time), `list_tracked`, `track`/untrack,
  `check_draft` (reuses `rules.check_compliance`). New table `reply_subreddits`
  PK `(agent_id, sub)`.
- CLI: `account-status`, `sub-discover --limit`, `sub-list`, `sub-intel --sub
  --refresh`, `sub-track --sub [--off]`, `sub-check --sub --text` (all `--json`).
- Tauri commands: `reddit_account_status`, `sub_discover`, `sub_list`,
  `sub_intel`, `sub_track`, `sub_check` (registered in `generate_handler!`).
- JS API wrappers + `renderSubredditFull` dynamic screen: account-safety card,
  Discover button, check-a-subreddit → intel display (members/self-promo/
  strictness/best-time + rules + Track toggle + draft compliance check),
  "Your subreddits" tracked list. DYN `subreddit` key points to the full
  renderer.
- Persistence verified (track → list shows tracked); `cargo check` clean.

## Files Created

- `src/openreply/reply/subreddit.py`
- `changelogs/2026-06-27_17_subreddit-intelligence.md`

## Files Modified

- `src/openreply/reply/__init__.py` — export `subreddit`
- `src/openreply/cli/reply_cmds.py` — 6 subreddit CLI commands
- `app-tauri/src-tauri/src/commands.rs` — 6 Rust commands
- `app-tauri/src-tauri/src/main.rs` — register the 6 commands
- `app-tauri/src/or/api.js` — `redditAccountStatus` + `sub*` wrappers
- `app-tauri/src/or/dynamic.js` — `renderSubredditFull` + DYN wiring
