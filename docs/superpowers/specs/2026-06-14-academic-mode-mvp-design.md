# Academic Mode — Grounded Cited Research Brief (Design)

> **Status:** Approved for implementation · **Date:** 2026-06-14 · **Target app:** Gap Map (`reddit-myind`, Python + Tauri)
> **Source of ideas:** WhyBuddy "Academic Mode" MVP spec (`2026-06-14-academic-mode-mvp-design.md`) — *patterns only, clean-room reimplemented* for our Python/Tauri stack. See §11.
> **Scope answer:** Full — backend orchestrator + CLI + MCP + Tauri UI tab + DOCX/PDF export. Cited markdown brief. Hard-block grounding gate. L1/L2/L3 governance (L3 default).

---

## 1. Summary

Add an **Academic Mode** capability to Gap Map that turns a topic/research
question into a **grounded, cited research brief** through a four-stage
pipeline:

```
research → synthesize → [grounding gate] → peer_review → finalize
```

Unlike the source spec (which registers capabilities in WhyBuddy's TS
constraint runtime), Gap Map **already owns every stage** as a tested Python
function. Academic Mode is therefore a **thin orchestrator that composes
existing functions**, records a quality gate + lineage row per stage (reusing
`record_check` / `record_lineage` / `record_debate_verdict`), and enforces one
new invariant: **finalize may cite only academic papers actually committed to
the corpus, and refuses to run if fewer than 2 are grounded.**

The only genuinely new code is one orchestrator module, one small persistence
table, a CLI command, two MCP tools, a Tauri streaming command + reader, and
one frontend screen. Everything else is reused.

---

## 2. Goals & Non-Goals

### Goals
- Run research → synthesize → peer_review → finalize end-to-end from a single
  call (CLI, MCP, or UI).
- Output a **cited markdown brief** (exportable to DOCX/PDF) that cites only
  committed academic evidence — **no fabricated citations**.
- Reuse Gap Map's grounding (paper pipeline), deliberation (debate), and
  traceability (lineage/checks) machinery — do not rebuild them.
- Surface the flow in the desktop app as a staged timeline with a visible
  grounding-gate badge and the rendered brief.
- L1/L2/L3 governance consistent with the existing Fleet flow.

### Non-Goals (explicit YAGNI)
- ❌ Deterministic 4-index bibliographic citation-existence verification
  (arXiv/OpenAlex/Crossref/S2) — future sub-project. (Note: Gap Map already
  *fetches* from these; the deferred piece is a dedicated citation-existence
  *gate*.)
- ❌ Multi-reviewer EIC+reviewers panel with 1–5 concession scoring — MVP uses
  the existing 5-persona debate as the single peer-review pass.
- ❌ Bilingual abstracts, citation-format conversion (APA/IEEE swap at export),
  venue AI-disclosure.
- ❌ New LLM provider plumbing, schema migrations beyond the one `academic_briefs`
  table, or changes to the unified `posts` contract.

---

## 3. Architecture Overview

Academic Mode is an **orchestration layer**, not a new engine.

```
topic ─▶ run_academic_brief(topic, level, …)
          │
          ├─ stage 1  research      → run_paper_research()            → posts (academic) committed
          │                            record_check("academic_research") + lineage
          ├─ stage 2  synthesize    → analyze_papers_bulk() + detect_gaps()
          │                            record_check("academic_synthesize") + lineage
          ├─ GATE     grounding     → count committed analyzed academic papers
          │                            if < 2  → record_check(passed=False) ; return {ok:False, gate:"coverage"}   (HARD BLOCK — no finalize)
          │            [L2: pause here for approval before the expensive stages]
          ├─ stage 3  peer_review   → run_topic_debate(dynamic_roles)  → verdicts/tiers/dissent
          │                            record_check("academic_peer_review") + lineage
          └─ stage 4  finalize      → paper_export_with_citations()    → cited brief
                                       + "Acknowledged Limitations" from peer-review dissent
                                       cite ONLY committed academic papers
                                       record_check("academic_finalize") + lineage
                                       persist row → academic_briefs
```

**Governance (mirrors `run_fleet_flow`):**
- **L1 (suggest):** runs research + synthesize, then stops with the plan for the
  remaining stages (no debate / no finalize).
- **L2 (gated):** runs through the grounding gate, then **pauses for approval**;
  re-invoke with `approved=True` to run peer_review + finalize.
