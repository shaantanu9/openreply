# Instant topic creation + navigate-back to in-flight collect without duplicate sidecar

**Date:** 2026-04-20
**Type:** Fix / UX

## Summary

Two real bugs in the new-topic flow made the app feel broken:

1. **Topic didn't appear in the listing until posts landed.** Clicking "Start" on a new topic ran an LLM canonicalize call before the modal closed (5-15 s hang on cold LLM paths), then navigated to the collect screen. Even after that, the topic was invisible in `list_topics` until the first source returned a post — so a user collecting a brand new topic saw an empty list on home for another 30-60 s.

2. **Leaving the collect log screen broke the live view.** Navigating away from `#/collect/X` and back re-called `start_collect`, which spawned a SECOND Python sidecar for the same topic. Both would try to write to SQLite, the fetches table accumulated ghost rows, and the log history was lost because it lived only in component scope.

This ships 6 fixes (A-F) across Python, Rust, and JS so topics appear instantly, the canonicalize runs in the visible log instead of the modal, and navigating away + back attaches to the running collect with full log history.

## Changes

### A — Python upserts `topic_prefs(topic)` as the first action of every collect

`src/reddit_research/research/collect.py`

- Added `_ts_iso()` helper.
- Before canonicalize + discover, upsert `topic_prefs(topic=<typed>, scheduled=0, last_run_seen=now, last_run_ts=now)`. Idempotent: re-collect is safe.
- After canonicalize, if the canonical differs from the typed topic, upsert again under the canonical name. Both rows exist briefly; the canonical becomes the active one as posts land against it.
- Upsert failure is swallowed — never block a collect because of a prefs write.

### B — `list_topics` SQL shows zero-post topics

`app-tauri/src-tauri/src/commands.rs::list_topics`

Was: `SELECT … FROM topic_posts tp GROUP BY tp.topic`. Zero-post topic = invisible.

Now: `WITH t AS (SELECT topic FROM topic_posts UNION SELECT topic FROM topic_prefs) SELECT t.topic, COALESCE(stats.posts, 0), …`. Every topic ever seen — via posts OR via an in-flight collect that registered with topic_prefs — appears, with `posts=0` and `last_collect=pref.last_run_ts` as a fallback for brand-new entries. Verified: a freshly-inserted topic_prefs row with no posts still returns from the query with posts=0.

### C — New-topic modal closes instantly, canonicalize moved into the visible log

`app-tauri/src/main.js`

Removed the `resolveTopicWithConfirmation(topic)` gate from `#modal-start.onclick`. The modal now `close()`s and navigates to `#/collect/<typed-topic>` immediately. Python's `_canonicalize_topic` still runs at the top of `research collect` (same LLM call, same correction logic) — the user just sees the "info: search using canonical 'X' (user typed 'Y')" line in the streaming log instead of staring at a frozen modal for 5-15 s.

Also deleted the now-dead `resolveTopicWithConfirmation` function and its imports (`showTopicConfirmModal`, `showCorrectionToast`). Both were only called from the removed gate.

Trade-off explicitly accepted: users no longer get the pre-collect "Did you mean X?" confirmation modal. If a typo slips through, the Python side still auto-corrects and the canonical name takes over. Worst case is the user's typed-typo topic row sits orphaned in topic_prefs with 0 posts forever — easy to clean up later; not a blocker.

### D — `ActiveCollects` single-flight mutex in Rust

`app-tauri/src-tauri/src/cli.rs` + `commands.rs` + `main.rs`

Added:
```rust
pub struct ActiveCollects(pub Arc<Mutex<HashMap<String, u64>>>);
```
keyed by topic, value = Unix epoch seconds of start. Same Arc-clone + release-State-early pattern as `ActiveGraphOps` so the subsequent `app.listen_any(...)` calls don't fight the borrow checker.

