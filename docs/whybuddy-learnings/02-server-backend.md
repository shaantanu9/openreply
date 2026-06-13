# WhyBuddy Server — Backend Architecture Analysis

**Purpose:** Reference document for porting valuable backend patterns to Gap Map (Tauri 2 + Python sidecar, SQLite, multi-source collection, knowledge graph, MCP server).

**Source:** `/myind-gapmap-ref/WhyBuddy/server/`
**Analyzed:** 2026-06-13

---

## 1. What the Server Is

WhyBuddy server is a **Node.js / Express / TypeScript multi-agent orchestration platform**. It is not a typical API server — it is a mission execution engine that:

1. Accepts natural-language commands ("strategic commands") from users
2. Analyzes and decomposes them into missions → tasks → execution plans
3. Dispatches plans to a separate executor process (`lobster-executor`, default `http://127.0.0.1:3031`)
4. Streams progress events back to clients over Socket.IO
5. Maintains a durable audit log, lineage graph, knowledge graph, RAG index, replay record, and reputation scores

The server is **not AI itself** — it orchestrates AI calls. All LLM invocations go through `core/llm-client.ts` which delegates to configured providers.

**Entry point:** `server/index.ts` (81 KB — unusually large, acts as the route/middleware assembly point)

**Tech stack:**
- Express HTTP + Socket.IO for real-time streaming
- MySQL (via `persistence/mysql.ts`) + Redis (`persistence/redis.ts`) for production
- SQLite-backed in-memory maps for mission records (in-memory `MissionRepository` default)
- JSONL files for lineage, replay events, and graph persistence
- Qdrant vector DB (configurable) or in-memory vectors for RAG
- HMAC-SHA256 for executor callback authentication
- ECDSA-P256 for cryptographic audit chain signing

---

## 2. Route Map

Routes live in `server/routes/`. Key files and their API surfaces:

| Route file | Mount path pattern | Responsibility |
|---|---|---|
| `routes/whybuddy.ts` (24.9 KB) | `/api/whybuddy` | Core AI session driver, capability execution, evidence gathering |
| `routes/nl-command.ts` (28 KB) | `/api/nl-command` | NL→strategic command lifecycle (submit → analyze → decompose → plan → approve → execute) |
| `routes/tasks.ts` (35.9 KB) | `/api/tasks` | Workflow task CRUD, assignment, progress |
| `routes/blueprint.ts` (593 KB) | `/api/blueprint` | Largest route file — full visual plan builder with agents |
| `routes/knowledge.ts` (10.6 KB) | `/api/knowledge` | Entity/relation CRUD, graph traversal, ontology |
| `routes/knowledge-admin.ts` (9.4 KB) | `/api/knowledge-admin` | Lifecycle transitions, GC, review queue |
| `routes/rag.ts` (11.4 KB) | `/api/rag` | Ingest, retrieve, augment, feedback, observability |
| `routes/lineage.ts` (12.5 KB) | `/api/lineage` | Provenance record, query, export |
| `routes/replay.ts` (12 KB) | `/api/replay` | Event streaming, timeline query, access control |
| `routes/audit.ts` (16.8 KB) | `/api/audit` | Hash chain append, verify, query, export |
| `routes/permissions.ts` (14 KB) | `/api/permissions` | Permission check, policy CRUD, token management |
| `routes/reputation.ts` (3.9 KB) | `/api/reputation` | Signal recording, profile query, leaderboard |
| `routes/workflows.ts` (17.6 KB) | `/api/workflows` | Workflow runtime lifecycle |
| `routes/agents.ts` (5.9 KB) | `/api/agents` | Agent CRUD, soul file, memory |
| `routes/projects.ts` (14.2 KB) | `/api/projects` | Project management |
| `routes/planets.ts` (7.6 KB) | `/api/planets` | Visualization of agent graph |
| `routes/auth.ts` (10.6 KB) | `/api/auth` | Email+code auth, sessions, JWT |

The callback endpoint `POST /executor/callback` is wired directly in `index.ts` with HMAC-SHA256 verification (timestamp + body, max skew 300 s, `x-cube-executor-timestamp` + `x-cube-executor-signature` headers). See `index.ts:202-258`.

---

## 3. Core Module Deep Dives

### 3.1 MissionOrchestrator (`core/mission-orchestrator.ts`)

The central state machine for mission lifecycle. Every user request becomes a `MissionRecord`.

**State progression (stages):**
```
receive → understand → plan → provision → execute → finalize
```

Each stage has status: `pending | running | done | failed`.

**`startMission()` flow** (lines 578-787):
1. Create `MissionRecord` (in-memory or pluggable `MissionRepository`)
2. Advance through `receive` → `understand` (emit progress event 8%)
3. Call `ExecutionPlanBuilder.build()` — rule-based intent detection, no LLM needed for plan phase
4. Advance `understand` → `plan` (32%)
5. Call `ExecutorClient.dispatchPlan()` — HTTP POST to lobster-executor
6. On success: advance to `execute` (60%), store `executorJobId`
7. On failure: mark `finalize` as failed and rethrow

