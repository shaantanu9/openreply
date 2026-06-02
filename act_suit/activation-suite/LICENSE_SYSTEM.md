# Gap Map — License System (website)

Complete reference for the activation-suite licensing: free keys, beta master
key, owner admin, and the desktop-app integration. Free mode is ON by default
(no payment); flip `BILLING_ENABLED=1` later to charge.

---

## 1. Environment config (`.env`)

| Var | Meaning |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Hosted store + auth. If set, the hosted (Supabase) path is used; otherwise a local JSON file store. |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser auth (sign-in). |
| `TOKEN_SIGNING_SECRET` (≥32 chars) | Signs activation JWTs. **Must equal the desktop app's `JWT_DESKTOP_SECRET`.** |
| `BILLING_ENABLED` | `0` = free mode (default). `1` = paid (LemonSqueezy on). |
| `NEXT_PUBLIC_BILLING_ENABLED` | Client mirror — controls dashboard free-vs-paid UI. |
| `FREE_MAX_DEVICES` | Devices per free license (default 2). |
| `ADMIN_SECRET` | Owner password for `/admin` + admin APIs. **Set a long random value.** |
| `MASTER_KEY` | Beta key that activates ANY device. Rotate to change, clear to revoke. |

---

## 2. User flow (free mode)

1. **Sign in / up** — `/sign-in` (Supabase email + password).
2. **Dashboard** — `/dashboard` (login-gated). Auto-issues a **free key**, shown
   once with **Copy** + a 3-step activation guide. Lists activated devices.
3. **Activate app** — open the desktop app → paste **key + sign-in email** →
   device activates (fingerprint-bound).
4. **Manage devices** — deactivate any device to free a seat (`FREE_MAX_DEVICES`).

### Beta master key (any device)
Give a tester the value of `MASTER_KEY` (e.g. `BETA-MAST-ER00-2026`) + any email.
It activates unlimited devices, no password. Each device gets its own
fingerprint-bound token.

---

## 3. Owner admin (`/admin`)

- **Login** — `/admin` → enter `ADMIN_SECRET` → sets an httpOnly session cookie
  (8h). No need to re-type after that.
- **Licenses table** — every license: email, status, plan, devices used,
  key suffix, with **Disable / Enable / Expire** buttons per row.
- **Disable (revoke)** → desktop app locks on next check + new activation refused.
- **Expire** → marks expired (same lock effect).
- **Master key status** shown; rotate/clear `MASTER_KEY` in env to change/revoke
  all beta access.
- **Log out** clears the session. Rotating `ADMIN_SECRET` invalidates all sessions.

CLI equivalent (header auth still works):
```bash
curl -X POST $BASE/api/v1/admin/license \
  -H "x-admin-secret: $ADMIN_SECRET" -H "content-type: application/json" \
  -d '{"action":"revoke","email":"user@example.com"}'   # or reactivate / expire
```

---

## 4. API contract (what the desktop app calls)

Base = deployed site, e.g. `https://YOUR_SITE`.

| Purpose | Method + path | Auth | Body | Returns |
|---|---|---|---|---|
| Activate device | `POST /api/v1/device/activate` | none | `{email, activation_key, device_signature(64-hex), os, arch}` (password optional for master key) | `{ok, token, license_id, expires_at, devices_used, max_devices, master?}` |
| Periodic re-check | `POST /api/v1/licence/validate` | `Bearer <token>` | `{device_fingerprint(64-hex)}` | `{valid, revoked, refreshed_token?, reason?}` |
| Free key (web) | `POST /api/v1/licence/free` | `Bearer <supabase session>` | — | `{ok, activation_key, ...}` |
| Deactivate device | `POST /api/v1/device/deactivate` | `Bearer <token>` | `{device_fingerprint}` | `{ok, removed}` |
| Admin: session | `GET /api/v1/admin/auth` | — | — | `{configured, authed}` |
| Admin: login/out | `POST /api/v1/admin/auth` | — | `{action:"login"|"logout", secret?}` | sets/clears cookie |
| Admin: list | `GET /api/v1/admin/licenses` | cookie or `x-admin-secret` | — | `{ok, master_key_enabled, licenses[]}` |
| Admin: disable/enable/expire | `POST /api/v1/admin/license` | cookie or `x-admin-secret` | `{action, email}` | `{ok, status}` |

JWT: HS256, issuer `gapmap-activation-suite`, audience `gapmap-desktop`, 180d,
claims include `device_fingerprint` (anti-sharing) + `features`. Master tokens
add `is_master` + `master_sig` (revoked when `MASTER_KEY` rotates/clears).

---

## 5. Run + test locally

```bash
cd act_suit/activation-suite
npm install
npm run dev            # http://localhost:3000 (we used -p 3939 in testing)
```
- User flow: open `/sign-in` → create account → `/dashboard` shows your key.
- Admin: open `/admin` → sign in with `ADMIN_SECRET` → disable a key.
- Free-mode end-to-end + master key + admin were verified via curl
  (login→key→activate→validate→revoke→locked; master key any-device + rotate).

---

## 6. Desktop-app changes needed (NOT done yet)

The app already has the license framework (`commands.rs`). To make it work
against this site + actually enforce:

1. **Point at the site** — license `api_base` default → `https://YOUR_SITE`.
2. **Fix endpoint paths** — activate → `POST /api/v1/device/activate`;
   periodic check → `POST /api/v1/licence/validate` (Bearer + `device_fingerprint`);
   no app-side revoke (app learns from `validate → {revoked:true}`).
3. **Shared secret** — app build-time `JWT_DESKTOP_SECRET` == site
   `TOKEN_SIGNING_SECRET`; accept issuer/audience above.
4. **Turn the gate ON** — `GAPMAP_LICENSE_GATE_ENABLED=1` for releases, and
   extend gating from MCP-only to `run_cli` so the whole app needs activation.
5. **Periodic re-validate + lock** — on launch + every N days; on
   `{revoked:true}`/invalid → lock UI ("license disabled — contact owner"),
   clear token; swap to `refreshed_token` when present.
6. **Activation screen** — email + key → calls activate → stores token. Master
   key needs no special handling (it returns a normal valid token).
7. **Device fingerprint** — keep sending sha256 as `device_signature` (activate)
   / `device_fingerprint` (validate).
8. **(optional)** Call `device/deactivate` on logout to free a seat.

---

## 7. Before deploying
- Set a long random `ADMIN_SECRET`.
- Set `TOKEN_SIGNING_SECRET` (≥32) and bake the same value as the app's
  `JWT_DESKTOP_SECRET`.
- Pick a real `MASTER_KEY` for beta (or clear it to disable the master key).
- Keep `BILLING_ENABLED=0` while free.
