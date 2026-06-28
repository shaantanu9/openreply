# User-friendly release asset names

**Date:** 2026-05-29
**Type:** UX Enhancement (release pipeline)

## Summary

Release assets on `myind-ai/openreply` shipped with the tauri-action
default naming convention — technical and confusing to non-developers:

```
Gap.Map_0.1.4_arm64.dmg          ← which Mac is this for?
Gap.Map_0.1.4_x64.dmg            ← Intel or Windows?
Gap.Map_0.1.4_x64_en-US.msi      ← what is _en-US?
Gap.Map_0.1.4_x64-setup.exe      ← MSI vs EXE — which do I pick?
Gap.Map_0.1.4_amd64.AppImage     ← what's amd64?
Gap.Map_0.1.4_amd64.deb
```

Renamed everything to the platform-first, dash-separated convention so
the file name itself answers "is this for my machine?" without users
having to know what `aarch64` or `amd64` means:

```
Gap-Map-0.1.4-macOS-Apple-Silicon.dmg
Gap-Map-0.1.4-macOS-Apple-Silicon.zip   (.app, manual install)
Gap-Map-0.1.4-macOS-Intel.dmg
Gap-Map-0.1.4-macOS-Intel.zip
Gap-Map-0.1.4-Windows.msi               (managed deploy)
Gap-Map-0.1.4-Windows-Installer.exe     (click-to-install)
Gap-Map-0.1.4-Linux.AppImage            (portable)
Gap-Map-0.1.4-Linux.deb                 (Debian/Ubuntu APT)
```

Naming chosen 2026-05-29 per user spec: "Apple Silicon" / "Intel" /
"Linux" — Apple's official wording for Mac CPUs, the rest matches what
non-technical users actually search for. .msi vs Installer.exe split is
preserved because IT admins prefer .msi for Group Policy / SCCM while
home users prefer the click-to-install .exe.

## What changed

### 1. Live retroactive rename of v0.1.4 (one-time migration)

New script `scripts/rename-public-release-assets.sh` renames release
assets in-place on GitHub via the API (`PATCH
/repos/.../releases/assets/{id} -f name=...`). Idempotent —
re-running on an already-renamed release is a no-op. Unrecognized
asset names are reported but never touched.

Used today on v0.1.4 (8/8 assets renamed live). Same script can rename
older releases (v0.1.0–v0.1.3) if/when desired:

```bash
scripts/rename-public-release-assets.sh v0.1.3
```

Uses a bash 3.2-compatible `case` statement (not `declare -A`
associative arrays) so it runs on macOS's stock bash without requiring
Homebrew bash 5+.

### 2. Workflow rename steps for v0.1.5+ releases

All 3 per-platform release workflows now rename artifacts BEFORE
uploading to `myind-ai/openreply`:

- `release-mac.yml` — DMG rename + `.app.tar.gz` rezip-to-`.zip` with
  friendly naming (extends the pre-existing `aarch64 → arm64` rename
  step).
- `release-windows.yml` — new rename block for MSI + EXE.
- `release-linux.yml` — new rename block for AppImage + .deb + .rpm.

Each rename step is independent (one platform's failure doesn't block
the others). The release notes body emitted with the new `gh release
create --notes ...` references the friendly names so the GitHub UI
description lines up with the asset list below it.

### 3. Promote-check pattern update

`scripts/promote-release-if-complete.sh` + the inlined REQUIRED arrays
inside all 3 workflows now match the friendly names. Linux remains
OPTIONAL for promote (mac arm64 + mac x64 + Windows alone trigger
draft → latest; Linux appends to an already-published release later).

## Files Created

- `scripts/rename-public-release-assets.sh` — one-shot migration tool
  for renaming existing release assets via GitHub API.
- `changelogs/2026-05-29_01_friendly-release-asset-names.md`

## Files Modified

- `.github/workflows/release-mac.yml` — extended rename step (DMG +
  .app.zip → macOS-Apple-Silicon / macOS-Intel), updated FILES glob,
  updated release-notes body, updated promote REQUIRED patterns.
- `.github/workflows/release-windows.yml` — added rename block (MSI +
  EXE → Windows / Windows-Installer), same downstream updates.
- `.github/workflows/release-linux.yml` — added rename block (AppImage
  + .deb + .rpm → Linux.*), same downstream updates.
- `scripts/promote-release-if-complete.sh` — REQUIRED_PATTERNS updated
  to match friendly names.

## Verification

- `yaml.safe_load` clean on all 3 modified workflow files.
- `bash -n` clean on both shell scripts.
- **Live verification: v0.1.4 assets successfully renamed via the
  migration script** (8/8 renames, 0 errors, 0 unrecognized). Verified
  via `gh api repos/myind-ai/openreply/releases/tags/v0.1.4 --jq
  '.assets[].name'` — all 8 names now match the new convention.
- v0.1.5+ workflow steps will be verified at first tag push on the
  new architecture.

## Migration notes

- v0.1.0–v0.1.3 still ship with the old naming. If you want to
  retroactively rename them too:

  ```bash
  for v in v0.1.0 v0.1.1 v0.1.2 v0.1.3; do
    scripts/rename-public-release-assets.sh "$v"
  done
  ```

  The script is per-tag idempotent so re-running is safe.

- The source repo (`openreply`) draft releases still hold the
  tauri-action default names — those are internal staging and not
  user-visible. No reason to rename them.

- Tauri auto-updater is NOT configured in this app (no `updater` key
  in `tauri.conf.json`), so renaming asset filenames is safe — there's
  no manifest URL pattern that would break.
