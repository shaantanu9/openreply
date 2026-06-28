# Intent Layer — per-topic deliverable routing

**Date:** 2026-04-21
**Status:** Spec for v1 implementation. Depends on 2026-04-20 product-vision-agents and 2026-04-20 monetization-strategy. Changes none of the underlying pipelines.

## TL;DR

Add one metadata field (`topic_prefs.intent`) that tells the app which deliverable a user wants from a topic. Five presets — build product / improve product / thesis / UX research / market report. On topic open, auto-select the tab that serves that intent and surface a 3-4 step "action ladder" at the top. No hidden features, no schema redesign, no new pipelines — same fusion (user pain + science) seen through the lens of what the user is actually trying to produce.

## Motivation

OpenReply today has eleven tabs (Insights, Bets, Evidence, Chat, Map, Report, Trends, Sentiment, Sources, Posts, Research) plus three new ones (Solutions, Concepts, Papers). Every audience — student, solopreneur, PM, UX designer, enterprise analyst — sees the same wall of tabs and has to *know* which sequence to run for their workflow. Symptoms:

- Students who'd use Papers + BibTeX export never find the Papers tab (it's in a More dropdown)
- Solopreneurs who'd use Concepts first see Insights (a more generic landing)
- PMs who attached a product can't tell which tab combines sweep+digest most usefully
- A first-time user hitting the topic page has no idea which deliverable the tool is supposed to produce

Fix: stop pretending every user has the same goal. Ask once at topic creation, route from there.

## Non-goals

- **Not** hiding features. Every tab stays accessible via the More dropdown. Intent is a lens, not a gate — power users ignore it.
- **Not** splitting into separate apps. Single codebase, single sidecar, single DB, single MCP — the fusion of pain + science stays the moat.
- **Not** per-role pricing. The monetization doc already defers tiering; intent routing is free in every tier.
- **Not** custom intents in v1. Five fixed presets. Add a 6th only when a user can't articulate their workflow in one of the five.
- **Not** an onboarding wizard. One radio group in the new-topic form, one badge on the topic page. No multi-step flow.

## The five intents

Chosen to cover the audiences already targeted in `2026-04-20-product-vision-agents.md` (solopreneur / UX designer / enterprise) plus the two that surfaced during paper-research work (student, PM of existing product).

### 1. `product-new` — Build a new product *(default)*

**Audience:** solopreneur, indie hacker, wantrepreneur
**Primary deliverable:** a concept brief — 3-5 product ideas citing real painpoints, with a build-cost tier and a differentiation thesis, exportable as a markdown one-pager
**Default tab on open:** Concepts
**Action ladder:**
1. Collect corpus (Reddit + HN + reviews)
2. Run Solutions pipeline (painpoints → why → science → interventions)
3. Generate concepts (Concept Agent)
4. Export brief (markdown / PDF)

**Secondary tabs:** Insights, Solutions, Papers (for evidence citations)

### 2. `product-improve` — Improve existing product

**Audience:** PM, solopreneur with a live product, small team lead
**Primary deliverable:** a signal-sweep digest — what users are complaining about / asking for since last check, ranked by impact
**Default tab on open:** Product Mode (Product Dashboard)
**Action ladder:**
1. Attach an existing product to this topic
2. Run product sweep (reviews + subs + HN)
3. Review signals (triage: address / snooze / ignore)
4. Generate weekly digest

**Secondary tabs:** Sentiment, Trends, Posts

### 3. `thesis` — Write a thesis / research paper

**Audience:** undergrad, grad student, independent researcher
**Primary deliverable:** a literature review — papers by citation count with tier grading, LLM-extracted claims, BibTeX bibliography
**Default tab on open:** Papers
**Action ladder:**
1. Collect corpus (auto-runs `research_papers` across 6 academic sources)
2. Run paper analysis (LLM extracts claims + tier)
3. Review painpoints / literature gap
4. Export bibliography (BibTeX / RIS / APA)

**Secondary tabs:** Solutions (for the Problem → Science chain), Insights