**`applyExecutorEvent()` (lines 789-891):** Called when executor POSTs a callback. Maps executor event types (`job.accepted`, `job.waiting`, `job.completed`, `job.failed`, `job.log`) to MissionRecord state updates. Extracts `organization`, `workPackages`, `messageLog` from the event payload when status = completed.

**`submitDecision()` (lines 893-967):** Handles human-in-the-loop decision prompts. Supports multi-step decision chains via `nextDecision`. Transitions mission from `waiting` back to `running`.

**Workflow enrichment bridge (lines 1083-1205):** After each workflow stage completes, `enrichMissionFromWorkflow()` pulls organization snapshot, agent crew, work packages (last 50 messages) from the `WorkflowRuntime` and writes them to the MissionRecord. This is the decoupling layer between the internal workflow engine and the mission UI model.

**`recordRoleSwitchTrace()` / `appendCollaborationResult()` / `setAutonomyData()`:** Three specialized event appenders for the agent autonomy subsystem — swarm competition results, role switches, taskforce assignments.

**Persistence model:** Default is `InMemoryMissionRepository` (Map). Production wires a MySQL-backed repository. All mutations go through `persist()` which calls `repository.save()` then `hooks.onMissionUpdated()` (used to emit Socket.IO updates).

### 3.2 ExecutionPlanBuilder (`core/execution-plan-builder.ts`)

Rule-based intent classifier that builds an `ExecutionPlan` without LLM calls.

**Intent detection (lines 48-130+):** Array of `INTENT_RULES` with regex patterns matched against `sourceText`. First match wins. Intents: `scan | analyze | plan | codegen | execute | report | custom`. Confidence scores: execute=0.92, codegen=0.88, report=0.85.

**Pipeline expansion:** Each intent maps to a job pipeline:
```
execute → [scan, analyze, plan, execute, report]
codegen → [scan, analyze, plan, codegen]
```

This is the "understanding" phase in `startMission` — it converts free text to a typed execution graph with ordered steps, estimated tokens, and a workspace root.

### 3.3 NL Command Subsystem (`core/nl-command/`)

The full strategic-command pipeline. 13 sub-services wired by `NLCommandOrchestrator` (`core/nl-command/orchestrator.ts`).

**State machine (enforced in `transitionStatus()`, lines 509-532):**
```
draft → analyzing → clarifying → finalized → decomposing → planning → approving → executing → completed/failed
```

**CommandAnalyzer (`nl-command/command-analyzer.ts`):**
- Calls LLM with `jsonMode: true, temperature: 0.3`
- Exponential backoff retry (max 2 retries, base 500ms)
- Extracts: `intent`, `entities`, `constraints`, `objectives`, `risks`, `assumptions`, `confidence`, `needsClarification`
- If ambiguous: generates clarification questions via second LLM call
- `safeParseJSON()` strips markdown code fences from LLM responses (lines 66-81)

**MissionDecomposer (`nl-command/mission-decomposer.ts`):**
- Step 1: LLM call → generates mission list from FinalizedCommand (JSON: `{ missions: [...] }`)
- Step 2: LLM call → identifies dependency edges between missions
- Step 3: `topoSortWithGroups()` — Kahn's algorithm BFS producing parallel execution groups (lines 41-100+ of `topo-sort.ts`)
- Step 4: Callbacks `onMissionCreated`, `onOrganizationNeeded`
- Throws `CyclicDependencyError` with cycle path on circular deps, records to audit trail

**TopoSort (`nl-command/topo-sort.ts`):**
Kahn's BFS with parallel grouping. Returns `string[][]` where each inner array = nodes that can run in parallel. Used for both mission-level and task-level dependency resolution.

**ExecutionPlanGenerator:** Takes `FinalizedCommand + MissionDecomposition + TaskDecomposition[]` and produces `NLExecutionPlan` with cost budget, risk assessment, resource requirements.

**TemplateManager (`nl-command/template-manager.ts`):** Command templates that can be loaded to prepopulate commands (reuse patterns).

**PlanApproval (`nl-command/plan-approval.ts`):** Multi-approver model with `approved | rejected | revision_requested` decisions. When fully approved, transitions command to `executing`.

### 3.4 Vector Store — Custom BagOfWords (`memory/vector-store.ts`)

**No external vector DB for memory.** Uses a pure-JS bag-of-words hash-based embedding:

```
embedText(text, dimension=96):
  1. tokenize → split on CJK chars and [a-z0-9_]+ (min 2 chars)
  2. count term frequencies
  3. for each term: hash via FNV-1a → bucket index (hash % dim), sign (hash % 2)
  4. vector[index] += count * sign
  5. L2-normalize
```

Stored in `vectors.json` per agent workspace. `searchMemorySummaries()` uses dot-product cosine similarity (already normalized vectors). Falls back to recency sort when query is empty.

