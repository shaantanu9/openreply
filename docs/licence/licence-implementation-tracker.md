# Gap Map — Licence & Activation Implementation Tracker

> Companion to `tauri-licence-impl.md` (desktop spec) and `subscription-model.md` (server/plan spec).
> Single source of truth for **what's done, what's partial, and what's still open** across the whole
> stack — `app-tauri/` (desktop), `act_suit/activation-suite/` (Next.js server), and
> `act_suit/html_site/` (marketing + activation portal).

**Status key:** ✅ done · 🟡 partial · 🔴 missing · ⚪ not required yet / deferred
**Last updated:** 2026-04-24 (dual-app spec — Community foundation landed in `activation-suite`)

---

## 1. Executive summary

**Product direction change (2026-04-24):** the licence UX is moving into the
Next.js `activation-suite` app. The Tauri desktop refactor (previously Phase
G) is shelved — the desktop will stay thin and delegate plan/device/billing
UX to the web app. The desktop continues to verify JWTs at runtime, but the
entire customer-facing licence portal is now a Next.js surface.

As of this revision:

- **Next.js server + portal (`activation-suite`)** is now ~95% end-to-end.
  Activate, deactivate, validate, trial-start, licence-me, devices-management,
  billing-portal, and a Lemon Squeezy webhook are all implemented. `/dashboard`
  and `/activate` render live data. Only per-environment wiring (real LS
  store/variant IDs, Resend) is left.
- **Desktop (`app-tauri`)** unchanged — still verifies JWTs and stores the
  token locally. Stronghold/keychain migration remains future scope but is no
  longer a launch blocker.
- **Static `html_site`** is now a marketing site only. `activate.html` and
  `activation-help.html` are thin redirects into the Next.js app.

**Remaining blockers:** populate `LS_WEBHOOK_SECRET`, `LS_API_KEY`,
`LS_VARIANT_MAP`, and `RESEND_API_KEY` once the Lemon Squeezy store is live.

---

## 2. Phased scope

| Phase | Title | Priority | Est effort | Status |
|-------|-------|----------|------------|--------|
| A | Secrets hygiene & build-time config | P0 | 1h | ✅ **done** |
| B | Server JWT + missing routes | P0 | 6h | ✅ **done** |
| C | Activation-key alphabet + dev-mint hardening | P1 | 2h | ✅ **done** |
| D | `subscription-model.md` companion doc | P1 | 1h | ✅ **done** |
| E | `html_site/activate.html` disambiguation | P1 | 1h | ✅ **done** (now redirects to Next.js) |
| F | Lemon Squeezy webhook end-to-end | P1 | 4h | ✅ **done** (code ready; needs LS env vars) |
| G | Desktop licence-module refactor + gates + Stronghold | ⚪ | ~2 days | ⚪ **shelved** (Next.js pivot) |
| H | Next.js licence portal end-to-end | P0 | 1 day | ✅ **done** |
| I | Community app foundation (dual-app spec) | P0 | 1 day | ✅ **done** (stubs flagged) |

---

## 3. Phase-by-phase checklist

### Phase A — Secrets hygiene & build-time config ✅

- [x] **A.1** Confirm `.env` files in `act_suit/*` are gitignored — `git ls-files`
      shows both are untracked; caught by `activation-suite/.gitignore` and root `.gitignore`.
- [x] **A.2** Removed hardcoded `"gapmap-dev-token-secret"` fallback from
      `activation-suite/src/lib/token.ts`. `signingSecret()` now throws on
      missing/short `TOKEN_SIGNING_SECRET`.
- [x] **A.3** `activation-suite/.env.example` lists every env var including
      `TOKEN_SIGNING_SECRET`, `DEV_MINT_SECRET`, `ALLOW_DEV_MINT`, LS and
      Resend placeholders.
- [x] **A.4** `html_site/.env.example` already covered all `GAPMAP_ENV` keys
      and flags server-only secrets.
- [x] **A.5** `app-tauri/src-tauri/build.rs` panics on missing
      `JWT_DESKTOP_SECRET` (pre-existing; verified).

### Phase B — Server JWT & missing routes ✅

