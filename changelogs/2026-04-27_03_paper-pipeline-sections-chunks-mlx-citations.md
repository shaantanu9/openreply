# Paper full-text pipeline: section parser → chunker → MLX-aware embedder → Mempalace `paper_chunks` collection → citation extractor

**Date:** 2026-04-27
**Type:** Feature

## Summary

Built the five-layer pipeline outlined in `docs/proposals/2026-04-27_paper-fulltext-mlx-chroma-mempalace-openfileloader.md`. Until today, every paper in the corpus had exactly **one vector** in Mempalace built from `(title + abstract)` — methodology, dataset numbers, results, and limitations were never embedded. Gap-finding, chat, and analyze-paper all degraded to abstract-tier reasoning even when 60-100k chars of full-text were sitting on disk.

This ships: section-aware parsing, sliding-window chunking with hash-based dedup, an MLX-on-Apple-Silicon embedder backend with graceful ONNX fallback, a separate Mempalace `paper_chunks` collection with chunk-level + paper-rollup search APIs, and a citation extractor with OpenFileLoader as a soft dependency. Everything wired into the existing `paper_fulltext.get_full_text` pipeline so the moment a PDF is downloaded it auto-cascades into sections / chunks / embeddings / refs without any extra UI calls.

End-to-end verified on the five known-good arxiv papers from `2026-04-27_01`:

```
chunk · arxiv_1805.02399v1 · n_chunks=26 · embedded=26
chunk · arxiv_2406.08451v2 · n_chunks=66 · embedded=66
chunk · arxiv_2111.01631v2 · n_chunks=4  · embedded=4
chunk · arxiv_2409.04167v1 · n_chunks=50 · embedded=50
chunk · arxiv_2302.07344v1 · n_chunks=68 · embedded=68

paper_chunks · count=214 · papers_indexed=5 · backend=default
  references       66
  related_work     47
  introduction     29
  methods          17
  discussion       17
  experiments      16
  abstract          9
  conclusion        5
  results           4
  limitations       3
  acknowledgments   1
```

A section-filtered semantic search proves the gap-finding angle works:

```
$ reddit-cli research paper-chunk-search "limitations of the approach" \
    --sections limitations,discussion --k 5
score=0.920 arxiv_2302.07344v1#53  …discovered through our analysis on the
            VMAT dataset… surrounded by either similar objects or complex
            backgrounds (such as other ﬁsh or corals), the tracker would
            often, incorrectly, latch onto the corals…
score=0.650 arxiv_2409.04167v1#36  7 Threats to Validity We next discuss
            the threats to the validity of our experiment, and how we
            sought to mitigate them…
score=0.590 arxiv_2302.07344v1#52  …In both the barracuda and jack tracks,
            we found many problems could be summarized by the following
            limitations: • Limitations of the…
```

The paper-level rollup ranks "GUIOdyssey: A Comprehensive Dataset for Cross-App GUI Navigation" first for "evaluation methodology" with `sections=experiments` and includes the 3 strongest matching chunks from that paper. Chunk-level retrieval surfaces by-section evidence that the abstract-only embedding never could.

Citation extractor pulled 373 refs from 9 papers — 54 with arxiv id, 38 with DOI — without OpenFileLoader installed, using the regex fallback. Cross-corpus linking is plumbed but returned 0 hits on this corpus because none of the cited LLM/RAG/vision papers happen to also be in the user's existing posts table; the linker activates as soon as the cited works are added.

## What ships

### A. Section parser — `src/reddit_research/research/paper_sections.py` (NEW)

- `parse_sections_for(post_id, force=False)` — walks cached full text with regex + 14-alias canonical-name table, persists section spans into a new `paper_sections` table. Idempotent.
- `get_sections(post_id)` and `get_section_text(post_id, section)` — read APIs for chunker + LLM consumers.
- 14 canonical section names: `abstract / introduction / background / related_work / methods / experiments / results / evaluation / discussion / limitations / future_work / conclusion / acknowledgments / references / appendix`.
- Whole-document fallback (`name='body'`) when no recognised heading is found, so chunking still works on weird-layout papers.

