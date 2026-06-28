# Release notes: embed real changelog, drop private-repo link

**Date:** 2026-06-01
**Type:** Infrastructure (CI/Release)

## Summary

The public release notes ended with "See the [source repo](https://github.com/shaantanu9/openreply) `changelogs/` folder for what changed" — a link to the **private** source repo (leaks org structure and is useless to public users). Replaced it across all three platform release workflows with the **real changelog content**, extracted from the version's section in `CHANGELOG.md` at release time, and fixed the already-published v0.1.7 note in place.

## Changes

- `CHANGELOG.md`: added a real **v0.1.7** section (topic merge, MCP Copy config, WAL data-loss fix, security hardening, build fix, test isolation, CI promote fix).
- `release-mac.yml` / `release-windows.yml` / `release-linux.yml`: replaced the `NOTES=$'…source repo…'` block with logic that:
  - extracts the `## [vX.Y.Z …]` section from `$GITHUB_WORKSPACE/CHANGELOG.md` via awk (stops at the next `## [` header), with a graceful fallback line if the version has no section;
  - builds the notes with `printf` and passes them via `gh release create --notes-file` (robust quoting, no private-repo link);
  - renders a `## What's changed` section with the extracted content.
- Updated the live published `myind-ai/openreply` v0.1.7 release note via `gh release edit --notes-file` (verified: 0 private-repo links, real changelog present).

## Files Created

- `changelogs/2026-06-01_02_release-notes-real-changelog.md`

## Files Modified

- `CHANGELOG.md` — added v0.1.7 section.
- `.github/workflows/release-mac.yml`, `release-windows.yml`, `release-linux.yml` — changelog-driven release notes via `--notes-file`.

## Notes

- Keep `CHANGELOG.md` updated per release; the workflow extracts the matching `## [vX.Y.Z …]` header. Missing section → graceful fallback ("See the in-app changelog").
- Workflow change takes effect on the next tagged release; v0.1.7's note was corrected directly.
