# Gap Map — License flow (website) + desktop-app change list

> Free mode is ON (`BILLING_ENABLED=0`): keys are issued free, LemonSqueezy is
> disabled. The owner can disable/expire any key at any time.

## 1. The flow a user goes through (website)

1. **Sign in** — `/sign-in` → Supabase email + password (sign up if new).
2. **Dashboard** — `/dashboard` (login-gated). On first visit it **auto-issues a
   free license key** and shows the **full key once** with a **Copy** button.
   (Manual "Get my free key" button is also there.)
3. **Activate the app** — user opens the Gap Map desktop app → activation screen
   → pastes **key + the email they signed in with** → the device activates
   (a device fingerprint is bound to the key).
4. **Manage devices** — the machine shows under **Activated devices**
   (os/arch, fingerprint, activated + last-seen). User can **Deactivate** to free
   a seat (free plan = `FREE_MAX_DEVICES`, default 2).
5. **Owner disables a key (any time)** — `/admin` page (or curl) → revoke /
   re-enable / expire by email. After revoke: new activations are refused **and**
   the running app locks on its next periodic check.

## 2. Website API contract (what the desktop app talks to)

Base: your deployed site, e.g. `https://YOUR_SITE`

| Purpose | Method + path | Auth | Body | Returns |
|---|---|---|---|---|
| Activate a device | `POST /api/v1/device/activate` | none | `{email, activation_key, device_signature(64-hex sha256), os, arch}` | `{ok, token(JWT), license_id, expires_at, devices_used, max_devices}` |
| Periodic re-check | `POST /api/v1/licence/validate` | `Bearer <token>` | `{device_fingerprint(64-hex)}` | `{valid, revoked, refreshed_token?}` |
| Free key (web) | `POST /api/v1/licence/free` | `Bearer <supabase-session>` | — | `{ok, activation_key, ...}` (full key first time) |
| Deactivate device | `POST /api/v1/device/deactivate` | `Bearer <token>` | `{device_fingerprint}` | `{ok, removed}` |
| Owner disable/enable/expire | `POST /api/v1/admin/license` | header `x-admin-secret` | `{action:"revoke"|"reactivate"|"expire", email}` | `{ok, status}` |

JWT: HS256, issuer `gapmap-activation-suite`, audience `gapmap-desktop`, 180d,
signed with **`TOKEN_SIGNING_SECRET`**. Claims include `device_fingerprint`
(anti-sharing), `plan_id`, `features`.

## 3. Changes needed in the DESKTOP app (not done yet — list)

The app already has the license framework (`commands.rs`: `license_activate`,
`license_server_check`, `compute_activation_reason`, JWT device-binding). To make
it work against this website and actually enforce:

1. **Point at the site** — set the license `api_base` default to `https://YOUR_SITE`
   (today it's a dev/local default).
2. **Fix endpoint paths** — the app currently calls `/v1/license/activate` &
   `/v1/license/revoke`. Change to:
   - activate → `POST /api/v1/device/activate`
   - periodic check → `POST /api/v1/licence/validate` (Bearer token + `device_fingerprint`)
   - there is **no app-side revoke**; the app learns it's revoked from the
     `validate` response `{revoked:true}`.
3. **Shared JWT secret** — set the app's build-time **`JWT_DESKTOP_SECRET`** equal
   to the site's **`TOKEN_SIGNING_SECRET`** (today the app logs "JWT_DESKTOP_SECRET
   missing; using debug fallback"). Accept issuer/audience above.
4. **Turn the gate ON** — `GAPMAP_LICENSE_GATE_ENABLED=1` for release builds, and
   extend the gate from MCP-only to the whole app (add `ensure_activated()` to
   `run_cli` so collect/enrich/chat/map all require activation). This is the
   "won't work without a key" change.
5. **Periodic re-validation + lock** — call `validate` on launch and every N days;
   on `{revoked:true}`/invalid → lock the UI ("license disabled — contact owner")
   and clear the token. Swap to `refreshed_token` when present.
6. **Activation screen** — launch gate UI: email + key → calls activate → stores
   token (the `license_activate` command already exists; wire it to the site).
7. **Device fingerprint** — keep sending the sha256 fingerprint as
   `device_signature` (activate) / `device_fingerprint` (validate). Already present.
8. **(optional) Deactivate on logout** — call `device/deactivate` so the seat frees.

## 4. Owner cheat-sheet — disable a key

```bash
curl -X POST https://YOUR_SITE/api/v1/admin/license \
  -H "x-admin-secret: $ADMIN_SECRET" -H "content-type: application/json" \
  -d '{"action":"revoke","email":"user@example.com"}'      # disable
#  "action":"reactivate"  → re-enable      "action":"expire" → expire now
```
Or use the **`/admin`** page.
