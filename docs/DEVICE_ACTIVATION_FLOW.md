# Device Activation Flow (Per-Device License Lock)

This document explains the full activation system for `reddit-myind`:

- what is already implemented in app code
- what backend pieces are still required
- how to validate the flow end-to-end
- how to operate and support users safely

---

## 1) Goal

Enforce paid app usage by binding one activation key to one device signature.

Rules:

1. Onboarding cannot complete until activation succeeds.
2. App routes stay locked behind activation.
3. Activation key should fail on other devices unless server policy allows transfer/reset.
4. Optional features (LLM keys, Reddit keys) remain optional.

---

## 2) Current App-Side Implementation (already done)

### Frontend

Files:

- `app-tauri/src/screens/welcome.js`
- `app-tauri/src/main.js`
- `app-tauri/src/api.js`

Behavior:

- Onboarding now has a mandatory Step 6: **Activate device**.
- Product mode no longer bypasses activation.
- User must provide:
  - license API base URL (HTTPS)
  - email
  - password
  - activation key (`XXXX-XXXX-XXXX-XXXX`)
- App validates input before calling backend.
- Route guard in `main.js` forces user to `#/welcome` if:
  - onboarding is not complete, or
  - local activation marker is missing.

### Rust / Tauri commands

File:

- `app-tauri/src-tauri/src/commands.rs`

Implemented commands:

- `device_signature`
- `license_status`
- `license_activate`
- `license_server_check`
- `license_logout`

---

## 3) Device Signature Strategy

The app builds `device_signature` from:

- stable local `device_id` file (generated once)
- OS
- CPU architecture
- hostname

Then hashes with SHA-256.

Notes:

- Signature is deterministic for this install/device context.
- Stored files:
  - `device_id`
  - `license_state.json`
- On Unix, permissions are tightened (`0600`) after write.

---

## 4) Backend Required (you must build this now)

You need a license server with these endpoints.

## 4.1 `GET /v1/health` (or `/health`, `/healthz`)

Used by `license_server_check`.

Response:

```json
{ "ok": true }
```

## 4.2 `POST /v1/device/activate`

Request body (from app):

```json
{
  "email": "user@company.com",
  "password": "plain-or-app-password",
  "activation_key": "ABCD-EFGH-IJKL-MNOP",
  "device_signature": "sha256hex...",
  "app": "gapmap-desktop",
  "os": "macos",
  "arch": "aarch64"
}
```

Expected success response:

```json
{
  "ok": true,
  "token": "jwt-or-session-token",
  "license_id": "lic_123",
  "user_id": "usr_123",
  "expires_at": "2027-01-01T00:00:00Z"
}
```

Current app accepts either `token` or `access_token`.

---

## 5) Recommended Database Schema

Use any DB. Example relational schema:

## 5.1 `users`

- `id` (pk)
- `email` (unique)
- `password_hash`
- `created_at`

## 5.2 `licenses`

- `id` (pk)
- `user_id` (fk users.id)
- `activation_key_hash` (unique)
- `plan`
- `status` (`active`, `revoked`, `expired`)
- `max_devices` (default 1)
- `expires_at` (nullable)
- `created_at`

## 5.3 `license_devices`

- `id` (pk)
- `license_id` (fk licenses.id)
- `device_signature_hash`
- `os`
- `arch`
- `hostname_snapshot` (optional)
- `first_activated_at`
- `last_seen_at`
- `revoked_at` (nullable)
- unique index on (`license_id`, `device_signature_hash`)

## 5.4 `license_events` (audit log)

- `id`
- `license_id`
- `event_type` (`activate_ok`, `activate_fail`, `revoke`, `reset_device`)
- `ip`
- `user_agent`
- `detail_json`
- `created_at`

---

## 6) Activation Logic (server-side)

Pseudo flow for `POST /v1/device/activate`:

1. Validate fields present and format.
2. Authenticate user (`email`, `password`).
3. Lookup license by activation key.
4. Ensure license belongs to authenticated user.
5. Ensure license status is active and not expired.
6. Lookup existing device row for this signature:
   - if exists and not revoked: success (idempotent activate).
7. Count active devices:
   - if count >= `max_devices`: reject with clear error.
8. Insert new device activation row.
9. Issue signed token.
10. Return `ok=true` + token + ids.

---

## 7) Validation and Error Contracts

Return clean HTTP errors:

- `400`: bad format / missing fields
- `401`: bad email/password
- `403`: license revoked/expired
- `409`: device limit reached or key bound to different user/device policy
- `500`: internal errors

Message examples:

- `"invalid credentials"`
- `"activation key invalid"`
- `"device limit reached"`
- `"license expired"`

These map to better UI strings already added in onboarding.

---

## 8) How App Decides “Activated”

Current app uses two checks:

1. Local marker: `gapmap.license.activated === true`
2. Rust `license_status()`:
   - compares stored `device_signature` with current generated signature
   - confirms token exists

If either fails, app routes user back to onboarding.

---

## 9) End-to-End Test Plan (no backend creds yet)

Once backend is ready, run this checklist:

1. **Health probe**
   - Put API base URL.
   - Click Test server.
   - Expect green success.

2. **Happy activation**
   - Valid user + key.
   - Expect onboarding complete and redirect.
   - Restart app; should stay unlocked.

3. **Wrong password**
   - Expect auth error message.

4. **Invalid key**
   - Expect key error.

5. **Second device same key**
   - If `max_devices=1`, expect device-limit failure.

6. **Tamper local flag**
   - Set local marker manually but no valid license state.
   - App should relock.

---

## 10) Recommended Next Hardening

1. Add periodic server re-verify endpoint (`POST /v1/device/verify`).
2. Add signed JWT validation in Rust for expiry.
3. Add license reset flow:
   - user can deactivate old machine from account panel.
4. Add support tooling:
   - admin can revoke/reset activations.
5. Add rate limiting:
   - activation attempts per IP/key.

---

## 11) Minimal Backend Starter Checklist

- [ ] Build auth (email/password)
- [ ] Implement license tables
- [ ] Implement `/v1/health`
- [ ] Implement `/v1/device/activate`
- [ ] Seed one test user + license key
- [ ] Test activation from onboarding Step 6
- [ ] Add logs for all activation attempts

---

## 12) Quick “What to do now”

1. Build the two endpoints first (`health`, `activate`).
2. Seed one test account + one key.
3. Run onboarding and activate.
4. Verify app relocks when key/device mismatch is simulated.
5. Then implement verify + reset-device workflows.

