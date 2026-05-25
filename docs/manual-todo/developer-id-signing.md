# Developer ID signing + notarization runbook

**Status:** required before shipping a DMG that works cleanly on macOS 26.5+ (Tahoe).
**Substitute today:** ship the `.zip` produced by `scripts/publish-mac.sh` — covered
in BETA.md.

---

## Why this matters

Starting with macOS 26.x (Tahoe), Apple enforces strict code-signing on binaries
*inside* DMGs. Symptoms when this isn't in place:

- Recipients drag `Gap Map.app` from the DMG mount to `/Applications` — Finder
  reports "Operation can't be completed (101000)" OR silently produces an .app
  with 0-byte / truncated inner binaries.
- `cp -R` from the DMG fails with `fcopyfile failed: Unknown error: 1000`
  (`errSecCSAssertion` — Security framework rejection).
- Opening the (corrupted) .app from /Applications crashes immediately or hangs
  with sidecar SIGKILL (exit 137).

There is **no client-side workaround** on Tahoe. The only fix is Developer ID
Application signing + Apple notarization.

---

## Prerequisites (you already have these per `.env.publish`)

```
APPLE_TEAM_ID=263A33H6P5
APPLE_SIGNING_IDENTITY="Developer ID Application: Shantanu Bombatkar (263A33H6P5)"
APPLE_ID=shantanubombatkar2@gmail.com
```

Active Apple Developer Program membership is required (you have one — team ID
`263A33H6P5` is a paid team).

---

## Step 1 — Generate + download the Developer ID Application certificate

Today: `security find-identity -v -p codesigning` shows you have:
- `Apple Development: shantanubombatkar2@gmail.com (M9T8TF27Q5)` — wrong type
- `iPhone Distribution: Shantanu Bombatkar (263A33H6P5)` — iOS only

You need: **`Developer ID Application: Shantanu Bombatkar (263A33H6P5)`**.

1. Go to https://developer.apple.com/account/resources/certificates/list
2. Click **+** → **Developer ID Application** → Continue
3. macOS Keychain Access → Certificate Assistant → **Request a Certificate From a Certificate Authority**
   - User Email: `shantanubombatkar2@gmail.com`
   - Common Name: `Shantanu Bombatkar`
   - Saved to disk → produces `.certSigningRequest` file
4. Back in developer.apple.com → upload the `.certSigningRequest` → **Continue**
5. Apple issues a `developerID_application.cer` → download
6. Double-click the `.cer` file → Keychain Access opens → certificate installs

Verify:

```bash
security find-identity -v -p codesigning | grep "Developer ID Application"
# → 3) <hash> "Developer ID Application: Shantanu Bombatkar (263A33H6P5)"
```

---

## Step 2 — App-specific password for notarization

Notarization requires an Apple ID + an app-specific password (not your iCloud password).

1. Go to https://appleid.apple.com/account/manage
2. Sign-In and Security → App-Specific Passwords → **Generate Password**
3. Name it `Gap Map notarytool`
4. Copy the password (format `xxxx-xxxx-xxxx-xxxx`) — Apple shows it once.

Save in `.env.publish` (gitignored):

```bash
APPLE_PASSWORD=xxxx-xxxx-xxxx-xxxx
```

---

## Step 3 — Bundle Developer ID into the build

Once the cert is in your keychain and `APPLE_PASSWORD` is in `.env.publish`:

```bash
source .env.publish
export APPLE_SIGNING_IDENTITY APPLE_TEAM_ID APPLE_ID APPLE_PASSWORD
scripts/publish-mac.sh --sign
```

The `--sign` flag in `publish-mac.sh` instructs Tauri to sign with your
Developer ID instead of ad-hoc. Tauri then:
1. Signs the .app bundle with `Developer ID Application: …`
2. Signs every Mach-O binary inside `Contents/MacOS/` with the same identity
3. Submits the .app + DMG to Apple's notarization service via `notarytool`
4. Staples the notarization ticket to the DMG once Apple approves (~2-10 min)

Output: a notarized DMG at
`app-tauri/src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/Gap Map_0.1.0_aarch64.dmg`
that opens cleanly on every Mac — no Gatekeeper warnings, no quarantine issues,
drag-to-/Applications just works.

---

## Step 4 — Verify the notarized DMG

```bash
# Check Developer ID is on the .app
codesign -dvv "/Volumes/Gap Map/Gap Map.app"
# Expected: "Authority=Developer ID Application: Shantanu Bombatkar (263A33H6P5)"

# Check Gatekeeper accepts it
spctl -a -vvv "/Volumes/Gap Map/Gap Map.app"
# Expected: "accepted source=Notarized Developer ID"

# Check the inner sidecar inherits the signature
codesign -dvv "/Volumes/Gap Map/Gap Map.app/Contents/MacOS/gapmap-cli"
# Expected: same Developer ID authority

# Confirm a Finder drag-install works (on macOS 26.5+)
hdiutil attach Gap*.dmg -nobrowse
cp -R "/Volumes/Gap Map/Gap Map.app" /Applications/
ls -la "/Applications/Gap Map.app/Contents/MacOS/"
# Expected: all binaries copy with their real sizes (no 0-byte files)
```

---

## Step 5 — GitHub Actions setup (for tagged releases)

Once Developer ID works locally, mirror the same env into the `release.yml`
workflow's secrets (`gh secret set`):

```bash
gh secret set APPLE_SIGNING_IDENTITY --body "$APPLE_SIGNING_IDENTITY"
gh secret set APPLE_TEAM_ID --body "$APPLE_TEAM_ID"
gh secret set APPLE_ID --body "$APPLE_ID"
gh secret set APPLE_PASSWORD --body "$APPLE_PASSWORD"
```

Plus the certificate itself, exported as a .p12:

1. Keychain Access → right-click the Developer ID cert → Export → choose .p12 format → set a password
2. Base64-encode: `base64 -i developer_id.p12 -o developer_id.p12.base64`
3. `gh secret set APPLE_CERTIFICATE --body "$(cat developer_id.p12.base64)"`
4. `gh secret set APPLE_CERTIFICATE_PASSWORD --body "$P12_PASSWORD"`

Then every tag push produces a notarized DMG via CI without your laptop being
involved.

---

## Common failures + fixes

| Error | Fix |
|---|---|
| `error: No identity found` when running `--sign` | Developer ID cert not in keychain. Re-do Step 1. |
| `notarytool error: invalid credentials` | `APPLE_PASSWORD` is your iCloud password, not the app-specific one. Re-do Step 2. |
| Notarization stuck > 30 min | Apple's queue is backed up. Check status: `xcrun notarytool history --apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID" --password "$APPLE_PASSWORD"` |
| Notarization rejected: "The signature does not include a secure timestamp" | Add `--timestamp` to codesign args (Tauri does this by default with `--sign`; only an issue if you're signing manually) |
| Notarization rejected: "The binary is not signed with a valid Developer ID certificate" | You signed with `Apple Development` or `iPhone Distribution` — both wrong type. Use `Developer ID Application` specifically. |

---

## When this can be deferred

For internal beta with users you trust, the `.zip` distribution (BETA.md) is
acceptable: recipients right-click → Open → Gatekeeper one-time approves the
ad-hoc-signed .app. Faster than getting Developer ID set up.

For public launch (Product Hunt, Hacker News, etc.) — Developer ID + notarization
is **non-negotiable** on macOS 26.5+. Without it, the majority of users will
hit "Apple cannot verify Gap Map is free of malware" and abandon the install.
