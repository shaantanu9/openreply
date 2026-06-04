# Mobile-responsive navbar + site-wide responsive fixes

**Date:** 2026-06-05
**Type:** Fix | UI Enhancement

## Summary

The activation-suite site was "not responsive at all on mobile" — the navbar
broke (primary links were `hidden md:flex` with no fallback, so phone users
lost all navigation), and several marketing sections used fixed multi-column
grids and oversized padding/fonts that crushed or overflowed on small screens.
This change adds a proper mobile hamburger menu, a global horizontal-overflow
guard, responsive container padding, and mobile-first sizing across the
marketing sections and shared shell. Verified with `tsc --noEmit` (clean),
`next build` (45/45 pages, 0 errors).

## Changes

- **NavBar**: added a hamburger menu (`<md`) with a dropdown panel containing
  the primary links + Sign in + Get beta access, Escape-to-close and tap-outside
  to dismiss. Reduced bar padding to `px-4 sm:px-6 md:px-8`. Download CTA label
  shortens to "Download" on phones. Compact variant now wraps and uses
  `px-4 sm:px-8`.
- **globals.css**: `overflow-x: hidden` + `max-width: 100%` on `html`/`body` to
  kill any sideways scroll; `.container-gm`/`.container-narrow` side padding drops
  to `1.25rem` under 640px.
- **MetricsStrip**: responsive inner padding (`px-5 py-8 … md:px-16 md:py-12`),
  metric font scales `34→42→48px`, 2-up on mobile.
- **Footer**: `px-5 sm:px-8`; columns go 1 → `sm:grid-cols-2` → md 4-up.
- **AppWindowMock**: stat grid `grid-cols-2 sm:grid-cols-4`.
- **RoiSection**: panel `p-6 sm:p-8`; stat numbers `24 → 30px`.
- **BeforeAfterSection / DemoSection / PricingSection**: card/body padding
  `p-6 sm:p-10` (was a flat `p-10`).
- **CtaSection**: `px-4 py-[72px] sm:px-8 sm:py-[100px]`; inner panel
  `px-6 py-14 sm:px-10 sm:py-20`.
- **InviteHero**: email form stacks (`flex-col sm:flex-row`), input is full-width
  on phones instead of `min-w-[280px]` forcing an awkward wrap.

## Files Modified

- `src/app/globals.css` — overflow guard + responsive container padding.
- `src/components/shell/NavBar.tsx` — mobile hamburger menu + responsive padding.
- `src/components/shell/Footer.tsx` — responsive padding + column grid.
- `src/components/marketing/MetricsStrip.tsx`
- `src/components/marketing/AppWindowMock.tsx`
- `src/components/marketing/RoiSection.tsx`
- `src/components/marketing/BeforeAfterSection.tsx`
- `src/components/marketing/CtaSection.tsx`
- `src/components/marketing/DemoSection.tsx`
- `src/components/marketing/PricingSection.tsx`
- `src/components/marketing/InviteHero.tsx`

## Verification

- `npx tsc --noEmit` — no errors.
- `npx next build` — Compiled successfully, 45/45 static pages, 0 errors/warnings.
- Note: a pre-existing `react-hooks/set-state-in-effect` lint warning in
  `InviteHero.tsx` is unrelated (its effect logic was not touched).
