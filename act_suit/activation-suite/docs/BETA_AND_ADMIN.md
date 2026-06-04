# Beta, Coupons, Waitlist & Admin — Operator Guide

> **Updated:** 2026-06-04 · Production: `gapmap.myind.ai` (Vercel project `gapmap-web`, region `sin1`) · Supabase `tjikcnsfaaqihgegecpi` (`ap-southeast-1`)
>
> This is the how-to-run guide for the invite-only beta and the admin console.
> For the feature catalog see `../FEATURES.md`; for licensing internals see
> `../LICENSE_SYSTEM.md`; for email see `EMAIL_RESEND.md`.

---

## 1. The big picture

The beta is **invite-only** to create FOMO. The full lifecycle:

```
 Homepage hero (#invite) OR /sign-in "Join waitlist"
        │  enter email → POST /api/v1/invite/request
        ▼
 seats remain?  ──yes──▶ auto-generate single-use code + EMAIL it   (status: invited)
        │ no                                   │
        ▼                                      │
 waitlist (pending) ── Admin → Invite ─────────┤  (admin can also invite manually)
                                               ▼
                          User gets code → /sign-in (register)
                          validate_coupon (non-consuming) → scarcity chip → signUp
                          (code saved in user_metadata)
                                               │
                                               ▼
                          /dashboard first load → auto-redeem
                          redeem_coupon → mints licence key (consumes coupon)
                          ★ Founding member · waitlist row → CONVERTED
                                               │
                                               ▼
                          Download app → activate device (fingerprint-bound)
```

Re-testing with the same email: **Admin → Users → Delete permanently** frees the email completely.

**Two homepage capture points** post to the same endpoint (`/api/v1/invite/request`): the full-screen **invite hero at the top** and the **"Request your founding invite"** section near the bottom. A `localStorage` flag means a returning visitor sees "already requested" instead of the form.

**Auto-invite vs admin-approval** is controlled by `BETA_AUTO_INVITE_SEATS` (default 100):
- `> 0` → auto-email a code while that many founding seats remain, then fall back to the waitlist.
- `0` → never auto-send; every request waits for **Admin → Waitlist → Invite**.

---

## 2. Data model

| Table | Purpose | Key |
|---|---|---|
| `coupons` | invite/discount codes | `code` (PK) |
| `coupon_redemptions` | audit: who redeemed which code → which licence | — |
| `waitlist` | access requests from code-less visitors | `email` (unique) |
| `licenses` (+`license_devices`) | issued keys + activated devices | email / id |
| `auth.users` → `profiles` → community tables | website account + workspaces/etc. | id (cascade) |

Key DB functions (all `SECURITY DEFINER`):
- `redeem_coupon(code)` — atomic, **increments** the counter, used at key issuance.
- `validate_coupon(code)` — **non-consuming** check, returns `{valid, reason, plan_id, seats_total, seats_left, seats_claimed}`; used at sign-up.
- `admin_soft_delete_user` / `admin_restore_user` / `admin_hard_delete_user(email)` — user deletion (service-role only).
- `admin_get_auth_user_id(email)` — resolve an `auth.users` id (for set-password).
- `increment_waitlist_send(email)` — bump the per-recipient invite-email counter (2-email cap).

`waitlist` columns of note: `status` (pending/invited/converted/rejected), `invite_code`, `invite_sends` (anti-spam counter). `license_devices`: `signature_hash` (device fingerprint), `last_seen_at` (heartbeat, bumped on every `validate`), `UNIQUE (license_id, signature_hash)`.

Migrations: `202605250008_coupons.sql`, `20260603_user_deletion.sql`, `20260603_02_coupon_validate.sql`, `20260603_03_waitlist.sql`, `20260603_04_admin_auth_lookup.sql`, `20260603_05_waitlist_send_cap.sql`.

---

## 3. The admin console (`/admin`)

**Sign in:** open `https://gapmap.myind.ai/admin` and enter `ADMIN_SECRET`
(sets an admin session cookie). Every admin API also accepts an
`x-admin-secret: <ADMIN_SECRET>` header for scripting.

Three tabs:

> Every action opens a **modal** showing the user's current state (no browser
> `confirm`/`prompt`). The user list and detail show **🟢 active** when a device
> checked in within the last 15 min (validate heartbeat).

### Users
- Search, click a user for full detail (licence, devices + `N active now`, recent activation attempts).
- Actions: Enable/Disable, Extend trial, Extend paid expiry, Set device seats, Reset devices, Expire now.
- **Send reset email** — emails the OTP reset code (they complete it on Forgot-password).
- **Set password** — set a new password directly (min 8); share it with the user.
- **Soft delete** — disables the licence, frees seats, blocks website login, marks `deleted_at`. Recoverable with **♻ Restore**. Row shows a `SOFT-DELETED` badge.
- **🗑 Delete permanently** — irreversible. Removes the auth user (cascades all
  community data) + every email-keyed row, **freeing the email for reuse**.
  Requires typing the exact email to confirm.

