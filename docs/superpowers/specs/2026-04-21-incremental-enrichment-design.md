# Incremental Enrichment — Design Spec

**Date:** 2026-04-21
**Status:** draft (awaiting user approval)
**Related:** `docs/superpowers/plans/2026-04-21-incremental-enrichment.md`

## 1. Goal

Make OpenReply feel useful from minute 1. Instead of "collect → wait 10 minutes → see findings all at once," ship a two-phase pipeline where the user sees visible progress immediately and the analysis engine starts filling findings/graph/solutions/reports as soon as there's enough signal — then keeps improving as more posts land.

## 2. Two-phase pipeline

### 2.1 Phase A — Collect warmup (0 → 100 posts)

- Sources run in parallel as today (17 adapters, 6-worker pool).
- **No LLM extraction. No graph build. No embeddings.** Zero Python spawn beyond the collect sidecar already running.
- UI surface: a big progress card on Home + Topic page showing:
  - Live running count: "42 posts collected across 5 sources"
  - Per-source chips that tick as each adapter finishes: `reddit ✓ 18`, `hn ✓ 7`, `appstore ⏳`, …
  - Threshold indicator: "Insights begin at 100 posts" with a progress bar
  - ETA (rough): based on avg posts/second so far
- Memory stays flat at ~150 MB (Python baseline + sqlite + httpx pool).
- User can navigate to other topics without disrupting the collect — Python sidecar is already streaming.

### 2.2 Phase B — Incremental enrichment (100+ posts, ongoing)

Once `topic_posts.count(topic)` crosses 100, a background worker starts draining the extraction queue. Every batch of 5 posts produces:

1. Painpoint / feature-wish / workaround / product extraction (one LLM call per batch).
2. Embed each extracted finding → ChromaDB upsert.
3. Cluster into existing graph: cosine similarity ≥ 0.82 merges into existing node, otherwise creates a new node.
4. Emit graph edges: `evidenced_by`, `mentions_product`, cluster membership.
5. Mark source rows `extracted_at = now()`.
6. Commit transaction.
7. Fire `mutated('findings')` so every open tab's reactive listener refreshes.

Worker keeps ticking until the queue is empty. If the user starts a new collect, fresh rows land in `topic_posts`, trigger the queue, worker picks them up without restart.

### 2.3 Phase boundary

The 100-post threshold is per-topic, not global. Topic A crosses 100 → its extraction starts. Topic B is still at 40 → no extraction yet for it. One worker serves all topics; it drains whichever queue has the oldest pending row first (FIFO across topics).

## 3. Extraction queue

New table `extraction_queue`:

```sql
CREATE TABLE extraction_queue (
  topic TEXT NOT NULL,
  post_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'post',   -- 'post' | 'comment' | 'review'
  queued_at TEXT NOT NULL,
  attempted_at TEXT,
  attempts INTEGER DEFAULT 0,
  last_error TEXT,
  PRIMARY KEY (topic, post_id, kind)
);
CREATE INDEX idx_extraction_queue_queued_at ON extraction_queue(queued_at);
CREATE INDEX idx_extraction_queue_topic ON extraction_queue(topic);
```

Populated by:
- `collect.py::_tag_posts()` — after every batch of posts is tagged under a topic, inserts matching rows into the queue (idempotent via PK).
- Ingest (`ingest_and_persist`) — same, for locally-ingested files.
- Manual re-enqueue button in Settings ("Re-extract all for topic").

Drained by the worker (see §5). A row is removed on success; on failure, `attempted_at` + `attempts` + `last_error` update, row stays queued. After 3 attempts it's skipped (logged) until the user explicitly re-queues it.

## 4. Memory budget (hard constraint)

Must run comfortably on an 8 GB Mac with the app + Slack + a browser open.

