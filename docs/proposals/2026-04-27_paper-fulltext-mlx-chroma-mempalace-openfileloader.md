# Paper full-text → MLX-embedded chunks → ChromaDB / Mempalace, citations via OpenFileLoader, gap-finding & paper-writing

**Date:** 2026-04-27
**Author:** desktop-research-app stream
**Status:** Proposal — turn into a 4-stage plan once approved

---

## 0. Where we are today (so the proposal is grounded in real code)

The pieces already in the repo:

| Layer | Module | What it does today |
|------|--------|--------------------|
| Paper ingest | `src/reddit_research/sources/{arxiv,openalex,semantic_scholar,scholar,pubmed,crossref}.py` | Fetch metadata + abstract → `posts` row, source-tagged. |
| PDF fetch | `src/reddit_research/research/paper_fulltext.py` | Resolves PDF URL, downloads with size/encoding guards, extracts via pypdf, caches flat text under `<data_dir>/paper_cache/<source>/<post_id>.txt`. SQLite metadata in `paper_full_texts`. |
| Local-file ingest | `src/reddit_research/sources/local_file.py` | User-uploaded `.pdf / .md / .txt` parsing (also pypdf). Different threat model + size policy from the paper path. |
| Vector store (Mempalace) | `src/reddit_research/retrieval/palace.py` | Persistent Chroma client + bundled ONNX MiniLM-L6-v2 + BM25 hybrid rerank. Indexes `posts` rows (one vector per post). Hooked into `core.db.upsert_posts`. |
| Embedder | `src/reddit_research/retrieval/embedder.py` | ONNX MiniLM (CPU). |
| Gap detection | `src/reddit_research/research/gap_discovery.py` + `gaps.py` | Pulls `posts` text, runs LLM extractor for `painpoint / feature_request / complaint / opportunity` nodes, persists into `graph_nodes` / `graph_edges`. |
| Synthesis | `src/reddit_research/research/insights.py` | `synthesize_insights` + `_chunked` — LLM rollup of corpus + findings into a "topic report". |
| LLM paper analysis | `src/reddit_research/research/paper_analyze.py` | Reads `get_full_text_or_abstract`, sends up to 30k chars to LLM, returns structured analysis. |
| Chat | `src/reddit_research/research/chat.py` | Splices a 3.5k-char paper excerpt (first 2.5k + last 1k) into evidence per paper. |
| Multi-source bridge | `src/reddit_research/sources/opencli_bridge.py` | Node-side `@jackwener/opencli` adapters (Bluesky, Substack, ProductHunt). |

The piece **completely missing**: there is no chunking layer. One paper = one Chroma vector built from `(title + selftext)`, capped at the abstract length. The full-text cache files exist on disk but Mempalace never sees them. Gap discovery and chat both still degrade to abstract-tier reasoning even when the cache has 80k chars of methodology + results sitting right there.

That's the gap this proposal closes.

---

## 1. What's blocking better gap-finding right now

These are the concrete reasons the current pipeline misses gaps a researcher would spot:

