# OpenReply — Subscription Model & Server Contract

> Companion to `tauri-licence-impl.md` (desktop spec).
> Describes the **server-side** half of the licence system: plans, activation
> keys, JWT claims, API contract, webhook handshake, and Supabase schema.
> This file is authoritative — when desktop behaviour and this doc disagree,
> update the doc or the desktop, not the server silently.

**Files in play**

| Role | Path |
|---|---|
| Server | `act_suit/activation-suite/` (Next.js 15, App Router) |
| Marketing + web activate | `act_suit/html_site/` |
| Desktop | `app-tauri/` |
| Desktop spec | `docs/licence/tauri-licence-impl.md` |
| This doc | `docs/licence/subscription-model.md` |
| Tracker | `docs/licence/licence-implementation-tracker.md` |

---

## 1. Plan matrix

Five plans. `free` is the fallback when no JWT is present (or when a trial has
ended). `pro_trial` is a short-lived variant of `pro` gated on `trial_ends_at`.

| plan_id | max_workspaces | max_sources | scheduler | monitors | export_pdf | export_csv | history_days | max_devices | live_pass_active | is_trial |
|---|---|---|---|---|---|---|---|---|---|---|
| `free` | 1 | 3 | ✗ | ✗ | ✗ | ✗ | 30 | 1 | ✗ | ✗ |
| `pro` | ∞ | ∞ | ✗ | ✗ | ✓ | ✓ | 365 | 1 | ✗ | ✗ |
| `live_pass` | ∞ | ∞ | ✓ | ✓ | ✓ | ✓ | 365 | 2 | ✓ | ✗ |
| `team` | ∞ | ∞ | ✓ | ✓ | ✓ | ✓ | 365 | 3 | ✓ | ✗ |
| `pro_trial` | ∞ | ∞ | ✗ | ✗ | ✓ | ✓ | 365 | 1 | ✗ | ✓ |

Canonical TypeScript/Rust source of truth: `src/lib/features.ts` (server) and
`src-tauri/src/licence/features.rs` (desktop — to be created in Phase G). The
two must stay in sync: the full `features` object is embedded inside the JWT,
so even offline desktops gate correctly.

### Trial resolution

Trial overrides plan only while `is_trial=true` AND `trial_ends_at` is in the
future. Once `trial_ends_at` passes:

1. The server's `/api/v1/licence/validate` endpoint returns a `refreshed_token`
   with `plan_id` downgraded to `free`.
2. The desktop applies it on next online launch — until then, the JWT exp
   (180 days) keeps offline users working on `pro_trial` terms.

Upgrade trial → pro: the purchase path (LS webhook) updates `plan_id='pro'`
and sets `is_trial=false`; next validate call refreshes the token.

---

## 2. Activation key format (spec §19)

```
XXXX-XXXX-XXXX-XXXX
Example: ABCD-EFGH-JKLM-NPQR
Alphabet: A-Z + 2-9      (no 0, O, 1, I — avoids transcription errors)
Length:   16 chars + 3 dashes
Storage:  sha256(raw_16_chars) in activation_key_hash column; raw NEVER stored
Email:    dashes included for readability
Input:    normalizeActivationKey() strips to A-Z0-9 and reformats
```

Generator: `src/lib/activationStore.ts::mintActivationKey()`.
Hashing: `src/lib/supabaseActivationStore.ts::hashSecret()`.

---

## 3. JWT shape (spec §7)

**Algorithm:** `HS256`
**Issuer:** `openreply-activation-suite`
**Audience:** `openreply-desktop`
**Default expiry:** 180 days

### Claims payload

```json
{
  "sub": "<license uuid>",
  "iss": "openreply-activation-suite",
  "aud": "openreply-desktop",
  "iat": 1731000000,
  "exp": 1746500000,

  "user_id": "usr_<uuid>",
  "email": "user@example.com",
  "device_fingerprint": "<sha256 hex of hardware fingerprint>",

  "plan_id": "pro",
  "live_pass_active": false,
  "is_trial": false,
  "trial_ends_at": null,

  "features": { /* Features object, identical to src/lib/features.ts */ }
}
```

Rules:

- Server signs with `TOKEN_SIGNING_SECRET`.
- Desktop verifies with `JWT_DESKTOP_SECRET` baked into the compiled binary.
  These two env vars MUST hold the same value. Failing this is silent:
  activations will simply return "invalid signature" on the desktop.
- Server never ships tokens over anything but HTTPS.
- Server never returns the raw secret in any API response.

---

## 4. API contract

Base URL: set on the desktop binary at build time via
`ACTIVATION_SERVER_URL` (the env var passed to `cargo build`). Fallback in the
unbuilt source is `https://your-activation-server.vercel.app` — this **must**
be overridden in CI.

### 4.1 `POST /api/v1/device/activate`

Called the first time a user enters a key in the desktop app.

