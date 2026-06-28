# Sentiment tab: real per-source progress while LLM crunches

**Date:** 2026-05-28
**Type:** UX Fix

## Summary

The Sentiment tab felt broken: the user clicked it, saw a single "Analyzing…" placeholder (later upgraded to a cosmetic spinner + cycling stages + asymptotic progress bar), and stared at the same screen for 30–90 seconds while the LLM looped through every source. Nothing real moved — the existing UX dressed up the wait but couldn't show actual progress because all per-source results came back in a single blocking `runSentimentBySource` payload at the end. Adjacent tabs that need an LLM call (audience-build, concepts) also queued behind sentiment because every `run_cli` invocation serializes through one tokio Mutex around the Python daemon (`app-tauri/src-tauri/src/cli.rs:249`). Tabs that only read SQLite via `run_query` were unaffected — that path goes directly to rusqlite in Rust without touching the daemon (`commands.rs:4145`).

Critical observation that unlocked the fix: the Python `sentiment_for_topic` loop already persists each source's row to `graph_nodes` (kind='source_sentiment') as soon as that source's LLM call returns (`sentiment_by_source.py:215`). So the daemon mutex is held for the entire run, but the rows land **incrementally**. The frontend can poll `run_query` (daemon-free) every ~1.5s and surface cards the instant they appear — real progress, no streaming protocol changes needed in Rust or Python.

## Changes

- Added `countSourcesForTopic(topic)` — daemon-free count of distinct source types for the topic so the "X of N sources analyzed" counter is meaningful from the first poll.
- Added `startLiveSentimentPolling(contentEl, topic, totalSources)` — kicks off a 1.5s polling loop that replaces skeleton cards with real cards as they're persisted, and updates the per-source counter in the hero meta row. Returns a `stop()` function the caller MUST invoke.
- Updated `runAndRender` to start the polling loop in parallel with the LLM kickoff. The "Analyzing…" hero stays for the cosmetic stages + progress bar; the skeleton grid below now fills in with real per-source cards as they land. On completion, polling and the cosmetic loader both shut down cleanly and the final `loadSentiment` render takes over.
- Updated the "in another tab is running it" branch of `loadSentiment` to also surface live progress (it previously just showed the static hero and waited).

## Files Modified

- `app-tauri/src/screens/sentiment.js` — added `countSourcesForTopic` + `startLiveSentimentPolling`, integrated into both `runAndRender` and the `_sentimentRunning` cross-tab path.

## Follow-ups (not in this changeset)

- The daemon mutex (`cli.rs:249`) still serializes every `run_cli` call. So while sentiment holds it, audience-build / concepts / any other LLM-heavy command stays queued. Worth either (a) adding a `tokio::time::timeout` on the lock acquire so a quick UI query falls back to a one-shot Python spawn after ~3s of contention, or (b) running long LLM jobs via the existing `run_cli_streaming` path so they spawn their own process and never touch the daemon. Out of scope for this fix — sentiment alone is the most-visible offender and now feels alive.
- Apply the same "kick LLM job + poll SQLite for incremental DB writes" pattern to any other tab whose Python implementation already writes rows progressively (audience clustering, intent-ladder, concepts) — same library trick, no backend changes needed.