**Key insight:** This is a zero-dependency local vector store adequate for small corpora (per-agent session summaries). Dimension 96 keeps files tiny.

**`VectorizedMemorySummary` fields:** `workflowId, directive, status, role, stage, summary, keywords[]` — these are the semantic facets that get embedded.

### 3.5 RAG Pipeline (`rag/`)

Full production RAG with Qdrant or in-memory vector store.

**Chunking strategies (`rag/chunking/`):**
- `DocumentChunker`: Splits on `\n\n` (semantic paragraphs), merges under-size chunks, splits over-size. Min 64 tokens, max 1024.
- `SlidingWindowChunker`: Fixed-size windows with overlap (for dense content)
- `CodeChunker`: Code-aware (language-specific)
- `ConversationChunker`: Per-turn chunking
- `PassthroughChunker`: Single chunk (short content)
- `ChunkRouter`: Selects chunker by `sourceType`

**Retrieval (`rag/retrieval/rag-retriever.ts`):**
- Three modes: `semantic` (ANN vector search), `keyword` (BM25-style in `keyword-searcher.ts`), `hybrid` (both merged via RRF)
- **RRF merge** (`rrf-merger.ts`): Reciprocal Rank Fusion `score = 1/(k + rank)` where k=60 — standard multi-source ranking
- Fetches `topK * 2` candidates from each source then merges to avoid under-retrieval
- `ContextExpander` (`context-expander.ts`): Fetches adjacent chunks (±N) for selected results — good for code that spans chunk boundaries
- Access timestamps updated on every retrieval (for LRU eviction)

**Augmentation (`rag/augmentation/rag-pipeline.ts`):**
```
Retrieve → Rerank → TokenBudgetManager.allocate() → inject/prune/below_threshold labels → AugmentationLogger.log()
```
- Three inject modes: `auto | on_demand | disabled`
- `on_demand` only triggers on directives containing `@rag`, `@context`, `@search`, `检索`, `历史`
- `TokenBudgetManager` assigns `injected | pruned | below_threshold` status per chunk
- `Reranker` (`reranker.ts`): Cross-encoder style re-scoring of initial candidates

**Embedding (`rag/embedding/embedding-generator.ts`):** Pluggable — delegates to configured `EmbeddingProvider` (external API or local model).

### 3.6 Knowledge Graph (`knowledge/graph-store.ts`)

A file-backed entity/relation graph scoped per project.

**Storage:** JSON files at `data/knowledge/graph-{projectId}.json`. Debounced write (1000 ms). Lazy load per project.

**Entity model:** `{ entityId, entityType, name, description, source, confidence, projectId, status, linkedMemoryIds, extendedAttributes }`

**Status state machine (active → deprecated → archived → active):** Enforced by `enforceStatusTransition()` (lines 173-212). Writes to `LifecycleLog` on each transition.

**Deduplication (`mergeEntity()`, lines 219-260):** Unique key = `entityType + projectId + name + extendedAttributes.filePath`. On duplicate: merges `extendedAttributes`, keeps `max(confidence)`.

**Graph traversal:**
- `getNeighbors(entityId, relationTypes?, depth=1)`: BFS N-hop, bidirectional edges, visited set prevents cycles
- `findPath(sourceId, targetId)`: BFS shortest path with parent tracking, `reconstructPath()` walks back
- `getSubgraph(entityIds[])`: Returns all entities + relations within a set

**Entity sources:** `user_defined` (confidence = 1.0 forced), `code_analysis`, `agent_extracted`, etc.

**Change listener pattern:** `onEntityChanged(listener)` returns unsubscribe function — used by agent-sink to react to graph mutations.

### 3.7 Lineage / Provenance (`lineage/`)

**Design principle:** "Non-blocking capture" — every record call returns a `lineageId` immediately. Actual write is async.

**LineageCollector (`lineage/lineage-collector.ts`):**
- Three record types: `recordSource`, `recordTransformation`, `recordDecision`
- Buffer (max 100 nodes) + 1000ms timer → batch flush to `LineageStorageAdapter`
- `recordTransformation()` auto-captures code location via `Error().stack` parse (line 127)
- SHA256 hash utility: `LineageCollector.computeHash(data)` for result integrity
- `emitAlert()` for external change-detection callbacks

**JsonLineageStorage (`lineage/lineage-store.ts`):**
- JSONL append-write (fast) for both nodes and edges: `data/lineage/nodes.jsonl`, `data/lineage/edges.jsonl`
- Five in-memory indices: `byId`, `byAgent`, `bySession`, `byDecision`, `byTimestamp` (sorted, binary insert)
- Range queries use binary search on sorted timestamp array
- `purgeExpired(beforeTimestamp)`: removes expired nodes from all indices, rewrites JSONL files
- Default retention: 90 days (env `LINEAGE_RETENTION_DAYS`)

**Node types:** `source` (data origin, queryText, resultHash), `transformation` (agent operation, codeLocation, inputLineageIds), `decision` (decisionLogic, confidence, modelVersion)

