# Sub-project 2A — Clarification Gate / Clarified Brief

**Date:** 2026-06-14 · **Roadmap:** WhyBuddy port, Wave 2.

## Goal
Capture a per-topic **clarified brief** — goal, constraints, success criteria, audience — and **feed it into the synthesis prompt** so findings/gaps are scoped to what the user actually wants, instead of generic output. Optionally surface LLM-suggested clarifying questions for ambiguous topics. Net-new: distinct from the coarse `topic_prefs.intent` lens (a preset) and from `discover_subs` topic-string confirmation.

## Slices
**Slice 1 (this spec — backend + consumption, the value):**
- **Storage**: extend `topic_prefs` with nullable columns `brief_goal`, `brief_constraints`, `brief_success`, `brief_audience` (lazy migration mirroring the existing `intent` ADD COLUMN at `core/db.py:629`).
- **Helpers** (`src/gapmap/research/brief.py`): `set_brief(topic, *, goal, constraints, success, audience)` (upsert into topic_prefs, creating the row if absent) · `get_brief(topic) -> dict` · `brief_preamble(topic) -> str` (renders a compact "Research goal / Constraints / Success criteria / Audience" block, or `""` when no brief).
- **LLM suggestions** (best-effort, skip-gracefully): `suggest_clarifications(topic, corpus_sample="") -> dict` → `{"questions": [...], "skipped": bool, "reason": ...}`. Uses `get_provider()`; on no-LLM returns `{"questions": [], "skipped": True, "reason": "no LLM configured"}`. NEVER raises.
- **Consumption (payoff)**: inject `brief_preamble(topic)` into the synthesis prompt in `insights.py::synthesize_insights` AND `synthesize_insights_chunked` — prepend it to the system/user prompt so the LLM scopes findings to the brief. Empty preamble = current behavior (backward-compatible).
- **CLI**: `research brief set/get` Typer commands (so a brief can be set without UI yet).
- **MCP** (thin): `gapmap_brief_get(topic)` / `gapmap_brief_set(topic, ...)`.

**Slice 2 (follow-up, separate):** UI — a "Clarify research" modal/panel on the topic screen (fields + "Suggest questions" button → `suggest_clarifications`), saving via a new `api.briefSet`. Deferred.

## Testing (slice 1)
- migration idempotent; brief columns present.
- `set_brief` → `get_brief` round-trip; `brief_preamble` renders fields / `""` when empty.
- `suggest_clarifications` returns `{skipped:True}` with no LLM (never raises).
- `synthesize_insights` includes the preamble text in its built prompt when a brief is set (assert via a spy/mock on the LLM call capturing the prompt) — and is unchanged when no brief.

## Non-fatal / compatibility
All brief reads best-effort; missing brief → empty preamble → exact current behavior. Additive columns; old rows tolerated.

## Out of scope
Slice-2 UI; blocking-vs-non-blocking question enforcement (we capture + suggest, we don't hard-block a run).