### 4. `ux-research` — UX research report

**Audience:** UX designer, user researcher, product designer
**Primary deliverable:** a research doc — personas, jobs-to-be-done, painpoint inventory with quotes, sentiment per source/segment
**Default tab on open:** Insights
**Action ladder:**
1. Collect corpus (multi-source, emphasis on Reddit + app reviews)
2. Run sentiment-by-source
3. Review painpoints + workarounds (Solutions tab)
4. Generate personas (uses existing Insights synthesis)

**Secondary tabs:** Sentiment, Posts, Papers (for research-backing)

### 5. `market-report` — Market research report

**Audience:** consultant, enterprise analyst, VC researcher
**Primary deliverable:** a premium report — Report Pro with citations, competitor matrix, trend analysis, opportunity ranking
**Default tab on open:** Report
**Action ladder:**
1. Collect corpus (aggressive mode — all sources + historical)
2. Run trends + sentiment-by-source
3. Build competitor matrix
4. Export Report Pro (citation-rich markdown → PDF)

**Secondary tabs:** Trends, Sources, Research (competitor table)

## Where intent lives

**Storage:** `topic_prefs.intent TEXT DEFAULT 'product-new'`

`topic_prefs` already exists (checked: `[topic PRIMARY KEY, scheduled, last_run_seen, last_run_ts, deleted_at]`). Adding one nullable column is a pure additive migration — no blast radius because nothing queries it today. Default value matches current behaviour exactly so old topics still work.

**Single source of truth:** `src/reddit_research/research/intents.py` — one dict mapping each intent key to its metadata (label, icon, default_tab, action_ladder, deliverable_button, secondary_tabs). Imported by CLI, MCP, and the UI loader. One file to change all five presets.

**Why not `topics` table?** We don't have one. Topics are a union of `topic_posts.topic` and `topic_prefs.topic` (see `list_topics` SQL at `app-tauri/src-tauri/src/commands.rs:pub async fn list_topics`). Creating a new table just for intent would be a bigger migration than bolting it onto the existing prefs table.

## UI changes

### 1. New-topic form (collect.js)

Adds a single radio group **above the topic-name field** (so users see it before they commit to a name):

```
What do you want from this research?
  ○ Build a new product        (default)
  ○ Improve existing product
  ○ Write thesis / research paper
  ○ UX research report
  ○ Market research report
```

Submitted alongside the topic name via `api.startCollect(topic, aggressive, sources, skipReddit, intent)`. Backend writes to `topic_prefs` before kicking off the fetch.

### 2. Topic page header (topic.js)

Adds a pill badge showing the intent, clickable to change:

```
[ 💡 Concepts · Build a new product ▾ ]     topic title
```

Clicking opens a tiny popup with the 5 options. Change is non-destructive (just rewrites `topic_prefs.intent`).

### 3. Action ladder card (topic.js)

New first element on the topic page, above the tab strip. Shows the 3-4 step action ladder for the current intent:

```
 ───── Your deliverable: Concept brief ─────
 ① Collect corpus     ✓ done (5,193 posts)
 ② Run Solutions      [ Run ]     — not started
 ③ Generate concepts  [ Locked ]  — needs Solutions
 ④ Export brief       [ Locked ]  — needs concepts
 ─────────────────────────────────────────
```

Each step reads the DB to check completion state and renders a locked / available / done chip. Clicking an available step invokes the existing command (same path Claude uses). No new logic — just orchestration.

### 4. Default tab routing

On topic open, if no `?tab=` query param and no session-stored last tab, pick the intent's `default_tab`. User's explicit navigation inside the tab strip still persists per session — intent only wins on **first open**. Preserves current power-user behaviour.

### 5. Tab reordering (minor)

Intents reorder which tabs appear in the main strip vs. More dropdown:

| Intent | Main strip tabs |
|---|---|
| product-new | Concepts · Solutions · Insights · Chat |
| product-improve | Product · Sentiment · Trends · Chat |
| thesis | Papers · Solutions · Insights · Chat |
| ux-research | Insights · Sentiment · Solutions · Chat |
| market-report | Report · Trends · Sources · Chat |