**Lineage edges:** Directed `fromId → toId` with type and timestamp — enables provenance graph traversal.

### 3.8 Replay System (`replay/`)

Full execution event capture for after-the-fact replay of missions.

**EventCollector (`replay/event-collector.ts`):**
- `emit(event)` is synchronous — auto-generates `eventId` + `timestamp`, enqueues
- Buffer capped at 1000. On overflow: drops oldest (not newest)
- Periodic flush every 500ms, groups by `missionId` for batch writes
- `failedQueue` with max 3 retries + exponential backoff
- Statistics: `{ buffered, failed, total }`

**ReplayStore (`replay/replay-store.ts`):**
- Storage: `data/replay/{missionId}/events.jsonl` + `data/replay/{missionId}/timeline.json`
- SHA-256 checksum of event file for integrity
- gzip compression for large replay files
- Multi-dimensional indices on timeline: `byTime`, `byAgent`, `byType`, `byResource`
- Timeline = serializable metadata about a mission's event stream (startTime, endTime, eventCount)

**Replay interceptors (`replay/interceptors.ts`, 12.2 KB):**
Middleware that wraps key operations to emit events automatically. Covers: agent calls, tool invocations, LLM calls, file operations. This is the "instrument everything" layer.

**Access control (`replay/access-control.ts`):** Role-based — only mission owner or admin can replay. Sensitive data scrubbing (`replay/sensitive-data.ts`): strips PII/credentials before replay export.

### 3.9 Permission / Guardrails (`permission/`)

**PermissionCheckEngine (`permission/check-engine.ts`):**

Flow (lines 169-306):
1. Verify JWT token → extract `permissionMatrix` from payload
2. LRU cache lookup (key: `agentId:resourceType:action:resource`, 10K entries, 60s TTL)
3. **Deny-first**: scan deny rules before allow rules
4. Allow rule match
5. `ResourceChecker` constraint validation (pluggable per resource type)
6. `GovernancePolicy` evaluation — blocking governance decisions override explicit allow
7. Audit log + cache + return

**Resource types:** `filesystem`, `database`, `network`, `api`, `mcp` — each has its own `ResourceChecker` in `permission/checkers/`.

**LRU cache:** Custom Map-based (insertion-order) with TTL eviction and prefix invalidation (`invalidateByPrefix(agentId:)`).

**GovernancePolicy (`permission/governance-policy.ts`):** Static rules that can block operations even when explicitly allowed. Used for high-risk operations (e.g., production deployments, mass deletes).

**DynamicManager (`permission/dynamic-manager.ts`):** Runtime permission grants/revocations without token reissue. Maintains an overlay on top of static token permissions.

**ConflictDetector (`permission/conflict-detector.ts`):** Detects contradictory allow+deny rules in the same permission matrix.

**RateLimiter (`permission/rate-limiter.ts`):** Per-agent sliding window rate limiting.

### 3.10 Audit Chain (`audit/audit-chain.ts`)

Cryptographic tamper-evident audit log.

**Algorithm:**
```
hash(entry N) = SHA256(JSON.stringify(event) + "|" + timestamp + "|" + hash(N-1) + "|" + nonce)
signature(entry N) = ECDSA-P256.sign(privateKey, hash(N))
```

**Key management (lines 93-137):** Priority order:
1. Env vars `AUDIT_SIGNING_PRIVATE_KEY` / `AUDIT_SIGNING_PUBLIC_KEY`
2. Files at `data/audit/keys/private.pem` / `public.pem`
3. Auto-generate ECDSA-P256 keypair and persist

**Genesis entry:** First entry has `previousHash = "0"`, `sequenceNumber = 0`, `entryId = "al_0"`.

**AuditStore:** Default `InMemoryAuditStore`. Production wires persistent store (MySQL). The chain is pluggable — `setStore()` replaces the backing store.

**AuditVerifier (`audit/audit-verifier.ts`):** Independent verification of chain integrity — walks entries, recomputes hashes, checks signatures.

**AuditRetention (`audit/audit-retention.ts`):** Policy-driven purge of old entries (age, storage quota).

**AnomalyDetector (`audit/anomaly-detector.ts`):** Detects suspicious patterns in the audit stream (burst activity, unusual operation sequences).

### 3.11 Reputation System (`core/reputation/`)

Multi-dimensional scoring for agent quality tracking.

**Dimensions:** `qualityScore, speedScore, efficiencyScore, collaborationScore, reliabilityScore` (all 0–1000).

**ReputationCalculator (`core/reputation/reputation-calculator.ts`):**

Each dimension uses Exponential Moving Average:
```
newValue = current * (1 - alpha) + signal * alpha
```

