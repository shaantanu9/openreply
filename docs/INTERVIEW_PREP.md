# Gap Map — Interview Preparation & Design Concepts

> **Purpose:** One document to prepare for any interview about this project. Every design concept is broken into **What / Why / How / Importance / Tradeoffs**, followed by a **mock-drill Q&A bank** (easy → hard) with model answers and likely follow-ups.
>
> **Last updated:** 2026-06-12

---

## Table of contents

1. [The 30-second product pitch](#0-the-30-second-pitch)
2. [Architecture concepts](#part-a--architecture--engineering-concepts)
   - A1. One engine, three surfaces
   - A2. Tauri 2 + Python sidecar (not Electron)
   - A3. Local-first SQLite data layer
   - A4. Provider-agnostic LLM layer (Strategy pattern)
   - A5. Staged research pipeline + source abstraction
   - A6. Async job queue & non-blocking work
   - A7. Knowledge graph + local embeddings (hybrid search)
3. [UI/UX concepts](#part-b--uiux-design-concepts)
   - B1. Progressive disclosure (Simple Mode)
   - B2. Plain-language explainer system
   - B3. In-app guidance (tours, next-step rail, help)
   - B4. Perceived performance (loader UX + SWR cache)
   - B5. Performance under contention (a real bug → design fix)
4. [The four guiding principles](#part-c--the-four-guiding-principles)
5. [Mock-drill Q&A bank](#part-d--mock-drill-qa-bank)
6. [Rapid-fire flashcards](#part-e--rapid-fire-flashcards)
7. [Whiteboard diagrams to memorize](#part-f--whiteboard-diagrams-to-memorize)

---

## 0. The 30-second pitch

> "Gap Map is a **local-first desktop research tool**. A user types a topic, and it pulls signal from **20+ sources** — Reddit, Hacker News, arXiv, PubMed, App Store reviews, GitHub issues — then uses **LLMs to synthesize market gaps, audience personas, and academic-paper insights**. It ships as a Mac desktop app built on **Tauri 2 with a Python sidecar**, but the *same* engine is also a **CLI** and an **MCP server** that AI agents like Claude can call directly."

That single sentence sets up the most important concept: **one engine, three surfaces.**

**Stack at a glance:** Tauri 2 (Rust shell) · vanilla JS frontend · Python engine (PyInstaller sidecar) · SQLite (WAL) · FastMCP · Typer CLI · ChromaDB + ONNX MiniLM embeddings · 8 pluggable LLM providers.

---

# Part A — Architecture / Engineering Concepts

---

## A1. One engine, three surfaces

**What it is.** The entire product is **one Python package** (`gapmap`) exposed through three different interfaces that all share the same `core/` + `fetch/` + `research/` modules:

| Surface | Tech | Audience |
|---|---|---|
| Desktop app | Tauri 2 + vanilla JS frontend, Python sidecar | End users |
| CLI (`gapmap`) | Typer | Power users / scripts / automation |
| MCP server | FastMCP, 90+ tools | Claude / AI agents (stdio + HTTP) |

**Why.** Building the same research logic three times would mean three bug surfaces, three places to update when a source changes, and inevitable drift. By separating **interface** from **engine**, business logic lives once.

**How.** The desktop app's "backend" *is literally the CLI package*, spawned by Rust as a subprocess. The MCP server imports the same modules and wraps them as tools. The CLI calls them directly. None of the three contains business logic of its own — they're thin adapters.

**Importance to the project.** This is the architectural keystone. Adding a new data source or fixing a synthesis bug benefits all three surfaces simultaneously. It's why a solo/small team could ship this breadth.

**Tradeoffs.**
- ✅ Zero business-logic duplication, consistent behavior, single source of truth.
- ⚠️ Forces clean boundaries — the engine must not know about any UI.
- ⚠️ The desktop path pays an **IPC cost** (JSON over stdin/stdout between Rust and Python) instead of in-process function calls.

**Interview soundbite:** *"I separated interface from engine. All three faces are thin adapters over the same core, so the desktop app's backend is literally the CLI."*

---

## A2. Tauri 2 + Python sidecar (instead of Electron)

**What it is.** The desktop shell is **Tauri 2** (Rust + the OS-native webview). The Python research engine is bundled as a **PyInstaller sidecar** — a long-lived subprocess started at app launch. Rust owns the IPC bridge (`src-tauri/src/commands.rs`); the JS frontend calls Rust commands; Rust spawns and talks to Python.

**Why Tauri over Electron.**
- **Binary size:** Tauri ~10× smaller — it uses the system webview instead of bundling a whole Chromium.
- **Memory/perf:** lighter footprint.
- **Security & packaging:** Rust gives memory safety in the shell and first-class native packaging (DMG, code signing, notarization).

**Why a Python sidecar.** The research/ML logic — scraping, embeddings, LLM orchestration — lives where the ecosystem is richest (Python). The shell stays in Rust. You get the best of both: Rust safety + Python's data/ML libraries.

**How the IPC works.** Frontend `invoke('run_cli', {...})` → Rust command → Rust spawns the Python sidecar (or the dev `.venv` in development) → Python returns JSON on stdout → Rust passes it back to JS. Streaming commands use **NDJSON** (newline-delimited JSON) so progress can be emitted incrementally.

**Importance.** This is what makes it a *real, distributable, local-first desktop app* rather than a web app — no server, no account, the user's data never leaves their machine.

**Tradeoffs.**
- ✅ Small, fast, native, private.
- ⚠️ **Bundling a Python interpreter is the hard part.** macOS Gatekeeper can hang the bundled binary for minutes on first launch, so in dev we bypass with the system venv. UPX compression can corrupt the bundle → must disable it.
- ⚠️ Cross-language IPC demands **tolerant JSON parsing** (sidecar may print warnings to stdout), `PYTHONUNBUFFERED=1`, and **timeouts on every call** so a hung backend surfaces an error instead of an infinite spinner.

**Interview soundbite:** *"Tauri for a small, safe, native shell; a Python sidecar for the ML ecosystem; SQLite to glue them. Electron would've been 10× the binary and still wouldn't give me Python."*

---

## A3. Local-first SQLite data layer

**What it is.** All state lives in **one SQLite file** (`gapmap.db`) in the OS app-support directory, in **WAL mode**, with **thread-local connections** managed by `core/db.py`.

**Why.**
- **Local-first / privacy:** no backend server, no account, data stays on-device.
- **SQLite as an integration bus:** the CLI, the MCP server, and the desktop app all read/write the same file, so they're automatically consistent.
- **Zero ops:** no Postgres to run, no migrations service — it's a file.

**How.**
- **WAL mode** allows concurrent reads during writes (important when the sidecar writes while the UI reads).
- **Idempotent upserts** with stable primary keys (e.g. Reddit post id) mean re-running a fetch never duplicates rows.
- **Parameterized queries** (`:topic` binding, never string concatenation) guard against SQL injection — deliberate even though it's a local app, because topic strings are user input.
- Schema is **pre-created** in `init_schema` for every table the UI queries, so a fresh install never hits a missing-table error.

**Importance.** SQLite is the quiet hero — it's the shared truth that makes "one engine, three surfaces" actually consistent, and it's why the app works offline.

**Tradeoffs.**
- ✅ Simple, fast, consistent, offline, private.
- ⚠️ Single-writer model — heavy concurrent writes need care (WAL + thread-local connections handle this).
- ⚠️ No built-in multi-device sync (acceptable: it's a local research tool).

---

## A4. Provider-agnostic LLM layer (Strategy pattern)

**What it is.** An `LLMProvider` abstract base class with a single method `complete(prompt, system?, max_tokens?)`, and **8 concrete implementations**: Anthropic, OpenAI, OpenRouter, Groq, DeepSeek, Mistral, Google Gemini, and **Ollama (fully local)**.

**Why.** Avoid vendor lock-in, support **BYOK** (bring your own key), let cost/quality/privacy-conscious users pick their model, and never hardcode a provider anywhere in the 90+ tools.

**How — the resolution chain:**
```
resolve_provider(hint=None):
  1. explicit hint arg (caller override)
  2. DEFAULT_LLM_PROVIDER env var
  3. BYOK modal choice (persisted to ~/.config/gapmap/.env)
  4. first key found: ANTHROPIC → OPENAI → OPENROUTER → GROQ →
                      DEEPSEEK → MISTRAL → GEMINI → OLLAMA (local)
```
Switching models is **one env var away**. No tool knows which provider it's using.

**Importance.** Directly answers "how do you avoid vendor lock-in?" and "how do you handle privacy?" — with **Ollama**, inference runs locally so zero data leaves the machine.

**Tradeoffs.**
- ✅ Pluggable, future-proof, privacy option, cost control.
- ⚠️ Lowest-common-denominator interface — provider-specific features (e.g. native tool calling) sit behind the abstraction. Acceptable: the app only needs `complete()`.

**Interview soundbite:** *"Classic Strategy pattern. Eight providers behind one ABC, resolved by a fallback chain. No provider is hardcoded — switching is one env var, and Ollama gives a fully-local, zero-leak option."*

---

## A5. Staged research pipeline + source abstraction

**What it is.** Research runs as a clean **staged pipeline**, and every external input is a **one-file-per-source module** conforming to a common shape.

**The pipeline:**
```
DISCOVER → COLLECT → CORPUS → GAPS → GRAPH → EXPORT
```
- **Discover:** LLM canonicalizes the topic (typo-correct) + fans out keywords → ranked subreddits.
- **Collect:** Reddit (top-of-month/year, parameterized pain/feature/complaint searches) + a **6-worker parallel fan-out** across all non-Reddit sources + historical archive (pullpush.io).
- **Corpus:** rank by engagement.
- **Gaps:** LLM extracts 4 gap types — painpoints, feature wishes, product complaints, DIY workarounds.
- **Graph:** structural + semantic edges.
- **Export:** Report (markdown), Map (D3 force-graph), DOCX/PPTX.

There's a **parallel paper pipeline**: search (6 academic sources) → fulltext (OA PDF → pypdf) → sections → chunk + embed → analyze.

**Why.** Each stage has a single responsibility and a clear input/output, so it's testable and resumable. The source abstraction means **adding a source is a localized, additive change** (Open/Closed principle) — drop in `sources/newsource.py` matching the common shape, register it, done. The codebase has 20+ such modules.

**How.** `research/collect.py` orchestrates the fan-out; each `sources/*.py` knows only how to fetch and normalize its own data into the shared `posts`/`topic_posts` schema.

**Importance.** This is what gives the product its breadth (20+ sources) without becoming a tangled mess. Breadth is the moat; the abstraction is what makes breadth maintainable.

**Tradeoffs.**
- ✅ Extensible, testable, parallelizable.
- ⚠️ Each source has its own rate limits / API quirks / auth — handled per-module, but it's ongoing maintenance.

---

## A6. Async job queue & non-blocking work

**What it is.** Long-running operations (LLM synthesis, bulk collection) run on an **async job queue** — a 4-thread pool, **SQLite-persisted** so jobs survive and can be polled.

**Why.** LLM calls take 30–90 seconds. If the MCP server or UI blocked on them synchronously, clients would time out and the UI would freeze.

**How.** `mcp/jobs.py` submits a job, returns a job id immediately, and the client polls for status/result. The UI kicks off the work, then **polls SQLite for real progress** instead of faking it.

**Importance.** Makes slow AI work feel responsive and keeps the single sidecar from being a bottleneck that freezes everything.

**Tradeoffs.**
- ✅ Non-blocking, pollable, survives restarts.
- ⚠️ Adds polling complexity vs. a simple synchronous call.

---

## A7. Knowledge graph + local embeddings (hybrid search)

**What it is.** Collected findings and papers are organized into a **knowledge graph** (`graph_nodes` / `graph_edges`) with both **structural** edges (citations, co-author, tree) and **semantic** edges (`relates_to`, `potentially_solves`, `could_address`, `co_evidenced`). Search is **hybrid: vector (embeddings) + BM25 (keyword)**.

**Why.** Raw lists of posts/papers don't show *relationships*. The graph turns a pile of evidence into a navigable map of how problems, solutions, and papers connect — that's the actual product insight.

**How.**
- Embeddings come from a **bundled MiniLM ONNX model** run **locally** via ChromaDB — no embedding API calls, reinforcing local-first.
- `graph/relations.py` adds semantic cross-edges; a per-node top-N cap prevents the graph from collapsing into a hairball.
- `retrieval/palace.py` does hybrid vector + BM25 rerank over both posts and papers.
- Graph analytics: PageRank, betweenness, Louvain community detection.

**Importance.** It's the differentiator — anyone can list Reddit posts; the graph + semantic relations are what produce "gaps" and "what connects to what."

**Tradeoffs.**
- ✅ Rich relationships, local & private embeddings, no per-query API cost.
- ⚠️ Bundling an ~80MB model bloats the installer; graph edge-building is compute-heavy and needs caps to avoid hairballs.

---

# Part B — UI/UX Design Concepts

---

## B1. Progressive disclosure (Simple Mode)

**What.** The app has **70+ screens** and a **30-item sidebar**. **Simple Mode** collapses it to **8 essentials** for new users, toggled via a `data-nav-mode` attribute on the nav.

**Why.** A power-user surface overwhelms beginners (cognitive overload → drop-off). But dumbing it down for everyone loses the power users.

**How.** CSS keys off `data-nav-mode="simple"` to hide non-essential items; power users opt into the full set. Same app, two cognitive loads.

**Importance.** Onboarding survival — new beta users could actually find the 8 things that matter instead of bouncing off 30.

**Soundbite:** *"Progressive disclosure: 8 essentials for newcomers, full surface on opt-in. I didn't make the app smaller — I made the entry smaller."*

---

## B2. Plain-language explainer system

**What.** Every screen has a **'Why' / eye-icon** that explains, in plain English: *what this page does, the science behind it, and where the data comes from.* Backed by an `EXPLANATIONS` registry (purpose + science + data-source per page).

**Why.** Built for **non-technical beta users** who don't know what "Minto synthesis" or "intent ladder" means. Reduces the "what am I even looking at?" tax on every screen.

**How.** A backend registry (`runtime/explanations.py`) stores structured explanation objects; the frontend renders them in a popover. 43+ screens covered.

**Importance.** Turns an expert tool into something a layperson can navigate — critical for beta feedback quality.

---

## B3. In-app guidance: tours, next-step rail, help

**What.** Three layered guidance systems:
1. **Onboarding wizard** (first run).
2. **Per-page explainers** (B2).
3. **Lifecycle playbook + tours** — a spotlight **tour engine** (`tour.js` + `tours.js`) keyed to DOM selectors, a **"next step" rail** (`nextStep.js`), and contextual **help popovers** (`helpPopover.js`).

**Why.** A deep tool needs hand-holding at the right moment, not a wall of docs. Different users need guidance at different depths.

**How.** Tours are data-defined (selector + message per step) and orchestrated centrally; `isTourDone` tracks completion so users aren't re-prompted.

**Importance.** Reduces time-to-first-value and stops users getting lost in 70 screens.

---

## B4. Perceived performance (loader UX + SWR cache)

**What.** Because LLM calls take 30–90s, the design deliberately invests in making the wait **feel alive**: real spinner, **cycling stage messages**, **live elapsed counter**, **asymptotic progress bar**, and **skeleton preview cards**. Plus **stale-while-revalidate (SWR)** caching in localStorage — dashboards show cached data *instantly*, then refresh in the background.

**Why.** You often can't make an LLM call faster. So you make the wait **legible**. A frozen spinner reads as "broken"; a moving, narrated loader reads as "working."

**How.** The loader kicks off the real backend job and, where possible, **polls SQLite for genuine progress** rather than pure fakery. SWR: render cached → fetch fresh → swap in.

**Importance.** This is the difference between users thinking the app crashed vs. trusting it. Directly fixed "the loader is frozen / tab feels dead" feedback.

**Soundbite:** *"When you can't make it faster, make the wait legible. Skeletons + narrated progress + SWR cache turned 'it's broken' into 'it's working.'"*

---

## B5. Performance under contention (a real bug → a design fix)

**What.** The home dashboard fired **11 parallel async loaders** on open, which **starved the single Python sidecar** (one subprocess, many simultaneous requests → mutex starvation → infinite spinners).

**Why it happened.** Naive "load everything at once" + a single backend process = contention.

**The fix (good architecture story):**
- **Defer below-the-fold cards** to `requestIdleCallback` — only load what's visible first.
- Make auto-running **LLM pipelines opt-in (default OFF)** so opening a tab doesn't kick off expensive blocking calls.
- Put **hard timeouts** on blocking calls so a hung backend surfaces an *error card* instead of an infinite spinner.

**Importance.** Shows you can diagnose a systems problem (resource contention on a shared sidecar) and fix it with both **scheduling** (idle callback) and **product** (opt-in) changes — not just code.

**Soundbite:** *"11 loaders hammering one sidecar starved it. I fixed it three ways: defer off-screen work to idle time, make expensive pipelines opt-in, and timeout everything so a hang becomes a visible error, not a frozen spinner."*

---

# Part C — The Four Guiding Principles

When asked *"what were your guiding principles?"*, lead with these:

1. **Separation of concerns** — engine vs. interface; one core, three surfaces (A1).
2. **Local-first & privacy** — SQLite + local ONNX embeddings + BYOK/Ollama; nothing *needs* the cloud (A2, A3, A4, A7).
3. **Extensibility via abstraction** — Strategy pattern for LLMs, one-file-per-source for inputs; new capability is **additive, not invasive** (A4, A5).
4. **Design for the wait & the newcomer** — progressive disclosure, plain-language explainers, perceived-performance loaders; the hard parts (many screens, slow LLM calls) are **UX problems as much as engineering ones** (B1–B5).

---

# Part D — Mock-drill Q&A bank

> Practice answering out loud. Each has a **model answer** and **follow-ups** the interviewer will likely push on.

### Easy / warm-up

**Q1. Give me a one-line description of the project.**
> See the [30-second pitch](#0-the-30-second-pitch). Lead with "local-first desktop research tool, 20+ sources, LLM synthesis, one engine exposed as desktop app + CLI + MCP server."
- *Follow-up: "What problem does it solve?"* → "Founders/researchers waste days manually trawling Reddit/forums/papers to validate an idea. This automates the collection and uses LLMs to surface the actual gaps."

**Q2. What's the tech stack?**
> Tauri 2 (Rust shell), vanilla JS frontend, Python engine (PyInstaller sidecar), SQLite (WAL), FastMCP, Typer, ChromaDB + ONNX MiniLM, 8 pluggable LLM providers.
- *Follow-up: "Why vanilla JS, no React?"* → "The frontend is mostly forms + cards + a D3 graph. A framework's runtime cost and build complexity weren't worth it; vanilla keeps the bundle tiny and the Tauri webview fast. Tradeoff: more manual DOM wiring, which is why there are small helper modules (tabs.js, screenCache.js) instead of a framework."

### Medium

**Q3. Why Tauri instead of Electron?** → See [A2](#a2-tauri-2--python-sidecar-instead-of-electron). Hit: 10× smaller, system webview, Rust safety + native packaging, and "Electron still wouldn't give me Python."
- *Follow-up: "How does the frontend talk to Python?"* → IPC: JS `invoke` → Rust command → spawns Python sidecar → JSON/NDJSON over stdout → back to JS.
- *Follow-up: "What's the hardest part of bundling Python?"* → Gatekeeper hanging the bundled binary, UPX corruption, unbuffered stdout, tolerant JSON parsing. Dev bypasses with the system venv.

**Q4. Walk me through what happens when a user researches a topic.**
> Discover (LLM canonicalize + sub ranking) → Collect (6-worker parallel fan-out across 20+ sources + historical) → Corpus (rank by engagement) → Gaps (LLM extracts 4 gap types) → Graph (structural + semantic edges) → Export (report/map/docx). See [A5](#a5-staged-research-pipeline--source-abstraction).
- *Follow-up: "Where do LLMs fit?"* → canonicalization, gap extraction, insight synthesis, paper analysis — all behind the provider abstraction.

**Q5. How do you support multiple LLM providers?** → [A4](#a4-provider-agnostic-llm-layer-strategy-pattern). Strategy pattern, `LLMProvider` ABC, resolution chain, one env var to switch, Ollama for local.
- *Follow-up: "How do you handle a user with no API key?"* → BYOK modal on first run, or fall back to local Ollama; the resolution chain picks the first available.

**Q6. How do you add a new data source?**
> Drop a `sources/newsource.py` that fetches and normalizes into the shared schema, register it in the collect fan-out. One localized change — Open/Closed principle. All three surfaces get it for free.

**Q7. Why SQLite and not Postgres?** → [A3](#a3-local-first-sqlite-data-layer). Local-first, zero ops, single shared file = consistency across surfaces, works offline. Tradeoff: single-writer (handled with WAL + thread-local connections), no multi-device sync (acceptable).

### Hard / systems & design

**Q8. The dashboard froze on open. Diagnose and fix.** → [B5](#b5-performance-under-contention-a-real-bug--a-design-fix). 11 parallel loaders starved one sidecar. Fix: `requestIdleCallback` for below-the-fold, opt-in pipelines, hard timeouts → error card not infinite spinner.
- *Follow-up: "Why not just multi-thread the sidecar?"* → It does have a job pool, but the deeper issue was doing expensive work the user didn't ask for. Cheapest fix is to not do unnecessary work, then schedule the rest. Also keeps memory low.

**Q9. An LLM call takes 90 seconds. How do you keep the app usable?**
> Two layers: (1) **async job queue** (A6) — submit, return immediately, poll SQLite for real progress; (2) **perceived-performance UI** (B4) — narrated loader, elapsed counter, asymptotic bar, skeletons, SWR cache so cached data shows instantly.
- *Follow-up: "Real progress or fake?"* → Real where possible (poll SQLite row counts as the pipeline writes); honest-but-smoothed bar where the backend can't report granular progress.

**Q10. How do you guarantee the CLI, MCP, and desktop app behave the same?**
> They're thin adapters over one shared core (A1) and one shared SQLite file (A3). There's no duplicated business logic to drift. A change to `research/` propagates to all three.
- *Follow-up: "How do you test that?"* → Test the core modules directly (Python tests), plus per-surface smoke tests; the engine is UI-agnostic so it's unit-testable in isolation.

**Q11. What's the knowledge graph for, and how is it built?** → [A7](#a7-knowledge-graph--local-embeddings-hybrid-search). Turns evidence into relationships; structural + semantic edges; local ONNX MiniLM embeddings + BM25 hybrid; PageRank/Louvain analytics; top-N cap to avoid hairballs.
- *Follow-up: "Why local embeddings?"* → Privacy + zero per-query cost + offline. Tradeoff: ~80MB bundled model.

**Q12. How would you scale this to a multi-user cloud product?**
> The clean engine/interface split makes this tractable: lift the Python engine behind an HTTP API, swap SQLite → Postgres (the data layer is already isolated in `core/db.py`), move embeddings to a vector DB service, add auth + per-tenant isolation. The MCP server already proves the engine works headless over a network boundary. The desktop app could become a thin client or stay local-first with optional sync.
- *Follow-up: "Biggest blocker?"* → SQLite's single-writer model and the assumption of one local data dir; you'd need tenant isolation and connection pooling. Local-ONNX embeddings would move server-side.

**Q13. What was the hardest bug or decision?**
> Pick one and tell it as a story: e.g., the **sidecar contention** (B5) or **Gatekeeper hanging the bundled Python** (A2). Structure: symptom → root cause → fix → what it taught me. Interviewers love a concrete debugging narrative with a root-cause insight.

**Q14. What would you do differently?**
> Honest, senior answer: "I'd introduce a tiny reactive layer for the frontend earlier — vanilla JS was right for bundle size but the manual DOM wiring across 70 screens got heavy; a minimal state/store abstraction (not a full framework) would've cut bugs. And I'd add a typed IPC contract between Rust and Python sooner — the JSON boundary was a frequent source of subtle bugs."

**Q15. Security considerations?**
> Parameterized SQL (`:topic` binding) even locally; secrets in `~/.config/gapmap/.env` (chmod 600), never in the DB or repo; provider keys resolved at runtime, never hardcoded; Tauri capability scoping (asset protocol scope, restricted command surface); local-first means minimal attack surface (no server to breach).

---

# Part E — Rapid-fire flashcards

| Prompt | Answer |
|---|---|
| Core architectural idea | One engine, three surfaces (desktop / CLI / MCP) |
| Why Tauri not Electron | ~10× smaller, system webview, Rust safety, native packaging |
| Why a Python sidecar | ML/scraping ecosystem lives in Python; Rust shell stays thin |
| Data layer | One SQLite file, WAL, thread-local connections, idempotent upserts |
| LLM design pattern | Strategy — `LLMProvider` ABC + 8 providers + resolution chain |
| Privacy story | Local-first + local ONNX embeddings + Ollama = zero data leaves machine |
| Add a source | One file in `sources/`, register in fan-out (Open/Closed) |
| Slow-LLM UX | Async job queue + narrated loader + skeletons + SWR cache |
| New-user UX | Simple Mode (8 vs 30), plain-language explainers, tours |
| Dashboard-freeze fix | idle-callback defer + opt-in pipelines + hard timeouts |
| Graph search | Hybrid vector (MiniLM ONNX) + BM25, PageRank/Louvain |
| Four principles | Separation of concerns · Local-first · Extensibility · Design for the wait/newcomer |

---

# Part F — Whiteboard diagrams to memorize

**Three surfaces over one engine:**
```
   Desktop (Tauri+JS)     CLI (Typer)     MCP (FastMCP, 90+ tools)
          │                   │                    │
          └─────────── shared gapmap core ─────────┘
              core/ + fetch/ + research/ + graph/
                            │
                      SQLite (gapmap.db, WAL)
```

**Desktop IPC path:**
```
JS frontend  ──invoke()──►  Rust command  ──spawn──►  Python sidecar
     ▲                                                     │
     └──────────────  JSON / NDJSON (stdout)  ─────────────┘
```

**Research pipeline:**
```
DISCOVER → COLLECT → CORPUS → GAPS → GRAPH → EXPORT
(LLM)      (6-worker  (rank)   (LLM    (struct+ (md/D3/
           fan-out)            4 gaps) semantic) docx/pptx)
```

**LLM resolution chain:**
```
hint arg → DEFAULT_LLM_PROVIDER env → BYOK choice →
first key: Anthropic→OpenAI→OpenRouter→Groq→DeepSeek→Mistral→Gemini→Ollama
```

---

*Prepare by reading Part A & B for depth, drilling Part D out loud, and memorizing Part E + F for rapid recall.*
