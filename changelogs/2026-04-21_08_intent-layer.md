# Intent Layer — per-topic deliverable routing

**Date:** 2026-04-21
**Type:** Feature

## Summary

Implements the spec at `docs/superpowers/specs/2026-04-21-intent-layer.md`. Adds one nullable column (`topic_prefs.intent`) and a preset registry (5 intents: product-new / product-improve / thesis / ux-research / market-report). Every topic now opens to the tab that serves its deliverable and shows a 3-4 step "action ladder" card above the tab strip. New-topic modal asks the intent up front via a pill picker.

Pure additive. Zero schema redesign, zero pipeline changes, zero MCP-surface changes. Every tab remains accessible — intent is a lens, not a gate.

## Verified live

Against the real app DB (`~/Library/Application Support/com.shantanu.openreply/reddit-myind/`):

- 5 presets register cleanly: product-new (→ concepts), product-improve (→ product), thesis (→ papers), ux-research (→ insights), market-report (→ report)
- `research intent-set --topic "Indian student exam stress" --intent thesis` → updates in place
- `research intent-get --topic "Indian student exam stress" --json` returns default_tab=papers, 4-step ladder, completion detects has_posts + has_papers as done (topic has 402 posts + academic papers)
- `cargo check` clean
- All JS files parse

## Files Created

- `src/reddit_research/research/intents.py` — preset registry (5 intents), CRUD helpers (`get_topic_intent`, `set_topic_intent`), completion-state probes
- `app-tauri/src/screens/intent_ladder.js` — action-ladder card renderer, intent-swap popup, step-click handlers that map to existing commands
- `docs/superpowers/specs/2026-04-21-intent-layer.md` — full spec
- `changelogs/2026-04-21_08_intent-layer.md` — this entry

## Files Modified

- `src/reddit_research/core/db.py` — additive migration (`ALTER TABLE topic_prefs ADD COLUMN intent TEXT DEFAULT 'product-new'`)
- `src/reddit_research/cli/main.py` — 3 new subcommands: `research intents`, `research intent-get`, `research intent-set`
- `app-tauri/src-tauri/src/commands.rs` — 3 thin Tauri wrappers (`list_intents`, `topic_intent_get`, `topic_intent_set`)
- `app-tauri/src-tauri/src/main.rs` — registered the 3 commands in `generate_handler!`
- `app-tauri/src/api.js` — `listIntents` (cached), `topicIntentGet`, `topicIntentSet`
- `app-tauri/src/screens/topic.js` — mounts `intent_ladder.js` above tab strip, switches default tab based on intent, falls back cleanly to 'insights' on any failure
- `app-tauri/src/main.js` — intent pill picker in new-topic modal; picks are persisted to localStorage; `topicIntentSet` called before the collect kicks off
- `app-tauri/index.html` — `<div class="modal-intent">` added to new-topic modal
- `app-tauri/src/style.css` — `.intent-ladder*`, `.intent-step*`, `.intent-swap*`, `.modal-intent`, `.intent-pill` styling (~140 lines)

## Design

### The 5 intent presets

| Key | Label | Default tab | Deliverable | Action ladder |
|---|---|---|---|---|
| `product-new` *(default)* | Build a new product | Concepts | Concept brief | Collect → Solutions → Concepts → Export brief |
| `product-improve` | Improve existing product | Product | Weekly digest | Collect → Attach product → Sweep → Digest |
| `thesis` | Write thesis / research paper | Papers | Literature review + BibTeX | Collect papers → Analyze (LLM) → Link to painpoints → Export BibTeX/APA |
| `ux-research` | UX research report | Insights | UX research report | Collect → Sentiment by source → Painpoints + JTBD → Synthesize personas |
| `market-report` | Market research report | Report | Report Pro (citation-rich) | Collect (aggressive) → Trends + sentiment → Competitor matrix → Export Report Pro |

### Completion state

Every step's "done" chip comes from a live SQL probe in `completion_state()`:

- `has_posts`            — `topic_posts` row count > 0
- `has_papers`           — academic-source posts tagged to topic > 0
- `has_interventions`    — `graph_nodes kind='intervention'` > 0
- `has_concepts`         — `graph_nodes kind='concept'` > 0
- `has_sentiment`        — `graph_nodes kind='source_sentiment'` > 0
- `has_insights`         — `graph_nodes kind='insight'` > 0
- `has_paper_analyses`   — `paper_analyses` row count > 0
- `has_product`          — `products` row for this topic
- `has_signals`          — `product_signals` for attached product
- `has_trends_or_sentiment` — OR of above two
- `has_competitors`      — `graph_nodes kind='product'` > 0
- `has_brief_export` / `has_bibtex_export` / `has_report_pro_export` — `exports` table if present

Missing tables return False (graceful on older installs).

### UI behaviour

- **Ladder card** renders at the top of every topic page. Each step shows ✓ done (green), ▶ available (primary button), or 🔒 locked (greyed — waits for prior step).
- **Clicking an available step** either switches to the owning tab OR invokes the existing command directly (e.g. "Export brief" calls `export_brief`).
- **Intent badge** inside the ladder header is clickable. Opens a popup listing all 5 presets with tagline; picking one rewrites `topic_prefs.intent` via `topic_intent_set`.
- **First-open default tab** comes from the intent's preset. User's explicit tab navigation inside the session still wins (intent only chooses the landing).
- **New-topic modal** shows a 5-pill picker above the topic-name input. Last-picked intent persists in localStorage so the next new topic defaults to it. Hidden gracefully if `listIntents()` fails (pre-restart dev path).

### Storage

Single column on `topic_prefs`:

```
ALTER TABLE topic_prefs ADD COLUMN intent TEXT DEFAULT 'product-new'
```

Pure additive. Pre-migration topics default to `'product-new'` → identical behaviour to before the change. Soft-delete column (`deleted_at`) gets the same treatment — both are additive migrations guarded by `try/except` so schema init is idempotent.

## Vision alignment

| Pillar | Status |
|---|---|
| Problem → Why → Science → Solution pipeline | ✓ unchanged |
| Concept Agent | ✓ unchanged |
| Product Mode | ✓ unchanged |
| Solopreneur-first monetisation | ✓ unchanged — default intent is `product-new` |
| Fusion of user pain + science | ✓ strengthened — every audience now FINDS its workflow on first open |
| MCP surface | ✓ unchanged |
| Palace + graph + chat | ✓ unchanged |
| DB schema | ✓ one nullable additive column |

**Not a pivot. An onboarding layer.** Every audience sees its own workflow the first time it opens a topic — students land on Papers, PMs on Product Mode, solopreneurs on Concepts — without anyone losing access to anything.

## Restart required

`tauri dev` must be restarted to pick up the 3 new Rust commands (`list_intents`, `topic_intent_get`, `topic_intent_set`). Symptom of skipping: intent picker pills hidden gracefully (api.listIntents() returns []), action ladder card quietly absent — everything still works exactly as pre-migration.

## Line counts (actual vs. estimated)

| Subsystem | Estimated | Actual |
|---|---|---|
| `intents.py` | 120 | 235 (extra probe logic for Product Mode) |
| Migration | 6 | 5 |
| CLI | 70 | 58 |
| Tauri commands | 50 | 27 |
| main.rs | 3 | 5 |
| api.js | 8 | 5 |
| `intent_ladder.js` | 180 | 205 |
| `main.js` (modal) | 30 | 50 |
| `index.html` | — | 8 |
| `topic.js` | 90 | 25 (lighter than estimated — reused existing switchTab) |
| `style.css` | 60 | 140 (more polish for ladder + pills + swap popup) |
| **Total** | **670** | **~760** |

~15% over estimate — mostly CSS polish and extra completion-state probes for Product Mode tables. Well within the 30-min contingency budget.
