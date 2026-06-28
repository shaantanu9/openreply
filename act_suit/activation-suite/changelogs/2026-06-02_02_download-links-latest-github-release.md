# Wire download links to latest GitHub release (all platforms)

**Date:** 2026-06-02
**Type:** Feature

## Summary

The website's "Download" CTAs were gated behind sign-in/activate and the
`/download` page only offered macOS (with Windows/Linux marked "coming soon"),
even though `myind-ai/openreply` now publishes signed builds for macOS (Apple
Silicon + Intel), Windows (.exe + .msi), and Linux (.AppImage + .deb). The
release asset filenames embed the version (`Gap-Map-0.1.18-...`), so GitHub's
`/releases/latest/download/<file>` shortcut can't be hard-coded — it breaks on
every version bump.

This adds a server-side `/api/download` endpoint that queries the GitHub
Releases API for the **latest** release, matches each platform by a stable
filename suffix, and 302-redirects to the asset. It auto-detects the visitor's
OS from the User-Agent (or takes an explicit `?platform=`), so every download
link on the site "just works" on any device and always points at the newest
build with zero manual updates per release. The GitHub API response is cached
15 min server-side to stay well under the unauthenticated rate limit.

## Changes

- New `/api/download` route: `?platform=mac-arm|mac-intel|windows|windows-msi|linux|linux-deb`, or UA auto-detect when omitted. Redirects to the latest release asset; falls back to the releases page on any failure.
- New `src/lib/releases.ts`: cached `fetchLatestRelease()`, per-platform asset matcher (`assetUrlForPlatform`), UA→platform guess (`platformFromUserAgent`), and repo/URL constants.
- `useDownloadHref` now resolves to `/api/download` (optionally per-platform) instead of the sign-in/activate funnel. `NEXT_PUBLIC_APP_DOWNLOAD_URL` still overrides if set.
- `DownloadLink` accepts an optional `platform` prop; all existing CTAs keep working (default = OS auto-detect).
- `/download` page rewritten: 4 real platform cards (macOS Apple Silicon, macOS Intel, Windows, Linux) with primary + alt-format links, a live "Latest: vX.Y.Z" badge, and a "View all releases & changelog" link.

## Verification

- `tsc --noEmit` — no errors.
- All 7 `/api/download` variants 302 → correct `v0.1.18` asset.
- UA detection: Windows UA → `.exe`, Linux UA → `.AppImage`, Mac UA → Apple Silicon `.dmg`.
- `/download` renders all 4 cards + live version badge.

## Files Created

- `src/lib/releases.ts`
- `src/app/api/download/route.ts`
- `changelogs/2026-06-02_02_download-links-latest-github-release.md`

## Files Modified

- `src/hooks/use-download-href.ts` — point downloads at `/api/download`, drop session gating, accept platform arg.
- `src/components/shell/DownloadLink.tsx` — add optional `platform` prop.
- `src/app/download/page.tsx` — all-platform cards + live latest-release version + releases link.
- `src/components/activate/ActivatePanel.tsx` — the activate-page "Download the app" button fell back to the (now-blank) `NEXT_PUBLIC_APP_DOWNLOAD_URL` and dead-ended; it now defaults to `/api/download` so it always works.
- `src/lib/releases.ts` — optional `GITHUB_TOKEN` support to lift the API rate limit 60 → 5,000/hr.
- `.env.example` — clarify that `NEXT_PUBLIC_APP_DOWNLOAD_URL` should stay blank; document optional `GITHUB_TOKEN`.

## Site-wide CTA audit (all download buttons now resolve to a real URL)

| Location | CTA | Routes to |
|---|---|---|
| NavBar | Download for Mac | `/api/download` (OS auto-detect) |
| HeroSlider (all 3 slides) | Download free for Mac | `/api/download` |
| FeaturesGrid / UseCasesSection / CtaSection / PricingSection | Download for Mac | `/api/download` |
| StickyDownloadBar | Download for Mac | `/api/download` |
| /download page | 4 platform cards + alt formats | `/api/download?platform=…` |
| /pricing page | Download for Mac | `/download` chooser page |
| /activate (step 3) | Download the app | `/api/download` (fixed) |
