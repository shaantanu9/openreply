# WhyBuddy `shared/` — Deep Technical Analysis

**Date:** 2026-06-13  
**Scope:** `/WhyBuddy/shared/` — all subdirectories and top-level files  
**Method:** Direct file reads of all key contracts, algorithms, and tests

---

## 1. Inventory of What Exists

### Subdirectories (domain libraries)
| Directory | Files | Purpose |
|---|---|---|
| `llm/` | `contracts.ts`, `index.ts` | Multi-provider LLM abstraction |
| `memory/` | `contracts.ts`, `index.ts` | Agent memory R/W interfaces |
| `mission/` | `contracts.ts`, `autopilot.ts`, `api.ts`, `projection.ts`, `socket.ts`, `topic.ts`, `enrichment.ts`, `decision-templates.ts` | Mission lifecycle + autopilot |
| `blueprint/` | 50+ files | Planning system — the largest and most complex domain |
| `rag/` | `contracts.ts`, `api.ts`, `index.ts`, `web-aigc-search.ts` | RAG pipeline contracts |
| `knowledge/` | `types.ts`, `api.ts`, `index.ts` | Knowledge graph entities/relations |
| `lineage/` | `contracts.ts`, `api.ts`, `index.ts`, `socket.ts` | Data lineage tracking |
| `nl-command/` | `contracts.ts`, `api.ts`, `command-list.ts`, `index.ts`, `socket.ts` | NL command center |
| `scene-command/` | `protocol.ts`, `index.ts` | JSON-RPC 2.0 to UE5 |
| `skill/` | `contracts.ts`, `index.ts` | Skill registry |
| `executor/` | `contracts.ts`, `api.ts`, `index.ts`, `skill-manifest.ts` | Execution runtime contracts |
| `permission/` | `contracts.ts`, `api.ts`, `index.ts` | Agent permission model |
| `replay/` | `contracts.ts`, `index.ts`, `store-interface.ts` | Collaboration replay |
| `audit/` | `contracts.ts`, `api.ts`, `index.ts`, `socket.ts` | Audit trail |
| `telemetry/` | `contracts.ts`, `index.ts` | Telemetry |
| `export/` | `contracts.ts`, `index.ts` | Export |
| `demo/` | `contracts.ts`, `index.ts` | Demo mode contracts |
| `web-qa/` | `contracts.ts` | Web QA contracts |
| `ue/` | `contracts.ts`, `reconnect.ts` | Unreal Engine bridge |

### Top-level shared files (non-subdirectory)
Notable standalone files: `workflow-kernel.ts` (38.7 KB — the largest file), `autonomy-types.ts`, `runtime-agent.ts`, `cost-governance.ts`, `reputation.ts`, `ue-character.ts` (19 KB), `cost.ts`, `ring-buffer.ts`, `skill-contracts.ts`, `role-schema.ts`, `workflow-runtime.ts`, `workflow-domain.ts`.

---

## 2. Domain Model Overview — How the Libs Compose

```
User NL input
    │
    ▼
nl-command/   ──── parses strategic command into StrategicCommand
    │               → ClarificationDialog → FinalizedCommand
    ▼
mission/      ──── creates MissionRecord, lifecycle (queued→running→done/failed)
    │               autopilot.ts: drives the MissionAutopilotSummary state machine
    │               → route selection, fleet formation, takeover, recovery
    ▼
blueprint/    ──── generates the execution plan (BlueprintGenerationJob)
    │               clarification/ → route generation → spec_tree → spec_docs
    │               → effect_preview → prompt_packaging → engineering_handoff
    │               whybuddy-turn-route.ts: deterministic visual projection (zero LLM)
    │               whybuddy-plan-validation.ts: validates LLM orchestration proposals
    │               whybuddy-coverage-gate.ts: enforces capability coverage contract
    ▼
executor/     ──── receives ExecutionPlan, runs in Docker/native, emits ExecutorEvent stream
    │               security sandbox: memory/CPU/pids/network limits per SecurityPolicy
    ▼
skill/        ──── hot-pluggable SkillDefinition registry; skills declared (prompt + tools + roles)
    │
    ├─ memory/  ─── MemoryReader/MemoryWriter; MemoryIndex fanout (vector + graph)
    ├─ rag/     ─── RAG pipeline steps: parse→chunk→embed→store→retrieve→rerank→generate
    ├─ knowledge/ ─ Entity/Relation knowledge graph with OntologyRegistry
    ├─ lineage/ ─── DataLineageNode DAG; impact analysis; compliance tagging
    ├─ permission/ ─ Agent-Resource-Action permission matrix + CapabilityToken
    └─ replay/  ─── ExecutionEvent timeline; playback engine; cost/perf analysis
```

---

## 3. Per-Library Deep Dives

### 3.1 `shared/llm/` — Multi-Provider LLM Abstraction

**Path:** `shared/llm/contracts.ts` (151 lines), re-exported by `shared/llm/index.ts`

**Purpose:** Provider-agnostic interface for LLM generation, streaming, embedding, and health checks. Migrated from `rbac-system-pc` but converted from class+Sequelize to pure interfaces + functional factory registry.

**Key types:**

```typescript
// shared/llm/contracts.ts:30
interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string | LLMContentPart[];  // multimodal: text + image_url
}

// shared/llm/contracts.ts:86
interface ILLMProvider {
  readonly name: string;
  generate(messages, options?): Promise<LLMGenerateResult>;
  streamGenerate(messages, options?): AsyncGenerator<string>;
  embed?(texts): Promise<LLMEmbedResult>;       // optional
  healthCheck(): Promise<LLMHealthCheckResult>;
  isTemporaryError?(error): boolean;             // for retry logic
}

// shared/llm/contracts.ts:122
interface ILLMProviderRegistry {
  register(type: string, factory: LLMProviderFactory): void;
  create(config: LLMProviderConfig): ILLMProvider;
  has(type): boolean;
  list(): string[];
}
```