All other tabs move to More. Chat is universal (everyone uses it). User can still click any tab; intent just chooses what's most prominent.

## Backend changes

### Python layer

**New file**: `src/reddit_research/research/intents.py` — declarative preset dict:

```python
INTENTS: dict[str, dict[str, Any]] = {
    "product-new": {
        "label": "Build a new product",
        "icon": "rocket",
        "default_tab": "concepts",
        "main_tabs": ["concepts", "solutions", "insights", "chat"],
        "action_ladder": [
            {"key": "collect",  "label": "Collect corpus",      "check": "has_posts"},
            {"key": "solutions","label": "Run Solutions",       "check": "has_interventions"},
            {"key": "concepts", "label": "Generate concepts",   "check": "has_concepts"},
            {"key": "brief",    "label": "Export brief",        "check": "has_export"},
        ],
        "deliverable": "Concept brief",
    },
    # ... 4 more
}

def get_intent(key: str | None) -> dict[str, Any]:
    return INTENTS.get(key or "product-new", INTENTS["product-new"])

def set_topic_intent(topic: str, intent: str) -> None:
    db = get_db()
    db["topic_prefs"].upsert({"topic": topic, "intent": intent}, pk="topic")

def get_topic_intent(topic: str) -> str:
    row = db["topic_prefs"].get(topic) if topic in db["topic_prefs"] else None
    return (row or {}).get("intent") or "product-new"
```

**Migration**: `core/db.py::init_schema` — additive column:

```python
if "topic_prefs" in db.table_names():
    cols = {c.name for c in db["topic_prefs"].columns}
    if "intent" not in cols:
        db["topic_prefs"].add_column("intent", str)
```

**New CLI**: `reddit-cli research intents list|set|get [--topic T] [--intent K]` — debug/scripting surface.

### Tauri layer

**New commands** (`commands.rs`, register in `main.rs::generate_handler!`):

```rust
#[tauri::command]
pub async fn list_intents(app: AppHandle) -> Result<Value, String>   // presets
#[tauri::command]
pub async fn topic_intent_get(app: AppHandle, topic: String) -> Result<Value, String>
#[tauri::command]
pub async fn topic_intent_set(app: AppHandle, topic: String, intent: String) -> Result<Value, String>
```

Each shells out to the CLI via the existing `run_cli` plumbing. No new patterns.

**Modify**: `start_collect` accepts an optional `intent` param and calls `topic_intent_set` before kicking off the fetch.

### MCP layer (optional for v1)

Add `reddit_topic_intent_set(topic, intent)` and `reddit_topic_intent_list()` so Claude can set an intent when it creates a topic for the user. Low priority — v1 works without this and nobody will miss it.

## What gets reused vs. built new

| Component | Status |
|---|---|
| `topic_prefs` table | ✓ exists — add 1 column |
| `list_topics` SQL | ✓ unchanged — intent not part of listing yet |
| Concepts tab | ✓ built |
| Papers tab | ✓ built |
| Solutions tab | ✓ built |
| Product Mode dashboard | ✓ built |
| Report Pro export | ✓ built |
| Sentiment tab | ✓ built |
| Insights tab | ✓ built (personas synthesis lives here) |
| Concept brief export | ⚠ need to wire existing markdown export to the "Export brief" action ladder step |
| Persona synthesis | ⚠ exists in `research/insights.py` but not exposed as a prominent deliverable — needs a button |
| UX report deliverable | ⚠ same — research/insights.py synthesis exists, needs a dedicated "Export UX report" button |

**Net new code:** intent preset registry + migration + topic-prefs CRUD + UI chrome (badge, radio group, action ladder card).
**Net modified code:** `start_collect` signature, topic.js open logic, collect.js form.
**Zero changes to:** the collect pipeline, Solutions agent, Concept agent, Palace, graph, MCP paper tools, DB schema beyond +1 column.

## File-by-file audit

