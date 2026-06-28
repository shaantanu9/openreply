# Academic Mode — Grounded, Cited Research Brief Pipeline

**Date:** 2026-06-14
**Type:** Feature

## Summary

Added an **Academic Mode** capability that turns a topic into a grounded, cited
research brief through a four-stage pipeline — research → synthesize →
[grounding gate] → peer_review → finalize — surfaced across the CLI, MCP, and a
new desktop tab. It is a clean-room reimplementation (idiomatic Python/Tauri) of
the WhyBuddy "Academic Mode" MVP idea, composing OpenReply's existing paper
pipeline, deliberation engine, and lineage/checks traceability rather than
rebuilding them. The one new invariant: **finalize may cite only academic papers
actually committed to the corpus, and hard-blocks when fewer than 2 are
grounded** (no fabricated citations). Governance mirrors Fleet — L1 suggest, L2
gated (pause for approval), L3 auto (default).

## Changes

- **Orchestrator** `src/openreply/research/academic_mode.py` — `run_academic_brief(...)`
  chains the four stages, records a `check` + `lineage` row per stage, enforces
  the grounding hard-block, and folds peer-review dissent into an "Acknowledged
  Limitations" section. `get_academic_brief(topic)` reads the latest brief.
- **Persistence** — new `academic_briefs` table in `core/db.py::init_schema`
  + `record_academic_brief()` / `get_academic_brief()` helpers (exported in
  `__all__`).
- **CLI** — `openreply research academic` (with `--level/--approved/--rounds/
  --dynamic-roles/--style/--format/--stream`) and `openreply research academic-get`.
- **MCP** — `openreply_academic_brief` (timeout-guarded) and
  `openreply_academic_brief_get`.
- **Tauri** — Rust `academic_brief_run`, `academic_brief_run_stream` (NDJSON
  `academic:progress`/`academic:done`), `academic_brief_get`; registered in
  `main.rs`; `api.js` bindings (`academicBriefRun(Stream)`, `academicBriefGet`,
  `onAcademicProgress/Done`).
- **Frontend** — new `screens/academic.js` topic tab: level/format controls, a
  live staged timeline with a grounding-gate badge, the rendered markdown brief,
  and Export (md/docx/pdf) buttons (reusing `paperExportWithCitations`). Tab +
  loader wired in `topic.js`; styles in `style.css`.
- **Tests** — `tests/test_academic_mode.py` (8 tests: stage ordering, grounding
  hard-block, citation restriction, L1/L2 governance, gate ledger, persistence,
  streaming callback) and `app-tauri/src/screens/academic.test.mjs` (5 tests).
- **Spec** — `docs/superpowers/specs/2026-06-14-academic-mode-mvp-design.md`.

## Files Created

- `src/openreply/research/academic_mode.py`
- `tests/test_academic_mode.py`
- `app-tauri/src/screens/academic.js`
- `app-tauri/src/screens/academic.test.mjs`
- `docs/superpowers/specs/2026-06-14-academic-mode-mvp-design.md`
- `changelogs/2026-06-14_10_academic-mode.md`

## Files Modified

- `src/openreply/core/db.py` — `academic_briefs` table + record/get helpers + `__all__`.
- `src/openreply/cli/main.py` — `academic` + `academic-get` commands (with `--stream`).
- `src/openreply/mcp/server.py` — `openreply_academic_brief` + `openreply_academic_brief_get`.
- `app-tauri/src-tauri/src/commands.rs` — three academic commands.
- `app-tauri/src-tauri/src/main.rs` — handler registration.
- `app-tauri/src/api.js` — academic bindings + events.
- `app-tauri/src/screens/topic.js` — Academic tab button + loader + import.
- `app-tauri/src/style.css` — academic timeline/brief styles.
- `app-tauri/package.json` — academic JS test in the test list.

## Real-run fix (post-implementation)

A live end-to-end run surfaced a shape bug the mocks hid: `detect_gaps` returns
gap `evidence` as **raw post_id strings**, while `list_gaps` hydrates them to
`{post_id, title}` dicts — `_build_review_items` assumed dicts and raised
`AttributeError: 'str' object has no attribute 'get'`, killing the run at the
peer_review stage. Fixed by a shape-tolerant `_evidence_post_ids()` helper
(accepts str | dict | malformed) and by wrapping the item-building in the
fail-soft `_safe_call`. Added a regression test and updated the test mock to use
the real string-evidence shape.

## Verification

- `pytest tests/test_academic_mode.py` → 9 passed (incl. evidence-shape regression).
- **Real end-to-end run** (`research academic --topic "ocr and table data image to text" --level L3`,
  live LLM): all 5 stages ok · 195 grounded papers · 46K-char IMRaD brief · 195
  grounded citations · peer-review dissent folded into "Acknowledged Limitations" ·
  persisted + readable via `get_academic_brief`.
- `npm test` → 57 passed (incl. 5 academic tests).
- `cargo build` → 0 errors; `npm run build` → success.
- CLI / Rust / main.rs / api.js / topic.js registration triangle confirmed.

## Follow-up (not in this change)

- Rebuild + re-codesign the onedir sidecar so `research academic` works in the
  **bundled** app (dev mode already works via the `.venv` python bypass).
- Deferred sub-projects: 4-index citation-existence gate, multi-reviewer panel,
  bilingual abstracts / citation-format conversion at export.
