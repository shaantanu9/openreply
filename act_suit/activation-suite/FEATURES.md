# Gap Map (activation-suite / gapmap_web) — Features & Flows

> **Updated:** 2026-06-04 by Claude · **Build state:** production (Vercel `gapmap-web` → gapmap.myind.ai, region `sin1`)
> Source of truth for every user-facing feature of the web app, its flow, code location, completeness, and known gaps. Update after every feature change.
>
> Companion docs: `docs/BETA_AND_ADMIN.md` (operator guide), `LICENSE_SYSTEM.md` (licensing internals), `docs/EMAIL_RESEND.md` (email), `docs/PRODUCT_AND_USAGE_GUIDE.md`.

## Legend
- ✅ **Complete** — works end-to-end, no known half-done parts
- 🟡 **Partial** — works but has documented gaps
- 🚧 **In progress** — not shippable yet
- ❌ **Missing** — planned/table-stakes, not started
- 🔒 **Gated** — exists but behind auth / invite / flag

## Quick status summary

| Category | Total | ✅ | 🟡 | 🚧 | ❌ |
|---|---|---|---|---|---|
| Auth & login | 4 | 4 | 0 | 0 | 0 |
| Licensing & device binding | 6 | 6 | 0 | 0 | 0 |
| Beta invite (FOMO) | 8 | 8 | 0 | 0 | 0 |
| Admin console | 4 | 4 | 0 | 0 | 0 |
| Email | 4 | 4 | 0 | 0 | 0 |
| Dashboard | 3 | 3 | 0 | 0 | 0 |
| Marketing & infra | 3 | 2 | 1 | 0 | 0 |
| **Total** | **32** | **31** | **1** | **0** | **0** |

---

## Auth & login

### Email + password sign-in ✅
**Entry:** `/sign-in` (login tab).
**Flow:** email + password → `supabase.auth.signInWithPassword` → redirect to `?next=` or `/dashboard`.
**Implementation:** `src/components/auth/SignInPanel.tsx` (`handleLogin`); session via `src/hooks/use-session.ts`; browser client `src/lib/supabaseBrowser.ts`.
**Data:** Supabase Auth (`auth.users`), project `tjikcnsfaaqihgegecpi` (`ap-southeast-1`).

### Account creation (invite-gated, simplified) ✅ 🔒
**Entry:** `/sign-in` (register tab).
**Flow:** requires a valid beta invite code → single **Full name** field (first/last derived for metadata) + password + **Confirm password** (live mismatch check; submit disabled until they match) → `supabase.auth.signUp` with `invite_code` + `beta_founding` in user metadata.
**Implementation:** `src/components/auth/SignInPanel.tsx` (`handleRegister`).
**Data:** `auth.users.user_metadata` (`full_name`, `invite_code`, `beta_founding`).

### Password reset via OTP ✅
**Entry:** `/sign-in` (forgot tab).
**Flow:** `signInWithOtp({shouldCreateUser:false})` → 6-digit code email → `verifyOtp({type:'email'})` → `updateUser({password})`. OTP-only (no dual-channel link) per the `flutter-forgot-password` skill.
**Implementation:** `src/components/auth/SignInPanel.tsx` (`handleForgot`, `handleForgotReset`).

### Desktop-app login (activation token) ✅
**Entry:** Gap Map desktop app → `/v1/device/activate`, then periodic `/v1/licence/validate`.
**Flow:** activate (email+key, or master key) → device-fingerprint-bound signed JWT (`TOKEN_SIGNING_SECRET`) → validate checks signature + fingerprint match + device-still-attached + licence status.
**Implementation:** `src/app/api/v1/device/activate/route.ts`, `src/app/api/v1/licence/validate/route.ts` (+ `/v1/...` aliases), `src/lib/token.ts`, `src/lib/licenseService.ts`.
**Verified (2026-06-03):** activate → validate `{valid:true}`; wrong fingerprint → `device_mismatch`.

---

## Licensing & device binding

### Free / trial key issuance ✅
**Entry:** `/dashboard` (no licence) or `/activate`.
**Implementation:** `src/app/api/v1/licence/free/route.ts`, `src/app/api/v1/trial/start/route.ts`, `src/lib/supabaseActivationStore.ts`.
**Data:** `licenses`, `license_devices`.