### Files to create

| Path | Lines | Purpose |
|---|---|---|
| `src/reddit_research/research/intents.py` | ~120 | Preset registry + CRUD helpers |
| `app-tauri/src/screens/intent_ladder.js` | ~180 | Action-ladder card renderer (reused by any tab that wants to show it) |
| `docs/superpowers/specs/2026-04-21-intent-layer.md` | this file | Spec |
| `changelogs/2026-04-21_08_intent-layer.md` | ~50 | Changelog entry |

### Files to modify

| Path | Approx diff | Purpose |
|---|---|---|
| `src/reddit_research/core/db.py` | +6 lines | Additive migration for `intent` column |
| `src/reddit_research/cli/main.py` | +70 lines | `research intents list/get/set` subcommands |
| `src/reddit_research/research/collect.py` | +4 lines | Accept + persist intent on collect |
| `app-tauri/src-tauri/src/commands.rs` | +50 lines | 3 new Tauri commands |
| `app-tauri/src-tauri/src/main.rs` | +3 lines | Register new commands |
| `app-tauri/src/api.js` | +8 lines | `listIntents`, `topicIntentGet`, `topicIntentSet` |
| `app-tauri/src/screens/collect.js` | +30 lines | Radio group in new-topic form |
| `app-tauri/src/screens/topic.js` | +90 lines | Badge, intent-driven default tab, action ladder mount, tab reorder |
| `app-tauri/src/style.css` | +60 lines | `.intent-badge`, `.intent-ladder*`, `.intent-step*` |

**Total new + modified:** ~670 lines across 9 files. Most of it UI chrome; Python + Rust total is ~130 lines.

## Time estimate

Assuming I'm building it — not a subagent, no review loops, proven-pattern tasks:

| Phase | Time | What |
|---|---|---|
| 1. Migration + intents.py | 15 min | Add column, write preset dict, CRUD helpers, unit-testable |
| 2. CLI subcommands | 10 min | `research intents {list,get,set}` — boilerplate mirroring existing patterns |
| 3. Tauri commands + main.rs + api.js | 15 min | 3 thin wrappers, same pattern as mcp_* commands |
| 4. intent_ladder.js (action ladder card) | 30 min | Completion-state probes (has_posts / has_interventions / has_concepts / etc.) + UI render |
| 5. collect.js radio group + wire through | 20 min | Form change + pass intent through `startCollect` |
| 6. topic.js badge + default tab + ladder mount | 25 min | New header element, default-tab logic, mount ladder above tab strip |
| 7. Tab reordering per intent | 15 min | Data-driven from `INTENTS[key].main_tabs` |
| 8. CSS | 20 min | Badge, ladder steps (done/available/locked), popup |
| 9. Verify (Python imports, cargo check, live click-through) | 15 min | Standard smoke pass |
| 10. Changelog + skill update | 10 min | Document + update `desktop-research-app-patterns` with intent-routing learning |
| **Total** | **~2h 55min** | Realistic single-session build |

Rough but honest. 30-min contingency for the inevitable "oh this tab doesn't self-identify completion state, need to add a probe" = **~3.5h end-to-end**.

## Risks + mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Intent column missing on legacy topics | Low — default value handles it | `get_topic_intent` returns `"product-new"` on missing row; UI shows default badge |
| Changing tab strip breaks user muscle memory | Medium — power users expect current order | All tabs remain accessible; intent-swap button easy to find; badge change is reversible |
| Completion-state probes are tab-specific (need a check per step) | Medium | Hard-code probes in `intent_ladder.js`; each probe is ~5 lines of SQL |
| Default `product-new` on migration silently re-brands old topics | Low | Badge is visible + editable; non-destructive |
| User picks wrong intent at creation, then sees "wrong" UI | Medium | Badge is one-click to change from anywhere on the topic page |
| Action ladder clicks invoke commands that fail (LLM key missing) | Low — same failure mode existing buttons already have | Each button surfaces the skip-reason same way today's buttons do |

## Audit: blast radius by subsystem

