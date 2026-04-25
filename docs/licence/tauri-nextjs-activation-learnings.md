# Tauri + Next.js Activation Flow — Complete Learnings & Runbook

> The full cross-app activation flow from local-dev setup through every
> failure mode we hit and fixed. This is the one document to read when
> anything goes wrong with desktop activation.

**Companion docs**
- `tauri-licence-impl.md` — the original spec
- `subscription-model.md` — server-side plan / LS / webhook spec
- `tauri-activation-runbook.md` — short day-to-day runbook
- `gapmap-dual-app-spec.md` — product-level dual-app architecture

---

## 1. Architecture in one picture

```
Next.js (Community + Pro licence portal)       Tauri (Pro desktop)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
activation-suite/ :3007                         app-tauri/
  signs JWT with                                  verifies JWT with
  TOKEN_SIGNING_SECRET  ───── both must ─────►   JWT_DESKTOP_SECRET
                            equal                (baked at compile
  writes licences +         exactly               time via build.rs)
  license_devices to
  Supabase Postgres
  ▲
  │ POST /api/v1/device/activate
  │     { email, password?, activation_key, device_signature, os, arch }
  │
  └─ 200 { ok:true, token:<JWT>, … }
                     │
                     ▼
                     Tauri decodes + verifies with baked-in secret
                     If valid → writes license_state.json
                     If signature bad → "invalid activation token: InvalidSignature"
```

The Tauri app's ONLY cross-DB touchpoint is activation. After that, it
runs fully offline on local SQLite at
`~/Library/Application Support/com.shantanu.gapmap/`. Licence data
(who holds a key, which devices) lives on Supabase. Research data
(topics, posts, insights) lives on the user's Mac. Never the twain shall
meet unless we add a `StorageBackend::Supabase` variant to the desktop.

---

## 2. Secret parity — the single most important rule

**`TOKEN_SIGNING_SECRET`** (server, runtime env) and
**`JWT_DESKTOP_SECRET`** (desktop, build-time env) MUST be the same
value. If they differ by a single byte, every JWT the server issues
fails verification on the desktop with
`invalid activation token: InvalidSignature`.

### How the secret reaches the desktop binary

`app-tauri/src-tauri/build.rs`:

```rust
let secret = match std::env::var("JWT_DESKTOP_SECRET") {
    Ok(s) => s,
    Err(_) if profile == "debug" => {
        println!("cargo:warning=JWT_DESKTOP_SECRET missing; using debug fallback secret.");
        "dev-local-jwt-secret-change-before-release-0123456789".into()
    }
    Err(_) => panic!("JWT_DESKTOP_SECRET must be set at build time"),
};
println!("cargo:rustc-env=JWT_DESKTOP_SECRET={}", secret);
```

The `rustc-env` line makes the secret accessible via `env!(...)` at
compile time — i.e., it is a literal string inside the compiled binary.

### Correct launch (single shell, single command)

```bash
cd app-tauri
set -a ; source ../act_suit/activation-suite/.env ; set +a
export JWT_DESKTOP_SECRET="$TOKEN_SIGNING_SECRET"
export GAPMAP_LICENSE_API_BASE="http://127.0.0.1:3007"

# From the SAME shell — this guarantees env propagates to cargo
npm run tauri dev > /tmp/tauri-dev.log 2>&1 &
```

### Wrong launch (we hit this one)

Launching in one shell, then editing files in another, and the
watcher-triggered rebuilds pick up an ENV without `JWT_DESKTOP_SECRET`.
Result: some rebuilds bake the real secret, some bake the fallback,
and whichever binary is running at activation time decides whether it
works.

**Diagnostic:** `grep -c "JWT_DESKTOP_SECRET missing" /tmp/tauri-dev.log`.
Any number > 0 means at least one build in this session used the
fallback — if that binary is what's running, activation breaks.

---

## 3. Boot flow + every failure mode we hit

### 3.1 Splash window stuck forever (blank screen after close)

Symptom: splash either never closes, or closes to reveal a blank main
window.

Root causes we found:

1. **ESM module-parse failure inside `main.js`'s import graph.**
   Specifically, a duplicate `import { open as openDialog } from
   '@tauri-apps/plugin-dialog';` in `settings.js` — two identical
   lines. ES modules reject duplicate bindings, so `settings.js`
   never evaluates, so `main.js` (which imports `renderSettings`)
   never evaluates. The `DOMContentLoaded` handler never runs,
   `api.closeSplash()` never fires, and the splash persists.
