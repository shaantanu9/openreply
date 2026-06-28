# Marketing Homepage → Conversion-Optimised Sales Page

**Date:** 2026-04-28
**Type:** UI Enhancement

## Summary

Redesigned the activation-suite marketing homepage as a proper sales page. Audited the existing 13-section layout, identified 7 missing conversion-critical surfaces (problem agitation, before/after, demo, social proof bar, urgency banner, risk-reversal, sticky CTA), built each, and re-ordered the page to follow AIDA + objection-stack: ATTENTION → INTEREST → DESIRE → ACTION → OBJECTION → CLOSE.

## Audit findings (what was broken)

- **No problem/agitation beat** — the page jumped from hero to use cases. Buyers need to feel the pain before they value the cure.
- **No social-proof bar above the fold** — the hero had an avatar trust row but no logo strip.
- **No before/after framing** — the single most powerful conversion device for B2B was missing.
- **No demo section** — for a desktop research tool, buyers need to see the UI in motion.
- **No urgency** — no banner, no scarcity, no "X teams joined this month".
- **No risk reversal** — no money-back, no "free forever for solo", no concrete safe-to-try guarantee.
- **Wrong section order**: Pricing came before Testimonials (no social proof set up the price), Comparison came AFTER Pricing (objections un-handled), FAQ buried the close.
- **MetricsStrip orphaned** in a `py-10` wrapper, breaking visual rhythm.
- **One final CTA at the very bottom** — no sticky download bar, no repeat CTA path.

## New sales-page IA (AIDA + objection-stack)

```
ATTENTION  → UrgencyBanner · HeroSlider · TrustLogoBar · MetricsStrip
INTEREST   → ProblemSection · BeforeAfterSection · HowItWorks · DemoSection
DESIRE     → FeaturesGrid · EvidenceArchitecture · UseCasesSection · Testimonials
ACTION     → RoiSection · ComparisonTable · PricingSection
OBJECTION  → RiskReversalSection · SecurityTrustSection · FaqAccordion
CLOSE      → FinalPromiseSection · CtaSection · StickyDownloadBar (fixed)
```

## Changes

### Seven new components

- **`UrgencyBanner.tsx`** — thin dark bar pinned above SiteShell. Reinforces "free during launch, paid Pro Q3" without a countdown timer.
- **`TrustLogoBar.tsx`** — 8-logo monochrome strip directly under the hero. Initials-in-pills until partner logos land — swap-in safe.
- **`ProblemSection.tsx`** — three statistics framed as a tax the reader is paying right now (23h/wk, $58k/yr, 1-in-7 decisions without evidence). Heavy figure → restrained body copy.
- **`BeforeAfterSection.tsx`** — side-by-side workflow contrast. Muted cream-dark on the left (strikethrough text, × bullets), full-color brand on the right (✓ bullets, accent badge). Footer line counts the swap: "23h → 3h, 4 tools → 1 app".
- **`DemoSection.tsx`** — interactive 4-step demo switcher inside a faux browser frame on a dark canvas. Each frame ships a length badge ("demo · 12s") so users self-select commitment.
- **`RiskReversalSection.tsx`** — 4-card grid with concrete safe-to-try guarantees (free forever for solo, local-first data, BYOK at cost, cancel-without-asking).
- **`FinalPromiseSection.tsx`** — three numbered closing commitments before the final CTA, including the 30-day refund clause for Pro.
- **`StickyDownloadBar.tsx`** — slim fixed pill that fades in once the user scrolls past 720px. Hidden on mobile (preserves tap area).

### Reorganised `page.tsx`

- New AIDA + objection-stack order documented inline.
- MetricsStrip wrapped in a proper section context with consistent padding.
- StickyDownloadBar mounted outside SiteShell so it floats globally.
- UrgencyBanner mounted outside SiteShell so it sits above the sticky nav.

### Copy data (`constants.ts`)

Added `URGENCY_BANNER`, `TRUST_LOGOS`, `PROBLEM_STATS`, `BEFORE_AFTER`, `DEMO_FRAMES`, `RISK_REVERSAL`, `FINAL_PROMISE`. Every body copy is concrete (numbers, time-spans, dollar amounts) — no corporate filler.

### Verified

- ESLint: clean across all 8 modified/new files
- Dev server (running on :3000): `curl /` → HTTP 200, 227 KB, all 18 section anchors present, all 7 new section markers detected.

## Files Created

- `src/components/marketing/UrgencyBanner.tsx`
- `src/components/marketing/TrustLogoBar.tsx`
- `src/components/marketing/ProblemSection.tsx`
- `src/components/marketing/BeforeAfterSection.tsx`
- `src/components/marketing/DemoSection.tsx`
- `src/components/marketing/RiskReversalSection.tsx`
- `src/components/marketing/FinalPromiseSection.tsx`
- `src/components/marketing/StickyDownloadBar.tsx`
- `changelogs/2026-04-28_07_homepage-sales-page-redesign.md` — this changelog

## Files Modified

- `src/app/page.tsx` — full re-order (AIDA + objection-stack), 7 new sections wired, sticky-bar mount
- `src/lib/constants.ts` — added 7 copy data exports