- `qualityScore`: EMA of `taskQualityScore * 10`, alpha from config. **Streak bonus**: if `streakCount >= threshold`, multiply alpha by `streak.alphaMultiplier` (faster adaptation)
- `speedScore`: `ratioToScore(actualMs / estimatedMs)` — ratio 1.0 → 1000, ratio 2.0 → 0, linear between
- `efficiencyScore`: `ratioToScore(tokensConsumed / tokenBudget)` — same mapping
- `collaborationScore`: EMA of `collaborationRating * 10` (optional)
- `reliabilityScore`: delta-based — `rollbackPenalty`, `downstreamFailurePenalty`, `successRecovery`

All deltas clamped to `[-maxDelta, maxDelta]`.

**Overall score:** Weighted sum `quality*w + speed*w + efficiency*w + collab*w + reliability*w`, clamped [0, 1000].

**TrustTierEvaluator (`core/reputation/trust-tier-evaluator.ts`):**
- Grade mapping: S(900+), A(700+), B(500+), C(300+), D(<300)
- Trust tier: S/A → `trusted`, B → `standard`, C/D → `probation`
- External agent upgrade logic: requires `totalTasks >= threshold AND overallScore >= minScore`
- Grade downgrade events: `REPUTATION_DOWNGRADE` + `AGENT_REPUTATION_CRITICAL` if reaches D

**DecayScheduler (`core/reputation/decay-scheduler.ts`):** Time-based score decay for inactive agents — prevents stale high scores.

**AnomalyDetector (`core/reputation/anomaly-detector.ts`):** Detects grinding patterns (rapid low-quality task completion to inflate scores), collusion (mutual high-rating), rapid anomalous score changes.

### 3.12 Memory Architecture (`memory/`)

Four-layer memory model:

**SoulStore (`memory/soul-store.ts`):** Per-agent `SOUL.md` file — markdown persona/instruction document. Dual persistence: filesystem `{agentWorkspace}/SOUL.md` + database. `appendLearnedBehaviors()` deduplicates and appends new behavioral rules.

**SessionStore (`memory/session-store.ts`):** In-session conversation context (working memory). Time-bounded, no persistence.

**WorkspaceStore (`memory/workspace.ts`):** Per-agent file workspace — scoped file R/W through `core/access-guard.ts` to prevent path traversal.

**VectorStore (`memory/vector-store.ts`):** Semantic search over workflow summaries (see §3.4 above).

**ReportStore (`memory/report-store.ts`):** Persists agent-generated reports for retrieval.

### 3.13 Feishu Integration (`feishu/`)

Bidirectional bridge to Lark/Feishu (Chinese enterprise messaging). The platform supports agents that can be triggered by Feishu messages and deliver results back. Uses HMAC webhook security, dedup store (prevent duplicate webhook processing), workflow dispatcher, and relay for message delivery.

### 3.14 WhyBuddy Core Session (`whybuddy/`)

The primary AI capability execution engine.

**orchestrate-plan.ts:** LLM router that picks which capabilities to invoke next given current session state. Uses `V5SessionState` (version 5 reasoning state). Returns `selected[]` (capability + role + rationale) or `converged=true` when done.

**session-driver.ts:** Drives the multi-turn session loop. Calls `orchestrate-plan` → executes selected capabilities → updates state → loops until convergence.

**Capability exec maps:** `capability-exec-map.ts`, `delivery-exec-map.ts`, `evidence-exec-map.ts`, `visual-exec-map.ts`, `structure-exec-map.ts`, `dialogue-exec-map.ts`, `deliberation-exec-map.ts` — each maps capability IDs to handler functions.

**web-evidence-adapter.ts:** Web search → evidence extraction pipeline.

**pool-json-llm.ts:** LLM pool with fallback routing — tries primary model, falls back to pool on failure.

**capability-llm-fallback.ts:** Heuristic fallback when LLM is unavailable.

**mini-session.ts:** Lightweight single-turn session for simple queries.

---

## 4. Agent Runtime — How Missions Execute

```
User NL → POST /api/nl-command/submit
    │
    ▼
NLCommandOrchestrator.submitCommand()
    │ analyzes via LLM
    ├─ needsClarification? → emit Socket event, wait for /clarify
    │
    ▼
NLCommandOrchestrator.decomposeAndPlan()
    │ LLM → mission list
    │ LLM → dependency edges
    │ topoSortWithGroups → execution order
    │
    ▼
NLCommandOrchestrator.createApproval() → wait for human approval
    │
    ▼ (approved)
MissionOrchestrator.startMission()
    │ ExecutionPlanBuilder.build() → intent detection
    │ ExecutorClient.dispatchPlan() → POST to lobster-executor
    │
    ▼
lobster-executor runs job (separate process)
    │ POSTs callbacks to /executor/callback (HMAC-verified)
    │
    ▼
index.ts callback handler → MissionOrchestrator.applyExecutorEvent()
    │ updates stages/progress/status
    │ extracts organization/workPackages/messageLog on completion
    │
    ▼
hooks.onMissionUpdated() → Socket.IO emit to client
    │
    ▼ (if job.waiting — human decision required)
POST /api/missions/:id/decision → MissionOrchestrator.submitDecision()
    │ resolves decision, resumes executor
    │
    ▼ (job.completed)
Mission status = "done", artifacts attached
```

