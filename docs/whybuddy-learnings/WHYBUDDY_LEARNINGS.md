# WhyBuddy — Deep Learnings (master index)

> **Source repo:** `/Users/shantanubombatkar/Documents/GitHub/myind-openreply-ref/WhyBuddy`
> **Produced:** 2026-06-13 · **For:** mining features to port into **OpenReply** (`reddit-myind`, a Tauri 2 + Python desktop research app).
> **How this was produced:** `codegraph index` (2,576 files · 33,808 nodes · 31,232 edges) + `graphify` + 6 parallel subsystem-analysis agents reading the repo's source, tests, and docs (`README`, `ROADMAP`, 72KB `codeflow-report.md`, `.kiro` specs). rtk compressed all shell reads.
> **Status:** Analysis complete. **Next step (not yet done):** triage the "Port to OpenReply" backlog below and implement the chosen items.

This file is the entry point. The deep detail lives in 6 sibling section files (3,380 lines total) — each covers one subsystem with per-file purpose, key functions, core logic/algorithms, data flow, and portability notes:

| # | Section file | Lines | Covers |
|---|---|---|---|
| 00 | [`00-overview-and-architecture.md`](./00-overview-and-architecture.md) | 403 | Product, full feature catalog, architecture, glossary, config/integrations, 20-item port table |
| 01 | [`01-client-frontend.md`](./01-client-frontend.md) | 577 | React/Vite/R3F client: 3 UI shells, Zustand stores, BYOK LLM layer, d3 knowledge graph, xterm, UE5 bridge, workers |
| 02 | [`02-server-backend.md`](./02-server-backend.md) | 596 | Express/Socket.IO server: MissionOrchestrator, NL-command FSM, RAG stack, JSONL lineage, audit chain, reputation engine |
| 03 | [`03-lobster-executor.md`](./03-lobster-executor.md) | 363 | Docker-sandboxed job executor: runner strategy, security presets, HMAC callbacks, capability negotiation, browser automation |
| 04 | [`04-shared-domain.md`](./04-shared-domain.md) | 773 | Shared contracts: LLM provider abstraction, blueprint/mission planning, memory, RAG, knowledge/lineage, nl/scene-command, replay, permission |
| 05 | [`05-skills-system.md`](./05-skills-system.md) | 668 | Two skill systems: LLM-prompt skills (canary-versioned) + sandbox code skills (Zod-manifest, capability-scored) |

---

## 1. What WhyBuddy is

An **AI "product rehearsal" engine**: the user types one sentence describing a product/feature idea, and a fleet of role-specialized LLM agents produces, in ~5 minutes, a complete **SPEC package** — requirements, design, task breakdown, architecture diagram, UI mockups, a requirement↔design↔task↔evidence↔test **traceability matrix**, and a prompt pack — with a **cryptographic evidence trail** (every quality gate records the real script it ran + exit code + output). Agents are visible as characters in a 3D office scene (Three.js / optional UE5 pixel-streaming) for real-time observability, and humans can take over at defined "Takeover Points" (L1–L5 autopilot levels).

It is, in essence, a **governed multi-agent orchestration platform** with strong provenance, planning, and human-in-the-loop primitives — which is exactly the layer OpenReply is thinnest on.

## 2. Architecture at a glance

```
Client (React 19 + Vite + Three.js/R3F)        ← 3 shells: Office (3D), Autopilot dashboard, WhyBuddy chat
   │  HTTP + Socket.IO (live agent streaming)
Server (Express + Socket.IO)                    ← MissionOrchestrator, NL-command FSM, RAG, lineage, audit, reputation
   │  HMAC-SHA256 signed job submit + callbacks   (MySQL + Redis in prod; JSONL flat files for lineage/replay/graph)
Lobster Executor (standalone Express :3031)     ← mock | native subprocess | Docker-sandboxed job execution
   │  Docker (dockerode) + Playwright              + skill registry, capability negotiation, credential scrubbing
Shared/ (TS contracts)                          ← LLM abstraction, blueprint/mission planning, memory, rag, knowledge, replay
UE5 (optional)                                  ← Pixel Streaming 3D observability overlay
```

## 3. Domain glossary (orient before reading sections)

