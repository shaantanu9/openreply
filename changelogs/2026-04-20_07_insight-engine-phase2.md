# Insight Engine Phase 2 — methodology-grade rigor layer

**Date:** 2026-04-20
**Type:** Feature

## Summary

Ships Phase 2 of the Insight Engine, informed by review of
`docs/GAP_MAP_METHODOLOGY.md`. Adds six concrete upgrades that transform
Insights from "opportunity list" into a consulting-grade research brief:
Minto pyramid header, falsifiable hypothesis cards, counter-evidence
surfacing, Ulwick Opportunity Scoring, triangulation badges, and Bayesian
credible intervals. All extend the existing single synthesis call — no
new tabs, no schema migrations, no Rust changes.

Explicit scope-control: 7 items from the methodology doc were rejected
as noise (issue-tree UI, dual-model κ dashboard, 30-source expansion,
Neo4j migration, weekly human-QA dashboard, BibTeX export, adversarial
test harness). See spec §Phase 2 for the in/out list.

## Changes

- Minto pyramid header: `governing_thought` (1 sentence) + 3
  `key_arguments` with evidence chips render as the first section on
  Insights tab. Reader gets the answer in sentence one (Minto 1987).
- Hypothesis cards: top-5 opportunities generate falsifiable bets
  with `we_believe / experiences / because / and_would / for`, plus
  MEASURABLE falsifiers + cheapest test + time-box + budget. Popper
  validator drops unfalsifiable cards with a `_dropped_hypotheses`
  transparency log.
- Counter-evidence chips: each finding surfaces up to 3 disconfirming
  post_ids. Click opens a modal with the actual quotes from the DB.
  Biggest credibility feature per methodology doc §6.2.
- Ulwick Opportunity Score replaces ad-hoc formula:
  `opportunity = importance + max(importance − satisfaction, 0)` on
  0–20 scale. Cleaner, citable (Ulwick 2005), explained in UI tooltip.
- Triangulation badge (🟢🟡🔴): colored chip on every finding based on
  `source_diversity`. Visual signal for multi-source findings.
  Strong (≥3 source types) / moderate (2) / narrow (1).
- Credible intervals: Beta-binomial 87% CI replaces raw N counts on
  finding cards. "📊 5.2–11.8% of corpus" vs. "N=14". Statistically
  honest. Graceful fallback to Wald approximation if scipy unavailable.

Quadrant y-axis swapped from legacy `pain_weight` to Ulwick `importance`;
score coloring thresholds updated (≥15 high, 10–15 mid, <10 low) to
match the 0–20 scale.

## Files Created

- `changelogs/2026-04-20_07_insight-engine-phase2.md` (this file)

## Files Modified

- `docs/specs/2026-04-20-insight-engine.md` — Phase 2 section fully
  rewritten with ROI analysis; explicit in/out lists.
- `prompts/insights_synthesis.yaml` — new JSON schema: governing_thought,
  key_arguments[], hypotheses[], disconfirming_evidence per finding,
  importance/satisfaction instead of pain_weight, triangulation_strength.
- `src/reddit_research/research/insights.py`:
    - `_normalize_scores()` rewritten for Ulwick + triangulation derivation
      + credible interval attachment + Popper hypothesis validation.
    - New `_credible_interval(successes, total, confidence=0.87)` —
      Beta-binomial with scipy primary, Wald fallback.
    - New `_validate_hypothesis(h)` — Popper's criterion enforced.
    - `max_tokens` raised 8000 → 12000 to accommodate new schema.
- `app-tauri/src/screens/insights.js`:
    - `renderMinto()` for the pyramid header
    - `renderHypothesisCard()` with falsifier + test sections
    - `scoreClass` thresholds updated to 0–20 Ulwick scale
    - `triangulationChip()` helper
    - `renderFindingCard` upgraded with Ulwick imp/sat, triangulation,
      CI chip, counter-evidence chip
    - `renderFull` wires new sections in order: Minto → (folded)
      exec summary → quadrant → hypotheses → findings → competitors
    - `showCounterEvidenceModal()` fetches + renders disconfirming posts
- `app-tauri/src/style.css` — ~160 lines: Minto pyramid, hypothesis
  cards, falsifier/test blocks, counter-evidence modal, new chip variants.

## Rejected from methodology doc (noise filter)

These were considered and explicitly left out of Phase 2:
- Issue-tree / SCQA as user-facing step (too consulting-heavy)
- Dual-model Claude+GPT κ adjudication (marginal precision, 2× cost)
- 30-source expansion (diminishing returns past our current 13)
- Neo4j / ArangoDB migration (premature)
- Weekly human-QA dashboard with Krippendorff's α (feature-flag button > dashboard)
- BibTeX citation export / run-snapshot reproducibility (academic-use-only)
- Adversarial test harness (post-PMF)

Deferred: three-pass open→axial→selective coding (pilot A/B later);
saturation curves over time (we have labels; curves are polish).
