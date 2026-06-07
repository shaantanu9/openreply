# miroclaw Prediction & Persona Integration — Analysis + Spec

**Date:** 2026-06-07
**Type:** Documentation

## Summary

Analyzed `~/Documents/miro_jyotish/miroclaw_jyotish/docs` (its persona + prediction
system and its `PORTING_GUIDE.md`) to decide whether that repo can be used directly
in Gap Map or its features should be re-implemented. Finding: miroclaw is *downstream*
of Gap Map (it consumes `gapmap search`/`audience_personas`/`find_gaps`), so it cannot
be a dependency. Of its three portable units, P3 (strategy ensemble) is already covered
by `research/deliberate.py` (same autoresearch lineage) and P2 (OASIS sim) is heavy with
sidecar-packaging risk; only **P1 (prediction engine)** is genuinely net-new. Produced a
detailed implementation spec to re-implement P1 (re-domained to forecast painpoint/gap
salience growth), extend P3 in-place, and add P2 last as an isolated optional dependency.

## Changes

- Investigated miroclaw docs: PORTING_GUIDE, PREDICTION_SYSTEM, STRATEGIES_GUIDE, PRODUCT_DEFINITION.
- Mapped overlap against existing Gap Map code: `persona/*`, `research/deliberate.py`,
  `research/audience.py`, `research/strategy_common.py`, `corpus_temporal_split`.
- Confirmed Gap Map already satisfies the LLM seam the porting guide requires.
- Decided forecast target = painpoint/gap salience growth (back-testable on existing corpus).
- Wrote phased build plan (P1 priority → P3 extend → P2 isolated), with acceptance checks,
  dependency surface, packaging/sidecar isolation rules, and anti-patterns.

## Files Created

- `docs/specs/MIROCLAW_PREDICTION_INTEGRATION.md` — the build-focused integration spec.
- `docs/specs/MIROCLAW_GAPMAP_FULL_ANALYSIS.md` — exhaustive master analysis: full
  product breakdown, P1/P2/P3 units, persona-system comparison, prediction-flow walkthrough,
  "use as package?" decision, end-user value proposition, and a dedicated assessment of
  miroclaw's 12 finance data sources vs Gap Map's ~30 (verdict: 3 redundant, 3 irrelevant,
  3 niche/market-sizing, 3 worth adding — GDELT + DuckDuckGo/Tavily — mainly to serve the
  forecast engine; bulk import rejected due to quantitative-vs-qualitative data mismatch).
- `changelogs/2026-06-07_07_miroclaw-prediction-integration-spec.md` — this entry.

## Files Modified

- None (analysis + spec only; no code changed).