- **SPEC tree** — the structured output artifact (requirements→design→tasks), schema-validated with an invariant guard + deterministic fallback.
- **Mission** — a decomposed unit of work; the server's `MissionOrchestrator` runs a 6-stage state machine (receive→understand→plan→provision→execute→finalize).
- **Blueprint** — the planning layer that turns a goal into an executable plan (with `clarification`, `artifact-memory`, `preview-audit`).
- **NL-command** — natural-language → structured command/mission decomposition (two-LLM: mission list + dependency edges → Kahn topo-sort into parallel groups).
- **Scene-command** — commands that drive the 3D scene / agent avatars.
- **Skill** — *two* distinct things: (A) a versioned LLM **prompt** template, and (B) a sandboxed **code** capability (Node/Python/Bash in Docker) with a Zod `skill.json` manifest.
- **Lobster Executor** — the job-execution microservice (sandbox).
- **Lineage** — provenance DAG (JSONL) recording which agent/decision/source produced each artifact.
- **Replay** — re-running a session's persisted events under isolation.
- **Reputation** — per-agent EMA trust scoring across dimensions → TrustTier → autopilot privilege.
- **Guardrails / Takeover Points / Autopilot L1–L5** — the human-in-the-loop governance model.
- **Checks ledger** — record of every quality gate: script + exit code + output (verifiable, not faith-based).
- **A2A** — agent-to-agent JSON-RPC interop envelope.

## 4. Standout techniques worth stealing (cross-cutting)

- **Provenance everywhere** — every generated node is labeled `llm` / `llm_fallback` / `template`; a checks ledger and a lineage DAG make outputs auditable.
- **Deterministic fallback tree** — when the LLM fails, emit a valid minimal output that satisfies all invariants (labeled `llm_fallback`) instead of erroring.
- **Invariant guard** — post-write structural validation of the SPEC/graph (unique root, parent-reachable, no cycles, max depth, required fields).
- **LLM key pool race** — N keys race in parallel, first to return wins → latency cut on the hottest calls.
- **Clarification gate** — blocking vs non-blocking questions resolved into a `clarified_brief.json` (goal + constraints + success criteria) *before* expensive work runs.
- **NL decomposition + topo-sort** — goal → missions → dependency edges → Kahn BFS → parallel execution groups.
- **Zero-dep hash embedding** — FNV-1a bag-of-words → 96-dim normalized vector for memory search with no external embedding service.
- **RRF hybrid retrieval** — reciprocal-rank-fusion merge of semantic + keyword results.
- **HMAC-signed callbacks** + replay protection + exponential backoff; callback failure never blocks the job.
- **Credential scrubbing** — `sk-…`/`clp_…` patterns stripped from artifacts and live log streams.
- **Capability negotiation** — jobs/skills declare `requiredCapabilities[]`; executor rejects with a structured diff before running; skill selection scores `covered/required − safetyPenalty`.
- **Dependency invalidation** — upstream change → mark `STALE` → auto-`RECOMP` down the chain.

---

## 5. Master "Port to OpenReply" backlog (consolidated & deduped)

Aggregated from all 6 agents. OpenReply already has: a strong multi-source collect pipeline, SQLite knowledge graph, personas, paper research, an MCP server (~150 tools), and a BYOK multi-LLM resolver. So the highest-value ports are the **orchestration / provenance / governance meta-layer** WhyBuddy excels at — not re-implementing collection or graphs.

### Wave 1 — quick wins (effort S, value High) — do these first
| Item | Why for OpenReply | Source §|
|---|---|---|
| **Provenance labels on generated artifacts** (`llm` / `llm_fallback` / `template`) | Every LLM-written graph node / gap / persona becomes auditable; one new column + write-path tag | 00, 02 |
| **Checks ledger** (SQLite table: which script ran, LLM output, invariant checked, exit code) | Turns "trust me" outputs into verifiable ones | 00 |
| **Deterministic fallback tree** | LLM fails mid-research → return a valid minimal labeled result instead of an error | 00, 04 |
| **LLM key pool race** (N BYOK keys, first-to-return wins) | Cuts latency on the most expensive pipeline calls | 00, 04 |
| **RRF hybrid-search merge** over OpenAlex/PubMed/Semantic Scholar/social results | Better ranked evidence with a tiny, dependency-free merge | 02 |
| **JSONL lineage** for paper/gap provenance (byId/byAgent/bySession indices) | "Click a gap → see every source that produced it" with a flat-file store | 02 |
| **Credential scrubber** on sidecar logs/artifacts (`sk-…`/key patterns) | Prevents BYOK keys leaking into logs/exports | 03 |
| **Typed event protocol** for Python-sidecar stdout (NDJSON event kinds) | Cleaner streaming UI than line-scraping | 03 |
| **Idempotency keys** on paper/source ingestion | Safe re-runs, no dupes | 03 |
| **Artifact-manifest convention** for MCP tool results (so the UI renders them richly) | Standardizes how the frontend displays tool output | 05 |

