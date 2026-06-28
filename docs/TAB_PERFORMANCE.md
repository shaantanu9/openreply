# Topic-tab performance — what we fixed and how it loads now

This doc captures the work shipped on **2026-05-01** to make topic tabs feel
"local-SQLite fast" rather than "spawning a Python interpreter every click
fast." It's both a record of the change and a reference for the next person
to add a tab loader without re-introducing the same slowness.

---

## TL;DR

| Surface                                  | Before                                  | After                            |
| ---------------------------------------- | --------------------------------------- | -------------------------------- |
| Insights/Home tab cached read            | 50–200 ms warm · 500–2000 ms cold       | ~1 ms (native rusqlite)          |
| Papers tab list                          | 200–800 ms (sidecar)                    | ~1 ms (native rusqlite)          |
| Bets tab list                            | 300–800 ms (sidecar)                    | ~1 ms (native rusqlite)          |
| Solutions tab fetch (per topic)          | 1 + 2N round-trips (N painpoints)       | 1 bundled native call            |
| Tab freshness badges (11 of them)        | 11 sidecar calls / 1 second             | 1 bundled call / 5 seconds       |
| Topic-page mount IPC fan-out             | ~15 calls                               | ~3 calls                         |
| Idle IPC traffic per topic page          | 11 pings / sec                          | 0.2 pings / sec                  |
| Re-open same tab within 30 s             | re-fetched from sidecar                 | served from in-memory cache      |

---

## Root cause — why "local SQL" felt slow

`run_query` (raw SQL) had already been ported to native rusqlite
(`commands.rs::run_query`), so individual SELECTs were ~1 ms. But the
**rest of the data path still went through the Python sidecar**:

1. Every `api.X(...)` call → `invoke('X', ...)` → Tauri IPC → either:
   - **Dev mode**: warm-Python daemon (`cli.rs:158-228`), ~50–200 ms each, OR
   - **Production DMG**: cold PyInstaller sidecar spawn, ~500–2000 ms each
     (PyInstaller imports + macOS Gatekeeper re-verify per .so).
2. Topic page mount fired ~15 of these in parallel (prefetches +
   freshness badges + topicStats + byokStatus + saturation + coverage).
3. 11 freshness badges polled at 1 Hz = 11 sidecar pings / second
   competing with real tab loads for the IPC pipe.
4. The "cached" insight read (`synthesize_insights --cached`) is just one
   SELECT on `topic_insights` — but it went through the sidecar too.

Even with the warm-Python daemon, the IPC framing alone added ~10–30 ms per
call, and the daemon **doesn't run in production** (one-shot only on
PyInstaller). On a fresh DMG, opening a topic could spend 5–15 s waiting on
sidecar cold-starts before any pixel painted.

---

## Fixes shipped

### 1. Native rusqlite fast-path for cached insights
**File:** `app-tauri/src-tauri/src/commands.rs::topic_insights_cached`

`api.synthesizeInsights(topic, cached=true)` now routes through a direct
rusqlite SELECT on `topic_insights`. Returns the same shape Python's
`load_insights()` emitted (with `_cached=true`, `_generated_at`, etc.) —
the frontend doesn't know the difference. Cache TTL: 30 s in-memory.

The non-cached branch (which actually calls the LLM for synthesis) still
goes through the Python sidecar — that's where the LLM provider clients
live and that's not a hot path anyway.

### 2. Bundled `topic_counts_bundle` command
**File:** `app-tauri/src-tauri/src/commands.rs::topic_counts_bundle`

Replaces 11 separate `runQuery` SELECTs (one per tab badge) with **one**
rusqlite roundtrip that returns:

```json
{
  "painpoints": 12, "feature_wishes": 5, "workarounds": 8, "products": 3,
  "concepts": 14, "evidence_papers": 22, "total_findings": 28,
  "posts": 412, "sources": 6, "hypotheses": 4, "ai_analyses": 7
}
```

All 11 freshness badges now share that one cached fetch (15 s TTL). Counts
only change on `collect` / `enrich` / `findings` mutations, all of which
already invalidate the bundle key via `INVALIDATE_MAP`.

### 3. Freshness-badge poll throttle 1 s → 5 s
**File:** `app-tauri/src/screens/topic.js` (`bundleGetCount` block)

