# Research-tab paper analysis — design

**Date:** 2026-04-20
**Status:** Approved, ready for implementation
**Scope:** Add LLM-generated summary + relevance + builder-takeaway per academic paper on the Research tab, plus a bulk "Analyze all" button.

## Goal
Research tab shows titles + 260-char excerpts — useful but passive. Users still have to decide for themselves whether a paper matters to their topic. Add an LLM analysis pass that surfaces:
1. **Summary** — 2-3 sentence TL;DR of what the paper actually found.
2. **Relevance to topic** — 1-2 sentences on how/whether this paper applies.
3. **Builder takeaway** — one actionable sentence starting with a verb.

Runs on-demand (per-card "Analyze" button + top-toolbar "Analyze all (N)"), cached forever, skip-gracefully without an LLM.

## Non-goals
- Full-text PDF ingestion (abstract only).
- Citation graph / paper-to-paper similarity.
- Bulk-analyze across multiple topics.
- Auto-ranking cards by takeaway quality.

## Architecture

### Storage — new table `paper_analyses`
```sql
CREATE TABLE paper_analyses (
  post_id TEXT PRIMARY KEY,        -- posts.id (arxiv/openalex/pubmed/scholar)
  topic TEXT NOT NULL,             -- the topic context the analysis was written for
  summary TEXT NOT NULL,
  relevance TEXT NOT NULL,
  takeaway TEXT NOT NULL,
  ts TEXT NOT NULL,                -- ISO UTC
  provider TEXT,                   -- resolved LLM provider used
  model TEXT                        -- LLM_MODEL env at write time
);
CREATE INDEX paper_analyses_topic ON paper_analyses(topic);
```
PK is `post_id` alone — same paper referenced from two topics would share one analysis row (the `topic` column reflects whichever was first). Acceptable simplification: the prompt is topic-conditioned but output is usually close across related topics, and `--force` re-analyzes with the current topic if the user wants.

### Python module — `src/reddit_research/research/paper_analyze.py`
- `analyze_paper(topic, post_id, provider=None) -> dict` — reads `posts.title` + `posts.selftext` (abstract), runs one LLM call, writes to `paper_analyses`, returns the row shape.
- `analyze_papers_bulk(topic, limit=None, force=False, progress=None) -> dict` — walks every academic-source post for the topic that lacks an analysis (or all, if `force`), iterates sequentially calling `analyze_paper`, emits `progress(msg)` lines for the Rust streaming bridge. Returns `{ok, analyzed, skipped, errored, total}`.
- `get_analyses(topic) -> list[dict]` — one SELECT of all analyses for the topic's academic papers, joined with `posts` for title.

### LLM call
Uses the shared `resolve_provider()` pattern. Prompt:
```
SYSTEM: You read academic papers and help a builder decide if the
paper is worth their time for a specific topic. Return JSON only.

USER: Topic: "{topic}"
Paper title: "{title}"
Paper abstract: "{abstract}"

Return JSON:
{{
  "summary": "<2-3 sentence TL;DR of what the paper investigated and
              found. Concrete > vague. Skip the title.>",
  "relevance_to_topic": "<1-2 sentences: HOW the findings apply to the
              topic. Be honest about stretch relevance.>",
  "builder_takeaway": "<ONE sentence starting with an imperative verb
              ('Instrument…', 'Measure…', 'Add…', 'Skip this paper — …').
              The single action a builder shipping '{topic}' could take.>"
}}

Rules:
- No fluff. No restating the title.
- If the paper is irrelevant, say so in builder_takeaway.
```
Parameters: `temperature=0.2`, `max_tokens=400`. ~$0.0002/paper on gpt-4o-mini.