### Wave 2 — high-value, medium effort
| Item | Why for OpenReply | Source §|
|---|---|---|
| **Clarification gate before a research run** (blocking/non-blocking Qs → clarified brief) | Dramatically better results on ambiguous topics; avoids burning budget | 00, 02, 04 |
| **Invariant guard for the SQLite knowledge graph** (unique root, no cycles, parent-reachable, max depth) | Structural validation as a post-write pass | 00 |
| **Traceability matrix** (gap ↔ evidence ↔ source ↔ optional test) | Researcher trust: full thread from conclusion back to raw Reddit/paper/HN | 00 |
| **Human-in-the-loop decision interrupt** mid-run | Course-correct a long research/enrich run instead of all-or-nothing | 00, 02 |
| **NL decomposition → parallel sub-missions (topo-sort)** | "Research 5 topics, compare gaps, produce a report" as one governed flow | 00, 02 |
| **Web-evidence grounding adapter** (force real citations; search→fallback chain) | Validates that LLM gap claims cite real passages | 00 |
| **Session replay** (persist events, replay under isolation) | Re-examine exactly what data drove a gap conclusion | 00, 04 |
| **Dependency invalidation engine** (`STALE`→`RECOMP`) | Adding a source to a topic auto-restales/recomputes downstream gaps/personas | 00 |
| **Skill registry → auto-expose sources as MCP tools** (capability-scored) | Modular, user-configurable research pipelines without code changes | 03, 05 |
| **Capability negotiation in MCP `initialize`** | Clean client/tool capability handshake | 03, 05 |
| **Cost governance / budget alerts** (WARNING→EXCEEDED, model downgrade) | Per-session token budget with graceful model substitution | 00 |

### Wave 3 — larger / strategic (effort L or lower value)
| Item | Note | Source §|
|---|---|---|
| **Companion Critic role** (auto-review gap claims for weak evidence / overconfidence) | Credibility without per-claim human review | 00 |
| **Autopilot L1–L5 formalization** (plan → approve-each-stage → full-auto) | Replace OpenReply's all-or-nothing execution | 00 |
| **Agent/pipeline reputation** (5-dim EMA → auto-pick best pipeline per topic) | Only if OpenReply adds multiple research pipelines | 00, 02 |
| **A2A JSON-RPC envelope** | If OpenReply's MCP server is called by other agents | 00 |
| **Package OpenReply's research pipeline as a standalone skill** (`.zip`, host-agnostic) | Distribution play | 00, 05 |
| **Prompt-skill versioning + canary routing** for research prompts | A/B prompt improvements safely | 05 |

### Client-side (note: OpenReply UI is **vanilla JS**, WhyBuddy is React — translation cost flagged)
| Item | Translation | Source §|
|---|---|---|
| **d3-force + dagre knowledge-graph render** | The d3 code is framework-agnostic — drops into OpenReply's canvas (S) | 01 |
| **BYOK key config panel pattern** (key in store → direct provider `fetch`) | Maps onto OpenReply's existing BYOK; minimal (S) | 01 |
| **Streaming agent-log panel** + **xterm.js** live stdout | Straightforward vanilla port (S–M) | 01 |
| **DOM event bus** for cross-component routing | Directly portable, no React (S) | 01 |
| **Web-worker SHA-256 snapshot hashing** | Portable as-is (S) | 01 |
| **Session export/import** | Useful for sharing research sessions (M) | 01 |

---

## 6. Honest overlap assessment

OpenReply's *per-component* quality (collection, SQLite graph, personas, papers, BYOK resolver, MCP) is comparable to WhyBuddy's. The genuine gap is the **orchestration meta-layer**: clarification → NL decomposition → parallel governed execution → provenance/lineage → human-in-the-loop course-correction → replay. Prioritize that layer; do **not** re-implement WhyBuddy's collection, graph, or LLM-abstraction from scratch.

## 7. Knowledge-graph artifacts (for follow-up queries on WhyBuddy)

- CodeGraph index: `myind-openreply-ref/WhyBuddy/.codegraph/` (2,576 files indexed) — use `codegraph_search` / `codegraph_explore` against that repo.
- Graphify graph: `myind-openreply-ref/WhyBuddy/graphify-out/` (build was finishing at write time) — `graphify query "<q>"` from that dir.

## 8. Next step

Review Wave 1 + the Wave 2 items you care about, pick the set to implement, and we'll spec → plan → build each into OpenReply (same workflow we used for the source layer). My recommendation: start with **provenance labels + checks ledger + lineage + clarification gate**, since together they make every existing OpenReply output auditable and higher-quality with modest effort.