### Coupon → key redemption (single-use) ✅
**Entry:** `/redeem` or auto on `/dashboard` for beta users.
**Flow:** logged-in user → `redeem_coupon()` RPC (atomic, increments counter, refuses when exhausted) → mints key + `licenses` row + `coupon_redemptions` audit row; refuses if the account already has an active licence.
**Implementation:** `src/lib/couponService.ts`, `src/app/api/v1/coupon/redeem/route.ts`, `src/components/redeem/RedeemPanel.tsx`.

### Device binding & seat enforcement ✅
**What:** a licence activates up to `max_devices` devices (invite licences = 2). Each device sends a SHA-256 `device_signature`; the server stores a `license_devices` row with `UNIQUE (license_id, signature_hash)` and issues a JWT **bound to that fingerprint**. `validate` rejects on fingerprint mismatch, removed device, or revoked/expired licence. Re-activating the **same** device re-issues without using a seat; a **new** device consumes a seat up to the cap, then `409 device limit reached`.
**Implementation:** `src/lib/supabaseActivationStore.ts` (`activateDeviceSupabase`, `supabaseDeviceExists`), `src/app/api/v1/device/activate/route.ts`, `src/app/api/v1/licence/validate/route.ts`.
**Verified (2026-06-03):** dev1 →1/2, re-activate dev1 →still 1, dev2 →2/2, dev3 →`409`, token1+dev2-fp →`device_mismatch`, deactivate →`revoked`.

### Device heartbeat & "active now" ✅
**What:** every `validate` bumps `license_devices.last_seen_at` (heartbeat). A device seen within 15 min is "active now" — shown in admin (user list `🟢 active`, detail `N active now` + per-device) and the dashboard (`🟢 Active now` badge). Lets you see if a key is in use right now and on which device.
**Implementation:** `supabaseTouchDevice` (`src/lib/supabaseActivationStore.ts`), `src/app/api/v1/licence/validate/route.ts`, `src/app/admin/page.tsx` (`isActive`), `src/components/dashboard/DashboardPanel.tsx` (`activeNow`).
**Verified (2026-06-03):** `last_seen` bumped on validate.
**Note:** heartbeat-based presence (recency), not a hard concurrent-session lock.

### Master beta key ✅ 🔒
**Flow:** `MASTER_KEY` env activates any device for any email, no password; revoked by rotating the env. Token carries a master signature checked on validate. **Bypasses the device limit** (`max_devices: 999999`) — by design for the shared beta key; per-user invite licences enforce the cap.
**Implementation:** `src/lib/masterKey.ts`, `src/lib/token.ts` (`issueMasterToken`, `readMasterClaims`).

### Admin licence actions ✅ 🔒
**Flow:** revoke / reactivate / expire / extend_trial / extend_expiry / set_max_devices / reset_devices (frees seats → device tokens revoked on next validate).
**Implementation:** `src/app/api/v1/admin/license/route.ts`, `src/lib/supabaseActivationStore.ts`.

---

## Beta invite system (FOMO)

### Homepage invite hero ✅
**Entry:** top of `/` (full-screen, above the slider) — `#invite`.
**Flow:** "Find the gaps before your competitors do" + stats/testimonial/founders proof; email → `POST /api/v1/invite/request`. Returning visitors see "already requested" from a `localStorage` flag; 2.5s submit throttle.
**Implementation:** `src/components/marketing/InviteHero.tsx`; mirrored capture in `src/components/marketing/RequestInviteSection.tsx` (`#request-invite`).

### Hybrid auto-invite endpoint ✅
**Flow:** `POST /api/v1/invite/request` — while founding seats remain, instantly generates a single-use code and emails it (the code becomes the licence key on signup); once the cap is hit, the email stays on the waitlist for admin approval. Re-requests re-send the existing code.
**Config:** `BETA_AUTO_INVITE_SEATS` (default 100; `0` = pure admin-approval).
**Implementation:** `src/app/api/v1/invite/request/route.ts`, `src/lib/betaAdminStore.ts` (`countActiveInvites`, `inviteFromWaitlist`).