| Component | Idle | Active | Cap |
|---|---|---|---|
| Rust Tauri shell | ~80 MB | ~120 MB | — |
| Native SQLite reads | 0 | ~5 MB/query | thread-local pool |
| Python collect sidecar | 90 MB | ~250 MB | dies when collect finishes |
| Python extraction worker | 120 MB | 350-450 MB with ChromaDB loaded | single instance, capped |
| Ollama (optional) | 0 | 3-4 GB | auto-unload after 10 min idle |
| ChromaDB palace (ONNX) | 0 | ~200 MB | lazy-loaded, evicted after 5 min idle |

**Total app footprint: ≤ 700 MB** with all components plus 3-4 GB if Ollama is active. Under 8 GB comfortably.

### 4.1 Memory governor

Rules enforced in the worker:

1. **Batch size = 5 posts** — 1 LLM call per batch. Sweet spot for token utilization and peak RAM.
2. **One worker, never parallel** — LLM + embedder fight for CPU/GPU. Serial batches mean predictable memory.
3. **ChromaDB lazy-init** — `from ..retrieval import palace` only on first embed call per batch. Client dropped after 5 min idle via `atexit` + timer.
4. **LLM idle handling is the provider's job** — we do NOT force-unload Ollama or any other provider. Users who run local Ollama accept the RAM cost in exchange for zero per-token spend. Cloud providers have no local memory footprint. Never send `keep_alive: 0` unless the user explicitly toggles "Release LLM when idle" in Settings (off by default).
5. **Worker sleep ladder:**
   - Queue non-empty: 0s between batches (back-to-back)
   - Queue empty, active topic: 30s poll interval
   - Queue empty, no active topic for 5 min: 5 min poll interval
   - App backgrounded (window hidden): 10 min poll interval
6. **Per-batch memory ceiling:** if RSS > 600 MB, flush ChromaDB client + gc.collect() before next batch. Prevents runaway growth on long sessions.

## 5. Worker lifecycle

- **Single long-lived Python process**, launched by Rust via `run_cli_streaming("research", "enrich-worker", "--serve")`.
- Supervised: on exit (SIGTERM from app quit, crash, OOM), Rust restarts it with exponential backoff (1s, 5s, 30s, up to 5 min). Max 3 restarts in 5 min → give up and surface "Extraction worker unavailable" in a top banner.
- **Startup gate:** worker only starts when at least one topic has ≥ 100 posts. Until then, it doesn't run at all (saves ~450 MB).
- **Shutdown:** worker exits cleanly on `SIGTERM` from Rust's `ExitRequested` handler.

### 5.1 Active topic tracking

UI reports the currently-viewed topic via `invoke('mark_topic_active', { topic })` on topic-page render and hash change. Rust caches the last-active timestamp per topic in-memory (no DB). Worker reads this cache via `invoke('active_topics')`. Topics last-seen within 10 min are "active"; others deprioritize in the FIFO queue ordering (active topics drain first).

## 6. UI surfaces

### 6.1 Phase-A progress card

Lives on Home (new-topic flow redirects to `#/collect/<slug>` which renders this). Also on Topic page when post count < 100.

```
┌───────────────────────────────────────────────┐
│ Gathering evidence for "meditation apps"      │
│                                               │
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░ 62 / 100            │
│                                               │
│ reddit ✓ 18    hn ✓ 7     appstore ⏳         │
│ arxiv  ✓ 12    devto ⏳    pubmed  waiting    │
│ ...                                           │
│                                               │
│ Insights begin at 100 posts. ETA ~2 min.      │
└───────────────────────────────────────────────┘
```

- Real-time updates via `collect:progress` events (already streamed from Python).
- When post count crosses 100, the card animates its border to orange and the bottom line changes to:
  > **Extracting insights…** 23 findings so far. Keep collecting — new posts auto-improve the graph.

### 6.2 Phase-B reactive tabs

Every data-bearing tab on the Topic page (Findings, Map, Gaps, Solutions, Chat, Research) subscribes to `openreply:changed` with kind matching its concern:

