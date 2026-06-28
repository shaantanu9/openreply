# OpenReply: A Local-First, Multi-Source Research System with a Unified Evidence Contract and Multi-Agent Deliberation

**Working Paper — v0.1**
**Date:** 2026-06-14
**Status:** Working paper (not peer-reviewed). Describes the design and
implementation of the OpenReply system (`reddit-myind`) as of the
`feature/fsd-fleet-governance` branch. Subject to revision.

---

## Abstract

Understanding a problem space deeply requires reconciling three kinds of
signal that normally live in separate tools: what people *struggle with*
(community discussion, reviews, forums), what they *wish existed* (feature
requests, market gaps), and what *research already knows* (the academic
literature). OpenReply is a local-first desktop system that collects all three
into a single store and connects them, so that an insight can be traced from a
user complaint to a wished-for feature to a paper that already points at the
answer.

This paper documents two design contributions. First, a **unified evidence
contract**: every external source — a Reddit post, an App Store review, a news
article, or a peer-reviewed paper — is fetched by a small per-source module and
returned in *exactly the same row shape*. Because the shape is identical,
deduplication, the SQLite store, a vector index, the knowledge graph,
sentiment, and LLM analysis all operate on any source with zero per-source
code paths. The "paper research" capability is then not a separate subsystem
but the same pipeline pointed at six academic sources, augmented with a
citation-graph layer and a full-text → chunk → analyze stage. Second, a
**multi-agent deliberation layer** that stress-tests findings: a "Fleet"
orchestrator that plans and executes staged research flows under explicit
human-in-the-loop governance levels (suggest / gated / autonomous), a debate
engine that can generate a topic-specific panel of critic personas on demand,
and a natural-language command center that decomposes a strategic directive
into per-topic missions.

We describe the architecture, the engineering choices that make a Python
research pipeline feel instant inside a Tauri desktop shell (a native
read-path that sidesteps a 30–70 s per-query cold start), and the validation
strategy (314 backend unit tests, 52 frontend tests, a self-diagnosing health
check, and a bundled-binary smoke path). We close with limitations and a
research agenda.

---

## 1. Introduction

### 1.1 Problem

A person trying to understand a domain — a founder hunting for a real gap, a
product manager seeking evidence, a researcher building a durable literature
base — must currently stitch together many tools. Social listening tools cover
forums but not papers. Reference managers cover papers but not the voice of the
user. Search engines cover everything shallowly and remember nothing. The cost
is not only effort; it is *lost connection*. The most valuable observation —
that a painpoint people complain about lines up with a feature they wish for,
and a paper that quietly already addresses it — is exactly the observation that
falls through the cracks between single-purpose tools.

### 1.2 Goals

