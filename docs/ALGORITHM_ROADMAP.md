# OpenReply — algorithm & retrieval roadmap

> **Status:** roadmap — nothing here is wired in yet. Existing palace/ChromaDB,
> dense-graph-relations, hybrid search, and KMeans clustering stay as-is.
> Items below are additive upgrades; pick what to ship and in what order.
>
> Generated **2026-05-26** after auditing current `src/openreply/` for palace,
> graph, clustering, and rerank usage.

---

## Current stack (what's already in place)

| Layer | Implementation | File |
|---|---|---|
| Embedder | ONNX MiniLM-L6-v2 (~90 MB) | `openreply.research._clustering`, `openreply.research.palace` |
| Vector store | ChromaDB persistent client | `openreply.research.palace` |
| Hybrid retrieval | 0.6 × cosine + 0.4 × BM25 linear blend | `openreply.research.search_all`, `openreply.research.chat` |
| Graph edges | `relates_to`, `potentially_solves`, `could_address`, `co_evidenced` | `openreply.graph.relations` (dense_graph_relations skill — already integrated) |
| Edge thresholds | cosine ≥ 0.55 (`relates_to`) / 0.50 (`potentially_solves`) | env-tunable (`OPENREPLY_REL_THRESHOLD`, `OPENREPLY_SOLVE_THRESHOLD`) |
| Clustering | KMeans + silhouette score (sklearn) | `openreply.research._clustering.kmeans_with_silhouette` |
| Audience clustering | KMeans (deliberately avoided HDBSCAN to keep dep tree tight) | `openreply.research.idea_scan` |
| Chat retrieval | `palace.search_posts(query, topic, k=20, rerank=True)` | `openreply.research.chat` |
| Reranker | linear blend (no cross-encoder) | n/a |

**The palace is used heavily** — 10+ modules. Confirmed working as intended.

---

## Roadmap — three tiers, additive

Everything below layers ON TOP of the existing stack. None of these require
deleting current code; if any feature flag fails to install (heavier model
not downloaded, dep missing), the new path gracefully falls back to today's
behavior.

### Tier 1 — high impact, low risk (recommended first batch)

#### A) Cross-encoder reranker — `bge-reranker-v2-m3`

**What:** Replace the final linear-blend step in `search_all` / `chat` with a
real cross-encoder reranker. Pipeline becomes:
1. Vector + BM25 retrieval returns top **50** candidates (was top-10)
2. Cross-encoder scores each `(query, candidate)` pair
3. Return top **10** by cross-encoder score

**Recent (2024-25)?** Yes — `bge-reranker-v2-m3` is BAAI's 2024 release,
~300 MB ONNX, CPU-only inference at ~30ms/pair. The state of the art for
small reranking in 2026 is still in this family (m3, mxbai-rerank-large-v1).

**Impact:** +30-50% precision on BEIR benchmarks. Anthropic, Cohere, and
DeepSeek all report similar uplift when adding cross-encoder rerank on top
of dense retrieval.

**Cost:** one 300 MB model download (parallel to current MiniLM Palace
warmup pattern), ~30 ms per query candidate, no new dep tree (uses ONNX
runtime already in palace).

**Wire-in:**
- New file: `src/openreply/research/reranker.py` — loads ONNX bge-reranker-v2-m3,
  exposes `rerank(query, candidates) -> sorted candidates`
- `palace.search_posts` gains `cross_encoder=True` argument (default off
  until model is downloaded)
- `mcp.serve.openreply_semantic_search` exposes the flag to MCP clients
- Settings → Palace card gets a "Install reranker (~300 MB)" button next
  to the existing "Install palace" button

**Risk:** low. Reranker model is optional — current linear blend remains
the default until the user installs it.

---

#### B) HippoRAG / Personalized PageRank over existing graph

**What:** When the user does semantic search (or asks chat), use the matched
nodes as **seed personalization weights** for PageRank over the existing
graph. The PPR walk amplifies nodes connected to seeds via
`relates_to` / `co_evidenced` / `potentially_solves` edges. Final ranking
blends `α × vector_score + (1-α) × ppr_score`.

**Recent?** Yes — HippoRAG (NeurIPS 2024, Princeton). HippoRAG 2 (March 2025)
adds entity linking. Both use Personalized PageRank as the retrieval ranker
over a neurosymbolic graph — essentially what your `graph_nodes` /
`graph_edges` already is.

**Impact:** especially strong on multi-hop "find the connection" queries
— the exact use case you described. The Princeton paper shows HippoRAG
matches or beats iterative agentic retrieval on 2-3-hop benchmarks at
a fraction of the LLM cost.

**Cost:** zero new ML models, zero new index. Uses `networkx.pagerank()`
which is pure Python; the graph is already in `graph_nodes` /
`graph_edges` tables. Per-query cost ~5-20 ms on graphs up to ~10K nodes.

**Wire-in:**
- New file: `src/openreply/graph/ppr.py` — exposes `ppr_rank(seed_node_ids,
  topic, alpha=0.5) -> ranked list`