**Request**
```json
{
  "email":              "user@example.com",
  "password":           "...",                     // see note 1
  "activation_key":     "ABCD-EFGH-JKLM-NPQR",
  "device_signature":   "<sha256 hex>",            // see note 2
  "app":                "openreply-desktop",
  "os":                 "macos",
  "arch":               "aarch64"
}
```

**Responses**
- `200 { ok: true, token, license_id, user_id, expires_at, devices_used, max_devices }`
- `400 missing required fields`
- `401 invalid credentials | invalid credentials or activation key`
- `403 license revoked | license expired`
- `409 device limit reached | activation key invalid`

_Note 1: the server currently requires `password` in addition to the key.
The Tauri spec §11 only shows email+key. This is a known divergence — see
`licence-implementation-tracker.md` §7 Q4. Until resolved, the desktop must
prompt for password on first activation._

_Note 2: `device_signature` and `device_fingerprint` are synonyms; the field
name is `device_signature` in the request body for backward compatibility and
`device_fingerprint` in the JWT claim._

### 4.2 `POST /api/v1/device/deactivate`

Called when the user clicks "Deactivate this device" in desktop Preferences,
or during uninstall. Frees one slot of `max_devices`.

**Headers:** `Authorization: Bearer <jwt>`

**Request**
```json
{ "device_fingerprint": "<sha256 hex>" }
```

**Responses**
- `200 { ok: true, removed: true|false }`
- `400 device_fingerprint must be a sha256 hex digest`
- `401 missing bearer token | invalid token`
- `500 deactivate failed`

### 4.3 `POST /api/v1/licence/validate`

Called by the desktop in a background task on every app launch (non-blocking,
4s timeout on the client). Detects revocation, expired trials, plan changes.

**Headers:** `Authorization: Bearer <jwt>`

**Request**
```json
{ "device_fingerprint": "<sha256 hex>" }
```

**Responses** (always 200 unless the token itself is malformed)
- `{ valid: true,  revoked: false }`
- `{ valid: true,  revoked: false, refreshed_token: "<new jwt>" }` — plan changed
- `{ valid: false, revoked: true }` — licence gone, plan downgraded, or device detached
- `{ valid: false, revoked: true, reason: "device_mismatch" }` — fingerprint in JWT ≠ body
- `401 { valid: false, revoked: true }` — token itself invalid/expired

On any `revoked: true`, the desktop wipes its stored JWT and falls back to the
free tier. On `refreshed_token`, the desktop saves the new JWT and re-renders
the plan UI.

### 4.4 `POST /api/v1/webhooks/lemonsqueezy` (Phase F — TODO)

HMAC-verified against `LS_WEBHOOK_SECRET`. Handles `order_created`,
`subscription_created`, `subscription_updated`, `subscription_cancelled`.

- `order_created` → look up variant-id → plan_id, mint key, insert `licenses`
  row, email key to customer via Resend.
- `subscription_updated` with status=`cancelled` → set `licenses.status =
  'expired'` OR flip `live_pass_active=false` depending on product.
- `subscription_created` with trial → `is_trial=true, trial_ends_at = trial end`.

Not yet implemented. Manual workflow for now: mint via `/api/v1/dev/mint` and
email the key manually.

### 4.5 `POST /api/v1/dev/mint`

Dev-only. Requires three guards, in order:

1. `ALLOW_DEV_MINT=true` env var
2. `NODE_ENV !== 'production'`
3. `X-Dev-Mint-Secret` header = `DEV_MINT_SECRET` env var
4. IP rate limit of 10 req/min (in-memory, per-instance)

**Request**
```json
{
  "email": "test@example.com",
  "password": "shared-password",
  "max_devices": 1,
  "plan_id": "pro",                  // optional — defaults to "pro"
  "live_pass_active": false,         // optional
  "is_trial": false,                 // optional
  "trial_ends_at": null              // optional ISO timestamp
}
```

**Response**
```json
{
  "ok": true,
  "license_id": "...",
  "user_id": "...",
  "email": "...",
  "activation_key": "ABCD-EFGH-JKLM-NPQR",
  "max_devices": 1,
  "status": "active",
  "plan_id": "pro",
  "live_pass_active": false,
  "is_trial": false,
  "trial_ends_at": null
}
```

---

## 5. Supabase schema

Canonical migrations (apply in order):

| # | File | Adds |
|---|---|---|
| 1 | `202604210001_activation_tables.sql` | `licenses`, `license_devices` + RLS |
| 2 | `202604220002_activation_security_hardening.sql` | `password_hash`, `activation_key_hash`, `activation_attempts`, tighter RLS |
| 3 | `202604220003_registration_billing_tokens.sql` | `user_subscriptions`, `payment_events`, `token_wallet` (not part of licence flow, used by registration/billing) |
| 4 | `202604230004_license_plan_fields.sql` | `plan_id`, `live_pass_active`, `is_trial`, `trial_ends_at` on `licenses` |

### `licenses` (after migration 4)

