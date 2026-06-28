# OpenReply Activation Suite - Complete Product and Usage Guide

## 1. Document Purpose

This document is the complete functional and operational guide for the `activation-suite` app in `act_suit/activation-suite`.

It covers:

- Product positioning and business purpose
- Complete page-by-page website behavior
- Feature catalog and user value
- Full activation and licensing backend flow
- API contracts and payload schemas
- Data model (Supabase + fallback file mode)
- Environment configuration and setup
- End-to-end usage playbooks
- Testing, validation, and troubleshooting
- Limits, risks, and recommended next improvements

This guide is intended for founders, PMs, engineers, designers, QA, and growth teams.

---

## 2. Product Overview

`activation-suite` currently has **two coordinated responsibilities**:

1. **Public-facing marketing website (sales layer)**  
   A research-led product website for OpenReply that explains value, methodology, pricing, and download flow.

2. **Activation and billing API backend (activation layer)**  
   A server API that supports:
   - user registration
   - paid plan simulation
   - token crediting
   - license creation
   - device activation
   - JWT issuance for desktop app usage

In short: this repo is both the **customer-facing site** and the **license/activation service** for the desktop product.

---

## 3. Product Positioning

### 3.1 Who this product is for

- Research operations teams
- Product managers and product design teams
- Founders validating positioning and roadmap priorities
- Agencies and consultants delivering evidence-backed recommendations

### 3.2 Core promise

OpenReply helps teams:

- collect multi-source voice-of-customer signals
- extract structured insights with AI
- inspect relationships in evidence
- produce decision-ready outputs with traceable source grounding

### 3.3 Outcome framing

Primary outcomes emphasized in product messaging:

- Faster research-to-decision loop
- Better internal alignment via source-backed evidence
- Lower mis-prioritization risk
- Better messaging confidence for GTM and product narratives

---

## 4. Frontend Architecture (Website)

### 4.1 Routing model (App Router)

Main static marketing pages:

- `/` - Long-form research-first sales page
- `/features` - Feature index
- `/pricing` - Plans and token positioning
- `/download` - Platform install choices
- `/faq` - FAQ and support contact

### 4.2 Shared layout and shell

- `src/app/layout.tsx`
  - global metadata
  - wraps pages in `SiteShell`
- `src/components/site-shell.tsx`
  - top navigation
  - persistent CTA to Download
  - footer links and positioning statement

### 4.3 Design system and visual tokens

Defined in `src/app/globals.css`:

- Brand/background/surface colors
- text hierarchy colors
- line/border colors
- accent orange gradient family
- reusable classes:
  - `gm-container`
  - `gm-card`
  - `gm-pill`
  - `gm-btn-primary`
  - `gm-btn-accent`
  - `gm-btn-ghost`

The website intentionally mirrors the OpenReply visual language from the desktop experience.

---

## 5. Detailed Page Breakdown

## 5.1 Home page (`/`)

Purpose: research-first sales narrative and conversion.

Sections:

1. Hero with research-led value proposition and CTAs
2. Metrics strip (speed, reduction in manual work, source coverage)
3. Audience/logo wall
4. Research use cases with business impact
5. Methodology steps (auditable and repeatable process)
6. Three-layer evidence architecture
7. Capability comparison table
8. Outcome cards (revenue/execution/risk)
9. FAQ objections
10. Final conversion CTA

Primary conversion intents:

- Download the desktop app
- Explore plans/pricing
- Learn feature details

## 5.2 Features page (`/features`)

Purpose: quick exploration of capabilities.

Current feature groups:

- multi-source ingest
- topic workspaces
- AI insight extraction
- graph/map views
- report export
- desktop-first privacy posture

## 5.3 Pricing page (`/pricing`)

Purpose: communicate plan clarity and token economics.

Plans:

- Starter: `$9.99` / month
- Pro: `$29.99` / month

Includes:

- team scope
- token allocation
- support tier

## 5.4 Download page (`/download`)

Purpose: install intent and platform state signaling.

Current platform statuses:

- macOS: recommended
- Windows: coming soon
- Linux: planned

## 5.5 FAQ page (`/faq`)

Purpose: reduce objections and provide support endpoint.

