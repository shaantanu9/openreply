# OpenReply — Analytics + AI Visibility (GEO), full features

**Date:** 2026-06-27
**Status:** Approved — implementing

## Goal

Turn the two thin dashboards into real, working features.

- **AI Visibility (GEO):** today citation status is set **manually**. Make it
  **automated** — on "Check", query the configured BYOK LLM, capture its answer,
  and auto-detect whether the brand is **cited** vs a **competitor** vs
  **absent**. Store the answer + competitors + a check history (trend).
- **Analytics:** today = counts + 2 text lists. Add **trends over time** (30-day
  daily series), **content performance** (by kind + funnel), **visual charts**
  (inline SVG, no chart lib), and a **keyword/subreddit breakdown**. Aggregate
  server-side in one command.

## AI Visibility — automated checking

**`reply/geo.py`:**
- Migrate `geo_queries`: add `answer` (str), `competitors` (str, JSON list),
  keep `last_checked`. Add history table `geo_checks`
  (id, query_id, agent_id, status, answer, competitors, checked_at).
- `check_query(qid, provider=None)`:
  1. Load the query row + active agent (brand name + keywords).
  2. Prompt the LLM to answer the query as the chosen surface would, honestly
     recommending specific tools/brands/sources; return JSON
     `{answer, recommendations[]}`.
  3. Classify: `cited` if the brand appears in answer/recommendations; else
     `competitor` if recommendations exist but ours is absent; else `absent`.
  4. Persist status + answer + competitors + `last_checked`; append a
     `geo_checks` row. Return the updated row.
- `check_all(agent_id=None, provider=None)` — check every tracked query.
- `query_history(qid)` — `geo_checks` rows for the trend sparkline.
- Tolerant JSON parsing; LLM-not-configured returns `{error}` (no raise).

**CLI `reply_cmds.py`:** `geo-check <id>`, `geo-check-all`.
**Rust `commands.rs` + `main.rs`:** `geo_check(id)` + register.
**`api.js`:** `geoCheck(id)`.
**`dynamic.js` renderGeo:** per-query **Check** button (spinner → status +
expandable answer + competitor chips + "checked Nm ago"); header **Check all**;
keep manual "Mark cited" as an override; KPIs unchanged + a citation-rate note.

## Analytics — server-side aggregation

**`reply/analytics.py` (new):** `analytics_summary(agent_id=None, days=30)` returns:
- `kpis`: opportunities, saved, drafted, replied, dismissed, content_total,
  content_drafts, content_posted, citation_rate (from geo).
- `series`: last-`days` daily buckets for `opps_found` (from `found_at`),
  `content_created` (`created_at`), `content_posted` (`posted_at`).
- `content_by_kind`: count per kind; `funnel`: draft→scheduled→posted.
- `by_subreddit` / `by_platform`: top opportunity drivers (from `sub`/`platform`).
- `by_keyword`: agent keywords matched against opportunity title/body counts.

**CLI:** `reply analytics [--days]`. **Rust:** `analytics_summary(days)` + register.
**`api.js`:** `analyticsSummary(days)`.
**`dynamic.js` renderAnalytics:** rewrite to render `analytics_summary` with
inline-SVG bar/sparkline charts (`barRow`, `sparkline` helpers), KPI grid,
content-by-kind bars, funnel, and the subreddit/keyword breakdowns. Graceful
empty + non-Tauri fallback.

## Non-goals
- Real ChatGPT/Perplexity/Google APIs (paid) — the BYOK model answer is the proxy.
- Scheduled/auto re-checks — manual "Check" / "Check all" for now.
- Heavy chart libraries — inline SVG only.

## Testing
- `geo.check_query` classifies cited/competitor/absent; history row appended;
  bad id → error; LLM-missing → error (no raise); migration idempotent.
- `analytics_summary` returns reconciling KPIs + 30 daily buckets on seeded data.
- `cargo check` 0 errors; `node --check` clean; live smoke in Tauri dev.
