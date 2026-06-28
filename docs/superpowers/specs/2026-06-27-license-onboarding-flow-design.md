# OpenReply — License Activation + Onboarding + Settings Flow

**Date:** 2026-06-27
**Status:** Approved — implementing
**Decisions:** Hard gate (key required) · Live activation server · Onboarding mandatory steps = AI provider/BYOK + Profile/email · Reuse OpenReply's existing license backend verbatim

## Context

This repo already carries OpenReply's **complete** license backend (Rust `commands.rs`
L7531–9034: `license_status`, `license_activate`, `license_revalidate`,
`license_server_check`, `license_default_api_base`, `license_logout`,
`license_gate_status`) and BYOK system (`byok_status`/`byok_set`/`test_llm`,
keys persisted to `~/.config/openreply/.env`, loaded by the sidecar via dotenv —
`core/config.py` L36). Settings is already a working 4-card dynamic screen
(`dynamic.js` `renderSettings` L488). **Nothing on the backend needs porting.**

The gap is purely the **frontend gate + UI** in the OpenReply SPA
(`app-tauri/src/or/*`, routed by `main.js` → `or/api.js` / `or/dynamic.js`).
Note the OpenReply UI uses `or/api.js` (69 lines), which lacks license
wrappers — those only exist in the separate, unused `src/api.js`.

## Flow spine

```
launch → router gate (gateCheck in main.js):
  not Tauri ............... → requested route (no gate, browser fallback)
  gate disabled .......... → requested route
  not activated .......... → #/activate  (blocking, no sidebar)
  activated, !onboarded .. → #/welcome   (blocking, no sidebar)
  otherwise .............. → requested route
```

## Units

1. **`or/api.js` — license wrappers** (new): `licenseStatus`, `licenseActivate`,
   `licenseRevalidate`, `licenseServerCheck`, `licenseDefaultApiBase`,
   `licenseLogout`, `licenseGateStatus`. Thin `call()` wrappers over the
   existing Rust commands (camelCase args: `apiBase`, `activationKey`, …).

2. **`main.js` — first-run gate** (modify `render()`): async `gateCheck(reqKey)`
   resolves the effective route. `activate`/`welcome` render full-screen
   (sidebar hidden via `mountShell(key, true)`).

3. **`or/dynamic.js` — `renderActivate(view)`** (new): full-screen form —
   email, password, activation key (auto-format `XXXX-XXXX-XXXX-XXXX`, validates
   16 chars A–Z/2–9), API base (prefilled from `licenseDefaultApiBase`, in an
   "Advanced" disclosure). Submit: format check → `licenseServerCheck` →
   `licenseActivate`. Error states: bad format / network / credentials /
   device / revoked. On success → `#/welcome`.

4. **`or/dynamic.js` — `renderWelcome(view)`** (new): post-activation wizard.
   Step 1 Profile (name; email prefilled from `licenseStatus`). Step 2 AI
   provider + key (reuses `byokStatus`/`byokSet`/`testLlm`). Finish →
   `localStorage['or-onboarded']='1'` → `#/agents`.

5. **`or/dynamic.js` — `buildLicenseCard(el)`** (new) added as 5th card in
   `renderSettings`: shows email, plan, expiry, trial-days; Refresh
   (`licenseRevalidate`), Deactivate (`licenseLogout` → `#/activate`).

## localStorage keys

`or-onboarded` (bool), `or-user-name` (string). License truth stays server/Rust
side via `licenseStatus`; localStorage is only UX convenience.

## Out of scope (deferred to first use, per decision)

Reddit auth, create-first-agent (existing `#/onboarding` agent flow unchanged).

## Testing

Manual via `npm run tauri dev`: (a) fresh state → forced to `#/activate`;
(b) bad key format rejected inline; (c) successful activate → `#/welcome` →
provider saved → `#/agents`; (d) Settings shows license card; Deactivate →
back to `#/activate`. Browser (no Tauri) → no gate, static views still render.
