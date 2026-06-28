# Fix Download button (black text on black bg) — element resets to @layer base

**Date:** 2026-06-05
**Type:** Fix

## Summary

After moving `.btn` into `@layer components` (to fix mobile nav responsiveness),
the Download button rendered dark text on its dark background — invisible. The
layered `.btn-primary { color: var(--cream) }` lost to the **unlayered**
`a { color: inherit }` reset, so the `<a class="btn btn-primary">` inherited the
nav's dark text color. Wrapping the element resets (`*`, `html`, `body`, `a`) in
`@layer base` restores the correct cascade — base < components < utilities — so
button color and responsive utilities both apply.

## Verified (production)

Playwright computed-style check on openreply.myind.ai at 375px:
`background = rgb(28,23,16)` (--dark), `color = rgb(244,239,230)` (--cream) →
high-contrast, legible. Screenshot confirms light "Download" text on the dark
button with the hamburger visible.

## Changes

- `src/app/globals.css` — wrapped `*`, `html`, `body`, `a` resets in
  `@layer base {}`.

## Skill updated

- `~/.claude/skills/web-tailwind-responsive` — added the companion gotcha:
  moving custom component classes into `@layer components` requires moving
  element resets into `@layer base`, or unlayered `a { color: inherit }` makes
  button text invisible.

## Files Modified

- `src/app/globals.css`