1. **Abstract-only retrieval.** Mempalace only embeds `(title + selftext)` for paper rows, where `selftext = abstract`. The methodology / dataset numbers / limitations / future-work sections — exactly where research gaps live — never get vectorised, so semantic search can't surface them.
2. **Coarse granularity.** Even the abstract is a single 1500-token vector. A paper that's 60% on-topic and 40% off-topic gets averaged into a fuzzy centroid that ranks lower than a fully-on-topic 200-word forum post. Long-form evidence loses to short-form noise.
3. **No section awareness.** "Limitations" sections are gold for gap-finding. Today they're invisible — the LLM extractor sees a flat text blob with no `Limitations` boundary. Same for `Future Work`, `Discussion`, `Related Work`.
4. **No citation graph.** `paper_full_texts` stores the text; `graph_nodes` stores findings; nothing connects them via an actual citation/reference edge. So we can't say "5 papers all cite this single 2018 dataset that nobody has updated" — a textbook gap signal.
5. **Cross-paper triangulation is weak.** `gap_discovery.py` runs the LLM extractor per-document. Cross-document deduplication happens via `dense-graph-relations` (battle-tested), but it operates on findings nodes, not on raw chunks. A claim that appears in Methods of paper A and Limitations of paper B never meets at the chunk level.
6. **No evidence-based answers.** Chat splices the first 2.5k + last 1k chars regardless of relevance. There is no "retrieve the 6 most relevant chunks across all 40 papers in this topic" call.
7. **Apple Silicon unused.** Embedder is ONNX CPU MiniLM-L6-v2 (384 dim, ~17 MB model). On an M-series Mac the user has 16-32 GB unified memory and a Neural Engine sitting idle. We could be running a stronger model (e.g. `mxbai-embed-large` or `bge-small`) at 5-10× the throughput via MLX without changing the user's experience.
8. **Citations are unstructured.** OA papers ship with reference lists and DOIs but `paper_fulltext` keeps them as plain text. We have no `paper_references(src_post_id, dst_doi, dst_post_id?, ...)` table. Without it, "papers that cite paper X" / "shared citations" / "uncited but relevant" — all impossible.

---

## 2. The shape of the proposed system

Five new layers, each isolated, each independently testable:

```
PDF cache (exists)
    │
    ▼
[A] Section-aware parser   →  paper_sections(post_id, name, ord, char_start, char_end)
    │
    ▼
[B] Chunker                →  paper_chunks(id, post_id, section, ord, text, char_count, hash)
    │
    ▼
[C] MLX embedder           →  embeds chunk batches (Apple-Silicon-fast; ONNX fallback)
    │
    ▼
[D] Mempalace `papers`     →  separate Chroma collection: ids = chunk_id, metadata carries
     collection                  (post_id, section, ord, doi, year, source)
    │
    ▼
[E] Citation extractor    →  paper_references(src_post_id, dst_doi, dst_title, dst_year)
    + OpenFileLoader           reverse-resolved via OpenAlex/Crossref/SemanticScholar
                               into existing posts where possible
```

Each is small. Each can ship behind a feature flag. None of them break existing flows.

### [A] Section-aware parser (`paper_fulltext.parse_sections`)

`paper_full_texts` already has flat text. Add a new module `paper_fulltext_sections.py` that runs **after** download and walks the text with regex + heuristics to identify standard sections (`Abstract`, `Introduction`, `Related Work`, `Background`, `Methods` / `Methodology` / `Approach`, `Experiments`, `Results`, `Discussion`, `Limitations`, `Future Work`, `Conclusion`, `References`). New table:

```sql
CREATE TABLE paper_sections (
  id INTEGER PRIMARY KEY,
  post_id TEXT NOT NULL,
  name TEXT NOT NULL,         -- canonical: methods | results | limitations | …
  raw_heading TEXT,            -- as-printed in the PDF (for citations)
  ord INTEGER,                 -- 0-based order in the doc
  char_start INTEGER,
  char_end INTEGER,
  FOREIGN KEY(post_id) REFERENCES posts(id)
);
CREATE INDEX idx_paper_sections_post ON paper_sections(post_id);
CREATE INDEX idx_paper_sections_name ON paper_sections(name);
```

Why a separate table (not stored in `paper_full_texts.metadata_json`): we want to query "every Limitations section across this topic's corpus" without scanning JSON.

**Robustness:** science papers vary wildly. Strategy is "best-effort enrich, never block":

- If parser finds zero recognised sections → fall back to a single `name='body'` row covering the whole text. Downstream chunker still works.
- Section detection runs once per paper, cached in the `paper_sections` table. Re-runs are cheap.
- Two implementations behind one flag: regex (default, ~5 ms) and `pdfplumber`-aided heading detection (slower but more accurate when fonts are available). Start with regex; add pdfplumber as a v2 if accuracy is a problem.

### [B] Chunker (`paper_fulltext_chunker.py`)

Hybrid strategy: **section-aware sliding window** with sentence-boundary respect.

