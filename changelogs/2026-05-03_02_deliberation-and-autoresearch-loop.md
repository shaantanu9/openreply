# 5-persona deliberation + autoresearch loop (Phase 3 + Phase 4)

**Date:** 2026-05-03
**Type:** Feature

## Summary

Implements Phase 3 + Phase 4 of `docs/PERSONA_GROUNDING_AND_AUTORESEARCH_PLAN.md`:

**Phase 3 — Multi-persona deliberation.** A 5-persona debate engine
(Synthesizer / Skeptic / Quantifier / Risk Officer / Devil's Advocate)
reviews any list of findings and tags each
**Confirmed / Probable / Minority / Discarded** with a composite priority
score. Adapted from `autoresearch:predict`. The Devil's Advocate is hard-
constrained to dispute ≥50% of items per round (post-process enforced —
demotes weakest CONFIRMs if the LLM is too agreeable). When the topic has
audience clusters built (Phase 1), each cluster also casts an endorsement
vote based on whether its real-user vocab overlaps with the finding —
making consensus *citation-grounded* rather than purely LLM-vs-itself.

**Phase 4 — Autoresearch loop.** Two surfaces:

1. **Claude Code skill** at `.claude/skills/gap-map-autoresearch/` — the
   real Karpathy-style loop: read state → change ONE thing → commit →
   verify → keep if metric up, revert if down → repeat. Pre-canned
   loops for synthesize / audience / launch-brief / deliberate /
   relevance, each with a goal metric, scope glob, verify command, and
   prioritized direction. Runs in any Claude Code session in this repo.

2. **In-app `/iterate` screen** — a SAFER variant that sweeps a small
   grid of safe-to-toggle config (LLM on/off, round count, min posts
   per author) and keeps the best. No git revert, no prompt edits —
   just config tuning visible to non-Claude-Code users. Live results
   table with "kept / discarded" badges, best-row highlight, and a
   stat-grid headline.

## Why both surfaces?

- The skill can edit prompts and `git revert` — needed for prompt-level
  improvements but only safe inside Claude Code.
- The screen runs in the app for users without Claude Code, who can
  still pick the best deliberate config without touching code.

## Files Created

- `src/reddit_research/research/deliberate.py` — engine. ~470 lines.
  Pure-Python 5-persona debate with LLM + heuristic-fallback paths,
  audience-cluster endorsements, composite-score tiering, and a
  transcript log persisted to `mcp_analyses(kind=deliberation)`.
- `app-tauri/src/screens/iterate.js` — in-app loop UI. Two pre-canned
  loops (deliberate, audience), live grid sweep, best-row highlight.
- `.claude/skills/gap-map-autoresearch/SKILL.md` — autoresearch skill.
- `.claude/skills/gap-map-autoresearch/references/synthesize-loop.md`
- `.claude/skills/gap-map-autoresearch/references/audience-loop.md`
- `.claude/skills/gap-map-autoresearch/references/launch-brief-loop.md`
- `.claude/skills/gap-map-autoresearch/references/deliberate-loop.md`
- `.claude/skills/gap-map-autoresearch/references/relevance-loop.md`
- `changelogs/2026-05-03_02_deliberation-and-autoresearch-loop.md` —
  this file.

## Files Modified

- `src/reddit_research/research/insights.py` — `synthesize_insights`
  takes new `deliberate=False, deliberate_rounds=1` flags. When True,
  every finding is stamped with a `consensus` block.
- `src/reddit_research/cli/main.py` — `research deliberate` subcommand.
- `src/reddit_research/mcp/server.py` — `gapmap_deliberate` tool;
  `gapmap_synthesize_insights` accepts `deliberate=True`.
- `app-tauri/src-tauri/src/commands.rs` — `deliberate` Tauri command.
- `app-tauri/src-tauri/src/main.rs` — registered in `generate_handler!`.
- `app-tauri/src/api.js` — `api.deliberate(topic, opts)`.
- `app-tauri/src/main.js` — `renderIterate` + two routes + explainer slug.
- `app-tauri/index.html` — sidebar entry "Iterate" with `repeat` icon.
- `app-tauri/src/style.css` — `.iter-best` row highlight + `.tier-badge`
  classes (Confirmed / Probable / Minority / Discarded).

## Verification

- `ast.parse` clean on every modified Python file.
- `node --check` clean on every modified JS file.
- `cargo check` clean.
- Functional smoke test of `deliberate.deliberate` in isolation:
  - heuristic fallback (no LLM) tiers a 3-item fixture into
    `confirmed=1, discarded=2` correctly,
  - DA self-check enforces ≥50% disputes on a 6-item fixture
    (CONFIRM-heavy input gets demoted to 3 disputes).

## Defaults adopted

| Decision | Value |
|---|---|
| Persona count | 5 (Synthesizer / Skeptic / Quantifier / Risk Officer / Devil's Advocate) |
| Default rounds | 1 (LLM-cost conscious; UI lets user pick 1-3) |
| DA dispute floor | ≥50% per round |
| Audience endorsement weight | +1 confirm-equivalent at 2+ clusters endorsing |
| Confirmed threshold | ≥3 effective confirms (LLM + audience) |
| In-app loop scope | safe config flips only (LLM on/off, rounds, min_posts, k) |
| Skill loop scope | full prompt/code edits with git revert protection |

## What's next (from the master plan)

| Phase | Status |
|---|---|
| Phase 1 — Audience personas from real users | ✅ Shipped 2026-05-03_01 |
| Phase 2 — Audience screen | ✅ Shipped 2026-05-03_01 |
| **Phase 3 — Multi-persona deliberation** | ✅ Shipped this changelog |
| **Phase 4 — Autoresearch loop (skill + screen)** | ✅ Shipped this changelog |
| Phase 5a — Evaluation lenses + weight learner | Optional next |
| Phase 5b — OASIS synthetic simulation | Optional next |

The discovery framework is now feature-complete on the citation-grounded
+ self-improving axis. Phase 5 only if synthetic simulation becomes a
strategic priority.
