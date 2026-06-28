# Release pipeline hardened + openreply.myind.ai promoted everywhere

**Date:** 2026-05-28
**Type:** Infrastructure | Documentation

## Summary

Two follow-ups after manually promoting the v0.1.3 public release:

1. **Hardened the promote step** in all three per-platform release workflows so the script-missing failure that hit v0.1.3 can never recur. The original step ran `bash scripts/promote-release-if-complete.sh`, which fails with `No such file or directory` when `actions/checkout` is pinned to a tag whose commit predates the script (e.g. when a workflow_dispatch passes an older tag after the per-platform split). The script logic — short, ~30 lines of bash — is now inlined directly into the YAML `run:` block of each workflow. Inlined logic ships with the workflow file, so the dispatched-ref-mismatch case cannot reach a "file not found" again. Also added `if: always()` so the promote step still runs even if an earlier step in the same job had a non-fatal failure.

2. **Promoted `openreply.myind.ai`** to every natural surface in the repo, the live v0.1.3 release page, the in-app Settings screen, and the auto-created release notes the workflows will produce on every future tag.

## Changes

### Pipeline hardening (workflows)
- Inlined the contents of `scripts/promote-release-if-complete.sh` directly into the `Promote release to latest if all platforms are uploaded` step in `release-mac.yml`, `release-windows.yml`, and `release-linux.yml`. Added `if: always()` to all three so promote runs even after a previous step's non-blocking issue.
- The standalone `scripts/promote-release-if-complete.sh` is kept (left untouched) for direct invocation outside CI, but workflows no longer depend on it being present in the checked-out tree.

### Auto-generated release notes
- Replaced the generic `"Release artifacts attached. See repo CHANGELOG for details."` body with a branded markdown template that leads with the `openreply.myind.ai` download CTA, lists the four installer file patterns, and links back to the source-repo `changelogs/` folder. Same template in all three workflow files so whichever job creates the public release first writes consistent notes.

### Live v0.1.3 release body
- Edited the v0.1.3 release notes on `myind-ai/openreply` via `gh release edit --notes` to use the same branded template with concrete file names (e.g. `Gap.Map_0.1.3_arm64.dmg`) instead of glob patterns.

### App-facing URL promotion
- `app-tauri/src-tauri/Cargo.toml` — added `homepage = "https://openreply.myind.ai/"` and `repository = "https://github.com/myind-ai/openreply"` to `[package]` so the URL appears in crate metadata and downstream packagers.
- `app-tauri/package.json` — added `homepage` and `repository` fields with the same two URLs so the URL appears in npm-tooling metadata and the `npm pkg get homepage` resolution path.
- `app-tauri/src/screens/settings.js` — added a new `openreply.myind.ai →` button in the existing "Onboarding & help" card next to "Methodology" and "GitHub readme". Click handler routes through `api.openUrl()` (existing Tauri shell-open binding) and lands the user on the public website.

### Repo README
- `README.md` "Desktop app" section — bolded `Download OpenReply → [openreply.myind.ai](https://openreply.myind.ai/)` as the primary CTA, with the public GitHub releases page as a secondary link for users who want to inspect the artifact list directly. Old link to the (private) source-repo releases page is removed.

## Files Modified

- `.github/workflows/release-mac.yml` — promote step inlined; auto-created release notes template updated.
- `.github/workflows/release-windows.yml` — promote step inlined; auto-created release notes template updated.
- `.github/workflows/release-linux.yml` — promote step inlined; auto-created release notes template updated.
- `app-tauri/src-tauri/Cargo.toml` — `homepage` + `repository` added.
- `app-tauri/package.json` — `homepage` + `repository` added.
- `app-tauri/src/screens/settings.js` — new `openreply.myind.ai →` button and click handler.
- `README.md` — "Desktop app" section now leads with the website CTA.

## Files Created

- `changelogs/2026-05-28_13_release-pipeline-harden-and-website-url.md` — this file.

## Verification

- v0.1.3 public release: https://github.com/myind-ai/openreply/releases/tag/v0.1.3 — now published (not draft), `isLatest: true`, 6 installer artifacts attached, branded notes.
- Future tag push (`git tag v0.1.4 && git push --tags`) will trigger `release-mac.yml`, `release-windows.yml`, `release-linux.yml`. Each workflow's promote step is now self-contained and can't `No such file or directory`.
- The auto-created release notes for v0.1.4+ will include the website CTA before any artifact upload starts.
