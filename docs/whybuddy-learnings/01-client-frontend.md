# WhyBuddy Client Frontend — Deep Analysis

**Date:** 2026-06-13
**Source repo:** `/Users/shantanubombatkar/Documents/GitHub/myind-gapmap-ref/WhyBuddy/`
**Downstream target:** Gap Map — Tauri 2 + vanilla-JS desktop research app

---

## 1. Frontend Feature Map

WhyBuddy is an agentic-AI orchestration platform with a multi-layered UI. Each
layer serves a different consumer need:

| View / Route | What it does |
|---|---|
| `/` (root) | Redirects: GitHub Pages → `/whybuddy`; self-hosted → `/projects` |
| `/projects` | Project cockpit home — list of projects, launch new mission |
| `/autopilot` | Autopilot blueprint page — 2D reasoning canvas + blueprint execution |
| `/projects/:id/tasks` | Office task cockpit — 3D scene + task queue + live agent detail |
| `/projects/:id/tasks/:taskId` | Task detail — artifacts, decisions, autopilot panel |
| `/whybuddy` | Immersive WhyBuddy V5 product view — full-screen canvas, IM dock, HUD |
| `/whybuddy/dev` | Engineering/debug variant of the same view (41 KB, `?im=dev`) |
| `/admin/*` | Admin layout: overview, users, projects, runs, audit, failures |
| `/login` | Auth page (no-op on GitHub Pages demo) |
| `/lineage` | Data lineage DAG view |
| `/nl-command` | Legacy NL command center |
| `/replay/*` | Session replay playback with 3D scene and timeline scrubber |
| `/specs` | Spec center — structured project specifications |
| `/debug` | Debug page for internal diagnostics |

The UI splits into three "shells":
1. **Office shell** — 3D scene (`Scene3D`) + task queue + chat + agent inspector
2. **Autopilot shell** — 2D infinite reasoning canvas (`ReasoningFlowSurface`) + blueprint log stream
3. **WhyBuddy product shell** — fullscreen immersive canvas, floating IM dock, minimal chrome

---

## 2. Per Key Module / Directory

### `pages/`

**Path:** `client/src/pages/`

**Key files and sub-dirs:**
- `Home.tsx` (150 KB) — the primary office shell; assembles Scene3D + WorkflowPanel + ChatPanel + OfficeTaskCockpit + UEOverlayChrome
- `WhyBuddy.tsx` (21 KB) — immersive product view with `ReasoningFlowSurface`, floating `ComposerDock`, `WhyBuddyTopHud`, `ArchitectureProcessPanel`, typewriter text animations
- `WhyBuddyDev.tsx` (41 KB) — engineering variant of the WhyBuddy view with more instrumentation
- `autopilot/AutopilotRoutePage.tsx` — routes to blueprint autopilot; drives blueprint realtime store subscription
- `tasks/` — `TasksPage` and `TaskDetailPage` with `TaskAutopilotPanel` (112 KB), `DecisionPanel` (47 KB), `TaskDetailView` (46 KB)
- `lineage/LineagePage.tsx` — wraps `LineageDAGView` + `LineageWorkspaceContent`
- `admin/AdminLayout.tsx` — thin layout wrapping admin sub-pages
- `auth/AuthPage.tsx` — login form; bypassed on GitHub Pages
- `specs/SpecCenterPage.tsx` — project spec editor
- `whybuddy/` sub-dir — `useWhyBuddySession`, `TurnRouteTimeline`, `ComposerDock`, `ArchitectureProcessPanel`, `WhyBuddyTopHud`, `WhyBuddyStatusBar`

**State management:** All pages pull from Zustand stores (`useTasksStore`, `useProjectStore`, `useWorkflowStore`, `useAppStore`). No prop drilling of server state — stores own it all.

**Notable interactions:**
- Home.tsx subscribes to the Socket.IO connection via `useWorkflowStore` and `useTasksStore`
- WhyBuddy.tsx drives the V5 in-memory runtime via `useWhyBuddySession` hook
- TaskDetailPage mounts the `AutopilotEvidenceRecorder` (22 KB) + `AutopilotTakeoverControlPanel`

---

### `components/`

**Path:** `client/src/components/`

This is the largest directory (~70 MB of source). Key sub-directories:

**`components/three/`** — all R3F components (see §3 for 3D detail)
- `OfficeRoom.tsx` (40 KB) — room layout with Kenney furniture, department pods, `<Html>` labels
- `BlueprintRuntimeAgents.tsx` (54 KB) — live role visualization in blueprint mode
- `MissionFirstAgents.tsx` (45 KB) — mission-driven agent avatars
- `MissionWallTaskPanel.tsx` (21 KB) — wall-mounted task panel (in-3D-space R3F `<Html>`)
- `SceneStageFlow.tsx` — stage transitions
- `SandboxMonitor.tsx` (14 KB) — terminal/browser preview in 3D

**`components/autopilot/`**
- `ReasoningFlowSurface.tsx` (48 KB) — 2D infinite canvas built on HTML cards + SVG Bezier edges + dagre LR layout. Supports pan/zoom (CSS transform), minimap, telemetry overlay, node hover path highlighting, and console log overlay. Central to the WhyBuddy product view.
- `AgentReasoningTimeline.tsx` (12 KB) — sequential agent reasoning steps with status badges