### Coupons / codes
- **Create**: leave code blank for an auto `GAPMAP-XXXX-XXXX`, or type your own.
  Set plan, seats (blank = unlimited), expiry in days, device seats, and a note.
- **List**: seats used (`cur / max`, "full" badge), redemption count, expiry,
  active/disabled status. Click a code to copy it.
- **Disable/Enable**: soft toggle without deleting (keeps the audit trail).
- **Recent redemptions** feed at the bottom.

### Waitlist
- Filter by status (pending / invited / converted / rejected) with counts.
- **Invite**: generates a **single-use** coupon, marks the entry `invited`,
  and emails the code (branded `sendBetaInviteEmail`). Shows the code inline.
- **Re-invite** (resend) and **Reject**.

---

## 4. Running a beta cohort — playbook

**Share one code with many people (e.g. a launch):**
Admin → Coupons → Create → blank code, plan `pro`, seats `100`, device seats `2`,
note "ProductHunt launch" → share the generated code. Scarcity is real: each
signup consumes a seat; when full, new signups see "that cohort is full".

**Hand-pick from the waitlist:**
Admin → Waitlist → Invite the people you want. Each gets a unique single-use
code by email. Reject the rest (or leave pending).

**Seeded codes already in prod:** `GAPMAP-BETA-2026` (100 seats),
`GAPMAP-LAUNCH` (100 seats — from an earlier seed; disable if unused).

**Tighten scarcity / urgency:** lower `seats`, set `expires_in_days`. Time +
seat limits both drive FOMO.

---

## 5. Email

Branded templates (cream/orange, email-client-safe). Auth emails (OTP /
recovery / confirmation) are served by **Supabase SMTP → Resend** and pushed to
the project's mailer config via the Management API. Transactional emails
(license key, welcome, beta invite) are sent from the Next.js server via Resend
(`src/lib/email.ts`).

- Sender: `EMAIL_FROM` (default `Gap Map <noreply@tool.myind.ai>`); verified domain `tool.myind.ai`.
- Key: `RESEND_API_KEY_TOOL_MAIL` (or `RESEND_API_KEY`).
- If a send fails, the admin invite response shows `emailed:false` / `email_skipped:true` — copy the inline code and send it manually.

See `EMAIL_RESEND.md` for rotating the key / changing the domain.

---

## 6. Environment variables (production)

| Var | Used for |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_URL` | Supabase project |
| `SUPABASE_ANON_KEY` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client + verify |
| `SUPABASE_SERVICE_ROLE_KEY` | server-side DB + RPCs (bypasses RLS) |
| `TOKEN_SIGNING_SECRET` | desktop-app activation JWTs |
| `ADMIN_SECRET` | admin console auth |
| `MASTER_KEY` | beta master activation key |
| `RESEND_API_KEY_TOOL_MAIL` / `EMAIL_FROM` | transactional email |
| `BILLING_ENABLED=0` / `NEXT_PUBLIC_BILLING_ENABLED=0` / `FREE_MAX_DEVICES=2` | beta config |
| `BETA_AUTO_INVITE_SEATS` | homepage auto-invite cap (default **100**; `0` = admin-approval only). Not set in prod yet → defaults to 100. |

Not in prod by design: `PAT_TOKEN` (Supabase Management API — local admin/
migration scripts only; never needed at runtime). `NEXT_PUBLIC_LEMONSQUEEZY_*`
are blank (billing off) — set before enabling billing.

`vercel.json` pins `regions: ["sin1"]` so functions sit next to the Singapore DB.

---

## 6b. Devices, sessions & "is the key in use?"

- A licence activates up to **`max_devices`** devices (invite licences = 2; set
  per licence via Admin → **Set device seats**). Each device sends a SHA-256
  fingerprint; the activation token is **bound to that fingerprint**.
- `validate` (called periodically by the desktop app) rejects a token used on a
  different device (`device_mismatch`), a removed device, or a revoked/expired
  licence — and **bumps `last_seen_at`** (heartbeat).
- **Active now** = a device seen within 15 min. Shown in the admin user list
  (`🟢 active`), user detail (`N active now` + per-device), and the user
  dashboard (`🟢 Active now`). This is heartbeat-based **presence**, not a hard
  concurrent-session lock.
- **Same device, re-login** → re-issues a token, no new seat. **New device** →
  new seat up to the cap, then `409 device limit reached`.
- **Free a seat:** Admin → **Reset devices** (clears all) or the user's dashboard
  **Deactivate** (one device). The freed device's token is revoked on its next
  validate.
- **Strict single-device:** set that user's seats to **1** (Set device seats).

## 6c. Anti-abuse / rate limits

- **Per-recipient cap:** at most **2 invite emails per email address**
  (`waitlist.invite_sends`) — re-submitting can't spam invites to a target/self.
- **Per-IP throttle** (in-memory, `src/lib/rateLimit.ts`): invite & waitlist
  **8 / 10 min**, coupon-validate **40 / min** → `429 + Retry-After`.
- **Client:** 2.5s submit throttle; a `localStorage` flag shows "already
  requested" to returning visitors; the sign-up invite field is debounced 450ms.
- **Seat cap:** auto-invites are bounded by `BETA_AUTO_INVITE_SEATS`.

---

## 7. SQL recipes (via Supabase SQL editor or Management API)

```sql
-- Create a cohort code
insert into public.coupons (code, plan_id, max_redemptions, license_max_devices, note)
values ('GAPMAP-LAUNCH-2', 'pro', 250, 2, 'Launch wave 2');