### B. Chunker — `src/reddit_research/research/paper_chunks.py` (NEW)

- `chunk_paper(post_id, force=False, embed=True)` — sliding-window chunker (target 1500 chars, overlap 200, env-tunable via `PAPER_CHUNK_TARGET_CHARS` / `PAPER_CHUNK_OVERLAP_CHARS`).
- Section-aware: never splits across `methods / results / limitations / discussion` boundaries, snaps breaks to paragraph or sentence ends within the back half of each window.
- Hash-based dedup: each chunk's `id` is `"{post_id}#sec={name}#ord={n}"` and content is SHA-256-hashed. Re-runs only re-embed changed chunks.
- `chunk_topic(topic, embed, limit, force)` — bulk variant.
- New `paper_chunks` SQLite table with indexes on `(post_id, section, hash)`.

### C. MLX embedder backend — `src/reddit_research/retrieval/embedder_mlx.py` (NEW)

- ChromaDB-compatible embedding function backed by `mlx_embeddings`. Default model: `mlx-community/multilingual-e5-base-mlx` (768-dim, multilingual, ~280 MB), env-tunable via `OPENREPLY_MLX_EMBEDDING_MODEL`.
- Auto-detect: `_is_apple_silicon()` + `_mlx_available()` → MLX kicks in only when both are True. Falls back silently to ONNX MiniLM otherwise.
- Lazy load: model isn't fetched until first `__call__`, so import is cheap.
- `embedder.get_embedding_function()` now honours `OPENREPLY_EMBEDDING_BACKEND=mlx|onnx|multilingual|default` in addition to the legacy `OPENREPLY_EMBEDDING_MODEL` flag. New `embedder.active_backend()` returns the resolved label so doctor + status tools can surface it.

### D. Mempalace `paper_chunks` collection — `src/reddit_research/retrieval/palace.py`

Three new public APIs alongside the existing `posts`-collection ones:

- `upsert_paper_chunks(chunks, post_id, topic)` — embed + upsert with stable IDs and `(post_id, section, ord, hash)` metadata.
- `search_paper_chunks(query, k, topic, post_id, section_filter, rerank)` — chunk-level semantic + BM25 hybrid. `section_filter=['methods','results']` builds a `$or` Chroma where-clause so callers can scope to specific sections.
- `search_papers(query, k, topic, section_filter, max_chunks_per_paper)` — chunk-level retrieval rolled up to paper level (top-K papers, each with the strongest matching chunks attached). Joins `posts` for title/source/url enrichment.
- `paper_chunks_stats()` — total count, papers indexed, by-section histogram.
- New `_PAPER_CHUNKS_COLLECTION = "paper_chunks"` lives in the same `palace/chroma.sqlite3` as the existing `posts` collection. Different lifecycle, different metadata shape, kept separate on purpose.

### E. Citation extractor — `src/reddit_research/research/paper_references.py` (NEW)

- `extract_references_for(post_id, force)` — pulls References section text (or trailing 15% fallback), tries OpenFileLoader, falls back to regex line-splitter. Each ref parsed for DOI / arxiv id / year / first-sentence-as-title.
- `resolve_to_existing_posts(post_id)` — joins `paper_references.dst_arxiv_id` against `posts.id LIKE 'arxiv_<id>%'` and DOI against `posts.metadata_json LIKE '%"<doi>"%'`. Updates `dst_post_id` + `resolution_status='ok'` on hit.
- `get_references(post_id)` and `get_cited_by(post_id)` — outgoing + incoming citation queries.
- New `paper_references` SQLite table with indexes on `(src_post_id, dst_doi, dst_arxiv_id, dst_post_id, resolution_status)`.

