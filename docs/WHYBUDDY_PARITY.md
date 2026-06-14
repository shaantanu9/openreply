# WhyBuddy → Gap Map — Feature Parity Tracker

> **Updated:** 2026-06-14 · Source: `docs/whybuddy-learnings/00-overview-and-architecture.md` (§2 catalog) cross-checked against `src/gapmap` + `app-tauri`.
> WhyBuddy is an open-source **3D multi-agent spec-rehearsal engine** (one-sentence → SPEC package, 575k TS lines, Three.js scene, Docker executor, UE5). Gap Map is a **multi-source research / gap-discovery desktop app** (Tauri 2 + Python). Many WhyBuddy features are intentionally **not applicable** to our product. This file maps every WhyBuddy §2 feature to one of:
>
> - ✅ **Done** — built and working in our code
> - 🟡 **Portable / not built** — relevant to our domain, could be ported (candidate work)
> - ⛔ **Out of scope** — belongs to WhyBuddy's product (3D/spec-engine/executor); porting = building a different app

## 2.1 Core product rehearsal (one-sentence → SPEC package)
| WhyBuddy feature | Status | Notes |
|---|---|---|
| One-sentence input → SPEC tree | ⛔ | WhyBuddy's whole reason-for-being; our input is a research topic, not a product idea. |
| GitHub deep ingestion | ⛔ | Spec-engine concern. |
| Clarification dialogue → `clarified_brief.json` | ✅ | Clarified-brief (`topic_prefs.brief_*`, `research/brief.py`) + used by the Fleet `clarify` stage. |
| Multi-route planning + confirmation gate | ✅ | `fleet_flow.plan_routes` (quick/standard/deep, risk+cost, recommendation). |
| SPEC tree generation / spec docs (EARS) / arch Mermaid / UI mockups / prompt pack | ⛔ | Spec-engine output; not applicable. (We generate research reports / docx / pptx / pdf instead.) |
| Traceability matrix | ✅ | `gapmap_traceability` (finding → source posts). |
| Handoff/export | ✅ (analog) | `gapmap_export_docx/pptx/pdf`. |

