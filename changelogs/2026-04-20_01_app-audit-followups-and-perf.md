# App audit follow-ups + topic-open perf + session skill

**Date:** 2026-04-20
**Type:** Fix + Feature + Docs

## Summary

Consolidates the tail end of yesterday's session: sidecar-spawn perf on
topic-open, the full 14-screen audit + its critical fixes, and the
deferred polish items from that audit. Also ships the reusable skill
`~/.claude/skills/desktop-research-app-patterns/SKILL.md` so other
Tauri + Python research apps can adopt the same patterns without
re-discovering them.

## Changes

### Sidecar perf (commit `4836317`)
- `topic.js`: unified `topicStats()` — one `runQuery` with 9 aggregate
  columns instead of 3 separate calls. Every consumer awaits the same
  promise; cache invalidated after enrich.
- `topic.js::loadMap`: skips `buildGraph` + `exportHtml` when
  `n_nodes > 0 && n_edges > 0`. Rebuild button passes `force=true`.
- `commands.rs::export_html`: accepts `force: Option<bool>`. Fast path
  short-circuits if the output file already exists and is non-empty.
- `main.js`: fires `api.cliInfo()` right after `closeSplash()` as a
  fire-and-forget sidecar pre-warm. First user click hits a warm
  Python process (~500 ms) not cold (~2 min).

Net: repeat topic-open drops from 4-6 sidecar spawns to 1 (or 0 when
`topicStats` is already cached).

### Audit critical fixes (commit `6ac203e`)
- `activity.js`: WHERE-clause filters now use `:kind` / `:topic_like`
  parameter binds via `runQuery`'s params map. Quote-escaped string
  concat was fragile against backticks, comments, multi-byte tricks.
  LIMIT/OFFSET `| 0`-coerced to integers.
- `home.js::loadHeroAndStats`: `Promise.all` → `Promise.allSettled`
  so one slow endpoint can't blank the whole dashboard.
- `solutions.js`: re-run handler no longer `console.error`s into the
  void. Surfaces a user-facing empty-big with the error + guidance.
- Audit doc: `docs/superpowers/specs/2026-04-19-app-audit.md` — every
  screen, every section, status + findings + quick wins.

### Audit follow-ups (this commit)
- `search.js`: proper loading state (spinner + 10 s hint) during PRAW
  calls so users don't think the UI hung.
- `activity.js`: pager prev/next dedup — disables button on click and
  guards on `state.loading`. Spam-clicking no longer spawns
  concurrent queries.
- `topic.js::detectExistingSources`: per-topic 60 s cache. Source
  Picker modal re-opens for the same topic don't re-fire the SQL.
- `main.js`: nav-counts now wired to refresh on the
  `openreply:db-changed` event — no manual reload needed after external
  writes.
- `database.js`: SQL error message enriched with the offending token
  and line-number if parseable from sqlite's raw message, plus a
  read-only-console hint when the error mentions forbidden keywords.

### Audited items that turned out to be already-correct (skipped)
The initial audit flagged several items that were actually fine in
live code. Kept here for the record so we don't re-audit them:
- BYOK cache TTL — `invalidate('byok_status', 'list_provider_models')`
  runs before the `invoke()` promise returns, so the cache is clear
  for the next caller. No fix needed.
- `errorCard` wiring — all four call sites in `topic.js` call
  `wireErrorCard(contentEl, actions)` after rendering. Buttons work.
- Freshness poller visibility — `api.js::startFreshnessPoller::tick`
  already bails if `document.visibilityState !== 'visible'`.
- `find.js` "not ready" link — already a `<button id="find-goto-settings">`
  with a click handler at line 96. Not plain text.
- `search.js` loading state — already existed (plain "Searching…")
  but only upgraded to spinner + wait-time hint for clarity.
- `collect.js` retry CTA — `showRetryAction()` already fires on every
  error branch.

### Skill + audit doc
- `~/.claude/skills/desktop-research-app-patterns/SKILL.md` —
  battle-tested patterns from this session (canonicalization, query
  expansion, clustering, diff, schedule, perf). Reusable for other
  Tauri + Python research apps.
- `docs/superpowers/specs/2026-04-19-app-audit.md` — 14-screen audit
  with status snapshot, critical / perf / UX / polish buckets, quick
  wins, and priority ranking.

## Files Created

- `changelogs/2026-04-20_01_app-audit-followups-and-perf.md` (this file)
- `docs/superpowers/specs/2026-04-19-app-audit.md`
- `~/.claude/skills/desktop-research-app-patterns/SKILL.md` (global skill)

## Files Modified

- `app-tauri/src/screens/topic.js` — `topicStats()` + rebuild skip +
  `detectExistingSources` memoization.
- `app-tauri/src/screens/activity.js` — parameterized WHERE +
  pagination dedup.
- `app-tauri/src/screens/home.js` — `Promise.allSettled`.
- `app-tauri/src/screens/search.js` — spinner loading state.
- `app-tauri/src/screens/database.js` — SQL error context.
- `app-tauri/src/screens/solutions.js` — surfaced re-run errors.
- `app-tauri/src/api.js` — `exportHtml` accepts `force`.
- `app-tauri/src/main.js` — sidecar pre-warm + `refreshNavCounts` +
  `openreply:db-changed` hook.
- `app-tauri/src-tauri/src/commands.rs::export_html` — fast-path cache.

## Commits

- `4836317` perf(topic): instant topic-open (cut 4-5 sidecar spawns)
- `6ac203e` fix(audit): SQL-safe activity filters + dashboard
  partial-load + solutions error surface
- (this commit) fix(audit): deferred polish items