- **L3 (auto, default):** runs all stages end-to-end.

`on_stage(stage, payload)` callback streams stage transitions for the UI.

---

## 4. New / Reused Components

| Concern | Component | New? |
|---|---|---|
| Orchestrator | `src/gapmap/research/academic_mode.py` :: `run_academic_brief(...)`, `get_academic_brief(topic)` | **NEW** |
| Persistence | table `academic_briefs` (created in `core/db.py::init_schema`) + `record_academic_brief(...)` helper | **NEW (1 table)** |
| Stage 1 research | `research/paper_pipeline.py::run_paper_research` | reuse |
| Stage 2 synth | `research/paper_analyze.py::analyze_papers_bulk` + `research/paper_gaps.py::detect_gaps` | reuse |
| Stage 3 review | `research/debate_run.py::run_topic_debate` | reuse |
| Stage 4 finalize | `research/paper_pipeline.py::paper_export_with_citations` (md/docx/pdf) | reuse |
| Gate/trace | `core/db.py::record_check` / `record_lineage` / `record_debate_verdict` | reuse |
| CLI | `cli/main.py` :: `@research_app.command("academic")` | **NEW (1 cmd)** |
| MCP | `mcp/server.py` :: `gapmap_academic_brief`, `gapmap_academic_brief_get` | **NEW (2 tools)** |
| Tauri Rust | `commands.rs` :: `academic_brief_run` (streaming), `academic_brief_get` (native read) | **NEW** |
| Tauri wiring | `main.rs` generate_handler, `api.js` bindings | edit |
| Frontend | `app-tauri/src/screens/academic.js` + topic-tab + nav entry + CSS | **NEW (1 screen)** |

---

## 5. Orchestrator interface

```python
def run_academic_brief(
    topic: str,
    *,
    query: str | None = None,
    provider: str | None = None,
    level: str = "L3",            # L1 | L2 | L3
    approved: bool = False,       # L2: approve peer_review + finalize
    limit_per_source: int = 5,
    max_fulltext: int = 3,
    year_from: int | None = None,
    rounds: int = 1,
    dynamic_roles: bool = True,
    style: str = "IMRaD",
    export_format: str = "markdown",   # markdown | docx | pdf
    min_grounded: int = 2,
    on_stage: Callable[[str, dict], None] | None = None,
) -> dict
```

**Return shape** (always a dict, never raises for user-facing failures):
```python
{
  "ok": bool,
  "topic": str,
  "run_id": str,
  "level": "L3",
  "stage": "finalize" | "peer_review" | "grounding" | "synthesize" | "research",
  "gate": None | "coverage",          # set when a hard gate blocks
  "grounded_count": int,
  "stages": [ {name, ok, summary, ...} ],   # per-stage receipts (for UI timeline)
  "peer_review": {tiers, n_verdicts, dissent_count, ...} | None,
  "brief": { "markdown": str, "format": str, "path": str | None,
             "limitations": str, "citations": [post_id...] },
  "awaiting_approval": bool,           # True when L2 paused
  "generated_at": str,
  "errors": [str],
}
```

**Anti-fabrication rule (the one new invariant):** `finalize` collects the set
of committed academic-source `posts` for the topic that have a stored analysis;
the brief's citation list is the **intersection** of what the draft references
and that committed set. If the grounding gate (`grounded_count >= min_grounded`)
fails, finalize never runs.

---

## 6. Persistence

One new table, created idempotently in `init_schema`:

```python
academic_briefs(
  topic TEXT, run_id TEXT PRIMARY KEY, level TEXT, gate_status TEXT,
  grounded_count INT, stages_json TEXT, markdown TEXT, fmt TEXT,
  export_path TEXT, limitations TEXT, citations_json TEXT, generated_at TEXT
)
```

`record_academic_brief(...)` upserts a row. `get_academic_brief(topic)` returns
the latest brief for the topic (UI reader, native-SQLite friendly). Lineage and
checks reuse existing tables, so the replay log captures the full audit trail
automatically.

---

## 7. Surfaces

**CLI** (template = existing `debate` command):
```
gapmap research academic --topic "note apps" \
  [--query ...] [--provider ...] [--level L1|L2|L3] [--approved] \
  [--rounds 1] [--dynamic-roles/--no-dynamic-roles] \
  [--style IMRaD] [--format markdown|docx|pdf] [--json]
```
Text mode prints a staged summary + grounding-gate result + brief path. `--json`
emits the full return dict via `_emit`. Includes a hidden `--json` no-op for
Rust-wrapper compatibility.

