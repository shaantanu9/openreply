# Gap Map → Research & Writing Assistant — Detailed Plan

> **Goal:** turn Gap Map into a tool researchers, paper-writers, and PDF-reading
> students use to (1) ingest a body of literature, (2) **find connections and
> relations that haven't been made before** ("connect the dots"), (3) analyse
> them, and (4) **write the paper** — outline → draft → citations → export.
> **Date:** 2026-06-06. Companion to `FEATURES.md` and `docs/PRODUCT-DISCOVERY-COVERAGE.md`.

> **MCP note:** the in-repo gapmap research MCP server (`src/gapmap/mcp/server.py`,
> 161 tools) is **not** currently connected to this chat session (only the
> Supabase-project MCP is). We drive the same engine via the gapmap **CLI**
> (`python -m gapmap.cli.main research …`) and Tauri sidecar — identical
> capability. To use it from Claude Code, add it with `claude mcp add gapmap …`.

---

## 1. The big realisation — ~80% of the engine already exists

Gap Map already has a deep academic pipeline. The pivot is mostly **assembly +
researcher-facing UX + a few new capabilities**, not a from-scratch build.

| Capability | Status | Where |
|---|---|---|
| Fetch papers (arXiv, PubMed, OpenAlex, Semantic Scholar, Crossref, Europe PMC, DBLP, Scholar) | ✅ | `sources/*`, cat 1 |
| Download + extract full-text PDFs (cache) | ✅ | `research/paper_fulltext.py` |
| Section + chunk papers for RAG | ✅ | `research/paper_sections.py`, `paper_chunks.py`, `paper-chunk-search` |
| Per-paper analysis (summary / relevance / takeaway) | ✅ | `research/paper_analyze.py` |
| Extract references + resolve citations + cited-by | ✅ | `research/paper_references.py` |
| Paper↔paper relations (`relates_to`, `paper_cites`, `shared_finding`, `same_author`) | ✅ | `research/paper_relations.py`, `paper-map` |
| **Cross-paper gaps**: understudied intersections, contradictions, method-replication | ✅ | `research/paper_gaps.py` |
| Knowledge graph + communities + **semantic/dense edges** (`relates_to`, `co_evidenced`, `potentially_solves`) | ✅ | `graph/*`, dense-graph-relations |
| **Paper outline + IMRaD draft generation** | ✅ | `paper_pipeline.paper_outline_generate` / `paper_draft_generate` |
| Build full paper knowledge (fulltext→sections→gaps→insights) | ✅ | `research/paper_workflow.build_paper_knowledge` |
| Grounded chat over full paper text (intro+conclusions spliced) | ✅ | `research/chat/retrieval_context.py` |
| Export (markdown / DOCX / deck) | ✅ | `research/export_brief.py`, `export_deck.py`, `paper-export` |

## 2. What's MISSING (the build list)

1. **Citation export formats** — `paper_references` extracts refs but there's no
   **BibTeX / RIS / APA / MLA** formatter or a managed reference list. P0 for writers.
2. **"Connect the dots" novel-connection surface** — the engine (paper_gaps +
   dense edges) exists, but there's no dedicated view that surfaces **cross-paper
   relations not explicitly stated in the literature**, scored by novelty +
   evidence + confidence, with "why this link is new." This is the differentiator.
3. **Researcher workspace UX** — the app is framed for product discovery. Need a
   **Research mode** that organises: PDF Library → Connections → Gaps → Outline →
   Draft → Citations → Export as one coherent flow (today these are scattered
   CLI commands + the Papers/Research tabs).
