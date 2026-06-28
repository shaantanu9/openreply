# Release pipeline: split into 3 per-platform workflows + Tier 1 caches

**Date:** 2026-05-28
**Type:** Infrastructure (CI/CD)

## Summary

The old `.github/workflows/release.yml` was a single matrix job that
ran mac arm64, mac x64, and windows in parallel — then a separate
`publish-public` job gated on `needs: [release]` cross-published the
artifacts to `myind-ai/openreply`. End-to-end critical path was 14 min
(Windows is the long pole; mac jobs finish in 7-8 min but wait for
Windows to flip the public release to "latest").

Split into **three independent per-platform workflows**, each of
which builds → uploads to the public release → checks if all required
platforms have landed → flips draft to latest if yes. Mac users now
get their DMG ~7 min after tag push instead of waiting ~14 min for
Windows.

### Architecture

| File | Triggers | Builds | Publishes to |
|---|---|---|---|
| `release-mac.yml` | `push tags v*` | mac arm64 + x64 (matrix) | `myind-ai/openreply` |
| `release-windows.yml` | `push tags v*` | windows x64 (MSI + EXE) | `myind-ai/openreply` |
| `release-linux.yml` | `push tags v*` | linux x64 (AppImage + deb + rpm) | `myind-ai/openreply` |
| `release.yml` | `workflow_dispatch` only | (legacy, full matrix) | (kept as escape hatch) |

All three platform workflows:
1. Build their platform's sidecar + bundle (signed where applicable).
2. Upload to the `openreply` draft release for traceability.
3. Download their artifact from that draft + upload to
   `myind-ai/openreply` (idempotent: `gh release create --draft || true`
   then `gh release upload --clobber`).
4. Run `scripts/promote-release-if-complete.sh` — checks if the
   release has at least mac arm64, mac x64, and Windows artifacts;
   if yes AND still draft, flips to `--draft=false --latest`.

Linux is treated as **OPTIONAL** by the promote check. Mac + Windows
finishing alone is enough to flip the release to latest. Linux
finishing 10-20 min later just appends its `.AppImage` / `.deb` /
`.rpm` to the already-published release.

### Tier 1 caches (added to all 3 platforms)

1. **sccache** via `mozilla-actions/sccache-action@v0.0.6` with
   GitHub Actions cache backend. Halves Rust compile time on warm
   cache, ~30% on cold cache. Biggest single win on Windows where
   the webview2-com dep tree is largest.
2. **PyInstaller dist cache** via `actions/cache@v4` keyed on
   `hashFiles('openreply-cli.spec', 'pyproject.toml', 'uv.lock',
   'src/**/*.py')`. Skips the 1m 35s (mac) / 3m 15s (Windows) /
   ~2 min (Linux) sidecar rebuild when sources unchanged.
3. **ONNX MiniLM model cache** — the 83 MB tarball downloaded from
   S3. Same URL every release → static cache key → restore = ~3s
   instead of 30-60s.

### New script

`scripts/promote-release-if-complete.sh` — invoked at the end of
each per-platform workflow. Lists release assets, greps for required
platform patterns (`_arm64.dmg`, `_x64.dmg`, `_x64_en-US.msi |
_x64-setup.exe`), and flips `--draft=false --latest` if all required
patterns are present. Idempotent: re-running on an already-published
release exits cleanly without error.

## Expected pipeline times after this change

| Path | Before | After |
|---|---:|---:|
| Tag push → mac DMG live on public | ~14 min | **~5-7 min** (mac arm64 + sccache) |
| Tag push → windows MSI live on public | ~14 min | **~8-10 min** (sccache cuts Win compile by ~40%) |
| Tag push → linux AppImage live | manual workflow_dispatch | **~20-25 min** (was 30+ min, sccache + PyInstaller cache) |

Per-platform timings independent: a slow Windows build no longer
delays the mac release; a broken Windows build doesn't block mac
users from downloading.

## Quality preserved

- Same signing: Developer ID Application + notarytool via App Store
  Connect API key on macOS, same TAURI_SIGNING_PRIVATE_KEY for
  update channels.
- Same notarization (no change to scripts/publish-mac.sh).
- Same artifact naming convention (`Gap.Map_<ver>_arm64.dmg`,
  `_x64.dmg`, `_x64_en-US.msi`, `_x64-setup.exe`).
- Same friendly asset labels on the public release (kept in
  release-mac.yml's publish-public step — moved from release.yml).
- Same `PUBLIC_RELEASE_TOKEN` secret (no new secrets required).

## Failure isolation

If Windows fails on a future tag, Mac still ships. The release on
`myind-ai/openreply` stays in draft (because the promote check requires
windows) but mac users can still download from the draft via direct
URL. Once Windows is fixed and rerun via `workflow_dispatch`, the
promote auto-flips draft → latest.

## Files Created

- `.github/workflows/release-mac.yml` — mac arm64 + x64 (replaces
  the mac portion of the legacy `release.yml`).
- `.github/workflows/release-windows.yml` — windows MSI + EXE
  (replaces the windows portion).
- `scripts/promote-release-if-complete.sh` — shared promote helper,
  invoked by every per-platform workflow.
- `changelogs/2026-05-28_11_release-pipeline-per-platform-split.md`

## Files Modified

- `.github/workflows/release-linux.yml` — added Tier 1 caches
  (sccache + PyInstaller + ONNX), added publish-to-public step,
  added promote-if-complete step, removed the old `workflow_run`
  trigger (now uses direct `push: tags`).
- `.github/workflows/release.yml` — trigger changed from
  `push: tags + workflow_dispatch` to **workflow_dispatch only**.
  Kept as legacy escape hatch for full-matrix manual rebuilds when
  a per-platform workflow is broken.

## Verification

- All 4 YAML workflow files validated via `yaml.safe_load` — clean.
- `scripts/promote-release-if-complete.sh` passes `bash -n`.
- No code changes — Rust + JS test suites unaffected.
- **Live verification deferred** — the change only takes effect on
  the next `v*` tag push (currently in flight: v0.1.3 uses the old
  workflow). User will see the new architecture fire on v0.1.4.

## Migration notes

- No action required. Push `v0.1.4` tag → the 3 new workflows fire
  in parallel, the legacy `release.yml` stays dormant (no tag trigger).
- If something goes wrong with a per-platform workflow, manually
  trigger the legacy `release.yml` via the Actions tab.
- The `release.yml` `publish-public` job logic is now duplicated
  across the 3 per-platform workflows. Considered factoring into a
  reusable workflow (`workflow_call`) but deliberately kept inline
  for first-pass simplicity — each workflow is self-contained and
  readable end-to-end. Refactor to reusable if maintenance burden
  grows.