**`LLMGenerateOptions`** (`contracts.ts:39`): includes `temperature`, `maxTokens`, `model` override, `stream`, `jsonMode`, `reasoningEffort` ("low"/"medium"/"high").

**`LLMGenerateResult`** (`contracts.ts:58`): echoes back `model` and `provider` actually used — important for audit trails.

**Pre-defined provider types** (`contracts.ts:137`): `openai`, `zhipu`, `qwen`, `browser-direct`, `server-proxy`. The `browser-direct` type is critical — the entire app can run without a backend by wiring the LLM call through the browser directly.

**Core design contract:** Every call returns provenance (which model + provider ran it). The registry decouples configuration from instantiation, enabling runtime provider swaps with no call-site changes.

---

### 3.2 `shared/memory/` — Agent Memory System

**Path:** `shared/memory/contracts.ts` (158 lines)

**Purpose:** Defines the read/write/index layering for per-agent persistent memory. Explicitly designed so knowledge-graph and RAG pipeline can each register as independent `MemoryIndex` implementations.

**Key types:**

```typescript
// contracts.ts:18
interface MemoryEntry {
  id: string;
  agentId: string;
  source: MemorySource;  // "workflow_summary" | "llm_exchange" | "soul_patch" | ...
  content: string;
  metadata: MemoryMetadata;  // workflowId, missionId, stage, role, keywords, score
  createdAt: number;
  updatedAt: number;
}

// contracts.ts:66
interface MemoryReader {
  search(query: MemorySearchQuery): Promise<MemorySearchHit[]>;  // semantic + keyword
  get(agentId, entryId): Promise<MemoryEntry | null>;
  listRecent(agentId, source?, limit?): Promise<MemoryEntry[]>;
  getStats(agentId): Promise<MemoryStats>;
}

// contracts.ts:96
interface MemoryWriter {
  write(input): Promise<MemoryEntry>;
  writeBatch(inputs): Promise<MemoryEntry[]>;
  updateMetadata(agentId, entryId, metadata): Promise<void>;
  delete(agentId, entryId): Promise<void>;
  materializeWorkflow(workflowId): Promise<number>;  // post-workflow consolidation
}

// contracts.ts:117
interface MemoryIndex {
  name: string;
  onEntryWritten(entry): Promise<void>;   // fanout on write
  onEntryDeleted(agentId, entryId): Promise<void>;
  rebuild(agentId): Promise<void>;
}
```

**Pattern:** `MemoryIndexRegistry` allows multiple indices (vector, graph) to receive writes without the core writer knowing about them. This is a pub-sub variant: `MemoryWriter.write()` calls `MemoryIndexRegistry.getAll()` and fans out.

---

### 3.3 `shared/rag/` — RAG Pipeline

**Path:** `shared/rag/contracts.ts` (309 lines)

**Purpose:** Two-layer contract. Layer 1: step-based pipeline executor interface. Layer 2: full data model for chunks, ingestion, retrieval, feedback, dead-letter, and lifecycle.

**Step types** (`contracts.ts:66`): `parse` → `chunk` → `embed` → `store` → `retrieve` → `rerank` → `generate`. Each step receives and returns `RAGPipelineContext`.

**`RAGPipelineContext`** (`contracts.ts:25`): carries query, fileContent, parsed text, chunks, vectors, retrievedDocs, final answer, and sources through the pipeline. Steps mutate only their own fields.

**Vector store abstraction** (`contracts.ts:148`):
```typescript
interface IVectorStore {
  insert(collection, records): Promise<void>;
  search(collection, queryVector, topK): Promise<VectorSearchResult[]>;
  delete(collection, ids): Promise<void>;
}
```
Current implementation: local 96-dim token-hash store. Upgrade path: Milvus/pgvector adapter, same interface.

**`IngestionPayload`** (`contracts.ts:196`): sourceType (7 types including `architecture_decision`, `bug_report`), content, projectId, timestamp. Chunk IDs follow `${sourceType}:${sourceId}:${chunkIndex}` format — stable, collision-free.

**`RAGAugmentationLog`** (`contracts.ts:253`): tracks which chunks were retrieved, injected, and pruned per task. Enables RAG quality auditing.

**`DeadLetterEntry`** (`contracts.ts:271`): captures ingestion failures by stage with retry count — essential for reliable pipelines.

---

### 3.4 `shared/knowledge/` — Knowledge Graph

**Path:** `shared/knowledge/types.ts` (279 lines)

**Purpose:** Entity-Relation graph with OntologyRegistry-backed type validation, confidence scoring, review workflow, and GC.

**Core types** (`types.ts:34`):
```typescript
interface Entity {
  entityId: string;           // UUID v4
  entityType: string;         // from OntologyRegistry
  confidence: number;         // 0.0-1.0
  source: EntitySource;       // "agent_extracted" | "user_defined" | "code_analysis" | "llm_inferred"
  needsReview: boolean;
  linkedMemoryIds: string[];  // links to vector memory entries
  extendedAttributes: Record<string, unknown>;
}

interface Relation {
  relationId: string;
  relationType: string;       // from OntologyRegistry
  weight: number;             // 0.0-1.0
  evidence: string;           // textual evidence for the relation
  confidence: number;
}
```