Includes:

- product fit
- technical complexity expectations
- BYOK/AI key model
- data privacy positioning
- support email response guidance

---

## 6. Backend API Surface

All major API handlers run on Node runtime.

### 6.1 Health endpoints

- `GET /api/v1/health`
- `GET /v1/health`

Response:

```json
{ "ok": true }
```

### 6.2 Register user

- `POST /api/v1/register`

Request:

```json
{
  "full_name": "Jane Doe",
  "email": "jane@example.com",
  "password": "secret",
  "role": "researcher"
}
```

Behavior:

- Normalizes email to lowercase
- Hashes password (`sha256`) in registration service
- Creates `app_users` row
- Ensures `token_wallets` row initialized to zero

### 6.3 Purchase plan and issue activation key

- `POST /api/v1/purchase`

Request:

```json
{
  "email": "jane@example.com",
  "password": "secret",
  "plan_code": "starter",
  "max_devices": 1
}
```

Behavior:

- Authenticates user by email + password hash
- Inserts `payment_events` record
- Credits wallet balance (`token_wallets`)
- Appends ledger event (`token_ledger`)
- Creates `user_subscriptions` record
- Mints/creates activation license and key

Plan economics in code:

- Starter: `999` cents + `10000` token credit
- Pro: `2999` cents + `50000` token credit

### 6.4 Device activation

- `POST /api/v1/device/activate`
- `POST /v1/device/activate` (desktop-compatible alias)

Request:

```json
{
  "email": "jane@example.com",
  "password": "secret",
  "activation_key": "ABCD-EF12-3456-7890",
  "device_signature": "sha256_or_plain",
  "app": "openreply-desktop",
  "os": "macos",
  "arch": "aarch64"
}
```

Behavior:

- Validates required fields
- Authenticates with hashed credentials + hashed activation key (Supabase mode)
- Performs device binding and max-device limit checks
- Updates `last_seen_at` on repeated activation from same device
- Emits signed JWT token for desktop usage
- Writes activation attempts audit rows (Supabase mode)

Possible error classes:

- invalid credentials/key
- revoked/expired license
- device limit reached
- insert/db failures

### 6.5 Dev mint endpoint

- `POST /api/v1/dev/mint`

Usage:

- Dev/test helper only
- Disabled in production
- Requires `x-dev-mint-secret` header matching `DEV_MINT_SECRET`

Purpose:

- quick local issuance of license key for testing activation flows

---

## 7. License and Token Logic

## 7.1 License creation mode switch

`src/lib/licenseService.ts` chooses backend mode:

- If Supabase is configured: use Supabase store
- Otherwise: fallback to local file store

## 7.2 Device signature handling

If incoming `device_signature` is not already a 64-char hex sha256 digest, service hashes it before storage/comparison.

## 7.3 Max device model

- Each license has `max_devices`
- Existing device reactivations refresh heartbeat and do not consume extra slot
- New unique signature consumes a slot
- Beyond limit returns conflict error

## 7.4 Token issuance

On successful activation, service returns JWT containing:

- `sub` (license id)
- `user_id`
- `email`
- `device_fingerprint`

Token details:

- algorithm: `HS256`
- issuer: `openreply-activation-suite`
- audience: `openreply-desktop`
- default expiry: `180d`

---

## 8. Data Model

Supabase migrations define production data shape.

Core tables:

- `licenses`
- `license_devices`
- `activation_attempts`
- `app_users`
- `user_subscriptions`
- `payment_events`
- `token_wallets`
- `token_ledger`

Security posture:

- RLS enabled on relevant tables
- policies currently focused on `service_role` server access
- legacy plaintext fields kept nullable for compatibility while hash columns are authoritative

Fallback local mode:

- stores licenses in `data/licenses.json`
- used when Supabase env is not configured

---

## 9. Configuration and Environment