2. **Webview-URL race on dev rebuild.** When the binary rebuilds
   and relaunches while vite is mid-restart, the webview's initial
   navigation to `http://localhost:1420` 404s and the main window
   comes up blank-but-present.
3. **Initial cold-start slowness**: first `uv run` / PyInstaller
   sidecar spawn + first `renderHome()` can take 10–15 s, during
   which the splash stays up — user thinks it's hung.

Fixes baked in permanently:

- **Frontend** `main.js`: `setTimeout(() => api.closeSplash(), 0)` at
  the top of `DOMContentLoaded`, so splash dismisses as soon as main.js
  runs — before any route-level awaits.
- **Rust** `main.rs::setup()`: 6-second safety-net timer that
  force-closes the splash, shows the main window, and runs
  `main.eval("if(!document.querySelector('.app *')){location.reload();}")`.
  The reload heals the webview-URL race: by T+6 s vite is definitely
  bound to 1420, so re-navigation succeeds.
- **Rust** `main.rs::setup()`: `#[cfg(debug_assertions)]
  main.open_devtools()` so any future blank-screen incident shows the
  real JS error in the Console tab.

### 3.2 "Login failed. Check email/password" for trial licences

Symptom: user pastes correct email + password + key, server returns
401. Direct Supabase password-grant works fine (curl returns JWT), but
`/api/v1/device/activate` returns invalid.

Root cause: `/api/v1/trial/start` creates a licence with a random
`password_hash` (`crypto.randomBytes(32).toString('hex')`). That's
intentional — trial users authenticate via Supabase session, not a
password. But the legacy `activateDeviceSupabase` was matching
licences by `(email, password_hash, activation_key_hash)` — three-way
AND. No password the user types can match a random 256-bit hash.

Fix: dropped `password_hash` from the lookup. `activateDeviceSupabase`
and `activateDevice` (file store) now match on `(email,
activation_key_hash)` only. Rationale: possession of the 16-char A-Z/2-9
key already carries ~80 bits of entropy — matches Lemon Squeezy /
Paddle / Gumroad models. Email is scope hint, not secret. Password
field in the request body is accepted but ignored.

Before:
```ts
.eq("email", email)
.eq("password_hash", passwordHash)      // removed
.eq("activation_key_hash", keyHash)
```

After:
```ts
.eq("email", email)
.eq("activation_key_hash", keyHash)
```

### 3.3 "device limit reached" (409)

Symptom: first activation attempt works, subsequent attempts return
409 because the `license_devices` table has a row for a previous
(possibly synthetic) device.

Root cause: trial licences default to `max_devices = 1`. Any test-curl
you run against `/api/v1/device/activate` with a random
`device_signature` consumes the slot.

Fixes (any combination):

```bash
# Wipe all devices for a licence
curl -X DELETE -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  "$SUPABASE_URL/rest/v1/license_devices?license_id=eq.<id>"

# Or bump max_devices
curl -X PATCH -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"max_devices": 2}' \
  "$SUPABASE_URL/rest/v1/licenses?id=eq.<id>"
```

### 3.4 `invalid activation token: InvalidSignature` (JWT mismatch)

Root cause: described in §2. The running desktop binary was built
with a DIFFERENT `JWT_DESKTOP_SECRET` than the server's current
`TOKEN_SIGNING_SECRET`.

Step-by-step fix:

```bash
# Kill everything. pkill npm alone leaves the child target/debug/gapmap
# detached — it must be killed explicitly.
pkill -9 -f "target/debug/gapmap"
pkill -9 -f "tauri dev"
pkill -9 -f "npm run tauri"
# Free port 1420 from any dangling vite
PORT_PID=$(lsof -tiTCP:1420 -sTCP:LISTEN)
[ -n "$PORT_PID" ] && kill -9 $PORT_PID

sleep 2

# Rebuild from scratch with the correct env in the SAME shell
cd app-tauri
set -a ; source ../act_suit/activation-suite/.env ; set +a
export JWT_DESKTOP_SECRET="$TOKEN_SIGNING_SECRET"
export GAPMAP_LICENSE_API_BASE="http://127.0.0.1:3007"

# Force build.rs to re-run even if cargo thinks nothing changed
touch src-tauri/build.rs

npm run tauri dev > /tmp/tauri-dev.log 2>&1 &

# Verify: no fallback warning
sleep 30
grep -c "JWT_DESKTOP_SECRET missing" /tmp/tauri-dev.log  # must be 0
```

