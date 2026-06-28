# CI/Release: self-host macOS, disable Linux/Windows auto-builds

**Date:** 2026-06-07
**Type:** Infrastructure

## Summary

GitHub Actions was failing on every run with "recent account payments have
failed or your spending limit needs to be increased" — an account-level billing
block, not a code issue. To stop paying for GitHub-hosted runners (macOS is
billed at a 10× minute multiplier), the pipeline was restructured so all macOS
work runs on a **self-hosted runner on the developer's Mac** (free, private),
while the Linux and Windows release builds — which can only run on GitHub-hosted
runners — are demoted to **manual trigger only**. They are run on demand during
a release by temporarily making the repo public.

## Changes

- `ci.yml`: all three jobs (`python-check`, `rust-check`, `js-check`) moved from
  `ubuntu-latest` / `macos-latest` to `runs-on: [self-hosted, macOS]`. CI now
  runs entirely on the local Mac on every push — no billed minutes.
- `release-mac.yml`: `mac` job moved to `runs-on: [self-hosted, macOS]`. The
  `push: tags v*` trigger is kept, so a version tag still builds macOS locally
  for free.
- `release-linux.yml`: removed the `push: tags v*` auto-trigger; kept
  `workflow_dispatch`. Now dormant until manually run.
- `release-windows.yml`: removed the `push: tags v*` auto-trigger; kept
  `workflow_dispatch`. Now dormant until manually run.
- `release.yml` (manual matrix) and `release-promote.yml` left unchanged.

## Release flow going forward

1. macOS builds run locally on the self-hosted runner (tag push or dispatch).
2. For a Linux/Windows release: make the repo public, then
   `gh workflow run release-linux.yml -f tag=vX.Y.Z` and
   `gh workflow run release-windows.yml -f tag=vX.Y.Z`; wait for completion;
   make the repo private again.

## Operational notes

- A self-hosted runner labeled `self-hosted, macOS, ARM64` must be installed and
  online on the Mac, or the self-hosted jobs queue indefinitely.
- Self-hosted runners are safe on a **private** repo. While the repo is public
  for a release, only dispatch the Linux/Windows (GitHub-hosted) workflows;
  avoid running untrusted PR code on the self-hosted runner.

## Files Modified

- `.github/workflows/ci.yml` — 3 jobs → self-hosted macOS
- `.github/workflows/release-mac.yml` — mac job → self-hosted macOS
- `.github/workflows/release-linux.yml` — removed tag auto-trigger
- `.github/workflows/release-windows.yml` — removed tag auto-trigger
- `CLAUDE.md` — added a CI/Release section pointing at the runbook so future
  AI sessions don't "fix" the pipeline back onto billed runners

## Files Created

- `changelogs/2026-06-07_08_ci-self-hosted-macos-disable-linux-windows.md`
- `docs/CI_RELEASE_PIPELINE.md` — authoritative runbook: architecture, the
  self-hosted runner, the public-toggle release flow, billing visibility,
  troubleshooting, and rules for future AI edits