Defensive JSON parsing same as canonicalize: raw → fence-stripped → first `{...}` regex → passthrough-on-failure (returns `{ok: false, skipped: true, reason: "parse_failed"}` but doesn't raise).

### Skip-gracefully
If `resolve_provider()` raises, `analyze_paper` returns `{ok: False, skipped: True, reason: "no LLM configured"}` without touching the DB. UI shows a banner pointing to Settings.

### CLI subcommand
`reddit-cli research analyze-papers --topic T [--limit N] [--force] [--post-id ID] --json`
- Default: processes every academic-source paper for `topic` that lacks an analysis.
- `--limit` caps how many to process this run.
- `--force` re-analyzes even if already present.
- `--post-id` targets a single paper (used by per-card button).
- `--json` emits a final summary object; in-progress lines go to stderr.

### Rust bridge — `src-tauri/src/commands.rs`
Three new commands:
```rust
#[tauri::command]
async fn analyze_paper(app: AppHandle, topic: String, post_id: String) -> Result<Value, String>

#[tauri::command]
async fn analyze_papers_bulk(app: AppHandle, topic: String, limit: Option<u32>) -> Result<(), String>
// Streams `papers:progress` / `papers:done` events. Uses run_cli_streaming.

#[tauri::command]
async fn paper_analyses_get(app: AppHandle, topic: String) -> Result<Value, String>
```
All three registered in `main.rs::generate_handler`.

### Frontend — `app-tauri/src/screens/topic.js::loadResearch`
- At render start, one `api.paperAnalysesGet(topic)` fires in parallel with the existing papers query. Merge into each card by `post_id`.
- Each `paperCard` gets a new expandable **Analysis** section:
  - 📘 **Summary** — `summary` text
  - 🎯 **Why this matters** — `relevance`
  - 🔨 **Builder takeaway** — `takeaway` in a highlight pill
- If no analysis row exists for the paper: a single "✨ Analyze" button on the card.
- Top toolbar adds `<button id="btn-analyze-all">✨ Analyze all (N)</button>` where N is count of unanalyzed academic papers. Hidden if N==0.
- While `analyze_papers_bulk` is running: toolbar button shows spinner + "Analyzing 12 of 40…"; cards' "Analyze" buttons disable; progress stream updates cards as each finishes.

### API shape
```js
// api.js
analyzePaper:       (topic, postId) => invoke('analyze_paper', { topic, postId }),
analyzePapersBulk:  (topic, limit = null) => invoke('analyze_papers_bulk', { topic, limit }),
paperAnalysesGet:   (topic) => cachedInvoke('paper_analyses_get', { topic }, 30000),
// Event listeners
onPapersProgress:   (cb) => listen('papers:progress', e => cb(e.payload)),
onPapersDone:       (cb) => listen('papers:done', e => cb(e.payload)),
```

## Testing
Three new tests in `tests/test_integration.py`:
1. `test_analyze_paper_writes_row` — mocked LLM returns valid JSON; verify a `paper_analyses` row appears with the expected fields.
2. `test_analyze_papers_bulk_skips_already_analyzed` — pre-populate one analysis; call bulk; assert it only processes the missing ones.
3. `test_analyze_paper_skip_gracefully_no_llm` — clear all LLM env; assert returns skip payload, no DB write.

## Risks
- **Topic drift when same paper spans topics.** Analysis is keyed on `post_id` alone; second topic sees the first's relevance text. Mitigation: `--force` button in the UI for power users; the takeaway is usually still applicable.
- **LLM JSON drift.** Handled by the 3-strategy defensive parser (same code as canonicalize).
- **Bulk rate limits.** Sequential (not parallel) with no explicit sleep; relies on per-provider rate tolerance. If users hit caps, we add a 200 ms between-calls sleep in a follow-up.

## Acceptance
- [ ] `paper_analyses` table exists via `init_schema`.
- [ ] `research analyze-papers --topic T --json` emits `{ok, analyzed, skipped, errored, total}`.
- [ ] Research tab: cards without analysis show "Analyze" button; cards with analysis render the 3 sections.
- [ ] Top "Analyze all (N)" button runs the bulk command; progress visible per-card; final count updates.
- [ ] No LLM configured → banner in Research tab instead of silent failure.
- [ ] Second open of the same topic's Research tab reads analyses from cache, no re-LLM.
- [ ] All 3 new tests pass.