**Socket.IO events emitted during this flow:**
- `mission:created`, `mission:updated` (on every persist)
- `nl-command:created`, `nl-command:analysis`, `nl-command:clarification-question`
- `nl-command:decomposition-complete`, `nl-command:plan-generated`, `nl-command:plan-approved`
- `lineage:node-created`, `lineage:alert`
- `audit:entry-appended`

**Multi-agent scenarios:**
- `SwarmOrchestrator` (`core/swarm-orchestrator.ts`): Manages pods of agents working in parallel. Coordinates via `CollaborationSession` records.
- `TaskForceManager` (`core/taskforce-manager.ts`): Dynamic task allocation across agent pool
- `DynamicOrganization` (`core/dynamic-organization.ts`): Generates org charts of agents from mission requirements
- `JudgeAgent` (`core/judge-agent.ts`): Quality evaluator that scores work packages
- `GuestAgent` / `GuestLifecycle` (`core/guest-agent.ts`): Temporary agents invited for specific skills
- `CompetitionEngine` (`core/competition-engine.ts`): Routes tasks to competing agents, selects best result

---

## 5. Notable Algorithms and Patterns

### 5.1 Hash-Based Local Embedding (No External API)
**File:** `memory/vector-store.ts:61-85`

FNV-1a variant for token hashing, feature hashing into fixed dimension (96), TF weighting, L2-normalize. Achieves semantic similarity at zero cost. Adequate for per-agent session summaries (hundreds of records). Not adequate for large cross-mission corpora.

**Port signal:** For Gap Map's paper similarity, this pattern can produce fast local embeddings for abstract/title matching before calling external embedders.

### 5.2 Reciprocal Rank Fusion (Hybrid Retrieval)
**File:** `rag/retrieval/rrf-merger.ts`

`score = 1/(k + rank)` where k=60. Merges ANN vector results with BM25 keyword results. Standard, proven, no hyperparameter tuning needed.

**Port signal:** Directly applicable to Gap Map's hybrid paper search (semantic + keyword over title/abstract/venue).

### 5.3 Kahn's BFS Topo Sort with Parallel Groups
**File:** `core/nl-command/topo-sort.ts:41-100`

Builds `string[][]` parallel execution groups — inner array = nodes runnable concurrently, outer = sequential stages. Detects cycles with DFS-traced `CyclicDependencyError` including cycle path. Deterministic (queue.sort()).

**Port signal:** Gap Map's paper pipeline could use this for dependency ordering when papers build on each other (citation chains → execution order for analysis tasks).

### 5.4 Lineage Provenance — JSONL + Multi-Index
**File:** `lineage/lineage-store.ts`

Append-only JSONL for writes (fast), five in-memory indices rebuilt on load. Binary insert keeps `byTimestamp` sorted for O(log n) range queries. Purge rewrites files. Three node types encode the full data flow: source → transformation → decision.

**Port signal:** Gap Map needs data provenance ("where did this finding come from?"). The `recordSource(sourceId, queryText, resultHash)` + `recordTransformation(agentId, operation, inputLineageIds[])` pattern is directly applicable to paper collection → enrichment → graph insertion chains.

### 5.5 Audit Chain — ECDSA Signed Hash Chain
**File:** `audit/audit-chain.ts`

Entry N hash = `SHA256(event_json + "|" + timestamp + "|" + prev_hash + "|" + nonce)`. Signed with ECDSA-P256. Tamper-evident: any modification breaks the chain. Key auto-generation with env-var override.

**Port signal:** For Gap Map, a simpler unsigned hash chain (just SHA256 chain, no signatures) would suffice for "audit who ran what research when" — skip the key management overhead.

### 5.6 Buffer + Timer Batch Flush Pattern
**Files:** `lineage/lineage-collector.ts`, `replay/event-collector.ts`

Both use: in-memory buffer (100-1000 entries), periodic flush (500-1000ms), overflow policy (drop oldest / retry queue), async write that never throws to caller. Pattern is identical across lineage and replay.

**Port signal:** Gap Map's collect pipeline could buffer paper enrichment writes (embedding generation results) and flush to SQLite in batches rather than per-paper.

### 5.7 Permission: Deny-First LRU-Cached JWT Matrix
**File:** `permission/check-engine.ts`

Token carries the full permission matrix. Check order: deny rules first (highest priority), then allow rules, then constraint validators, then governance policy. LRU cache at 10K entries, 60s TTL, invalidation by agent prefix. Governance policy can block even explicit allows.

**Port signal:** For Gap Map's MCP server, a simplified version — capability tokens with deny-first rules and a small LRU cache — would prevent agents from accessing arbitrary filesystem paths.

### 5.8 Reputation via EMA + Streak Acceleration
**File:** `core/reputation/reputation-calculator.ts`

Weighted EMA per dimension. Streak bonus multiplies the learning rate (alpha), so agents on a streak adapt faster. Speed and efficiency dimensions use `ratioToScore()` which maps latency/token ratios to [0, 1000] — linear in the 1.0-2.0 ratio range.

