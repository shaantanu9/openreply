# Launch audit + future-scope TODOs for deferred secrets

**Date:** 2026-05-17
**Type:** Documentation

## Summary

Pre-launch functional audit of the app ahead of the v0.1.0 unsigned-beta
release. Result: the app is functionally sound — `reddit-cli health` reports
DB / Palace-ONNX / LLM all OK, and the full test suite passes (92 passed,
2 skipped, 0 failed). The 25 🟡 features in `FEATURES.md` are partial-but-
working (UI polish / not-yet-surfaced-in-MCP), not breakage — 0 ❌, 0 🚧.

Documented the deliberately-deferred launch items (Apple Developer ID cert,
`JWT_DESKTOP_SECRET` in GitHub Secrets, auto-update) as future scope, per the
manual-TODO rule, and refreshed the `FEATURES.md` known-gaps rollup now that
the sidecar binary is gitignored (so `release.yml` rebuilds it fresh — the
"Apr-21 stale binary" P0 no longer applies).

## Changes

- Audited the app: `health` diagnostics green, full pytest suite green.
- Created `docs/manual-todo/future-scope-signing-and-secrets.md` — what each
  deferred item is, why it was deferred for the unsigned beta, what is degraded
  without it, the exact changes to enable it, and the upgrade path to a
  signed 1.0.
- Created `docs/manual-todo/README.md` — the manual-TODO index (was missing).
- Updated `FEATURES.md` known-gaps rollup: sidecar-staleness P0 marked resolved
  (gitignored + CI-rebuilt); cert / JWT secret / auto-update reclassified from
  P0/P1 to **deferred** with a pointer to the new future-scope doc.

## Files Created

- `docs/manual-todo/future-scope-signing-and-secrets.md`
- `docs/manual-todo/README.md`
- `changelogs/2026-05-17_07_launch-audit-and-future-scope-todos.md`

## Files Modified

- `FEATURES.md` — known-gaps rollup + category 15 known-gaps refreshed