**Hot paths (touched):**
- Topic creation flow (`start_collect`) — adds one optional param
- Topic open (`topic.js`) — adds a header element + changes default tab pick
- New-topic form (`collect.js`) — adds a radio group

**Cold paths (untouched):**
- Fetch pipeline (posts, comments, sources) — zero changes
- Solutions Agent (`research/solutions_pipeline.py`) — zero changes
- Concept Agent (`research/concept.py`) — zero changes
- Palace (ChromaDB, embeddings) — zero changes
- Graph (nodes, edges, analysis) — zero changes
- MCP tools for fetch / search / papers — zero changes (optional intent MCP tool deferred)
- CLI for every existing command — zero changes
- Report Pro export — zero changes
- Product Mode (sweep, signals, digest) — zero changes

**DB migration risk:** minimal — one nullable column on a small prefs table. Zero impact on the 49 MB `reddit.db` (posts / comments / graph) because those aren't touched.

## Verification plan (before claiming done)

1. **Python side**: `.venv/bin/python -c "from reddit_research.research.intents import INTENTS, get_intent, get_topic_intent, set_topic_intent; print(list(INTENTS))"` returns 5 keys
2. **Migration**: existing DB file gets `intent` column on next `init_schema` call; `SELECT intent FROM topic_prefs LIMIT 1` returns NULL or "product-new"
3. **CLI**: `reddit-cli research intents list --json` → 5 presets; `reddit-cli research intents get --topic "calari tracking app"` → `product-new` (default); `reddit-cli research intents set --topic X --intent thesis` → updates; next `get` reflects
4. **Tauri**: `cargo check` clean; new commands in the handler list
5. **UI golden path**: open a topic → see badge → click badge → change intent to `thesis` → see Papers become default tab → see action ladder with correct 4 steps
6. **UI regression**: open an existing topic (created before the migration) → no crash, shows default intent `product-new`, behaves identically to today
7. **Collect flow**: start a new topic with `thesis` intent → first-open lands on Papers, not Insights

## Future extensions (deferred)

- **Custom intents** — let users define their own preset (label, default_tab, ladder). Wait until a user asks for a 6th that doesn't fit the existing five.
- **Intent-specific Concept Agent prompts** — tune the system prompt per intent (academic intent → cite papers more strictly; solopreneur → prefer lean differentiation). Current prompts are generic; no signal yet that this matters.
- **Telemetry by intent** — track which intent gets which engagement, which ladder steps users complete. Informs whether to add/merge presets.
- **Intent presets as deliverable templates** — ship a library of example topics per intent ("example: thesis on spaced repetition", "example: product-new for solopreneur") users can fork. Not needed for v1.
- **Intent-aware MCP recommendation** — Claude Code sees the intent via a new MCP tool and adapts its own research sequence. Neat but premature.

## Alignment with earlier docs

| Doc | Alignment |
|---|---|
| `2026-04-20-product-vision-agents.md` | Same three audiences (solopreneur, UX designer, enterprise) + two accidentally-found (student, PM). Intent layer is how those audiences FIND their own workflow without us building three separate products. |
| `2026-04-20-monetization-strategy.md` | Solopreneur-first slice unchanged; `product-new` is default. Pro/Team tier gating can later be per-intent (e.g. "market report" only in Pro) but **not** in v1. |
| `2026-04-21-mcp-app-integration.md` | MCP is audience-agnostic; intent doesn't change the MCP surface. Future optional MCP tool for reading intent is deferred. |
| `2026-04-21-monetization-strategy.md` (if updated) | Intent is the natural upsell seam — "unlock market-report intent for $39" — but we deliberately don't gate v1. |

## What this doc is NOT proposing

- Not proposing we rebuild the topic page
- Not proposing new tabs
- Not proposing new data sources
- Not proposing a role-based auth system
- Not proposing hiding or removing anything currently visible
- Not proposing pricing changes
- Not proposing a different backend

All of the above are potential *futures*. This spec is the **smallest change that adds per-topic deliverable routing**.