-- See seat usage
select code, plan_id, current_redemptions, max_redemptions, disabled, expires_at
from public.coupons order by created_at desc;

-- Who redeemed what
select coupon_code, redeemed_by_email, redeemed_at
from public.coupon_redemptions order by redeemed_at desc limit 50;

-- Waitlist snapshot
select status, count(*) from public.waitlist group by status;

-- Free an email for re-testing (prefer the admin UI; this is the raw form)
select public.admin_hard_delete_user('person@example.com');
```

---

## 8. Verification / smoke test (no side effects)

```bash
B=https://gapmap.myind.ai
# public, non-consuming
curl -s -X POST $B/api/v1/coupon/validate -H 'content-type: application/json' \
  -d '{"coupon_code":"GAPMAP-BETA-2026"}'         # → valid:true, seats_left
# admin endpoints must be 403 without the secret
curl -s -o /dev/null -w '%{http_code}\n' $B/api/v1/admin/coupons        # → 403
# with the secret (read-only list)
curl -s $B/api/v1/admin/coupons -H "x-admin-secret: $ADMIN_SECRET"
# function region check
curl -s -D- -o /dev/null -X POST $B/v1/licence/validate \
  -H 'content-type: application/json' -d '{}' | grep -i x-vercel-id   # → bom1::sin1::…
```

Last full verification (2026-06-03): site login (OTP→token ✓), app login
(activate→validate `valid:true` ✓), region `sin1` ✓, all admin endpoints `403`
unauthenticated ✓, waitlist→invite→validate→reject ✓, homepage hero
auto-invite→signup→redeem→**converted** ✓, device flow (re-activate same device
no new seat, 3rd device `409`, heartbeat bumps `last_seen`, wrong-fingerprint
`device_mismatch`, deactivate → revoked) ✓, anti-abuse (3rd email →
`alreadyRequested` / `invite_sends=2`, burst → `429`) ✓.

---

## 9. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Signup blocked, "enter a valid invite code" | invite-only is on (intended) | give them a code or point to the waitlist |
| "that cohort is full" | coupon seats exhausted | raise `max_redemptions` or issue a new code |
| Beta user has no key on dashboard | auto-redeem failed (e.g. coupon expired) | check `coupons`; user can use `/redeem`; banner shows the reason |
| Invite email not received | Resend send failed / spam | admin response shows `emailed`; copy the inline code; check Resend logs |
| App login fails for beta tester | `MASTER_KEY` missing/rotated in prod | confirm `MASTER_KEY` in Vercel env; redeploy |
| Dynamic pages slow | functions not in `sin1` | confirm `vercel.json regions:["sin1"]` + redeploy |
| Can't reuse an email | account still exists | Admin → Users → Delete permanently |
| Admin API 403 with secret | wrong/missing `ADMIN_SECRET` | verify the Vercel env value |

---

## 10. Change log pointers

This system was built across these changelog entries (see `changelogs/`):
`2026-06-03_01` distinct email templates, `_02` prod env (app login + email),
`_03` performance (region/loading/bundle), `_04` admin user delete, `_05`
invite-only beta FOMO, `_06` waitlist + admin coupon/waitlist management,
`_07` docs (FEATURES + this guide), `_08` homepage beta CTAs + admin password,
`_09` admin action modal, `_10` simpler signup (full name + confirm pwd),
`_11` homepage invite-request + waitlist→converted, `_12` full-screen invite
hero + hybrid auto-invite, `_13` invite anti-abuse (2-email cap, rate limit,
throttle, localStorage), `_14` device heartbeat + "active now".
