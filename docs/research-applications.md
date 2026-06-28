# Research-driven upgrades — living log

**Started:** 2026-04-19
**Owner:** Shantanu
**Scope:** This is a running ledger. Every time a paper, blog post, or external finding suggests a concrete upgrade to OpenReply (the product) or its desktop app (the engineering), it gets a new entry here.

## How to read this doc

Each entry follows a **5-slot template** so that any new research finding slots in the same way. Do not free-form — fill every slot or mark it `n/a`.

```
### Finding NN — <Title> (Source · Year)

**One-line idea:**
**Why relevant:**

#### What we have today (code-verified)
- Product (OpenReply user-facing):  …
- App / engineering (Tauri + sidecar):  …

#### What this finding improves
- …  (bullet per measurable improvement — accuracy / UX / cost / latency)

#### What we can build for OpenReply (product upgrades)
- 🎯 …   (product-visible features, with file/screen pointer)

#### What we can build for the app (engineering upgrades)
- 🛠 …   (internal infra, not user-facing)

#### Effort / priority / status
- Effort:  S / M / L
- Priority:  P0 / P1 / P2 / roadmap
- Status:  idea · spiked · shipped
- Closes:  <link into self-gap-analysis.md / product-roadmap.md>
```

---

## Finding 01 — Attention Is All You Need (Vaswani et al., 2017, arXiv:1706.03762)

**One-line idea:** Sequence transduction using only stacked multi-head self-attention + positional encodings — no recurrence, no convolution. Foundation of every modern transformer embedding model (BERT, MiniLM, E5, GTE, …).
**Why relevant:** OpenReply already uses LLMs (downstream of this paper) for extraction. The *upstream primitives* — token embeddings, self-attention as a retrieval mechanism, positional encoding — are tools we have not yet plugged into our own pipeline. Every gap flagged 🔴 in `docs/self-gap-analysis.md` (near-dup merging, emergent clustering, cross-source semantic links) is solvable with a sentence-transformer — which **is** this paper, six years later.

### What we have today (code-verified)

**Product (OpenReply user-facing):**
- `src/reddit_research/research/` — 4 rigid LLM extractors (painpoints / features / competitors / DIY) driven by `prompts/*.yaml`. One LLM call per category per chunk.
- `src/reddit_research/retrieval/` + `app-tauri/src/screens/find.js` — ONNX embedding-based local semantic search ("Retrieval Palace"), opt-in download on user consent (see `61d676a feat(palace): hybrid opt-in`).
- `src/reddit_research/research/discover.py` — LLM-backed topic canonicalization with SQLite cache (`8514e45`).
- Temporal classifier CHRONIC / EMERGING / FADING — **rule-based** (pre/post May-2025 row counts), not embedding-based.
- Graph edges — **structural** (this post is evidence for this painpoint because the LLM said so), no semantic similarity yet.
- Chat tab — uses `openreply_graph_top_nodes` + `openreply_graph_neighbors` for context assembly. No vector retrieval in the loop.

**App / engineering (Tauri + sidecar):**
- ONNX runtime already packaged via the Retrieval Palace.
- ChromaDB available as optional dependency for embedding storage.
- `find.js` already wires a search UI to cosine-similarity scoring.

### What this finding improves

- **Deduplication quality** — semantic near-duplicate merging collapses "paywalled features" + "too many paid-only features" + "freemium is bait" into one painpoint. Current graph view is bloated; embeddings fix this.
- **Emergent clustering** — replaces the rigid 4-category YAML with HDBSCAN over embeddings. Unknown themes surface automatically.
- **Cross-source linking** — a Reddit thread and an arXiv paper about the same latency problem join the same painpoint node via cosine similarity, not just via LLM labelling.
- **Chat grounding** — retrieval augmented chat instead of graph-only walking. Citations become evidence-dense and specific.
- **LLM cost** — multi-head style extraction (one call emits severity + frequency + emotion + actionability) cuts token spend vs per-aspect calls.
- **Saturation-math defense** — cross-source confirmation via embedding similarity adds a second, independent confirmation channel next to LLM-label agreement.

### What we can build for OpenReply (product upgrades)