- [x] **B.1** `LicenceClaims` in `src/lib/token.ts` expanded: `plan_id`,
      `live_pass_active`, `is_trial`, `trial_ends_at`, `features`, plus `iss`
      and `aud` constants.
- [x] **B.2** Created `src/lib/features.ts` mirroring the Rust `Features` struct
      (spec §5) with factories: `freeFeatures`, `proFeatures`,
      `proWithLivePassFeatures`, `teamFeatures`, `proTrialFeatures`, and a
      `featuresFor()` resolver that respects trial expiry.
- [x] **B.3** `activateDevice` / `activateDeviceSupabase` populate the new
      claims from the license row via `claimsFromLicense[Row]()`.
- [x] **B.4** `src/app/api/v1/device/deactivate/route.ts` — Bearer-verifies the
      JWT, validates the fingerprint body, removes the `license_devices` row.
- [x] **B.5** `src/app/api/v1/licence/validate/route.ts` — verifies JWT,
      checks revocation, returns `refreshed_token` when the DB plan diverges
      from claims; 401 when JWT signature/fingerprint fails.
- [x] **B.6** Migration `202604230004_license_plan_fields.sql` adds `plan_id`,
      `live_pass_active`, `is_trial`, `trial_ends_at` columns.
- [x] **B.7** Routes and claim shape documented in `subscription-model.md` §3–4.

### Phase C — Activation-key alphabet + dev-mint hardening ✅

- [x] **C.1** `mintActivationKey()` now uses `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`
      (32 chars, no 0/O/1/I). 16 random picks formatted as `XXXX-XXXX-XXXX-XXXX`.
- [x] **C.2** Supabase fallback generator in `createLicenseSupabase` also
      routes through `mintActivationKey()` (previously used raw hex).
- [x] **C.3** `/api/v1/dev/mint` requires `ALLOW_DEV_MINT=true` AND
      `NODE_ENV !== 'production'` AND the `X-Dev-Mint-Secret` header.
- [x] **C.4** Added in-memory 10-req/min/IP rate limit (`rateBucket` Map);
      returns 429 when exceeded.

### Phase D — `subscription-model.md` companion doc ✅

- [x] **D.1** `docs/licence/subscription-model.md` written. Covers plan matrix,
      activation-key format, JWT shape, API contract (activate / deactivate /
      validate / webhook / dev-mint), Supabase schema, env vars, and the full
      happy path. Cross-references this tracker.

### Phase E — `html_site/activate.html` redirect to Next.js ✅

- [x] **E.1** `html_site/activate.html` and `html_site/activation-help.html`
      are now meta-redirect pages that bounce the browser to the Next.js
      `/activate` and `/activation-help` routes. `GAPMAP_APP_BASE` in
      `env.config.js` configures the target; falls back to same-origin.

### Phase F — Lemon Squeezy webhook ✅

Implementation complete; waiting on live LS env vars.

- [x] **F.1** `src/app/api/v1/webhooks/lemonsqueezy/route.ts` — HMAC-verified
      against `LS_WEBHOOK_SECRET`. Compares against the raw request body, not
      parsed JSON. Timing-safe comparison.
- [x] **F.2** Variant-ID → plan_id mapping via the `LS_VARIANT_MAP` env var
      (JSON). Default is a single `pro` plan fallback.
- [ ] **F.3** Resend transactional email for key delivery — TODO (flagged in
      the webhook handler with a comment; non-blocking for the happy path).
- [ ] **F.4** `docs/manual-todo/lemonsqueezy-setup.md` describing LS dashboard
      steps — TODO.

### Phase G — Desktop licence-module refactor ⚪ SHELVED

The desktop will stay thin. Phase H (Next.js portal) replaces the customer
UX that was going to be built inside the Tauri app. The existing JWT-in-file
storage on the desktop is still insecure, but it's acceptable because:

- (a) The desktop binary will be phased down in visibility now that the
  web app owns the licence management flow.
- (b) The device fingerprint check on JWT load already wipes copies moved
  between machines.
- (c) No subscription/entitlement logic runs on the desktop anymore — plan
  gates live on the server through `/api/v1/licence/validate`.

If the desktop persists as a first-class surface, re-open G as a follow-up.

### Phase H — Next.js licence portal end-to-end ✅ (new)