**Port signal:** Gap Map's personas could have lightweight reputation dimensions (coverage, citation quality, dedup rate) to route future research to better-performing sources/methods.

### 5.9 NL→Mission: Two-LLM Decomposition
**File:** `core/nl-command/mission-decomposer.ts`

Two sequential LLM calls with exponential retry:
1. Generate mission list (structured JSON output with `jsonMode: true`)
2. Identify dependency edges between missions
Then: topo sort → parallel groups → callback notification per mission.

Handles cyclic deps gracefully — records to audit trail before re-throwing.

**Port signal:** Gap Map could use this pattern for complex research questions: "decompose 'understand CRISPR applications' into sub-missions (literature survey, patent landscape, clinical trials), identify which needs to complete first, run in parallel groups."

### 5.10 Graph: Debounced Persistence + Merge-on-Write
**File:** `knowledge/graph-store.ts`

1000ms debounce before writing to JSON. `mergeEntity()` checks unique key before inserting — avoids duplicates without a separate dedup pass. Entity confidence merge: `max(existing, new)`.

**Port signal:** Gap Map's knowledge graph already uses SQLite. The `mergeEntity()` unique-key + max-confidence pattern is a direct analogue to Gap Map's `upsert_semantic()` logic. The debounce pattern applies to batch imports.

---

## 6. Port to Gap Map — Concrete Opportunities

Gap Map already has: multi-source paper collection pipeline, SQLite graph (`graph_nodes` + `graph_edges`), personas, MCP server, ChromaDB embeddings (via `dense-graph-relations` skill), paper chunking, LLM calls via `llm-client.py`.

### Priority Matrix

| Feature | Effort | Value | Notes |
|---|---|---|---|
| **JSONL lineage store** for paper provenance | S | H | Track: which source returned paper → which enrichment ran → which graph edge was added. 3 node types map exactly. |
| **RRF hybrid retrieval** for paper search | S | H | Gap Map queries OpenAlex/PubMed/SS separately. RRF merge would improve ranking. Already have keyword and semantic paths. |
| **Buffer+batch flush** for enrichment writes | S | M | SQLite WAL + batch insert reduces lock contention during heavy collect runs. |
| **Topo sort with parallel groups** for pipeline steps | S | M | Order paper analysis steps (abstract → citation → embedding) with dependency awareness. |
| **Local hash embedding** for fast pre-filter | S | M | Before calling external embedder, use 96-dim BagOfWords to pre-filter candidates. Same FNV pattern. |
| **NL command decomposition** (2-LLM pattern) | M | H | User types "research X" → decompose into sub-missions (survey, gap analysis, citation map) → run in parallel. Gap Map lacks this top-level orchestration layer. |
| **Reputation dimensions** for source quality | M | M | Track per-source: recall rate, precision (citation quality), dedup rate. Route future queries to better sources. Different from agent reputation but same EMA math. |
| **Audit chain** (SHA256 only, no ECDSA) | M | M | Tamper-evident log of "who ran what research when". Good for reproducibility. Skip key management — just chain hashes. |
| **Decision interrupt** (human-in-the-loop) | M | H | `MissionRecord.decision` pattern: agent pauses with options, user picks, mission resumes. Gap Map's research mode could pause for user course-correction mid-run. |
| **Clarification dialog** before research run | M | H | CommandAnalyzer pattern: analyze query → if ambiguous, generate questions → wait for answers → finalize. Gap Map currently starts research without disambiguation. |
| **Permission check engine** for MCP tools | M | M | Deny-first JWT-based matrix already maps to MCP capability model. LRU cache prevents repeated checks. |
| **Knowledge graph entity status machine** | S | M | `active → deprecated → archived → active` transitions with lifecycle log. Gap Map's nodes have no lifecycle — stale research data stays forever. |
| **Replay event collector** for research sessions | L | M | Full event capture of every LLM call, source query, enrichment step during a research session. Enables replay for debugging and reproducibility. High value but large surface area. |
| **Trust tier evaluator** | L | L | Agent reputation → trust tier → permission level. Overkill for single-user desktop app. Skip. |
| **Swarm / competition engine** | L | L | Multi-agent competition. Gap Map is single-user, no benefit. Skip. |
| **Feishu integration** | L | L | Not relevant. Skip. |

### Recommended Implementation Order

**Phase 1 (days):**
1. JSONL lineage store — add `data/lineage/nodes.jsonl` + `edges.jsonl` to Gap Map Python sidecar. Instrument `collect_sources()` → `enrich_paper()` → `upsert_to_graph()` with `recordSource` / `recordTransformation` calls. Zero UI changes needed.
2. Buffer+batch flush — wrap Gap Map's SQLite writes in a 500ms-debounced batch writer during heavy collection.
3. Entity lifecycle states — add `status` column to `graph_nodes` (`active/deprecated/archived`). Add `lifecycle_log` table.

