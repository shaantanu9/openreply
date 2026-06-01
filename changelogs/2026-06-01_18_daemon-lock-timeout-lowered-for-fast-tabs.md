# Fix: lower daemon lock timeout (3s/4s) — fast tabs under contention

**Date:** 2026-06-01
**Type:** Fix | Performance

## Summary

Tabs (Map and others) still felt slow to load even after the onedir sidecar
fix. Root cause: the daemon **lock-wait** ceiling was 10s (dev) / 20s (prod).
When a long LLM job that runs *through* the warm daemon (`build_graph`,
`enrich_graph`, `synthesize_insights`, audience/sentiment builds) holds the
lock, every other tab's sidecar read waited up to that ceiling before falling
back to a one-shot spawn — so opening another tab could hang ~20s.

That high ceiling existed only because, with the old **onefile** sidecar, a
one-shot fallback re-extracted ~390 MB to a `_MEI` temp dir (~36s + a
disk-filling storm) — so waiting for the daemon was the lesser evil. The
**onedir** migration removed that entirely (one-shot ≈ 1.3s warm, zero `_MEI`),
so the tradeoff flipped: fall back fast instead of waiting.

Lowered to **3s (dev) / 4s (prod)** — just above a warm round-trip plus margin
for a normal burst, so contended reads fall back to a cheap one-shot almost
immediately. Tabs stay responsive even while a long extraction holds the
daemon. Read-only screen queries were already native rusqlite (daemon-free), so
those were never the bottleneck — this targets the daemon-routed commands.

## Changes

- **`app-tauri/src-tauri/src/cli.rs`** — `DAEMON_LOCK_TIMEOUT_DEV_SECS` 10→3,
  `DAEMON_LOCK_TIMEOUT_PROD_SECS` 20→4; rewrote the rationale comment to
  reflect the post-onedir reality (the `_MEI` reaper is now a no-op safety net).

## Files Modified

- `app-tauri/src-tauri/src/cli.rs`

## Verification

- `cargo check` clean; release build + ad-hoc deep-sign + reinstall to
  `/Applications/Gap Map.app` (verified). Daemon + enrich-worker + MCP all
  spawn from the onedir launcher.

## Relationship to other changelogs

- `_10` (onefile→onedir) is what makes this safe: cheap one-shot fallbacks mean
  the high lock ceiling from `_09` (cold-storm mitigation) is no longer needed.