Parameters (env-tunable, sensible defaults):
- `target_tokens = 384` (≈1500 chars; matches MiniLM/bge sweet spot)
- `overlap_tokens = 64` (~250 chars)
- Never split across `Abstract` / `Methods` / `Results` / `Limitations` / `Conclusion` boundaries — those carry semantic signal.

Output table:

```sql
CREATE TABLE paper_chunks (
  id TEXT PRIMARY KEY,        -- "{post_id}#sec={name}#ord={ord}"
  post_id TEXT NOT NULL,
  section TEXT,                -- NULL when whole-doc fallback
  ord INTEGER NOT NULL,
  char_start INTEGER,
  char_end INTEGER,
  text TEXT NOT NULL,
  char_count INTEGER NOT NULL,
  hash TEXT NOT NULL,          -- sha256 of text — dedup + change detection
  embedded_at TEXT,            -- when this chunk last got pushed to Chroma
  FOREIGN KEY(post_id) REFERENCES posts(id)
);
CREATE INDEX idx_paper_chunks_post ON paper_chunks(post_id);
CREATE INDEX idx_paper_chunks_section ON paper_chunks(section);
CREATE INDEX idx_paper_chunks_hash ON paper_chunks(hash);
```

`hash` is the deduplication primitive. Re-running chunking after a re-download produces identical chunk hashes for unchanged sections, so we only re-embed the diff.

Average paper at 60k chars → ~40 chunks. 1000 papers in a topic → 40k chunks. Comfortable for ChromaDB on a laptop.

### [C] MLX embedder (`retrieval/embedder_mlx.py`)

Drop-in alongside the existing ONNX embedder. Resolution order at runtime:

```
1. EMBEDDER_BACKEND env explicit → use that
2. Apple Silicon detected (`platform.processor() == 'arm'` and `mlx` importable) → MLX
3. else → existing ONNX MiniLM
```

The interface stays identical (`embed(texts: list[str]) -> list[list[float]]`) so neither Mempalace nor the chunker cares which backend is active.

Default MLX model: **`mlx-community/multilingual-e5-base-mlx`** (~280 MB, 768 dim, multilingual). Good middle ground — stronger than MiniLM, smaller than bge-large, multilingual covers non-English papers (we already see Chinese arxiv preprints in some topics).

Why MLX and not just a bigger ONNX model:
- ~5-10× throughput on M1/M2/M3 (40-60 chunks/sec vs ~6-8 for ONNX MiniLM CPU).
- Same memory budget (M-series unified memory, no GPU split).
- Bundled with the app — shipped via PyInstaller with a `requirements-mlx.txt` group, gated by platform marker so Intel/Linux wheels skip it.

**Fallback behavior is critical.** If MLX import fails (Intel Mac, Linux, missing model files), embedder silently falls back to ONNX. We never crash the pipeline because of an embedder choice. The status command will show which backend is live.

### [D] Mempalace `papers` collection

Today Mempalace has one Chroma collection: `posts`. Add a second one: `paper_chunks`. Reasons not to overload the existing collection:

- Different lifecycle: posts get one vector each, papers get many. Mixing breaks the implicit "one-row-per-doc" assumption in `search_posts` ranking.
- Different metadata shape: chunks need `(post_id, section, ord)` so the UI can show "result from Methods section of paper X". Posts don't.
- Different retrieval semantics: when a user asks "which papers discuss X", we want top-K *papers* (deduplicated by `post_id`), not top-K *chunks* (which can all be from the same paper). Separate collection lets us implement chunk-level retrieval + paper-level rollup cleanly.

API additions in `palace.py`:

```python
def upsert_paper_chunks(chunks: Iterable[dict], *, topic: str | None = None) -> dict
def search_paper_chunks(query: str, *, k: int = 12, topic: str | None = None,
                       section_filter: list[str] | None = None) -> list[dict]
def search_papers(query: str, *, k: int = 8, topic: str | None = None,
                 max_chunks_per_paper: int = 3) -> list[dict]   # rolled up
```

`search_papers` performs chunk-level retrieval, then groups by `post_id`, keeps the top-N chunks per paper, and returns one row per paper with the matching chunks attached. That's the right shape for chat / gap-finding consumers.