Key environment variables:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_ANON_KEY` (project-level context; server auth uses service key)
- `DEV_MINT_SECRET`
- `TOKEN_SIGNING_SECRET` (optional override for JWT signing)

Supabase mode is considered enabled when:

- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are present

---

## 10. End-to-End User Journeys

## 10.1 Public buyer journey

1. Lands on research-first sales homepage
2. Understands methodology, outcomes, and proof framing
3. Checks features and pricing
4. Goes to download page
5. Installs desktop app
6. Completes onboarding and activation

## 10.2 Activation journey (API-backed)

1. Register account (`/api/v1/register`)
2. Purchase/credit + key issuance (`/api/v1/purchase`)
3. Activate device (`/api/v1/device/activate`)
4. Receive token + license/device metadata

## 10.3 Dev/test journey

1. Run local app
2. Call `/api/v1/dev/mint` with secret
3. Activate device via activation endpoint
4. Verify max-device behavior by changing device signature

---

## 11. Usage Playbooks

### 11.1 For product managers

- Use homepage + features pages as internal alignment collateral
- Route decision-makers to methodology and comparison sections
- Use pricing page to frame token/usage plan selection

### 11.2 For sales/GTM

- Lead with evidence architecture and outcome sections on homepage
- Use comparison table for competitive positioning narrative
- Route prospects to download flow for trial intent

### 11.3 For engineering/support

- Use this doc + API sections for integration troubleshooting
- Validate env mode (Supabase vs file fallback)
- Inspect activation attempt logs in Supabase for diagnostics

---

## 12. Validation and Quality Checks

Recommended checks before release:

1. `npm run lint`
2. `npm run build`
3. Verify all routes render:
   - `/`
   - `/features`
   - `/pricing`
   - `/download`
   - `/faq`
4. Smoke test APIs:
   - health
   - register
   - purchase
   - activate
5. Confirm device-limit path returns expected conflict

---

## 13. Known Constraints and Gaps

- Some sales content still uses placeholder/illustrative metrics and logos; replace with verified production numbers.
- Download buttons are currently CTA shells (platform wiring can be expanded to real artifact links).
- No embedded testimonial CMS or analytics funnel yet.
- Activation and marketing layers are in same app; may later split into separate deploy units for scale/security boundaries.

---

## 14. Recommended Next Improvements

1. Add dedicated `Activate License` page for existing users.
2. Add proof section with real customer case studies and attribution.
3. Add analytics events for CTA funnel (`hero -> pricing -> download -> activation`).
4. Add legal pages (`privacy`, `terms`) and route from footer.
5. Add webhook/CRM integration for enterprise/demo lead capture.
6. Add explicit status page for API uptime and activation health.

---

## 15. File Map (Quick Reference)

- `src/app/layout.tsx` - global app metadata + shell wrap
- `src/components/site-shell.tsx` - navbar/footer
- `src/app/page.tsx` - long-form research sales homepage
- `src/app/features/page.tsx` - feature page
- `src/app/pricing/page.tsx` - pricing page
- `src/app/download/page.tsx` - download page
- `src/app/faq/page.tsx` - FAQ/support page
- `src/app/api/v1/*` - API handlers for health/register/purchase/activate/dev mint
- `src/app/v1/*` - compatibility endpoints
- `src/lib/licenseService.ts` - mode switch between stores
- `src/lib/supabaseActivationStore.ts` - Supabase activation implementation
- `src/lib/activationStore.ts` - file fallback activation implementation
- `src/lib/registrationBillingService.ts` - registration + plan + token flow
- `src/lib/token.ts` - JWT issuance
- `supabase/migrations/*` - schema and security migrations

---

## 16. Engineering Change History References (2026-04-22)

To keep operational fixes discoverable for future debugging/recovery, use these
runbook-style entries:

- `changelogs/2026-04-22_04_graph-quality-hardening-and-repair-runbook.md`
  - Covers graph-quality hardening, finding relevance filtering, relation-edge
    false-link guard, and the full `repair-topic-graph` workflow.
- `changelogs/2026-04-22_map-tab-hang-memory-leak-fix.md`
  - Covers map single-flight loading guard and reactive reload loop prevention.
- `changelogs/2026-04-22_03_graph-escape-fix.md`
  - Covers graph HTML export escaping fix.

Recommended recovery command for existing bad topic relations:

`uv run reddit-myind research repair-topic-graph --topic "<topic>" --relevance-threshold 0.34 --json`

