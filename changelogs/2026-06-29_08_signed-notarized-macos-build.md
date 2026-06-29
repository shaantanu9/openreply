# Signed + notarized macOS build pipeline wired up

**Date:** 2026-06-29
**Type:** Infrastructure

## Summary

Audited the app's Apple Developer / code-signing / bundle-ID state and produced
the first fully signed + notarized shareable macOS build. Found that almost
everything was already correct — the `docs/manual-todo/` signing runbooks were
stale, describing a "to-do" state that had since been completed. The only real
gap was the absence of a wired-in notarization credential. Verified an existing
App Store Connect API key (`GP8F78A74R`) authenticates and notarizes on the
correct team (`263A33H6P5`), wired it into the publish pipeline via a gitignored
`.env.publish`, and ran `scripts/publish-mac.sh --sign` to produce a notarized,
stapled DMG + ZIP for `OpenReply 0.1.23` (arm64).

## Verified state (no change needed)

- Apple Developer Program: paid team `263A33H6P5`.
- Developer ID Application cert present in login keychain.
- Bundle ID `com.shantanu.openreply` — consistent across `tauri.conf.json`,
  `Info.plist` (URL scheme + CFBundleURLName), and asset-protocol scope.
- Versions aligned at `0.1.23` (tauri.conf.json, Cargo.toml, package.json).
- ASC API key `GP8F78A74R` (issuer `2eb65f08-…`) confirmed valid via
  `xcrun notarytool history` — prior builds Accepted on the same team.

## Changes

- Hardened `.gitignore` to exclude `*.p8` / `AuthKey_*.p8` so ASC API key files
  can never be committed.
- Created gitignored `.env.publish` wiring the Developer ID identity + ASC API
  key into `scripts/publish-mac.sh --sign`.
- Ran the signed build → notarization Accepted (ZIP id `31751c44-…`, DMG id
  `68efd3a1-…`), ticket stapled to both artifacts.
- Verified: `spctl -a -vvv` → `accepted / source=Notarized Developer ID`;
  `xcrun stapler validate` on the DMG passed; signing authority is the
  Developer ID cert with TeamIdentifier `263A33H6P5`.
- Corrected stale `docs/manual-todo/developer-id-signing.md` and
  `publish-macos.md` to reflect that the cert + API key now exist.

## Files Created

- `.env.publish` (gitignored — local signing/notarization credentials)
- `changelogs/2026-06-29_08_signed-notarized-macos-build.md`

## Files Modified

- `.gitignore` — added `*.p8` / `AuthKey_*.p8` ignore rules
- `docs/manual-todo/developer-id-signing.md` — marked cert + notarization creds as done
- `docs/manual-todo/publish-macos.md` — marked Developer ID cert + API key steps as done

## Build artifacts (not committed — in target/)

- `app-tauri/src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/OpenReply_0.1.23_arm64.dmg` (278M)
- `app-tauri/src-tauri/target/aarch64-apple-darwin/release/bundle/zip/OpenReply_0.1.23_arm64.zip` (238M)
