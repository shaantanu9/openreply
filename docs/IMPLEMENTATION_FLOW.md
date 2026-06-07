# Gap Map — Implementation Flow (Competitive Feature Build)

> **Updated:** 2026-06-07 · Companion to `docs/COMPETITIVE_ANALYSIS.md`
> The buildable, sequenced plan to ship the features that make Gap Map beat its competitors.
> Build **top-to-bottom**. Each feature is wired across all 4 surfaces (Core → CLI → MCP → Tauri) and verified before moving on.

---

## 0. The registration pattern (every feature follows this)

Verified against the `lit_matrix` feature (the canonical recent example):

| Tier | File | Anchor (verified) |
|---|---|---|
| **Core module** | `src/gapmap/research/<feature>.py` | `lit_matrix.py` — `build()` / `get()` / `export_csv()` |
| **CLI command** | `src/gapmap/cli/main.py` | `@research_app.command("lit-matrix")` @ **L4239** |
| **MCP tool** | `src/gapmap/mcp/server.py` | `def gapmap_lit_matrix(...)` @ **L1287** (FastMCP auto-discovers `@mcp.tool()`) |
| **Tauri cmd** | `app-tauri/src-tauri/src/commands.rs` | `pub async fn lit_matrix_build(...)` @ **L1945** |
| **Tauri register** | `app-tauri/src-tauri/src/main.rs` | add to `generate_handler![]` |
| **Frontend API** | `app-tauri/src/api.js` | wrapper around `invoke('lit_matrix_build', {...})` |
| **Frontend screen** | `app-tauri/src/screens/<feature>.js` | UI |
| **DB table** | `src/gapmap/core/db.py` | `init_schema()` @ **L202**, pattern at `topic_posts` @ **L344** |

**Gap object** comes from `src/gapmap/research/gaps.py` (`find_gaps()` @ ~L353) → keys: `painpoints`, `feature_wishes`, `product_complaints`, `diy_workarounds`, `corpus_size`, `provider`.
**Post row** (`src/gapmap/core/db.py` `posts` table @ ~L204): `id, sub, source_type, author, title, selftext, url, score, upvote_ratio, num_comments, created_utc, is_self, over_18, flair, permalink, fetched_at`.