**Extended attribute pattern** (`types.ts:72`): `CodeModuleExtended`, `APIExtended`, `ArchitectureDecisionExtended` — typed structs for domain-specific entity kinds stored in `extendedAttributes`.

**`GCConfig`** (`types.ts:258`): archive after 90 days, delete low-confidence (<0.3) after 30 days, merge duplicates above 0.9 similarity. The GC contract is explicit and configurable.

**`UnifiedKnowledgeResult`** (`types.ts:129`): merges structured (graph) and semantic (vector) results — the key integration point between knowledge graph and RAG.

---

### 3.5 `shared/lineage/` — Data Lineage & Provenance

**Path:** `shared/lineage/contracts.ts` (291 lines)

**Purpose:** Tracks how data flows between sources, transformations, and decisions. Full DAG with audit trail, compliance tags, change alerts, and impact analysis.

**Node types** (`contracts.ts:11`): `source` | `transformation` | `decision`. Each node carries its upstream and downstream IDs.

**`DataLineageNode`** (`contracts.ts:38`):
- Source nodes: sourceId, queryText, resultHash, resultSize
- Transformation nodes: agentId, operation, codeLocation ("filename:line"), inputLineageIds
- Decision nodes: decisionId, decisionLogic, result, confidence, modelVersion

**`LineageEdge`** (`contracts.ts:94`): typed as `derived-from`, `input-to`, `decided-by`, `produced-by`. Weighted 0-1.

**`ChangeAlert`** (`contracts.ts:138`): alerts on `schema_change`, `data_volume_anomaly`, `quality_degradation`, `hash_mismatch`. Tracks affected agents and decisions by ID — enables downstream impact notification.

**`ImpactAnalysisResult`** (`contracts.ts:208`): given a changed node, returns all affected downstream nodes, decisions, and paths. This enables "what breaks if X changes" queries.

**Key insight:** Compliance tags (`complianceTags: string[]`) on lineage nodes enable GDPR/PCI audit trails at the data-flow level, not just the access-log level.

---

### 3.6 `shared/nl-command/` — Natural Language Command Center

**Path:** `shared/nl-command/contracts.ts` (488 lines)

**Purpose:** Defines the full lifecycle from a user typing a strategic natural language command to an approved, executing plan. Much more than intent parsing — this is an entire planning orchestration protocol.

**Command lifecycle** (`contracts.ts`):
```
draft → analyzing → clarifying → finalized → decomposing → planning
     → approving → executing → completed/failed/cancelled
```

**`StrategicCommand`** (`contracts.ts:30`): captures commandText, userId, parsedIntent, constraints (budget/time/quality/resource), objectives, priority (critical/high/medium/low), and timeframe.

**`CommandAnalysis`** (`contracts.ts:58`): intent, entities (typed: module/service/team/technology), constraints, risks, assumptions, confidence score, needsClarification flag.

**`MissionDecomposition`** (`contracts.ts:113`): breaks a command into `DecomposedMission[]` with dependencies and `executionOrder: string[][]` (2D array — each inner array is a set of parallel missions).

**`NLExecutionPlan`** (`contracts.ts:171`): full plan with timeline (including critical path), resource allocation (agentType+skills per task window), risk assessment (probability × impact per risk), cost budget (broken down by mission/agent/model), and contingency plan.

**`PlanApprovalRequest`** (`contracts.ts:269`): multi-approver workflow with approval status per approver. The approval contract is explicit — required approvers list, decisions array, timestamps.

**`PlanAdjustment`** (`contracts.ts:288`): structured change proposal — entity/field/oldValue/newValue diffs with impact assessment (timeline, cost, risk).

**`OptimizationReport`** (`contracts.ts:479`): post-execution learning — tracks duration/cost accuracy and decomposition quality over a time period, outputs recommendations. Closes the feedback loop.

---

### 3.7 `shared/scene-command/` — UE5 Scene Protocol

**Path:** `shared/scene-command/protocol.ts` (339 lines)

**Purpose:** JSON-RPC 2.0 protocol for LLM director → Unreal Engine 5 real-time commands.

**Methods** (`protocol.ts:7`): `character.moveTo`, `character.playAnimation`, `camera.setPreset`, `camera.transition`, `scene.setState`, `effect.play`, `effect.stop`. Extensible via custom string method names.

**Each method has a Zod schema** (`protocol.ts:181`): validated at runtime. `PARAM_SCHEMAS` map routes each method to its Zod validator.

**Error codes** (`protocol.ts:67`): standard JSON-RPC codes plus custom `-32000` (EXECUTION_FAILED), `-32001` (TIMEOUT), `-32002` (QUEUE_FULL), `-32003` (NOT_CONNECTED). `RETRYABLE_ERROR_CODES` set drives retry logic.

**Factory functions** (`protocol.ts:299`): `createCommand()`, `createSuccessResult()`, `createErrorResult()` — prevent manual JSON-RPC envelope construction.

**Notable pattern:** `validateParams()` passes unknown custom methods silently (returns `{success: true}`), allowing extension without schema breaks.

---

### 3.8 `shared/skill/` — Skill Registry

**Path:** `shared/skill/contracts.ts` (177 lines)

**Purpose:** Hot-pluggable skill system. Each Skill declares system prompt, tool bindings, applicable roles, and task profiles. The registry enables dynamic enable/disable and dependency checking.

