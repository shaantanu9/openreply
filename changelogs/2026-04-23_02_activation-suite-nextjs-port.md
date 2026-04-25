# Activation Suite: Port html_site → Next.js 16 app

**Date:** 2026-04-23
**Type:** Feature / UI Port / Infrastructure

## Summary

Ported the entire `act_suit/html_site/` static prototype into the `act_suit/activation-suite/` Next.js 16 app. The app now renders the cream/Fraunces marketing design natively, with the marketing hero slider, sign-in, and licence activation flows wired through real Supabase Auth + the existing server activation store. The `[...legacy]` HTML proxy route and its loader have been removed. Production `next build` passes.

## Changes

- Design system rewritten: `globals.css` now holds the cream/orange palette, Fraunces + DM Sans + JetBrains Mono via `next/font/google`, and shared utility classes (`.btn-*`, `.section-*`, `.reveal`, etc).
- Layout switched to Fraunces/DM Sans/JetBrains Mono with CSS-variable font handoff.
- Marketing home at `/` decomposed into 10 section components (HeroSlider, MetricsStrip, HowItWorks, FeaturesGrid, EvidenceArchitecture, PricingSection, ComparisonTable, Testimonials, FaqAccordion, CtaSection) + shared AppWindowMock + RevealOnScroll.
- Hero slider is a client component: 3 persona-aware slides, auto-advance every 5.5 s, dot progress bar, prev/next arrows, pause-on-interaction via interval reset.
- Shared shell: new `NavBar` (marketing fixed translucent + compact sticky variants), auth-aware `UserMenu` dropdown, `DownloadLink` that rewrites `#download` based on session + env, and dark `Footer`.
- Sign-in page ported as a single `SignInPanel` client component with login / register / forgot tabs, wired to `supabase.auth.signInWithPassword`, `supabase.auth.signUp`, and `supabase.auth.resetPasswordForEmail`. Persists user metadata (first/last/full name, role) on signup.
- Activate page ported as `ActivatePanel` client component: key input with live normalise/format, paste button, Supabase session gate (redirects to /sign-in if signed out), licence activation via new `/api/v1/web/activate`, error-copy mapping, Lemon Squeezy checkout + portal buttons, desktop deep-link launch, purchase history + devices + BYOK panels.
- New server endpoint `POST /api/v1/web/activate`: verifies a Supabase JWT bearer token (no password), then delegates to the new `activateDeviceSupabaseByEmail` store function. Legacy `/api/v1/device/activate` (email+password desktop flow) remains unchanged.
- Features / Pricing / Download / FAQ pages re-skinned with the new design tokens and share components with the marketing home.
- Activation-help page ported 1:1 as a static TSX page.
- `[...legacy]/route.ts` and `src/lib/legacySite.ts` deleted — the site no longer proxies `../html_site/*.html`.
- `.env.example` rewritten to document `NEXT_PUBLIC_*` public keys alongside the server-only secrets. `publicEnv.ts` reads them with legacy name fallbacks so existing `.env` files keep working.
- Next caching: static marketing pages use `export const revalidate = 3600`; `/sign-in` and `/activate` use `export const dynamic = "force-dynamic"` because they depend on Supabase session state.

## Files Created

- `src/app/page.tsx` (replaced redirect; now renders marketing home)
- `src/app/sign-in/page.tsx`
- `src/app/activate/page.tsx`
- `src/app/activation-help/page.tsx`
- `src/app/api/v1/web/activate/route.ts`
- `src/components/brand/Logo.tsx`, `src/components/brand/LogoMark.tsx`
- `src/components/shell/NavBar.tsx`, `Footer.tsx`, `SiteShell.tsx`, `UserMenu.tsx`, `DownloadLink.tsx`
- `src/components/marketing/HeroSlider.tsx`, `AppWindowMock.tsx`, `MetricsStrip.tsx`, `HowItWorks.tsx`, `FeaturesGrid.tsx`, `EvidenceArchitecture.tsx`, `PricingSection.tsx`, `ComparisonTable.tsx`, `Testimonials.tsx`, `FaqAccordion.tsx`, `CtaSection.tsx`, `RevealOnScroll.tsx`, `DownloadArrow.tsx`
- `src/components/auth/SignInPanel.tsx`
- `src/components/activate/ActivatePanel.tsx`
- `src/hooks/use-session.ts`, `use-download-href.ts`, `use-reveal-on-scroll.ts`
- `src/lib/constants.ts` (brand, routes, nav, plans, metrics, hero slides, features, faq, evidence, comparison, testimonials)
- `src/lib/publicEnv.ts`, `supabaseBrowser.ts`, `supabaseAuthServer.ts`
- `src/lib/activationKey.ts`, `activateClient.ts`, `activationErrors.ts`, `deviceSignature.ts`, `lemonSqueezy.ts`

## Files Modified

- `src/app/layout.tsx` — Fraunces + DM Sans + JetBrains Mono fonts, new metadata, no more SiteShell wrapping (pages pick their shell variant).
- `src/app/globals.css` — new design-token palette + utility classes.
- `src/app/features/page.tsx`, `pricing/page.tsx`, `download/page.tsx`, `faq/page.tsx` — re-skinned with shared marketing components.
- `src/lib/supabaseActivationStore.ts` — added `activateDeviceSupabaseByEmail` for bearer-auth activation (no password).
- `.env.example` — documents `NEXT_PUBLIC_*` public env and keeps existing server-only secrets.

## Files Removed

- `src/components/site-shell.tsx` (replaced by `src/components/shell/SiteShell.tsx`)
- `src/app/[...legacy]/route.ts` (no longer proxies `html_site/*.html`)
- `src/lib/legacySite.ts` (unused after legacy route deletion)

## Verification

1. `cd act_suit/activation-suite && npm run build` → ✓ compiles, ✓ TypeScript passes, ✓ 19 routes generated (6 static marketing pages, 13 dynamic).
2. `npm run dev` then:
   - `curl localhost:3000/` → 200
   - `curl localhost:3000/{sign-in,activate,activation-help,features,pricing,download,faq}` → 200
   - `curl -X POST localhost:3000/api/v1/web/activate` (no bearer) → 401 `missing bearer token`
   - `curl -X POST localhost:3000/api/v1/web/activate -H 'Authorization: Bearer invalid.token'` → 401 invalid JWT
3. Manually: navigate to `/`, verify hero slider advances every 5.5 s, click dots + arrows. Navigate to `/sign-in`, confirm tabs switch, submit empty form → validation. Navigate to `/activate` unauthenticated → redirects to `/sign-in`.
