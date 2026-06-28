# WhyBuddy Skills System — Deep Analysis

**Date:** 2026-06-13
**Source repo:** `myind-openreply-ref/WhyBuddy`
**Scope:** All skills-related surfaces — shared contracts, server-side registry/activator/monitor, lobster-executor sandbox skill system, built-in skill catalog, security model, authoring contract.

---

## Table of Contents

1. [Two Distinct Skill Systems](#1-two-distinct-skill-systems)
2. [Skill Model — Shared Contracts](#2-skill-model--shared-contracts)
3. [System A: LLM-Prompt Skills (Server-Side)](#3-system-a-llm-prompt-skills-server-side)
4. [System B: Sandbox Skills (Lobster-Executor)](#4-system-b-sandbox-skills-lobster-executor)
5. [Built-in Skill Catalog](#5-built-in-skill-catalog)
6. [Execution and Sandboxing](#6-execution-and-sandboxing)
7. [Authoring Contract](#7-authoring-contract)
8. [Security Model](#8-security-model)
9. [Monitoring and Observability](#9-monitoring-and-observability)
10. [Notable Patterns Worth Stealing](#10-notable-patterns-worth-stealing)
11. [Port to OpenReply](#11-port-to-openreply-map)

---

## 1. Two Distinct Skill Systems

WhyBuddy runs **two completely separate skill systems** that share naming but serve different purposes.

| Dimension | System A: LLM-Prompt Skills | System B: Sandbox Skills |
|---|---|---|
| Purpose | Inject reusable prompt behavior into agent LLM calls | Execute real code (Node/Python/Bash) inside Docker containers |
| Location | `server/core/skill-*.ts` + `shared/skill-contracts.ts` | `services/lobster-executor/` + `shared/executor/skill-manifest.ts` |
| Manifest format | `SkillDefinition` (TypeScript, DB-persisted) | `skill.json` (JSON, filesystem) |
| Versioning | Semver in DB, canary % routing | Semver in `skill.json`, immutable at load |
| Activation | `SkillActivator` → prompt injection into agent system prompt | `SandboxSkillRegistry.findByCapabilities()` → Docker container |
| Isolation | Context object per skill (`SkillContext`) | Full Docker container with seccomp, read-only rootfs, resource caps |
| Runtime | LLM tokens | Node/Python/Bash process inside container |

Understanding that these are two systems with different lifecycles is essential before reading any individual file.

---

## 2. Skill Model — Shared Contracts

### 2.1 LLM-Prompt Skill Schema

Defined at `shared/skill-contracts.ts:25-44`.

```typescript
interface SkillDefinition {
  id: string;          // global unique key e.g. "code-review"
  name: string;        // human label
  category: string;    // "code" | "data" | "security" | "analysis" | "planning"
  summary: string;     // one-line description
  prompt: string;      // MUST contain {context} and {input} placeholders
  requiredMcp: string[]; // MCP tool IDs this skill depends on
  version: string;     // semver "X.Y.Z"
  tags: string[];
  dependencies?: string[]; // other skill IDs resolved recursively
}
```

`SkillRecord` (`shared/skill-contracts.ts:63-72`) extends this with runtime state: `enabled: boolean`, `canary?: CanaryConfig`, `createdAt`, `updatedAt`.

`SkillBinding` (`shared/skill-contracts.ts:90-97`) is the resolved runtime form used during agent execution: holds the `SkillRecord`, resolved `WorkflowMcpBinding[]`, and optional `SkillBindingConfig` (temperature, maxTokens, priority).

`ActivatedSkill` (`shared/skill-contracts.ts:164-173`) is the final output after prompt placeholder substitution — `resolvedPrompt` has `{context}` replaced with actual task context.

### 2.2 Sandbox Skill Manifest Schema

Defined at `shared/executor/skill-manifest.ts:27-55`.

```typescript
interface SandboxSkillManifest {
  name: string;           // kebab-case, lowercase alphanumeric + . _ -
  version: string;        // semver X.Y.Z
  description: string;
  enabled: boolean;
  capabilities: ExecutorCapability[]; // must be subset of known EXECUTOR_CAPABILITIES
  runtime: "node" | "python" | "bash";
  entrypoint: string;     // relative path, no ".." traversal, no absolute
  dependencies: string[];
  inputs: {
    schema?: string;      // relative path to JSON Schema file
    examples?: string[];  // relative paths to example input files
  };
  outputs: {
    artifacts: string[];
    previewTypes: Array<"text" | "json" | "html" | "pdf" | "image" | "log">;
  };
  artifactRules: Array<{
    pattern: string;
    mimeType?: string;
    previewType?: "text" | "json" | "html" | "pdf" | "image" | "log";
  }>;
  security: {
    network: "none" | "optional" | "required";
    filesystem: "readonly" | "workspace" | "workspace-write";
    browser: boolean;
    credentials: string[];
  };
}
```

Validation is done with a Zod schema (`sandboxSkillManifestSchema`, `shared/executor/skill-manifest.ts:113-158`) that enforces: lowercase name regex, semver version, no path traversal in entrypoint, capabilities must be in `EXECUTOR_CAPABILITY_SET`.

---

## 3. System A: LLM-Prompt Skills (Server-Side)

### 3.1 Discovery and Registration

**Entry point:** `server/core/skill-seed.ts:100-112` — `seedSkills()` is called at server startup. It iterates `SEED_SKILLS`, calls `skillRegistry.registerSkill(def)` for each that doesn't already exist in the DB.

**Registry:** `server/core/skill-registry.ts` — `SkillRegistry` class, constructed with a `Database` instance.

`registerSkill()` (`skill-registry.ts:73-88`):
1. Calls `validateSkillDefinition()` — checks required fields, semver format, and that prompt contains both `{context}` and `{input}` placeholders.
2. Builds a `SkillRecord` with `enabled: true` and timestamps.
3. Calls `this.db.upsertSkill(record)` — same `id + version` key is an upsert.

### 3.2 Resolution and Dependency Walking

`resolveSkills(skillIds, options)` (`skill-registry.ts:99-164`):

- Loads all skills from DB once (`db.getSkills()`).
- Recursively resolves each skill ID with cycle detection via a `visiting: Set<string>`.
- Throws `CircularDependencyError` (with full cycle path) if a cycle is detected — `shared/skill-contracts.ts:180-188`.
- Respects `options.versionMap` for pinning specific versions per skill.
- Skips disabled skills unless `options.includeDisabled = true`.
- **Canary routing** (`skill-registry.ts:191-202`): if the latest version has `canary.enabled = true`, uses `Math.random()` to route `canary.percentage`% of resolutions to `canary.targetVersion`.

### 3.3 MCP Binding

`resolveMcpForSkill(skill, agentId, workflowId)` (`skill-registry.ts:282-299`):
- Takes a `SkillRecord`'s `requiredMcp[]` list and calls `resolveMcpBindings()` from `dynamic-organization.ts`.
- Returns `WorkflowMcpBinding[]` with warn-and-skip for missing MCP tools.

### 3.4 Activation

`server/core/skill-activator.ts` — `SkillActivator` class (stateless).

`activateSkills(skills, taskContext, maxSkills=5)` (`skill-activator.ts:23-46`):
1. Filters to `enabled = true` bindings.
2. Sorts descending by `config.priority` (default 0).
3. Truncates to `maxSkills` (default 5).
4. Replaces `{context}` placeholder in each prompt with `taskContext`.
5. Returns `ActivatedSkill[]` with `resolvedPrompt`.

`buildSkillPromptSection(activatedSkills)` (`skill-activator.ts:53-63`):
- Formats each skill as `## Skill: <name> (v<version>)\n<resolvedPrompt>`.
- Wraps in `\n# Active Skills\n\n...\n`.
- This string is prepended/appended to the agent's system prompt.

Note: the `{input}` placeholder in the raw skill prompt is **not** replaced by `SkillActivator` — the activator only replaces `{context}`. The `{input}` substitution happens downstream when the agent actually invokes the skill with real user input.

### 3.5 Context Isolation

`server/core/skill-context.ts` — `createSkillContext(skillId)` returns a fresh `SkillContext` with isolated `input`, `output`, `state`, and `sideEffects` maps. `recordSideEffect()` appends typed side-effect entries (`file_write | db_operation | api_call`) with `reversible` flag and timestamp. This is a pure data container — no runtime enforcement.

### 3.6 Enable/Disable and Audit

`SkillRegistry.enableSkill()` / `disableSkill()` (`skill-registry.ts:211-255`):
- Flip `enabled` on the record and `upsertSkill`.
- Call `db.createSkillAuditLog()` with `action: "enable" | "disable"`, `operator`, `reason`, `timestamp`.

Audit log type: `SkillAuditLog` (`shared/skill-contracts.ts:128-136`) — supports actions `enable | disable | register | version_switch`.

---

## 4. System B: Sandbox Skills (Lobster-Executor)

### 4.1 Discovery

`services/lobster-executor/src/skill-registry.ts` — `SandboxSkillRegistry` class.

Constructor calls `reload()` immediately (`skill-registry.ts:76-94`):
1. Reads the `skills/` root directory (default: `services/lobster-executor/skills`).
2. For each sub-directory matching `[a-zA-Z0-9._-]+` (no `..`), calls `loadSkillDirectory()`.
3. Reads `skill.json` from each directory.
4. Validates with `validateSandboxSkillManifest()` (Zod).
5. Checks that the `entrypoint` file actually exists on disk and is within the skill directory (no escaping).
6. Builds three indexes: `byKey` (`name@version`), `byName`, `byCapability`.
7. Sorts final list by `name@version` for deterministic ordering.

Crucially: **skill code is never executed during discovery** (`skill-registry.test.ts:164-180` explicitly tests this).

### 4.2 Validation

`validateSandboxSkillManifest(input)` (`shared/executor/skill-manifest.ts:160-179`):
- Zod `safeParse` with `.strict()` (no extra keys allowed).
- Returns `{ ok, manifest?, errors[] }`.
- Path validation: `relativePathSchema` rejects `..` traversal and absolute paths (both Unix `/` and Windows `C:\`).
- Capability validation: `capabilitySchema` uses `EXECUTOR_CAPABILITY_SET` (26 known capabilities) — unknown strings are rejected with clear error message.
- `enabled` defaults to `true`.

### 4.3 Capability-Based Auto-Selection

`SandboxSkillRegistry.findByCapabilities(required, options)` (`skill-registry.ts:110-152`):

Scoring algorithm:
```
score = coveredCapabilities.length / requiredCapabilities.length
      - (credentialsPenalty: 0.08 if skill uses credentials)
      - (networkPenalty: 0.04 if network="required")
```

- Returns only skills with zero missing capabilities (unless `includePartial: true`).
- Sorted descending by score, then alphabetically by `name@version` as tiebreaker.
- Safer skills (no credentials, no network) rank higher for equivalent coverage.

### 4.4 Job Resolution

`services/lobster-executor/src/skill-job.ts` — `resolveSandboxSkillBinding(planJob, config)`:

Called per job before container creation. Pipeline:
1. Parse `payload.skillRef` (explicit name+version) or fall back to `payload.skillPolicy.autoSelect`.
2. If `autoSelect`, call `registry.findByCapabilities(requiredCapabilities)` — first match wins.
3. `ensureUnambiguousSkillPayload()` — rejects combining `skillRef` with `command` or `browserTask`.
4. `assertSkillUsable()` — rejects `compatible=false` or `disabled=true` skills.
5. `assertSkillCapabilities()` — verifies the skill's declared capabilities cover the job's `requiredCapabilities` (executor-owned prefixes `runtime.*`, `executor.*`, `security.*` are stripped before matching).
6. `assertSkillGovernance()` — enforces:
   - Skills with `credentials[]` require `payload.skillPolicy.allowCredentials = true`.
   - Skills with `network="required"` require `allowNetwork = true` when executor `securityLevel = "strict"`.
   - Skills with `filesystem="workspace-write"` require `allowFilesystemWrite = true`.
7. Returns `SandboxSkillBinding` with `manifest`, `directory`, `input`, `requiredCapabilities`, `autoSelected`.

### 4.5 Workspace Preparation

`DockerRunner.prepareSkillWorkspace()` (`docker-runner.ts:1192-1214`):
- Copies the entire skill directory to `/workspace/skills/current/` inside the container's bind-mounted workspace.
- Writes `skill-input.json` (the parsed `payload.skillInput` object, pretty-printed JSON).
- Writes `skill-manifest.json` (the full manifest, pretty-printed JSON).
- Sets environment variables in the container:
  - `CUBE_SKILL_INPUT=/workspace/skill-input.json`
  - `CUBE_SKILL_ARTIFACTS_DIR=/workspace/artifacts`
  - `CUBE_SKILL_NAME=<name>`
  - `CUBE_SKILL_VERSION=<version>`

Container `Entrypoint` is set to `[skill.manifest.runtime]` (i.e. `node`, `python`, or `bash`).
Container `Cmd` is set to `["/workspace/skills/current/<entrypoint>", "/workspace/skill-input.json"]`.

### 4.6 Artifact Collection

After container exit, `DockerRunner.collectArtifacts()` (`docker-runner.ts:989-1048`):
1. Always includes `executor.log` and `result.json`.
2. Reads `/workspace/artifacts/` directory.
3. If `artifact-manifest.json` exists there (written by the skill), uses it for `mimeType`, `previewType`, `kind`, `description`.
4. Falls back to filename-based inference (`inferMimeType()`, `inferPreviewType()`).

The skill is expected to write `artifact-manifest.json` itself — the `browser-research` and `document-render` skills both do this.

---

## 5. Built-in Skill Catalog

### 5A. LLM-Prompt Seed Skills (System A)

All defined in `server/core/skill-seed.ts:13-94`, version `1.0.0`:

| ID | Category | Summary | Required MCP |
|---|---|---|---|
| `directive-decomposition` | planning | Break vague requests into concrete deliverables, risks, ownership | none |
| `plan-synthesis` | planning | Convert direction into execution-ready sub-tasks with handoffs | none |
| `system-design` | code | Design service/API/data/integration changes with tradeoffs | none |
| `execution-playbook` | code | Produce ordered implementation steps with acceptance signals | none |
| `evidence-review` | analysis | Ground claims in workflow artifacts and task outputs | `workflow-memory` |
| `quality-audit` | analysis | Check depth, correctness, coverage, actionability | none |
| `user-outcome-thinking` | analysis | Evaluate work through user value, clarity, operational impact | none |
| `tooling-integration` | code | Reason about skills, tools, MCP connectors, interface boundaries | `tool-registry` |

All 8 have `{context}` and `{input}` in their prompts. Two (`evidence-review`, `tooling-integration`) declare MCP dependencies.

### 5B. Sandbox Skills (System B)

Two ship in `services/lobster-executor/skills/`:

**`browser-research` v0.1.0** (`skills/browser-research/skill.json`):
- Runtime: `node`, entrypoint: `run.js`
- Network: `required`; browser: `true`
- Capabilities: `browser.playwright`, `browser.chromium`, `artifact.image`, `artifact.html`, `artifact.json`, `preview.image`, `preview.html`, `preview.json`
- Input: `{ url: string, viewport?, waitUntil?, timeoutMs? }`
- Output artifacts: `page-screenshot.png`, `page.html`, `browser-report.json`
- What it does: Launches headless Chromium via Playwright, navigates to the URL, takes a full-page screenshot, saves the HTML, writes a JSON report with title and final URL. Writes `artifact-manifest.json`.

**`document-render` v0.1.0** (`skills/document-render/skill.json`):
- Runtime: `node`, entrypoint: `run.js`
- Network: `none`; browser: `false`
- Capabilities: `document.pandoc`, `document.libreoffice`, `artifact.html`, `artifact.pdf`, `artifact.json`, `preview.html`, `preview.pdf`, `preview.json`
- Input: `{ title?: string, markdown?: string }`
- Output artifacts: `document.html`, `document.pdf` (if LibreOffice available), `document-report.json`
- What it does: Writes the markdown to a temp `.md` file, runs `pandoc` to convert to HTML (falls back to escaped plain HTML if pandoc fails), runs `libreoffice --headless --convert-to pdf` to produce PDF (graceful failure). Writes `artifact-manifest.json`.

### 5C. Development/CI Scripts (skills/whybuddy/)

The `skills/whybuddy/whybuddy/scripts/` directory contains Python CI-gate utilities — not runtime skills, but part of the build-verification pipeline:

- `gate.py`: Runs a child command, appends a tamper-evident JSON ledger entry with exit code + stdout/stderr.
- `validate_spec_tree.py`: Validates a spec-tree JSON has nodes with non-empty `id` fields.
- `check_companion.py`, `check_content_quality.py`, `check_previews_real.py`: Quality-gate checks.
- `skills/whybuddy.zip`: Archived version of the above.

---

## 6. Execution and Sandboxing

### 6.1 Container Lifecycle (per sandbox skill job)

From `docker-runner.ts:242-630`, the 10-step lifecycle:

```
1. Create workspace directory (host bind-mount)
2. prepareSkillWorkspace() — copy skill files + write skill-input.json
3. createContainer() — image selection, env injection, entrypoint override
4. container.start()
5. Emit job.started event (with securitySummary, networkPolicy, skill metadata)
6. streamAndWait() — demux stdout/stderr, LogBatcher callbacks, progress ticks,
                     live screenshot polling (if livePreview enabled)
7. container.wait() — with timeout → SIGTERM → SIGKILL escalation
8. Inspect exit code — detect OOM, SIGSYS (seccomp violation, exit=159)
9. collectArtifacts() — from /workspace/artifacts/ + artifact-manifest.json
10. cleanupContainer() — docker rm --force
```

All 10 steps are audit-logged via `SecurityAuditLogger` (`security-audit.ts`).

### 6.2 Security Levels

Three levels from `security-policy.ts:138-177`, configured by `LOBSTER_SECURITY_LEVEL` env var (default: `strict`):

| Level | ReadonlyRootfs | Network | CapDrop | CapAdd | Notes |
|---|---|---|---|---|---|
| `strict` | true | none | ALL | none | No network at all |
| `balanced` | true | whitelist | ALL | NET_BIND_SERVICE | Custom Docker network |
| `permissive` | false | bridge | ALL | NET_BIND_SERVICE, SYS_PTRACE | Normal Docker bridge |

All levels: `noNewPrivileges: true`, user `65534` (nobody), 512MB RAM, 1.0 CPU, 256 PIDs, 64MB tmpfs.

Skill governance (`skill-job.ts:138-161`) adds **per-job gates** on top of the level preset:
- Credentials require explicit `allowCredentials = true` in `skillPolicy`.
- Network-requiring skills in `strict` mode require explicit `allowNetwork = true`.
- `workspace-write` filesystem requires explicit `allowFilesystemWrite = true`.

A skill that declares `security.network = "required"` will fail to run in strict mode unless the job explicitly opts in — defense-in-depth.

### 6.3 Seccomp Profile

`services/lobster-executor/seccomp.json` exists. Applied via `LOBSTER_SECCOMP_PROFILE` env var. Exit code 159 (128 + SIGSYS = 31) is detected as a seccomp violation and reported with `SECCOMP_VIOLATION` error code.

### 6.4 Capability Negotiation

The executor advertises its capabilities via `createExecutorCapabilities()` (`capabilities.ts:130-178`). These are reported to callers on the health/capabilities endpoint. Skills are only selected if their declared capabilities are a subset of the executor's advertised capabilities. This prevents skills from being invoked on executors that lack the required tools (e.g., a `browser.playwright` skill won't run on a bare `node:20-slim` image).

The agent sandbox image manifest at `agent-image/capabilities.json` declares 21 capabilities including `browser.playwright`, `browser.chromium`, `document.libreoffice`, `document.pandoc`, `media.ffmpeg`, `image.imagemagick`.

### 6.5 Credential Scrubbing

For AI-enabled jobs (`payload.aiEnabled = true`), `CredentialScrubber` (`credential-scrubber.ts`) scrubs API keys from:
- All artifact files in `workspace/artifacts/`
- The executor log file
- Event payloads before HMAC-signed callback delivery

---

## 7. Authoring Contract

### 7.1 Writing a New LLM-Prompt Skill (System A)

Add to `server/core/skill-seed.ts:SEED_SKILLS` or register via `SkillRegistry.registerSkill()`:

```typescript
{
  id: "my-skill",              // unique, kebab-case
  name: "My Skill",
  category: "code",            // or "planning", "analysis", "data", "security"
  summary: "One sentence.",
  prompt: "Given the context: {context}\n\n<instructions>\n\nInput: {input}",
  requiredMcp: [],             // list MCP tool IDs if needed
  version: "1.0.0",
  tags: ["code"],
  dependencies: [],            // other skill IDs to resolve first
}
```

Rules enforced at registration (`skill-registry.ts:33-59`):
- `id`, `name`, `category`, `summary`, `prompt`, `version` must be non-empty strings.
- `tags` and `requiredMcp` must be arrays.
- `prompt` must contain both `{context}` and `{input}`.
- `version` must match `/^\d+\.\d+\.\d+$/`.

### 7.2 Writing a New Sandbox Skill (System B)

Create a directory under `services/lobster-executor/skills/<skill-name>/` with:

**`skill.json`** — must pass `validateSandboxSkillManifest()`:
```json
{
  "name": "my-skill",
  "version": "0.1.0",
  "description": "What this skill does.",
  "enabled": true,
  "capabilities": ["artifact.json", "preview.json"],
  "runtime": "node",
  "entrypoint": "run.js",
  "dependencies": [],
  "inputs": {
    "schema": "input.schema.json",
    "examples": ["examples/basic.json"]
  },
  "outputs": {
    "artifacts": ["report.json"],
    "previewTypes": ["json"]
  },
  "artifactRules": [
    { "pattern": "report.json", "mimeType": "application/json", "previewType": "json" }
  ],
  "security": {
    "network": "none",
    "filesystem": "workspace",
    "browser": false,
    "credentials": []
  }
}
```

**`run.js`** — entrypoint, receives input path as `process.argv[2]`:
```js
const inputPath = process.argv[2] || "/workspace/skill-input.json";
const artifactsDir = process.env.CUBE_SKILL_ARTIFACTS_DIR || "/workspace/artifacts";
const input = JSON.parse(fs.readFileSync(inputPath, "utf8"));
// ... do work, write files to artifactsDir ...
// Write artifact-manifest.json for proper metadata
fs.writeFileSync(path.join(artifactsDir, "artifact-manifest.json"),
  JSON.stringify({ version: "2026-05-04", source: "my-skill", artifacts: [...] }));
// Exit 0 = success, non-0 = failure
```

**`input.schema.json`** — JSON Schema for input validation.

**`examples/basic.json`** — example input for documentation/testing.

The `SandboxSkillRegistry` discovers the skill automatically on the next `reload()` call (at service startup or explicit reload). No registration step needed — filesystem is the registry.

### 7.3 Key Authoring Constraints

From `shared/executor/skill-manifest.ts` Zod schema:
- `name` regex: `^[a-z0-9][a-z0-9._-]*$` — must start with alphanumeric.
- `entrypoint` cannot contain `..` or start with `/` or `C:\`.
- `capabilities` must be drawn from the 26-item `EXECUTOR_CAPABILITIES` list.
- `version` must be exactly `X.Y.Z` format.
- Schema is `.strict()` — no unknown keys are tolerated.

---

## 8. Security Model

### 8.1 Defense-in-Depth Layers

Layer 1 — **Manifest validation** at discovery time: Zod schema rejects unknown capabilities, path traversal, invalid names.

Layer 2 — **Capability negotiation** at job dispatch: skill's declared capabilities must be subset of executor's advertised capabilities.

Layer 3 — **Governance checks** at job resolution (`skill-job.ts`): explicit caller opt-in required for credentials, network access, filesystem writes.

Layer 4 — **Docker container isolation**: read-only rootfs (strict/balanced), drop all Linux capabilities, PID limit, memory limit, CPU limit, tmpfs for `/tmp`.

Layer 5 — **Network policy** at container level: `mode: "none"` for strict (no network interfaces at all), whitelist network for balanced, bridge for permissive.

Layer 6 — **Seccomp profile**: blocks dangerous syscalls; violation detected and reported as `SECCOMP_VIOLATION`.

Layer 7 — **Credential scrubbing**: API keys are scrubbed from all artifacts, logs, and event payloads before delivery.

Layer 8 — **Audit logging**: every container create/start/oom/seccomp/destroy event logged with security level, job ID, mission ID.

### 8.2 Path Traversal Prevention

Two independent checks:
- Schema-level: `relativePathSchema` (`skill-manifest.ts:92-96`) rejects `..`, absolute Unix paths, absolute Windows paths.
- Filesystem-level: `isWithinDirectory()` (`skill-registry.ts:47-55`) resolves both parent and child to absolute paths and checks prefix containment.

Test coverage: `skill-registry.test.ts:91-104` explicitly tests both absolute and `../` traversal attempts.

---

## 9. Monitoring and Observability

### 9.1 SkillMonitor (System A)

`server/core/skill-monitor.ts` — `SkillMonitor` class. All metrics persisted to DB.

`recordMetrics(metrics: SkillExecutionMetrics)`: records per-execution data including `activationTimeMs`, `executionTimeMs`, `tokenCount`, `success`, plus dimensions `workflowId`, `agentId`, `agentRole`, `taskType`.

`getSkillMetrics(skillId, timeRange?)`: returns `AggregatedMetrics` with:
- Total executions, success/failure counts, success rate.
- Average activation and execution time in ms.
- Total token count.
- Breakdowns `byVersion`, `byAgentRole`, `byTaskType` (each with count + successRate).

`checkAlerts(skillId, threshold=0.5, windowMs=3600000)`: checks failure rate in the last hour against threshold (default 50%). Returns `AlertResult` or `null`.

### 9.2 Sandbox Skill in Events (System B)

Skill metadata is embedded in executor events (`docker-runner.ts:102-113`):
```json
{
  "skill": {
    "name": "browser-research",
    "version": "0.1.0",
    "autoSelected": true,
    "capabilities": ["browser.playwright", ...]
  }
}
```

This appears in `job.started`, `job.completed`, `job.failed` events and in `result.json`. Observers can correlate skill usage with job outcomes.

---

## 10. Notable Patterns Worth Stealing

### 10.1 Zod Manifest Validation with `.strict()`

`shared/executor/skill-manifest.ts:113-158` uses a `.strict()` Zod schema for `skill.json`. Unknown fields are rejected outright. This means a developer cannot accidentally rely on undocumented behavior — the contract is enforced at parse time, not discovered at runtime.

**Why it matters:** In OpenReply's Python sidecar, skill/tool configs are often free-form dicts. A Zod-style (or Pydantic) `.strict()` schema with known-enum capability validation would catch authoring mistakes at load time.

### 10.2 Capability-Based Auto-Selection with Safety Penalty

`SandboxSkillRegistry.findByCapabilities()` (`skill-registry.ts:110-152`) computes a score that penalizes credential-requiring and network-requiring skills even when they have the same capability coverage. Safer skills rank higher automatically.

**Why it matters:** When multiple tools could do a job, prefer the one with least privilege. This is not a binary allow/deny — it is a continuous ranking that naturally surfaces the most constrained option.

### 10.3 Entrypoint Safety: Two-Layer Path Traversal Check

Schema rejects `..` and absolute paths at parse time. `isWithinDirectory()` resolves both paths to canonical absolute paths and checks containment. The combination makes it impossible for a skill manifest to point the entrypoint outside its own directory.

**Why it matters:** OpenReply's Python sidecar accepts user-specified file paths. The same two-layer pattern (regex + resolved containment check) applied at the CLI arg parse level would eliminate a class of local path traversal issues.

### 10.4 Governance Opt-In Pattern

Sensitive capabilities (credentials, network, filesystem-write) require the **caller** to explicitly set `skillPolicy.allowCredentials = true` etc. The skill manifest declares what it *needs*; the caller decides whether to *grant* it for this specific job. Neither party can unilaterally escalate.

**Why it matters:** In OpenReply, all Python pipeline code runs with whatever permissions the sidecar process has. A governance layer that requires explicit per-call opt-in for sensitive operations (web search, file writes) would provide a minimal audit trail.

### 10.5 Artifact-Manifest Convention

Skills write their own `artifact-manifest.json` to the artifacts directory. The executor reads this to attach correct `mimeType`, `previewType`, `kind`, `description` metadata without needing to know anything about the skill's outputs ahead of time. The fallback (filename-extension inference) ensures backward compatibility for skills that don't write a manifest.

**Why it matters:** OpenReply's paper pipeline emits various output files. An `artifact-manifest.json` convention would allow the Tauri frontend to display artifacts with correct rendering (PDF viewer, JSON tree, image preview) without hardcoding file type logic in the frontend.

### 10.6 Canary Routing in Skill Registry

`SkillRegistry.findSkillRecord()` (`skill-registry.ts:191-202`): the latest version can carry a `canary` config with `percentage` and `targetVersion`. Version resolution uses `Math.random()` to route the configured percentage to the canary version. The rest get the stable latest.

**Why it matters for OpenReply:** When evolving prompt templates (e.g., the gap-analysis prompt), a canary configuration would allow A/B testing the new prompt on a percentage of research runs without a full rollout.

### 10.7 Side-Effect Tracking per Skill Context

`SkillContext.sideEffects: SideEffect[]` with typed `type: "file_write" | "db_operation" | "api_call"` and `reversible: boolean`. Even though this is not enforced (it is a pure data container), the pattern of making side effects explicit and attributable to a specific skill invocation is a useful auditing primitive.

### 10.8 No Code Execution During Discovery

The registry test (`skill-registry.test.ts:164-180`) explicitly verifies that skill code is **not executed** during `SandboxSkillRegistry` construction — even if `run.js` has side effects. Discovery is pure manifest parsing + entrypoint existence check.

**Why it matters:** This is a hard security invariant. If discovery executed code, loading a malicious skill directory would compromise the executor at startup.

---

## 11. Port to OpenReply

OpenReply's current architecture: Tauri desktop app + Python sidecar (PyInstaller) + Claude Code skills (Markdown files in `~/.claude/skills/`) + MCP tools (`src/openreply/mcp/server.py`) + research pipeline (`src/openreply/research/`).

Below is a prioritized porting plan.

### 11.1 Sandbox Skill Manifests for MCP Tools

**What:** Replace ad-hoc MCP tool definitions with `skill.json` manifests declaring inputs schema, outputs, and capabilities. Keep MCP as the execution mechanism but add the manifest layer for discoverability and governance.

**How:** Add a `skills/` directory to the OpenReply repo. Each Python research tool (OpenAlex fetcher, Semantic Scholar fetcher, paper-pipeline) gets a `skill.json` with `runtime: "python"`, declared input schema, and output artifact types. A Python `SkillRegistry` loads them at sidecar startup.

**Effort:** M (3-5 days). Input schemas already implicit in function signatures. Main work is formalizing them.

**Value:** H — enables capability-based tool selection (e.g., automatically skip OpenAlex if it is rate-limited, fall back to Semantic Scholar), and gives the Tauri frontend structured metadata for displaying tool status.

### 11.2 Artifact Manifest Convention

**What:** Have the research pipeline write an `artifact-manifest.json` to its output directory after each run.

**How:** Add a `write_artifact_manifest(artifacts: list[dict])` helper to `paper_pipeline.py`. Each artifact entry declares name, path, mimeType, previewType, description. The Tauri frontend reads this to render PDFs, JSON trees, and text previews with correct types.

**Effort:** S (1 day). Pure addition, no breaking changes.

**Value:** H — immediate improvement to frontend artifact display. Currently the frontend infers types from filenames which misses nuance.

### 11.3 Prompt Skill Registry (LLM Skills)

**What:** Port the `SkillDefinition` / `SkillRegistry` / `SkillActivator` pattern to manage OpenReply's research prompts (gap-analysis, literature-matrix, finding-summary prompts).

**How:** Define a `SkillDefinition` Pydantic model mirroring `shared/skill-contracts.ts`. Store skills in SQLite (already used). `SkillActivator.buildSkillPromptSection()` outputs a prompt fragment injected into research system prompts.

**Effort:** M (2-4 days). Pydantic model + SQLite table + activator function.

**Value:** M — prompts currently hardcoded in `paper_workflow.py` and `paper_pipeline.py`. Extracting them enables canary testing of prompt variants without code changes.

### 11.4 Canary Routing for Prompt A/B Testing

**What:** Add canary version routing to prompt skill resolution.

**How:** After implementing 11.3, add a `canary: { enabled, percentage, targetVersion }` field to the SQLite skill table. Port `findSkillRecord()`'s `Math.random()` routing.

**Effort:** S (0.5 days, depends on 11.3).

**Value:** M — allows testing new gap-analysis prompts on a fraction of research runs and measuring outcome quality before full rollout.

### 11.5 Governance Opt-In for Sensitive Operations

**What:** Require explicit per-call opt-in for network access (web search, API calls to OpenAlex/PubMed) and filesystem writes.

**How:** Add a `SkillPolicy` dataclass to the sidecar CLI. Each research pipeline call passes a policy. The MCP server enforces it before dispatching tool calls. Log denied operations.

**Effort:** L (5-8 days). Requires threading policy through the MCP tool dispatch layer and updating all call sites.

**Value:** M — primarily audit value for now. High value if OpenReply ever runs in a multi-tenant or cloud context where restricting individual research session permissions matters.

### 11.6 Security Audit Log

**What:** Port `SecurityAuditLogger` pattern — write a JSON-lines file recording all tool invocations, with job ID, skill name, outcome, duration.

**How:** Add an `audit_log.py` module. Each MCP tool call appends a structured entry. The Tauri frontend can surface this as a "research session log".

**Effort:** S (1 day).

**Value:** M — currently no structured audit trail of what external calls a research session made. Useful for debugging rate-limit failures and explaining research results to users.

### Summary Table

| Pattern | Effort | Value | Dependency |
|---|---|---|---|
| Artifact manifest convention | S | H | none |
| Sandbox skill manifests for MCP tools | M | H | none |
| Prompt skill registry (LLM skills) | M | M | none |
| Canary routing for prompt A/B | S | M | Prompt skill registry |
| Governance opt-in for sensitive ops | L | M | Skill manifests |
| Security audit log | S | M | none |

**Recommended order:** Artifact manifest convention first (immediate frontend win, zero risk), then sandbox skill manifests (enables capability-based tool selection), then prompt skill registry (enables prompt versioning and canary), then audit log, then governance opt-in.

---

## Appendix: Key File Reference

| File | Purpose |
|---|---|
| `shared/skill-contracts.ts` | All TypeScript types for System A: SkillDefinition, SkillRecord, SkillBinding, ActivatedSkill, SkillContext, SkillAuditLog, SkillExecutionMetrics, AlertResult |
| `shared/executor/skill-manifest.ts` | Zod schema + types for System B sandbox skill manifests; `validateSandboxSkillManifest()` |
| `shared/executor/contracts.ts` | `EXECUTOR_CAPABILITIES` enum (26 values), `ExecutionPlanJob`, `SecurityPolicy`, `ExecutorEvent` |
| `server/core/skill-registry.ts` | System A registry: register, resolve, dependency walking, canary routing, enable/disable |
| `server/core/skill-activator.ts` | System A activator: filter, sort, truncate, prompt interpolation, `buildSkillPromptSection()` |
| `server/core/skill-context.ts` | Per-skill context isolation factory and side-effect recorder |
| `server/core/skill-monitor.ts` | Metrics collection, aggregation, failure-rate alerting |
| `server/core/skill-seed.ts` | 8 hardcoded seed skills registered at startup |
| `services/lobster-executor/src/skill-registry.ts` | System B registry: filesystem discovery, Zod validation, capability indexing, safety-scored matching |
| `services/lobster-executor/src/skill-job.ts` | System B job resolver: parse skillRef/policy, select/validate skill, return SandboxSkillBinding |
| `services/lobster-executor/src/docker-runner.ts` | Container lifecycle: workspace prep, entrypoint override, env injection, artifact collection, audit logging |
| `services/lobster-executor/src/security-policy.ts` | Three-level security presets, Docker HostConfig builder, network mode resolver |
| `services/lobster-executor/skills/browser-research/` | Seed skill: Playwright screenshot + HTML capture |
| `services/lobster-executor/skills/document-render/` | Seed skill: Pandoc + LibreOffice Markdown → HTML/PDF |
| `services/lobster-executor/agent-image/capabilities.json` | Agent sandbox Docker image capability manifest |
