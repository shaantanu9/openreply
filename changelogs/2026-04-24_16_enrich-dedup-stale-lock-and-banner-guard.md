# Enrich: self-healing inflight lock + Unstick UX + correct banner guard

**Date:** 2026-04-24
**Type:** Fix + UX

## Summary

Three intertwined bugs around the Map tab's enrich flow:

1. **"Already running" stuck forever** — `ActiveGraphOps` was a `HashSet<String>`. If a Python sidecar crashed between `set.insert(key)` and `set.remove(key)` (Ollama hang + user kills the dev server, panic mid-run, SIGKILL), the key stayed in memory until the Tauri process restarted, so every subsequent Enrich click returned `already_running` with no recovery path.

2. **Misleading cross-source banner on empty topics** — the Map tab showed `⚠ Multi-source data found (N sources) but cross-source finding links are not built yet. Run Enrich then Rebuild…` on topics that had ≥2 sources but zero painpoints/feature_wishes. The guidance is nonsensical — you can't "connect findings across sources" when there are zero findings yet. That state is already covered by the auto-enrich banner; the cross-source banner was doubling up confusingly.

3. **No escape hatch** — nothing in the UI let the user forcibly clear the lock or inspect its age.

## Changes

### Rust — `app-tauri/src-tauri/src/cli.rs`

- `ActiveGraphOps` upgraded from `HashSet<String>` to `HashMap<String, Instant>`. Each key now records when it was inserted.

### Rust — `app-tauri/src-tauri/src/commands.rs`

- `run_graph_op_deduped` now auto-expires stale locks (`GRAPH_OP_STALE_AFTER = 600s`). If a key exists but is older than 10 min, it's assumed orphaned and reclaimed. The `already_running` response now also returns `age_seconds` + `auto_clears_in_seconds` so the UI can tell the user when to retry.
- New Tauri command `clear_graph_inflight(topic?, op?)` — force-clears the registry. Filter by topic / op / both / neither; returns the list of cleared keys.

### Rust — `app-tauri/src-tauri/src/main.rs`

- Registered `commands::clear_graph_inflight` in the `generate_handler!` list.

### JS — `app-tauri/src/api.js`

- New `api.clearGraphInflight(topic?, op?)` wrapper.

### JS — `app-tauri/src/screens/topic.js`

- **Cross-source banner** now gated on `findingsAfter > 0` (falls back to `findingsBefore` mid-render). When findings=0, the banner is suppressed; the user sees the already-present auto-enrich banner instead of two conflicting warnings.
- **`runEnrichFromMap()` on `already_running`** now shows a `confirm()` dialog: "If it's stuck, click OK to force-clear and retry; Cancel to wait." OK path calls `api.clearGraphInflight(topic, 'enrich')` then recursively re-calls itself. Cancel path shows a calmer toast noting the 10-min auto-clear.

## Files Modified

- `app-tauri/src-tauri/src/cli.rs` — HashSet → HashMap with Instant value.
- `app-tauri/src-tauri/src/commands.rs` — stale-lock expiry + `clear_graph_inflight` command.
- `app-tauri/src-tauri/src/main.rs` — register new command.
- `app-tauri/src/api.js` — `clearGraphInflight` wrapper.
- `app-tauri/src/screens/topic.js` — banner guard + Unstick prompt.

## Verification

- `cargo check` in `app-tauri/src-tauri` — clean (only the known `JWT_DESKTOP_SECRET missing` warning from the debug fallback path).
- `node --input-type=module -e "import('./src/screens/topic.js')"` and `import('./src/api.js')` — both pass.
- DB confirms the premise: topics with `≥2 sources AND 0 findings` existed (e.g. `public speaking anxiety app` has 12 sources but 0 findings, so the old banner was showing on every such topic).

## Behavior Change Users Will See

- Banner disappears on empty topics; only the enrich-in-progress banner remains.
- Clicking Enrich on a topic whose previous run is stuck → confirm dialog → instant recovery.
- Normal enrich path is unchanged (the new stale-lock logic only fires when an entry is >10 min old).