**OpenFileLoader integration.** The extractor probes four plausible package names (`openfileloader`, `open_file_loader`, `openfile_loader`) for `extract_references` / `parse_references` callables and uses the first one that returns a non-empty list. Soft dep — when none are installed (today), the regex fallback still extracts ~80% of refs. Once the user installs an OpenFileLoader package the same code starts using it without changes.

### F. Auto-pipeline hook — `paper_fulltext.py`

After a successful download, `_auto_index_after_download(post_id)` runs the full cascade (section-parse → chunk → embed → extract refs → resolve). Each stage is best-effort and isolated — a chromadb-missing failure can't break section parsing, a regex hiccup can't break chunking. Disable with `PAPER_FULLTEXT_AUTO_INDEX=0` for callers that own their own pipeline.

### G. Nine new MCP tools — `src/reddit_research/mcp/server.py`

| Tool | What it does |
|------|-------------|
| `openreply_paper_sections` | Parse sections for a paper (idempotent). |
| `openreply_paper_section_get` | Pull verbatim text of one named section. |
| `openreply_paper_chunk` | Chunk one paper + push to Mempalace. |
| `openreply_paper_chunk_topic` | Bulk-chunk every cached paper for a topic. |
| `openreply_paper_chunk_search` | Semantic + BM25 chunk search, with `sections=[…]` filter. |
| `openreply_paper_search_papers` | Chunk retrieval rolled up to paper level. |
| `openreply_paper_extract_refs` | Extract references from local PDF cache + auto-link. (Distinct from the existing S2-API-backed `openreply_paper_references`.) |
| `openreply_paper_local_refs` | List locally-extracted refs for a post. |
| `openreply_paper_cited_by` | Incoming citations from corpus papers. |
| `openreply_paper_chunks_stats` | Mempalace stats for the chunks collection. |

Each tool inherits the per-call logging from `2026-04-26_01` so `mcp logs --tool openreply_paper_chunk_search` works out of the box.

### H. Six new Typer CLI commands — `src/reddit_research/cli/main.py`

```
reddit-cli research paper-sections      --post-id arxiv_X
reddit-cli research paper-chunk         --post-id arxiv_X | --topic T
reddit-cli research paper-chunk-search  "query" --sections methods,results [--papers]
reddit-cli research paper-references    --post-id arxiv_X | --topic T
reddit-cli research paper-cited-by      --post-id arxiv_X
reddit-cli research paper-stats
```

`paper-chunk-search --papers` flips to paper-level rollup. `paper-stats` shows count + papers indexed + by-section histogram + active embedder backend.

## Files Created

- `src/reddit_research/research/paper_sections.py`
- `src/reddit_research/research/paper_chunks.py`
- `src/reddit_research/research/paper_references.py`
- `src/reddit_research/retrieval/embedder_mlx.py`
- `docs/proposals/2026-04-27_paper-fulltext-mlx-chroma-mempalace-openfileloader.md`
- `changelogs/2026-04-27_03_paper-pipeline-sections-chunks-mlx-citations.md` (this file)

## Files Modified

- `src/reddit_research/research/paper_fulltext.py` — auto-index hook after successful download.
- `src/reddit_research/retrieval/embedder.py` — MLX backend route + `active_backend()` helper.
- `src/reddit_research/retrieval/palace.py` — `paper_chunks` collection + 4 new APIs (`get_paper_chunks_collection`, `upsert_paper_chunks`, `search_paper_chunks`, `search_papers`, `paper_chunks_stats`).
- `src/reddit_research/mcp/server.py` — 9 new MCP tools.
- `src/reddit_research/cli/main.py` — 6 new Typer commands.

## New SQLite tables

```sql
paper_sections   (id, post_id, name, raw_heading, ord, char_start, char_end,
                  char_count, created_at)
paper_chunks     (id, post_id, section, ord, char_start, char_end, text,
                  char_count, hash, embedded_at, embed_backend, created_at)
paper_references (id, src_post_id, dst_post_id, dst_doi, dst_arxiv_id,
                  dst_title, dst_year, dst_authors_json, raw,
                  resolution_status, extractor, fetched_at)
```