Counts only change on user action (collect / enrich / ingest). Polling at
1 Hz was pure waste — every other interval re-read the same numbers and
burned an IPC. Bumped to 5 s. Combined with the bundled-fetch cache, this
cuts steady-state IPC pings from 11/sec to ~0.2/sec.

### 4. Per-topic shared in-flight fetch for the bundle
**File:** `app-tauri/src/screens/topic.js`

Through `cachedInvoke`'s `_inflight` Map, when a freshly-mounted topic page
fires 11 `bundleGetCount()` lambdas in the same tick, they all dedupe onto
**one** Tauri call instead of 11. Tab badges paint together on a single
roundtrip.

### 5. Cache-key invalidation extended
**File:** `app-tauri/src/api.js` (`INVALIDATE_MAP`)

Added `topic_counts_bundle` and `topic_insights_cached` to the invalidation
lists for `topics`, `collect`, `ingest`, `graph`, and `findings` mutation
kinds. So after a collect lands, badges and the cached report both refresh
automatically — no manual `clearApiCache` needed.

### 6. Native fast-path for the Papers tab
**File:** `app-tauri/src-tauri/src/commands.rs::papers_list_native`

Was a Python sidecar call (`research papers-list`). Now a single rusqlite
JOIN that filters `topic_posts` × `posts` on academic source types, with
a `LEFT JOIN paper_full_texts` to compute the `has_fulltext` flag in one
shot. Source list matches `ACADEMIC_SOURCES` in `paper_export.py` exactly:
`arxiv, pubmed, openalex, scholar, semantic_scholar, crossref`. The
arXiv `pdf_url` derivation (`/abs/<id>` → `/pdf/<id>.pdf`) happens in SQL
so the frontend doesn't need to touch it.

`api.papersList` now routes there (30 s TTL). The legacy sidecar path
stays available as `api.papersListSidecar` for callers that need fields
the native path doesn't expose.

### 7. Native fast-path for the Bets tab
**File:** `app-tauri/src-tauri/src/commands.rs::hypothesis_list_native`

Was a Python sidecar call (`research hypothesis-list`). Now a single
rusqlite SELECT with the same `_hydrate` step Python did inline:
`card_json` → `card`, `linked_evidence` → `evidence`. The Bets renderer
reads `row.card.<field>` so the contract is preserved exactly.

`api.hypothesisList` routes there (30 s TTL). Cache invalidation via
`mutated('hypothesis')` clears both the legacy and native keys.

### 8. Bundled `solutions_data_bundle` for the Solutions tab
**File:** `app-tauri/src-tauri/src/commands.rs::solutions_data_bundle`

The Solutions tab used to do **1 + 2N round-trips**:

```text
1× SELECT painpoints                       (~1 ms)
N× SELECT interventions FOR each painpoint (~1 ms × N)
N× SELECT papers        FOR each painpoint (~1 ms × N)
```

For a topic with 25 painpoints that's 51 IPC roundtrips even on the warm
native path — ~500–1500 ms of pure framing overhead. The bundle
collapses it to **3 SQL statements** (painpoints / all interventions
across all painpoints / all papers across all painpoints) executed in
**one** Tauri call, then stitched into the existing
`{ pp, interventions, papers }` shape the frontend expects.

`api.solutionsDataBundle` (30 s TTL) is now the only fetch path used by
`loadSolutions`.

### 9. TTL bump on `getFindings`
**File:** `app-tauri/src/api.js`

Bumped from 10 s → 30 s. Findings only change on enrich completion, which
already invalidates the cache. The 10 s TTL was hurting tab revisits.

---

## How a tab loads now (happy path)

User clicks **Insights** tab on a topic that already has a synthesized
report.

```
0 ms    switchTab('insights') called
0 ms    Snapshot HTML in DOM cache?  YES → restored, returns. Done.

           IF NO snapshot:
0 ms    Skeleton "Loading insights…" rendered (synchronous)
0 ms    loadInsights() reads localStorage SWR cache
~1 ms   If cache hit → renderFull() paints the report
~1 ms   Background refresh: api.synthesizeInsights(topic, true)
                               ↓
                       cachedInvoke('topic_insights_cached', …, 30s)
                               ↓
                       In-memory cache hit?  → return instantly
                               ↓ miss
                       Tauri IPC → topic_insights_cached (Rust)
                               ↓
                       rusqlite SELECT (~1 ms)
                               ↓
                       JSON → frontend (~1 ms)
~5 ms   Background refresh complete; report re-rendered if newer
```

