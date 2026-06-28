# Publish readiness prep — Developer ID + notarized DMG path

**Date:** 2026-05-12
**Type:** Infrastructure

## Summary

End-to-end audit of the Tauri macOS publish pipeline for the v0.1.0
release. Added the missing pieces (`Info.plist`, DMG window styling,
multi-arch ffmpeg fetch, `JWT_DESKTOP_SECRET` plumbing, local publish
script, manual-todo doc) so a tagged release can build, sign, notarize
and ship arm64 + x86_64 DMGs via the existing `release.yml` CI matrix.

User decisions captured during the audit (recorded in
`docs/manual-todo/publish-macos.md`):
- **Distribution:** Developer ID Application cert + notarization
- **Architectures:** arm64 + x86_64 (both)
- **Version:** v0.1.0 (no bump)
- **Channels:** GitHub Releases + own marketing site

## Audit findings — what was already in place

- `tauri.conf.json` v2 config: productName "OpenReply", identifier
  `com.shantanu.openreply`, CSP locked, asset-protocol scoped, icons set.
- `Entitlements.plist` already had the PyInstaller hardened-runtime
  exceptions (`allow-unsigned-executable-memory`,
  `disable-library-validation`, `allow-dyld-environment-variables`) +
  `network.client` and `files.user-selected.read-write`.
- `.github/workflows/release.yml` with the full cross-platform matrix
  (mac arm64/x86_64, Linux, Windows) and Apple notarization secrets
  plumbed through `tauri-apps/tauri-action@v0`.
- `reddit-cli.spec` with ONNX model bundling + every lazy-imported
  source dep (`google_play_scraper`, `pytrends`, `feedparser`, `lxml`,
  `pypdf`, `pandas`, `scipy`, `networkx`, `sgmllib3k`).
- `scripts/build-pyinstaller.sh` for local sidecar builds.

## Findings — what was missing or broken

1. **No `Info.plist`** — usage descriptions for the file picker and a
   reserved `openreply://` URL scheme. Tauri merges this with its
   generated Info.plist if present.
2. **No DMG window config** — installer would open with a default-grey
   window and no app-icon positioning.
3. **`scripts/fetch-ffmpeg.sh` only fetched arm64** — x86_64 CI step
   would have built a bundle missing the ffmpeg sidecar.
4. **`release.yml` never fetched ffmpeg** — even for arm64, since
   `binaries/ffmpeg-*` is gitignored.
5. **`JWT_DESKTOP_SECRET` not in CI env** — `build.rs` **panics** in
   release mode if this is missing. License-activation tokens from the
   marketing site verify against the HMAC secret baked at build time.
   The local publish script also had no fallback.
6. **Stale arm64 sidecar** — `reddit-cli-aarch64-apple-darwin` on disk
   is from Apr 21; Python source has moved a month past that. Must be
   rebuilt before any release DMG can include the new
   audience/iterate/improve/launch/pipeline/deliberate features.

## Changes

### Files Created

- `app-tauri/src-tauri/Info.plist` — usage descriptions
  (`NSDocumentsFolderUsageDescription`,
  `NSMicrophoneUsageDescription`), ATS strict, reserved `openreply://`
  URL scheme, `NSHighResolutionCapable`.
- `scripts/publish-mac.sh` — one-button local DMG build: vite → spec
  PyInstaller → ad-hoc codesign sidecar → fetch ffmpeg → `cargo tauri
  build --bundles dmg`. Self-detects host arch. `--sign` flag enables
  Developer ID signing via APPLE_* env. Generates a per-build random
  `JWT_DESKTOP_SECRET` if not exported.
- `docs/manual-todo/publish-macos.md` — 9-step checklist covering
  Apple Developer Program sanity check, **Developer ID Application**
  cert creation (the user only has Apple Development + iPhone
  Distribution today — neither one works for a notarized DMG), `.p12`
  export, notarization credentials (app-specific password or App Store
  Connect API key), GitHub secrets, local smoke-test recipe, tag-push
  recipe, marketing-site mirror, release-day run-through. Includes a
  prominent note about `JWT_DESKTOP_SECRET` immutability.

### Files Modified

- `app-tauri/src-tauri/tauri.conf.json` — added `bundle.macOS.dmg`
  window/icon positions, `bundle.fileAssociations: []`,
  `bundle.macOS.exceptionDomain: ""`.
- `scripts/fetch-ffmpeg.sh` — accepts `arm64` | `x86_64` arg; picks
  the right mirror list (osxexperts for arm64,
  evermeet.cx + osxexperts for x86_64); writes to
  `binaries/ffmpeg-<rust-triple>` so tauri auto-resolves.
- `.github/workflows/release.yml` — added per-arch `fetch-ffmpeg.sh`
  step (only on macOS targets); added `Strip ffmpeg externalBin on
  non-macOS` step so Linux + Windows bundles don't fail looking for a
  missing binary; threaded `JWT_DESKTOP_SECRET` from repo secrets into
  the `tauri-action` env.

## How to publish from here

1. **Create the Developer ID Application cert** — see step 2 of
   `docs/manual-todo/publish-macos.md`. The user already has Apple
   Developer Program; only the cert itself is missing.
2. **Generate `JWT_DESKTOP_SECRET`** — `openssl rand -hex 32`. Add to
   GitHub Actions secrets AND export locally before running
   `publish-mac.sh` for smoke tests.
3. **Add the 6-7 Apple secrets** to GitHub Actions (full list in
   manual-todo).
4. **Smoke test locally** — `scripts/publish-mac.sh --arch arm64
   --sign` once the cert is in keychain. Verify
   `spctl -a -vv <DMG>` reports "Notarized Developer ID".
5. **Rebuild the stale sidecar first** — the on-disk sidecar predates
   audience/improve/iterate/launch and won't have those CLI commands.
   `scripts/publish-mac.sh --arch arm64` rebuilds it automatically.
6. **Push the tag** — `git tag v0.1.0 && git push origin v0.1.0`.
   `release.yml` builds arm64 + x86_64 + Linux + Windows in parallel
   and uploads to a draft release for review.

## Verification

- `node -e "JSON.parse(...)"` → tauri.conf.json parses
- `plutil -lint` → Info.plist + Entitlements.plist both pass
- `bash -n scripts/*.sh` → both scripts parse clean
- `python -c "import yaml; yaml.safe_load(...)"` → release.yml parses
- `cargo check` → Rust compiles (debug-fallback `JWT_DESKTOP_SECRET`
  warn is expected for non-release builds)
- `scripts/fetch-ffmpeg.sh arm64` → idempotent (host binary already
  present)

## Known gaps

- **Stale arm64 sidecar on disk** — needs rebuild before any DMG.
  `publish-mac.sh` handles this automatically; flagged here so we
  don't ship the Apr 21 binary by mistake.
- Linux + Windows release matrix still works but ffmpeg sidecar is
  missing on those platforms (ingest-video degrades gracefully). Out
  of scope for v0.1.0 (macOS-only beta).
- No `tauri-plugin-updater` configured yet — users will manually
  download every new version. Future scope; the workflow already
  plumbs `TAURI_SIGNING_PRIVATE_KEY` so wiring it up is a
  single-config-block change.