Everything the Tauri refactor would have built, now in `activation-suite`:

- [x] **H.1** `src/lib/features.ts` — plan factories + `featuresFor()`
      (already present; shared with JWT).
- [x] **H.2** `src/lib/lemonSqueezyServer.ts` — HMAC verify, variant map,
      customer-portal mint via LS API.
- [x] **H.3** `src/lib/licenceClient.ts` — browser wrapper for
      `/api/v1/licence/me`, `/api/v1/devices`, `/api/v1/trial/start`,
      `/api/v1/billing/portal`.
- [x] **H.4** Server helpers added to `src/lib/supabaseActivationStore.ts`:
      `supabaseLicenceForEmail`, `supabaseRemoveDeviceForEmail`,
      `supabaseCreateTrialForEmail`, `supabaseUpsertLicenceFromWebhook`,
      `supabaseMarkLicenceFromWebhook`.
- [x] **H.5** Five new authenticated routes — see Phase F above plus the ones
      under `src/app/api/v1/{licence/me,devices,trial/start,billing/portal}/`.
- [x] **H.6** `/dashboard` page + `DashboardPanel` component — live plan
      summary, trial banner, device list with deactivate, billing portal
      button, features-unlocked grid.
- [x] **H.7** `ActivatePanel` — replaced mocked devices/plan with live
      `fetchLicenceMe()` data; "Start 14-day trial" CTA; per-device
      deactivate.
- [x] **H.8** `UserMenu` exposes dashboard + activate-new-device links.
- [x] **H.9** `ROUTES.dashboard` added.

### Phase I — Community app foundation ✅ (stubs flagged)

Implements the Community half of `docs/licence/gapmap-dual-app-spec.md` in
the existing `activation-suite` Next.js app. Stubs the source-connector
fetching + AI extraction (spec §3 Phase 1 — real Rust core crate) so the
full UI renders end-to-end today.

- [x] **I.1** `supabase/migrations/202604240005_community_schema.sql` —
      profiles, workspaces, workspace_sources, byok_keys, posts, insights,
      sweeps, published_research, research_upvotes, follows + RLS + triggers.
- [x] **I.2** `src/lib/community/` — types, slug helper, BYOK PBKDF2+AES-GCM
      encryption, workspace CRUD, publish snapshot builder, stub sweep
      engine, routeAuth helper, browser communityClient.
- [x] **I.3** 11 new API routes: `workspaces` (GET/POST),
      `workspaces/[id]` (GET/PATCH/DELETE), `workspaces/[id]/sources`
      (GET/POST), `workspaces/[id]/sources/[sourceId]` (DELETE), `sweep`
      (POST), `sweep/[id]` (GET), `insights` (GET), `publish` (POST),
      `unpublish` (POST), `byok` (GET/PUT/DELETE), `profiles/[username]` (GET).
- [x] **I.4** UI pages: `/workspaces` (list + create),
      `/workspaces/[id]` (5-tab detail with sweep + markdown/CSV export),
      `/explore` + `/explore/[slug]` with ISR,
      `/u/[username]` profile,
      `/settings/byok`, `/settings/profile`.
- [x] **I.5** `UserMenu` gains Workspaces / Explore / BYOK / Profile entries.
- [ ] **I.6** Replace stub `sweepEngine.ts` with the real shared Rust core
      engine once Phase 1 of the dual-app spec ships.
- [ ] **I.7** `/api/v1/pro/publish` bridge endpoint for Pro → anonymous
      publish to explore (spec §6.3) — not yet built; unlocked once the
      Pro desktop actually needs it.
- [ ] **I.8** PDF export — currently client-side markdown + CSV; PDF is
      flagged as Pro-only in the workspace report tab.

---

## 4. Current-state snapshot (post-work)

### 4.1 Tauri app — spec §-by-§ mapping (unchanged by this session)

