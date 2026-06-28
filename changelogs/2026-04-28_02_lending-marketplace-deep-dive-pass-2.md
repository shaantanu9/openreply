# Lending marketplace research — Deep-dive Pass 2

**Date:** 2026-04-28
**Type:** Documentation / Research

## Summary

Second, much wider research pass on the US/Canada home-lending marketplace
opportunity. **3.4×'d the corpus** (853 → 1,979 posts) by collecting two
adjacent angle-topics, ran 6 distinct LLM extraction passes (round 1
all-in-one + 4 single-extractor at n=300 + 2 angle-topic extractions),
and surfaced 12 new findings that didn't appear in Pass 1.

Net result: the original 6-feature blueprint is now an **8-feature blueprint
with 2 vertical extensions** (solar, HVAC), each grounded in direct user
quotes. The Canada white-space and contractor-tooling-churn observations
add 2 new market-structure observations to the Pass 1 thesis.

## Changes

- Collected 2 angle-topics in parallel:
  - "home improvement financing marketplace usa canada contractors homeowners" → 563 posts
  - "roof financing marketplace usa canada" → 290 posts
  - Original "US Canada roofing contractor homeowner lending marketplace" grew 853 → 1,126
- Ran 4 single-extractor passes at n=300 on the original topic
  (painpoints / features / complaints / diy) — produced richer per-extractor
  output than the round-1 combined run.
- Ran 2 combined extractions on the angle-topics — produced 13 features
  on home-improvement (highest count yet) and 5 distinct competitor
  complaints on roof-financing.
- Direct SQL pulls for dark-pattern keywords surfaced 5 high-upvote
  Reddit posts ("HVAC mafia" 1,193 ups; "50yr mortgages" 1,951 ups;
  "$1,000/mo escrow surprise" 1,186 ups) that LLM extraction missed.
- Closed the "competitor mentions" coverage gap from Pass 1: from 2
  named products to 11 (Prosper, Rocket Mortgage, New American Funding,
  American Home Shield, Tesla Solar Roof, OfferUp, JobNimbus, Roof Hub,
  Roof Pitch, Joist, Housecall Pro, Contractor+).
- Identified 2 new feature wishes (loan-account aggregator,
  escrow-surprise predictor) and 2 new vertical extensions (solar, HVAC)
  with direct evidence quotes.
- Confirmed Canada is an actively-broken UX gap, not just an underserved
  geography.

## Files Created

- `changelogs/2026-04-28_02_lending-marketplace-deep-dive-pass-2.md`

## Files Modified

- `docs/research/2026-04-28_us-canada-home-lending-marketplace.md` —
  appended a 10-section "Deep-dive Pass 2" appendix (A1–A10) with the
  new findings, organised so it slots in after the existing Pass-1
  body without rewriting it.
