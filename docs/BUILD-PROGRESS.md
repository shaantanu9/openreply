# Gap Map — Build Progress Tracker

> Durable cross-session log so we keep track across context compactions.
> **Goal:** make Gap Map a *complete* pre-build product-discovery tool — everything a
> PM/founder does to find a market gap and judge it **before** building.
> Companion docs: `FEATURES.md` (live feature catalog), `docs/PRODUCT-DISCOVERY-COVERAGE.md`
> (framework gap analysis), `CHANGES-2026-06.md` (changelog). **Updated:** 2026-06-06.

---

## ✅ Done (this session, 2026-06)

### Sources & collection
- **Reddit restored** — `.json` API now 403-blocks all unauthenticated requests (2026 policy).
  Rewrote `public_client.py` to RSS feeds (no-auth, still work) + read-only OAuth (PRAW
  `read_only`, BYOK client_id+secret = 100 req/min). Re-added back-compat `_get` so
  `discover.py` import didn't break the whole sidecar.
- **New sources added & wired:** Stack Exchange ×8 (`run_stackexchange`), Europe PMC
  (`europepmc.py`), DBLP (`dblp.py`), Steam reviews (`steam.py`); Bluesky fixed (app-password).
  All in `collect_adapter.py` SOURCES dispatch + `topic.js` ALL_SOURCES picker + BYOK fields.
- **Paper full-text pipeline** — PDF download+extract→cache→`paper_full_texts`; chat splices
  intro+conclusions; auto-prefetch on collect:done. Source list broadened across the stack
  (arxiv, openalex, semantic_scholar, scholar, pubmed, europepmc).

### Prioritization (Phase A — shipped)
- `research/prioritize.py` + `research prioritize` CLI + Rust `prioritize_get`/`prioritize_score`
  + `api.js` + **Prioritize tab** (`screens/prioritize.js`) — RICE/Kano/MoSCoW ranked table.

### Screen-completion workflow (8 modules 🟡→✅)
- OST (orphan/unlinked + severity), PMF (real n_scored denominator), Pricing (Van Westendorp
  range + response tables), PRD (sparse-state + copy/download), Empathy (JTBD grid + persona
  switcher + XSS fix), Intents, Iterate, Interviews. All vite-verified + committed.

### Website (gapmap.myind.ai)
- Login-aware navbar (SignedInOnly/SignedOutOnly), clean app-home, download button for
  logged-in users, uncached /download retry on asset-miss. Deployed.

### Release
- **v0.1.21** signed + notarized, all platforms, drift-guard verified (signing_fp 6713fd9ce909).

### Activation hardening
- delete→recreate→activate made reliable: `auth.users` AFTER DELETE trigger
  `cleanup_email_keyed_on_auth_delete`; e2e-verified. (Earlier misdiagnosis of
  `normalizeActivationKey` reverted — original hashes were correct.)

### Tracker
- `FEATURES.md` now reconciles: **190 features · 173 ✅ · 17 🟡**.

---

## 🚧 In progress / next (do NOT cut v0.1.22 yet — user: "dont cut the tag")

### Phase E/F/G — NEW strategy frameworks ✅ SHIPPED (2026-06-06)
Built via workflow (isolated cores+screens) + central wiring. Foundation:
`research/strategy_common.py` (topic-keyed `strategy_artifacts` store + LLM-JSON
+ evidence bundler). Build-verified: python CLI returns JSON, vite 1797 modules,
cargo 0 errors. Each: `research <name> [--compute]` CLI, Rust `<name>_get/_compute`
(Porter → `porter_forces_*` to avoid the product-level `porter_get`), api.js
get/compute, topic.js tab + loader.

| Framework | Core module | Screen | Tab | Status |
|---|---|---|---|---|
| **TAM/SAM/SOM** market sizing (+ market value) — P0 | `research/market_sizing.py` | `screens/market.js` | Market | ✅ |
| **Porter's Five Forces** | `research/porter.py` | `screens/porter.js` | Five Forces | ✅ |
| **SWOT** (auto-synth from gaps + competitors) | `research/swot.py` | `screens/swot.js` | SWOT | ✅ |
| **Lean Canvas** (9 blocks, seeded from painpoints) | `research/lean_canvas.py` | `screens/lean_canvas.js` | Lean Canvas | ✅ |
| **Value Proposition Canvas** | `research/value_prop.py` | `screens/value_prop.js` | Value Prop | ✅ |
| **North-Star metric** | `research/north_star.py` | `screens/north_star.js` | North Star | ✅ |

> UX note: each tab loads the cached artifact instantly; the first time it shows
> a "Generate" button that runs the LLM synthesis (~30–60s) grounded in the
> topic's collected evidence, then renders + caches. Needs an LLM key + a built
> gap map (collect + extract) for the topic first.

### Remaining 🟡 to finish — ✅ ALL DONE (2026-06-06)
- ✅ Why (root-cause / 5-whys) — new `research/root_cause.py` + `root_cause.js` + CLI/Rust/api/**Root Cause** tab
- ✅ Sentiment-by-source charts — per-source comparison charts added to `sentiment.js`
- ✅ Tactic library — `tactics_for_topic()` + `tactics.js` + CLI/Rust/api/**Tactics** tab
- ✅ Hypothesis tracker — dedicated `hypotheses.js` screen (status pills + update/delete) on existing Rust+api
- ✅ PERT — MCP tools `gapmap_pert_list/add_task/rollup`
- ✅ Idea scan — MCP tools `gapmap_idea_scan_start/get/list`
Build-verified: CLI returns JSON, vite 1800 modules, cargo 0 errors. FEATURES.md cat-14 → 18/18 ✅.

### State (2026-06-06)
- **FEATURES.md: 196 · 190 ✅ · 6 🟡.** Cat-14 (advanced analysis) + cat-17 (strategy) fully done.
- Only 🟡 left = 6 cat-15 Tauri screens (viz/polish, not breakage): Graph faceted filtering,
  Insights deliberation tiers, Personas polish, Global-Competitors detail, OST 2×2 matrix,
  Bets/Tasks/Activity UI.

### Cross-cutting (still open, P2)
- Expose remaining cat-14 + the 6 cat-17 frameworks + new collect-only sources
  (stackexchange/europepmc/dblp/steam) as **MCP tools** so Claude Code drives the whole funnel headlessly.
- Add persona-module tests.
- The 6 cat-15 viz/polish screens.

---

## Canonical patterns (for new modules — mimic these)
- **Core:** `src/gapmap/research/prioritize.py` — `get_db()`, read `graph_nodes`/`graph_edges`
  filtered by `topic`, parse `metadata_json`, pure-read never-raises, return a dict.
- **Painpoints/competitors live in** `graph_nodes` by `kind` ('painpoint','intervention','competitor');
  edges in `graph_edges` (src/dst/topic).
- **Screen:** `app-tauri/src/screens/prioritize.js` — `esc()` everything, `alive()` tab guard,
  empty-big state with a "go build prerequisite" button, lucide icons via `window.refreshIcons()`.
- **Wiring triangle:** `cli/main.py` (command) → `commands.rs` (#[tauri::command]) →
  `main.rs` generate_handler → `api.js` invoke → `topic.js` tab button + loader.

## Build invariants
- Run `graphify update .` after code changes.
- After each completion: flip FEATURES.md status + bump summary table (must reconcile) + changelog.
- Don't cut the release tag until user says so.