### Invite-only sign-up gate ✅ 🔒
**Entry:** `/sign-in` register tab.
**Flow:** invite code field → debounced (450ms) non-consuming `validate_coupon` → seat-scarcity chip + celebratory valid state → submit unlocks. Code stored in user metadata.
**Implementation:** `src/components/auth/SignInPanel.tsx`; `src/app/api/v1/coupon/validate/route.ts`; RPC `validate_coupon` (`supabase/migrations/20260603_02_coupon_validate.sql`).

### Founding-member key auto-issue ✅
**Entry:** `/dashboard` first load with a session and no licence.
**Flow:** reads `invite_code` from metadata → `POST /api/v1/coupon/redeem` → mints key → "✨ Issuing…" → "🎉 Welcome, founding member" + ★ badge.
**Implementation:** `src/components/dashboard/DashboardPanel.tsx` (auto-redeem effect + `isFounding`).

### Waitlist → converted funnel ✅
**Flow:** request → `pending`; admin/auto invite → `invited` (+ single-use code); on successful redemption the waitlist row flips to `converted` (matched by `invite_code` and email). Admin Waitlist tab filters by status.
**Implementation:** `src/lib/couponService.ts` (conversion on redeem), `src/lib/betaAdminStore.ts`, `waitlist` table (`supabase/migrations/20260603_03_waitlist.sql`).
**Verified (2026-06-03):** homepage → invite → signup → redeem → `converted`.

### Anti-abuse: send cap + throttle ✅
**What:** max **2 invite emails per address** (`waitlist.invite_sends` + `increment_waitlist_send` RPC) so re-submitting can't spam a target/self; per-IP rate limits on invite/waitlist (8/10 min) and coupon-validate (40/min) → `429 + Retry-After`; client 2.5s submit throttle + `localStorage` "already requested" memory.
**Implementation:** `src/lib/rateLimit.ts`, `supabase/migrations/20260603_05_waitlist_send_cap.sql`, `src/app/api/v1/invite/request/route.ts`, `src/components/marketing/{InviteHero,RequestInviteSection}.tsx`.
**Verified (2026-06-03):** 3rd request → `alreadyRequested` (no email), `invite_sends=2`; burst → `429`.

### Beta invite email ✅
**Flow:** branded single-use code + "Claim my founding spot" CTA — sent on auto-invite and admin invite.
**Implementation:** `src/lib/email.ts` (`sendBetaInviteEmail`).

---

## Admin console (`/admin`)

> Owner-only. Auth: admin session cookie (`/api/v1/admin/auth`) **or** `x-admin-secret` header == `ADMIN_SECRET`. All admin APIs return `403` without it. All destructive actions use a proper modal (`src/components/admin/AdminModal.tsx`) showing the thing's **current state** — no `window.confirm`/`prompt`.

### Users tab ✅ 🔒
**Flow:** searchable licence table (with `🟢 active` live status) → detail view (devices + `N active now` + recent activation attempts); actions via modal: enable/disable, extend trial/expiry, set seats, reset devices, expire, **soft delete / restore / permanent delete**, **send password-reset email**, **set password directly**.
**Implementation:** `src/app/admin/page.tsx`; `src/app/api/v1/admin/license/route.ts`, `src/app/api/v1/admin/user/route.ts`; password via `supabaseAdminSetPassword` / `supabaseAdminSendPasswordReset` + RPC `admin_get_auth_user_id`.

### User deletion (soft + hard) ✅ 🔒
**Flow:** soft delete = revoke + free seats + ban login + `deleted_at` (recoverable via Restore); hard delete = remove `auth.users` (cascades community data) + all email-keyed rows → **frees the email for reuse** (type-the-email confirm).
**Implementation:** RPCs `admin_soft_delete_user` / `admin_restore_user` / `admin_hard_delete_user` (`supabase/migrations/20260603_user_deletion.sql`), `supabaseDeleteUser`, `src/app/api/v1/admin/user/route.ts`.

