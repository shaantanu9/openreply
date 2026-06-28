# Research loop design + post-MVP roadmap

**Date:** 2026-04-19
**Type:** Documentation

## Summary

Captured a brainstorming session that defined the next major direction for the app: a 4-stage research loop (Problem → Why → Science → Solution) that turns the existing painpoint extractor into a decision-support system serving five distinct audiences (build, message, market, intervene, synthesize). Two design files written: the MVP spec (one fused lens, no new sources, all four stages) and the post-MVP roadmap (deferred extraction dimensions, new scientific sources, additional lenses, verification mode, longitudinal features).

## Changes

- Defined the core "Problem → Why → Science → Solution" loop as the architectural backbone for the next phase.
- Locked MVP scope: emotion + JTBD extraction, science cross-reference via existing PubMed/Scholar/OpenAlex fetchers, LLM-synthesized interventions with confidence tiers, one fused "Build & Intervene" lens.
- Added 3 new graph node kinds (`mechanism`, `intervention`, `evidence_paper`) and 3 new edge kinds to the data model design.
- Documented cost estimates: ~40 LLM calls + ~60 fetches per topic, roughly 2× current `enrich_graph` cost.
- Captured 7 layers of post-MVP work as a structured backlog with promotion checklist.

## Files Created

- `docs/superpowers/specs/2026-04-19-research-loop-design.md` — MVP design spec
- `docs/superpowers/specs/2026-04-19-research-loop-post-mvp.md` — deferred-work roadmap (covers deeper Why extraction, stronger Science layer, BCT taxonomy, 10 new sources, lenses B/C/E, verification mode, cross-topic features)

## Files Modified

None.