| Tab | Listens for | Action |
|---|---|---|
| Findings | kind in ['findings', 'collect', 'graph'] | refetch + re-render list |
| Map | kind in ['findings', 'graph'] | invalidate graph HTML cache, re-export on next open |
| Gaps | kind in ['findings', 'graph'] | refetch saturation panel |
| Solutions | kind === 'findings' | append new entries with fade-in |
| Research | kind in ['findings', 'collect'] | re-query paper analyses |
| Chat | none (reads on-demand per message) | — |

Each tab also shows a freshness badge in its header: `Updated 3s ago · 234 posts · 47 findings`.

### 6.3 Saturation score (v1)

Simple metric per topic: `new_clusters_last_50 / 50`. Rendered as a small sparkline + one-line hint on Topic page header:

- `≥ 0.20` → "Rich signal — keep going"
- `0.05 - 0.20` → "Converging — new posts add depth"
- `< 0.05` → "Saturated — try a new source for fresh angles"

Derived from `graph_nodes.created_at` vs post arrival timestamps. Cheap SQL. No LLM. Refreshed every 50 new posts.

### 6.4 Coverage gaps panel

Passive panel on Topic page (below the tabs, above the graph export button). Shows dimensions that have < 10% of posts contributing:

```
Coverage gaps
• User reviews — 0 posts (no App Store / Play Store data)
  [+ Add App Store reviews]   [+ Add Play Store reviews]
• Academic evidence — 4 posts (2%)
  [+ Add arXiv]   [+ Add OpenAlex]
• Competitor mentions — only 1 product name surfaced
  [+ Deepen product extraction]  (runs a targeted LLM pass)
```

Clicking a "+ Add" button fires `startCollect` with only that source selected (not a full re-collect). Uses existing collect infrastructure.

## 7. Collect API change

`collect.py::collect()` gains a new arg `skip_extraction: bool = False`. Current behaviour (immediate enrich call after collect finishes) is removed from the default path — extraction now happens via the worker, not inline.

Start_collect Rust command stays the same. The worker picks up queued rows autonomously.

## 8. Events + commands (Rust)

New Tauri commands:
- `start_extraction_worker()` — spawns the worker if not running
- `stop_extraction_worker()` — SIGTERM the worker (used on app quit + "pause" toggle)
- `extraction_worker_status()` → `{ running: bool, queued: int, processed_total: int, last_batch_ms: int, last_error?: string }`
- `mark_topic_active(topic)` — updates in-memory active set
- `enqueue_extraction(topic, force?)` — manual re-queue trigger

New events (frontend listens):
- `enrich:tick` — `{ topic, batch_size, processed, queued, duration_ms }` — fired per batch
- `enrich:idle` — fired when queue empties
- `enrich:error` — `{ message, batch, topic }` — fired on batch failure

`mutated('findings')` is fired by the worker after every successful batch (via a `enrich:tick` event → main.js listener → `mutated()` dispatch).

## 9. Edge cases

- **Topic deleted mid-extraction** — worker checks `topic_prefs` before each batch; if topic is soft-deleted, batch is dropped.
- **LLM provider down** — failed batch increments `attempts`, sleeps 30s, tries again. After 3 failures, row is skipped and `last_error` is set. UI shows warning banner with "Retry all failed" button.
- **Parse error from LLM** — sentinel `_parse_error` payload is logged, row marked failed, worker continues with next batch (no silent loss).
- **Worker crash mid-batch** — transaction rolls back (nothing committed), row stays queued, supervisor restarts, worker picks up on next tick.
- **Existing topics with pre-existing extractions** — migration: on first worker boot, all pre-existing `topic_posts` rows WITHOUT matching `graph_nodes.evidence_post_id` are queued. One-time backfill.
- **Out-of-memory** — worker tracks RSS via `resource.getrusage`; when > 600 MB, drops ChromaDB client + calls `gc.collect()`. If RSS is still > 600 MB, exits 137; supervisor restarts it. Logged.

## 10. Out of scope for v1

- Parallel per-topic workers
- Full embedding-novelty saturation math (ships in v2)
- Nightly full LLM relationship pass (just the manual "Deepen graph" button)
- Cross-topic link discovery ("Topic A shares X pain with Topic B")
- Per-source embedding cache (re-embeds same Reddit post if user has two topics pointing at it — measured: ~3s/100 posts overhead on first pass only, acceptable)

