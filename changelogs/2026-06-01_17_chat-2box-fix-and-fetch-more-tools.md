# Chat: fix phantom "2-box" user bubble + live "fetch more" (agent tools + button)

**Date:** 2026-06-01
**Type:** Fix + Feature

## Summary

Two issues in the topic-section Chat. First, a CSS bug rendered every user
message as **two stacked orange boxes** — the question text and the `1m ago`
timestamp each got their own bubble. Second, the chat agent could only *read*
already-collected data; it had no way to **fetch more** papers or evidence when
the corpus was thin. The agent now has two new tools — `fetch_more_papers` and
`fetch_more_evidence` — that run the real fetch pipelines live, store the
results, and let the model re-query and cite the freshly-pulled sources.

## Changes

### Part 1 — the "2 box" UI bug (Fix)
- `.chat-msg-user .chat-msg-body > div:not(.markdown-view)` matched **every**
  direct child div of the user bubble, so the `.chat-msg-ts` timestamp got the
  same orange box treatment as the question text — the phantom second box.
- Scoped the selector to `.chat-msg-user .chat-msg-body > .chat-msg-text` so
  only the question is boxed; the timestamp stays a bare 10px caption.

### Part 2 — agent "fetch more" tools (Feature)
- Extracted the inline paper-research pipeline body from the
  `openreply_paper_research_pipeline` MCP tool into a reusable module function
  `run_paper_research()` in `paper_pipeline.py`. The MCP tool now calls it via
  `_run_with_timeout(..., kwargs=...)` — one code path, two callers.
- Added two tools to `AGENT_TOOLS` in `chat.py` (Anthropic agent mode):
  - `fetch_more_papers(topic, query?, limit_per_source=4, max_fulltext=2, year_from?)`
    — parallel search across arXiv/PubMed/OpenAlex/Semantic Scholar/Crossref/
    Scholar, store + tag, top-cited full-text + LLM analysis, returns a slim
    citation-sized payload.
  - `fetch_more_evidence(topic, sources?, include_reddit=false, limit=25)`
    — raw community fetch (HN/Stack Overflow/Dev.to/news, Reddit opt-in) via
    `collect(skip_extraction=True)`; new posts become queryable by the other
    tools.
- Added `_run_bounded()` helper: runs each fetch on a worker thread with a
  150 s ceiling and returns a structured `{ok:false, timed_out:true}` instead
  of wedging the agent loop on a slow network/provider call.
- Updated `AGENT_SYSTEM` with tool-selection heuristics: use the fetch tools
  **at most once per answer**, only when the existing corpus can't answer, and
  always re-query the freshly-added rows before concluding.

### Part 2b — one-click "Fetch papers" button (works in Ask mode)
- Added a **Fetch papers** button to the chat header (`topic.js`) so users
  don't need the Agent toggle. It calls the existing `paper_research_pipeline`
  Tauri command (→ CLI `research papers` → `run_paper_research`), scoped to the
  composer text / last question when present, shows a live status line, then
  reloads chat so the next Ask answer is grounded on the new papers.
- Surfaces an honest toast for each outcome: papers added (with count +
  analyzed), no results, or error.

## Files Modified

- `app-tauri/src/style.css` — narrowed the user-bubble box selector to
  `.chat-msg-text` (fixes the duplicate timestamp box).
- `src/openreply/research/paper_pipeline.py` — added `run_paper_research()`.
- `src/openreply/mcp/server.py` — `openreply_paper_research_pipeline` now delegates
  to `run_paper_research()` (removed the inline `_pipeline_impl`).
- `src/openreply/research/chat.py` — two new `AGENT_TOOLS`, their executors in
  `_exec_tool`, the `_run_bounded` helper, and updated `AGENT_SYSTEM`.
- `app-tauri/src/screens/topic.js` — added the "Fetch papers" header button +
  its click handler.

## Notes

- The CSS fix needs a frontend rebuild to appear in the installed
  `/Applications` bundle; `npm run tauri:dev` hot-reloads it.
- Agent mode (and therefore the fetch tools) is currently Anthropic-only and
  requires the chat **Agent** toggle to be on.
- Verified: `py_compile` clean, runtime import + topic guards pass, and the
  9 paper/pipeline tests still pass.
