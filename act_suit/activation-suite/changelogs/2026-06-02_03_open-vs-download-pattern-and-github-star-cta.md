# Standard open-vs-download deep-link pattern + GitHub star CTA

**Date:** 2026-06-02
**Type:** Feature | UI Enhancement

## Summary

Two related improvements to the activate/download experience:

1. **"Open app" vs "Download" now follows the industry-standard web→desktop
   handoff pattern.** A website cannot detect whether a desktop app is
   installed (browsers block this), so — like Slack, Linear, VS Code, Discord —
   the "Open Gap Map app" button fires the `gapmap://` deep link and watches for
   the tab losing focus (`visibilitychange` / `blur`). If the OS hands off to
   the app, we stay silent; if the tab is still in the foreground after 1.5s,
   the app likely isn't installed and we prompt the user to download. The
   "Download the app" button always downloads (via `/api/download` → latest
   GitHub release for the visitor's OS). The previous code showed a blind alert
   after 1.2s regardless of whether the app opened.

2. **GitHub star CTA ("⭐ Star us on GitHub").** Added the public repo link as a
   soft, honest ask near the free-key flow on `/activate` and on the `/download`
   page: "Free key, free app. If Gap Map helps you, a GitHub star is the nicest
   way to say thanks." The free key remains available to everyone — starring is
   encouraged, not gated/verified (no false promise of star verification).

## Changes

- `openDesktopApp()` rewritten to use focus-loss detection for the deep-link fallback instead of an unconditional timed alert.
- Added `GITHUB` constant (`repo`, `url`, `releases`) as the single source of truth; `releases.ts` now derives `RELEASE_REPO` / `RELEASES_PAGE_URL` from it.
- Star CTA added to the get-a-key box in `ActivateTab` and to the version-badge row on the download page.

## Files Created

- `changelogs/2026-06-02_03_open-vs-download-pattern-and-github-star-cta.md`

## Files Modified

- `src/lib/constants.ts` — new `GITHUB` constant.
- `src/lib/releases.ts` — derive repo/releases URLs from `GITHUB`.
- `src/components/activate/ActivatePanel.tsx` — standard try-then-fallback `openDesktopApp()`.
- `src/components/activate/ActivateTab.tsx` — "⭐ Star us on GitHub" CTA in the free-key box.
- `src/app/download/page.tsx` — "⭐ Star us on GitHub" CTA next to the releases link.

## Verification

- `tsc --noEmit` + `npm run build` — compiled successfully, 0 errors.
- `/download` renders the star CTA + releases link + live version badge.
