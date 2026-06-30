# Fix raw HTML showing literally in screen headings

**Date:** 2026-06-30
**Type:** Fix

## Summary

Screen headings rendered through the `head()` helper were showing raw HTML
markup as literal text — e.g. the Brain screen title displayed
`Brain <span class='text-base font-normal text-zinc-400'>(unified)</span>`
verbatim instead of "Brain (unified)" with a dimmed parenthetical. Root cause:
`head()` escaped its title argument with `esc()`, so any inline markup (and HTML
entities) authored into a title was escaped and printed character-for-character.

## Changes

- Removed `esc()` from the title in the `head()` helper so developer-authored
  inline HTML in titles renders as markup (consistent with the subtitle arg,
  which was already raw HTML, and with the direct `<h1>` templates in `views.js`).
- Verified all 22 `head()` call sites pass static developer-authored title
  strings — no user data is ever interpolated into a title (dynamic values only
  appear in the subtitle), so this introduces no XSS surface.
- This also fixes the **Keywords & platforms** title, whose `&amp;` entity was
  being double-escaped into a literal `&amp;`.

## Files Modified

- `app-tauri/src/or/dynamic.js` — `head()` helper no longer escapes its title;
  added a comment noting titles/subtitles may contain inline HTML and that user
  data must be wrapped in `esc()` before being passed.
