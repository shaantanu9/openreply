# Per-Topic Deep-Dive Research Document — Home-Improvement Lending Marketplace

**Date:** 2026-04-28
**Type:** Documentation

## Summary

Built a third research document that drills into each painpoint, concept, competitor, and feature with direct citation backing. Companion to the existing `2026-04-28_us-canada-home-lending-marketplace copy.md` (the thesis) and `2026-04-28_PRD-build-ready.md` (the build-ready spec). This document is the citation index — every claim is grounded in a Reddit post ID, App Store / Play Store review ID, GNews ID, or OpenAlex ID re-pullable from the SQLite corpus.

## Changes

- Mined the 1,890-post corpus across 6 lending topics via `reddit-myind` MCP `query_db` (semantic search MCP was unavailable mid-session)
- Pulled top 60 Reddit posts by engagement; full quote + ID + permalink for each
- Pulled all 1★ App Store / Play Store reviews for the 28 competitors with ≥ 5 reviews each
- Pulled industry-news GNews signals (Houzz × Figure HELOC, GreenSky × RAFTR, GreenSky × TAMKO, PACE-loan controversy, BNPL late-payment surge)
- Pulled academic-paper IDs from OpenAlex / Scholar for the moat narrative (predatory mortgage lending, FinTech consumer-lending discrimination, HELOC adverse-selection, payment-shock, neighborhood subprime)
- Built per-vertical scope schemas (roofing MVP, HVAC P1, solar P1) so lender offers can anchor against structured project data
- Built the build-order matrix: 18 features mapped to MVP / P1 / P2 with required integrations
- Documented 8 explicit anti-features (what we are deliberately not building, and why)
- Documented competitor-level decision: integrate (CRMs + utilities) vs compete (Hearth, GreenSky, EnerBank) vs exclude-from-shelf (Prosper, predatory aggregators)
- Identified Hearth (54.5% 1★ rate, 110 reviews) and GreenSky (85.7% 1★ rate, 7 Play reviews) as the two most-vulnerable incumbents — with a 6–12 month window of opportunity created by the GreenSky × RAFTR + GreenSky × TAMKO distribution deals

## Files Created

- `docs/research/2026-04-28_lending-marketplace-deep-dive.md` — the new per-topic deep-dive document (11 sections, 14 painpoints with cited evidence, full per-competitor teardown, industry signal, academic backing, per-vertical scope schemas, build-order matrix)
- `changelogs/2026-04-28_04_lending-marketplace-deep-dive-per-topic.md` — this changelog

## Files Modified

- (none)
