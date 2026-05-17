# Future scope — signing, secrets & auto-update (deferred for the v0.1.0 unsigned beta)

**Decision (2026-05-17):** v0.1.0 ships as an **unsigned beta**. The items below
were consciously deferred so the first release could go out without the manual
Apple-dashboard work. None of them block an unsigned beta; all of them are
needed before a "1.0 / public" release. The step-by-step *how* lives in
[`publish-macos.md`](./publish-macos.md) — this file is the *what / why / when*.

---

## 1. `JWT_DESKTOP_SECRET` — add to GitHub Secrets

- [ ] Add `JWT_DESKTOP_SECRET` to
      <https://github.com/shaantanu9/gap-map-pro/settings/secrets/actions>

**What it is.** A ≥32-char random secret baked into the binary at compile time
(`app-tauri/src-tauri/build.rs`). It is the HMAC key that verifies offline
license tokens issued by the marketing/activation site.

**Why it's deferred.** `release.yml` has a fallback: if the secret isn't set it
generates a random one per build (see the "Set JWT_DESKTOP_SECRET fallback"
step). So an unsigned beta build still succeeds.

**What's degraded without it.** Every release build bakes a *different* random
secret, so a license token activated against build A fails on build B. License
activation is therefore **not stable across builds** until a fixed secret is
set. Fine for a beta with no paid licensing; not fine once licensing is live.

**The value already exists.** It was generated on 2026-05-12 and is stored
locally (untracked) in `.env.publish` at the repo root:
`JWT_DESKTOP_SECRET=5c42acb9…`. Use that exact value — do **not** generate a new
one, or any license token already minted with the old value breaks.

**Why it matters.** Bake-once / never-rotate: treat it like a database master
key. Rotating it after release un-activates every existing install.

---

## 2. Developer ID Application certificate + notarization

- [ ] Create the **Developer ID Application** cert (Apple Developer portal)
- [ ] Export it as `developer-id.p12`
- [ ] Add `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`,
      `APPLE_SIGNING_IDENTITY`, `APPLE_TEAM_ID`, and the notarization creds
      (`APPLE_ID` + `APPLE_PASSWORD`, or the API-key trio) to GitHub Secrets

**What it is.** The cert that signs a macOS app for distribution *outside* the
App Store, plus Apple's notarization service that scans + blesses the build.

**Why it's deferred.** The account currently has only Apple Development and
iPhone Distribution certs — neither works for a notarized DMG. Creating the
Developer ID cert is a ~30-min manual task on developer.apple.com that cannot
be automated. Full steps: `publish-macos.md` §2–§5.

**What's degraded without it.** `release.yml` detects the missing
`APPLE_CERTIFICATE` secret and runs the **unsigned** build path. The DMG works,
but on first launch macOS Gatekeeper shows *"app can't be opened because Apple
cannot check it for malicious software"* — users must right-click → **Open** to
bypass it. Acceptable for a beta; a conversion-killer for a public launch.

**What changes when added.** Nothing in code. `release.yml` already has both a
signed and an unsigned `tauri-action` step gated on `env.HAS_APPLE_CERT`; once
the secrets exist the signed path fires automatically and the release stops
being marked "(unsigned)".

**Why it matters.** Without signing+notarization, a meaningful share of
non-technical users will hit the Gatekeeper wall and never open the app.

---

## 3. Auto-update (`tauri-plugin-updater`)

- [ ] Add `tauri-plugin-updater` to `app-tauri/src-tauri`
- [ ] Configure the `updater` block in `tauri.conf.json` with the public key
- [ ] Sign release artifacts with `TAURI_SIGNING_PRIVATE_KEY` (already wired as
      a CI env var in `release.yml`)
- [ ] Publish an update manifest endpoint (GitHub Releases `latest.json`)

**What it is.** In-app update — the app checks for a newer version on launch and
installs it, instead of the user re-downloading a DMG.

**Why it's deferred.** Not needed to ship v0.1.0; it's a quality-of-life layer.

**What's degraded without it.** Every new version requires the user to manually
re-download and re-install the DMG. Beta testers will tolerate it; it caps
retention once there's a real user base.

**Why it matters.** Without auto-update, bug-fix releases reach only the
fraction of users who manually re-download — slow propagation of fixes.

---

## 4. (Tracking) Linux + Windows build hardening

- [ ] Add an ffmpeg sidecar for Linux + Windows, or document video-ingest as
      macOS-only

`release.yml` builds Linux + Windows bundles, but the ffmpeg sidecar is fetched
only for macOS. On Linux/Windows the **video-ingest** feature degrades
gracefully (clean error, no crash). Out of scope for the macOS-first beta; fix
before promoting Linux/Windows from "untested" to supported.

---

## Upgrade path: unsigned beta → signed 1.0

1. Do §1 (JWT secret) and §2 (Developer ID cert + notarization secrets).
2. Re-tag (`v1.0.0`). `release.yml` auto-takes the signed path — no code change.
3. Verify locally first: `spctl -a -vv <DMG>` must report
   *"source=Notarized Developer ID"* (see `publish-macos.md` §6).
4. Then do §3 (auto-update) so 1.0 → 1.x ships without manual re-downloads.