## 11. Success criteria

1. User kicks off a new topic and sees Phase-A progress within 500ms of hitting "Start."
2. At ~100 posts, Findings/Map/Gaps/Solutions tabs begin populating without manual intervention.
3. On an 8 GB Mac with Ollama, app peak RAM stays ≤ 5 GB during active collect + extraction.
4. Worker survives app background/foreground cycles, topic deletion, and LLM provider changes.
5. Closing the app terminates the worker cleanly; reopening resumes from the queue.

## 12. Token-cost controls (Settings → Extraction)

LLM tokens are the main cost. The user must be able to control when extraction runs and how aggressively it spends tokens. Five Settings toggles:

### 12.1 Extraction mode

Radio group, stored in `topic_prefs.extraction_mode` (global default in `openreply.pref.extraction_mode`):

| Mode | Behavior | When to use |
|---|---|---|
| **Auto (default)** | Worker drains queue as soon as topic crosses 100 posts. | Cloud LLM with budget, or local Ollama (free). |
| **Manual** | Nothing runs until user clicks "Extract now" on the topic page. | Strict token budget, or user wants to review corpus first. |
| **Scheduled** | Worker drains only during user-defined windows (e.g. 11pm-6am). | Cloud API with off-peak pricing, or local Ollama so the laptop isn't hot during the day. |

### 12.2 Post threshold

Slider 50 → 500 (default 100). `openreply.pref.extraction_threshold`. Users with cheap providers or small topics can drop to 50 for faster feedback; users with premium models can raise to 200-500 for higher-quality first pass.

### 12.3 Batch size

Slider 1 → 20 (default 5). `openreply.pref.extraction_batch_size`. Larger batches = fewer LLM calls per 100 posts (cheaper per post due to fixed prompt overhead) but higher peak RAM + longer tail latency per batch. Smaller batches = more responsive UI but more total tokens spent on prompt scaffolding.

### 12.4 Daily token budget (optional)

Numeric input + "no limit" checkbox. `openreply.pref.daily_token_cap`. When the worker's cumulative token usage for the current day (reset at local midnight) hits the cap, it pauses and emits `enrich:cap-reached`. UI surfaces a banner with "Resume" and "Raise cap" buttons. Tracked in a new `extraction_daily_usage` table (date, provider, tokens_in, tokens_out, est_usd).

### 12.5 Release LLM when idle

Checkbox, off by default. `openreply.pref.release_llm_idle`. ONLY when on, the worker sends `keep_alive: 0` to Ollama after 10 min idle. For users on a RAM-tight machine who want Ollama offloaded between bursts. Default off because most users don't want the 8s reload lag.

### 12.6 Cost estimator (informational, always visible)

Every topic page and the Settings → Extraction pane shows a live estimate:
> *Estimated cost to extract your queue: 3,412 posts × ~350 tokens/batch × $0.15/1M = **$0.18** (via OpenRouter → google/gemini-3.1-flash-lite-preview)*
> *Ollama is selected — $0 spend, ~12 min on local model.*

Derived from: queued row count, current provider/model, batch size, typical prompt size. Not authoritative but within 20%. Ships as a UI helper, not a hard gate.

## 13. Settings persistence

Extraction settings live in `topic_prefs` per-topic (override) AND `localStorage` for global default. Global takes effect when a topic has no `extraction_mode` set in `topic_prefs`. Rust reads global from a new `config/extraction.json` file that the Settings UI writes.

## 14. Confirm before planning

Defaults now locked:
- **Mode: Auto** (start at 100 posts automatically)
- **Threshold: 100** (slider, user-adjustable)
- **Batch size: 5**
- **Daily cap: none** (opt-in)
- **Release LLM when idle: off**
- **Backfill existing installs: per-topic on first open** (migration runs when user opens a topic whose posts have no extraction history)

If any of these should change, say so. Otherwise the plan proceeds.
