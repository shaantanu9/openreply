# Paper & Multi-Source Research — How Fetching Works (and How to Port It)

> **Date:** 2026-06-13 · **Status:** Reference architecture (reflects code on branch `multi-source`)
> **Scope:** How OpenReply (`reddit-myind`) searches research papers and every other
> external source, the contract that ties them together, and the exact recipe to
> lift this pattern into another app/MCP.
> **Companion docs:** `docs/specs/SOURCE_ADDITION_PLAYBOOK.md` (add-a-source mechanics),
> skill `paper-research-mcp-toolkit` (battle-tested portable toolkit).

---

## 0. TL;DR — the one idea

**Every source — a research paper, a Reddit post, an App Store review, a news
article — is fetched by its own tiny module and returned in the *same* `posts`
row dict.** Because the shape is identical, dedup, the SQLite store, the vector
"palace", the knowledge graph, sentiment, and LLM analysis all work on any
source with **zero per-source code paths**.

```
fetch_<source>(query, limit) ─► list[ posts-row dict ] ─► dedup ─► upsert_posts()
                                                                      │
                       ┌──────────────────────────────────────────────┤
                       ▼                  ▼                ▼            ▼
                 vector palace        graph build     sentiment   LLM analysis
                 (ChromaDB/ONNX)      (nodes/edges)   (per-source) (tier+claims)
```

The "paper research" feature is just this pipeline pointed at the **6 academic
sources**, plus a citation-graph layer (forward/backward references) and a
full-text → chunk → analyze stage that generic web sources don't need.

---

## 1. Directory map (where everything lives)

| Path | Role |
|---|---|
| `src/openreply/sources/*.py` | **One module per source.** ~50 sources. Each exposes `fetch_<name>(query, limit, …) -> list[dict]`. |
| `src/openreply/sources/_http.py` | Shared HTTP client: `polite_get()`, `DEFAULT_HEADERS`, `USER_AGENT`, Retry-After (429) handling. |
| `src/openreply/sources/__init__.py` | Source registry — imports + `__all__`; docstring lists zero-config vs key-gated. |
| `src/openreply/sources/collect_adapter.py` | `run_<name>()` collector wrappers + the **`SOURCES`** dispatch dict (`{name: run_fn}`, 64 sources) — keyword expansion + logging + `upsert_posts` via `_run_simple_list`. |
| `src/openreply/research/collect.py` | The collect orchestrator — takes a `sources=[...]` list, validates each against `SOURCES`, and runs them in a thread pool (`collect.py:760`). |
| `src/openreply/sources/source_families.py` | Collapses fine-grained subtypes (`youtube_transcript`) into coarse families. |
| `src/openreply/research/sources.py` | **`ACADEMIC_SOURCES`** — the single source of truth for "which source_types are papers". |
| `src/openreply/research/paper_pipeline.py` | `run_paper_research()` — the one-call search→rank→fulltext→chunk→analyze orchestrator. |
| `src/openreply/research/paper_analyze.py` | LLM analysis (`analyze_paper`, `analyze_papers_bulk`) — summary/claims/tier. |
| `src/openreply/research/paper_fulltext.py` | PDF/full-text fetch (`get_full_text`). |
| `src/openreply/research/paper_chunks.py` | Chunk + embed full text & abstracts into the vector palace. |
| `src/openreply/research/paper_citations.py` / `paper_references.py` / `paper_relations.py` | Citation-graph edges (paper→paper `cites`). |
| `src/openreply/research/paper_gaps.py` | Literature-gap detector (open-problem finder). |
| `src/openreply/mcp/server.py` | Registers every fetch/paper tool as an MCP tool (`openreply_fetch_*`, `openreply_paper_*`). |
| `src/openreply/cli/main.py` | CLI surface (`openreply research papers …`, source dispatch). |

---

## 2. The contract: the common `posts` row