**Reusable existing modules (don't re-build):**
- `research/sentiment_by_source.py` → intensity signal for Pain Score.
- `research/signals.py` (severity/confidence schema) + `research/monitor.py` + `research/product_sweep.py` → foundation for Alerts.
- `research/product_digest.py` → foundation for Digest.
- `research/audience.py` (`audience_personas`) → links gaps → people.
- `mcp/jobs.py` (async job queue, `submit()`) → background runs for Alerts/Digest.

---

## Acceptance bar (applies to EVERY feature)

A feature is **DONE** only when ALL pass:
1. ✅ Core function returns valid data: `uv run gapmap research <cmd> --topic <t> --json`
2. ✅ CLI command registered and prints JSON.
3. ✅ MCP tool callable (`gapmap mcp status` / shows in tool list).
4. ✅ Tauri command in `generate_handler![]` + `api.js` wrapper + a screen renders it.
5. ✅ DB table auto-creates on first run (no "no such table" crash).
6. ✅ Result persisted (to its table or `mcp_analyses`).
7. ✅ A unit test in `tests/` covers the core function.
8. ✅ `graphify update .` run + changelog entry written.

---

## Build sequence (do in this order — later features reuse earlier ones)

### ▶ Feature 1 — **0–100 Pain Score** `[P0]`
*Why first: most self-contained, biggest demo impact, foundation for ranking everything else.*

**Formula:** `pain_score = w_f·frequency_norm + w_i·intensity_norm + w_r·recency_norm` (default weights 0.4/0.35/0.25, env-tunable).
- `frequency` = count of posts/comments tied to the gap.
- `intensity` = avg negative-sentiment magnitude (reuse `sentiment_by_source.py`) blended with engagement (`score`, `num_comments`).
- `recency` = exponential decay on `created_utc` (half-life ~90 days, env-tunable).

**Steps**
1. DB: add `gap_scores` table — pk `(topic, gap_id)`, cols `frequency, intensity, recency, pain_score, sample_post_ids(json), updated_at`. (`db.py` init_schema)
2. Core: `research/pain_scoring.py` → `score_gaps(topic, force=False)`, `get(topic)`. Pulls gaps from `gaps.py`, posts from `topic_posts`, sentiment from `sentiment_by_source`.
3. CLI: `@research_app.command("gap-pain-scores")` → `--build / --topic / --json`.
4. MCP: `gapmap_gap_pain_scores(topic, build=False)`.
5. Tauri: `gap_pain_scores` command + main.rs + `api.js` (`cachedInvoke`, 30s) + show score chips on the gaps screen (color: red ≥70, amber 40–69, grey <40).
6. Test + graphify + changelog.

---

### ▶ Feature 2 — **"Real people to reach" list** `[P1]`
*Reuses Feature 1's gap→post links; adds the author/permalink rollup + persona tag.*

**Steps**
1. DB: `gap_evidence_users` — pk `(gap_id, author)`, cols `topic, permalink, post_id, post_score, num_comments, engagement_rank, persona_cluster_id(nullable), updated_at`.
2. Core: `research/gap_audience.py` → `get_gap_users(topic, gap_id, limit=25)` — dedupe by author, rank by engagement, cross-ref `audience.py` personas for `persona_cluster_id`.
3. CLI: `@research_app.command("gap-audience")`.
4. MCP: `gapmap_gap_audience(topic, gap_id, limit)`.
5. Tauri: command + api + a panel under each gap → list of users with clickable permalinks + "copy outreach list" (CSV).
6. Test + graphify + changelog.

---

### ▶ Feature 3 — **Trend velocity (growth rate)** `[P2]`
*Cheap, reuses `created_utc`; feeds Alerts (spike detection) and Pain Score recency.*

**Steps**
1. Core: `research/trend_velocity.py` → `compute_gap_velocity(topic, gap_id, window_days=7)` → `{posts_per_day, prev_period, velocity_pct, direction}`. Bucket `topic_posts` by `created_utc`.
2. (No new table needed initially — compute on read; optionally cache in `gap_scores`.)
3. CLI: `@research_app.command("gap-velocity")`.
4. MCP: `gapmap_gap_velocity(topic)`.
5. Tauri: command + api + ▲/▼ velocity badge next to each pain score.
6. Test + graphify + changelog.

---

### ▶ Feature 4 — **Saved Alerts / Monitoring** `[P1]`
*Depends on Features 1 & 3 (score + velocity are what we watch). Reuses `signals.py` + `jobs.py`.*

**Steps**
1. DB: `gap_alerts` — pk `alert_id`, cols `topic, gap_ids(json), alert_type(spike|new|score_threshold), threshold, frequency(daily|weekly), enabled, last_checked_at, last_triggered_at, created_at`. Plus `gap_alert_events` for fired history.
2. Core: `research/gap_alerts.py` → `create_alert(...)`, `list_alerts(topic)`, `update_alert(...)`, `delete_alert(...)`, `check_alerts(topic=None)` (compares current score/velocity to baseline; records events).
3. CLI: `@research_app.command("gap-alerts")` with subactions (`--create/--list/--check/--delete`).
4. MCP: `gapmap_gap_alerts_list/_create/_update/_delete/_check`.
5. Background: register `check_alerts` as a `jobs.py` job; document a launchd/cron trigger in `scripts/` (don't auto-install — add to `docs/manual-todo/`).
6. Tauri: full CRUD screen + a bell badge showing fired events.
7. Test + graphify + changelog.

---

### ▶ Feature 5 — **Evidence-weighted answers** `[P1]`
*Consensus-style verdict; reuses gap posts + LLM provider resolution.*

**Steps**
1. DB: `evidence_verdicts` — pk `(topic, claim_id)`, cols `claim, verdict(supported|mixed|contradicted|insufficient), supporting_count, contradicting_count, confidence, evidence_post_ids(json), sources_breakdown(json), updated_at`.
2. Core: `research/evidence_verdicts.py` → `answer(topic, claim)` — retrieves relevant posts/papers (reuse Palace/semantic search), LLM classifies each as support/contradict, aggregates verdict + confidence. Breakdown by source type (users vs papers).
3. CLI: `@research_app.command("gap-verdict")`.
4. MCP: `gapmap_gap_verdict(topic, claim)`.
5. Tauri: an "Ask" box on the gap/topic screen → returns verdict card (✅/⚠️/❌ + counts + "what users say vs what papers say").
6. Test + graphify + changelog.

---

### ▶ Feature 6 — **Daily/Weekly Idea Digest** `[P1]`
*IdeaBrowser-style retention loop. Reuses `product_digest.py`, Features 1/3/4.*

**Steps**
1. Core: `research/gap_digest.py` → `build_digest(topic, period='daily')` → markdown: top new/rising gaps by pain score + velocity, top people to reach, fired alerts.
2. CLI: `@research_app.command("gap-digest")` (`--period`, `--out`).
3. MCP: `gapmap_gap_digest(topic, period)`.
4. Background: schedule via `jobs.py`; launchd/cron entry documented in `docs/manual-todo/`.
5. Tauri: a "Digest" screen rendering the markdown + "export" + (later) email hook.
6. Test + graphify + changelog.

---

### ▶ Feature 7 — **GummySearch import + discovery presets** `[P0, time-sensitive]`
*The migration wedge. Built last because it's mostly ingestion/UX, but ship before Nov 2026.*

**Steps**
1. Core: `sources/gummysearch_import.py` → parse a GummySearch export (CSV/JSON of saved subreddits/audiences) → write to a new `audiences` table (pk `audience_id`, cols `name, subreddits(json), source, created_at`).
2. Core: curated **discovery presets** — `research/discover.py` already exists; add `PRESET_BUNDLES` (niche → subreddit list) so first-run is instant.
3. CLI: `@research_app.command("import-gummysearch")` + `@research_app.command("presets")`.
4. MCP: `gapmap_import_gummysearch(path)`, `gapmap_presets()`.
5. Tauri: an onboarding "Switch from GummySearch" screen → file picker → import → one-click collect; preset chips on the new-topic screen.
6. Marketing: a "Coming from GummySearch?" landing section (separate web task, note in `docs/manual-todo/`).
7. Test + graphify + changelog.

---

## Cross-cutting (after all 7)
- **Source-diversity badge** (anti-GummySearch hedge) — small UI badge: "Powered by 23+ sources, not one API."
- **Shareable public map/brief** — export a gap map + scores as a shareable link (ties to VISION's "shared knowledge space").
- Update `docs/FEATURES.md` and the summary table after each feature flips to ✅.

---

## Status tracker

| # | Feature | Core | CLI | MCP | Tauri | DB | Test | Status |
|---|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| 1 | Pain Score | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ done |
| 2 | People to reach | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ done |
| 3 | Trend velocity | ✅ | ✅ | ✅ | ✅ | n/a | ✅ | ✅ done |
| 4 | Saved alerts | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ done |
| 5 | Evidence verdicts | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ done |
| 6 | Idea digest | ✅ | ✅ | ✅ | ✅ | n/a | ✅ | ✅ done |
| 7 | GummySearch import | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ done |

Update this table as each cell ships.
