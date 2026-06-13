# Research Mode — researcher / PhD workspace

Gap Map's **Research Mode** turns the app into a guided literature workspace:
**Gather → Read → Synthesize → Write**, with a cross-project Library. It reuses
the academic engine (paper finding, full-text → sections → chunks, palace
search, cited Q&A, connections, gaps, outline/draft, citation export) and adds a
reading loop, a literature-review matrix, and a paper library on top.

Design spec: `docs/superpowers/specs/2026-06-07-research-mode-design.md`.
Feature catalog: `FEATURES.md` §19.

## Turning it on

**Settings → "App mode" → Academic research.** This is a frontend preference
(localStorage `gapmap.settings.appMode`); it needs no rebuild. In research mode:

- "Topic" is relabelled **"Project"** (data model unchanged — still `topic`).
- The sidebar shows **Research** (`#/research-home`) and **Library** (`#/library`).
- A **Gather → Read → Synthesize → Write** stage-bar appears above the project tabs.

## The daily loop

1. **Research Home** (`#/research-home`) — start a new project from a question
   (academic gather), or open an existing one. Each project card shows a
   flow-progress bar and Read/Matrix/Write quick links; a "Continue reading"
   strip resurfaces papers in progress.
2. **Gather** — the Research Workspace pulls an academic corpus (arXiv, PubMed,
   OpenAlex, Semantic Scholar, Crossref, Europe PMC, DBLP, Scholar) and builds
   paper knowledge (full text → sections → chunks → gaps → insights).
3. **Read** — open a paper in the **Reader** (`#/reader/<post_id>`, or
   "Read & annotate" from the Papers tab): full text by section, select-to-
   highlight with colours + notes, set reading status (to-read / reading / read),
   and ask the paper questions with **section-level cited answers**.
4. **Synthesize** — the **Lit-review matrix** (`#/lit-matrix/<topic>`) extracts
   method · dataset · sample · findings · limitations · metric per paper
   (sortable, filterable, CSV export); plus Connect-the-Dots, gaps, and
   "Ask the papers" (project-wide cited Q&A).
5. **Write** — `#/write/<topic>`: generate a grounded outline, then a draft
   (IMRaD / review / thesis), then export the bibliography (BibTeX / RIS / APA /
   Markdown).
6. **Library** (`#/library`) — every academic paper across projects, with named
   collections, reading-status filters, and title search.

## Corpus coverage — abstract fallback

Only ~10% of academic papers have open-access **full text**; the rest are
paywalled. To keep paper chat and the relations map from being starved, every
paper that has a title+abstract but no full text is embedded as a single
`abstract` chunk into the same `paper_chunks` palace collection. This makes the
**whole** library chat-able (`paper-ask`) and relatable (paper map / `relates_to`
edges), not just the papers with full text. It runs automatically inside
`build-paper-knowledge` (the "Embedding papers" stage) and the paper pipeline;
backfill an existing corpus with `paper-chunk --abstracts` (add `--topic` to
scope, omit for the whole library). Full-text chunks are always preferred — a
paper is abstract-chunked only when it has no full-text chunks.

## Data (additive tables)

`paper_reading_status`, `paper_highlights`, `lit_matrix`, `paper_collections`,
`paper_collection_items`. No migrations to existing tables; everything keys on a
paper's `post_id` in `posts`.

## Headless / scripting (CLI + MCP)

Every surface is scriptable. CLI (`gapmap research …`):

| Command | Purpose |
|---|---|
| `paper-ask "<q>" --topic …` | cited Q&A over paper full text + abstracts |
| `paper-chunk --abstracts [--topic …]` | abstract-fallback embedding (whole corpus) |
| `paper-chunk-search "<q>" --topic …` | passage retrieval (section-filterable) |
| `paper-read --post-id …` | composite Reader payload |
| `paper-reading-status --post-id … [--set read]` | get/set reading status |
| `reading-queue --topic … [--counts]` | to-read queue / counts |
| `reading-list --topic …` | all statuses (for list badges) |
| `paper-highlight {add\|list\|update\|delete}` | highlights + notes |
| `paper-notes --topic …` | project notebook (all highlights) |
| `lit-matrix --topic … [--build] [--csv]` | literature-review matrix |
| `library [--collection] [--status] [--q]` | cross-project library |
| `collections {list\|create\|rename\|delete\|add\|remove}` | collections |
| `flow-status --topic …` | gather→read→synthesize→write progress |

MCP mirrors these: `gapmap_paper_ask`, `gapmap_paper_chunk_search`,
`gapmap_paper_reading_status`, `gapmap_paper_reading_queue`,
`gapmap_paper_highlight`, `gapmap_paper_notes`, `gapmap_lit_matrix`,
`gapmap_paper_library`, `gapmap_paper_collections`, `gapmap_flow_status`,
plus the existing paper pipeline (`gapmap_paper_knowledge_build`,
`gapmap_connections`, `gapmap_paper_outline_generate`, …).

## Tests

`tests/test_research_mode.py` (13) + `tests/test_paper_chat.py` (7) — reading
status, highlights, library/collections, lit-matrix, flow-status, and the
cited-Q&A citation bookkeeping. Run: `pytest tests/test_research_mode.py
tests/test_paper_chat.py`.

## Known gaps (P2)

- Reader highlight anchoring is by quoted-text match (re-marks the first
  occurrence), not exact DOM range.
- Lit-matrix build is sequential (no parallel fan-out).
- Library "add to collection" is per-paper (no multi-select).
- UI not yet smoke-tested in a packaged build (backend + CLI verified; 20 unit
  tests green).
