# Fix mobile nav responsiveness — `.btn` now in @layer components

**Date:** 2026-06-05
**Type:** Fix

## Summary

The marketing nav did not collapse on phones — secondary CTAs ("Get beta
access", "Pricing") stayed visible and pushed the hamburger button off-screen.
Root cause: in Tailwind v4 (`@import "tailwindcss"`), the custom `.btn` class
was written as **unlayered** plain CSS, so `.btn { display: inline-flex }` beat
Tailwind's `hidden` / `lg:inline-flex` utilities (unlayered rules always win
over layered ones). Every `btn … hidden lg:inline-flex` on the site was
silently broken. Wrapping the button rules in `@layer components` lets the
utilities override `display` again.

Verified with a Playwright overflow probe at 375 / 430 / 768 / 1280px: the nav
cluster and hamburger no longer overflow; page horizontal overflow is 0 at all
widths. (The comparison table sits in an `overflow-x-auto` card — scrollable,
expected.)

## Changes

- `src/app/globals.css` — wrapped the entire BUTTONS block (`.btn`, `.btn-ghost`,
  `.btn-primary`, `.btn-orange`, `.btn-lg`, `.btn-sm`, …) in
  `@layer components { … }` so Tailwind utilities can override button `display`.
- `src/components/shell/UserMenu.tsx` — hide the user's name text below `sm`
  (`hidden … sm:inline`) so a signed-in user's nav cluster stays compact on
  phones (avatar only).

## Skill captured

- `~/.claude/skills/web-tailwind-responsive/SKILL.md` — documents the unlayered-
  class-beats-utilities gotcha, the `@layer components` fix, and the reusable
  Playwright overflow-probe script, so this isn't re-debugged from scratch.

## Files Modified

- `src/app/globals.css`
- `src/components/shell/UserMenu.tsx`