### Coupons / codes tab ✅ 🔒
**Flow:** create codes (auto `GAPMAP-XXXX-XXXX` or custom; plan, seats, expiry, device seats, note); list with seats-used + redemption counts; copy; enable/disable; recent-redemptions feed.
**Implementation:** `src/components/admin/CouponsSection.tsx`, `src/app/api/v1/admin/coupons/route.ts`, `src/lib/betaAdminStore.ts`.

### Waitlist tab ✅ 🔒
**Flow:** status filters (pending/invited/converted/rejected) + counts; Invite / Re-invite / Reject (modal-confirmed); shows generated code inline.
**Implementation:** `src/components/admin/WaitlistSection.tsx`, `src/app/api/v1/admin/waitlist/route.ts`, `src/lib/betaAdminStore.ts` (`inviteFromWaitlist`).

---

## Email (Resend)

> All transactional + auth email is branded (cream/orange, table layout, inline styles). Templates in `supabase/email_templates/*.html`.

### Auth emails (OTP / recovery / confirmation) ✅
Served by Supabase SMTP (Resend); pushed via Management API. OTP/recovery are OTP-only; confirmation is link-based but dormant while `mailer_autoconfirm=true`.

### License key email ✅
`src/lib/email.ts` (`sendLicenseKeyEmail`), template `supabase/email_templates/license_key.html`.

### Welcome email ✅
The full sales pitch (stats + testimonial) lives only here. `sendWelcomeEmail`, `welcome.html`.

### Beta invite email ✅
`sendBetaInviteEmail`. **Config:** `RESEND_API_KEY_TOOL_MAIL` + `EMAIL_FROM` in Vercel; sends from `tool.myind.ai`.

---

## Dashboard (`/dashboard`)

### Licence + key card ✅
Activation key, plan, device slots, expiry/trial countdown, copy-key; founding-member ★ badge.
**Implementation:** `src/components/dashboard/DashboardPanel.tsx`, `src/lib/licenceClient.ts`.

### Get-a-key paths (no licence) ✅
Trial / redeem / activate; founding-member auto-redeem layered on top.

### Device management + live status ✅
Lists activated devices with a `🟢 Active now` badge (seen <15 min) and last-seen; deactivate a device to free a seat (revokes its token on next validate).
**Implementation:** `src/components/dashboard/DashboardPanel.tsx` (`handleDeactivate`, `activeNow`), `src/lib/licenceClient.ts`.

---

## Marketing & infra

### Marketing site ✅
`/`, `/pricing`, `/features`, `/faq`, `/explore`, `/download` — prerendered + CDN-cached. Full-screen **invite hero at the top** (`InviteHero`); CTAs are invite-only-beta framed; `/pricing` shows "Free while in beta — invite-only".
**Implementation:** `src/app/page.tsx`, `src/components/marketing/*`, `src/components/shell/NavBar.tsx`, `src/app/pricing/page.tsx`.

### Performance: region + loading states ✅
Functions pinned to `sin1` (co-located with the Singapore DB); 12 route `loading.tsx` skeletons; `next.config.ts` `optimizePackageImports` + `removeConsole`.
**Implementation:** `vercel.json` (`regions:["sin1"]`), `next.config.ts`, `src/components/ui/page-loading.tsx`, `src/app/**/loading.tsx`.
**Verified:** function region `sin1`; warm dynamic TTFB ~150ms.

### Billing (LemonSqueezy) 🟡
**Status:** code present, **disabled** for beta (`BILLING_ENABLED=0`, `NEXT_PUBLIC_BILLING_ENABLED=0`).
**Known gaps (P2):** `NEXT_PUBLIC_LEMONSQUEEZY_*` checkout/portal URLs are blank in prod — must be set before enabling billing. `src/lib/lemonSqueezy.ts`, `src/app/api/v1/webhooks/lemonsqueezy/route.ts`.

---

## Update protocol

When to update this file:
- A feature ships → flip 🚧 → ✅ (or 🟡 if gaps remain)
- A bug is fixed → update/remove "Known gaps"
- A file is moved/renamed → update citations
- A new feature is added → add a section + bump the summary table

Re-run cadence: before every production deploy that touches more than one feature. Keep in lockstep with `changelogs/` entries.