Total perceived latency: **~5 ms** (warm), **~50 ms** (cold first ever
open of the topic that session).

Compare with the old path: 200 ms warm, 1500 ms cold. The user no longer
sees the "Loading insights…" spinner unless they're hitting genuinely
empty state.

---

## Tab loader status (what's been audited)

| Tab          | Loader                          | Path                          | Notes                                                       |
| ------------ | ------------------------------- | ----------------------------- | ----------------------------------------------------------- |
| home/insights| `loadInsights`                  | native (`topic_insights_cached`) | Native fast-path; LLM regen still sidecar                |
| map          | `loadMap`                       | rusqlite (`run_query`)        | 4 stat queries, all native                                  |
| evidence     | `loadEvidence`                  | rusqlite (`run_query`)        | One bundled findings query                                  |
| posts        | `loadPosts`                     | rusqlite (`run_query`)        | Already paginated SWR                                       |
| sources      | `loadSources`                   | rusqlite (`run_query`)        | Source × subreddit roll-ups                                 |
| research     | `loadResearch`                  | rusqlite (`run_query`)        | Source-filtered posts query                                 |
| ai_analyses  | `loadAiAnalyses`                | rusqlite (`run_query`)        | mcp_analyses list                                           |
| solutions    | `loadSolutions`                 | native (`solutions_data_bundle`) | One bundled call replaces 1+2N round-trips               |
| concepts     | `loadConcepts`                  | rusqlite + sidecar for re-run | List from graph_nodes; LLM only on user click               |
| trends       | `loadTrends`                    | sidecar (cached on Python)    | Auto-runs LLM on first view if no cache                     |
| sentiment    | `loadSentiment`                 | rusqlite + sidecar for re-run | List from graph_nodes; LLM only on user click               |
| papers       | `loadPapers`                    | native (`papers_list_native`) | Bundled list + has_fulltext flag in one query              |
| bets         | `loadBets`                      | native (`hypothesis_list_native`) | Hydrated card JSON included in payload                  |
| chat         | `loadChat`                      | sidecar streaming             | LLM-bound; not affected                                     |
| report       | `loadReport`                    | sidecar (LLM synth)           | screenCache SWR for paint                                   |
| actions      | `loadActions`                   | local DOM                     | No data fetch                                               |
| search       | `loadSearch`                    | rusqlite (`run_query`)        | Persisted searches list                                     |

---

## Cache invalidation rules of thumb

When you write a new mutating Tauri command:

1. The frontend wrapper should call `mutated('<kind>')` AFTER the write
   succeeds. The kind picks the right list of names to clear.
2. If the new write also affects per-topic counts, add
   `'topic_counts_bundle'` to the relevant kind in `INVALIDATE_MAP`.
3. If it produces or consumes a cached report, add `'topic_insights_cached'`.

Don't manually invalidate from a screen — always go through `mutated()`
so other open screens see the change immediately via `openreply:changed`.

---

## What's still on the table for follow-ups

- **Bundled "topic dashboard" payload.** A single Tauri call that returns
  topic-stats + counts + cached insight report + recent activity in one
  rusqlite roundtrip. Would collapse the topic-mount fan-out from 3 calls
  to 1.
- **Production-mode warm-Python daemon.** The dev path uses a long-lived
  Python interpreter (`cli.rs:158-228`); production DMG re-spawns
  PyInstaller per call. Wiring the daemon through Tauri's shell plugin
  Command channel would cut LLM-pipeline calls (`runSolutionsPipeline`,
  `runConcepts`, etc.) from ~2 s cold to ~300 ms.
- **Pre-compute tab snapshots on enrich completion** so first-visit-after-
  enrich is instant rather than waiting on the cached read.
- **Native rusqlite paths for the remaining read-only sidecar commands**
  (paper_analyses_get, hypothesis_stats — already partially native via
  cachedFetch, topic_saturation, topic_coverage_gaps).

See `changelogs/2026-05-01_06_*` for follow-up work as it lands.
