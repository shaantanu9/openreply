# US/Canada home-lending marketplace — research brief

**Date:** 2026-04-28
**Type:** Documentation / Research

## Summary

Used the `reddit-myind` CLI end-to-end to research the gap in the
US/Canada home-lending marketplace where lenders, contractors
(roofing / HVAC / solar / kitchen-bath), and homeowners meet. Topic
was already in the DB with only 8 posts; an aggressive 12-source
collect grew that to 853, and an NVIDIA NIM gap extraction surfaced
10 painpoints, 5 feature wishes, 2 named-competitor complaints,
and 5 DIY workarounds — every claim grounded in a direct user quote.

The brief is now a real, evidence-anchored marketplace blueprint:
3-persona surface design (lender / contractor / homeowner),
8-competitor gap table (LendingTree, Hearth, GreenSky, Wisetack,
Houzz, Angi, NerdWallet, Borrowell), regulatory moat analysis (TILA /
RESPA / ECOA / Bank Act / provincial cost-of-credit / CSLB /
PIPEDA), 4-stage sequencing plan (Texas roofing MVP → multi-vertical
multi-state → homeowner-first → Canada → defensibility data moat),
and 4 open questions with corpus-grounded reasoning for each.

## Changes

- Canonicalised topic via `research canonicalize` — confirmed the
  canonical string and surfaced 7 LLM-expanded search keywords.
- Discovered subreddits via `research discover` — top hits
  `r/Mortgages` (rel=0.80), `r/Renovations` (0.40); aggressive
  collect picked up `r/RealEstate / r/HomeImprovement /
  r/realestateinvesting / r/homeowners`.
- Aggressive multi-source collect — 853 posts across 12 sources:
  Reddit (150), Google News (293), App Store (166), Play Store
  (98), Scholar (35), OpenAlex (34), arXiv (29), GitHub + issues
  (33), HN (5), Lemmy + Mastodon (10).
- Gap extraction via NVIDIA NIM — 10 painpoints / 5 feature wishes /
  2 product complaints / 5 DIY workarounds.
- Saturation = 0.0 (saturated — last 50 posts add no new clusters).
- Coverage gaps: only "competitor mentions" remains (recommended
  next: `deepen_products` run via the desktop app).
- Wrote the synthesis doc with the marketplace blueprint, validated
  thesis, competitor gap table, regulatory moat, sequencing plan,
  raw signal section, and follow-up pipeline commands.

## Files Created

- `changelogs/2026-04-28_01_us-canada-lending-marketplace-research.md`
- `docs/research/2026-04-28_us-canada-home-lending-marketplace.md`