| column | type | note |
|---|---|---|
| `id` | uuid | primary key |
| `app_user_id` | uuid/null | FK to app-side user, nullable for dev-mint |
| `user_id` | text | opaque user id used in the JWT claim |
| `email` | text | lower-cased |
| `password` | text/null | legacy plaintext — retained nullable for rollback |
| `activation_key` | text/null | legacy plaintext — retained nullable for rollback |
| `password_hash` | text | sha256 |
| `activation_key_hash` | text | sha256 |
| `status` | text | `active` \| `revoked` \| `expired` |
| `max_devices` | integer | default 1 |
| `expires_at` | timestamptz/null | per-licence hard expiry (usually null for perpetual pro) |
| `plan_id` | text | `free` \| `pro` \| `live_pass` \| `team` \| `pro_trial` |
| `live_pass_active` | boolean | ✓ → scheduler+monitors available |
| `is_trial` | boolean | ✓ → trial flags in JWT |
| `trial_ends_at` | timestamptz/null | trial end |
| `created_at` | timestamptz | default now() |

### `license_devices`

| column | type |
|---|---|
| `id` | uuid |
| `license_id` | uuid (FK → licenses.id, cascade) |
| `signature_hash` | text (sha256 of hardware fingerprint) |
| `os` | text |
| `arch` | text |
| `activated_at` | timestamptz |
| `last_seen_at` | timestamptz |
| unique constraint on `(license_id, signature_hash)` | |

### `activation_attempts` (audit log)

| column | type |
|---|---|
| `id` | uuid |
| `occurred_at` | timestamptz |
| `email` | text |
| `license_id` | uuid/null |
| `device_signature_hash` | text |
| `outcome` | `success` \| `failed` |
| `error_code` | text/null |
| `http_status` | integer |

RLS: all three tables require service-role; the anon role has no access.

---

## 6. Environment variables

### Server (`activation-suite`)

| var | required | purpose |
|---|---|---|
| `TOKEN_SIGNING_SECRET` | **yes** | ≥32 chars. Must equal desktop `JWT_DESKTOP_SECRET`. |
| `SUPABASE_URL` | yes (prod) | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | yes (prod) | Service role — server only |
| `DEV_MINT_SECRET` | yes (for dev-mint) | shared secret for `/api/v1/dev/mint` |
| `ALLOW_DEV_MINT` | default=false | must be `"true"` to enable dev-mint endpoint |
| `LS_API_KEY` | Phase F | Lemon Squeezy API |
| `LS_STORE_ID` | Phase F | LS store |
| `LS_WEBHOOK_SECRET` | Phase F | HMAC verification |
| `RESEND_API_KEY` | Phase F | transactional email |

### Desktop (`app-tauri`, build-time)

| var | required | purpose |
|---|---|---|
| `JWT_DESKTOP_SECRET` | **yes at compile time** | ≥32 chars. Must equal server `TOKEN_SIGNING_SECRET`. Baked into binary via `build.rs`. |
| `ACTIVATION_SERVER_URL` | recommended | base URL for activation API calls; falls back to placeholder |

### Marketing (`html_site`)

All in `env.config.js` via `generate-env-config.mjs`. Only public values —
never bake `SUPABASE_SERVICE_ROLE_KEY`, `LS_WEBHOOK_SECRET`, etc. here.

---

## 7. Full happy path

```
1. Ship: CI builds the desktop with JWT_DESKTOP_SECRET=<S>.
         Server Vercel env has TOKEN_SIGNING_SECRET=<S>. These match.
2. User buys Pro → LS webhook → server mints key → emails user.
3. User installs desktop → launches → free tier applied.
4. User opens Preferences → Licence → pastes email+password+key.
5. Desktop POSTs /api/v1/device/activate with device_signature.
6. Server: verify credentials, insert license_devices row, sign JWT with
   full claims (including features{}), return token.
7. Desktop: verify JWT (sig + fingerprint match), save to OS keychain,
   update in-memory LicenceState, re-render.
8. Next app launch: desktop LicenceState::load() reads keychain, verifies,
   then spawns background validate_licence_online().
9. Server /api/v1/licence/validate: if plan changed or licence revoked,
   return { revoked } or { refreshed_token }.
10. Desktop uninstall / "deactivate this device":
    POST /api/v1/device/deactivate with fingerprint → server removes row.
```

---

## 8. Current status (cross-reference the tracker)

| Area | Status |
|---|---|
| JWT claims include full plan object | ✅ (B.1–B.3) |
| `/api/v1/device/deactivate` | ✅ (B.4) |
| `/api/v1/licence/validate` | ✅ (B.5) |
| Plan columns in `licenses` | ✅ (B.6) |
| Safe-alphabet keys | ✅ (C.1–C.2) |
| Dev-mint hardening | ✅ (C.3–C.4) |
| `TOKEN_SIGNING_SECRET` fallback removed | ✅ (A.2) |
| Lemon Squeezy webhook | 🔴 (Phase F, deferred) |
| Desktop Stronghold storage | 🔴 (Phase G.6) |
| Desktop feature gates | 🔴 (Phase G.12) |

See `licence-implementation-tracker.md` for the rolling done/remaining list.