## 2.2 Multi-Agent Collaboration (FSD Fleet) — the core port
| WhyBuddy feature | Status | Notes |
|---|---|---|
| Decision Gate (simple vs complex) | ✅ | `fleet_flow.decision_gate`. |
| Brainstorm board (discussion + voting) | ✅ | 5-persona `deliberate()` debate with CONFIRM/DISPUTE/ABSTAIN voting. |
| Role fleet (Synthesizer/Critic/Skeptic/…) | ✅ (adapted) | 5 fixed debate personas (Synthesizer/Skeptic/Quantifier/Risk Officer/Devil's Advocate) + persona agents. Not WhyBuddy's self-organizing 10-role fleet. |
| Critic / Grounding / Synthesizer roles | ✅ (adapted) | Critic/Synthesizer = debate personas; Grounding = Fleet `ground` stage (persona ingest cited to posts). |
| Dynamic organization (custom org per task) | 🟡 | We use fixed personas; dynamic role generation not built. Low value for our domain. |

## 2.3 Runtime observability
| WhyBuddy feature | Status | Notes |
|---|---|---|
| 3D office scene (Three.js) | ⛔ | Product/demo layer; not applicable to a research tool. |
| Task cockpit / streaming stage progress | 🟡 | Fleet flow has a per-stage timeline + `on_stage` hook; **true live token-streaming not yet wired** (settles from result). |
| Replay / audit timeline | ✅ | Debate ↺ Replay (`debate_audit`); per-round per-persona transcript + checks/lineage. |
| Cost dashboard / budget alerts | ✅ (estimate) | Per-debate token estimate + `GAPMAP_DEBATE_TOKEN_BUDGET` alert levels. Real provider usage not surfaced (char estimate). |

## 2.4 Human-in-the-loop governance
| WhyBuddy feature | Status | Notes |
|---|---|---|
| Takeover points / wait-resume | 🟡 (partial) | Fleet `clarify` stage flags "no brief → attention"; no blocking pause/resume gate. |
| Autopilot L1–L5 levels | 🟡 | Route choice (quick/standard/deep) is an analog; no formal L1–L5 downgrade model. |
| Approval workflow / risk actions | 🟡 | Routes carry a `risk` label; no structured approval state machine. |

## 2.5 Execution layer
| WhyBuddy feature | Status | Notes |
|---|---|---|
| Lobster Docker executor / sandbox / skill jobs / log batching / screenshots | ⛔ | WhyBuddy runs generated code in Docker. We have a Python sidecar + jobs queue (`gapmap_jobs_*`); a Docker code-executor is a different product. |

## 2.6 Quality assurance
| WhyBuddy feature | Status | Notes |
|---|---|---|
| Checks ledger | ✅ | `checks_ledger` + `record_check` (debate writes a `debate_consensus` gate). |
| Invariant guard | ✅ | Graph invariant guard (2B). |
| Provenance labels | ✅ | `lineage` + trust badges (llm / llm_fallback / debated). |
| Companion trace (Critic/Grounding log) | ✅ (analog) | Debate transcript + persona memories. |
| EARS check / preview audit | ⛔ | Spec-engine specific. |

## 2.7 Knowledge & memory
| WhyBuddy feature | Status | Notes |
|---|---|---|
| 3-level agent memory | ✅ | Personas: memories → edges → conclusions → sharing → rejections; Agents tab. |
| Knowledge graph | ✅ | `graph_nodes`/`graph_edges` + dense relations. |
| RAG pipeline / vector search | ✅ | Memory palace (ChromaDB + ONNX MiniLM). |
| Lineage DAG | ✅ | `lineage` table. |

## 2.8 External integrations & interop
| WhyBuddy feature | Status | Notes |
|---|---|---|
| MCP tool proxy | ✅ | Full MCP server (147 tools). |
| NL Command Center (strategic directive → missions) | 🟡 | Fleet flow is a single-topic analog; multi-mission NL decomposition not built. |
| A2A protocol / Swarm cross-pod / Agent reputation / Agent marketplace | ⛔ | Multi-framework/multi-pod agent infra; no use case in a single desktop research app. |
| Feishu bridge / UE5 | ⛔ | Product-specific. |

## 2.9 Web-AIGC node library (50+ nodes)
| WhyBuddy feature | Status | Notes |
|---|---|---|
| OCR / translation / chart-gen / vector ops / etc. as workflow nodes | ⛔ | WhyBuddy's visual-workflow node system. We have purpose-built source adapters (37) + analysis modules instead. |

## 2.10 UI
| WhyBuddy feature | Status | Notes |
|---|---|---|
| i18n / mobile adaptive / ConfigPanel / attachment input / export dialog | ✅ (analog) | Tauri desktop UI, BYOK config panel, export tools. |
| HoloDock / AnomalyAlertPanel / GitHub Pages demo | ⛔ | Product-specific UI. |

---

## Rollup

- **Agent / debate / memory / flow core (§2.2, §2.7, the relevant slice of §2.3/2.6):** ✅ **Done** — debate, agent memory, badges, replay/audit, cost governance, decision gate, multi-route, orchestrated Fleet flow. Merged in PR #1.
- **Genuinely portable, not yet built (🟡):** true live token-streaming of the Fleet flow (highest value); formal takeover/approval gates; autopilot L1–L5 model; NL multi-mission command; dynamic role generation. These are *optional refinements* — pick by value.
- **Out of scope by design (⛔):** SPEC-tree/spec-doc generation, 3D Three.js scene, Docker code-executor, scene-command/UE5, A2A/swarm/reputation/marketplace, Feishu, web-AIGC node library. Porting these = building a different product.

## How to use this file
Tell me a specific 🟡 row and I'll build + test it properly (backend → bridge → UI → tests → changelog), the same way the §2.2 core was shipped. The ⛔ rows are not planned — they don't fit a research desktop app.
