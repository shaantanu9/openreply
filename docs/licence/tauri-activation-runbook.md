# Tauri Activation — Local Dev Runbook

End-to-end cross-app flow: start the Next.js web app, run the Tauri desktop
app, and activate a licence through the local server against the live
Supabase project.

## 0. Preconditions

- `act_suit/activation-suite/.env` populated (Supabase creds + TOKEN_SIGNING_SECRET + ALLOW_DEV_MINT=true).
- Both migrations applied to Supabase:
  `202604230004_license_plan_fields.sql`, `202604240005_community_schema.sql`,
  `202604240006_lemonsqueezy_ref_columns.sql`.
- macOS with Xcode CLT + rust + `npm run tauri` deps installed in `app-tauri/`.

## 1. Start the Next.js server (port 3007)

```bash
cd act_suit/activation-suite
PORT=3007 node_modules/.bin/next dev -p 3007 > /tmp/next-dev.log 2>&1 &
until curl -s http://127.0.0.1:3007/api/v1/health | grep -q ok ; do sleep 1 ; done
```

## 2. Start the Tauri app pointed at the local server

The Tauri `build.rs` demands `JWT_DESKTOP_SECRET` at compile time, and it
MUST equal the Next.js `TOKEN_SIGNING_SECRET` — otherwise the desktop
rejects every JWT the server issues with `invalid signature`.

```bash
cd app-tauri
set -a ; source ../act_suit/activation-suite/.env ; set +a
export JWT_DESKTOP_SECRET="$TOKEN_SIGNING_SECRET"
export OPENREPLY_LICENSE_API_BASE="http://127.0.0.1:3007"
npm run tauri dev > /tmp/tauri-dev.log 2>&1 &
```

First launch is slow — Rust compile ~1 min, sidecar boot ~10 s.
The dev file watcher will also rebuild after env changes; that's normal.

## 3. Mint an activation credential

```bash
set -a ; source act_suit/activation-suite/.env ; set +a
BASE=http://127.0.0.1:3007
EMAIL="desktop-test+$(date +%s)@openreply-dev.local"
PASS="DesktopTest_$(date +%s)_pw"

# Create confirmed Supabase user via admin API
USERID=$(curl -fs -X POST "$SUPABASE_URL/auth/v1/admin/users" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"email_confirm\":true}" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')

# Sign in, grab JWT
JWT=$(curl -fs -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $SUPABASE_ANON_KEY" -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')

# Start a 14-day trial — server mints the activation key
KEY=$(curl -fs -X POST -H "Authorization: Bearer $JWT" "$BASE/api/v1/trial/start" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["activation_key"])')

echo "Email:    $EMAIL"
echo "Password: $PASS"
echo "Key:      $KEY"
echo "API base: $BASE"
```

## 4. Activate the Tauri app

Once the Tauri window is loaded, walk through the welcome wizard to the
final step (Step 6 — Activation):

| Field | Value |
|---|---|
| Email | `$EMAIL` from step 3 |
| Password | `$PASS` from step 3 |
| Activation key | `$KEY` from step 3 (format `XXXX-XXXX-XXXX-XXXX`) |
| API base | `http://127.0.0.1:3007` |

Click **Activate**. The desktop POSTs to the local Next.js which writes a
`license_devices` row in Supabase and returns a JWT. That JWT is written to
`~/Library/Application Support/com.shantanu.openreply/license_state.json` and
the main dashboard unlocks.

## 5. Verify the activation landed on Supabase

```bash
set -a ; source act_suit/activation-suite/.env ; set +a
curl -s -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
     -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
     "$SUPABASE_URL/rest/v1/license_devices?select=signature_hash,os,arch,activated_at&order=activated_at.desc&limit=3" \
     | python3 -m json.tool
```

Expected: the most recent row has `os=macos`, `arch=aarch64` (or x86_64),
and `activated_at` within the last few minutes.

## 6. Two-DB architecture reminder (per `openreply-dual-app-spec.md`)

| App | Licence data | Research data |
|---|---|---|
| Next.js (Community) | Supabase `licenses`, `license_devices`, `byok_keys` | Supabase `workspaces`, `posts`, `insights`, `sweeps`, `published_research` |
| Tauri (Pro) | Reads/writes Supabase **only** at activate / deactivate / validate | Local SQLite at `~/Library/Application Support/com.shantanu.openreply/reddit.db` |

Workspaces created on the web **do not** show in the Tauri app, and
Tauri topics/posts **do not** show on the web. This is the spec's
privacy contract; changing it is a product-level decision (would need a
new `StorageBackend::Supabase` variant in the Tauri core engine).

## 7. Stop everything

```bash
pkill -f "next dev -p 3007"
pkill -f "tauri dev"
pkill -f "target/debug/openreply"
```

## 8. Safety nets already in place

- **Splash never gets stuck.** Rust `setup()` schedules a 6 s timer that
  force-closes the splash and shows the main window. Frontend also fires
  an early `closeSplash()` on next tick. See `changelogs/2026-04-24_05_splash-safety-net.md`.
- **Server-side secret fail-hard.** `TOKEN_SIGNING_SECRET` must exist on
  the Next.js server or `signingSecret()` throws. No silent fallback.
- **Sweep-engine stub is labelled.** `src/lib/community/sweepEngine.ts`
  generates plausible posts/insights. Replace with real source fetchers
  when porting the spec's shared Rust core crate.

## 9. When it breaks

| Symptom | First thing to check |
|---|---|
| Tauri window blank, no splash | main.js failed — `tail -f /tmp/tauri-dev.log` and check vite page-reload logs for syntax errors |
| `invalid signature` on activation | `JWT_DESKTOP_SECRET` at Tauri build time ≠ server `TOKEN_SIGNING_SECRET`. Export the server value, rebuild. |
| `activation_key invalid` | Wrong alphabet (should be A-Z + 2-9, no 0/O/1/I) or key was rotated. |
| `device limit reached` | Delete old device via the web `/dashboard` → devices → Deactivate. |
| Tauri splash stuck >6 s | Safety net misfired — inspect `src-tauri/src/main.rs::setup()`. |
