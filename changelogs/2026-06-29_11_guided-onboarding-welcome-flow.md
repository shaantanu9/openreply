# Guided 4-step onboarding (value-prop / sales + setup + how-to-use)

**Date:** 2026-06-29
**Type:** UI Enhancement

## Summary

Replaced the single-card first-launch wizard (name + provider + key + "Finish
setup") with a 4-step guided onboarding that doubles as an in-app sales page, so
a brand-new user understands what OpenReply does and how to use it before
landing in the app. The setup mechanics (BYOK save + live "Test connection")
are preserved and the connection test now works (see changelog 10).

## Changes

- `app-tauri/src/or/dynamic.js` → `renderWelcome` rewritten as a stepper with
  local state (`step`, `name`, `provider`, `key`, `tested`) and an animated
  progress-dot indicator:
  1. **Welcome / value prop** — headline + 3 feature pillars (find the right
     conversations · on-brand AI drafts · you stay in control) with icons.
     CTA "Get started →".
  2. **Profile** — name capture (persisted to `or-user-name`). Back / Continue.
  3. **Connect your AI** — provider picker + dynamic key/Base-URL field +
     working **Test connection** (calls `api.testLlm`, shows ✓ Connected ·
     provider · model). Validates + persists via `byokSet` before advancing;
     sets `or-onboarded`. Back / Continue.
  4. **You're ready / how-to** — personalized success card + a 3-step "how to
     get your first reply out" guide (create an agent → it finds opportunities
     → review & post). Primary CTA "Create my first agent →" routes to
     `#/onboarding` (new-agent flow); secondary "Skip — explore the app first"
     routes to `#/agents`.
- Styling reuses the existing dark/reddit-brand tokens (`card`, `btn`, `btnP`,
  `bg-reddit`, opacity variants). Icons via the locally-bundled Lucide set
  (radar, sparkles, shield-check, bot, send, check).

## Verification

- `npm run build` (Vite) succeeds — 1717 modules, `dist/assets/main-*.css`
  41.9 KB.
- New utility classes confirmed compiled into the bundled CSS:
  `bg-reddit/10`, `bg-reddit/50`, `bg-emerald-500/15`, `align-[-2px]`,
  `h-9`, `w-9`, `text-emerald-500`.

## Files Modified

- `app-tauri/src/or/dynamic.js` — `renderWelcome` rewritten as a 4-step guided
  flow (was a single setup card)

## Follow-up

- Visible to users after the next Tauri app rebuild.
