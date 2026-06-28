# CI: opt JavaScript actions into Node 24 + re-tag v0.1.3 to land the publish-public fix

**Date:** 2026-05-28
**Type:** Infrastructure

## Summary

Two follow-ups to the v0.1.3 release that failed in the `publish-public` step.

1. **`ci.yml` was the last workflow still missing the `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: 'true'` opt-in.** Every CI run on `main` / `multi-source` was therefore emitting "Node.js 20 actions are deprecated" warnings for `actions/checkout@v4`, `actions/setup-node@v4`, and `actions/setup-python@v5`. The release workflows (`release.yml`, `release-mac.yml`, `release-windows.yml`, `release-linux.yml`) already had the env var at workflow scope; only `ci.yml` was missing it.

2. **The `v0.1.3` tag pointed at the broken commit (`3b568d1`).** That snapshot of `release.yml` had the relative-path `../../Gap.Map_${NUM}_${arch}.zip` zip target, which resolves to `/` on Linux runners (mktemp -d returns `/tmp/xyz`, so two `..` segments resolves to the filesystem root) — hence the `zip I/O error: Permission denied → exit 15` in the `publish-public` job. The fix (commit `2d4b39a`, `DEST="$PUB_DIR/Gap.Map_..."`) and the per-platform split (`c217f88`) both landed after the tag was created, so re-running the failed job kept re-using the broken snapshot. The tag has been moved to the current HEAD so the next push triggers `release-mac.yml` / `release-windows.yml` / `release-linux.yml` with the absolute-path fix already in place.

## Changes

- Add `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: 'true'` at workflow scope in `.github/workflows/ci.yml` so every job (`python-check`, `rust-check`, `js-check`) inherits it.
- Delete the local + remote `v0.1.3` tag and recreate it at the current HEAD of `multi-source`, which contains both the `publish-public` absolute-path fix and the per-platform workflow split.

## Files Modified

- `.github/workflows/ci.yml` — workflow-level `env:` block added.

## Files Created

- `changelogs/2026-05-28_12_ci-node24-optin-and-retag-v0.1.3.md` — this file.

## Verification

After pushing the retagged `v0.1.3`:

- `release-mac.yml`, `release-windows.yml`, `release-linux.yml` trigger fresh on the tag.
- `publish-public` step in each per-platform workflow rezips into `$PUB_DIR/Gap.Map_0.1.3_<arch>.zip` (absolute path) — no more `../..` permission denied.
- Next `ci` run on `multi-source` or any PR no longer shows the Node 20 deprecation warning.
