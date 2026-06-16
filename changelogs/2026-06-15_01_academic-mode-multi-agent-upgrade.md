# Academic Mode — Multi-Agent Upgrade (Panel · Integrity · Citations · Passport)

**Date:** 2026-06-15
**Type:** Feature

## Summary

Upgraded **Academic Mode** from a single-pass "function composition" pipeline
into a **proper multi-agent research pipeline**. The peer-review stage is now a
real **multi-reviewer panel** (EIC + methodology + domain + perspective +
devil's-advocate, each scored 0–100 → editorial decision), and two new
machine-verified gates run after finalize: a **7-mode AI-failure integrity
gate** and a **deterministic citation-existence gate** that verifies cited DOIs
against Crossref. Every stage now appends a **hash-chained Material Passport**
entry for tamper-evident provenance and cross-session resume.

This is a **clean-room reimplementation** of the high-value patterns analyzed in
`ACADEMIC_RESEARCH_SKILLS_ANALYSIS.md` / `REPOS_DEEP_DIVE.md`. The reference
plugin (Academic Research Skills, **CC-BY-NC 4.0**) is non-commercial; Gap Map is
commercial, so **no file, prompt, schema, or text was copied** — only the ideas
were reimplemented in idiomatic Gap Map Python/JS, composing our own existing
LLM-provider, paper-pipeline, and traceability machinery.

The new pipeline:

```
research → synthesize → [grounding gate]
  → peer_review (5-reviewer panel → editorial decision)
  → finalize (cited brief)
  → [integrity gate: 7-mode AI-failure checklist]   (blocking)
  → [citation gate: DOI existence verification]      (advisory)
  → persist + Material Passport (hash-chained, all stages)
```

## Changes

- **Multi-reviewer panel** `research/academic_review.py` — `run_review_panel()`
  runs 5 independent reviewer roles, each LLM-scored 0–100, synthesized to an
  editorial decision (≥80 accept · 65–79 minor · 50–64 major · <50 reject). A
  devil's-advocate critical concern downgrades an would-be accept and sets
  `critical_blocks`. Fail-soft to a deterministic fallback; never raises.
- **Integrity gate** `research/academic_integrity.py` — `run_integrity_check()`
  audits sampled brief claims against 7 clean-room AI-failure modes
  (unverifiable-implementation / hallucinated-citation / hallucinated-result /
  shortcut-overclaim / limitation-reframed / fabricated-methodology / frame-lock).
  Verdict PASS/FAIL; **blocking only on the fabrication-risk subset
  {M1,M3,M5,M6}**. Never hard-blocks on infrastructure failure (precision-over-recall).
- **Citation-existence gate** `research/academic_citations.py` —
  `verify_citations()` extracts each cited paper's DOI/arXiv id and verifies it
  via `crossref.fetch_by_doi` (deterministic, no LLM). Per-citation
  verified/missing/unresolvable; **blocks only on a resolvable-but-missing DOI**
  (a real fabrication signal); network blips → unresolvable, never blocking.
- **Material Passport** `research/academic_passport.py` — append-only,
  SHA-256 hash-chained ledger (`academic_passport` table, self-creating).
  `append_passport()` / `get_passport()` / `verify_passport()` give
  tamper-evident provenance + cross-session resume.
- **Orchestrator** `research/academic_mode.py` — composes all four into
  `run_academic_brief`: panel replaces the single debate pass; integrity +
  citation gates run after finalize (governed — only at L3 / L2-approved); each
  stage appends a passport entry; panel dissent + blocking findings + unresolved
  citations all fold into "Acknowledged Limitations" (never dropped). New return
  keys: `review`, `integrity`, `citations_check`, `passport`, `gate_status`,
  `blocked`. `gate_status ∈ {passed, flagged, blocked}`.
- **Persistence** `core/db.py` — `academic_briefs` gains `review_decision`,
  `integrity_verdict`, `citations_verified` (with lazy migration for existing
  installs); `record_academic_brief()` extended.
- **CLI** `cli/main.py` — `research academic` prints a panel/integrity/citation/
  passport summary line; new `research academic-passport` read command.
- **MCP** `mcp/server.py` — `gapmap_academic_brief` docstring updated to the new
  pipeline; new `gapmap_academic_passport` tool (provenance reader).
- **Tauri** — Rust `academic_passport_get` command (+ `main.rs` registration);
  `api.js` `academicPassportGet` binding.
- **Frontend** `screens/academic.js` — two new timeline stages (Integrity gate,
  Citation check); a **verdict-chips strip** (⚖ decision · 🛡 integrity · 🔗
  citations · 🧾 passport) on the brief, tolerant of both live-run and
  stored-brief shapes; styles in `style.css`.

## Files Created

- `src/gapmap/research/academic_review.py`
- `src/gapmap/research/academic_integrity.py`
- `src/gapmap/research/academic_citations.py`
- `src/gapmap/research/academic_passport.py`
- `tests/test_academic_review.py` (11 tests)
- `tests/test_academic_integrity.py` (7 tests)
- `tests/test_academic_citations.py` (5 tests)
- `tests/test_academic_passport.py` (5 tests)
- `changelogs/2026-06-15_01_academic-mode-multi-agent-upgrade.md`

## Files Modified

- `src/gapmap/research/academic_mode.py` — panel + integrity + citation + passport integration.
- `src/gapmap/core/db.py` — `academic_briefs` new columns + migration + `record_academic_brief` args.
- `src/gapmap/cli/main.py` — richer `academic` summary + `academic-passport` command.
- `src/gapmap/mcp/server.py` — updated docstring + `gapmap_academic_passport` tool.
- `app-tauri/src-tauri/src/commands.rs` — `academic_passport_get`.
- `app-tauri/src-tauri/src/main.rs` — handler registration.
- `app-tauri/src/api.js` — `academicPassportGet` binding.
- `app-tauri/src/screens/academic.js` — new stages + verdict chips.
- `app-tauri/src/screens/academic.test.mjs` — STAGES + verdictsStrip tests.
- `app-tauri/src/style.css` — verdict-chip styles.
- `tests/test_academic_mode.py` — updated mocks + 2 new blocking-gate tests.

## Verification

- `pytest tests/` → **352 passed**, 3 skipped, 1 pre-existing live-Reddit network
  flake (`test_discover_subs_returns_real_results`, unrelated). New module tests:
  28 (review 11 · integrity 7 · citations 5 · passport 5); orchestrator suite 11
  (incl. integrity-block + citation-advisory regression tests).
- `node --test academic.test.mjs` → **8 passed** (STAGES order, verdict chips,
  stream parsing).
- `cargo build` → **0 errors** (new `academic_passport_get` compiles; lone
  warning is the pre-existing JWT fallback).
- Registration triangle confirmed: CLI `academic-passport` ↔ `commands.rs` ↔
  `main.rs` generate_handler ↔ `api.js` binding.

## License & clean-room note

All four capabilities are clean-room reimplementations of *ideas* described in
the reference analysis docs. No file/prompt/schema/text was copied from the
CC-BY-NC Academic Research Skills plugin. All LLM prompts are newly authored in
Gap Map's house style; all composed functions are pre-existing Gap Map code.

## Follow-up (not in this change)

- Rebuild + re-codesign the onedir sidecar so `research academic-passport` and
  the upgraded pipeline run in the **bundled** app (dev mode already works via
  the `.venv` python bypass) — same follow-up noted for the original Academic
  Mode ship.