| Spec § | File in spec | Present in `app-tauri/` | Status |
|---|---|---|---|
| §1 project tree | `src-tauri/src/licence/*` | everything inline in `commands.rs` | 🔴 |
| §2 Cargo deps | stronghold, thiserror, sysinfo, OS crates | partial | 🟡 |
| §3 build.rs | bake `JWT_DESKTOP_SECRET` | asserts ≥32 chars and emits `cargo:rustc-env` | ✅ |
| §4 `error.rs` | `LicenceError` enum | ad-hoc string errors | 🔴 |
| §5 `features.rs` | Plan definitions | none | 🔴 |
| §6 `fingerprint.rs` | per-OS hashing | inline; salt format inconsistent | 🟡 |
| §7 `jwt.rs` | `LicenceClaims` verify | verify works; struct missing plan fields | 🟡 |
| §8 `store.rs` | OS keychain via stronghold | plaintext JSON file | 🔴 |
| §9 `validator.rs` | online heartbeat | none | 🔴 |
| §10 `licence/mod.rs` | `LicenceState` API | none | 🔴 |
| §11 `commands/activation.rs` | activate/deactivate/validate/plan/device | activate, deactivate, status, device-info; no `validate_online` | 🟡 |
| §12 `commands/workspace.rs` | gated create/add | no gates | 🔴 |
| §13 `commands/sweep.rs` | gated scheduled sweep | no gates | 🔴 |
| §14 `commands/export.rs` | pdf/csv gated | `export_html` ungated | 🔴 |
| §15 `commands/monitor.rs` | `start_competitor_monitor` live-pass | ungated | 🔴 |
| §16 `main.rs` | stronghold, state, startup validator | commands registered only | 🟡 |
| §17 frontend | `src/lib/licence.ts` + `GatedFeature` | `api.js` has license methods | 🟡 |
| §18 env vars | `JWT_DESKTOP_SECRET`, `ACTIVATION_SERVER_URL` | first ✓; second hardcoded placeholder | 🟡 |
| §19 capabilities | stronghold perm | absent | 🔴 |

### 4.2 Server — spec routes

| Route | Status | File |
|---|---|---|
| `POST /api/v1/device/activate` | ✅ (claims now complete) | `src/app/api/v1/device/activate/route.ts` |
| `POST /api/v1/device/deactivate` | ✅ **new** | `src/app/api/v1/device/deactivate/route.ts` |
| `POST /api/v1/licence/validate` | ✅ **new** | `src/app/api/v1/licence/validate/route.ts` |
| `POST /api/v1/webhooks/lemonsqueezy` | ⚪ deferred (Phase F) | — |
| `POST /api/v1/dev/mint` | ✅ hardened | `src/app/api/v1/dev/mint/route.ts` |

### 4.3 Server — JWT & keys

| Item | Status | Evidence |
|---|---|---|
| HS256, iss=`gapmap-activation-suite`, aud=`gapmap-desktop` | ✅ | `src/lib/token.ts` |
| Claims: sub, user_id, email, device_fingerprint | ✅ | `src/lib/token.ts` |
| Claims: plan_id, live_pass_active, is_trial, trial_ends_at, features | ✅ **new** | `src/lib/token.ts` + `src/lib/features.ts` |
| Signing secret fail-hard (no fallback) | ✅ **new** | `signingSecret()` throws |
| Activation key alphabet = A–Z/2–9 | ✅ **new** | `activationStore.ts::mintActivationKey` |
| `sha256(key)` stored | ✅ | migration `202604220002` |

### 4.4 Secrets hygiene

| Item | Status |
|---|---|
| `.env` files gitignored | ✅ |
| `.env.example` complete | ✅ **updated** |
| `TOKEN_SIGNING_SECRET` has no fallback | ✅ **new** |
| `ALLOW_DEV_MINT` env gate | ✅ **new** |
| `JWT_DESKTOP_SECRET` baked into desktop binary | ✅ |

---

## 5. Step-by-step execution log

