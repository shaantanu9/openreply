# Website performance: co-locate region, add loading skeletons, trim bundle

**Date:** 2026-06-03
**Type:** Performance

## Summary

Pages felt slow to load. Investigation against production found the dominant
cause was a **region mismatch**: Vercel functions ran in `iad1` (US-East) while
the Supabase database is in `ap-southeast-1` (Singapore), and users are in
India — so every dynamic/API/auth request did a US↔Singapore round trip
(browser → Mumbai edge → US function → Singapore DB → back). Static marketing
pages were already fast (prerendered + CDN, warm TTFB 75–115ms), but dynamic
app pages (sign-in, dashboard, admin, workspaces, activation) paid the
cross-continent penalty AND had no loading state, so the UI just froze.

## Changes

- **Region co-location (primary fix):** set `"regions": ["sin1"]` (Singapore) in
  `vercel.json` so functions sit next to the `ap-southeast-1` Supabase DB and
  far closer to India users. Eliminates the US round trip on every dynamic/API/
  auth call and speeds ISR regeneration.
- **Route loading skeletons (perceived speed):** added `loading.tsx` to all 12
  dynamic routes (dashboard, admin, workspaces, workspaces/[id], explore,
  explore/[slug], u/[username], sign-in, activate, redeem, settings/profile,
  settings/byok), each re-exporting a shared `PageLoading` skeleton. Navigation
  now shows an instant branded placeholder instead of a blank/frozen screen.
- **Bundle trimming:** `next.config.ts` now sets
  `experimental.optimizePackageImports: ["radix-ui","@base-ui/react","motion"]`
  (lucide-react / recharts / date-fns are already optimized by Next 16 default)
  and `compiler.removeConsole` (keep error/warn) for production.

## Investigation notes (for future reference)

- Homepage JS is 253 KB compressed (868 KB uncompressed) — moderate, not the
  problem. 18 of 23 marketing sections are server components; recharts is
  correctly isolated to admin/dashboard only.
- An early grep suggested THREE.js was bloating the bundle — false positive:
  there is no `three` dependency; the matches were the English word "three".
- Static pages are prerendered with 1h–15m revalidate + CDN cache (fast).

## Files Created

- `src/components/ui/page-loading.tsx` — shared route skeleton
- `src/app/{dashboard,admin,workspaces,workspaces/[id],explore,explore/[slug],u/[username],sign-in,activate,redeem,settings/profile,settings/byok}/loading.tsx`
- `changelogs/2026-06-03_03_website-performance-region-loading-bundle.md`

## Files Modified

- `vercel.json` — `regions: ["sin1"]`
- `next.config.ts` — `optimizePackageImports` + `removeConsole`