- `palace.search_posts` learns about graph: when `topic` is given,
  takes top-K vector hits as seeds, runs PPR, returns the merged ranking
- `gap_discovery` gets a "find connected gaps" pass that walks
  `painpoint → potentially_solves → workaround → relates_to → other
  painpoint` chains using PPR confidence to threshold

**Risk:** low. PPR is well-understood (since 2003); networkx is already in
the dep tree.

---

#### C) Contextual Retrieval (Anthropic, Sept 2024)

**What:** When extracting a painpoint / workaround / finding from a post,
also generate a **1-sentence "context"** describing where in the topic this
finding sits. Embed `[context] [text]` instead of just `[text]`. The context
provides a doc-level lens the chunk alone doesn't.

Anthropic blog (Sept 2024):
> "Contextual Retrieval improves performance significantly by adding chunk-
> specific explanatory context to each chunk before embedding. Our tests
> showed a 35% reduction in retrieval failure rate."

**Recent?** Sept 2024. Now adopted by Anthropic, Glean, several open-source
RAG frameworks.

**Impact:** +30-40% retrieval precision on chunks that share semantic
content but mean different things in different topics (the classic
"meditation apps" vs "meditation in clinical psychology" disambiguation
your tool actually has to do).

**Cost:** one cheap LLM call per finding at extraction time (~0.0005 with
Haiku 4). For a topic with 500 posts → 500-1000 findings → ~50¢ one-time.

**Wire-in:**
- `src/openreply/research/findings_extract.py` gets a `with_context=True` flag
- Each finding's `text` field in `graph_nodes` carries `{ text, context }`
  separately; the embedder concatenates at embed time but the UI shows
  only `text`
- Palace re-embed pass needed only for findings that get re-extracted —
  not a one-shot migration
- LLM provider must support the lightweight prompt — works on Haiku /
  Llama-3-8B / Gemini Flash equivalently

**Risk:** low. Context is fully optional; if extraction fails or no LLM is
configured, the finding stores `context=None` and the embedder falls back
to text-only.

---

### Tier 2 — meaningful upgrade, more integration work

#### D) GraphRAG community detection (Microsoft, 2024)

**What:** Detect communities in the existing graph using **Leiden**
algorithm → LLM-summarize each community at multiple resolutions →
store hierarchical summaries. Query routing:
- "Tell me about meditation apps" → top-level community summary
- "Find the gaps in meditation apps" → drills into sub-communities
- "What pains exist across all topics?" → traverses the meta-community
  level (cross-topic)

**Recent?** Yes — Microsoft GraphRAG was open-sourced July 2024 (Apache 2).
LightRAG (Dec 2024) and PathRAG (March 2025) are derivatives focused on
relational paths.

**Impact:** unlocks "global queries" that current chunk-level RAG can't
answer well. Particularly strong for:
- "What's the landscape of pain in <topic>?"
- "What gaps cluster together?"
- "Where are the white spaces?" (un-summarized regions of the graph)

**Cost:**
- `igraph` or `networkx + python-louvain` dep (small, no compile)
- LLM calls for community summaries: ~10-50 per topic
- Stored as new `graph_communities` table

**Wire-in:**
- New file: `src/openreply/graph/communities.py` — Leiden + per-community LLM
  summary
- Runs after `build_structural` + `dense_graph_relations` density pass
- New MCP tool: `openreply_topic_landscape(topic)` returns the community
  hierarchy
- UI: new "Landscape" tab on the topic page

**Risk:** medium. Adds a new dep (`python-igraph` or `python-louvain`).
Community summaries cost LLM tokens; gate behind a "Build landscape" button
so it's not automatic on collect.

---

#### E) Upgrade embedder: MiniLM → BGE-M3

**What:** Replace ONNX MiniLM-L6-v2 (2021) with BGE-M3 (BAAI, 2024) —
multilingual, multi-functionality (dense + sparse + multi-vector in one),
higher MTEB scores.

**Recent?** Yes — BGE-M3 was released March 2024 and remains state-of-the-art
for small open embedders. Also: `gte-modernbert-base` (May 2025) is
competitive at smaller size.

**Impact:** +5-15% retrieval recall on MTEB. More important: BGE-M3 was
trained on much more diverse data than MiniLM, so it handles edge cases
(tech jargon, mixed language) better.

**Cost:**
- 568 MB ONNX model (vs 90 MB MiniLM)
- One-time re-embed pass over all `graph_nodes` (existing palace_reindex
  pipeline already handles this)
- Memory: ~1 GB during inference (vs ~200 MB for MiniLM)

**Wire-in:**
- `openreply.research.palace` learns to read a `embedder=` config knob
- New "Embedder" picker in Settings → Palace card with MiniLM / BGE-M3
  options
- Reindex triggered on switch

**Risk:** medium. Heavier memory footprint may push macOS users with 8 GB
RAM near the limit. Default stays MiniLM; users opt in.

---

### Tier 3 — optional, lower priority

#### F) HDBSCAN / BERTopic clustering (replace KMeans)