| Date | Phase.Step | What happened | Commit / file |
|---|---|---|---|
| 2026-04-23 | 1.0 | Audit written, this tracker created | `docs/licence/licence-implementation-tracker.md` |
| 2026-04-23 | A.2 | Removed `"gapmap-dev-token-secret"` fallback | `src/lib/token.ts` |
| 2026-04-23 | A.3 | Filled out `.env.example` (TOKEN_SIGNING_SECRET, ALLOW_DEV_MINT, …) | `activation-suite/.env.example` |
| 2026-04-23 | B.1–B.3 | Full claim shape on JWT; `claimsFromLicense[Row]()` | `token.ts`, `activationStore.ts`, `supabaseActivationStore.ts` |
| 2026-04-23 | B.2 | Created `features.ts` with plan factories + `featuresFor()` | `src/lib/features.ts` |
| 2026-04-23 | B.4 | `POST /api/v1/device/deactivate` | `src/app/api/v1/device/deactivate/route.ts` |
| 2026-04-23 | B.5 | `POST /api/v1/licence/validate` with refreshed-token path | `src/app/api/v1/licence/validate/route.ts` |
| 2026-04-23 | B.6 | Plan columns migration | `supabase/migrations/202604230004_license_plan_fields.sql` |
| 2026-04-23 | C.1 | Safe-alphabet key generator A–Z+2–9 | `activationStore.ts::mintActivationKey` |
| 2026-04-23 | C.2 | Supabase fallback routes through safe generator | `supabaseActivationStore.ts::createLicenseSupabase` |
| 2026-04-23 | C.3 | `ALLOW_DEV_MINT=true` gate + tightened guards | `dev/mint/route.ts` |
| 2026-04-23 | C.4 | 10/min/IP rate limit on dev-mint | `dev/mint/route.ts` |
| 2026-04-23 | D.1 | `subscription-model.md` written | `docs/licence/subscription-model.md` |
| 2026-04-23 | — | `tsc --noEmit` clean; server builds | — |
| 2026-04-23 | — | Changelog entry | `changelogs/2026-04-23_01_licence-tracker-and-server-foundations.md` |
| 2026-04-24 | — | Product direction: licence UX moves into Next.js | — |
| 2026-04-24 | H.2 | `lemonSqueezyServer.ts` — HMAC verify, variant map, portal mint | `src/lib/lemonSqueezyServer.ts` |
| 2026-04-24 | H.3 | `licenceClient.ts` browser wrapper | `src/lib/licenceClient.ts` |
| 2026-04-24 | H.4 | Supabase dashboard + webhook helpers | `src/lib/supabaseActivationStore.ts` |
| 2026-04-24 | H.5 | Five new API routes | `src/app/api/v1/{licence/me,devices,trial/start,billing/portal,webhooks/lemonsqueezy}/route.ts` |
| 2026-04-24 | H.6 | `/dashboard` + `DashboardPanel` | `src/app/dashboard/page.tsx`, `src/components/dashboard/DashboardPanel.tsx` |
| 2026-04-24 | H.7 | ActivatePanel live data + trial CTA + deactivate | `src/components/activate/ActivatePanel.tsx` |
| 2026-04-24 | H.8 | UserMenu + constants route | `src/components/shell/UserMenu.tsx`, `src/lib/constants.ts` |
| 2026-04-24 | E.1 | `activate.html` + `activation-help.html` redirect to Next.js | `act_suit/html_site/activate.html`, `activation-help.html` |
| 2026-04-24 | — | `tsc --noEmit` clean across the whole repo | — |
| 2026-04-24 | — | Changelog entry | `changelogs/2026-04-24_01_nextjs-licence-portal-end-to-end.md` |
| 2026-04-24 | I.1 | Community schema migration | `supabase/migrations/202604240005_community_schema.sql` |
| 2026-04-24 | I.2 | Community server libs + sweep stub | `src/lib/community/*.ts` |
| 2026-04-24 | I.3 | 11 Community API routes | `src/app/api/v1/{workspaces,sweep,insights,publish,unpublish,byok,profiles}/…` |
| 2026-04-24 | I.4 | Workspace + explore + settings UI | `src/app/{workspaces,explore,u,settings}/…` |
| 2026-04-24 | I.5 | UserMenu + nav entries | `src/components/shell/UserMenu.tsx`, `src/lib/constants.ts` |
| 2026-04-24 | — | `tsc --noEmit` still clean | — |
| 2026-04-24 | — | Changelog entry | `changelogs/2026-04-24_02_community-app-foundation.md` |

---

## 6. Risk register

