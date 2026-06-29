# Overview Daily Update (Daily Digest) — Design

**Date:** 2026-06-29
**Status:** Approved — implement all layers + document.

## Problem

The Overview page shows the agent's *own* state (KPIs, strategy, opportunities,
drafts). It does not surface **what's new in the world** about the topics the
agent is trying to grow in. The user has to go hunting across sources to stay
current. We want the Overview to double as a **daily learning surface for the
user**: a short briefing + a ranked feed of the freshest news and knowledge
about the agent's niche + keywords, framed by the agent's goal.

## Decisions (locked)

- **Format:** Both — an LLM-synthesized *briefing* on top + a ranked *feed* of
  curated items below.
- **Refresh:** Auto once/day, cached. First Overview open each day builds a
  fresh digest (~10–20 s: light news fetch + LLM synthesis), then caches it for
  the rest of the day. A manual **Refresh now** button forces a rebuild.
- **Scope:** `agent.niche` + `agent.keywords[]`, framed by the agent's
  goal/objective (the *why-it-matters* is goal-aware, e.g. "drive TestNotes
  signups").

## Approach (chosen of 3)

**Corpus-first + light fresh news top-up.** On a build, do a thin fresh fetch of
the news-leaning sources for the agent's topic, union it with the freshest items
already in the corpus, rank by `freshness × engagement × source-weight`, take
the top N as the *feed*, then run one LLM call to synthesize a goal-framed
*briefing* from those items. Cache one row per agent per day.

Rejected: **corpus-only** (instant/cheap but stale — not "news"); **full fresh
fetch every build** (freshest but 30 s+ and costly — the once-a-day cache makes
the lighter top-up the sweet spot).

## Architecture

New engine `src/openreply/reply/digest.py`. Reuses, does not duplicate:
- `research.collect.collect(...)` for the light news fetch (`skip_extraction=True`,
  `skip_reddit=True`, news-only `sources`).
- `reply.library.list_corpus(...)` to read the freshest corpus items.
- `reply.rank` (`freshness`, `engagement_score`, `platform_weight`) to rank.
- `analyze.providers.base.get_provider` + `reply.util.loads_json` for the LLM
  synthesis (same fail-soft pattern as `playbook.py` / `ideas.py`).
- `reply.agent.get_agent` for niche/keywords/goal/objective.

### Data flow

```
build_digest(rebuild)
  ├─ get_agent → niche, keywords, goal/objective, product
  ├─ if not rebuild and today's row exists → return it (cached)
  ├─ if collect_fresh: collect(topic, sources=NEWS_SOURCES, skip_reddit, skip_extraction)
  ├─ feed = rank(list_corpus fresh items, last 3 days, top ~12)
  ├─ briefing = LLM synth(goal_block, feed)        # fail-soft → None
  ├─ upsert reply_digest row (id = sha1(agent|day), day = YYYY-MM-DD)
  └─ return {ok, day, cached:false, briefing, feed, sources, generated_at}
```

### Schema — `reply_digest` (added to `reply/schema.py`)

| col | type | notes |
|---|---|---|
| `id` | str (pk) | `sha1(agent_id|day)[:16]` — one row per agent per day |
| `agent_id` | str | |
| `day` | str | `YYYY-MM-DD` local |
| `briefing_json` | str | `{sections:[{headline, why, links:[{title,url,source}]}], summary}` or `{}` |
| `feed_json` | str | ranked items `[{title, url, source, sub, score, created_utc, snippet}]` |
| `sources_json` | str | `{by_source:{...}, item_count, llm:bool, collected:bool}` |
| `created_at` | int | epoch |

Index `(agent_id, day)`. Forward-compat: created only if absent (matches the
existing idempotent `init_reply_schema` pattern).

### CLI — `reply digest` (in `cli/reply_cmds.py`)

```
openreply reply digest [--rebuild] [--no-collect] [--n 12] [--json]
```
- default: return today's cached digest, building it if missing.
- `--rebuild`: force a fresh build.
- `--no-collect`: skip the light news fetch (synthesize from existing corpus).

### Rust command — `agent_digest` (commands.rs + main.rs)

```rust
#[tauri::command]
pub async fn agent_digest(app, rebuild: Option<bool>) -> Result<Value, String>
// → run_cli(["reply","digest", ("--rebuild")?, "--json"])
```
Registered in `main.rs` generate_handler alongside `agent_ideas`.

### API wrapper — `agentDigest` (or/api.js)

```js
agentDigest: (rebuild) => call("agent_digest", { rebuild: !!rebuild }),
```

### UI — "Daily Update" card on Overview (`or/dynamic.js` renderOverview)

Placement: a full-width card inserted **after** the strategy strip
(`#ov-strategy`) and **before** the KPI grid — high on the page, since it's the
"what's new today" hook.

Behavior:
1. On render, instant-paint the last cached digest from `localStorage`
   (`or.digest.<agentId>` SWR) if present, else a skeleton.
2. Fire `api.agentDigest(false)` async. While in flight show a "Building today's
   update…" spinner state (only if nothing was painted from cache). On success,
   write to `localStorage` and repaint.
3. **Refresh now** button → `api.agentDigest(true)` with a spinner; repaint on
   done.
4. Render: briefing summary + up to 4 sections (headline + why + source links),
   then a compact feed list (top ~6 with source badge + relative age + link).
   If `briefing` is null (no LLM), show feed only with a subtle "Add an AI
   provider in Settings for the daily briefing" note (fail-soft).

The auto-build only triggers a (slow) fetch+LLM on the *first* open each day;
subsequent opens hit the cached DB row and return fast.

## Error handling

- No agent → card shows nothing (Overview already guards no-agent).
- No LLM → `briefing: null`, `ok: true`, feed still rendered (matches
  `ideas.suggest_ideas` skip-soft contract; never raises).
- Collect failure → caught; build continues from existing corpus, `collected:false`.
- Empty corpus + empty fetch → `ok: true`, empty feed, friendly "nothing new
  yet — Refresh + learn" message. Never cache an empty feed to localStorage.

## Testing

`tests/test_digest.py`:
1. `test_build_digest_fail_soft_no_llm` — fresh agent, `collect_fresh=False`;
   returns `ok:true`, `briefing` None-or-empty, `feed` list, never raises.
2. `test_digest_cached_same_day` — build, then `build_digest(rebuild=False)`
   returns the same `day` and `cached:true` without re-synthesizing.
3. `test_digest_rebuild_makes_new` — `rebuild=True` re-runs (row upserted for
   the day, `cached:false`).

Verification (manual, per the verify skill): launch the app, open Overview,
confirm the Daily Update card builds + caches + the Refresh button rebuilds.
```