**`SkillDefinition`** (`contracts.ts:23`):
```typescript
interface SkillDefinition {
  id: string;
  version: string;         // semver
  category: SkillCategory; // analysis | coding | writing | research | planning | review | ...
  systemPrompt: string;
  tools: SkillToolBinding[];
  applicableRoles: AgentRole[];
  applicableTaskProfiles?: string[];
  enabledByDefault: boolean;
  dependencies?: string[];  // skill-to-skill deps
}
```

**`ISkillRegistry`** (`contracts.ts:125`): `register()`, `get()`, `getByRole()`, `getByTaskProfile()`, `getByCategory()`, `list()`, `setEnabled()`, `checkDependencies()`, `unregister()`.

**`SkillLifecycleEvent`** (`contracts.ts:150`): union type for registered/enabled/disabled/unregistered/executed. Enables audit of skill usage.

---

### 3.9 `shared/executor/` — Execution Runtime

**Path:** `shared/executor/contracts.ts` (337 lines)

**Purpose:** Defines the contract between the mission orchestrator and the "lobster" executor (Docker-backed). Everything needed to submit a job, receive event streams, and enforce security.

**Capabilities list** (`contracts.ts:53`): 34 capability strings including `runtime.docker`, `runtime.native`, `runtime.mock`, `executor.cancel/pause/resume`, `security.*`, `node`, `python`, `ai.llm`, `artifact.*`, `preview.*`, `browser.playwright`, `document.libreoffice`, `media.ffmpeg`.

**`ExecutionPlan`** (`contracts.ts:200`): version-pinned, carries steps (with `PhaseAssignment[]` for dynamic role system), jobs (keyed, with kind enum: scan/analyze/plan/codegen/execute/report/custom), artifacts, and mode (auto/reuse/managed).

**`ExecutorJobRequest`** (`contracts.ts:229`): includes `idempotencyKey` — idempotent job submission. Also includes `traceId` for distributed tracing.

**`ExecutorEvent`** (`contracts.ts:255`): event stream type. Includes base64 PNG screenshots (`imageData`) and terminal log streams — the live preview system runs entirely through this event type.

**`SecurityPolicy`** (`contracts.ts:308`): `level` (strict/balanced/permissive), `user` (runs as nobody by default), `readonlyRootfs`, `noNewPrivileges`, `capDrop: ["ALL"]`, resource limits (memory/cpus/pids/tmpfs), network mode (none/whitelist/bridge). This is the full Docker seccomp/capabilities security model as a typed contract.

---

### 3.10 `shared/permission/` — Agent Permission Model

**Path:** `shared/permission/contracts.ts` (205 lines)

**Purpose:** Three-dimensional permission model: Agent × Resource × Action. Sits above the Docker sandbox — it's the governance layer.

**Resource types** (`contracts.ts:10`): `filesystem`, `network`, `api`, `database`, `mcp_tool`.

**Actions** (`contracts.ts:13`): `read`, `write`, `execute`, `delete`, `connect`, `call`, `select`, `insert`, `update`.

**`Permission`** (`contracts.ts:49`): resourceType + action + constraints + effect (allow/deny). Constraints include path patterns, domain patterns, CIDR ranges, port ranges, rate limits, row-level filters, query timeouts.

**`AgentPermissionPolicy`** (`contracts.ts:70`): assignedRoles + customPermissions + deniedPermissions + expiry. The deny list takes precedence.

**`CapabilityToken`** (`contracts.ts:100`): JWT-like token carrying the effective permission matrix. Agents receive this token and present it to tool adapters.

**`GovernanceDecision`** (`contracts.ts:134`): `outcome` (allowed/blocked/approval_required), `riskLevel`, `policyId`, `rationale`, `requiresAudit`. Attached to audit entries when a governance policy fires.

**`PermissionEscalation`** (`contracts.ts:183`): formal escalation request with approver list and resolution tracking.

---

### 3.11 `shared/replay/` — Collaboration Replay

**Path:** `shared/replay/contracts.ts` (277 lines)

**Purpose:** Full event log capture and playback for mission executions. Enables post-mortem analysis, compliance review, and training data generation.

**`ExecutionEvent`** (`contracts.ts:69`): eventId, missionId, timestamp, eventType, sourceAgent, targetAgent, eventData, plus metadata (phase, cost, tokenUsage, checksum).

**Event types** (`contracts.ts:10`): `AGENT_STARTED/STOPPED`, `MESSAGE_SENT/RECEIVED`, `DECISION_MADE`, `CODE_EXECUTED`, `RESOURCE_ACCESSED`, `ERROR_OCCURRED`, `MILESTONE_REACHED`.

**`ExecutionTimeline`** (`contracts.ts:147`): holds the event array plus four indices: `byTime: Map<number, number[]>`, `byAgent`, `byType`, `byResource`. Pre-indexed for O(1) slice queries.

**`ReplaySnapshot`** (`contracts.ts:189`): named point-in-time snapshot of replay state — camera position, filter state, cursor position, playback speed. Multiple snapshots per replay session.

**`PerformanceMetrics`** (`contracts.ts:248`): stage durations with bottleneck flag, LLM call stats (count/avg response time/total tokens), concurrency timeline (active agents over time).

**`CostSummary`** (`contracts.ts:238`): total cost + breakdown by agent/model/operationType + `CostAnomaly[]` (events that exceed cost threshold).

---

### 3.12 `shared/mission/` — Mission Lifecycle

**Path:** `shared/mission/contracts.ts` (933 lines), `shared/mission/autopilot.ts` (4079 lines)

**Purpose:** The core mission record and the autopilot state machine that drives it.