### [E] Citation extractor + OpenFileLoader (`paper_references.py`)

Two phases:

**Phase 1 — extract.** Walk `paper_chunks WHERE section='references'` (or, when section parsing failed, the tail 15% of `paper_full_texts.text`). Use regex + `OpenFileLoader` (the user-mentioned package — assumed to be a citation-aware loader; in practice we'll use `refextract` or `grobid` as the parser; if a package literally named `OpenFileLoader` is wanted, this is the integration point).

**Phase 2 — resolve.** For each parsed reference, try in order:
1. DOI present → look up via Crossref (already wired in `sources/crossref.py`).
2. Title-only → OpenAlex full-text search.
3. arxiv ID → arxiv API.
4. Nothing matches → store the raw reference string as `unresolved` so a future re-run can retry.

```sql
CREATE TABLE paper_references (
  id INTEGER PRIMARY KEY,
  src_post_id TEXT NOT NULL,
  dst_post_id TEXT,            -- when we already have it in posts
  dst_doi TEXT,
  dst_arxiv_id TEXT,
  dst_title TEXT,
  dst_year INTEGER,
  dst_authors_json TEXT,
  raw TEXT,                    -- as-extracted citation string
  resolution_status TEXT,      -- ok | doi_only | unresolved
  fetched_at TEXT,
  FOREIGN KEY(src_post_id) REFERENCES posts(id),
  FOREIGN KEY(dst_post_id) REFERENCES posts(id)
);
CREATE INDEX idx_pr_src ON paper_references(src_post_id);
CREATE INDEX idx_pr_doi ON paper_references(dst_doi);
CREATE INDEX idx_pr_dst ON paper_references(dst_post_id);
```

This gives us a real citation graph. `graph/relations.py` already builds findings-edges; we add one more edge kind (`cites`) with weight = 1, exposed via the existing graph tools.

---

## 3. Where OpenFileLoader fits

The user explicitly named OpenFileLoader. Without authoritative docs on that exact package name in this codebase, I'm reading the request as: a package that loads files, knows about citations, and can extract structured references. The places it slots in:

1. **PDF section parsing.** Replace pypdf-only extraction with OpenFileLoader's structured loader (it likely returns `(text, sections, refs)` rather than just `text`). If it has a `chunk` method, we use that as the chunker primitive in [B] and skip our hand-rolled overlap window. If not, our chunker stays.
2. **Citation extraction.** This is the headline use. OpenFileLoader's reference extractor → `paper_references` rows. No regex tuning, no per-publisher edge cases.
3. **New-paper rendering.** When we generate a new paper (see §5), OpenFileLoader's writer side can render the citation list in a target format (APA / IEEE / arXiv style). Keeps citation discipline consistent end-to-end.
4. **Local-file ingest.** `sources/local_file.py` currently uses pypdf. Migrating it to OpenFileLoader gives the user-uploaded `.pdf` path the same section-aware + citation-aware treatment for free.

**Fallback discipline:** OpenFileLoader becomes a soft dependency. If it's missing or fails on a given file, we fall through to the existing pypdf path. Same pattern as `chromadb` in `palace.py` today — if missing, semantic features degrade gracefully and surface a `not_installed` reason.

---

## 4. How this improves gap-finding (concrete, per-gap-type)

| Gap type | Today's failure | With this stack |
|---------|-----------------|-----------------|
| **"Authors note this is a limitation but no one has solved it"** | Limitations sections are buried in flat text; LLM extractor sees them mixed with Discussion. | Section parser flags `name='limitations'` chunks; gap_discovery prefers them; cross-paper dedup spots when the same limitation is independently noted in 5+ papers → strong gap signal. |
| **"Old dataset, never updated"** | No reference graph. | `paper_references` shows N papers all citing one 2018 dataset DOI; if `dst_post_id` is null and `dst_year < current_year - 4`, raise a "stale-dataset" gap. |
| **"Methodology gap — papers describe X but don't measure Y"** | Methods + Results are not separately retrievable. | `search_paper_chunks(query, section_filter=['methods', 'results'])` exposes the precise sections; LLM can compare claim density. |
| **"Cited but never followed up"** | No back-citation pointer. | Reverse-index of `paper_references` → "papers that cite X" — if X has 50 citations and they all just reference, never extend, that's a follow-up gap. |
| **"Topic-adjacent but unconnected"** | Cross-paper similarity at the abstract level only catches obvious overlaps. | Chunk-level cosine similarity finds two papers with 80% similar Methods sections that the abstracts didn't reveal. |
| **"Conflicting findings"** | Topic synthesis flattens everything to one report. | Retrieve `section='results'` chunks for a query, cluster by claim sign — surfaces "paper A says +12%, paper B says no effect" disagreements that the current rollup hides. |

The MCP tool surface to expose these:

- `reddit_paper_chunk_search(query, section?, k=12, topic?)` — returns top-K chunks with `(post_id, section, snippet, score)`.
- `reddit_paper_section_get(post_id, section)` — pull a specific section verbatim.
- `reddit_paper_citations(post_id)` — outgoing references.
- `reddit_paper_cited_by(post_id)` — incoming citations (within our corpus).
- `reddit_paper_gap_candidates(topic, kind?)` — runs the section-aware gap heuristics above and returns ranked candidates with evidence pointers.

These slot into the existing `mcp/server.py` decorator pattern; per-tool logging from `2026-04-26_01` works automatically.

---

## 5. Writing a new paper from the corpus

Once chunks + sections + citations are first-class, generating a literature-review-style paper is a matter of orchestration. Pipeline:

1. **User picks a topic** (or hands us a research question).
2. **Coverage map.** `search_paper_chunks(question, k=200)` → cluster chunks by section → for each section type, list the top claims and their evidence chunks. This is the skeleton of the paper.
3. **Gap insertion.** Pull `reddit_paper_gap_candidates(topic)` and weave the strongest 3-5 into a "What's missing" section.
4. **LLM drafting.** For each section, call the LLM with: the question, the relevant chunks (with `post_id` + `section` provenance), and a tight system prompt that requires every claim to cite a source. The LLM never invents a citation — it picks from the provided chunks' `post_id`.
5. **Citation render via OpenFileLoader.** Resolve each `post_id` → DOI/arxiv/URL via `paper_references` and `posts.metadata_json`. Render the bibliography in the user's chosen style.
6. **Self-review pass.** Second LLM call: "Given this draft + the cited evidence chunks, mark any claims not directly supported by their citation." Strikethrough or remove.
7. **Output.** Markdown + BibTeX, optionally rendered to PDF via pandoc.

Suggested writeable artefacts:

- **Literature review** for a topic — what we know, what's contested, what's missing.
- **Gap report** — research questions ranked by evidence saturation × novelty.
- **Methods comparison memo** — across N papers, how do their Methods differ on dimension X? Useful when the user is choosing an approach to replicate.
- **Position paper** — given a research question + the gap report, the LLM argues for one direction with the corpus as evidence.
- **Annotated bibliography** — for each paper: 1-paragraph summary + the 3 most-cited chunks + which questions it answers and which it leaves open.

Each is a Typer command (`research write --kind literature-review --topic X`) and an MCP tool (`reddit_research_write_*`). The CLI side renders directly; the MCP side returns markdown that the host (Claude Code, etc.) can edit.

---

## 6. Build order (so we ship something every step)

| Step | Days est. | What ships | What stays unchanged | Verification |
|------|-----------|-----------|---------------------|--------------|
| 1. Section parser + `paper_sections` table + `mcp logs` instrumentation | 1 | Existing chat + analyze use it when sections are present, ignore it otherwise. | All tools, all retrieval. | `paper_sections` populated for the 5 verified arxiv papers from `2026-04-27_01`. |
| 2. Chunker + `paper_chunks` + a new `papers` Chroma collection (still using ONNX MiniLM) | 1 | Two new MCP tools: `reddit_paper_chunk_search`, `reddit_paper_section_get`. | Existing `posts` collection untouched. | Chunk count for a known paper matches expected (~40 chunks for a 60k-char paper). |
| 3. MLX embedder + auto-fallback | 1 | Embedder backend selectable; default to MLX on Apple Silicon. | ONNX path stays the default fallback. Mempalace API surface unchanged. | Throughput probe: 100 chunks embed in <2s on M-series, <15s on ONNX. |
| 4. OpenFileLoader integration for parser + chunker (replace pypdf where possible) | 1-2 | Better section detection; structured ref extraction free. | Pypdf path remains the fallback. | A paper with mixed text+image content extracts both. |
| 5. `paper_references` extractor + Crossref/OpenAlex resolver | 1 | New tools: `reddit_paper_citations`, `reddit_paper_cited_by`. Citation edges in graph. | Existing graph nodes/edges untouched. | For a known paper, ≥80% of references resolve to DOI. |
| 6. Gap heuristics on top of sections + citations | 1 | `reddit_paper_gap_candidates`. | Existing `find_gaps` continues to work in parallel. | At least 3 distinct gap kinds surfaced for the test topic. |
| 7. `research write --kind X` + MCP `reddit_research_write_*` | 2 | Literature review, gap report, annotated bibliography commands. | Everything else. | Generated literature review for a small test topic passes a manual citation-spot-check. |

Small steps on purpose — each one is independently revertable, each improves the user experience even if later steps slip.

---

## 7. Risks + how we contain them

- **Embedding cost / disk.** MLX-base 768-dim × 40 chunks × 1000 papers × 4 bytes = ~120 MB per topic vector store. Acceptable. ChromaDB on disk grows roughly 1.5×. Set a topic-level chunk cap (e.g. 50k) with FIFO eviction.
- **Section parser misclassifies.** Always fall back to whole-document chunking. Never reject a paper because its sections are weird.
- **OpenFileLoader unavailable.** Soft dep with graceful fallback to pypdf path. Status reports which loader is active.
- **MLX missing on Intel/Linux.** Backend resolver picks ONNX automatically. Tests must run on both paths in CI.
- **Generated papers hallucinate citations.** Two-pass: drafter only sees the chunks we hand it; reviewer flags any unsupported claim. We never let the LLM invent a `post_id` it didn't see.
- **Chroma collection schema drift.** Use an explicit migration helper (similar to the `_heal_legacy_palace` pattern already in `palace.py`) so schema changes don't brick existing user data.
- **PyInstaller bundle bloat.** MLX model files are large. Ship them as a separate downloadable bundle; first run downloads them on demand with progress UI. Doctor flags missing models with a one-click fix.

---

## 8. Open questions for you

1. **OpenFileLoader exact package.** Is this `unstructured-io/unstructured`, `langchain-community.document_loaders.openfileloader`, or a different package you have in mind? The integration plan above is structured so the answer doesn't change the architecture, only the import surface — but the exact package determines whether section parsing comes for free or we still write our own.
2. **MLX model.** Default to `multilingual-e5-base-mlx` (768d, multilingual, ~280 MB)? Or do you want bge / nomic / a smaller MiniLM-MLX? Trade-off is bundle size vs retrieval quality.
3. **Background pre-warm.** After a `research collect`, should chunking + embedding run automatically (5-15 min for a fresh topic with 50 papers) or stay manual via a "Build paper index" button in Settings?
4. **Generated papers — output format.** Default Markdown only? Or Markdown + BibTeX + PDF (via pandoc)?
5. **Scope of citation graph.** Limit to papers already in `posts`, or also auto-fetch references that aren't yet in the corpus (one OpenAlex call per unresolved DOI on a politeness budget)?

---

## 9. What ships if you green-light only step 1

Even doing only **§6 step 1** (section parser) would already be a real win:

- `analyze_paper` can be told "use the Limitations section verbatim" — the LLM gets cleaner input.
- Chat splice can prefer Conclusion + Limitations over the current naïve first/last slice.
- Gap discovery can boost weight on findings extracted from `section='limitations'`.

Each subsequent step compounds, but step 1 alone removes the biggest current sin (treating a 60k-char paper as a flat blob).