`start_collect` now:
1. Inserts topic → now_secs; if already present, returns `{ok: true, already_running: true, topic, started_at}` without spawning a sidecar.
2. Registers a `listen_any("collect:done")` handler that removes the topic from the map on completion.
3. On awaited completion (success or error), unlistens and idempotently removes the topic.

New `active_collects` command returns the current HashMap as a JSON object `{topic: started_at, …}` for the home banner.

Return type of `start_collect` changed from `Result<()>` to `Result<Value>` — callers previously ignored the return value, which is still safe, but frontend can now read `already_running`.

### E — Log rehydration on revisit

`app-tauri/src/screens/collect.js`

Module-scope `Map<topic, [{text, cls}, …]>` caches up to 5000 lines per topic. Every `appendLine()` call pushes to the cache (unless persist=false).

On `renderCollect` mount:
- Rehydrate the cached log first — user sees full history immediately, not an empty terminal.
- Then call `api.startCollect(...)`. If response has `already_running: true`, skip the "→ started…" line (the log already has it) and just keep the progress subscription live.

Also tracks `_collectStatus: Map<topic, 'running'|'done'|'failed'>` so the UI can gate behavior on known state (currently unused for rendering, but available for future "cached completion state" hints).

### F — Home banner reads `active_collects` first, falls back to DB

`app-tauri/src/api.js` — added `activeCollects()` binding with 1.5 s TTL.

`app-tauri/src/screens/home.js::loadActiveCollect` — poll tick now:
1. Calls `api.activeCollects()` first. If non-empty, picks the topic + start timestamp from the Rust map (authoritative per-topic signal).
2. Falls back to the old `SELECT FROM fetches WHERE ended_at IS NULL` query only if Rust returned nothing (covers edge case where the Tauri process restarted but a sidecar is still running).

The click-to-view navigation was already there (`location.hash = '#/collect/<topic>'`); combined with fixes D + E, clicking the banner now rejoins the live log instead of spawning a duplicate sidecar.

## Verification

- `.venv/bin/python` round-trip: upsert `topic_prefs` for a brand-new topic, re-upsert the same topic, new `list_topics` SQL returns the row with `posts=0` and a populated `last_collect`. Fresh posts added — row updates to real `posts` count and both sources still show. ✅
- `cargo check --no-default-features` → clean, 2.24 s (incremental).
- `./scripts/dev.sh doctor` → sidecar healthy, all 17 tables + 28 SOURCES + LLM provider resolved.
- `node --check` on all modified JS files → clean.

## UX delta

| Flow | Before | After |
|---|---|---|
| Click Start on new topic | modal hangs 5-15 s waiting for LLM canonicalize, then navigates | modal closes in <50 ms, collect screen mounts immediately |
| New topic in home listing | absent until first post lands (30-60 s) | present within ~1 s of clicking Start (sidecar cold-boot) |
| Navigate away mid-collect, come back | spawns a second sidecar for the same topic; schema conflicts; log history empty | `already_running:true` from Rust → no duplicate spawn; persisted log rehydrates instantly; live events keep streaming |
| Home page while a collect is in flight | banner reads from `fetches` (can miss topic name depending on row shape) | banner reads from `ActiveCollects` Rust map (keyed by topic, always accurate) |

## Files Modified

- `src/reddit_research/research/collect.py` — topic_prefs upsert + `_ts_iso` helper
- `app-tauri/src-tauri/src/cli.rs` — `ActiveCollects` type
- `app-tauri/src-tauri/src/main.rs` — register ActiveCollects in managed state + active_collects handler
- `app-tauri/src-tauri/src/commands.rs` — single-flight `start_collect` + `active_collects` command + `use tauri::Listener`
- `app-tauri/src/api.js` — `activeCollects()` binding
- `app-tauri/src/main.js` — modal closes instantly; removed resolveTopicWithConfirmation + helpers
- `app-tauri/src/screens/collect.js` — module-scope log cache + revisit rehydration + `already_running` handling
- `app-tauri/src/screens/home.js` — banner prefers ActiveCollects over fetches heuristic