**`MissionRecord`** (`contracts.ts:698`): id, kind, title, sourceText, status (queued/running/waiting/done/failed/cancelled), progress (0-100), stages array, artifacts, agentCrew, workPackages, messageLog, decision, decisionHistory, operatorActions, securitySummary, previewSession, projection links.

**Six core stages** (`contracts.ts:589`): receive → understand → plan → provision → execute → finalize. These are the universal stage blueprint every mission follows.

**HITL (Human-in-the-Loop) system** (`contracts.ts:87`): `WEB_AIGC_HITL_NODE_TYPES` defines 7 interaction node types. `WebAigcHitlFieldDefinition` defines typed form fields (text/textarea/number/boolean/selection/attachment). The `normalizeWebAigcHitlFormData()` function (`contracts.ts:462`) provides centralized, validated form normalization with per-field error reporting.

**`MissionAutopilotSummary`** (`autopilot.ts:782`): the richest type in the codebase. Aggregates:
- `destination`: goal, task type, sub-goals, constraints, success criteria, missing info, confidence
- `route`: candidate routes, selection status, replan summary, evidence
- `driveState`: current drive state (understanding/clarifying/planning/fleet-forming/executing/reviewing/blocked/takeover-required/replanning/delivered)
- `fleet`: active roles and their statuses
- `takeover`: if human takeover is needed, why and what options exist
- `execution`: current step, parallel branch count, blockers
- `recovery`: deviation category, attempted actions, auto-recover flag
- `evidence`: correlation index linking missionId → workflowId → replayId → lineageIds
- `explanation`: natural language summary of current state + next steps

**Route resolution** (`autopilot.ts:1515`): `readResolvedRouteSelection()` walks decision history in reverse to find the last `multi-choice` decision that contains route selection metadata. Handles multiple field name aliases (selectedRouteId / formData.selectedRouteId / payload.selectedRouteId).

---

## 4. The Planning System — blueprint/ + mission/ + clarification/

### 4.1 Blueprint Generation Pipeline

The blueprint system is the most sophisticated part of WhyBuddy's shared layer. It turns a user intent into an executable engineering plan through 10 stages.

**Stages** (`contracts.ts:13`):
```
input → clarification → route_generation → spec_tree → spec_docs
      → preview (effect_preview) → prompt_packaging
      → runtime_capability → engineering_handoff → engineering_landing
```

**V5 Capability Pool** (`contracts.ts:109`): 33 capabilities organized as `domain.verb` identifiers. These are the atomic units the orchestrator dispatches:

```
intent.parse, intent.clarify, context.collect, source.classify,
gap.ask, question.expand, assumption.validate,
route.generate, route.compare, tradeoff.evaluate,
structure.decompose, document.draft, requirement.write, design.write, task.write,
scenario.simulate, ux.preview, outcome.visualize,
instruction.package, execution.prepare,
evidence.search, repo.inspect, mcp.call, skill.invoke,
risk.analyze, counter.argue, argument.expand, critique.generate, rebuttal.resolve,
synthesis.merge, report.write,
memory.recall, traceability.matrix, handoff.package
```

Each capability maps to a default role (`whybuddy-capability-catalog.ts:44`):
- `产品` (Product): intent.parse, intent.clarify, context.collect, gap.ask, requirement.write
- `架构` (Architecture): route.generate, structure.decompose, design.write
- `工程` (Engineering): route.compare, task.write, scenario.simulate, execution.prepare
- `安全` (Security): assumption.validate, risk.analyze
- `接地` (Grounding): evidence.search, memory.recall
- `挑刺` (Challenger): counter.argue, argument.expand, critique.generate
- `综合` (Synthesis): document.draft, rebuttal.resolve, synthesis.merge, report.write

### 4.2 Clarification Strategy

`BlueprintClarificationSession` (`contracts.ts:541`) tracks:
- `strategyId`: `target_first`, `repository_first`, `risk_first`, `document_first`, `preview_first`, `fast_execution`
- `readinessSignals`: 10 signals (goal_defined, audience_defined, constraints_defined, repository_context, etc.)
- Questions carry `routeDimension` (goal/audience/risk/domain/execution) and `settledByStrategy` flag

The `readiness.score` and `readiness.status` ("needs_answers" / "ready") gate whether route generation can proceed.

### 4.3 Route Generation

`BlueprintRouteSet` (`contracts.ts:1019`): the output of route generation. Contains:
- Multiple `BlueprintRouteCandidate` objects (each with riskLevel/costLevel/complexity/estimatedEffort/steps/capabilities)
- `primaryRouteId` — the recommended route
- `provenance` — full audit trail of which LLM model and strategy was used

Route candidates carry `kind: "primary" | "alternative"` and full step-by-step breakdowns with role assignments.

### 4.4 Spec Tree → Documents Pipeline

After route selection, `BlueprintSpecTree` decomposes into nodes (`BlueprintSpecTreeNode`). Node actions are versioned and support add/delete/move/merge/split operations (`BlueprintSpecTreeActionRequest` discriminated union, `contracts.ts:1164`).

Each `BlueprintSpecDocument` (`contracts.ts:1219`) has type (requirements/design/tasks), versioned snapshots, and provenance tracking (generationSource: `"llm"` | `"llm_fallback"` | `"template"`, plus promptId, model, responseDigest, structuredPayloadDigest, promptFingerprint).

### 4.5 Turn Route Projection — `whybuddy-turn-route.ts`

The most elegant algorithm in the shared layer. `deriveTurnRoute(facts: TurnRouteFacts): RouteStation[]` builds a visual "execution trace" from runtime-recorded facts — zero LLM calls, zero state writes.