Every fetcher returns a `list[dict]`, each dict in **exactly** this shape. This
is the keystone — get this right and everything downstream is free.

```python
{
    "id":           f"{source_type}_{native_id}",  # globally unique across sources
    "sub":          "arxiv",                        # source-ish bucket label
    "source_type":  "arxiv",                        # stable filter id (drives ACADEMIC_SOURCES)
    "author":       "First Last, Second Last, …",   # top-4 authors joined, or "[unknown]"
    "title":        "Title  — Venue",               # ≤300 chars
    "selftext":     "abstract or TLDR",             # ≤2000 chars — THIS is the embed text
    "url":          "OA PDF > DOI > landing page",  # the real clickable link
    "score":        173357,                          # ← CITATION COUNT (ranking signal)
    "upvote_ratio": 0.42,                            # influential/total citation ratio (S2 only)
    "num_comments": 88,                              # reference count OR influential citations
    "created_utc":  1592180000.0,                    # publication year → unix ts
    "is_self":      1,
    "over_18":      0,
    "flair":        "cites=173357 · influential=88", # metadata badge for the UI
    "permalink":    None,                            # None for non-Reddit (else frontend breaks the link)
    "fetched_at":   "2026-06-13T17:00:00+00:00",     # iso8601
}
```

### Three load-bearing conventions

1. **`score` = citation count.** Because the rest of the app sorts posts by
   `score` (it was built for Reddit upvotes), papers automatically rank by
   citation influence in every report, `ORDER BY score DESC` query, and graph
   PageRank — *no extra ranking code*. See `semantic_scholar.py:_row` and
   `crossref.py:_row`.
2. **`selftext` is the embed text.** The abstract (or S2 TLDR fallback) goes
   here; the vector store embeds `selftext`, so semantic search over papers
   works the moment a row is upserted.
3. **`permalink=None` for non-Reddit sources.** The frontend prepends
   `reddit.com` to `permalink`; a non-empty value yields a broken link. Put the
   real URL in `url`. (Playbook Step 1.)

---

## 3. The shared HTTP layer (`sources/_http.py`)

One place to be polite to every API:

- `USER_AGENT = "openreply/0.1 (+<repo>; mailto:<contact>)"` — built from
  `core.identity` so the contact/repo is a single source of truth. Many science
  APIs (arXiv, PubMed, OpenAlex polite pool) reward or require a real UA + mailto.
- `DEFAULT_HEADERS` — UA + `Accept-Encoding`.
- `polite_get(url, params, headers, timeout)` — `httpx.get` with the defaults
  baked in **plus** automatic `Retry-After` handling on a `429` (sleeps the
  header value, capped at 15 s, retries once).
- `DEFAULT_TIMEOUT = 20.0` — long enough for slow science APIs, short enough
  that a hung server surfaces instead of wedging the collect.

When an API tightens its policy, the fix is one edit here and every adapter
benefits.

---

## 4. The 6 academic sources (the "paper" half)

`research/sources.py` defines the canonical set — **always gate paper logic off
`is_academic_source()`, never a per-call literal** (a literal drifts and
silently drops sources — a real bug we hit, see §9):

```python
ACADEMIC_SOURCES = frozenset(
    {"arxiv", "pubmed", "openalex", "scholar", "semantic_scholar", "crossref", "europepmc"}
)
```

| Source | Module | Best for | Key? | Rate-limit hack |
|---|---|---|---|---|
| **arXiv** | `sources/arxiv.py` | CS/ML/physics preprints (cutting edge, pre-peer-review) | no | none needed |
| **PubMed** | `sources/pubmed.py` | Biomedical / clinical / psych / nursing | no | `tool=` + `email=` params |
| **OpenAlex** | `sources/openalex.py` | 250M cross-discipline works, open metadata | no | `mailto=` polite pool |
| **Semantic Scholar** | `sources/semantic_scholar.py` | **Citation graph**, TLDR, influential-citation metric | no | `S2_API_KEY` env → 5000/5min vs 100/5min |
| **Crossref** | `sources/crossref.py` | Authoritative DOI record, funder/grant info, reference lists | no | `CROSSREF_MAILTO` polite pool |
| **Google Scholar** | `sources/scholar.py` | Cross-discipline, citation counts (scraped) | no | scrape politely; flaky → never block on it |
| **Europe PMC** | `sources/europepmc.py` | Biomed mirror, sometimes has abstracts PubMed lacks | no | none |

