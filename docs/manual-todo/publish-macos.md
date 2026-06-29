# Publish OpenReply — manual steps that can't be automated

**Goal:** ship a Developer ID-signed + notarized `OpenReply_0.1.0_aarch64.dmg`
and `_x64.dmg` via GitHub Releases + the marketing site.

The CI workflow at `.github/workflows/release.yml` already handles the
end-to-end build. The items below are the human steps that have to happen
in dashboards Apple controls.

## 1. Apple Developer Program — sanity check

You already have:
- Apple Development cert (M9T8TF27Q5)
- iPhone Distribution cert (263A33H6P5)

Confirm your Apple Developer Program is current at
<https://developer.apple.com/account/> (renews yearly, $99).

## 2. Create a **Developer ID Application** cert — ✅ DONE (2026-06-29)

The `Developer ID Application: Shantanu Bombatkar (263A33H6P5)` cert is now
installed in the login keychain, and the ASC API key `GP8F78A74R` is wired into
`scripts/publish-mac.sh --sign` via `.env.publish`. Steps 2–6 below are already
satisfied for local builds; they remain as reference and for CI secret setup.

This is the cert specifically for distributing macOS apps OUTSIDE the App
Store (signed + notarized DMG). The certs you have today are not this one.

- [ ] Open <https://developer.apple.com/account/resources/certificates/list>
- [ ] Click `+` → choose **Developer ID Application**
- [ ] Generate a Certificate Signing Request from Keychain Access
      (Keychain → Certificate Assistant → Request from CA, save to disk)
- [ ] Upload the CSR, download the `.cer` Apple gives back
- [ ] Double-click the `.cer` to install into login keychain
- [ ] Verify: `security find-identity -v -p codesigning | grep "Developer ID"`
      — should now show a line like
      `"Developer ID Application: Shantanu Bombatkar (263A33H6P5)"`

## 3. Export the cert as `.p12` for CI

- [ ] In Keychain Access, find the new "Developer ID Application" entry
- [ ] Right-click the **private key** under that cert → Export
- [ ] Save as `developer-id.p12` with a strong password (you'll need it)
- [ ] Convert to base64 for GitHub secret storage:
      ```
      base64 -i developer-id.p12 | pbcopy
      ```

## 4. Generate notarization credentials (pick ONE option)

### Option A — App-specific password (simpler, fine for solo dev)
- [ ] Open <https://appleid.apple.com> → sign in → App-Specific Passwords
- [ ] Generate a new one labelled "openreply-map-notarize"
- [ ] Save the 16-char password somewhere safe

### Option B — App Store Connect API key (recommended by Apple, rotates without password churn)
- [ ] Open <https://appstoreconnect.apple.com/access/api>
- [ ] Generate a new API key with **Developer** access (Admin role NOT needed)
- [ ] Note the **Issuer ID** (UUID at the top of the page)
- [ ] Download the `.p8` file (one-time download — keep it safe)
- [ ] Note the **Key ID** (10-char)

## 5. Add GitHub Actions secrets

Open <https://github.com/shaantanu9/openreply/settings/secrets/actions> and add:

| Secret | Value |
|---|---|
| `APPLE_CERTIFICATE` | base64 of `developer-id.p12` (step 3) |
| `APPLE_CERTIFICATE_PASSWORD` | password you set when exporting |
| `APPLE_SIGNING_IDENTITY` | `Developer ID Application: Shantanu Bombatkar (263A33H6P5)` |
| `APPLE_ID` | your Apple ID email (Option A only) |
| `APPLE_PASSWORD` | app-specific password (Option A only) |
| `APPLE_TEAM_ID` | `263A33H6P5` |
| `APPLE_API_ISSUER` | Issuer UUID (Option B only) |
| `APPLE_API_KEY` | Key ID (Option B only) |
| `APPLE_API_KEY_BASE64` | base64 of the `.p8` (Option B only — needs a small workflow edit to materialize into a file) |

## 6. Smoke-test the build locally first

Before pushing a tag (which triggers the slow CI), prove it works on your
own machine:

```
# Ad-hoc DMG (no signing — just to verify the bundle assembles)
scripts/publish-mac.sh --arch arm64

# Signed + notarized DMG (Option A creds)
export APPLE_SIGNING_IDENTITY="Developer ID Application: Shantanu Bombatkar (263A33H6P5)"
export APPLE_ID="you@example.com"
export APPLE_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="263A33H6P5"
scripts/publish-mac.sh --arch arm64 --sign
```

The resulting DMG ends up at
`app-tauri/src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/`.

Then verify:
```
codesign -vvv --deep --strict "OpenReply_0.1.0_aarch64.dmg"
spctl -a -vv "OpenReply_0.1.0_aarch64.dmg"
# Expected: "accepted" + "source=Notarized Developer ID"
```

## 7. Push the release tag

Once the local DMG passes `spctl`, ship it via CI:

```
git tag v0.1.0
git push origin v0.1.0
```

The `release` workflow will:
- Build sidecar + ffmpeg + DMG for arm64 + x86_64
- Sign each with Developer ID
- Submit to notarization
- Staple the ticket
- Upload as a **draft** release on GitHub (so you can review before going public)

## 8. Mirror to the marketing site

After the GitHub draft release passes review:
- [ ] Download the two DMGs (arm64 + x86_64)
- [ ] Upload to your marketing site CDN (Vercel? S3? Cloudflare R2?)
- [ ] Update the landing page download links

## 9. Release-day checklist (run-through, top to bottom)

- [ ] `CHANGELOG.md` updated for v0.1.0 (what's new + known limits)
- [ ] `tauri.conf.json` version = `0.1.0` (already)
- [ ] `Cargo.toml` version = `0.1.0` (already)
- [ ] `package.json` version = `0.1.0` (already)
- [ ] `git status` is clean on the release branch
- [ ] Smoke-test publish-mac.sh on arm64 → DMG opens, app launches, sidecar works
- [ ] Smoke-test publish-mac.sh on x86_64 (or skip if arm64-only beta)
- [ ] `git tag v0.1.0 && git push origin v0.1.0`
- [ ] Watch the `release` workflow in GitHub Actions for green
- [ ] Promote the draft release → public
- [ ] Mirror artifacts to marketing site
- [ ] Tweet / Show HN / r/SideProject when ready

## Known gaps for this first release

- Linux + Windows build steps exist in release.yml but are untested. ffmpeg
  fallback is missing for those platforms — the ingest-video feature
  silently degrades.
- No Tauri Updater configured yet. Manual download of every new version.
  Future scope: add `tauri-plugin-updater` + sign the updater manifests
  with `TAURI_SIGNING_PRIVATE_KEY`.
- macOS App Store path is intentionally NOT pursued — the Python sidecar +
  arbitrary file writes are incompatible with the App Sandbox.
