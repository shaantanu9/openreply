# Onboarding Profile UI Width + Avatar Audit

## Scope

This document captures the fix and validation for onboarding Step 2 ("Your profile"):
- Orange hero card width did not use full available content space.
- Avatar initials looked visually wrong for single-word names (for example `SH` looked oversized/awkward in the badge).

## Files Changed

- `app-tauri/src/screens/welcome.js`
- `app-tauri/src/style.css`
- `app-tauri/src/screens/settings.js`
- `app-tauri/src/screens/settings.avatar.test.mjs`

## What Was Fixed

### 1) Step 2 width now follows available screen/content width

#### Before
- Step 2 had hard width constraints via inline or class caps, causing the orange card to appear too narrow.
- CTA row width could drift from the card width.

#### After
- Step 2 uses dedicated classes and full-width behavior:
  - `onboarding-profile-hero` now uses `width: 100%` and `max-width: none`.
  - `onboarding-profile-actions` now uses `width: 100%`.
- Inline width overrides on the Step 2 section were removed.

Result: the orange profile panel and action row now scale to the actual app content area across larger screens.

### 2) Avatar initials are now visually cleaner

#### Before
- Single-word names used first two letters (`shantanu` -> `SH`).

#### After
- Single-word names now use one initial (`shantanu` -> `S`).
- Multi-word names still use first+last initials (`Ada Lovelace` -> `AL`).
- Empty names still fallback to `GM`.

Result: avatar badge remains compact and visually balanced.

## Full App Validation Run

Validation was executed from `app-tauri`:

```bash
npm test
npm run build
npm run test:rust
```

### Results

- `npm test`: **PASS** (14/14)
- `npm run build`: **PASS** (Vite production build completed)
- `npm run test:rust`: **PASS** (26/26)

### Notes

- During build, Vite reported existing dynamic/static import chunking warnings (non-blocking, pre-existing style).
- No new linter diagnostics were introduced in edited files.

## Recommended Manual QA Checklist

Run these checks in the onboarding flow to visually confirm layout quality:

1. Open onboarding Step 2 on a wide desktop window.
2. Confirm orange panel stretches with the content area (not capped to narrow width).
3. Confirm Back/Continue row width matches the card width.
4. Type a single-word name (`shantanu`) and verify avatar shows `S`.
5. Type multi-word name (`Shantanu Bombatkar`) and verify avatar shows `SB`.
6. Resize window through medium and narrow widths and verify:
   - inputs remain aligned,
   - no clipping/overflow,
   - card remains responsive.

## Reuse Guidance

For future onboarding or settings card work:
- Avoid inline layout widths in markup.
- Use screen-specific CSS classes for layout contracts.
- Align card and action-row widths through shared rules.
- Pair UI behavior changes with targeted tests (`*.test.mjs`) before full app test runs.