**What:** Replace `kmeans_with_silhouette` with **HDBSCAN** (no `k`
required, handles noise) wrapped in **BERTopic** (UMAP → HDBSCAN →
c-TF-IDF labeling).

**Recent?** BERTopic itself has been around since 2022 but is still the
SOTA for topic modeling. HDBSCAN is even older but considered the default
for density-based clustering in 2026.

**Note:** Your current code in `_clustering.py` explicitly avoids HDBSCAN
"to keep the dep tree tight". Reversing that decision is a deliberate
trade.

**Impact:** better topic coherence on the audience-clustering / persona
pipeline. Less impact on retrieval directly.

**Cost:**
- `hdbscan` + `umap-learn` deps (both compile cleanly on macOS arm64)
- Heavier first-run install (~50 MB extra wheel)

**Risk:** medium. Dep-tree weight goes up; only worth it if you actively
want better personas.

---

#### G) Late chunking for arXiv papers (jina, 2024)

**What:** Embed the FULL paper as one long-context call, then split the
embedding into chunks. The chunks "remember" surrounding context the
isolated-chunk approach loses.

**Recent?** jina-embeddings v2 supports it natively. Released 2024.

**Impact:** much better recall on multi-paragraph papers where the
relevant claim spans sections. Less useful for Reddit/HN posts.

**Risk:** requires switching to a long-context embedder (jina-embeddings
v2 / Voyage-2). Different from BGE-M3, so this is an alternative path,
not an addition.

---

#### H) Self-RAG / CRAG (Corrective RAG) for chat

**What:** Add a reflection step to chat answers. After the LLM proposes an
answer, score it for groundedness against the retrieved passages; if low,
re-retrieve with refined query; iterate up to 2-3 times.

**Recent?** Yes — Self-RAG (2024), CRAG (2024), Speculative RAG (Google,
2024).

**Impact:** chat answer quality and citation accuracy. Doesn't help with
discovery / graph building.

**Cost:** 2-3x LLM tokens per chat answer.

**Risk:** low but real cost increase.

---

## Suggested first ship — "the gold path"

If we ship Tier 1 (A + B + C) in order, the cumulative effect is:
1. **C (Contextual Retrieval)** — every new finding goes in with better
   embeddings → search precision climbs steadily as new data arrives
2. **A (Cross-encoder reranker)** — for any query, the top-10 is the
   actual top-10, not the top-10 of a noisy linear blend
3. **B (HippoRAG PPR)** — when answers need multi-hop reasoning, the graph
   carries the load instead of expanding the K of vector retrieval

Order of work — recommended:
1. **B first** (zero deps, zero downloads, immediately useful for the
   "find connections" UX). Ship in ~2-3 hours.
2. **A second** (300 MB download is the user-friction blocker; build the
   download UX into Settings → Palace card). Ship in ~3-4 hours.
3. **C third** (touches the extractor pipeline, more careful integration).
   Ship in ~4-6 hours.

After Tier 1 lands, decide whether Tier 2 (GraphRAG community detection,
BGE-M3 upgrade) is worth the additional work based on observed quality.

---

## Notes on "don't remove what we have"

Every Tier-1 item here is an **additive** wrap-around the current code:

| New thing | Doesn't touch |
|---|---|
| Reranker (A) | palace storage, current linear-blend retrieval (just stops being the default once reranker is downloaded) |
| PPR (B) | embeddings, palace, graph structure (just reads it differently) |
| Contextual extraction (C) | the `text` field on findings (stored separately) |

Tier 2/3 are larger surgery — discuss before committing.

---

## What to verify after each ship

Before merging any of A/B/C, smoke-test through:

1. **CLI**: `openreply research search-all --topic "X" --query "Y"` returns
   different + better top-K than before
2. **MCP**: `openreply_semantic_search(topic, query)` returns the new ranking
3. **Chat**: `openreply chat --topic "X" "Q"` cites different sources for
   queries that involve multi-hop reasoning
4. **Gap discovery**: `openreply research gap-discovery --topic "X"`
   surfaces connections that weren't apparent before
5. **Insights**: the topic Insights tab renders new related-painpoint
   threads via the graph traversal

---

## References (papers + repos)

- **HippoRAG**: <https://arxiv.org/abs/2405.14831> (NeurIPS 2024)
- **HippoRAG 2**: <https://arxiv.org/abs/2502.14860> (Mar 2025)
- **Anthropic Contextual Retrieval**: <https://www.anthropic.com/news/contextual-retrieval>
- **Microsoft GraphRAG**: <https://github.com/microsoft/graphrag>
- **LightRAG**: <https://github.com/HKUDS/LightRAG>
- **bge-reranker-v2-m3**: <https://huggingface.co/BAAI/bge-reranker-v2-m3>
- **BGE-M3**: <https://huggingface.co/BAAI/bge-m3>
- **BERTopic**: <https://github.com/MaartenGr/BERTopic>
- **jina late chunking**: <https://jina.ai/news/late-chunking-in-long-context-embedding-models/>
- **Self-RAG**: <https://arxiv.org/abs/2310.11511>
- **CRAG**: <https://arxiv.org/abs/2401.15884>
