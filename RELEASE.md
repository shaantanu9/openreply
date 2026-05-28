# Release flow — Gap Map

> Single source of truth for cutting a new version. Read this every time
> before tagging — the entire flow has been distilled into automated
> guards (`scripts/preflight-release.sh`, `scripts/verify-dmg.sh`,
> `.git/hooks/pre-push`, an in-CI signing audit), but you still have to
> drive it.

---

## TL;DR — the happy path

```bash
# 0. Pick the new version
NEW=v0.1.2
NUM=${NEW#v}

# 1. Bump version pins (3 files, must all match the tag)
sed -i.bak -E 's/("version"[[:space:]]*:[[:space:]]*")[0-9.]+(")/\1'"$NUM"'\2/' app-tauri/src-tauri/tauri.conf.json app-tauri/package.json && rm app-tauri/src-tauri/tauri.conf.json.bak app-tauri/package.json.bak
sed -i.bak -E 's/^version[[:space:]]*=[[:space:]]*"[0-9.]+"/version = "'"$NUM"'"/' app-tauri/src-tauri/Cargo.toml && rm app-tauri/src-tauri/Cargo.toml.bak

# 2. Commit + push to multi-source
git add app-tauri/src-tauri/tauri.conf.json app-tauri/package.json app-tauri/src-tauri/Cargo.toml
git commit -m "chore(release): bump version → $NUM"
git push origin multi-source

# 3. Preflight (catches anything you forgot — the pre-push hook runs this
#    automatically when you push the tag, but running it manually first is
#    faster than failing the push)
scripts/preflight-release.sh "$NEW"

# 4. Tag + push (pre-push hook fires preflight again as a safety net)
git tag -a "$NEW" -m "Gap Map $NEW — <one-line theme>"
git push origin "$NEW"

# 5. Wait for release.yml to build + upload to gap-map-pro v* draft
#    (~12 min for mac arm64 + mac x86_64 + windows; Linux runs separately)

# 6. Sign + notarize locally (CI builds unsigned by default)
set -a; source .env.publish; set +a
scripts/publish-mac.sh --sign --arch arm64
scripts/publish-mac.sh --sign --arch x86_64

# 7. Verify before upload (refuses to continue if signing failed)
scripts/verify-dmg.sh \
  "app-tauri/src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/Gap Map_${NUM}_aarch64.dmg" \
  --expected-arch arm64 --expected-version "$NUM" --expected-bundle-id com.shantanu.gapmap
scripts/verify-dmg.sh \
  "app-tauri/src-tauri/target/x86_64-apple-darwin/release/bundle/dmg/Gap Map_${NUM}_x64.dmg" \
  --expected-arch x86_64 --expected-version "$NUM" --expected-bundle-id com.shantanu.gapmap

# 8. Rezip the SIGNED .app bundles for the .zip companions (ditto, NOT tar
#    — tar strips macOS codesignature xattrs)
for arch_pair in "aarch64-apple-darwin:arm64" "x86_64-apple-darwin:x64"; do
  triple=${arch_pair%:*}; tag_arch=${arch_pair#*:}
  ditto -ck --rsrc --sequesterRsrc \
    "app-tauri/src-tauri/target/${triple}/release/bundle/macos/Gap Map.app" \
    "/tmp/Gap.Map_${NUM}_${tag_arch}.zip"
done

# 9. Upload signed artifacts to the public release repo
PUB=myind-ai/gapmap
gh release upload "$NEW" --repo "$PUB" \
  "app-tauri/src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/Gap Map_${NUM}_aarch64.dmg" \
  "app-tauri/src-tauri/target/x86_64-apple-darwin/release/bundle/dmg/Gap Map_${NUM}_x64.dmg" \
  "/tmp/Gap.Map_${NUM}_arm64.zip" "/tmp/Gap.Map_${NUM}_x64.zip" \
  --clobber
# Rename the arm64.dmg server-side: see "Naming conventions" below

# 10. Publish (visible on the public releases page)
gh release edit "$NEW" --repo "$PUB" --draft=false --latest
```

---

## The three traps that have bitten us repeatedly

| # | Trap | Where it bites | Guard |
|---|---|---|---|
| 1 | Push tag without bumping `tauri.conf.json` version | CI uploads `<App>_<OLD_VER>_*` artifacts to the OLD release object, overwriting good artifacts. New tag has no release object at all. | `scripts/preflight-release.sh` fails on version mismatch · pre-push hook runs preflight |
| 2 | CI builds + we publish, then notice DMGs are ad-hoc signed (no Developer ID, no notarization) | Release notes claim "Notarized by Apple" but Gatekeeper blocks every user's first launch | `scripts/verify-dmg.sh` fails before upload · CI workflow audits signature post-build and surfaces a warning |
| 3 | Tar-extract a signed `.app`, rezip, upload — codesignature is silently stripped | Users download "signed" zip, get unsigned app | Always use `ditto -ck --rsrc --sequesterRsrc` instead of tar |

If you're about to skip a guard, ask why. The guards exist because we've each cost ourselves 60+ minutes of recovery work hitting these.

---

## Version pin files (3 places — keep in sync)

When you bump a release, ALL THREE must match the tag (otherwise hilarity):

| File | Field | Why it matters |
|---|---|---|
| `app-tauri/src-tauri/tauri.conf.json` | `"version"` | **Source of truth** for `tauri-action`'s `tagName: v__VERSION__`. Bundle's `CFBundleShortVersionString`. |
| `app-tauri/package.json` | `"version"` | npm + Vite log lines + occasionally inferred by tooling |
| `app-tauri/src-tauri/Cargo.toml` | `version = "..."` | `CARGO_PKG_VERSION` env var at compile time, baked into the Rust binary |

