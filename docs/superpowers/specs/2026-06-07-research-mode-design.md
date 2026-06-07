# Gap Map — Research Mode (PhD / researcher experience)

**Date:** 2026-06-07
**Status:** Approved (user: "do all") — building in phases.
**Revert point:** tag `v0.1.22` (commit `8126154`). All Research Mode work is additive on top.

## Goal

Turn Gap Map into a first-class **literature research workspace** for PhD students and
researchers, without forking the app. A Settings-selected **App Mode** reconfigures the
existing product into a guided **Gather → Read → Synthesize → Write** flow over an
academic corpus that Gap Map's own collect pipeline gathers.

## Principles

- **Reuse, don't rebuild.** Paper finding, full-text→sections→chunks (auto-indexed),
  palace search, cited Q&A (`paper_chat`), connections, gaps, outline/draft, citation
  export already exist and are verified. Research Mode is mostly *surfacing + glue +
  4 net-new researcher features*.
- **Additive + reversible.** New tables, new screens, a mode flag. No migrations to
  existing tables. `Topic` stays the data model; only the **UI label** becomes
  "Project" in research mode.
- **Verifiable.** Backend changes are testable via CLI/pytest; build a real corpus
  (binaural-beats EEG) to dogfood the UI against.

## App Mode

Setting **"What are you using Gap Map for?"** → `product` (today) | `research`.
- Stored in core config (`app_mode`), read by CLI/MCP/Tauri; mirrored to `localStorage`
  for instant frontend branching.
- In `research` mode:
  - **Terminology:** "Topic" → **"Project"** in UI copy (single `labels(mode)` helper).
  - **Default new-project sources** = academic only (arXiv, PubMed, OpenAlex,
    Semantic Scholar, Crossref, Europe PMC, DBLP, Scholar).
  - **Navigation:** promote research tabs (Papers, Read, Lit Matrix, Synthesize, Write,
    Library); hide product tabs (Personas, Bets, Sentiment).
  - **Front door:** Research Home.

## Information architecture / screen flow

```
RESEARCH HOME → PROJECT WORKSPACE [ ① Gather → ② Read → ③ Synthesize → ④ Write ]
                LIBRARY (cross-project: collections · reading status · queue)
```

- **Research Home** (new): projects list (papers · read% · gaps · draft status),
  "Start new research" (question → creates project + academic collect), Library +
  Reading-queue entries.
- **Project workspace** (enhance `topic.js`): a **stage bar** Gather→Read→Synthesize→Write.
  - **Gather:** academic collect (reuse `research_workspace.js` / collect) → papers list.
  - **Read:** per-paper Reader (full text by section) + **highlights/notes** + per-paper
    cited chat + **reading status**; to-read queue.
  - **Synthesize:** **Lit-review matrix** + Connect-the-dots + Gaps + Ask-the-papers
    (project-wide cited Q&A — already built this session).
  - **Write:** Outline → Draft → **Citation manager** → Export (BibTeX/RIS/APA/MD).
- **Library** (new, cross-project): all papers, collections (many-to-many), reading-status
  filters, search, to-read queue.

## Data model (additive)

| Table | Columns (essential) | Purpose |
|---|---|---|
| `paper_collections` | id, name, created_at | Named collections/folders |
| `paper_collection_items` | collection_id, post_id | Many-to-many membership |
| `paper_reading_status` | post_id, status(to_read\|reading\|read), updated_at | Status + queue |
| `paper_highlights` | id, post_id, section, char_start, char_end, quote, note, color, created_at | Highlights + margin notes |
| `lit_matrix` (via `strategy_artifacts` kind=`lit_matrix`) | topic, data(JSON rows), provider, updated_at | Cached comparison grid |

App mode + per-project citation selection live in config / `strategy_artifacts`.

## The 4 v1 features

1. **Highlights + notes** — select text in the Reader → highlight (color) + optional note;
   persisted; shown in margin; injected into the paper's cited-chat context.
2. **Lit-review matrix** — LLM extracts {method, dataset, sample, findings, limitations,
   metric} per paper from chunks (reuse `paper_analyses` when present); cached; UI table
   sort/filter/export (CSV/MD).
3. **Reading queue + status** — status per paper; to-read queue + "next up" on Home/Project.
4. **Citation manager** — per-project citation library; cite-picker → insert `[@key]` into
   draft → compile references; export the existing 4 formats.

## Build order (each phase = its own commit, independently usable)

- **Phase 0 — Foundation:** App Mode (config + Settings toggle + plumbing), terminology
  helper, Research Home screen, Project stage-bar, conditional nav. + gather a real
  academic corpus to build against. **(building first)**
- **Phase 1 — Read loop:** Reader (full text + sections) + highlights/notes + reading
  status/queue (tables + CLI/MCP/Tauri CRUD + UI).
- **Phase 2 — Synthesize:** Lit-review matrix (builder + UI) + Ask-the-papers surface +
  Connections/Gaps polish.
- **Phase 3 — Write:** Citation manager + outline/draft integration + export.
- **Phase 4 — Library:** cross-project library + collections.

## Phase 0 detail (this build)

- `core/config`: `app_mode` get/set (default `product`); expose via a CLI command
  (`config get/set app-mode`) and a Tauri command (`get_app_mode` / `set_app_mode`).
- Frontend `labels.js`: `labels()` returns `{topic, topics, topicTitle}` based on mode
  (Topic vs Project). One source of truth for relabeling.
- `screens/research_home.js`: projects list + start-new + library/queue entries.
- Project workspace: a stage-bar component above the tabs that maps to existing
  tabs/screens; conditional tab set by mode.
- Settings: an "App mode" selector (Product gaps / Academic research).

## Verification

- Backend: `config set/get app-mode` round-trips; pytest stays green.
- Frontend: `node --check` on new/edited screens; manual `npm run tauri:dev` walk-through.
- Dogfood: the binaural-beats EEG corpus (papers + full text + chunks) backs the Reader,
  Ask, and Lit-matrix during development.

## Out of scope (v1)

- PDF inline viewer (we render extracted full text by section, not the original PDF canvas).
- Real-time multi-user collaboration.
- Word `.docx` export (Markdown/BibTeX/RIS/APA only in v1).
