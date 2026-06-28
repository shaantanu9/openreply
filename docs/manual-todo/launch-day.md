# Launch-day checklist — OpenReply

Everything in-code is done (P0 + P1 + P2 ticked in `docs/mvp-checklist.md`,
13/13 tests green). This file lists the **manual steps** that can't be
automated from code and must happen at launch.

---

## 1. First launch + smoke test (DO THIS FIRST)

Before anything else, open the built DMG on your own Mac and run the full
user flow. Catch packaging-layer regressions before any user does.

- [ ] Drag `OpenReply.app` to `/Applications` → double-click
- [ ] On first open, macOS will say "can't verify the developer" — right-click → Open → Open. (Gatekeeper first-launch warning; ad-hoc signature only.)
- [ ] Splash screen → welcome step 1 → 4 → click any example topic
- [ ] Aggressive collect runs → watch the "Now" banner tick through discover/fetch/sources/enrich/export
- [ ] Map tab populates (openreply-map HTML renders in iframe)
- [ ] Report tab loads the pro report (no "Load failed")
- [ ] Evidence tab shows painpoints / features / workarounds
- [ ] Chat tab answers a question about the topic grounded in the graph
- [ ] Settings → Local data shows "✓ DB connected"
- [ ] Sidebar icons all render (Lucide SVGs, no emoji fallbacks)

If anything above fails → capture `Console.app` logs filtered to "OpenReply" and file an issue.

---

## 2. Code signing (one-time per Apple account)

Ad-hoc signing (what we have now) works for local distribution but **users
will see "unidentified developer" warnings**. For real distribution:

- [ ] Apple Developer account enrolled ($99/yr)
- [ ] **Developer ID Application** certificate installed in Keychain
- [ ] Certificate's common name → paste into `tauri.conf.json` under `bundle.macOS.signingIdentity`:
  ```json
  "macOS": {
    "minimumSystemVersion": "10.15",
    "entitlements": "./Entitlements.plist",
    "signingIdentity": "Developer ID Application: Your Name (TEAMID)"
  }
  ```
- [ ] Rebuild → now `.app` is signed, but **not yet notarized**

---

## 3. Notarize + staple (required for Gatekeeper-friendly DMG)

Run ONCE to register an app-specific password:
```bash
# Generate at https://appleid.apple.com → Sign-In & Security → App-Specific Passwords
xcrun notarytool store-credentials openreply-notary \
  --apple-id "your@email" \
  --team-id "TEAMID" \
  --password "xxxx-xxxx-xxxx-xxxx"
```

Then per-release:
```bash
# 1. Submit the .dmg (or the notarization-zip of the .app)
xcrun notarytool submit src-tauri/target/release/bundle/dmg/*.dmg \
  --keychain-profile openreply-notary \
  --wait

# 2. Once accepted (1-10 min typically), staple the ticket
xcrun stapler staple src-tauri/target/release/bundle/dmg/*.dmg

# 3. Verify
xcrun stapler validate src-tauri/target/release/bundle/dmg/*.dmg
spctl -a -t install src-tauri/target/release/bundle/dmg/*.dmg
# Expect: "accepted source=Notarized Developer ID"
```

- [ ] Notarization request submitted
- [ ] "Accepted" email received from Apple
- [ ] Ticket stapled to the DMG
- [ ] `spctl -a -t install ...` → "accepted"

Without this, users MUST right-click → Open on first launch. With this, they
double-click and it just runs.

---

## 4. Python sidecar signing (separate from app bundle)

The bundled `reddit-cli-aarch64-apple-darwin` sidecar also needs a signature
for macOS Gatekeeper to not re-verify every invocation (2+ min hang).

- [ ] Already ad-hoc signed:
  ```bash
  codesign -dv app-tauri/src-tauri/binaries/reddit-cli-aarch64-apple-darwin 2>&1 | grep Signature
  # Expect: Signature=adhoc
  ```
- [ ] For Developer ID signing (inherits from app bundle):
  ```bash
  codesign --force --deep --options runtime \
    --sign "Developer ID Application: Your Name (TEAMID)" \
    app-tauri/src-tauri/binaries/reddit-cli-aarch64-apple-darwin
  ```
- [ ] Rebuild + notarize the whole app — the sidecar is verified as part of the bundle

---

## 5. Copy + asset checklist

- [ ] App name: "OpenReply" ✓ (tauri.conf.json productName)
- [ ] Version: bump `0.1.0` → `0.1.1` or `1.0.0` in `tauri.conf.json` + `pyproject.toml` before any re-release
- [ ] Bundle identifier: `com.shantanu.openreply` ✓
- [ ] Icons: 32, 128, 128@2x, .icns, .ico ✓
- [ ] **Missing:** no `longDescription` for landing page, no screenshots, no README link in About card

---

## 6. Distribution channels (pick one)

- [ ] **GitHub Releases** — upload DMG, write release notes, pin as Latest. Free, no review.
- [ ] **Direct download from shaantanu98.github.io** — host DMG on a CDN or S3. Need SSL + good UX.
- [ ] **Homebrew cask** — submit a cask recipe to `homebrew-cask` after first stable release.
- [ ] **Mac App Store** — needs sandbox entitlements (current Entitlements.plist is NOT sandbox-ready), in-app purchase integration for any paid tier.

Recommended first release path: GitHub Releases + Homebrew cask once stable.

---

## 7. Privacy + telemetry disclosures (required before public release)

OpenReply fetches from Reddit public JSON, HN, arXiv, app stores, etc. Need an
explicit statement:

- [ ] Add "Privacy" section to README and in Settings → About:
  - All data stored locally in `~/Library/Application Support/com.shantanu.openreply/`
  - No analytics, no telemetry, no cloud backups
  - API keys written to `~/.config/reddit-myind/.env` (chmod 600), never uploaded
  - LLM calls go directly to the provider the user configured (OpenAI/Anthropic/…/localhost Ollama)
- [ ] Link the Reddit API terms (`reddit.com/wiki/api-terms`) — we're within them but must credit Reddit
- [ ] MIT LICENSE file at repo root (already present)

---

## 8. Post-launch monitoring (first week)

- [ ] GitHub Issues opened for tracking feedback
- [ ] Check Ollama usage — any user reports of 404s / model loading failures
- [ ] Check Tauri crash logs (`~/Library/Logs/DiagnosticReports/OpenReply*.ips`)
- [ ] First-user walkthrough video / GIF for the README — adoption multiplier

---

## Reference: build commands

```bash
# Dev (venv Python bypass, ~500ms per sidecar call)
cd app-tauri && npm run tauri -- dev

# Production build (DMG output)
cd app-tauri && npm run tauri -- build
# → src-tauri/target/release/bundle/dmg/OpenReply_0.1.0_aarch64.dmg

# Rebuild the sidecar binary only
cd /path/to/reddit-myind
rm -rf build dist
.venv/bin/pyinstaller reddit-cli.spec
cp dist/reddit-cli app-tauri/src-tauri/binaries/reddit-cli-aarch64-apple-darwin
codesign --force --deep --sign - app-tauri/src-tauri/binaries/reddit-cli-aarch64-apple-darwin
```

---

## If anything blocks launch, the `tauri-python-sidecar-app` skill has the fix

Every bug from this session is catalogued in its Gotchas table
(`~/.claude/skills/tauri-python-sidecar-app/SKILL.md`). Includes "Load
failed" → asset-protocol scope, "No such option: --json" → hidden no-op,
hanging sidecar → dev-venv bypass, etc.