- 🎯 **Semantic near-duplicate merging of painpoints** — after `graph build`, run cosine similarity across painpoint nodes, auto-merge at `> 0.85`, surface the merge chain in the evidence panel. Lands in Map tab.
- 🎯 **Emergent clustering tab** — next to Map/Report/Evidence, a "Themes" tab that lets the user browse discovered clusters instead of the 4 fixed categories. Closes the rigid-YAML gap.
- 🎯 **Cross-source evidence edges** — new edge kind `semantic_link` between a Reddit post and a paper / review / issue that discuss the same thing at cosine ≥ 0.8. Surfaces on node hover in the graph view.
- 🎯 **RAG-style Chat** — replace (or stack next to) `graph_top_nodes` with vector retrieval of evidence posts. Makes "features to build" / "1-week plan" answers quote-grounded. Affects `topic.js::loadChat`.
- 🎯 **Topic-drift detection across runs** — embed previous-run graph vs current-run → surface new painpoints and vanished ones. This is the diff-mode flagged 🔴 in `self-gap-analysis.md`.
- 🎯 **Source-weighted severity** — embed each evidence post with a source-type token, let a small weighting head give arXiv / PubMed more weight than anecdotal reddit. Already half-done via the source-prefix prompt trick; embeddings make it explicit.
- 🎯 **Attention-style explainability in the Report tab** — for each finding, show which words in the evidence posts contributed most to the extractor's decision. Visualisation is directly inspired by Figures 3–5 of the paper.

### What we can build for the app (engineering upgrades)

- 🛠 **Unified embedding encoder** — one shared sentence-transformer instance across `src/reddit_research/retrieval/`, `research/discover.py`, `graph/semantic.py`. Today these are independent paths. One encoder = one geometry = composable features.
- 🛠 **Vector index per topic** — ChromaDB collection keyed by `topic`. Supersedes ad-hoc cosine loops. Lives under `~/Library/Application Support/com.shantanu.openreply/vectors/`.
- 🛠 **Positional-time encoding** — sinusoidal sin/cos over `created_utc` (paper §3.5), feed into the classifier alongside text embeddings. Upgrades CHRONIC/EMERGING/FADING from rule-based to learned.
- 🛠 **Restricted-attention chunker for PDF ingest** — paper §4's "restricted to neighborhood size r" idea is exactly the logic behind heading-aware PDF chunkers. Formalize the `opendataloader-pdf` output into overlap-chunked, locally-attended windows so 300-page papers don't OOM.
- 🛠 **Multi-head extractor prompt** — one LLM call returns a JSON with `{severity, frequency, emotion, actionability, topic}` per post instead of 4 separate calls. Halves LLM spend on the Enrich step.
- 🛠 **Attention-based re-ranker** — cheap cross-encoder re-rank (late interaction) on top of bi-encoder retrieval. Closes the recall/precision gap on Chat + Find screens.
- 🛠 **Shared-weight embedding matrix** — paper §3.4: share the embedding weights between input and output projections. Not directly applicable to LLM calls, but to our own indexed encoder: tie the query-side and doc-side weights to save memory and keep geometry consistent.
- 🛠 **Bench harness** — a `tests/retrieval_eval.py` that measures recall@k for painpoint-lookup over the existing validated corpora (`data-validate-*/`). No embedding change ships without a measured delta.

### Effort / priority / status

| Upgrade | Effort | Priority | Status | Closes |
|---|---|---|---|---|
| Semantic near-dup painpoint merge | S | P1 | idea | `self-gap-analysis.md` 🔴 #1 |
| RAG Chat | M | P1 | idea | `mvp-checklist.md` P3 follow-up |
| Emergent clustering (HDBSCAN over embeddings) | M | P1 | idea | `self-gap-analysis.md` 🔴 emergent clustering |
| Cross-source evidence edges | M | P2 | idea | `product-roadmap.md` build plan #1 |
| Unified encoder + vector index per topic | M | P1 (infra) | idea | prerequisite for all above |
| Diff-mode (embed past vs present run) | M | P2 | idea | `self-gap-analysis.md` v2 🔴 |
| Positional-time encoding for temporal classifier | S | P2 | idea | CHRONIC/EMERGING/FADING math |
| Multi-head extractor (one call, many aspects) | S | P2 | idea | LLM cost reduction |
| Attention-based re-ranker | M | P3 | idea | Chat / Find quality |
| PDF restricted-attention chunker | S | P2 | idea | Ingest screen robustness |
| Attention-style explainability in Report | L | roadmap | idea | trust / "AI hallucination" painpoint |

### Quickest impact path (1-week spike)

1. Stand up the **unified encoder + ChromaDB per-topic index** (M, enables everything else).
2. Ship **semantic near-dup painpoint merging** (S, immediately visible UX win).
3. Rewire **Chat → RAG** on top of the new index (M, user-facing grounding).

All three compound: after the index exists, every future upgrade is small.

---

## Finding 02 — *(placeholder — next research input lands here using the template above)*

<!--
Copy this when adding a new entry:

### Finding NN — <Title> (Source · Year)

**One-line idea:**
**Why relevant:**

#### What we have today (code-verified)
- Product (OpenReply user-facing):
- App / engineering (Tauri + sidecar):

#### What this finding improves

#### What we can build for OpenReply (product upgrades)
- 🎯

#### What we can build for the app (engineering upgrades)
- 🛠

#### Effort / priority / status
| Upgrade | Effort | Priority | Status | Closes |
|---|---|---|---|---|
-->