**Rule of thumb: always cross-search multiple sources in parallel and dedup by
`id`.** Each has different coverage gaps. arXiv parses Atom XML by regex
(`arxiv.py:_parse_atom`); the others parse JSON. All five JSON sources share the
same `_row()` mapping idiom (see `semantic_scholar.py:_row:44`,
`crossref.py:_row`).

### Citation-graph traversal (what plain search can't do)

Semantic Scholar is the free citation-graph API. From `sources/semantic_scholar.py`:

- `fetch_citations(paper_id, limit)` — **forward**: "who cited this?" Returns
  row-shaped papers ready to upsert.
- `fetch_references(paper_id, limit)` — **backward**: "what does this cite?"
- `fetch_reference_ids(paper_id)` — lightweight id rows (`paperId/doi/arxiv/pmid`)
  used to build paper→paper `cites` edges against the in-corpus papers.
- `fetch_abstract(paper_id)` — backfill a title-only paper's abstract.

Accepts `s2_<id>`, bare DOI (`10.xxxx/yy`), or arXiv (`ARXIV:2310.12345`). The
unauthenticated quota is tiny — `fetch_reference_ids` honours `Retry-After` with
a capped single retry (set `S2_API_KEY` for any sizeable run).

---

## 5. The orchestrator: `run_paper_research()`

`research/paper_pipeline.py:32` is the **one synchronous call** that does
everything. It's shared by the MCP tool *and* the chat agent's
`fetch_more_papers` tool so there's exactly one code path.

```
run_paper_research(topic, query, limit_per_source=5, max_fulltext=3,
                   year_from=None, sources=None)
```

Stages (all fail-soft — one stage erroring never aborts the rest; errors are
collected into a returned `errors` dict):

1. **SEARCH** — all 6 sources run in parallel via `ThreadPoolExecutor(max_workers=6)`
   (`paper_pipeline.py:75`). Each runner is `lambda: fetch_<src>(query=q, limit=…)`.
2. **DEDUP** — first-seen wins, keyed by `id` (`paper_pipeline.py:90`).
3. **PERSIST** — `upsert_posts(unique)` into SQLite, then tag every row into
   `topic_posts` (`topic`, `post_id`, `source`, `added_at`).
4. **RANK** — `sorted(unique, key=score desc)`; take top `max_fulltext`.
5. **FULLTEXT** — `paper_fulltext.get_full_text(post_id)` for the top-ranked
   papers (PDF → text).
6. **CHUNK + EMBED** — `paper_chunks.chunk_paper(post_id, embed=True)` for papers
   that got full text. Skipped wholesale if the vector palace backend is
   unavailable (`palace.is_available()`), so a missing embed backend never
   crashes the pipeline.
7. **ABSTRACT FALLBACK** — most papers are paywalled (no OA full text), so
   `chunk_abstracts_all(topic)` embeds *every other* paper's abstract as a single
   chunk. Result: the whole corpus is chat-able and relatable, not just the
   handful with full text.
8. **ANALYZE** — `paper_analyze.analyze_paper(topic, post_id)` runs the LLM for
   each top paper (summary / relevance / takeaway / tier).

Returns: `{ok, topic, query, search_total, by_source, fulltext_fetched,
fulltext_ok, papers_chunked, abstracts_chunked, analyzed, analyses[…], errors}`.

