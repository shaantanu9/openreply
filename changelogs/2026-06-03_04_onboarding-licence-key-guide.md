# Onboarding & Settings: "How to get your licence key" guide

**Date:** 2026-06-03
**Type:** UI Enhancement

## Summary

The onboarding licence-entry step (Step 6, "Activate device") gave users no way
to discover where an activation key comes from. The only key-acquisition hints
("Don't have a key? Sign up" / "Redeem a coupon") were rendered **only in the
gate-OFF branch** of `renderStep6Activation`. Because the licence gate now
defaults **ON**, users on the required-activation screen saw three blank inputs
(email / key / password) and an Activate button with zero guidance — they had no
idea how to obtain a key. This adds a shared, collapsible "How to get your key"
guide with a 3-step peer walkthrough and action buttons, shown wherever a key is
entered (onboarding Step 6 + Settings → Licence), in **both** gate states.

## Changes

- New shared component `src/components/licenceGuide.js` — single source of truth
  for the guide:
  - `keyGuideHtml(base, { open, compact })` → collapsible `<details>` panel with
    a numbered 3-step guide (sign in → copy emailed key → activate here) plus
    action buttons.
  - `wireKeyGuide(scope, base)` → opens the real server pages via `api.openUrl`,
    resolved against the active licence server base.
  - Buttons/links map to existing server routes: `/sign-in`, `/dashboard`,
    `/redeem`, `/pricing`, `/activation-help`.
- Onboarding Step 6 (`welcome.js`): replaced the gate-OFF-only get-key/redeem
  links with `keyGuideHtml(initialBase, { open: gateEnabled })` so the guide is
  present in both gate states and auto-expands when activation is required. Wired
  via `wireKeyGuide(body, initialBase)`. Removed the dead `ob-get-key` /
  `ob-redeem-coupon` handlers.
- Settings → Licence (`LicenceCard.js`): replaced the two bare
  `lic2-getkey` / `lic2-redeem` links with the shared guide
  (`keyGuideHtml(apiBase, { compact: true })`), wired via
  `wireKeyGuide(card, portalBase)`.
- `style.css`: added `.key-guide` summary/marker/hover styling and the
  `.kg-link` inline text-link style.

## Verification

- `npm test` → 50/50 pass.
- `node --check` clean on all three JS files.
- `npm run build` (Vite) bundles successfully.

## Files Created

- `app-tauri/src/components/licenceGuide.js`

## Files Modified

- `app-tauri/src/screens/welcome.js` — import + Step 6 guide wiring; removed dead links
- `app-tauri/src/components/LicenceCard.js` — import + guide in activation form; swapped wiring
- `app-tauri/src/style.css` — `.key-guide` + `.kg-link` styles