**Key insight:** The function takes `TurnRouteFacts` (runtime-observed data: which capabilities were selected, budget status, trust gate results, closure reason) and deterministically produces a typed graph of `RouteStation[]` with:
- V5.1 architecture node IDs (INTAKE, ORCH, BUDGET, BUS, GCOV, T_GATE, DONE, AWAIT)
- Topology (depth, lane, parentId, linkKind: forward/parallel/reentry)
- User-readable titles/details in Chinese
- Branch indices for parallel capability execution

**Multi-round support** (`turn-route.ts:662`): `deriveMultiRoundRoute()` handles the Session_Driver re-entering the planning loop multiple times. Each round gets its own BUDGET→ORCH→capability station triple, with GCOV→BUDGET reentry edges between rounds.

**`wireTreeTopology()`** (`turn-route.ts:494`): assigns depth (0=INTAKE through 6=AWAIT), lane (0=spine, ≥1=parallel BUS branches), parentId for tree rendering, and reentry arc metadata. This is what enables rendering a DAG from a flat station array.

### 4.6 Plan Validation — `whybuddy-plan-validation.ts`

`validateProposedPlan()` validates LLM orchestration proposals. Key behaviors:
- Tolerates `_` vs `.` in capability IDs (resolves `scenario_preview` → `scenario.simulate`)
- Handles LLM field aliases (`capability`, `cap`, `id` → `capabilityId`)
- Deduplicates capabilities across the proposal
- Clamps to MAX_ITEMS = 4 capabilities per plan
- Falls back to `CAPABILITY_DEFAULT_ROLES` when the LLM proposes an invalid role
- Returns `dropped[]` array documenting every rejected item and reason

### 4.7 Coverage Gate — `whybuddy-coverage-gate.ts`

`evaluateCoverageGate()` is the "can we ship" check:
1. Author a `CoverageContract` based on goal complexity (simple vs complex)
2. Check all required capabilities have trusted+committed artifacts in the ledger
3. Check grounded external evidence exists (`G-GROUND` gate)
4. If `report.write` is selected, require `minEvidencePerRequirement` grounded artifacts

**Server-side guard** (`coverage-gate.ts:169`): `buildGcovAuthoritativeStateForPut()` ensures the server never trusts client-submitted trustLevel or capabilityRuns. When the client sends PUT with `goal.status=clear`, the server recomputes GCOV from its own persisted ledger. If coverage is insufficient, it reverts the status and appends a system message explaining the rejection.

### 4.8 Ship Gates — `whybuddy-ship-gates.ts`

Dual-speed gate evaluation:
- **Commit-time** (`evaluateCommitGates()`): schema, invariant, confirm, precondition, ground, commit gates — run when each capability commits an artifact
- **Ship-time** (`evaluateShipGates()`): T_CONTENT (has audited report), T_TEST (goal.status=clear), T_MERGE (has handoff.package artifact) — run before DONE

---

## 5. LLM Abstraction — How `shared/llm/` Is Used

The `ILLMProvider` interface is implemented per-provider (OpenAI-compatible, ZhiPu GLM, Qwen). Key design decisions:

1. **`reasoningEffort`** in `LLMGenerateOptions` — maps to different parameters per provider (e.g., o1's reasoning tokens, Claude's extended thinking). The abstraction normalizes this.

2. **`isTemporaryError()`** on the provider — enables automatic retry with backoff for rate limits/timeouts without the orchestrator knowing provider-specific error codes.

3. **`embed()` optional** — not all providers support embeddings. Callers check `provider.embed` before calling, avoiding null pointer errors.

4. **Result echoes actual model/provider** — when an orchestrator routes to a fallback provider, the result's `provider` and `model` fields reflect what actually ran. This feeds the provenance system.

5. **`browser-direct` type** — the entire app can run provider calls from the browser without a backend. This is a first-class supported configuration, not a hack.

---

## 6. Notable Patterns Worth Stealing

### Pattern 1: `as const` Array + Union Type Derivation

Used everywhere:
```typescript
// mission/contracts.ts:6
export const MISSION_STAGE_STATUSES = ["pending", "running", "done", "failed"] as const;
export type MissionStageStatus = (typeof MISSION_STAGE_STATUSES)[number];
```
No string enum, no duplication. The array is the runtime source of truth (used for validation); the type is derived from it. Changing the array changes the type.

### Pattern 2: Provenance on Every LLM Output

Every LLM-generated artifact carries `generationSource: "llm" | "llm_fallback" | "template"`, plus `promptId`, `model`, `responseDigest`, `structuredPayloadDigest`, `promptFingerprint`. This makes the system auditable and allows fallback detection without inspecting content.

### Pattern 3: Deterministic Visual Projection from Runtime Facts

`deriveTurnRoute()` in `whybuddy-turn-route.ts` builds the entire visual trace from recorded runtime facts (no LLM, no mutable state). The separation between "what happened" (facts) and "how to display it" (projection) makes the UI testable in isolation. Tests can provide `TurnRouteFacts` and assert on the `RouteStation[]` output without mocking any LLM.

### Pattern 4: Forbidden Terms Assertion for UI Copy

```typescript
// whybuddy-turn-route.ts:243
const FORBIDDEN_TERMS = /\b(stale|artifact|upstream)\b/i;

export function assertRouteCopySanitized(stations: RouteStation[]): void {
  for (const s of stations) {
    const blob = `${s.title} ${s.detail || ""}`;
    if (FORBIDDEN_TERMS.test(blob)) {
      throw new Error(`Route copy contains forbidden term: ${blob}`);
    }
  }
}
```
Engineering terms are forbidden in user-facing copy. This is enforced as a test assertion, not a lint rule — it runs in CI.