### 3.5 Onboarding Step 3 (LLM provider) stuck on loading

Root cause: Step 3 blocked the Continue button while awaiting
`runHealthCheck()` (spawns Python sidecar, 10–15 s cold) + serial
`Promise.all(api.testLlm)` (one slow provider blocks all others).

Fix: Continue button is enabled from the start. Checks run in
background with tight timeouts (8 s health, 6 s per provider) and
surface as supplementary info. User can always continue.

---

## 4. Known-working credentials fixture

Credentials below are stable for the local-dev Supabase as long as the
user isn't deleted and the licence row exists:

```
Email:    desktop-test+1776995604@gapmap-dev.local
Password: anything (ignored since §3.2 fix)
Key:      BWCS-JSSC-M8CL-6BA8
API base: http://127.0.0.1:3007
licence:  fe3db956-cae3-4362-9703-02e3b82afb0a
```

If expired or deleted, re-mint:

```bash
set -a ; source act_suit/activation-suite/.env ; set +a
EMAIL="desktop-test+$(date +%s)@gapmap-dev.local"
PASS="Test_$(date +%s)_pw"
UID=$(curl -fs -X POST "$SUPABASE_URL/auth/v1/admin/users" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"email_confirm\":true}" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
JWT=$(curl -fs -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $SUPABASE_ANON_KEY" -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
curl -fs -X POST -H "Authorization: Bearer $JWT" \
  http://127.0.0.1:3007/api/v1/trial/start | python3 -m json.tool
```

---

## 5. Diagnostic cheatsheet

| Symptom | First thing to check | Typical fix |
|---|---|---|
| Splash stuck > 6 s | `tail -f /tmp/tauri-dev.log` for ESM parse errors | Fix the duplicate/missing import surfaced in devtools Console |
| Main window blank, splash gone | Devtools Console on main window | JS module failed to parse — find it in devtools |
| "Login failed." on activate | Is the licence a trial? | §3.2 — confirm `password_hash` isn't being checked |
| "device limit reached" (409) | `SELECT COUNT(*) FROM license_devices WHERE license_id = …` | §3.3 — DELETE the row or bump `max_devices` |
| "invalid activation token: InvalidSignature" | `grep "JWT_DESKTOP_SECRET missing" /tmp/tauri-dev.log` | §3.4 — full kill + rebuild with env |
| "Step 3 loading forever" | Is Python sidecar alive? | §3.5 — already shipped non-blocking fix |
| Next.js login fails silently | `console.error("[sign-in] …")` in devtools | Trim password field, check `data.session` returned |

---

## 6. Full clean-start procedure

When you come back to this later and nothing is running:

```bash
# 1. Next.js (the licence backend)
cd act_suit/activation-suite
PORT=3007 node_modules/.bin/next dev -p 3007 > /tmp/next-dev.log 2>&1 &
until curl -s http://127.0.0.1:3007/api/v1/health | grep -q ok ; do sleep 1 ; done

# 2. Tauri (from a shell that has TOKEN_SIGNING_SECRET in env)
cd ../../app-tauri
set -a ; source ../act_suit/activation-suite/.env ; set +a
export JWT_DESKTOP_SECRET="$TOKEN_SIGNING_SECRET"
export GAPMAP_LICENSE_API_BASE="http://127.0.0.1:3007"
npm run tauri dev > /tmp/tauri-dev.log 2>&1 &

# 3. Verify secrets match
grep -c "JWT_DESKTOP_SECRET missing" /tmp/tauri-dev.log  # 0

# 4. Full E2E smoke
(cd ../act_suit/activation-suite && PORT=3007 bash scripts/e2e-smoke.sh)
```

Stop:

```bash
pkill -f "next dev -p 3007"
pkill -9 -f "target/debug/gapmap"
pkill -9 -f "tauri dev"
pkill -9 -f "npm run tauri"
```

---

## 7. Changelog references

Every fix documented in a changelog:

- `2026-04-24_05_splash-safety-net.md` — 6 s Rust fallback + webview heal + devtools auto-open
- `2026-04-24_06_dupe-import-and-login-ux.md` — duplicate `openDialog` fix + Next.js login trim/replace/console.error
- `2026-04-24_07_jwt-env-propagation-and-home-null-guard.md` — shell env propagation + `renderHero` null guard
- `2026-04-24_08_onboarding-step3-non-blocking.md` — Continue enabled from start
- `2026-04-24_09_drop-password-from-device-activate.md` — remove `password_hash` from licence lookup