4. **Student "drop a PDF → cited Q&A" flow** — chat + paper RAG exist; needs a
   focused upload→ask→answer-with-citations surface (a student isn't building a topic).
5. **Academic draft polish** — verify `paper-draft` produces real IMRaD with
   inline citation keys; add **LaTeX export** + reference list injection.

## 3. The three personas + their flows

### A. PDF-reading student — "understand this paper / these papers"
```
drop PDF(s) → auto extract+section+analyze → ask questions (cited answers from full text)
→ get a plain-language summary + key takeaways + glossary → export notes
```
Reuses: paper_fulltext, paper_sections/chunks, chat RAG, paper_analyze.
New: a student-simple "Reading" surface (no topic/collect ceremony) + cited Q&A.

### B. Researcher — "find connections nobody has made"
```
build a corpus (search sources OR drop PDFs) → build paper knowledge
→ Connections view: novel cross-paper links (understudied intersections,
   contradictions, bridges A↔B, shared-but-uncited findings) ranked by novelty
→ inspect a connection → see the evidence papers + why it's new → save it
```
Reuses: paper_gaps, paper_relations, dense graph edges, communities, semantic.
New: **novelty scorer** + a Connections surface + "bridge" detection (two
well-studied clusters with few/no edges between them = an unexplored link).

### C. Paper writer — "turn the corpus + connections into a draft"
```
pick the angle (a saved connection / gap) → generate outline (IMRaD)
→ generate draft sections grounded in the corpus with inline [cite] keys
→ manage references (BibTeX/RIS) → export (Markdown / DOCX / LaTeX + .bib)
```
Reuses: paper_outline_generate, paper_draft_generate, insights, export_*.
New: citation formatter + reference manager + LaTeX export + cite-key injection.

## 4. End-to-end flow (the assembled product)

```
        ┌─────────────┐
 PDFs ──▶  INGEST     │  fulltext → sections → chunks → per-paper analysis → references
search ─▶ (corpus)    │
        └──────┬──────┘
               ▼
        ┌─────────────┐
        │ KNOWLEDGE   │  knowledge graph + communities + semantic/dense edges
        │  GRAPH      │  + paper↔paper relations (cites / relates_to / shared_finding)
        └──────┬──────┘
               ▼
        ┌─────────────┐
        │ CONNECT THE │  novel cross-paper connections, ranked by NOVELTY:
        │   DOTS  ★    │   • understudied intersections (A×B sparse)
        │             │   • contradictions (opposing claims)
        │             │   • bridges (two clusters, few edges between)
        │             │   • shared-but-uncited findings (parallel discovery)
        └──────┬──────┘
               ▼
        ┌─────────────┐
        │  ANALYSE    │  inspect a connection → evidence papers + quotes + why-new
        │  + chat     │  + grounded Q&A over full text
        └──────┬──────┘
               ▼
        ┌─────────────┐
        │   WRITE     │  outline (IMRaD) → draft sections w/ inline [cite] keys
        │             │  → references (BibTeX/RIS/APA) → export (MD/DOCX/LaTeX+.bib)
        └─────────────┘
```

## 5. How "connect the dots" works (the differentiator)

The novelty engine combines four signals, all already computable from the graph:

1. **Understudied intersection** (`paper_gaps`): theme A and theme B each have
   many papers, but few/none discuss A∩B → a candidate new direction.
2. **Bridge detection** (NEW, from `graph/communities.py`): two dense communities
   with high internal connectivity but ≤k edges between them → the sparse edge
   is an under-explored link. Score = (cluster sizes) / (inter-cluster edges + 1).
3. **Shared-but-uncited finding** (from `paper_relations` `shared_finding` minus
   `paper_cites`): two papers reach a similar finding but don't cite each other →
   a parallel-discovery connection worth surfacing.
4. **Contradiction** (`paper_gaps`): opposing claims on the same variable → a
   tension to resolve (great paper material).

**Novelty score** = weighted blend (intersection sparsity, bridge rarity,
citation-absence, evidence count) → ranked list. Each item shows the evidence
papers, the supporting quotes, and a one-line "why this hasn't been connected."
Persisted to `strategy_artifacts` (kind `connections`) so it caches + is MCP-readable.

## 6. New components to build

| Component | Kind | Notes |
|---|---|---|
| `research/citations.py` | Python | BibTeX/RIS/APA/MLA from `paper_references` + topic refs; cite-key generation |
| `research/connections.py` | Python | the novelty engine (§5) — `connections_get/_compute` on `strategy_common` |
| LaTeX export in `paper_export.py` | Python | IMRaD draft → `.tex` + `.bib`, inline `\cite{}` |
| CLI: `research connections`, `research citations --format bibtex` | CLI | thin wrappers |
| Rust: `connections_get/_compute`, `citations_export` | Rust | run_cli pattern |
| api.js: `connectionsGet/Compute`, `citationsExport` | JS | cached + invoke |
| **Connections** tab | Screen | ranked novel links + evidence + save |
| **Write** tab (or workspace) | Screen | outline → draft → references → export, in one place |
| **Reading** surface (student) | Screen | drop PDF → cited Q&A (lightweight, topic-optional) |
| MCP: `gapmap_connections`, `gapmap_citations`, `gapmap_paper_outline/draft` | MCP | drive headlessly |

## 7. Phased roadmap + STATUS

- **Phase R1 — Connections (the differentiator): ✅ DONE (2026-06-06).**
  `research/connections.py` novelty engine + **Connect Dots** tab + CLI
  (`research connections`) + Rust + api + MCP (`gapmap_connections`). Proven on a
  real topic: 6 ranked connections (understudied intersections, contradictions,
  method-replications), persisted + read back.
- **Phase R2 — Citations: ✅ ALREADY EXISTED.** `paper_export.py` has
  `to_bibtex/to_ris/to_apa/to_markdown` + `export_topic`; CLI `papers-export`;
  Rust `papers_export`; api `papersExport`; Papers tab has BibTeX/RIS/APA/Markdown
  export buttons. Proven: real `@article{…}`, RIS (Zotero), APA all generate.
  *(Remaining nice-to-have: MLA + LaTeX `.tex`+`.bib` export — P2.)*
- **Phase R3 — Write workspace: ✅ ALREADY EXISTED.** Papers tab has "Build
  knowledge base" + "Generate paper draft" (modal w/ copy); outline + draft wired
  via `paper_outline_generate`/`paper_draft_generate` (Rust+api+**MCP**).
- **Headless chain: ✅ COMPLETED (2026-06-07).** Added `gapmap_paper_knowledge_build`,
  `gapmap_paper_gaps`, `gapmap_paper_relations_build` so Claude Code drives the
  WHOLE flow: build_knowledge → relations_build → connections → outline → draft →
  papers_export.
- **Phase R4 — Student Reading surface: ⬜ NEXT.** drop-PDF → cited Q&A,
  topic-optional. Chat + paper RAG + PDF ingest all exist; needs a lightweight
  entry-point screen that doesn't require building a topic first.
- **Phase R5 — Polish: ⬜.** plain-language summaries, glossary, MLA/LaTeX, dedup.

**Net:** the researcher + writer flow is functional end-to-end *today* (in-app and
headless). The main remaining new build is the student Reading surface (R4).

## 8. Build invariants (same as the rest of the app)
- Each new module mirrors `prioritize.py`/`strategy_common.py` (pure-read get +
  LLM compute, persist to `strategy_artifacts`, never-raise reads).
- Each screen mirrors `prioritize.js` (esc, alive() guard, empty-big, compute btn).
- Wire CLI → Rust → main.rs → api.js → topic.js tab.
- Build-verify: CLI JSON + vite + cargo. Update FEATURES.md + changelog. `graphify update .`.
- Prove each compute on a real academic topic before flipping ✅.