**Phase 2 (week):**
4. RRF hybrid retrieval — merge OpenAlex, PubMed, Semantic Scholar results via RRF before dedup. Replace current source-priority ordering.
5. Clarification dialog — before starting a research run, call LLM with `CommandAnalyzer` pattern. If query is ambiguous (e.g., "CRISPR" without domain), emit `needsClarification=true` and show 2-3 questions in the UI.
6. Decision interrupt — `MissionRecord.decision` pattern at the Python level: sidecar emits `waiting_for_decision` event with options, Tauri frontend shows a choice dialog, user response is sent back, sidecar resumes.

**Phase 3 (2 weeks):**
7. NL decomposition — full `MissionDecomposer` pattern for complex research queries. LLM decomposes into sub-missions, topo sort determines parallel groups, sidecar runs groups concurrently.
8. Audit chain (simplified) — hash chain in SQLite table. No ECDSA — just SHA256(event_json + prev_hash + nonce). Useful for reproducibility reports.

### What Gap Map Already Has That WhyBuddy Reinvents

- **Knowledge graph with entity/relation model**: Gap Map's `graph_nodes` / `graph_edges` SQLite tables. WhyBuddy's `GraphStore` is the same concept. Gap Map's ChromaDB + MiniLM semantic edges are actually more sophisticated than WhyBuddy's graph (which has no semantic similarity edges).
- **Multi-source collection pipeline**: Gap Map already queries OpenAlex, PubMed, Semantic Scholar. WhyBuddy has `web-evidence-adapter.ts` for general web search — less specialized.
- **Paper chunking**: Gap Map's `paper_chunks.py` covers the same ground as WhyBuddy's `DocumentChunker`.
- **LLM client with provider auto-resolution**: Gap Map's `llm-client.py` skill is more robust than WhyBuddy's hardcoded provider calls.
- **Personas**: Gap Map's persona system is richer than WhyBuddy's `soul_md` approach.

**Honest assessment:** The biggest gap in Gap Map vs WhyBuddy is **orchestration layer sophistication** — WhyBuddy has a full NL command decomposition → parallel execution → human-in-the-loop → audit trail stack that Gap Map lacks. The individual components (RAG, graph, chunking) are comparable in quality. The missing value is the **meta-layer**: "what should I research next, in what order, and can I pause for human input?"

---

## 7. Key File Reference

| Path | Lines | What to read for |
|---|---|---|
| `server/index.ts` | 81 KB | Executor callback handler, HMAC verification, Socket.IO setup |
| `server/core/mission-orchestrator.ts` | ~1226 | Mission state machine, workflow enrichment bridge |
| `server/core/execution-plan-builder.ts` | ~200 | Intent detection rules, pipeline expansion |
| `server/core/nl-command/orchestrator.ts` | ~534 | Command lifecycle state machine, 13 sub-service wiring |
| `server/core/nl-command/command-analyzer.ts` | ~300 | LLM call pattern, safeParseJSON, clarification generation |
| `server/core/nl-command/mission-decomposer.ts` | ~323 | Two-LLM decomposition, dependency identification |
| `server/core/nl-command/topo-sort.ts` | ~120 | Kahn's BFS with parallel groups |
| `server/memory/vector-store.ts` | ~176 | Hash embedding, cosine similarity, zero-dependency vectors |
| `server/rag/augmentation/rag-pipeline.ts` | ~182 | Retrieve → rerank → token budget → inject |
| `server/rag/retrieval/rag-retriever.ts` | ~159 | Semantic/keyword/hybrid, RRF merge, context expansion |
| `server/rag/retrieval/rrf-merger.ts` | ~30 | RRF formula |
| `server/rag/chunking/document-chunker.ts` | ~187 | Paragraph split → merge small → split large |
| `server/knowledge/graph-store.ts` | ~759 | BFS traversal, path finding, merge-on-write dedup |
| `server/lineage/lineage-store.ts` | ~360 | JSONL append, 5-index structure, binary insert, purge |
| `server/lineage/lineage-collector.ts` | ~330 | Non-blocking buffer flush, SHA256, stack trace capture |
| `server/replay/event-collector.ts` | ~175 | Async buffer, retry queue, flush-by-missionId |
| `server/replay/replay-store.ts` | ~+ | JSONL + gzip + SHA256 checksum, timeline indices |
| `server/audit/audit-chain.ts` | ~283 | ECDSA-P256 hash chain, key management |
| `server/core/reputation/reputation-calculator.ts` | ~137 | EMA, streak bonus, ratioToScore, dimension deltas |
| `server/core/reputation/trust-tier-evaluator.ts` | ~113 | Grade mapping, tier evaluation, downgrade events |
| `server/permission/check-engine.ts` | ~369 | Deny-first, LRU cache, JWT matrix, governance override |
| `server/whybuddy/orchestrate-plan.ts` | ~+ | V5 capability router, convergence signal |
| `server/memory/soul-store.ts` | ~+ | SOUL.md dual-persistence pattern |
