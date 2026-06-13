# WhyBuddy: lobster-executor Deep Dive

**Scope:** `services/lobster-executor/` — the agent execution engine powering WhyBuddy's autonomous task runner.
**Analysed:** 2026-06-13 for porting ideas into Gap Map (Tauri 2 + Python sidecar + MCP server).

---

## 1. What lobster-executor Is

lobster-executor is a standalone HTTP microservice (Express, port 3031) that accepts job submissions from the WhyBuddy server ("Cube Brain") and runs them in isolated environments. It is the execution layer that actually runs agents — the server plans missions, lobster-executor executes the individual jobs that make up those missions.

**Three execution modes** (selected at startup via `config.executionMode`):

| Mode | Runner class | Isolation | When used |
|---|---|---|---|
| `mock` | `MockRunner` | None — simulated lifecycle | CI / unit tests |
| `native` | `NativeRunner` | Host process (`spawn`) | Dev, lightweight tasks, AI-only jobs |
| `real` | `DockerRunner` | Docker container with full security policy | Production |

The mode determines which `JobRunner` strategy is created by the factory at `src/runner.ts:28`.

---

## 2. The Agent Loop

lobster-executor does **not** implement a perception→decision→action loop itself. Instead it is a **job-level executor**: it receives a fully-specified job payload (produced upstream by Cube Brain's planner), runs it, and streams results back via HMAC-signed HTTP callbacks. The "agent loop" is at the mission planner level; each invocation of `service.submit()` is one action step.

### Submit → Enqueue → Run → Callback

```
POST /api/executor/jobs
  ↓ parseExecutorJobRequest (Zod schema)
  ↓ validateRequiredCapabilities (capability check)
  ↓ resolveSandboxSkillBinding (optional skill lookup)
  ↓ service.submit() → StoredJobRecord (status: queued)
  ↓ void runAcceptedJob(record)       ← fire-and-forget
      ↓ ConcurrencyLimiter.acquire()  ← semaphore, maxConcurrentJobs
      ↓ waitUntilResumed()            ← pause/resume gate
      ↓ runner.run(record, emitEvent)
          emitEvent → persistEvent (events.jsonl)
                    → sendCallback (HMAC-signed POST to eventsUrl)
```

- `service.ts:440` — `submit()` is synchronous; job is immediately stored and the async `runAcceptedJob` is detached.
- `service.ts:523` — `runAcceptedJob` acquires a semaphore permit, then calls `runner.run()` with an `emitEvent` callback.
- Events are both persisted locally (JSONL file) and forwarded to Cube Brain's callback URL (`service.ts:533-537`).

### Event types emitted during a job

| Event type | When |
|---|---|
| `job.accepted` | On submit (synchronous) |
| `job.started` | Container/process actually started |
| `job.log` | Batched log lines (500ms window or 4096 bytes) |
| `job.log_stream` | Live per-line stream (scrubbed) |
| `job.progress` | Every 5 s while running |
| `job.screenshot` | Browser preview frame (if live preview enabled) |
| `job.completed` | Exit code 0 |
| `job.failed` | Non-zero exit, timeout, OOM, seccomp violation |
| `job.cancelled` | Cancel request honoured |

---

## 3. Per Key Module/File

### `src/app.ts` — Express HTTP Server
- **Purpose:** REST API surface. Routes: `GET /health`, `GET /api/executor/capabilities`, `GET /api/executor/skills`, `GET|POST /api/executor/jobs`, `POST /api/executor/jobs/:id/cancel|pause|resume`, `GET /api/executor/security-audit`.
- **Key pattern:** `sendError()` at `app.ts:35` normalises `LobsterExecutorError`, `ZodError`, and raw `Error` into typed JSON responses with status codes.
- **Capabilities check at health:** `app.ts:110-146` — health endpoint exposes Docker connectivity, LLM key presence (`!!process.env.LLM_API_KEY`), and the first 12 capabilities. Nothing is hardcoded — every capability is derived at runtime.

### `src/service.ts` — Core Job Lifecycle
- **Purpose:** The central state machine. Owns `Map<jobId, StoredJobRecord>`, the concurrency limiter, and the runner.
- **Key functions:**
  - `submit()` at `service.ts:440` — validates, deduplicates (idempotency key), stores, fires async run.
  - `cancel()` at `service.ts:164` — transitions `queued`/`waiting` immediately; calls `runner.cancel()` for running jobs.
  - `pause()` / `resume()` at `service.ts:284 / 368` — Docker containers are actually paused/unpaused (`container.pause()` / `container.unpause()`); queued jobs are gated by a `waitUntilResumed()` promise.
  - `waitUntilResumed()` at `service.ts:661` — spin-waits on a manually-resolved Promise stored in `record.resumeWaiter`; avoids polling.
- **Data flow:** All job state lives in memory + mirrored to `dataRoot/jobs/<missionId>/<jobId>/` as `request.json`, `executor.log`, `events.jsonl`, `result.json`.

### `src/docker-runner.ts` — Docker Execution Engine (1694 lines)
- **Purpose:** The real runner. Lifecycle in comment at `docker-runner.ts:226-241` is the authoritative sequence.
- **Key functions:**
  - `buildContainerOptions()` at `docker-runner.ts:678` — constructs `Dockerode.ContainerCreateOptions` from the job payload. Image selection priority: `payload.image > (aiEnabled ? aiImage : defaultImage)`. Skill runner vs browser runner vs command runner branching at `docker-runner.ts:708-745`.
  - `streamAndWait()` at `docker-runner.ts:794` — demuxes Docker's multiplexed stdout/stderr stream (`container.modem.demuxStream`), feeds both into `LogBatcher`, emits live log/screenshot events, races `container.wait()` against a timeout timer.
  - `collectArtifacts()` at `docker-runner.ts:989` — reads `workspace/artifacts/`, merges with an optional `artifact-manifest.json` written by the container, infers MIME types from extensions.
  - `resolveSecurityPolicyForRecord()` at `docker-runner.ts:1607` — AI jobs use `balanced` security (needs outbound network); all others use `strict` (network mode `none`).
- **OOM / seccomp detection:** Exit code 159 = SIGSYS (128+31) = seccomp violation, detected at `docker-runner.ts:572`. `OOMKilled` field from `container.inspect()` at `docker-runner.ts:470`.

### `src/native-runner.ts` — Host-Process Runner
- **Purpose:** Runs commands directly on the host via `child_process.spawn`. Also implements `runAIJob()` at `native-runner.ts:249` which POSTs to `SERVER_BASE_URL/api/chat` (the WhyBuddy server's own LLM proxy) instead of calling an LLM directly.
- **Cancel:** SIGTERM sent to child process (`native-runner.ts:32`).
- **Gap Map relevance:** This is the closest analogue to Gap Map's Python sidecar pattern — spawn a process, stream its stdout/stderr, wait for exit, collect artifacts.

### `ai-bridge/index.js` — In-Container LLM Bridge
- **Purpose:** Runs **inside** the Docker container. Provides a `generate(messages, options)` function that calls an LLM provider.
- **Provider abstraction:** Supports two wire APIs selected by `AI_WIRE_API` env var — `"chat"` (OpenAI Chat Completions) and `"responses"` (OpenAI Responses API with SSE streaming). Base URL, model, and API key are all injected from environment variables (`AI_BASE_URL`, `AI_MODEL`, `AI_API_KEY`).
- **Result artifact:** Writes `ai-result.json` to `/workspace/artifacts/` on every call (`ai-bridge/index.js:192`). Host reads this back via `docker-runner.ts:1401`.
- **SSE parsing:** `parseSSEStream()` at `ai-bridge/index.js:72` accumulates `response.output_text.delta` events and extracts usage from `response.completed`.

### `ai-bridge/executor.js` — Autonomous Code Executor (in container)
- **Purpose:** The AI agent that runs inside the container for `aiEnabled` Docker jobs. Full autonomous loop: read task → ask LLM for execution plan → install deps → write code → execute → write results.
- **Plan schema** (from LLM, `executor.js:86-116`):
  ```json
  {
    "setup_commands": ["pip install requests"],
    "code_filename": "solution.py",
    "code_content": "...",
    "run_command": "python solution.py",
    "language": "python"
  }
  ```
- **Fallback extractor** at `executor.js:170` — if LLM planning fails, extracts code blocks from markdown (python/js/bash), auto-detects third-party imports for `pip install`.
- **Temperature:** 0.1 for planning (`executor.js:116`) — deterministic plan generation.

### `agent-image/browser-runner.js` — In-Container Browser Automation
- **Purpose:** Playwright-based browser task runner inside the Docker container. Handles `browserTask` payloads (no `skillRef`, no `command`).
- **Task schema** (normalized at `browser-runner.js:34`): `{ url, viewport, waitUntil, timeoutMs, capture: { screenshot, html, console, metrics } }`.
- **Artifacts produced:** `page-screenshot.png`, `page.html`, `console.json`, `browser-metrics.json` — all with an `artifact-manifest.json` for host-side metadata enrichment.
- **Live preview:** The Docker runner polls `workspace/artifacts/page-screenshot.png` by size+mtime signature (`docker-runner.ts:1092`) every `screenshotIntervalMs` ms (minimum 250ms) and emits `job.screenshot` events with base64-encoded frames.
- **Entrypoint:** `["node", "/opt/cube-agent/browser-runner.js"]` when container has a `browserTask` payload.

### `src/skill-registry.ts` — Skill Discovery and Indexing
- **Purpose:** Scans `skillRoot/` directory at construction time, validates each `skill.json` manifest, builds three indexes: by key (`name@version`), by name (latest compatible first), by capability.
- **Capability matching** at `skill-registry.ts:111` — `findByCapabilities()` scores skills by `coveredCapabilities / required - safetyPenalty`. Safety penalty: 0.08 for skills that need credentials, 0.04 for network-required skills.
- **Directory safety** at `skill-registry.ts:62` — entry names must match `/^[a-zA-Z0-9._-]+$/` and not contain `..`.
- **Entrypoint validation** at `skill-registry.ts:179` — resolved path must remain within skill directory (path traversal guard).

### `src/skill-job.ts` — Skill Binding and Governance
- **Purpose:** Resolves a `SandboxSkillBinding` from a job's `payload.skillRef` / `payload.skillPolicy`, enforcing a three-layer governance check.
- **Governance checks** at `skill-job.ts:138`:
  1. **Credential gate:** skill requires credentials → must set `skillPolicy.allowCredentials=true`.
  2. **Network gate:** skill requires network + executor is `strict` security → must set `skillPolicy.allowNetwork=true`.
  3. **Filesystem gate:** skill requests `workspace-write` → must set `skillPolicy.allowFilesystemWrite=true`.
- **Auto-select** at `skill-job.ts:186`: if `skillPolicy.autoSelect=true` and `requiredCapabilities` are set, picks the highest-scoring skill from the registry.

### `src/security-policy.ts` — Container Security Profiles
- **Three levels** at `security-policy.ts:138`:
  - `strict` — no network, read-only rootfs, drop ALL caps, no new privileges, PID limit 256.
  - `balanced` — whitelist network (`lobster-sandbox-net`), read-only rootfs, drop ALL + add `NET_BIND_SERVICE`.
  - `permissive` — bridge network, read-write rootfs, add `NET_BIND_SERVICE` + `SYS_PTRACE`.
- **`tmpfs` mount** at `security-policy.ts:238` — when `readonlyRootfs=true`, mounts `/tmp` as a tmpfs (size configurable, default 64 MiB). This is the only writable path for strict/balanced containers.
- **Seccomp:** Optional `seccompProfile` path; exit code 159 (SIGSYS) is detected as a seccomp violation.
- **Sensitive path blocklist** at `security-policy.ts:13`: `/proc`, `/sys`, `/var/run/docker.sock`, `/etc/shadow`, `/etc/passwd` must never be bind-mounted.

### `src/credential-injector.ts` — LLM Key Management
- **Priority chain** at `credential-injector.ts:26`: `payload.llmConfig.apiKey` > `LLM_API_KEY` env > empty.
- **Output env vars** at `credential-injector.ts:52`: `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL`, `AI_WIRE_API` — prefixed `AI_` to avoid collision with host `LLM_*` vars.
- **Validation** at `credential-injector.ts:65`: API key must be >8 chars.

### `src/credential-scrubber.ts` — Output Sanitization
- **Purpose:** After AI jobs, scrubs `sk-[A-Za-z0-9]{20,}` and `clp_[A-Za-z0-9]{20,}` patterns plus exact injected key values from all text files in `workspace/artifacts/` and from `executor.log`.
- **Applied at** `docker-runner.ts:527` — scrubbing runs after container exits, before artifact collection and final event emission.
- **Live stream scrubbing** at `docker-runner.ts:1061` — each `job.log_stream` line is scrubbed inline before emission, truncated to 4096 chars.

### `src/callback-sender.ts` — Event Delivery with Retries
- **Purpose:** POSTs HMAC-signed events to Cube Brain's `eventsUrl`. Never throws — callback failure must not block job execution (`callback-sender.ts:38-57`).
- **Retry policy:** Exponential backoff, default 3 retries, 1 s base delay (doubles each attempt: 1s, 2s, 4s).
- **HMAC signature** at `src/hmac-signer.ts:7`: `HMAC-SHA256(secret, "${timestamp}.${rawBody}")` — sent as `x-cube-executor-signature` + `x-cube-executor-timestamp` + `x-cube-executor-id` headers.

### `src/concurrency-limiter.ts` — FIFO Semaphore
- **Purpose:** Limits concurrent job execution to `maxConcurrentJobs` (default 2 in mock mode).
- **Implementation** at `concurrency-limiter.ts:18`: promise-based FIFO queue. `acquire()` resolves immediately if under capacity, otherwise queues. `release()` unblocks next waiter directly (current count never decrements while waiters exist).

### `src/log-batcher.ts` — Buffered Log Emission
- **Purpose:** Prevents flooding Cube Brain with one event per log line. Two modes: legacy push-based (DockerRunner `job.log` events) and stream-aware append/flush (live preview `job.log_stream`).
- **Flush triggers:** Accumulated ≥ 4096 bytes OR 500 ms timer fires. Binary-search UTF-8 boundary slicing at `log-batcher.ts:184` prevents split multi-byte characters.

### `src/security-audit.ts` — Append-Only Audit Trail
- **Purpose:** Writes every container lifecycle event to `dataRoot/security-audit.jsonl` (one JSON record per line). Queryable via `GET /api/executor/security-audit?jobId=<id>`.
- **Events logged:** `container.created`, `container.started`, `container.destroyed`, `container.oom`, `container.seccomp_violation`, `container.security_failure`, `preview.session.created`, `preview.session.stopped`.

### `src/ai-task-presets.ts` — LLM Parameter Profiles
- **Four presets** at `ai-task-presets.ts:15`: `text-generation` (temp 0.7), `code-generation` (temp 0.2), `data-analysis` (temp 0.1, jsonMode), `image-understanding` (temp 0.5, image input). Unknown types fall back to `text-generation`.

---

## 4. Skill Execution

Skills are filesystem directories under `skillRoot/` (default `services/lobster-executor/skills/`). Each skill has:

```
skills/<name>/
  skill.json          — manifest (name, version, capabilities[], runtime, entrypoint, security)
  run.js (or .py)     — the executable entrypoint
  input.schema.json   — JSON Schema for skill input validation
  examples/           — example inputs
```

**Skill execution flow:**

1. `resolveSandboxSkillBinding()` (`skill-job.ts:195`) — looks up the skill, validates governance.
2. `DockerRunner.prepareSkillWorkspace()` (`docker-runner.ts:1192`) — copies skill directory to `workspace/skills/current/`, writes `skill-input.json` and `skill-manifest.json`.
3. Container is started with:
   - `Entrypoint: [skill.runtime]` (e.g. `"node"`)
   - `Cmd: ["/workspace/skills/current/<entrypoint>", "/workspace/skill-input.json"]`
   - Env: `CUBE_SKILL_INPUT`, `CUBE_SKILL_ARTIFACTS_DIR`, `CUBE_SKILL_NAME`, `CUBE_SKILL_VERSION`
4. Skill writes output to `/workspace/artifacts/` + an `artifact-manifest.json`.
5. Host collects artifacts via `collectArtifacts()` (`docker-runner.ts:989`).

**Example skill: `browser-research`** (`skills/browser-research/skill.json:1`) — capabilities: `browser.playwright`, `browser.chromium`, `artifact.image`, `artifact.html`, `artifact.json`, `preview.*`. Security: `network: "required"`, `browser: true`, no credentials. Entrypoint `run.js` uses Playwright Chromium headless to screenshot + HTML-dump a URL.

**Example skill: `document-render`** — separate skill for document conversion (LibreOffice/Pandoc based on capability manifest).

---

## 5. Browser Automation

**Two paths to browser execution:**

### Path 1: `browserTask` payload (ad-hoc)
- Job payload contains `browserTask: { url, viewport, waitUntil, capture, screenshot }`.
- No `command`, no `skillRef`.
- Docker container entrypoint: `["node", "/opt/cube-agent/browser-runner.js"]` (`docker-runner.ts:762`).
- `browser-runner.js` is baked into the `cube-ai-agent-sandbox` Docker image at `/opt/cube-agent/`.
- Artifacts: `page-screenshot.png`, `page.html`, `console.json`, `browser-metrics.json`.

### Path 2: `browser-research` skill (via skillRef)
- Job payload contains `skillRef: { name: "browser-research" }`.
- Skill `run.js` is copied into container workspace and run by the node runtime.
- Same Playwright Chromium underneath; outputs `page-screenshot.png`, `page.html`, `browser-report.json`.

**Live preview mechanism** (`docker-runner.ts:845-864`):
- While container is running, a `setInterval` (min 250 ms) polls `workspace/artifacts/page-screenshot.png` by size+mtime signature.
- On change: reads file, base64-encodes it (max 350 KB), emits `job.screenshot` event with `imageData`, `imageWidth`, `imageHeight`.
- Chromium args: `--no-sandbox --disable-dev-shm-usage` (required for containers).

**Browser library:** Playwright with Chromium. No CDP directly — Playwright's `chromium.launch({ executablePath: "/usr/bin/chromium" })` at `browser-runner.js:99`.

---

## 6. Notable Patterns Worth Stealing

### 6.1 Three-Mode Runner Strategy Pattern
`src/runner.ts` defines a `JobRunner` interface with `run()`, `cancel?()`, `pause?()`, `resume?()`. `createJobRunner()` factory selects `MockRunner | NativeRunner | DockerRunner` based on `executionMode`. This is directly applicable to Gap Map: swap Python sidecar / subprocess / MCP tool backends behind the same interface.

### 6.2 HMAC-Signed Callback Events
Every event POSTed back to the server carries `x-cube-executor-signature` = `HMAC-SHA256(secret, "${timestamp}.${body}")`. The timestamp prevents replay attacks. The `executorId` header identifies the sender. Gap Map's MCP server could use the same pattern to authenticate tool-result callbacks from the sidecar.

### 6.3 Capability Negotiation at Submit Time
`validateRequiredCapabilities()` (`capabilities.ts:190`) checks the job's `requiredCapabilities[]` against the executor's live capability set before accepting the job. Jobs are rejected with a structured error listing `unsupportedCapabilities` and `supportedCapabilities`. For Gap Map: tools/sources could declare their capabilities (e.g. `source.pubmed`, `source.semantic_scholar`), and the pipeline could check availability before enqueueing.

### 6.4 Skill Auto-Selection by Capability Score
`SandboxSkillRegistry.findByCapabilities()` (`skill-registry.ts:111`) scores skills: `covered/required - safetyPenalty`. Penalty is 0.08 for credential-needing skills, 0.04 for network-required. This means the safest skill that covers the required capabilities is preferred. Gap Map's tool-selection logic could use a similar scoring approach.

### 6.5 Three-Level Security Presets
`strict` / `balanced` / `permissive` preset ladder (`security-policy.ts:138`) is clean and extensible. The key insight: AI jobs need outbound network but should keep other hardening, so `resolveSecurityPolicyForRecord()` silently upgrades only the network from `strict→balanced` for `aiEnabled` jobs. For Gap Map processes (e.g. running user-specified Python): the same ladder applies even in a subprocess context — restrict env vars, working directory, and kill on timeout.

### 6.6 Credential Scrubbing on All AI Job Outputs
After every AI-enabled container run, `CredentialScrubber` walks the entire artifacts directory and the log file, replacing `sk-...` / `clp_...` patterns and exact injected key values with `[REDACTED]`. This runs before events are emitted and before artifacts are returned. Gap Map should apply the same post-processing to any LLM-call logs before writing to SQLite or returning to the frontend.

### 6.7 Idempotency Key on Job Submission
`service.ts:451-461` — if `request.requestId === existing.request.requestId` OR `request.idempotencyKey === existing.request.idempotencyKey`, the same accepted response is returned without re-running. Prevents double-execution on network retries. Gap Map's MCP tool calls should carry idempotency keys for any stateful side-effect operations (paper ingestion, embedding writes).

### 6.8 Events JSONL + Artifact Manifest
Jobs write a local `events.jsonl` and a `result.json` plus an `artifact-manifest.json` produced by the container. The manifest contains per-file `mimeType`, `previewType`, `description`, `id`, `size`. This self-describing artifact envelope is exactly what Gap Map needs for its paper pipeline outputs — each research result should carry metadata describing what it is, how to preview it, and what produced it.

### 6.9 Pause/Resume via Promise Gate
`waitUntilResumed()` (`service.ts:661`) uses a plain Promise stored in `record.resumeWaiter`. Pause sets the promise; resume calls `resumeWaiter.resolve()`. No polling, zero CPU overhead. Gap Map's paper workflow could use the same pattern to suspend mid-pipeline when the user pauses a research run.

### 6.10 FIFO Semaphore Concurrency Limiter
`ConcurrencyLimiter` (`concurrency-limiter.ts`) is a 40-line semaphore with FIFO waiter queue. Gap Map's sidecar already has a rough concurrency model; replacing it with this pattern would prevent thundering-herd when multiple topics are queued.

### 6.11 LogBatcher with Size + Time Dual Trigger
`LogBatcher` (`log-batcher.ts`) flushes when buffer reaches 4096 bytes OR when 500 ms elapses since last push. This prevents both flooding (high-frequency logs) and staleness (sparse logs). Gap Map's streaming output from Python tools is currently flushed line-by-line; batching with a dual trigger would reduce IPC overhead significantly.

### 6.12 AI-Bridge Wire API Abstraction
`ai-bridge/index.js` reads `AI_WIRE_API` to select between Chat Completions and Responses API, and reads `AI_BASE_URL` / `AI_MODEL` from env. This is the same pattern Gap Map's `tauri-python-sidecar-app` skill documents for LLM provider auto-resolution. The in-container bridge confirms the pattern: never hardcode `openai.com` — always resolve at runtime from injected env.

---

## 7. Port to Gap Map — Concrete Ideas

Gap Map is a Tauri 2 desktop app with a Python sidecar (`gapmap_cli`) that runs paper research, an MCP server (`src/gapmap/mcp/server.py`), and a BYOK multi-LLM setup. The following ideas are tagged **effort S/M/L** and **value H/M/L**.

### 7.1 Job Lifecycle Events Protocol (S/H)
**What:** Adopt lobster-executor's typed event vocabulary for Gap Map's sidecar output. Currently the sidecar emits ad-hoc JSON lines; standardising on `{ type, status, progress, message, artifacts }` events would give the frontend a consistent shape to render.

**How:** Add `emit_event(type, status, progress, message, artifacts=None)` to the Python sidecar. The Tauri `run_cli` command already reads stdout; map the event types to frontend state.

**Files to touch:** `src/gapmap/cli/main.py`, `app-tauri/src/main.js`.

### 7.2 Three-Level Security for Python Subprocess (S/M)
**What:** When Gap Map spawns Python scripts (e.g. user-uploaded analysis scripts or MCP-triggered tools), apply a `strict/balanced/permissive` preset — env var allowlist, working directory confinement, stdout-only IPC (no shell=True), SIGTERM→SIGKILL timeout ladder.

**How:** A ~50-line `ProcessPolicy` dataclass in Python mirroring `SecurityConfig`. Default to `strict` (no network, confined tmp dir, kill after 60 s). Upgrade to `balanced` only for paper-source fetches (need network).

**Files to touch:** New `src/gapmap/runtime/process_policy.py`. Called from `paper_pipeline.py`.

### 7.3 Credential Scrubber for LLM Outputs (S/H)
**What:** After any LLM call in the Python sidecar, scrub `sk-...`, `sk-ant-...`, `clp_...` patterns from logged output before it appears in the Tauri log panel or is written to SQLite.

**How:** Port `CredentialScrubber.scrubLine()` to Python — 15 lines with `re.sub`. Apply in `src/gapmap/runtime/explanations.py` and any tool that logs LLM completions.

**Files to touch:** New `src/gapmap/runtime/credential_scrubber.py`.

### 7.4 Idempotency Keys for Paper Ingestion (S/H)
**What:** Paper ingestion (`paper_pipeline.py`) currently may re-fetch and re-embed the same DOI on repeated runs. Add an idempotency check: `INSERT OR IGNORE` on `(doi, source)` before fetching, plus an in-memory `Set[str]` of in-flight DOIs during a pipeline run.

**How:** Already partially solved by `paper_pipeline.py`'s dedup logic; formalize it with an explicit idempotency key = `sha256(doi + topic + source)` in the jobs table.

**Files to touch:** `src/gapmap/research/paper_pipeline.py`.

### 7.5 Skill Registry for Gap Map Sources/Tools (M/H)
**What:** Model each research source (OpenAlex, PubMed, Semantic Scholar, future sources) as a "skill" with a `skill.json` manifest declaring its capabilities (`source.openalex`, `source.pubmed`), security requirements (`network: required`), and input schema.

**How:** Create `src/gapmap/skills/<source-name>/skill.json` + `run.py`. The existing `sources/` module is already split per-source — this is mostly an organisational formalisation. Benefit: the MCP server's `list_tools` could read from the registry and expose each source as an MCP tool automatically.

**Files to touch:** New `src/gapmap/skills/` directory structure. `src/gapmap/mcp/server.py` updated to enumerate skills.

**Effort:** M (one-time schema + registry reader). **Value:** H (enables auto-discovery of tools by MCP clients).

### 7.6 Capability Negotiation in MCP Server (M/H)
**What:** Gap Map's MCP server currently exposes tools unconditionally. If a required API key or dependency is missing (no PubMed key, no `playwright` installed), the tool call fails at runtime. Instead, advertise capabilities on `initialize` and let the MCP client decide which tools to invoke.

**How:** At MCP server startup, check which sources are available (API key present, optional deps installed) and include a `capabilities` array in the `initialize` response or as a tool resource. Mirror `createExecutorCapabilities()` — check `LLM_API_KEY`, `PUBMED_API_KEY`, etc.

**Files to touch:** `src/gapmap/mcp/server.py`.

**Effort:** M. **Value:** H — prevents confusing runtime failures from missing keys.

### 7.7 Artifact Manifest for Paper Results (M/M)
**What:** Research pipeline outputs (lit-matrix JSON, paper chunks SQLite, explanation MD files) are currently just files on disk with no metadata envelope. Adopt the `artifact-manifest.json` pattern: each pipeline run writes a manifest listing all output files with `mimeType`, `previewType`, `description`.

**How:** At the end of `paper_workflow.py` (or `paper_pipeline.py`), write `<dataRoot>/runs/<run_id>/artifact-manifest.json`. The Tauri frontend reads this to populate the results panel.

**Files to touch:** `src/gapmap/research/paper_workflow.py`, `app-tauri/src/main.js`.

**Effort:** M. **Value:** M — better UX in the results panel; enables preview-type rendering.

### 7.8 HMAC-Signed Sidecar Events (L/M)
**What:** For multi-user or multi-machine Gap Map scenarios (sidecar on a remote machine, MCP over network), sign sidecar events with `HMAC-SHA256(secret, timestamp.body)` to authenticate them to the Tauri frontend or MCP server.

**How:** Port `hmac-signer.ts` to Python (5 lines with `hmac.new`). Add `X-GapMap-Signature` header to any HTTP callbacks the sidecar makes.

**Files to touch:** New `src/gapmap/runtime/hmac_signer.py`. Used if Gap Map ever adds a remote-sidecar mode.

**Effort:** L (low priority for desktop-only). **Value:** M (important if remote mode ships).

### 7.9 Pause/Resume Gate for Research Pipelines (M/M)
**What:** Gap Map research runs can take 5–20 minutes. Adding a pause/resume mechanism (like `waitUntilResumed()`) would let users pause a run, inspect partial results, then continue.

**How:** Add a `pause_event` (Python `asyncio.Event`) to `paper_workflow.py`. The Tauri frontend calls a new `pause_pipeline` command; the Python sidecar checks `await pause_event.wait()` between paper batches.

**Files to touch:** `src/gapmap/research/paper_workflow.py`, `src/gapmap/cli/main.py`, `app-tauri/src/main.js`.

**Effort:** M. **Value:** M — quality-of-life for long research runs.

### 7.10 LogBatcher for Sidecar Stdout (S/M)
**What:** Gap Map's `run_cli` in Tauri currently receives one event per JSON line from the sidecar. Under high-throughput (100+ papers being chunked), this creates IPC overhead. Buffer sidecar log lines for 500 ms or 4096 bytes before emitting.

**How:** Python `LogBatcher` class: maintain a buffer + `threading.Timer`. Flush on buffer full or timer fire. Emit batched lines as a single `{ type: "job.log", message: "..." }` JSON line.

**Files to touch:** New `src/gapmap/runtime/log_batcher.py`. Used in `src/gapmap/cli/main.py`.

**Effort:** S. **Value:** M — most valuable when processing large topic graphs.

---

## Summary

lobster-executor is a production-grade asynchronous job execution engine with pluggable runners (mock/native/Docker), a full container security model (3 levels, seccomp, OOM detection), credential lifecycle management (inject → scrub), HMAC-signed callbacks with retries, a skill registry with capability-scored auto-selection, live browser preview via Playwright screenshot polling, and a robust FIFO concurrency limiter.

The patterns most directly applicable to Gap Map are: (1) typed event protocol for sidecar stdout, (2) credential scrubbing before any LLM output is logged, (3) idempotency keys on paper ingestion, (4) the skill-registry pattern to auto-expose sources as MCP tools, and (5) capability negotiation in the MCP `initialize` response to prevent runtime failures from missing API keys.
