# Activation flow setup — desktop ↔ gapmap.myind.ai

This file documents the **one-time setup** you (the operator) do once, then
forget. After that the activation flow works for every new DMG you ship and
every new user who signs up on the website.

Website lives in https://github.com/shaantanu9/gapmap_web, deployed via
Vercel at https://gapmap.myind.ai. Desktop ships from this repo as a DMG.
The two communicate via the website's `/v1/device/activate` endpoint and a
shared HS256 JWT secret.

## The one critical alignment

Every activation does this round-trip:

```
Desktop (Tauri)                              Website (Vercel)
─────────────                                ─────────────
POST /v1/device/activate                  → activateLicenseForDevice()
{email, password, key, sig}                  validates against Supabase
                                          ← signs JWT with TOKEN_SIGNING_SECRET
                                             (HS256, iss=gapmap-activation-suite,
                                              aud=gapmap-desktop)
verifies JWT with JWT_DESKTOP_SECRET
stores in macOS keychain
```

**Vercel `TOKEN_SIGNING_SECRET` MUST equal local `.env.publish::JWT_DESKTOP_SECRET`.**

Any mismatch = every user gets `invalid signature` on activation.

## Setup checklist (one-time)

### 1. Decide on the production secret

Either:
- **Use the existing `.env.publish` value** (recommended — you've already
  shipped DMGs with this):
  ```
  JWT_DESKTOP_SECRET=5c42acb94177a10f351084bbd1e0e321816b4924db543a2883b7a601895d964f
  ```
- **OR generate a fresh one** (only do this if you want to rotate; it
  invalidates every previously-issued activation token):
  ```
  openssl rand -hex 32
  ```

### 2. Set Vercel env var

In the Vercel dashboard for project `gapmap_web`:

- Settings → Environment Variables
- Add **`TOKEN_SIGNING_SECRET`** with the value from step 1
- Apply to: **Production** (at minimum; usually also Preview + Development)
- Redeploy the project to pick up the new env

Verify via curl that the deploy is live:
```bash
curl https://gapmap.myind.ai/v1/health    # → {"ok":true}
```

### 3. Keep `.env.publish` matching

The desktop side bakes the secret at compile time via
`app-tauri/src-tauri/build.rs`. `scripts/publish-mac.sh` auto-sources
`.env.publish` before bundling, so as long as that file has the same
value, the DMG matches the deployed website.

To rebuild the DMG after a secret rotation:
```bash
scripts/publish-mac.sh --skip-sidecar
# Auto-sources .env.publish → bakes secret → builds DMG
```

### 4. Set up a test user + activation key in Supabase

Project `tjikcnsfaaqihgegecpi` (configured in `act_suit/activation-suite/.env`).

The exact schema depends on how `activationStore.ts` /
`supabaseActivationStore.ts` were wired. Sketch:

```sql
-- Table: licenses
-- Insert a row mapping a 16-char activation key to an email/password hash
INSERT INTO licenses (id, email, password_hash, activation_key,
                      max_devices, plan_id, live_pass_active)
VALUES (gen_random_uuid(),
        'shantanubombatkar2@gmail.com',
        crypt('your_password', gen_salt('bf')),
        'AAAA-BBBB-CCCC-DDDD',
        3,
        'pro',
        true);
```

(Read `act_suit/activation-suite/src/lib/supabaseActivationStore.ts` to
confirm column names; the Supabase service-role key is in
`act_suit/activation-suite/.env`.)

### 5. End-to-end smoke test

From the desktop DMG (after sourcing `.env.publish` and rebuilding):

1. Open Gap Map.app
2. Reach onboarding step 6 ("Activate licence")
3. **API base** should be pre-filled with `https://gapmap.myind.ai`
   (default added 2026-05-25 in `commands.rs::DEFAULT_LICENSE_API_BASE`)
4. Click "Test server" → green "Server reachable (200)"
5. Enter email + password + activation key from step 4
6. Click "Activate & continue"
7. Status flips green; MCP auto-installs into Claude Code/Cursor/etc.
8. Restart Claude Code → confirm 147 `gapmap_*` tools available

If step 6 errors with "activation token belongs to a different device" or
"invalid signature" → the secrets are not aligned. Re-run step 2.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Activation: `invalid signature` | Vercel `TOKEN_SIGNING_SECRET` ≠ local `JWT_DESKTOP_SECRET` | Re-run step 2 with the value from `.env.publish` |
| Activation: `activation token belongs to a different device` | User activated on Machine A, you're testing on Machine B with the same email; or hostname changed | License is bound to device signature — each machine activates independently |
| Activation: `activation api base is required` | Onboarding's API base field empty | Should be auto-filled now via `DEFAULT_LICENSE_API_BASE` constant; if still empty, rebuild with the latest commit |
| `gapmap.myind.ai/v1/health` returns 404 | Vercel redeploy stalled / wrong project | Trigger a manual redeploy in Vercel dashboard |
| MCP install still asks "not activated" after activation | Token-device fingerprint mismatch (rare) | `gapmap mcp uninstall && gapmap mcp install` after activating again |

## Files of record

- `app-tauri/src-tauri/build.rs` — bakes `JWT_DESKTOP_SECRET` at compile time
- `app-tauri/src-tauri/src/commands.rs` — `license_activate`, `license_status`,
  `verify_license_token`, `DEFAULT_LICENSE_API_BASE`
- `.env.publish` — gitignored; holds the production JWT secret + Apple signing
- `act_suit/activation-suite/.env` — gitignored; website env including
  `TOKEN_SIGNING_SECRET` (for local dev only — Vercel's env wins in prod)
- `act_suit/activation-suite/src/lib/token.ts` — JWT signing on the website side
- `act_suit/activation-suite/src/app/v1/device/activate/route.ts` — endpoint