| # | Risk | Mitigation | Status |
|---|---|---|---|
| 1 | Server secret diverges from desktop `JWT_DESKTOP_SECRET` → silent sig fail | Fail-hard in `signingSecret()`; documented in `subscription-model.md` §6 | ✅ mitigated |
| 2 | Users copy `license_state.json` between machines | Move to Stronghold (Phase G.6). Fingerprint mismatch already wipes on load. | 🔴 open — fix in Phase G |
| 3 | Legacy users with plaintext JSON JWT on disk | One-time migrator (Phase G.13) | 🔴 open — fix in Phase G |
| 4 | Hardcoded `https://your-activation-server.vercel.app` placeholder | Build-time `ACTIVATION_SERVER_URL` already supported via `option_env!` | 🟡 needs CI env var |
| 5 | Free tier unenforced because no gates exist | Phase G.12 is the blocker | 🔴 open — fix in Phase G |
| 6 | Dev-mint accessible in prod | Explicit `ALLOW_DEV_MINT` + NODE_ENV + rate limit | ✅ mitigated |

---

## 7. Open questions for the user

Before Phases E, F, G, please answer:

1. **Activation UX:** keep `html_site/activate.html` as a web licence portal
   (view + deactivate devices) or remove it entirely and push all activation
   into the desktop app via the `gapmap://` deep link?
2. **Lemon Squeezy:** do you already have store + variant IDs? Without them
   Phase F stays deferred.
3. **Free-tier limits:** spec says 1 workspace / 3 sources. For this app is
   that 1 topic / 3 sources? Or different?
4. **Password field:** server currently requires `email + password + key`.
   Tauri spec §20③ shows only `email + key`. Keep password or drop it? (My
   recommendation: drop — the key is itself the secret, and adding a password
   means users who lose it get locked out of a working licence.)
5. **Trial plan:** should new registrations get a `pro_trial`, or is this
   paid-only from day one? If trials, how long (days)?

---

## 8. Headline — done / remaining

### ✅ Done (all phases except shelved G)

- Phases **A** (secrets hygiene), **B** (JWT + deactivate + validate),
  **C** (safe-alphabet keys + dev-mint hardening), **D**
  (`subscription-model.md`), **E** (html_site redirects), **F** (LS webhook
  code — pending only live env vars), **H** (Next.js portal end-to-end).
- Five new API routes, two new pages, dashboard component, LS webhook,
  licence browser client, trial self-service flow.
- `tsc --noEmit` clean across the whole `activation-suite`.

### 🟡 Remaining (environment / product-ops, not code)

- **`LS_WEBHOOK_SECRET`** + **`LS_VARIANT_MAP`** + **`LS_API_KEY`** need real
  values once the Lemon Squeezy store is live. Until then `/webhooks/lemonsqueezy`
  will 401 on every inbound call (correct — we don't want fake events).
- **`RESEND_API_KEY`** + Resend call in the webhook (F.3) to email keys on
  purchase. Right now new licences are created silently; the activation key
  can be surfaced from `/dashboard` while this is pending.
- **Migration** `202604230004_license_plan_fields.sql` must be applied to the
  Supabase project. The schema also needs a `lemonsqueezy_customer_id` and
  `lemonsqueezy_order_id`/`lemonsqueezy_subscription_id` column if you want
  the webhook's external-ref recording to persist — today it no-ops silently
  if those columns are missing.
- **`docs/manual-todo/lemonsqueezy-setup.md`** (F.4) — step-by-step LS
  dashboard checklist.

### ⚪ Shelved

- **Phase G — Tauri refactor.** Intentionally shelved; the licence portal UX
  now lives in Next.js.

### 🟡 Watch items

- Server/desktop secret parity still required: `TOKEN_SIGNING_SECRET` on
  Vercel MUST equal the desktop binary's `JWT_DESKTOP_SECRET`. The fail-hard
  check on the server catches missing values; the desktop fails at
  compile-time via `build.rs`.
- `html_site` becomes a marketing-only surface. Keep its CTAs pointing at the
  Next.js domain via `GAPMAP_APP_BASE`.

---

## 9. Next up

1. Populate LS env vars on Vercel once the store exists; run the plan-columns
   migration against prod Supabase.
2. Wire Resend (F.3) + write `docs/manual-todo/lemonsqueezy-setup.md` (F.4).
3. Optional: re-open Phase G only if the desktop app needs feature gates of
   its own — not needed if the desktop is purely a JWT verifier pointed at
   the Next.js backend.