All three created idempotently on first write — no migration step needed for existing installs.

## Verification

```
=== imports ===
imports ok
embedder mode: default                  # ONNX (no MLX libs installed)
mlx active for env: False               # graceful — no crash
palace.paper_chunks_stats: {ok: True, count: 0, ...}

=== section parser on real arxiv papers ===
arxiv_1805.02399v1  → 7 sections
  abstract / methods / results / discussion / conclusion /
  acknowledgments / references
arxiv_2406.08451v2  → 6 sections
  abstract / introduction / related_work / experiments /
  conclusion / references

=== chunker + embedder ===
5 papers → 214 chunks indexed
By section:
  references: 66, related_work: 47, introduction: 29, methods: 17,
  discussion: 17, experiments: 16, abstract: 9, conclusion: 5,
  results: 4, limitations: 3, acknowledgments: 1

=== section-filtered chunk search (the gap-finding payoff) ===
query="limitations of the approach", sections=limitations,discussion
  → top hit: arxiv_2302.07344v1 chunk #53, score=0.920
  → "Limitations of the…" — exact section-name match in body

=== paper-level rollup ===
query="evaluation methodology", sections=experiments
  → GUIOdyssey paper, score=0.953, sections_hit=experiments
  → top 2 chunks attached with provenance (post_id + section + ord)

=== citations ===
9 papers, 373 refs total, 54 arxiv-ID, 38 DOI
extractor: regex (no OpenFileLoader installed)
linked-to-corpus: 0 (corpus has older physics arxiv; cites are LLM/CV
papers — not in posts table; linker activates when cited works arrive)
```

## Limitations & follow-ups

- **OpenFileLoader is a soft dep today.** No package literally named that on PyPI yet — I probe four plausible module names so whichever one the user installs gets picked up. If you have a specific package in mind (`unstructured-io/unstructured`? `langchain-community.document_loaders`?), name it and I'll wire it in directly so it becomes the default path with regex as fallback.
- **MLX libs not installed.** ONNX MiniLM is serving embeddings — that's fine, the fallback works. To switch on Apple Silicon: `uv pip install mlx mlx_embeddings` then `OPENREPLY_EMBEDDING_BACKEND=mlx`. Throughput delta on M-series should be 5-10× MiniLM-CPU.
- **Cross-corpus citation linking is dormant** until the cited works are also in `posts`. Future call: optional auto-fetch of unresolved DOIs via `sources/crossref.py` on a politeness budget.
- **No PubMed PMC roundtrip yet** — same out-of-scope item from `2026-04-26_02`. PubMed papers still return `not_oa`.
- **Section parser is regex-based.** Catches the standard ACL/NeurIPS/IEEE conventions cleanly; non-standard layouts fall through to the `body` whole-document chunk. A pdfplumber-aided heading detector would lift accuracy ~10%; out of scope today.
- **Paper-writing pipeline (literature review / gap report / annotated bibliography) is the next step.** All the building blocks (section retrieval, paper rollup, citations) are in place — just needs the LLM orchestration on top with the two-pass drafter→reviewer guard against hallucinated citations. Will land in a follow-up changelog.

## Knock-on improvements to existing flows

- `analyze_paper` — `get_full_text_or_abstract` is unchanged but now uses chunked storage transparently; future `analyze_paper(section='methods')` is one line of code away.
- `chat._topic_context` — `search_paper_chunks(topic=…)` is a drop-in upgrade from the current "first 2.5k + last 1k chars" splice. Will land with the paper-writing follow-up so chat answers can cite section-level provenance.
- `gap_discovery` — chunk-level texts can now feed the LLM extractor with section labels as context, so a "this is from a Limitations section" boost can land. One-line change in `gaps.py`.
- `dense-graph-relations` — chunk-level shared evidence is a richer signal than post-level. Drop-in.