### Pattern 5: Server-Side GCOV Guard

The server recomputes coverage gate state from its own persisted ledger on every PUT. Client-submitted `trustLevel` and `capabilityRuns` are ignored. This prevents client-side forgery of completion states.

### Pattern 6: Discriminated Union for Tree Actions

```typescript
// blueprint/contracts.ts:1164
export type BlueprintSpecTreeActionRequest =
  | { action: "add_node"; parentId: string; title: string; ... }
  | { action: "delete_node"; nodeId: string; }
  | { action: "move_node"; nodeId: string; parentId: string; priority?: number; }
  | ...
```
No string-keyed payload objects. Each action type carries exactly the fields it needs.

### Pattern 7: RAG Dead Letter Queue

```typescript
// rag/contracts.ts:271
interface DeadLetterEntry {
  entryId: string;
  payload: IngestionPayload;
  error: string;
  failedAt: string;
  retryCount: number;
  stage: 'clean' | 'chunk' | 'embed' | 'store' | 'metadata';
}
```
Failed ingestion is captured with the failure stage. Retry can resume from the exact failing step rather than re-running the entire pipeline.

### Pattern 8: Coverage Contract Authoring vs Gate Evaluation Split

`authorCoverageContract()` generates the contract from the goal text (simple vs complex mode). `evaluateCoverageGate()` checks the runtime state against the contract. These are separate functions — the contract is authored once at session start, the gate is evaluated repeatedly.

### Pattern 9: RingBuffer for Task History

`autonomy-types.ts` uses `RingBuffer<TaskHistoryEntry>` (capacity-bounded circular buffer from `shared/ring-buffer.ts`) for agent task history. Prevents unbounded memory growth while maintaining recency.

### Pattern 10: Idempotency Key on Executor Jobs

`ExecutorJobRequest.idempotencyKey` ensures exactly-once semantics for job submission. If the network drops after the job is accepted but before the response is received, resubmitting with the same key returns the existing job rather than creating a duplicate.

---

## 7. Port to Gap Map — Concrete Adoption Recommendations

Gap Map is a research paper discovery and gap analysis desktop app (Tauri + Python sidecar). It needs: multi-source paper ingestion, LLM-powered gap analysis, session persistence, and research workflow tracking.

### 7.1 High Value, Small Effort

**`shared/llm/contracts.ts` → Port the `ILLMProvider` + `ILLMProviderRegistry` interfaces verbatim**  
**Effort:** S | **Value:** H

Gap Map currently hardcodes the Anthropic provider in several places. The registry pattern enables:
- Runtime provider switching (user can choose OpenAI vs Anthropic)
- `isTemporaryError()` for automatic retry on rate limits
- `embed()` optional interface for switching embedding providers
- `reasoningEffort` for controlling cost vs quality per query type

Adopt the exact interface. Implement one `OpenAICompatProvider` (covers Anthropic via `/v1/chat/completions`) and one `BrowserDirectProvider`.

---

**`as const` array + derived union type pattern → Apply throughout**  
**Effort:** S | **Value:** M

Replace string literal unions defined inline with the `as const` + `(typeof X)[number]` pattern for all status/kind enums. Provides a runtime array for validation and a compile-time type from a single source.

---

**`RAGPipelineContext` + step chain pattern → Paper ingestion pipeline**  
**Effort:** M | **Value:** H

Gap Map's current paper ingestion is ad-hoc. Adopting the pipeline pattern:
- Each step (`parse`, `chunk`, `embed`, `store`) implements `IRAGPipelineStep`
- `RAGPipelineContext` carries paper content through all steps
- `DeadLetterEntry` captures papers that fail to ingest at specific stages
- The registry allows swapping embedding providers without touching ingestion logic

The chunk ID format `${sourceType}:${sourceId}:${chunkIndex}` is directly applicable (`paper:{paperId}:{chunkIndex}`).

---

**`DataLineageNode` + `LineageEdge` → Research provenance tracking**  
**Effort:** M | **Value:** H

Gap Map generates LLM-inferred gap analyses. Tracking data lineage enables:
- Knowing which papers contributed to which gaps
- Which LLM model version produced a specific analysis
- `ChangeAlert` when upstream paper metadata changes (retraction, new version)
- Compliance: if a paper is retracted, mark affected gaps as needing re-evaluation

Implement `lineageId` on each `GapAnalysisResult` and trace back to source paper chunks. This is the foundation for reproducibility claims.

---

### 7.2 High Value, Medium Effort

**`knowledge/types.ts` Entity/Relation model → Paper knowledge graph**  
**Effort:** M | **Value:** H

Papers have entities (Author, Institution, Method, Finding, Dataset) and relations (cites, extends, contradicts, uses-method, produced-at). The existing SQLite graph_nodes/graph_edges schema in Gap Map is simpler than this model. Adopting:
- `confidence: number` on entities (LLM-inferred entities get lower confidence)
- `needsReview: boolean` for human-in-the-loop quality control
- `linkedMemoryIds: string[]` linking entities to their source paper chunks
- `GCConfig` for archiving stale entities (papers >2 years old get lower priority)

The `UnifiedKnowledgeResult` pattern (merge structured graph + semantic vector results) is exactly what Gap Map needs for the "find related work" feature.

---

**`MemoryReader`/`MemoryWriter`/`MemoryIndex` pattern → Research session memory**  
**Effort:** M | **Value:** M