**MCP** (timeout-guarded, returns dict):
- `gapmap_academic_brief(topic, query?, provider?, level?, approved?, rounds?, dynamic_roles?, style?, export_format?)`
- `gapmap_academic_brief_get(topic)` — latest brief reader.

**Tauri**:
- Rust `academic_brief_run` — streaming command emitting `academic:progress`
  (one NDJSON stage line each) and `academic:done` (final payload), using its
  **own `ActiveAcademic` state slot** (never shares with collect/chat/fleet).
- Rust `academic_brief_get` — native SQLite read of `academic_briefs`.
- `api.js`: `academicBriefRun(opts)`, `academicBriefGet(topic)`,
  `onAcademicProgress`, `onAcademicDone`.
- `screens/academic.js`: a topic tab — header, Run button (+ level selector +
  format selector), a staged timeline (research → synthesize → grounding →
  peer_review → finalize) with the grounding-gate badge, the rendered markdown
  brief (via existing markdown lib), and Export buttons. SWR `screenCache` for
  instant revisit. L2 shows an "Approve & finish" button when paused.

**Export** reuses `paper_export_with_citations` (markdown base, docx via pandoc,
pdf via xelatex, graceful fallback to markdown).

---

## 8. Error handling & degradation

| Failure | Behavior |
|---|---|
| LLM unavailable in a stage | Stage is fail-soft (existing skip-gracefully); records a lower-trust check; pipeline continues where possible. |
| `< min_grounded` academic papers committed | **Hard block** — `record_check("academic_grounding", passed=False)`, return `{ok:False, gate:"coverage", stage:"grounding"}`. No finalize. |
| Peer review flags issues | Issues are written into the brief's **"Acknowledged Limitations"** section — never silently dropped. |
| Export infra (pandoc/xelatex) missing | Falls back to markdown; `brief.format="markdown"`, note in errors. |
| L2 with `approved=False` | Returns `awaiting_approval:True` after grounding gate; UI shows Approve button. |

---

## 9. Testing

- `tests/test_academic_mode.py` (pytest, LLM mocked):
  - stage chaining produces stage receipts in order;
  - **grounding hard-block**: <2 committed academic papers ⇒ `gate=="coverage"`, no brief, finalize check absent;
  - **citation restriction**: brief citations ⊆ committed academic post_ids (no fabricated ids);
  - gate ledger: a `checks_ledger` row exists per executed stage;
  - L2 pause: `level="L2", approved=False` ⇒ `awaiting_approval` and no finalize; `approved=True` ⇒ finalize.
- `app-tauri/src/screens/academic.test.mjs` (node:test): render-from-data paints timeline + brief without a live backend.
- Triangle check: CLI command, `main.rs` handler, and `api.js` binding all present (grep-asserted).
- Wire into existing `pytest tests/` and `npm test`.

---

## 10. Build / rollout

1. Backend: `academic_mode.py` + db table/helpers + CLI + MCP. `pytest` green.
2. Tauri: Rust commands + handler + api.js + screen + nav/tab + CSS. `cargo build`, `npm run build`, `npm test` green.
3. Rebuild + re-codesign the onedir sidecar so the new `academic` CLI command
   works in the bundled app (dev mode works without it via `.venv` python).
4. Changelog + FEATURES.md update + `graphify update .`.

---

## 11. License & clean-room note

The source WhyBuddy spec is MIT; the ideas it reimplements come from Academic
Research Skills (CC-BY-NC). We copy **no file, prompt, or schema** from either —
we reimplement only the *idea* (a staged research→review→finalize pipeline,
grounding-before-citing, dependency-ordered gates) in idiomatic Gap Map Python,
reusing our own pre-existing functions. All prompts are our existing ones
(paper analysis, debate personas); no new transcribed prompts.

---

## 12. Open questions (resolved)

1. **Trigger:** explicit command/tool/UI button (not auto-detected from goal
   text) — avoids colliding with normal collect/research flows. ✅
2. **Governance:** keep L1/L2/L3, default L3. ✅
3. **Finalize output:** cited markdown brief, exportable to docx/pdf. ✅
4. **Grounding:** hard-block finalize at `< 2` committed academic papers. ✅
