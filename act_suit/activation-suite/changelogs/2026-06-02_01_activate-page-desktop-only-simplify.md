# Simplify /activate to a dead-simple desktop-only get-key flow

**Date:** 2026-06-02
**Type:** UI Enhancement

## Summary

The `/activate` page was a confusing 777-line monolith that crammed six sections
onto one screen — including two with hardcoded **fake** data (BYOK keys showing a
phantom `sk-ant-••••8f3a` as "set", and a fake `$69 pending / 3 Apr 2026` purchase
history). It also tried to "activate this browser as a device," which is a strange
concept for a desktop-app product and — worse — consumed the single Pro device seat
that the desktop app needs, causing `device limit reached (409)` in the app.

The page is now a clear, guided **3-step, desktop-only** flow organised into tabs.
Browser activation, the raw JWT dump, and the manual key-input box are gone. The
website's only job is now: **get your key → copy it → open the desktop app and paste
it there.** The desktop app remains the only thing that claims a device seat.

## Changes

- Reframed `/activate` to **desktop-app-only** (confirmed with user): the site issues
  and displays the licence key; the desktop app performs the actual device activation.
- Replaced the single 777-line `ActivatePanel.tsx` with a small orchestrator + focused
  tab components (`ActivateTab`, `DevicesTab`, `BillingTab`) and a shared helpers module.
- **Guided 3-step flow** on the Activate tab:
  1. Sign in (shows the signed-in email, marked Done)
  2. Get your licence key — Start trial / Get free key / Buy Pro, then the key is shown
     in a **"Your licence key" box with a Copy button**
  3. Open the app & paste your key — numbered instructions + Open/Download buttons; shows
     a green "Activated on N devices" note once the desktop app has registered.
- **Re-copyable key:** issued trial/free keys are persisted to `localStorage`
  (`openreply.licence.key`) so the user can copy the full key again at any time. For
  pre-existing licences only the masked `activationKeyPreview` is shown (full key lives
  in the purchase email — the server stores only `sha256(key)`).
- **Removed the API keys (BYOK) tab** from `/activate` — the website never manages the
  desktop app's keys (those live in the Mac Keychain), and the web app already has a
  dedicated `/settings/byok`. Showing it here was redundant/confusing.
- **Removed fake data:** the phantom BYOK "key set" rows and the fake purchase-history
  rows are gone. The Billing tab now shows the **real** plan, renewal/trial date, device
  count, and key preview from the licence record, plus a Lemon Squeezy portal button.
- Removed the raw JWT token display and the "Check activation service" / browser
  "Activate licence" controls that no longer apply.

## Files Created

- `src/components/activate/activateShared.tsx` — shared types, helpers, icons, AlertBox
- `src/components/activate/ActivateTab.tsx` — guided 3-step get-key + open-app flow
- `src/components/activate/DevicesTab.tsx` — real device list, slots, Live Pass upsell
- `src/components/activate/BillingTab.tsx` — real plan summary + portal/upgrade CTAs
- `changelogs/2026-06-02_01_activate-page-desktop-only-simplify.md` — this entry

## Files Modified

- `src/components/activate/ActivatePanel.tsx` — rewritten as a thin orchestrator
  (plan-status strip + tab nav + get-key handlers `startTrial`/`getFreeKey`/`copyKey`;
  dropped `activateLicenseWeb`, `checkActivationService`, JWT, and the key-input box)

## Files Removed

- `src/components/activate/ByokTab.tsx` — API keys tab removed from the activation page