**`components/knowledge/`**
- `KnowledgeGraphPanel.tsx` (10 KB) — d3-force SVG graph: click to select, double-click to expand neighbors, shift-drag box select, zoom/pan, search-term highlighting with auto-zoom to first match. **Entity types mapped to colors** (CodeModule = #4A90D9, Bug = #E74C3C, Agent = #1ABC9C, etc.). Node radius scales with edge count.
- `KnowledgeNodeDetail.tsx` (6 KB) — detail sidebar for a selected node
- `KnowledgeFilters.tsx` (6 KB) — filter sidebar for entity type / relation type
- `KnowledgeReviewPanel.tsx` (4 KB) — review/approval queue for knowledge graph entries

**`components/lineage/`**
- `LineageDAGView.tsx` (11 KB) — topological-sort DAG layout using a pure JS Kahn's algorithm, rendered as SVG with HTML overlay labels, Bezier connectors. No third-party graph lib.
- `LineageTimeline.tsx` (7 KB) — horizontal timeline of lineage events
- `LineageHeatmap.tsx` (5 KB) — contribution/activity heatmap

**`components/tasks/`**
- `TaskAutopilotPanel.tsx` (112 KB) — largest component; full autopilot cockpit: route planning, evidence recording, destination goal card, drive-state timeline, fleet live view, takeover controls
- `DecisionPanel.tsx` (47 KB) — decision history with approval/rejection UI
- `TaskDetailView.tsx` (46 KB) — artifacts, messages, stage info, operator actions
- `TasksQueueRail.tsx` (15 KB) — collapsible left rail showing queued tasks
- `OperatorActionBar.tsx` (18 KB) — approval/intervention controls with lock states
- `AutopilotFleetLiveView.tsx` (10 KB) — role cards with live status badges

**`components/sandbox/`**
- `TerminalPreview.tsx` (12 KB) — xterm.js terminal; shows live log lines with `SCROLLBACK = 500`, supports wall/embedded/fullscreen variants, i18n-aware labels. Core integration: `useEffect` mounts an `xterm.Terminal`, writes lines incrementally via a `writtenCountRef` watermark pattern (writes only new lines on each update).
- `ScreenshotPreview.tsx` (14 KB) — displays live browser screenshots from sandbox executor

**`components/office/`**
- `OfficeTaskCockpit.tsx` (66 KB) — primary desktop shell combining task detail + 3D scene passthrough + live panels
- `OfficeWorkflowContextPanels.tsx` (73 KB) — context panel system with tabbed evidence, artifacts, decisions
- `OfficeWorkflowLaunchPanel.tsx` (24 KB) — launch controls for the office

**`components/launch/`**
- `UnifiedLaunchComposer.tsx` (30 KB) — multi-mode launch panel: goal text input, attachment section, route planning overlay, operator action rail
- `RoutePlanningOverlay.tsx` (23 KB) — route plan visualization with stage cards and confirmation

**`components/nl-command/`**
- `ClarificationPanel.tsx` (12 KB) — structured clarification Q&A
- `TaskHubCommandPanel.tsx` (9 KB) — command input with history
- `DependencyGraph.tsx` (3 KB) — small dependency graph with recharts-like layout
- `GanttChart.tsx` (3 KB) — timeline Gantt for task scheduling
- `RiskHeatMap.tsx` (3 KB) — 2D heat map visualization

**`components/ue-overlay/`**
- `UEOverlayChrome.tsx` — transparent overlay wrapper designed to sit atop a UE5 video stream or WebRTC frame. Manages HUD element positioning via `useHUDPositionSync`, pointer passthrough zones (so mouse events fall through to the video layer), responsive sidebar slot (248 px desktop / 64 px narrow). **This is the UE5 client bridge layer.**
- `OverlayContainer.tsx` (6 KB) — handles the video element reference, HUD element position injection, overlay tone dimming
- `hud-sync.ts` (5 KB) — position-sync hook that listens for `HUD_POSITION_EVENT` custom events and applies CSS transforms to named HUD slots

**`components/ui/`** — shadcn/ui components (new-york style, Tailwind v4 CSS variables): accordion, alert-dialog, avatar, badge, button, calendar, card, chart (recharts wrapper), dialog, drawer, dropdown-menu, sidebar (21 KB), tabs, tooltip, and more. Full standard shadcn set.

**`components/WorkflowPanel.tsx`** (140 KB) — monolithic panel; shows active workflow, agent cards, heartbeat reports, memory entries, stage progression, task list, role performance radar. Houses the "frontend mode" vs "advanced server mode" toggle.

**`components/ChatPanel.tsx`** (19 KB) — chat UI with TTS/STT toggle, runtime mode indicator, browser-direct LLM calling support, and keyword-based canned response fallback in frontend mode.

**`components/ConfigPanel.tsx`** (26 KB) — BYOK LLM configuration: API key input (show/hide toggle), base URL, model ID, wire API selector (responses vs chat_completions), timeout, reasoning effort, proxy URL, and export/import of runtime bundle.

**`components/CostDashboard.tsx`** (17 KB) — token consumption + cost tracking with recharts PieChart (per-agent share) and LineChart (trend). Budget alerts, degradation controls.

**`components/TelemetryDashboard.tsx`** (16 KB) — live telemetry: event counts, latencies, error rates.

**`components/AuditPanel.tsx`** (14 KB) — audit log viewer with chain verification.

---

### `contexts/`

**Path:** `client/src/contexts/`

Minimal — only two contexts:
- `ThemeContext.tsx` — wraps `ThemeProvider` from `next-themes`; provides light/dark mode toggle via `data-theme` attribute on `<html>`
- `MirofishThemeContext.tsx` — scoped theme for the "MiroFish" alternate design system (sets `data-theme="mirofish"` on a container boundary)

Most "context" in WhyBuddy is handled by Zustand stores in `lib/`, not React contexts. Contexts are only used for themes.

---

### `lib/`

**Path:** `client/src/lib/`

This is the core business logic layer. ~100+ files; the most critical ones:

**State stores (Zustand)**

| Store | Responsibilities |
|---|---|
| `store.ts` (12 KB) | Global: locale, AI config, runtime mode, chat messages, PDF state, voice state, scene ready/loading |
| `workflow-store.ts` (39 KB) | WebSocket connection (Socket.IO), workflow list, agents, heartbeats, memory, AIGC monitoring |
| `tasks-store.ts` (182 KB) | Mission/task state, Socket.IO subscription, planet data, autopilot summary, operator actions, decisions, artifacts |
| `project-store.ts` (70 KB) | Projects, specs, route plans, project messages; persisted to `localStorage` |
| `blueprint-realtime-store.ts` (69 KB) | Blueprint generation events via Socket.IO: role phases, capability statuses, agent reasoning, log entries (capped at 200); seeds history from REST on mount |
| `brainstorm-graph-store.ts` (31 KB) | Brainstorm session nodes/edges (capped at 500 nodes, FIFO drop), convergence score, vote outcomes |
| `nl-command-store.ts` (40 KB) | NL command lifecycle: submit → analysis → clarification → plan → approval → execution; Socket.IO subscription |
| `knowledge-store.ts` (5 KB) | Knowledge graph entities + relations via REST |
| `lineage-store.ts` (8 KB) | Data lineage nodes + edges, search, filters; Socket.IO for live updates |
| `audit-store.ts` (7 KB) | Audit chain entries; Socket.IO |
| `cost-store.ts` (4 KB) | Real-time cost tracking via Socket.IO |
| `reputation-store.ts` (3 KB) | Agent reputation scores |
| `sandbox-store.ts` (5 KB) | Executor log lines, `LogLine` type, screenshot state |
| `autonomy-store.ts` (2 KB) | Autonomy level + assessment results |
| `role-store.ts` (2 KB) | Agent role assignments |
| `demo-store.ts` (2 KB) | Demo mode fixtures |
| `admin-store.ts` (7 KB) | Admin: user management, project overrides, failures |

**LLM config layer** (`ai-config.ts`, 5 KB)

`AIConfig` interface covers: `mode` (server_proxy | browser_direct), `apiKey`, `baseUrl`, `model`, `modelReasoningEffort`, `maxContext`, `wireApi` (responses | chat_completions), `timeoutMs`, `stream`, `chatThinkingType`, `proxyUrl`, `routerModel`. Persisted to `localStorage` under `whybuddy.ai-settings.v1`. Factory functions: `createServerAIConfig`, `createBrowserAIConfig`, `loadPersistedAISettings`, `savePersistedAISettings`.

**Direct browser LLM call** (`browser-llm.ts`, 6 KB)

`callBrowserLLM(messages, config, options)` — supports both `/responses` (OpenAI Responses API) and `/chat/completions`. Handles timeout via `AbortController`, normalizes 401/429/5xx errors to user-friendly messages, records telemetry via `recordBrowserLLMCall`.

**Browser runtime storage** (`browser-runtime-storage.ts`, 19 KB)

IndexedDB (named `whybuddy-browser-runtime`, v2) with 12 object stores: meta, aiConfig, agents, souls, heartbeats, workflows, workflowDetails, agentRecentMemory, agentMemorySearch, heartbeatStatuses, heartbeatReports, snapshots. Used for offline-capable local runtime caching.

**Voice engines** (`tts-engine.ts` 11 KB, `stt-engine.ts` 12 KB)

`TTSEngine` / `STTEngine` interfaces with two implementations each: browser (`window.speechSynthesis` / `SpeechRecognition`) and server-side (`POST /api/voice/tts` → `AudioContext` playback / `MediaRecorder` → `POST /api/voice/stt`). Factory picks best available engine.

**Autopilot model** (`autopilot-frontend-model.ts`, 17 KB; `use-autopilot-cockpit-model.ts`, 14 KB)

Strongly-typed three-layer frontend model: draft → planning → projection. `FrontendAutopilotDraftState`, `FrontendAutopilotPlanningStatus`, `FrontendAutopilotProjectionStatus`, `FrontendAutopilotRouteImpactView`. Decoupled from server state shape.

**WhyBuddy V5 runtime** (`whybuddy-runtime.ts`, 168 KB; `whybuddy-runtime.argument-graph.test.ts` and 15 other test files)

In-memory control plane: `createInitialSessionState(goalText)`, `orchestrateReasoningTurn(state, intervention?)`, `commitArtifact(state, artifact, runId)`, `invalidateForIntervention(state, intervention)`. Capability pool scheduling, coverage gates, trust layer with provenance ledger, session replay.

**Session export/import** (`session-export.ts`, 4 KB; `browser-runtime-sync.ts`, 5 KB)

`exportSession()` / `importSession()` to JSON bundles. `syncBrowserRuntimeFromServer()` pulls server state into IndexedDB. `buildBrowserRuntimeExport()` / `restoreBrowserRuntimeFromBundle()`.

**Navigation events** (`navigation-events.ts`)

Custom DOM event bus: `dispatchOfficeRuntimeEvidenceEvent(tab)` dispatches `CustomEvent` on `window`. Used to decouple cross-panel navigation without prop drilling.

**Scene/3D support** (`scene-theme.ts`, `scene-stage-flow.ts`, `scene-agent-detail.ts`, `scene-command-client.ts`)

Theme tokens for 3D room, stage-to-zone mapping, agent detail derivation from mission events, WebSocket commands to move camera/scene.

---

### `runtime/`

**Path:** `client/src/runtime/`

- `browser-runtime.ts` (20 KB) — in-browser implementation of the full workflow runtime. Imports `RuntimeAgent`, `WorkflowKernel`, `WORKFLOW_STAGE_SET`, `validateHierarchy`, `validateStageRoute` from `@shared`. Implements `BrowserWorkflowRepository` (in-memory), runs the full CEO→Manager→Worker hierarchy. Integrates `SnapshotScheduler` (periodic save to IndexedDB) and `RecoveryDetector`. Used in "frontend mode" when no server connection exists.
- `demo-data/` — static fixture data for demo mode
- `demo-playback/` — playback engine for pre-recorded demo sessions
- `browser-runtime-snapshot.test.ts` (11 KB) — tests for snapshot lifecycle

---

### `workers/`

**Path:** `client/src/workers/`

- `snapshot-worker.ts` (2 KB) — Web Worker for SHA-256 checksum computation + `SnapshotRecord` serialization off the main thread. Protocol: `{ type: "serialize", payload, missionId, missionTitle, missionProgress, missionStatus }` → `{ type: "serialized", record }`. Uses `crypto.subtle.digest("SHA-256")`. Called by `SnapshotScheduler` to avoid blocking 3D rendering.

---

### `hooks/`

**Path:** `client/src/hooks/`

| Hook | Purpose |
|---|---|
| `useViewportTier.ts` (4 KB) | Returns `{ tier: "mobile" | "tablet" | "desktop", isMobile, isTablet, width }`. Uses `useSyncExternalStore` with a singleton resize listener + debounce (180 ms settle). Also exports `useViewportWidth`, `useViewportResizeState`. |
| `useContainerWidth.ts` | `ResizeObserver`-based container width tracking |
| `useRecoveryDetection.ts` (4 KB) | Detects stale/crashed runtime state; triggers `RecoveryDialog` |
| `useDemoMode.ts` (4 KB) | Demo mode: injects fixture data, simulates agent activity |
| `useIdleActivation.ts` | Idle-after-N-seconds trigger for scene activation animations |
| `useWorkflowRuntimeBootstrap.ts` | Bootstraps browser runtime or connects to server runtime on mount |
| `useFleetRealtimeCards.ts` | Derives fleet role cards from realtime store state |
| `useMirofishTheme.ts` | Returns MiroFish theme state |
| `useMirofishMotionProps.ts` | Animation props under MiroFish theme |
| `useComposition.ts` | IME composition state for CJK input |
| `usePersistFn.ts` | Stable function ref that reads latest closure |

---

### `i18n/`

**Path:** `client/src/i18n/`

- `index.ts` — `useI18n()` hook: reads `locale` from `useAppStore`, returns `{ locale, copy, setLocale, toggleLocale }`. `copy` is memoized via `useMemo(() => getMessages(locale), [locale])`.
- `messages.ts` (74 KB) — bilingual string dictionary: `zh-CN` and `en-US`. Covers: common UI, app metadata, loading, home, PDF, toolbar, config, chat (with preset canned responses), workflow, agents, stages, memory, tasks, autopilot, scenes, NL command, knowledge, lineage, audit, replay, cost, sandbox, permissions, RAG, reputation. Locale persisted to `localStorage` under `LOCALE_STORAGE_KEY`.

**Translation key structure:** Nested object tree with functional leaf strings. Some leaves are functions: `description: (progress: number) => \`小宠物们正在搬家具 ${progress}%\`` (`messages.ts:31`).

---

### `styles/`

**Path:** `client/src/styles/`

- `mirofish-layer.css` — scoped CSS layer (`@layer mirofish`) activated only within `[data-theme="mirofish"]`. Targets named surface classes (`.glass-panel`, `.studio-surface`, `.workspace-panel`) and `data-mf-*` attribute selectors. No wildcard selectors. Defines button, card, input, toggle, badge, skeleton overrides. Clean isolation pattern.
- `mirofish-tokens.css` — CSS custom property tokens: `--mf-font-body`, `--mf-font-title`, `--mf-font-mono`, `--mf-color-bg`, `--mf-color-fg`, `--mf-border`, `--mf-radius`, `--mf-shadow`, etc.
- `index.css` (26 KB) — Tailwind v4 base, shadcn CSS variables, custom animation keyframes

---

### `dev-harness/`

**Path:** `client/src/dev-harness/`

- `ReasoningFlow2DHarness.tsx` — standalone harness rendering `ReasoningFlowSurface` at 100vw/100vh with `REASONING_GRAPH_FIXTURE`. `?debug=1` shows press-F reminder overlay. Used to QA the 2D canvas independently.
- `WallFixtureHarness.tsx` — similar harness for the 3D wall texture visualization
- `reasoning-graph-fixture.ts` (5 KB) — static `BrainstormReasoningGraph` fixture with nodes and edges
- `wall-fixture-main.tsx` — separate Vite entry (`wall-fixture.html`) for the wall harness

Harnesses are not bundled in production. They are separate HTML entry points for visual QA.

---

## 3. The 3D / Game Layer

**Libraries:** `@react-three/fiber` (R3F) + `@react-three/drei` + `three`

**Assets:**
- `client/public/kenney_cube-pets_1.0/` — 15 GLB animal models (bunny, cat, caterpillar, chick, cow, dog, elephant, fish, giraffe, hog, lion, monkey, parrot, pig, tiger)
- `client/public/kenney_furniture-kit/` — 40+ GLTF furniture pieces (desk, chairs, computer setup, bookshelves, rugs, plants, lamps, wall panels)
- All loaded via `localAsset()` URL builder that handles Vite `BASE_URL` correctly for GitHub Pages (`lib/assets.ts:6-14`)

**Scene architecture:**

```
<Canvas> (ACESFilmicToneMapping, Suspense)
  <CameraController />          — animated camera with sidebar-width compensation
  <ContactShadows />            — drei ground shadow
  <OfficeRoom />                — furniture layout, department pods, zone labels
  <PetWorkers />                — mode-switch shell:
      mode="blueprint"  → <BlueprintRuntimeAgents />
      mode="mission-first" → <MissionFirstAgents />
  <MissionIsland />             — mission progress island (hidden in blueprint mode)
  <SandboxMonitor />            — terminal/screenshot previews in 3D
  <BlueprintWallTexture />      — canvas-texture wall showing reasoning graph
  <SceneStageFlow />            — stage transition animations
  <WaitingDecisionBubble />     — animated bubble when awaiting operator decision
  <CrossFrameworkParticles />   — particle effects between framework zones
  <CrossPodParticles />         — particles between agent pods
```

**Key patterns:**
- `useGLTF` (drei) for GLB/GLTF loading with preload
- `<Html>` (drei) for HTML overlays in 3D space (department labels, task panels)
- `rethemeFurnitureMaterial` applies dynamic THREE.js material color patches to match scene theme
- `BlueprintWallTexture` renders a dagre-layout reasoning graph to an off-screen HTML5 Canvas, then uses it as a `THREE.CanvasTexture` on a wall plane. This avoids R3F rendering complexity for graph nodes.
- `CameraController` reads `sidebarWidth` prop and applies a frustum shift to keep scene centered when sidebar is open
- `SceneStageFlow` drives animated stage transitions: `SCENE_FLOW_ZONES` mapped from stage names to 3D positions
- `camera-compensation.ts` — pure math utilities for camera offset based on sidebar width and viewport

**UE5 bridge (`components/ue-overlay/`):**

The UE5 integration is a client-side overlay system, not a true Unreal plugin:
- `OverlayContainer` accepts a `videoElement` prop — expected to be a `<video>` element receiving a UE5 Pixel Streaming or WebRTC feed
- `UEOverlayChrome` layers React panels on top with `position: absolute, inset-0`
- `PointerPassthroughZone` and `PointerAutoWrapper` manage `pointer-events` so mouse interactions fall through to the underlying video
- `hud-sync.ts` listens for `HUD_POSITION_EVENT` custom DOM events — UE5 would dispatch these to reposition HUD elements based on 3D world coordinates projected to screen
- The overlay system is operational even without a UE5 feed (used over the R3F scene in some layouts)

---

## 4. Runtime & Workers — Detail

### `client/src/runtime/browser-runtime.ts` (20 KB)

Full in-browser workflow engine for "frontend mode" (no server required):

- `BrowserWorkflowRepository` — in-memory store for workflows, messages, tasks, evolution logs
- `BrowserRuntime` class implements `WorkflowRuntime` from `@shared/workflow-runtime`
- Uses `RuntimeAgent` + `WorkflowKernel` from shared (same code the server uses)
- Validates message routing against `WORKFLOW_STAGE_SET` and `validateHierarchy` / `validateStageRoute`
- Integrates `SnapshotScheduler` for periodic IndexedDB saves
- Integrates `RecoveryDetector` to identify incomplete previous runs
- `onEvent` callback surfaces runtime events to Zustand store via `runtimeEventBus`

This means the same agent hierarchy logic runs in the browser as on the server — a clean shared-kernel architecture.

### `client/src/lib/whybuddy-runtime.ts` (168 KB)

V5 Thin Runtime — the WhyBuddy-specific control plane:

- `createInitialSessionState(goalText)` — initializes `V5SessionState` with empty capability runs, artifacts, gates, reasoning graph
- `orchestrateReasoningTurn(state, intervention?)` — schedules next capability batch, picks roles, runs trust gates, commits artifacts
- `commitArtifact(state, artifact, runId)` — runs `evaluateGroundingForCommit`, routes through trust layer (gate → provenance → ledger)
- `invalidateForIntervention(state, intervention)` — marks affected artifacts as stale, triggers reconvergence
- Reconverge loop: monotonic stale-set expansion, bounded by `fullpath-budget` constraints
- Extensive test suite: 15+ test files covering argument graphs, artifact health, coverage gates, delivery, invariants, projection, readiness, roles, status, structure, visual, goal-conclusion gate, ground gate, payload trust gate, reconverge loop, retry capability, stale-set monotonic

### `client/src/workers/snapshot-worker.ts` (2 KB)

Simple but important pattern: heavy JSON serialization + SHA-256 hashing moved off main thread to a Web Worker. Message protocol keeps the worker stateless (serialize request → serialized response). Prevents 3D frame drops during checkpoint saves.

### `client/src/lib/snapshot-scheduler.ts` (2 KB) + `snapshot-serializer.ts` (3 KB)

`createSnapshotScheduler` — periodic save logic with configurable interval. `SnapshotSerializer` — prepares `SnapshotPayload` from runtime state, dispatches to worker, stores result via `browser-runtime-storage`.

---

## 5. Notable Patterns / Techniques Worth Stealing

### A. Dual-mode LLM architecture (server proxy ↔ browser direct)

`lib/ai-config.ts:15-30` defines `AIConfig` with `mode: "server_proxy" | "browser_direct"` and `wireApi: "responses" | "chat_completions"`. The user can toggle at runtime; settings persist to `localStorage`. `callBrowserLLM` in `lib/browser-llm.ts:93-223` handles both OpenAI Responses API and standard `chat/completions` with timeout, error normalization, and telemetry.

**Directly portable to Gap Map's BYOK LLM system.** Pure fetch, no React dependencies.

### B. xterm.js incremental write pattern

`components/sandbox/TerminalPreview.tsx` uses a `writtenCountRef = useRef(0)` watermark. On each `logLines` prop update, it only writes `logLines.slice(writtenCountRef.current)` to the terminal and advances the counter. Zero re-render flicker even with high-frequency log output.

```
// pseudocode (TerminalPreview.tsx ~line 120)
const newLines = logLines.slice(writtenCountRef.current);
newLines.forEach(line => termRef.current?.writeln(formatLogLine(line)));
writtenCountRef.current = logLines.length;
```

### C. d3-force knowledge graph (KnowledgeGraphPanel.tsx)

Full d3-force simulation with: arrow markers, node-size-by-degree, search highlight + auto-zoom to first match, shift-drag box selection via `d3.brush`, zoom/pan, drag-to-pin, simulation teardown on unmount (`simulation.stop()`). All in ~350 lines of self-contained SVG. No graph lib dependency.

### D. dagre LR layout for reasoning graph (ReasoningFlowSurface.tsx)

Uses `dagre` for auto-layout of the reasoning flow. Renders nodes as HTML `<div>` cards (for text clarity), edges as SVG Bezier curves with relationship labels. Pan/zoom via CSS `transform: scale() translate()` on a container `<div>` — not canvas. Minimap is a scaled-down copy. Hover highlights ancestor+descendant paths by toggling `opacity` on all edges.

### E. Scoped alternate theme system (MiroFish)

`[data-theme="mirofish"]` CSS scope in `@layer mirofish` with named surface classes. No Tailwind conflicts. Tokens in separate `mirofish-tokens.css`. Context boundary in `MirofishThemeContext`. Clean pattern for shipping a second design system without class naming collisions.

### F. Bilingual i18n with functional string leaves

`i18n/messages.ts` uses nested object with string and function leaves. Functions cover parameterized strings: `description: (progress: number) => \`...\``. `useI18n()` hook returns memoized `copy` object. Toggle between two locales at runtime without page reload.

**Portable to Gap Map:** The `getMessages(locale)` function and `useI18n` pattern translates cleanly to a vanilla-JS module. No React dependency in `messages.ts` itself.

### G. `useSyncExternalStore` viewport tier

`useViewportTier.ts` implements a singleton resize listener with `useSyncExternalStore`. The singleton means all components share one `ResizeObserver`-equivalent listener. 180 ms debounce via `resizeSettleTimer`. Returns a stable snapshot object — no unnecessary re-renders when width changes but tier doesn't.

### H. Web Worker SHA-256 off main thread

`workers/snapshot-worker.ts` — pattern: serialize large JSON + compute hash in worker, keep 3D thread smooth. Simple `postMessage` protocol. Easily replicable for any expensive serialization in Gap Map.

### I. UE5 overlay via pointer-events layering

`components/ue-overlay/` — React UI sits on top of a video element via `position: absolute` + `pointer-events: none` on the overlay container, with selective `pointer-events: auto` on interactive children. `PointerPassthroughZone` tracks rectangles where clicks should reach the underlying video. `HUD_POSITION_EVENT` custom DOM events drive position sync. This pattern works for any situation where you want React UI over a non-React canvas or video.

### J. Custom DOM event bus for cross-panel navigation

`lib/navigation-events.ts:915` — `dispatchOfficeRuntimeEvidenceEvent(tab)` dispatches `CustomEvent('office-runtime-evidence-tab', { detail: { tab } })` on `window`. Listeners in other panels subscribe with `addEventListener`. Decouples navigation without prop drilling or a shared store. **Directly portable to vanilla JS.**

### K. Bounded queue pattern in realtime stores

`blueprint-realtime-store.ts`: `agentProgress ≤ 50`, `logEntries ≤ 200`. `brainstorm-graph-store.ts`: `MAX_BRAINSTORM_NODES = 500` with FIFO drop. Prevents memory growth in long-running sessions without complex GC logic.

### L. Vite `vitePluginManusDebugCollector`

`vite.config.ts:77-149` — custom Vite plugin that intercepts `POST /__manus__/logs`, writes browser `console.*`, network requests, and session replay events directly to `.manus-logs/*.log` files on the dev server. Log files are auto-trimmed at 1 MB, keeping newest 60%. Injected as a `<script>` tag via `transformIndexHtml`. **Useful pattern for dev-time observability in any Vite app.**

---

## 6. Port to Gap Map — Concrete Items

Gap Map is Tauri 2 + vanilla JS (no React). React-specific patterns (hooks, JSX, Zustand) need vanilla translation. Items tagged React→Vanilla translation cost (Easy = drop-in module, Medium = rewrite without hooks, Hard = full reimplementation without framework).

---

### 6.1 BYOK LLM Config Panel
**Description:** UI for API key, base URL, model ID, wire API selector, timeout, reasoning effort, proxy URL. Persist to `localStorage`. Toggle server-proxy ↔ browser-direct at runtime. Show/hide API key. Import/export config bundle.
**Source:** `lib/ai-config.ts`, `lib/browser-llm.ts`, `components/ConfigPanel.tsx`
**Effort:** S
**Value:** H
**React→Vanilla:** Easy — `ai-config.ts` and `browser-llm.ts` have zero React dependencies. Copy them verbatim. Build a vanilla form that reads/writes `localStorage` under a versioned key (`gap-map.ai-settings.v1`). Gap Map's existing BYOK is basic; this adds wire API switching, reasoning effort, router model separation, and proxy URL which are all valuable for multi-provider support.

---

### 6.2 d3-force Knowledge Graph Panel
**Description:** Interactive SVG force-directed graph for Gap Map's knowledge graph display. Node color by type, radius by degree, search highlight + auto-zoom, shift-drag box select, zoom/pan, click to inspect node, double-click to expand neighbors.
**Source:** `components/knowledge/KnowledgeGraphPanel.tsx` (350 lines, standalone)
**Effort:** S
**Value:** H
**React→Vanilla:** Easy — the entire component is a `useEffect` that runs d3 on an `<svg ref>`. Strip React: replace `useRef` with `document.querySelector`, replace `useEffect` with a `renderKnowledgeGraph(svgEl, nodes, edges, searchTerm)` function. No React-specific logic inside the d3 imperative block. Gap Map already has a graph store; this gives it a proper interactive visualization.

---

### 6.3 dagre Reasoning Flow Canvas
**Description:** Infinite 2D canvas showing reasoning/gap nodes as HTML cards connected by SVG Bezier edges, with LR dagre layout. Pan/zoom via CSS transform, minimap, hover path highlighting. For Gap Map: show the research gap graph or paper citation network.
**Source:** `components/autopilot/ReasoningFlowSurface.tsx` (48 KB)
**Effort:** L
**Value:** H
**React→Vanilla:** Hard — the component is 48 KB of React with many `useState`/`useEffect`/`useCallback` hooks. Extracting the core: dagre layout calculation (pure JS), SVG edge rendering (pure JS), and CSS-transform pan/zoom (pure JS) is feasible but requires full reimplementation of the interactive shell. Recommend extracting just the dagre layout + SVG rendering utility and building a simpler vanilla shell around it. Estimated 3-4 days of focused work.

---

### 6.4 Streaming Agent Live-Log Panel
**Description:** A scrolling log panel that streams agent execution events in real time. Uses bounded queue (≤200 entries), incremental append, status color coding (running/completed/error). Equivalent to Gap Map's research pipeline progress display.
**Source:** `components/tasks/BlueprintLogStream.tsx` (4 KB), `blueprint-realtime-store.ts` (bounded queue pattern)
**Effort:** S
**Value:** H
**React→Vanilla:** Easy — the bounded queue pattern (`logEntries.slice(-200)`) and status badge coloring are pure logic. The log panel itself is a scrolling `<div>` with appended rows. Gap Map already has a log display area; add the 200-entry FIFO cap and the incremental-write watermark from `TerminalPreview` to prevent full re-render on each event.

---

### 6.5 xterm.js Terminal Panel
**Description:** Embedded xterm.js terminal for showing raw sidecar output. Incremental write pattern (watermark ref) to avoid full re-render on each new log line. Wall/embedded/fullscreen variants.
**Source:** `components/sandbox/TerminalPreview.tsx` (12 KB)
**Effort:** M
**Value:** M
**React→Vanilla:** Medium — xterm.js itself is framework-agnostic. The watermark write pattern is pure JS. Strip the React wrapper, initialize `Terminal` on mount, expose `appendLines(lines)` and `clear()` methods. Gap Map's Python sidecar outputs logs that currently go to a simple `<pre>` — replacing with xterm gives real ANSI color support and scroll buffer.

---

### 6.6 Bilingual i18n Module
**Description:** Two-locale string dictionary with functional string leaves (parameterized templates). Runtime toggle without page reload. Persisted locale preference.
**Source:** `i18n/messages.ts`, `i18n/index.ts`
**Effort:** S
**Value:** M
**React→Vanilla:** Easy — `messages.ts` has no React dependency. Copy the structure, replace `useI18n()` hook with a simple module-level `getI18n()` function that returns `{ copy: getMessages(locale), locale, setLocale }` and dispatches a `'locale-changed'` custom event for components to subscribe. Gap Map currently has no i18n.

---

### 6.7 LLM Cost Tracking Dashboard
**Description:** Per-session token count + cost tracking. PieChart by agent, LineChart trend, budget alert banner, budget input control. Useful for Gap Map's BYOK users to see spending.
**Source:** `components/CostDashboard.tsx` (17 KB), `lib/cost-store.ts`, `lib/browser-telemetry-store.ts`
**Effort:** M
**Value:** M
**React→Vanilla:** Medium — recharts is React-specific. Use Chart.js or a plain `<canvas>` doughnut chart instead. The cost tracking logic (`recordBrowserLLMCall`) is pure JS. The `browser-telemetry-store.ts` is also easily portable.

---

### 6.8 Multi-panel Resizable Layout
**Description:** Three-column layout: left rail (queue/nav), center (main content), right (detail panel). Collapse/expand per panel. Mobile responsive with tab bar fallback.
**Source:** `components/tasks/TasksQueueRail.tsx`, `components/ui/resizable.tsx` (wraps `react-resizable-panels`), `components/MobileTabBar.tsx`, `hooks/useViewportTier.ts`
**Effort:** M
**Value:** M
**React→Vanilla:** Medium — the resize logic uses `react-resizable-panels`. In vanilla JS, use CSS `grid-template-columns` with a drag handle that modifies `--left-width` / `--right-width` CSS variables. The viewport tier detection (`getViewportTier(width)`) is pure JS and portable as-is.

---

### 6.9 Session Export / Import
**Description:** Export full session state to a JSON bundle. Import to restore. Useful for Gap Map research sessions: export a topic's collected papers, personas, gap map, LLM config to a single file.
**Source:** `lib/session-export.ts` (4 KB), `lib/browser-runtime-sync.ts` (5 KB)
**Effort:** S
**Value:** M
**React→Vanilla:** Easy — both files are plain TypeScript with no React. `exportSession()` / `importSession()` serialize and deserialize IndexedDB + localStorage state to JSON. Gap Map can adapt this for SQLite + localStorage state export.

---

### 6.10 Persona / Agent Role Card System
**Description:** Role cards showing status (idle / thinking / acting / done), assigned persona, current task summary, confidence indicator. Used in Gap Map's persona system to show which persona is currently running and what it found.
**Source:** `components/tasks/FleetCard.tsx` (4 KB), `components/tasks/AutopilotFleetLiveView.tsx` (10 KB), `lib/role-store.ts`
**Effort:** M
**Value:** H
**React→Vanilla:** Medium — cards are straightforward HTML/CSS. The live status update logic (`FleetCard` receives role phase as prop) maps cleanly to vanilla `setAttribute('data-phase', phase)` on a card element with CSS-driven state styling.

---

### 6.11 Vite Debug Collector Plugin
**Description:** Vite plugin that captures browser console logs, network requests, and session replay events during development and writes them to `.manus-logs/` files. Auto-trimmed at 1 MB.
**Source:** `vite.config.ts:77-149`
**Effort:** S
**Value:** L (dev-only)
**React→Vanilla:** Easy — the plugin is pure Node.js Vite plugin code. Zero UI framework dependency. Drop directly into Gap Map's `vite.config.ts`.

---

### 6.12 Custom DOM Event Bus
**Description:** Decouple cross-panel navigation with `CustomEvent` dispatch on `window`. No shared store needed. E.g., a paper card in the graph panel clicking "show in detail panel" dispatches `CustomEvent('gap-map:show-paper', { detail: { paperId } })`.
**Source:** `lib/navigation-events.ts`
**Effort:** S
**Value:** M
**React→Vanilla:** Easy — this is already vanilla-JS-compatible. The pattern is to define typed event names as constants and use `window.dispatchEvent` / `window.addEventListener`. Gap Map's panel communication currently relies on direct function calls; moving to events enables future panel reordering.

---

## Summary of Port Priority

| # | Item | Effort | Value | React→Vanilla |
|---|---|---|---|---|
| 6.2 | d3-force Knowledge Graph | S | H | Easy |
| 6.1 | BYOK LLM Config Panel | S | H | Easy |
| 6.4 | Streaming Live-Log Panel | S | H | Easy |
| 6.10 | Persona/Role Card System | M | H | Medium |
| 6.3 | dagre Reasoning Canvas | L | H | Hard |
| 6.5 | xterm.js Terminal Panel | M | M | Medium |
| 6.6 | Bilingual i18n | S | M | Easy |
| 6.7 | Cost Tracking Dashboard | M | M | Medium |
| 6.8 | Resizable Layout | M | M | Medium |
| 6.9 | Session Export/Import | S | M | Easy |
| 6.12 | DOM Event Bus | S | M | Easy |
| 6.11 | Vite Debug Collector | S | L | Easy |

**Recommended first wave:** 6.1 + 6.2 + 6.4 + 6.12 — all Easy translations, together they give Gap Map interactive graph visualization, improved BYOK config, streaming log panel, and clean cross-panel messaging. Estimated 2-3 days total.

**Second wave:** 6.10 + 6.9 + 6.6 — persona cards, session export, i18n scaffolding.

**Third wave:** 6.3 (dagre canvas) — highest value but requires a week of careful vanilla-JS reimplementation.