Gap Map has no concept of session memory. Adopting this would enable:
- Storing previous search queries and their results as `MemoryEntry` with source `"workflow_summary"`
- Semantic search over past research sessions
- `materializeWorkflow()` to consolidate a research session into compact memory after completion
- Multiple index backends (vector + graph) via `MemoryIndexRegistry`

The `MemorySource` union can be extended with `"paper_search"`, `"gap_analysis"`, `"citation_traversal"`.

---

**`MissionRecord` + stage lifecycle → Research workflow tracking**  
**Effort:** M | **Value:** M

Gap Map could model each research topic as a "mission" with stages matching the research workflow:
- `receive` → query received
- `understand` → topic canonicalization  
- `plan` → search strategy generation
- `provision` → source APIs initialized
- `execute` → paper retrieval and embedding
- `finalize` → gap analysis generation

The 6-stage blueprint maps cleanly. `MissionArtifact` covers gap reports, citation graphs, and downloaded papers.

---

### 7.3 Medium Value, Large Effort (Defer)

**Blueprint V5 capability pool + turn-route projection**  
**Effort:** L | **Value:** M  
Overkill for Gap Map's current scope. The concept of routing through named capabilities (intent.parse → evidence.search → synthesis.merge → report.write) is sound, but implementing the full orchestrator, coverage gate, and ship gate system requires significant infrastructure. Consider adopting the **names** of the capabilities (as an enum/vocabulary) while implementing a simpler sequential executor.

---

**`nl-command/` StrategicCommand → NL research directive**  
**Effort:** M | **Value:** M  
Gap Map's research mode could benefit from the command decomposition pattern — user types "find gaps in transformer architecture for edge inference" → decompose into multiple sub-queries with dependency order. The `MissionDecomposition.executionOrder: string[][]` (parallel layers) is directly applicable to Gap Map's multi-source concurrent fetch strategy. But the full clarification dialog and approval workflow is not needed at this stage.

---

**`replay/` ExecutionTimeline**  
**Effort:** L | **Value:** L  
Full collaboration replay is not needed for a single-user desktop research tool. Skip.

---

**`scene-command/` UE5 protocol**  
**Effort:** S | **Value:** L  
Not applicable to Gap Map. Interesting JSON-RPC 2.0 Zod validation pattern but the domain is irrelevant.

---

### 7.4 Summary Table

| Component | What to adopt | Effort | Value |
|---|---|---|---|
| `llm/contracts.ts` | ILLMProvider + ILLMProviderRegistry interfaces verbatim | S | H |
| `as const` pattern | Everywhere status/kind enums exist | S | M |
| `rag/contracts.ts` | RAGPipelineContext + IRAGPipelineStep + DeadLetterEntry | M | H |
| `lineage/contracts.ts` | DataLineageNode + LineageEdge for paper provenance | M | H |
| `knowledge/types.ts` | Entity/Relation model for paper graph | M | H |
| `memory/contracts.ts` | MemoryReader/Writer/Index for session memory | M | M |
| `mission/contracts.ts` | MissionRecord + 6-stage blueprint for research workflows | M | M |
| `nl-command/contracts.ts` | MissionDecomposition.executionOrder for parallel queries | S | M |
| `blueprint/whybuddy-plan-validation.ts` | validateProposedPlan() tolerance patterns (alias resolution, dedup, clamping) | S | M |
| `blueprint/whybuddy-coverage-gate.ts` | Server-side guard pattern (never trust client-submitted completions) | M | H |
| `blueprint/whybuddy-ship-gates.ts` | Dual-speed gate concept for research completeness | M | M |
| `blueprint/whybuddy-turn-route.ts` | Deterministic projection pattern (facts → display, zero LLM) | M | M |
| `replay/contracts.ts` | Skip | L | L |
| `scene-command/` | Skip | S | L |

---

## 8. Key Architectural Observations

1. **The shared layer is purely types + pure functions.** No runtime dependencies, no I/O, no framework imports (except Zod in scene-command). This makes it safe to import in both browser and server contexts.

2. **Provenance is a first-class citizen, not an afterthought.** Every LLM call tracks promptId, model, responseDigest, promptFingerprint, and generationSource. Every capability invocation links back to which capability and role produced it. This enables full audit trail and reproducibility.

3. **The "three-tier trust" model for artifacts.** Artifacts are `untrusted` by default. They become `gated_pass` after commit-time gates pass. They become `audited` after additional review. Only `gated_pass` or `audited` artifacts can be cited in reports. This prevents LLM hallucinations from propagating into final deliverables.

4. **Human-in-the-loop as a first-class state, not an exception.** `MissionStatus.waiting`, `MissionDecision`, `WebAigcHitlNodeType`, `MissionAutopilotTakeoverType` — the system is designed for human involvement at every stage. Autopilot drive states include `takeover-required` as a normal state, not a failure mode.

5. **The orchestrator dispatches (capability, role) pairs, not just capabilities.** This enables the same capability (e.g., `risk.analyze`) to be executed by different roles with different system prompts. The role selection is part of the planning decision, not hardcoded.

6. **The `browser-direct` LLM provider is not a testing hack.** It is explicitly listed as a pre-defined provider type and wired into the AI config snapshot system. The entire app is designed to work without a backend for personal use cases.

7. **Contract versioning is explicit.** `MISSION_CONTRACT_VERSION = "2026-03-28"`, `EXECUTOR_CONTRACT_VERSION = "2026-03-28"`, `NL_COMMAND_CONTRACT_VERSION = "2026-06-01"`. Breaking changes require bumping the version constant, making the contract evolution visible in diffs.
