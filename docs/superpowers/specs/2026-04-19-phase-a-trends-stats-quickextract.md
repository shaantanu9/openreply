# Phase A — Trends tab + Graph-stats header + Quick-extract button

**Date:** 2026-04-19
**Status:** Spec. Plan-style sections per item; execute via subagent-driven-development.
**Source:** Tier-1 items #2, #3, #4 from `2026-04-19-cli-to-desktop-audit.md`.

## Goal

Close three of the four Tier-1 desktop coverage gaps in one focused effort. All three live on the topic-detail screen and share existing infrastructure (Tauri `run_cli` helper, `api.runQuery`, the topic-tab loader pattern, the `<i data-lucide>` icon system).

---

## Item 1 — Trends tab (`temporal-gaps`)

Surfaces the existing `reddit-cli research temporal-gaps --topic X --json` output as a new tab on the topic screen. Three columns: **Chronic / Emerging / Fading** painpoints, each card showing label + frequency counts + (optional) example quote.

### Files

- **New:** `app-tauri/src/screens/trends.js` — `loadTrends(contentEl, topic)` async function. Renders 3-column grid of painpoint cards. Empty state with "Run trends analysis" CTA when no data.
- **Modify:** `app-tauri/src-tauri/src/commands.rs` — add `run_temporal_gaps(app, topic) -> Value` that calls `["research", "temporal-gaps", "--topic", &topic, "--json"]`. Place after `run_solutions_pipeline`.
- **Modify:** `app-tauri/src-tauri/src/main.rs` — register `commands::run_temporal_gaps` in the handler list.
- **Modify:** `app-tauri/src/api.js` — add `runTemporalGaps: (topic) => invoke('run_temporal_gaps', { topic })`.
- **Modify:** `app-tauri/src/screens/topic.js` — add `<button class="tab" data-tab="trends"><i data-lucide="trending-up"></i> Trends</button>` between Evidence and Sources tabs; add `import { loadTrends } from './trends.js'` and `trends: () => loadTrends(contentEl, topic)` in the loaders map.
- **Modify:** `app-tauri/src/style.css` — append a small `.trends-grid` block (3-column responsive grid) + `.trends-card` styling per category.

### Data shape (from `temporal-gaps` JSON)

The CLI returns an object `{painpoints: [...]}` (or similar — verify in `gaps.py::find_temporal_gaps`). Each painpoint has `painpoint`, `severity`, `classification` (chronic/emerging/fading), `pre_2025_freq`, `post_2025_freq`, `evidence`. Group by `classification`, render in 3 columns.

### Cost

One LLM call per topic (already implemented in `find_temporal_gaps`). Not idempotent in the same sense as solutions — running twice replaces. UI shows a "Re-run" button in the toolbar.

---

## Item 2 — Graph-stats header on Map tab

A small strip above the Map visualization: `12 painpoints · 8 products · 24 papers · 31 edges`. Pure SQL via existing `api.runQuery` — no new Tauri command.

### Files

- **Modify:** `app-tauri/src/screens/topic.js` — at the top of `loadMap()`, before the SVG render, run two queries:
  ```sql
  SELECT kind, count(*) AS n FROM graph_nodes WHERE topic = :topic GROUP BY kind
  SELECT count(*) AS n FROM graph_edges WHERE topic = :topic
  ```
  Render the result inline as `<div class="graph-stats-strip">…</div>` ABOVE the existing map content.
- **Modify:** `app-tauri/src/style.css` — append `.graph-stats-strip { display:flex; gap:14px; ... }`.

### Display rules

- Show pills for each node kind that has count > 0: `painpoint`, `feature_wish`, `workaround`, `product`, `mechanism`, `intervention`, `evidence_paper`.
- Suppress `topic` and `post` (uninteresting noise — too high-cardinality).
- Trailing edge count: `· 31 edges`.
- If graph is empty, hide the strip entirely (don't render an empty div).

---

## Item 3 — Quick-extract button (run `gaps` without graph build)

Faster preview path: extract painpoints/features/complaints/diy from the corpus without the full graph build, render in a side panel for the user to read. Lets them decide whether to commit to the full enrich.

### Files

- **Modify:** `app-tauri/src-tauri/src/commands.rs` — add `quick_extract_gaps(app, topic) -> Value` that calls `["research", "gaps", "--topic", &topic, "--json"]`. Returns the 4-category JSON.
- **Modify:** `app-tauri/src-tauri/src/main.rs` — register `commands::quick_extract_gaps`.
- **Modify:** `app-tauri/src/api.js` — add `quickExtractGaps: (topic) => invoke('quick_extract_gaps', { topic })`.
- **Modify:** `app-tauri/src/screens/topic.js` — add a "Quick extract" button to the Map tab's empty-state (when graph has no painpoints yet) AND to the Actions tab. On click: spinner → call → render a modal/inline panel with each category as a collapsible section.

### Display

Reuse the existing `<details>` pattern from solutions cards. Each of the 4 categories collapsed by default. Each item shows label + frequency + the first example quote/post-id link.

### Important constraint

This is a READ ONLY operation. Do NOT persist results to the graph (the existing `enrich_graph` does that). The whole point is the preview shortcut. Make this explicit in the UI: "Preview only — run Build & enrich to persist."

---

## Build sequence

Three independent subagent tasks. Each commits separately. Order: Item 2 first (smallest, no new Tauri command, lowest risk), then Item 1, then Item 3.

1. **Graph stats header** — modifies only topic.js + style.css. No backend.
2. **Trends tab** — full vertical slice (Tauri + JS + screen + topic.js + CSS).
3. **Quick extract** — full vertical slice (Tauri + JS + button + modal + topic.js + CSS).

After all three: no migration, no test rewrite. The existing `tests/` Python suite still applies (no Python code changed).

## Out of scope

- BCT taxonomy, replication-status detection, contradiction flags (deferred to research-loop post-MVP doc).
- Persistence of trends/gaps results — the existing `enrich_graph` path already handles that.
- Changes to the Python CLI — every needed CLI command already exists (`temporal-gaps`, `gaps`).
- Multi-tab linking (clicking a Trends painpoint to jump to its Solutions card) — nice-to-have, not MVP.