The MCP wrapper `openreply_paper_research_pipeline` (`mcp/server.py:2208`) only adds
a 120 s wall-clock ceiling (`_run_with_timeout`) and an async hint.

---

## 6. LLM paper analysis (`research/paper_analyze.py`)

Raw metadata is half the deliverable. `analyze_paper(topic, post_id, force=False)`:

- Returns cached analysis from the `paper_analyses` table (keyed by `post_id`)
  unless `force=True`.
- Otherwise loads the paper row, prompts the LLM with title + abstract, parses
  JSON, and writes `{summary, claims, methods, tier, relevance, caveats}`.
- **Skip-stub on missing LLM provider** (BYOK) — returns `{ok, skipped, reason}`
  instead of crashing.

The **`tier`** field (meta-analysis / RCT / systematic-review / cohort /
observational / case-study / expert-opinion / anecdote) is what turns a search
engine into a research tool — it drives UI chip colors and weights downstream
ranking so high-tier evidence dominates. `analyze_papers_bulk(topic, limit,
force)` runs it for every academic-source paper in the topic, ordered by
citations.

---

## 7. The MCP surface (`mcp/server.py`)

Each fetcher is exposed as a thin MCP tool the LLM/UI calls. Line references on
branch `multi-source`:

```
# Per-source fetch (row-shaped, no persist):
openreply_fetch_scholar             server.py:812
openreply_fetch_arxiv               server.py:846
openreply_fetch_openalex            server.py:854
openreply_fetch_pubmed              server.py:862
openreply_fetch_semantic_scholar    server.py:877
openreply_fetch_crossref            server.py:918
openreply_fetch_by_doi              server.py:937   # one-shot canonical DOI lookup

# Citation graph:
openreply_paper_citations           server.py:995   # forward — who cites ONE paper (paper_id)
openreply_paper_references          server.py:1005  # backward — what ONE paper cites
openreply_paper_citation_graph      server.py:1610  # topic-wide — build paper_cites edges for the map
openreply_paper_extract_refs        server.py:1627
openreply_paper_local_refs          server.py:1654
openreply_paper_cited_by            server.py:1669

# Full text / chunks / sections:
openreply_paper_fulltext            server.py:1048
openreply_paper_fulltext_status     server.py:1083
openreply_paper_sections            server.py:1095
openreply_paper_chunk               server.py:1133
openreply_paper_chunk_search        server.py:1149
openreply_paper_search_papers       server.py:1173
openreply_paper_chunks_stats        server.py:1583

# Analysis:
openreply_analyze_paper             server.py:1592
openreply_analyze_papers_bulk       server.py:1635
openreply_paper_analyses            server.py:1673

# Write-up / knowledge build:
openreply_paper_outline_generate    server.py:1769
openreply_paper_draft_generate      server.py:1776
openreply_paper_knowledge_build     server.py:1799
openreply_paper_gaps                server.py:1819
openreply_paper_relations_build     server.py:1835
openreply_paper_export_with_citations server.py:1847

# The centrepiece:
openreply_paper_research_pipeline   server.py:2208  # search→rank→fulltext→analyze→store
openreply_papers_for_topic          server.py:2290  # fast read of analyzed papers (no LLM)
```

A typical literature review is **3 MCP calls**:
`openreply_paper_research_pipeline(topic)` → `openreply_paper_search_papers(…)` to
drill in → `openreply_analyze_papers_bulk(topic)` to extract claims.

---

## 8. The CLI surface (`cli/main.py`)

- `openreply research papers --topic … --sources arxiv,pubmed,…` — source subset
  help at `cli/main.py:3733`; default subset
  `arxiv,openalex,semantic_scholar,scholar` at `:3880`.
- `openreply research paper-fulltext --post-id arxiv_2403.12345 --show` (`:3906`).
- Collect dispatch source list at `cli/main.py:1315`; `--skip-reddit` to top up a
  topic with only external sources at `:1341`.