`scripts/preflight-release.sh` checks all three.

---

## Apple credentials (`.env.publish`)

Required for the local signing pipeline to work. Stored at repo root, **gitignored**.

```bash
APPLE_TEAM_ID=263A33H6P5
APPLE_SIGNING_IDENTITY="Developer ID Application: Shantanu Bombatkar (263A33H6P5)"
APPLE_ID=<your-email>
APPLE_PASSWORD=<app-specific-password>     # if using ID/password
APPLE_API_KEY=<key-id>                     # OR using API key (preferred)
APPLE_API_ISSUER=<issuer-uuid>
APPLE_API_KEY_PATH=/abs/path/to/AuthKey_<KEYID>.p8
```

The Developer ID Application cert must also be in your **login keychain**:

```bash
security find-identity -v -p codesigning | grep "Developer ID Application"
# expect:  N) <hash>  "Developer ID Application: Your Name (TEAMID)"
```

If missing, import the `.p12`:

```bash
security import path/to/DevID.p12 -P "<password>" -T /usr/bin/codesign
```

---

## CI vs local signing

**CI builds.** The default `release.yml` runs two mutually exclusive build
steps based on whether `secrets.APPLE_CERTIFICATE` is set on the repo:

- `Build and release Tauri bundle (signed)` — if set, tauri-action signs and notarizes during the build
- `Build and release Tauri bundle (unsigned)` — if not set, the build produces ad-hoc-signed binaries

The post-build signing audit step warns loud in the workflow logs if the
result is ad-hoc — you'll see it as a yellow GitHub Actions annotation
on the run.

**Local signing is the current source of truth** for `myind-ai/gapmap` releases.
Use `scripts/publish-mac.sh --sign --arch arm64/x86_64` after CI finishes,
THEN upload the signed artifacts. The release workflow's "(unsigned)" path
is the one that's actually firing today.

To move signing into CI, add these as **repo secrets** on `gap-map-pro`:

- `APPLE_CERTIFICATE` (base64-encoded .p12)
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_SIGNING_IDENTITY`
- `APPLE_ID`
- `APPLE_PASSWORD`
- `APPLE_TEAM_ID`

Then `HAS_APPLE_CERT` flips to `'yes'` and the "(signed)" path runs.

---

## Naming conventions (internal vs public repo)

`tauri-action` produces these names; we rename two of them for the public repo:

| Internal (gap-map-pro draft) | Public (myind-ai/gapmap) |
|---|---|
| `Gap.Map_X.Y.Z_aarch64.dmg` | `Gap.Map_X.Y.Z_arm64.dmg` (rename) |
| `Gap.Map_aarch64.app.tar.gz` | `Gap.Map_X.Y.Z_arm64.zip` (rezip with `ditto`) |
| `Gap.Map_X.Y.Z_x64.dmg` | (same) |
| `Gap.Map_x64.app.tar.gz` | `Gap.Map_X.Y.Z_x64.zip` (rezip with `ditto`) |
| `Gap.Map_X.Y.Z_x64_en-US.msi` | (same) |
| `Gap.Map_X.Y.Z_x64-setup.exe` | (same) |

Linux ships separately via `release-linux.yml`.

---

## Asset labels (friendly names on the release page)

GitHub release UI shows the **filename** unless an asset has a `label`. After
upload, label each asset so users see plain-English platform names:

```bash
# Get asset IDs
gh release view "$NEW" --repo myind-ai/gapmap --json assets \
  --jq '.assets[] | "\(.apiUrl)\t\(.name)"'

# Then PATCH each
gh api -X PATCH repos/myind-ai/gapmap/releases/assets/<id> \
  -f label="macOS — Apple Silicon (.dmg, signed)"
```

| Filename pattern | Label |
|---|---|
| `*_arm64.dmg` | `macOS — Apple Silicon (.dmg, signed)` |
| `*_arm64.zip` | `macOS — Apple Silicon (.app, zipped)` |
| `*_x64.dmg`   | `macOS — Intel (.dmg, signed)` |
| `*_x64.zip`   | `macOS — Intel (.app, zipped)` |
| `*_x64-setup.exe` | `Windows — installer (.exe)` |
| `*_x64_en-US.msi` | `Windows — installer (.msi)` |

---

## When something is broken

```bash
# Pull released DMG back to draft IMMEDIATELY
gh release edit "$TAG" --repo myind-ai/gapmap --draft=true

# Inspect what's actually inside the published DMG
gh release download "$TAG" --repo myind-ai/gapmap --pattern "*arm64.dmg"
scripts/verify-dmg.sh "Gap.Map_${NUM}_arm64.dmg" \
  --expected-arch arm64 --expected-version "$NUM" --expected-bundle-id com.shantanu.gapmap
# If FAIL: re-sign locally (sections 6/7 of the TL;DR), re-upload --clobber, republish
```

The `tauri-github-release-flow` skill (in `~/.claude/skills/`) has the
full recovery playbook + 13 documented gotchas.

---

## Workflows in this repo

- `.github/workflows/release.yml` — **fast path**: macOS arm64 + macOS x86_64 + Windows (~12 min). Tag-driven.
- `.github/workflows/release-linux.yml` — **slow path**: Linux .deb/.rpm/.AppImage. Manually triggered with `workflow_dispatch` (tag input), or auto-triggered via `workflow_run` after the main release succeeds.
