# Dual-Mode Pivot — Product Mode foundation (Phases A + B + C + F)

**Date:** 2026-04-20
**Type:** Feature — major

## Summary

Turns Gap Map from a one-shot topic-research tool into a **daily-use product
intelligence surface for PMs/CEOs**. Implements the core of
`docs/DUAL_MODE_PIVOT.md` Phases A–G, shipping:

- **Phase A:** Product / Competitor / Signal / Sweep entities (SQLite schema),
  onboarding branch ("exploring vs have-a-product"), registration wizard at
  `#/product/new/setup`, Products list at `#/products`, Products nav entry.
- **Phase B:** Per-product daily sweep engine (`daily_product_sweep`) that
  diffs the latest synthesis against the previous run and emits typed
  signals. Products Dashboard at `#/product/<id>` with 5 sections
  (The Mirror / The Lens / The Field / The Signals / The Hypotheses).
- **Phase C:** Six canonical typed signals
  (competitor_release · chronic_emergence · your_product_regression ·
  unmet_need_intensifying · competitor_vulnerability · mention_spike),
  each with severity + confidence + evidence + suggested_action. Action
  verbs on every signal: Acted · Convert to bet · Snooze 7d · Dismiss.
  Weekly markdown digest via clipboard (Mirror → Lens → Field → Top 3).
- **Phase F:** Topic → Product conversion — seeds a Product from an existing
  Topic's graph, auto-extracting competitors from `graph_nodes(kind in
  product/company/competitor)`.

## What's NOT shipped (explicitly deferred)

- **Phase D** — OAuth integrations (Intercom / Zendesk / Stripe) — requires a
  credential vault + real 3rd-party auth; not yet in architectural scope for
  a local-first desktop app.
- **Phase E** — Stripe billing + multi-user accounts — Gap Map is single-user
  local today. Requires an auth layer and a hosted/cloud component.
- **Phase G** — Shareable public links + Slack/email digest delivery —
  requires a backend. Digest ships as clipboard-copyable markdown instead.
- Native OS notifications on new high-severity signals — easy follow-up once
  a scheduled sweep runs via launchd cron (already scaffolded in schedule.rs).

See `docs/FEATURES.md` §15 for the full coverage map and recommended
validation-first approach before Phases D/E/G are scoped.

## Why this matters

A PM/CEO now has a reason to open Gap Map every morning:

1. Register their product + 3–10 competitors (10 min)
2. First sweep runs in the background
3. Next morning: dashboard shows "3 open signals, 1 high-severity"
4. They scan The Signals, convert the important one to a bet (jumps to
   Hypothesis Tracking — Phase 3)
5. Copy the weekly Slack digest on Monday

Typical session: 5–15 minutes. This is the retention shape DUAL_MODE_PIVOT
§1.2 describes — "operating system", not "consultant".

## Changes

### Python backend (~1200 lines new)
- `src/reddit_research/core/db.py` — 4 new tables (products,
  product_competitors, product_signals, product_sweeps) in init_schema,
  idempotent + additive.
- `src/reddit_research/research/product.py` — CRUD + `convert_topic_to_product`
- `src/reddit_research/research/signals.py` — 6 typed signal constructors +
  validation; pure builder (no side effects)
- `src/reddit_research/research/product_sweep.py` — `run_product_sweep`,
  `list_signals`, `signal_action` (with hypothesis-tracker side-effect for
  "Convert to bet"), `signal_counts`
- `src/reddit_research/research/product_digest.py` — weekly markdown digest
  compiler + structured `build_mirror_section` / `build_lens_section` /
  `build_field_section` helpers for the dashboard

### CLI (13 new Typer commands)
- `product-create`, `product-list`, `product-get`, `product-update`
- `product-add-competitor`, `product-remove-competitor`, `product-delete`
- `product-sweep` (runs the delta engine)
- `product-signals` (list open/resolved signals)
- `product-signal-action` (dismiss / snooze / acted / hypothesis)
- `product-digest` (plain markdown output — not JSON)
- `product-dashboard` (one-call fetch of all 5 sections)
- `product-convert-topic`

### Rust Tauri (13 new `#[tauri::command]`)
- `product_create / list / get / update / add_competitor /
  remove_competitor / delete / sweep / signals / signal_action / digest /
  dashboard / convert_topic`
- Registered in `main.rs::generate_handler!`
- `product_digest` handles plain-text stdout via the existing
  `parse_or_diagnostic` sentinel and re-wraps as `{ok, markdown}`.

### Frontend (~900 lines new)
- `app-tauri/src/api.js` — 13 new bindings + staleness cache keys
- `app-tauri/src/main.js` — 3 new routes (`/products`, `/product/:id`,
  `/product/:id/setup`), plus `api.productList()` fired at boot to populate
  the sidebar count
- `app-tauri/index.html` — new "Products" nav link with `package` icon
- `app-tauri/src/screens/product.js` — list, setup wizard, dashboard with 5
  sections, signal cards with 4 action verbs, convert-topic modal
- `app-tauri/src/screens/welcome.js` — step 1 now branches into "exploring"
  (existing 4-step wizard) or "have a product" (jumps to product setup)
- `app-tauri/src/screens/home.js` — new "Your products" card on Dashboard
  home (silent when empty)

### CSS
- `app-tauri/src/style.css` — complete Product Mode styling: products grid,
  setup wizard competitor rows, dashboard header, 5-section layout, signal
  cards with severity-colored left border, competitor rows, sweeps table,
  dashboard "Your products" card, and dark-mode overrides for all the above.

### Docs
- `docs/FEATURES.md` (earlier commit) — §15 coverage map already anticipates
  this. Will be updated in a follow-up to reflect Product Mode shipped state.

## Files Created

- `src/reddit_research/research/product.py`
- `src/reddit_research/research/signals.py`
- `src/reddit_research/research/product_sweep.py`
- `src/reddit_research/research/product_digest.py`
- `app-tauri/src/screens/product.js`
- `changelogs/2026-04-20_14_dual-mode-product-foundation.md`

## Files Modified

- `src/reddit_research/core/db.py` — +4 tables in `init_schema`
- `src/reddit_research/cli/main.py` — +13 Typer commands
- `app-tauri/src-tauri/src/commands.rs` — +13 Tauri commands
- `app-tauri/src-tauri/src/main.rs` — handler registry
- `app-tauri/src/api.js` — +13 bindings
- `app-tauri/src/main.js` — +3 routes + products count at boot
- `app-tauri/src/screens/welcome.js` — onboarding branch
- `app-tauri/src/screens/home.js` — "Your products" home card
- `app-tauri/index.html` — sidebar nav
- `app-tauri/src/style.css` — Product Mode styles + dark-mode overrides