---

## 9. Gotchas (battle-tested — check these in any port)

| Symptom | Root cause | Fix |
|---|---|---|
| Papers from a source silently never summarized | A per-call academic-source literal (`("arxiv","openalex","pubmed","scholar")`) drifted, missing `semantic_scholar`/`crossref` | Use the canonical `is_academic_source()` everywhere |
| `str - int` crash in temporal gap histogram | A `_year()` helper returned a string | Coerce year to `int` before arithmetic |
| Duplicate papers across sources | Same preprint on arXiv + OpenAlex, different ids | Dedup by `id` first-seen; hash(title) for fuzzy |
| Crossref abstract full of `<jats:p>` tags | Crossref stores JATS XML | Strip `<[^>]+>` before storing/embedding (done in `crossref.py:_row`) |
| S2 rate-limits fast | No key → 100/5min | Free `S2_API_KEY` env |
| `score=0` for new preprints | No citations yet | Accept it; secondary-sort by recency |
| Paper not in vector store after fetch | Embed backend not ready in that process | Guard on `palace.is_available()`; abstract-fallback covers the rest |
| Broken post link in UI | Non-empty `permalink` on a non-Reddit row | `permalink=None`, real link in `url` |
| Google Scholar 429s | Aggressive scrape, no proxy | Back off; treat as optional; never block the collect on it |

**Don't:** build one combined fetch fn that returns source-tagged rows
internally (keep per-source modules); store full PDFs in the DB (store URL,
fetch on demand); skip the `tier` field; call sources synchronously
(parallelise — 6 × 1–5 s serialised is 30 s of dead time).

---

## 10. Porting recipe — add this to another app/MCP

The portable kit = `_http.py` + the 6 paper `sources/*.py` + `research/sources.py`
+ the `run_paper_research` orchestrator + `analyze_paper`. Two paths:

### Path A — your app already has a corpus layer (vector store / graph / LLM)
**Stay merged.** Drop in the source modules, keep the `posts`-row contract, and
papers flow through your existing dedup/vector/graph/analysis for free. This is
the "fusion" moat (paper science + user-pain/market signal in one store).

### Path B — fresh app
1. **`sources/_http.py`** — copy verbatim; swap the UA contact string.
2. **6 source modules** — copy `arxiv/pubmed/openalex/semantic_scholar/crossref/
   scholar.py`. They depend only on `httpx` + `_http.py`.
3. **`research/sources.py`** — the `ACADEMIC_SOURCES` gate.
4. **Orchestrator** — copy `run_paper_research()`; replace `upsert_posts` /
   `get_db` / `topic_posts` with your persistence, and the palace calls with
   your vector store (or stub them — the pipeline is fail-soft without them).
5. **`analyze_paper`** — copy; point `_llm_paper_call` at your LLM provider;
   keep the cache table + skip-stub-on-missing-provider behaviour.
6. **Expose tools** — register `fetch_<src>` + `research_papers` + `analyze_*` as
   MCP tools (mirror `mcp/server.py`) or CLI commands.

### The 6-file "add ONE new source" recipe (from `SOURCE_ADDITION_PLAYBOOK.md`)
1. `sources/<name>.py` — `fetch_<name>(query, limit) -> list[dict]` (never raises).
2. `sources/__init__.py` — `from .<name> import fetch_<name>` + add to `__all__`.
3. `sources/collect_adapter.py` — **two edits**: (a) define a `run_<name>(topic_or_keywords, limit)` wrapper that calls `_run_simple_list(topic, "<name>", fetch_<name>, limit)`; (b) register it in the **`SOURCES`** dict (`"<name>": run_<name>`). *This is the actual convention — there is no `collect_<name>`.* Skipping the `SOURCES` entry means the collect orchestrator can't dispatch it.
4. `mcp/server.py` — add a `@mcp.tool() openreply_fetch_<name>` wrapper (ad-hoc preview) *and* it's automatically collectable via `openreply_collect` once it's in `SOURCES`.
5. `cli/main.py` — add `<name>` to the `--sources` help string (`:1315`).
6. `pyproject.toml` — deps (keep pure-`httpx`; native libs bloat a sidecar DMG).
7. *(only if new source FAMILY)* — `source_families.py` + JS `postLink.js`.