OpenReply is built around four beliefs (stated in the project's own vision):
*evidence over opinion* (every insight traces to an openable source),
*connection over collection* (the value is in the relationships, not the size
of the pile), *learning as the product* (understanding that compounds), and
*built to be shared*. Translated into system requirements:

- **R1 — Source-agnostic ingestion.** Adding the *n*-th source must not require
  touching the *n−1* downstream stages.
- **R2 — Traceable evidence.** Every derived claim must point back to a row a
  user can open.
- **R3 — Local-first and private.** Data, embeddings, and (optionally) the LLM
  run on the user's machine; the desktop app must work offline for everything
  except live fetches.
- **R4 — Adversarial validation.** Findings should be challenged, not just
  generated, before a user trusts them.

### 1.3 Contributions

1. **A unified `posts`-row evidence contract** (§4) that collapses ~50
   heterogeneous sources into one schema, making every downstream capability
   (dedup, vector search, graph, sentiment, LLM analysis) source-agnostic.
2. **A paper-research subsystem expressed as a specialization of that contract**
   (§6), adding a citation graph and a full-text→chunk→analyze stage rather
   than a parallel codebase.
3. **A multi-agent deliberation layer** (§7) — governed Fleet flows, on-demand
   dynamic debate panels, and an NL command center — that makes adversarial
   validation a first-class, human-governed operation.
4. **A local-first engineering pattern** (§8) for shipping a Python research
   pipeline inside a Tauri desktop app without paying a per-query process-spawn
   tax on the hot path.

This is an engineering/design contribution. We do not claim a controlled study
of research outcomes; §9 reports validation in the sense of correctness,
coverage, and performance, and §10 is explicit about what remains unproven.

---

## 2. Background and Related Work

**Social listening and "voice of the customer" tools** aggregate community
chatter into themes. They are strong on forums and reviews but treat the
academic literature, if at all, as an external link. OpenReply differs by placing
papers in the *same* store and schema as community signal, so the two can be
compared directly ("what do users say vs. what do the papers say").

**Reference managers and literature-graph tools** organize papers and citation
relationships. OpenReply's paper subsystem (§6) overlaps here — citation edges,
full-text chunking, claim extraction — but inherits dedup, vector search, and
graph machinery from the shared contract rather than implementing a
paper-only stack.

**Retrieval-augmented generation (RAG)** over a private corpus is now standard.
OpenReply uses a local vector index ("palace": a persistent ChromaDB collection
with bundled ONNX MiniLM embeddings and BM25 hybrid rerank) for grounding, but
treats structured findings (painpoints, feature wishes, workarounds) as a
*separate, optional* layer on top of retrieval, so chat works on a raw corpus
before any extraction has run.

**Multi-agent LLM systems** (debate, critic/judge panels, planner/executor
splits) improve reliability by making models argue or verify rather than
answer once. OpenReply's deliberation layer (§7) applies this specifically to
research findings, and — distinctively — couples it to *explicit human
governance levels* so the user chooses how much autonomy to grant.

**Local-first software** argues for keeping data and computation on the user's
device. OpenReply is local-first by construction (Tauri shell + Python sidecar +
on-device SQLite/vector store + BYOK or local LLM), and §8 documents the
specific performance pattern that makes this viable for an interactive app.

---

## 3. System Overview

```
                         ┌──────────────────────────────────────────────┐
   user (desktop UI) ◄──►│  Tauri shell (Rust)   │  vanilla-JS frontend   │
                         └─────────┬───────────────────────┬──────────────┘
              native read path     │                       │  spawn / stream
            (rusqlite, WAL, <10ms) │                       ▼
                                   │             ┌────────────────────────┐
                                   │             │  Python sidecar (CLI)  │
                                   ▼             │  writes + LLM + HTTP   │
                         ┌──────────────────┐    └───────────┬────────────┘
                         │  SQLite (posts,  │                │
                         │  graph, findings)│◄───────────────┘
                         └──────────────────┘     fetch_<source>() × ~50
                                   ▲                          │
                vector "palace"    │      knowledge graph     │
              (ChromaDB + ONNX) ───┘    (nodes / edges) ──────┘
```

Three planes:

- **Acquisition** (§4–§5): per-source fetchers → the unified row → dedup →
  store. The same path feeds vector palace, graph, sentiment, and analysis.
- **Knowledge** (§6, §8): SQLite of record, a vector index for semantic recall,
  and a knowledge graph of painpoints / features / workarounds / papers and
  the edges among them.
- **Deliberation** (§7): Fleet flows, debate panels, and the NL command center
  that operate *over* the knowledge plane to plan, challenge, and synthesize.

The desktop shell (Tauri 2 + Rust) hosts a vanilla-JS frontend. Reads go
straight to SQLite from Rust (native, sub-10 ms); writes, LLM calls, and HTTP
fetches go through a Python sidecar invoked as a CLI. This split is the crux of
§8.

---

## 4. The Unified Evidence Contract (keystone)

The central design decision: **every fetcher returns a `list[dict]`, where each
dict has the same `posts`-row shape**, regardless of source.

```python
{
  "id":          f"{source_type}_{native_id}",  # globally unique across sources
  "sub":         "arxiv",                        # coarse bucket label
  "source_type": "arxiv",                        # stable filter id
  "author":      "First Last, Second Last, …",
  "title":       "Title — Venue",                # ≤300 chars
  "selftext":    "abstract / TLDR / body",       # ≤2000 chars — the embed text
  "url":         "OA PDF > DOI > landing page",  # the real clickable link
  "score":       123,                            # citations (papers) / upvotes (social)
  "permalink":   None,                           # reddit-family only; None elsewhere
  # …timestamps, source-specific metadata in metadata_json
}
```

Three load-bearing conventions make heterogeneous sources interoperable:

1. **`score` is overloaded but monotone** — citations for papers, upvotes for
   social — so "rank by importance" is one code path.
2. **`selftext` is always the embed text** — abstract for a paper, body for a
   post — so the vector palace indexes every source identically.
3. **`permalink` is reddit-family-only and `None` elsewhere**; the canonical
   link for all other sources lives in `url`. A single `postLink(row)` helper
   dispatches on `source_type`, which prevents the most common multi-source bug
   (rendering `reddit.com/<foreign-id>` for a non-Reddit row).

**Why this matters.** Because the shape is fixed, dedup, the SQLite store, the
vector index, the knowledge graph, sentiment, and LLM analysis are written
*once* and work for any source. Adding a source is local: a new
`fetch_<name>()` module plus a registry entry; nothing downstream changes
(R1). And because each derived artifact keeps the originating `id`, every
insight is traceable to an openable row (R2).

---

## 5. Multi-Source Acquisition

About 50 source modules live under `sources/*.py`, each exposing
`fetch_<name>(query, limit, …) -> list[dict]`. A shared HTTP layer
(`sources/_http.py`) centralizes polite access — a common User-Agent, default
headers, and `Retry-After` / 429 back-off — so rate-limit etiquette is not
re-implemented per source. A collector layer (`collect_adapter.py`) wraps each
fetcher with keyword expansion, logging, and upsert, and exposes a `SOURCES`
dispatch dictionary (`{name: run_fn}`) covering 64 collectable sources. The
collect orchestrator validates a requested `sources=[…]` list against that
dictionary and runs the fetchers in a thread pool, with per-connection SQLite
in WAL mode so concurrent writers serialize cleanly.

Sources span social/community (Reddit, Lemmy, Hacker News, Mastodon,
Bluesky, …), product (App Store, Play Store, Product Hunt, Steam,
Trustpilot, …), web/news (RSS, GNews, GDELT, Wikipedia, DuckDuckGo, …),
economic/geospatial (FRED, World Bank, Open-Meteo, yfinance, …), and the six
academic sources that the paper subsystem builds on (§6).

Each source is exposed three ways that must stay in lockstep: a standalone
per-source MCP preview tool (`openreply_fetch_<name>`), inclusion in the bulk
`SOURCES` collector, and a CLI entry. A recent audit closed an asymmetry where
eleven sources were collectable in bulk but lacked a standalone preview tool;
all are now wired through all three surfaces.

---

## 6. The Paper-Research Subsystem

The paper capability is the shared pipeline (§4–§5) pointed at six academic
sources — arXiv, PubMed, OpenAlex, Semantic Scholar, Crossref, and Scholar
(plus Europe PMC) — with two additions generic web sources do not need.

**6.1 Citation graph.** Forward and backward citation traversal via the
Semantic Scholar API produces paper→paper `cites` edges. Three distinct
operations exist, and keeping them distinct matters:

- `openreply_paper_citations(paper_id, limit)` — *who cites one paper* (forward).
- `openreply_paper_references(paper_id, limit)` — *what one paper cites* (backward).
- `openreply_paper_citation_graph(topic, limit)` — *topic-wide*: fetch each
  in-corpus paper's references and match them to other corpus papers by exact
  DOI / arXiv / PMID to materialize `paper_cites` edges for the map.

(The first and third previously shared the name `openreply_paper_citations`,
which caused the MCP framework to silently drop one of two same-named tools;
the topic-wide builder was renamed to `openreply_paper_citation_graph` so both are
reachable. This is exactly the kind of contract drift a unified surface is
prone to, and motivates the lock-step discipline of §5.)

**6.2 Full-text → chunk → analyze.** A one-call orchestrator
(`run_paper_research`) searches, ranks, fetches full text (open-access PDF when
available), chunks and embeds the text and abstracts into the vector palace,
and runs LLM analysis that produces a structured summary, extracted claims, and
a quality/relevance tier. A literature-gap detector surfaces open problems.
Local reference extraction can parse a cached PDF's bibliography without the
network and resolve references against existing corpus rows.

Because papers share the `posts` contract, they appear in the same knowledge
graph, semantic search, and chat as community signal — which is what enables
the headline use case: *comparing what users say against what the papers say,
in one place.*

---

## 7. Multi-Agent Deliberation (FSD Fleet)

Generation is cheap; *trustworthy* findings are not. The deliberation layer
makes challenging and orchestrating findings first-class, under explicit human
governance.

**7.1 Governed Fleet flows.** A Fleet flow plans a route over research stages
for a topic and executes them as a staged timeline. Execution runs under one of
three autopilot governance levels:

- **L1 — Suggest:** the system proposes the plan; the human runs each stage.
- **L2 — Gated:** the system runs until a decision gate, then *pauses for
  approval*; on approval (`approved=True`) it continues the remaining stages.
- **L3 — Autonomous:** the system runs the full flow end-to-end.

Governance is a parameter of the orchestrator (`run_fleet_flow(topic, route,
rounds, level, approved, on_stage)`), surfaced through the CLI (`--level`,
`--approved`), the Tauri command bridge, and a staged-timeline UI with an L2
approval gate. This makes "how much autonomy to grant" a per-run user choice
rather than a global mode (R4).

**7.2 Dynamic-role debate.** Beyond a fixed critic panel, the debate engine can
*generate a topic-specific panel of personas on demand*
(`generate_debate_roles(topic, n)`), so a fintech topic is stress-tested by
different critics than a developer-tools topic. The debate orchestrator
(`run_topic_debate(topic, rounds, provider, dynamic_roles)`) uses the generated
roles when `dynamic_roles=True` and falls back to fixed personas otherwise. The
deliberation engine tracks per-persona token cost, making the price of a
debate observable.

**7.3 NL command center.** A natural-language command center decomposes a
strategic directive ("research note apps and task managers") into per-topic
fleet missions. In plan-only mode it returns the decomposition; with
`--execute` it runs a governed fleet flow per topic at a chosen level. This
turns a single high-level intent into a coordinated, governed multi-topic
research campaign.

Together these let a user move from *generate* to *interrogate*: plan a flow,
challenge its outputs with a tailored adversarial panel, and scale the whole
thing across topics from one directive — while choosing how much to supervise.

---

## 8. Local-First Engineering

A naïve Tauri+Python design spawns the Python sidecar per call. On a freshly
installed, code-signed macOS bundle this costs **30–70 s per query** because the
OS re-verifies the bundled interpreter's shared objects on each launch; a
dashboard firing several reads becomes minutes of waiting. Development hides
this, because a project virtualenv interpreter spawns in ~200 ms.

OpenReply resolves this with a **read/write split**:

- **Reads go native.** Rust opens the same SQLite file read-only in WAL mode
  (`rusqlite`, thread-local connection cache) and answers every `SELECT`-shaped
  query in **sub-10 ms**, bypassing the sidecar entirely. Named-parameter
  binding (`:topic`) preserves the injection-safe query contract.
- **Writes and intelligence stay in Python.** Collection, enrichment, graph
  building, LLM analysis, and chat remain in the sidecar, which is the sole
  writer; WAL lets the native readers run concurrently with no coherence
  issues.

A second pattern keeps the *bundled* sidecar fast: shipping the interpreter as
a PyInstaller **onedir** (no per-launch archive extraction) via a thin launcher
that `exec`s the real binary, cutting cold spawn from ~36 s to ~1.3 s warm
while preserving the streaming/cancel contract the Rust side depends on.

Supporting safety nets, each added in response to a real failure mode: a splash
watchdog that force-reveals the main window if first render throws; an
orphan-lock sweeper that reaps long-running-job slots whose child died without
emitting a completion event; macOS App-Translocation detection so saved paths
do not break when the app is moved to `/Applications`; and a startup
**health check** (`health --json`) that reports per-subsystem status (data dir,
DB schema, vector model, LLM provider, source auth) so a silent failure becomes
a named subsystem on a screenshot rather than a blank page.

---

## 9. Validation

We validate in three senses appropriate to an engineering artifact:

**Correctness.** The backend carries 314 passing unit tests (one additional
test is a live-network integration check that requires real Reddit results and
is expected to fail offline); the paper/citation/MCP subset is 37 tests. The
frontend has 52 passing unit tests covering the API surface, formatters, the
multi-source `postLink` contract, loaders, and onboarding state. The MCP server
imports with zero duplicate-component warnings after the citation-tool rename
(§6.1).

**Coverage / wiring.** A 64-source wiring audit confirms each source is
reachable through bulk collection, a standalone MCP preview tool, and the CLI.
The unified contract is locked by tests for the `postLink` dispatch, including
the regression that a non-Reddit row must never yield a `reddit.com/…` URL.

**Performance and boot.** The native read path holds dashboard reads under
~10 ms warm; the bundled sidecar's `health --json` boot probe returns all
subsystems healthy. The full desktop stack builds clean end-to-end (frontend
bundle, Rust backend, sidecar binary).

We emphasize what these do *not* show: they establish that the system is
correct, wired, and fast — not that it produces better research *outcomes* than
an analyst with conventional tools. That comparison is future work (§11).

---

## 10. Limitations

- **No outcome study.** We have not measured whether OpenReply improves decision
  quality or speed versus a baseline workflow; §9 is engineering validation
  only.
- **LLM dependence.** Analysis, debate, and gap detection inherit the
  failure modes of the configured model (hallucinated claims, miscalibrated
  tiers). The deliberation layer mitigates but does not eliminate this, and we
  have not quantified its effect.
- **Citation completeness is API-bound.** The citation graph is only as complete
  as Semantic Scholar's coverage and rate limits; unauthenticated runs over
  many papers are throttled.
- **Source contract overload.** Overloading `score` and `sub` across sources is
  pragmatic but lossy; rendering bugs (the renamed citation tool, foreign-domain
  links) recur whenever a consumer forgets to dispatch on `source_type`. The
  unified contract trades per-source code for per-consumer discipline.
- **Platform.** The fast-boot and signing patterns are macOS-specific as
  implemented; Linux/Windows parity is partial.
- **Single-user.** The system is local-first and single-user; the "shared
  knowledge space" vision is not yet built.

---

## 11. Future Work

- **Outcome evaluation.** A task-based study (find the real gap, support a claim
  with evidence) comparing OpenReply against conventional tools.
- **Deliberation calibration.** Measure whether dynamic-role debate and L2/L3
  governance measurably reduce unsupported claims, and surface a calibrated
  trust signal on findings.
- **Shared knowledge.** Move from a personal companion toward a shared space
  where a map collected once is kept fresh and passed on.
- **Contract typing.** Replace the overloaded `score`/`sub` with a typed,
  source-aware accessor layer so consumers cannot forget to dispatch.
- **Cross-platform fast boot.** Generalize the onedir/native-read patterns to
  Linux and Windows.

---

## 12. Conclusion

OpenReply shows that a single design decision — make every source return the
same evidence row — lets one research pipeline span community signal and the
academic literature with no per-source downstream code, so that the connection
between *what people struggle with*, *what they wish existed*, and *what
research already knows* becomes a first-class, traceable object. On top of that
substrate, a governed multi-agent deliberation layer turns research from a
generate-once activity into an interrogate-and-supervise one, and a local-first
engineering split keeps the whole thing fast and private on a personal machine.
The contributions are architectural; the open question we most want to answer
next is whether they make people meaningfully better at understanding a space.

*Collect once. Connect everything. Learn continuously.*

---

## Appendix A — Key components (file map)

| Concern | Location |
|---|---|
| Per-source fetchers (~50) | `src/openreply/sources/*.py` |
| Shared polite HTTP | `src/openreply/sources/_http.py` |
| Collector + `SOURCES` dispatch (64) | `src/openreply/sources/collect_adapter.py` |
| Collect orchestrator (thread pool) | `src/openreply/research/collect.py` |
| Academic-source source-of-truth | `src/openreply/research/sources.py` |
| One-call paper pipeline | `src/openreply/research/paper_pipeline.py` |
| Paper LLM analysis | `src/openreply/research/paper_analyze.py` |
| Citation graph | `src/openreply/research/paper_citations.py`, `paper_references.py`, `paper_relations.py` |
| Fleet flow (governed) | `src/openreply/research/fleet_flow.py` |
| Debate orchestrator | `src/openreply/research/debate_run.py` |
| Dynamic roles + deliberation | `src/openreply/research/deliberate.py` |
| MCP tool surface | `src/openreply/mcp/server.py` |
| CLI surface | `src/openreply/cli/main.py` |
| Tauri bridge (Rust) | `app-tauri/src-tauri/src/commands.rs`, `main.rs` |
| Native SQLite read path | `app-tauri/src-tauri/src/db.rs` |
| Frontend | `app-tauri/src/` |

## Appendix B — Reproducing the validation

```bash
# Backend unit tests (expect 314 passed; 1 live-network failure is expected offline)
.venv/bin/python -m pytest tests/ -q

# Paper / citation / MCP subset
.venv/bin/python -m pytest tests/ -q -k "paper or citation or mcp"

# Frontend build + unit tests
cd app-tauri && npm run build && npm test

# Rust backend
cd app-tauri/src-tauri && cargo build

# Bundled sidecar boot probe (first cold run pays a one-time OS verification)
app-tauri/src-tauri/binaries/openreply-cli-aarch64-apple-darwin health --json
```

---

*This is a living working paper. Companion design docs:
`docs/specs/PAPER_RESEARCH_ARCHITECTURE.md` (acquisition contract in depth),
`VISION.md` (why the system exists), `FEATURES.md` (feature-level status).*