**Acceptance per source:** `fetch_<name>("test")` returns rows or `[]` (never
raises) · `<name>` is a key in `collect_adapter.SOURCES` · rows land in `posts`
after a collect with `sources=["<name>"]` · `openreply_fetch_<name>` callable via MCP.

### Split-or-merge call
Stay merged while the value is the *fusion* and usage is undifferentiated. Split
into a dedicated paper tool only when telemetry shows paper-research is ≥30% of
sessions, the audience wants paper-specific UX (Zotero sync, DOI-first,
reference-manager export), or the merged brand actively repels academics. Don't
pre-split — the fusion is the moat.

---

## 11. Quick reference — call flow for "research papers on X"

```
User / Claude
   │  openreply_paper_research_pipeline(topic="X")
   ▼
run_paper_research()                              research/paper_pipeline.py:32
   │  ThreadPoolExecutor → fetch_arxiv / fetch_pubmed / fetch_openalex /
   │                       fetch_semantic_scholar / fetch_crossref / fetch_scholar
   ▼  (each returns posts-row dicts via sources/<name>.py + _http.polite_get)
dedup by id → upsert_posts() → tag topic_posts
   ▼
rank by score (=citations) → get_full_text(top N)  research/paper_fulltext.py
   ▼
chunk_paper + chunk_abstracts_all (embed)          research/paper_chunks.py
   ▼
analyze_paper(topic, post_id) per top paper        research/paper_analyze.py
   ▼
{search_total, by_source, analyzed, analyses[…], errors}
```

---

## 12. Wiring audit — 2026-06-13 (branch `multi-source`)

Verified the full 64-source matrix across every layer. Status:

- **64 sources** in `collect_adapter.SOURCES` — all import cleanly, all
  dispatch to a callable `run_<name>` collector.
- **Adding (collect) — ✅ fully wired** for every source, including the 8
  recently-added social/prediction sources (`polymarket`, `digg`,
  `truthsocial`, `tiktok`, `instagram`, `threads`, `pinterest`, `x`). They run
  via `collect(sources=[...])` / the `openreply_collect` MCP tool / CLI `--sources`.
- **Search — ✅** the corpus is searchable via `openreply_search` (Reddit),
  `openreply_semantic_search`, and `openreply_query_db` regardless of source.
- **Per-source ad-hoc MCP fetch tools — ✅ closed this pass.** Added 11 missing
  `openreply_fetch_*` tools (`polymarket, truthsocial, digg, tiktok, instagram,
  threads, pinterest, x, steam, dblp, europepmc`) at `mcp/server.py` so each
  source can be previewed without a full collect. Server imports clean; 51
  `openreply_fetch_*` tools total.
- **Smoke test:** `fetch_arxiv("transformer attention")` → 3 rows, posts-shape
  valid, `score` carries citations. `SOURCES` resolves all 8 new social sources.

**Resolved (2026-06-14):** `openreply_paper_citations` was previously defined twice
in `mcp/server.py` — once for single-paper forward citations (`paper_id, limit`)
and once for the topic-wide citation-graph build (`topic, limit`) — so FastMCP
logged `Component already exists: tool:openreply_paper_citations` and the second
registration silently shadowed the first, leaving the single-paper tool
unreachable. The topic-wide builder is now `openreply_paper_citation_graph`
(`server.py:1610`); the single-paper tool keeps the documented
`openreply_paper_citations` name (`server.py:995`). Server now imports with zero
duplicate-component warnings.
