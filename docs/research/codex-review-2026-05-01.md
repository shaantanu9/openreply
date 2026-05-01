# Codex review — 2026-05-01 lifecycle + science catalog

## Scope

Two related but independently reviewable changesets shipped this session.
The branch (`multi-source`) has additional pre-existing uncommitted work
from prior sessions that is **out of scope** for this review.

### In scope

| # | Files | Net |
|---|-------|-----|
| 1 | `src/reddit_research/core/db.py` | `+33` lines — added idempotent `_ensure_lifecycle_schema()` migration |
| 2 | `src/reddit_research/research/product.py` | `+66` lines — `gate_set()` / `gate_get()` / `VALID_GATE_STATUSES` |
| 3 | `src/reddit_research/research/solutions.py` | `+31` lines — auto-runs Kano at tail of pipeline, surfaces JTBD statement |
| 4 | `src/reddit_research/research/kano.py` | NEW · 178 lines |
| 5 | `prompts/why.yaml` | adds `jtbd_statement` to JSON schema |
| 6 | `prompts/kano.yaml` | NEW · Kano-Model extractor prompt |
| 7 | `src/reddit_research/cli/main.py` | `+~50` lines — three new Typer commands |
| 8 | `app-tauri/src-tauri/src/commands.rs` | three new `#[tauri::command]` |
| 9 | `app-tauri/src-tauri/src/main.rs` | three new `generate_handler!` entries |
| 10 | `app-tauri/src/api.js` | three new wrappers + cache invalidation |
| 11 | `app-tauri/src/main.js` | route + import for `#/playbook` |
| 12 | `app-tauri/src/lib/tabs.js` | tab-strip icon for `/playbook` |
| 13 | `app-tauri/src/screens/solutions.js` | Kano badges, filter chips, JTBD statement, Re-run-Kano button |
| 14 | `app-tauri/src/screens/product.js` | Stage-Gate verdict bar + verdict pill on tiles |
| 15 | `app-tauri/src/screens/science.js` | 30 process cards across 7 groups + 6 new sources |
| 16 | `app-tauri/src/screens/playbook.js` | NEW · `+382` lines — 10-phase lifecycle screen |
| 17 | `app-tauri/src/style.css` | Kano badges · Stage-Gate row · Playbook layout · Science process cards |
| 18 | `app-tauri/index.html` | sidebar nav entry for Playbook |
| 19 | `changelogs/2026-05-01_02_lifecycle-pivot-jtbd-kano-stagegate-playbook.md` | NEW |
| 20 | `changelogs/2026-05-01_03_science-screen-process-catalog.md` | NEW |

### Out of scope (pre-existing uncommitted work, NOT mine)

- `act_suit/activation-suite/src/components/marketing/HeroSlider.tsx`
- `app-tauri/.gitignore`, `app-tauri/README.md`, `app-tauri/package.json`
- `app-tauri/src-tauri/src/cli.rs`, `app-tauri/tauri.conf.json`
- `app-tauri/src/lib/screenCache.js`
- `app-tauri/src/screens/collect.js`, `home.js`, `ingest_video.js`, `papers.js`, `topic.js`
- `app-tauri/src/screens/collects.js` (untracked)
- `app-tauri/src/components/` (untracked)
- `app-tauri/scripts/` (untracked)
- `pyproject.toml`
- `src/reddit_research/mcp/server.py`
- All earlier 2026-04-29 / 2026-04-30 / 2026-05-01_01 changelogs
- `src/reddit_research/research/_doc_assets/`, `_doc_design.py`,
  `export_deck.py`, `paper_chunks.py`, `paper_fulltext.py`,
  `paper_pipeline.py`, `paper_references.py`, `paper_sections.py`,
  `tactic_library.py` (all untracked, pre-existing)
- `src/reddit_research/retrieval/embedder_mlx.py` (untracked, pre-existing)
- `src/reddit_research/mcp/jobs.py`, `logger.py` (untracked, pre-existing)
- `scripts/ingest_marketing_books.py`, `scripts/mcp_doctor.sh`, `scripts/mcp_http_daemon.sh` (untracked, pre-existing)

The diffstat reported earlier (`commands.rs +546`, `science.js +773`, etc.)
includes pre-existing uncommitted work too. To isolate **only** this
session's changes, diff against the file's blob at
`HEAD` for the named lines below — none of the touched regions overlap
with the pre-existing uncommitted hunks except by file identity.

## What to focus on

### Risk areas that warrant the most attention

1. **Schema migration idempotency (`db.py`).** `_ensure_lifecycle_schema()`
   uses `db["products"].add_column()` wrapped in try/except per column —
   does this pattern match the existing `_ensure_extraction_prefs_schema`?
   Verify: pre-existing installs without these columns gain them; installs
   that already have them are silent no-ops. Already round-trip-tested on
   a fresh tmp DB, but a second eye on the failure modes is welcome.

2. **`gate_set()` validation surface (`product.py`).**
   - `VALID_GATE_STATUSES = ('', 'go', 'kill', 'hold', 'recycle')` —
     accepts empty string as "clear". Acceptable per Cooper's
     Stage-Gate semantics (verdict can be retracted).
   - Notes truncated to 1000 chars. Reasonable, but is there an existing
     convention in the codebase we should match instead?

3. **Kano pipeline non-fatal failure handling (`solutions.py`).**
   The Kano post-pass is wrapped in a bare `try/except`. Is silent failure
   the right behavior here, or should we surface a degraded-mode signal
   to the UI?

4. **Tauri command registration triangle.** Per the
   `tauri-python-sidecar-app` skill, every command must be:
   - Defined in `commands.rs` (`#[tauri::command]` — 3 added)
   - Registered in `main.rs` (`generate_handler!` — 3 added)
   - Wrapped in `api.js` (`invoke('...')` — 3 added)
   - Have a matching CLI subcommand (`cli/main.py` — 3 added)
   Audit the four lists for parity. `cargo check` passes.

5. **JS files not in TypeScript.** `solutions.js`, `product.js`,
   `science.js`, `playbook.js` are vanilla ES modules — no type system
   to lean on. All four pass `node --check`. Look for runtime bugs the
   syntax check can't catch (e.g. cached DOM refs going stale across
   tab switches — there's a route-gen guard on `science.js` already).

6. **CSS naming collisions.** New classes I introduced:
   `kano-must_be / performance / attractive / indifferent / reverse`,
   `pd-gate-bar / pd-gate-row / pd-gate-buttons / pd-gate-btn /
   pd-gate-active / pd-gate-go / pd-gate-kill / pd-gate-hold /
   pd-gate-recycle / pd-gate-current / pd-gate-notes / pd-gate-meta /
   pd-gate-label`, `pb-wrap / pb-intro / pb-phase-list / pb-phase-card /
   pb-phase-head / pb-phase-icon / pb-phase-num / pb-phase-title /
   pb-phase-sub / pb-phase-fws / pb-fw-chip / pb-phase-overview /
   pb-phase-section / pb-deliverables / pb-deliv / pb-links / pb-link /
   pb-checks / pb-fw-panel / pb-fw-grid / pb-fw-card / pb-fw-name /
   pb-fw-creator / pb-fw-use`, `science-group / science-group-head /
   science-process-grid / science-process-card / science-process-icon /
   science-process-title / science-process-short /
   science-process-toggle / science-process-body /
   science-process-where / science-where / science-process-cite`,
   `jtbd-statement`, `kano-filter / kano-chip / kano-badge`. Verify
   none collide with pre-existing classes.

### Prompts (`prompts/why.yaml`, `prompts/kano.yaml`)

- `why.yaml` schema now has both `jtbd` (object) and `jtbd_statement`
  (string). Old extracted rows have only `jtbd`; the new rendering code
  treats `jtbd_statement` as optional (`||` fallback). Backward-compat
  preserved.
- `kano.yaml` is new. The Kano categories (`must_be / performance /
  attractive / indifferent / reverse`) are validated against
  `VALID_KANO` in `kano.py` so an LLM hallucination falls back to a
  no-op instead of corrupting `metadata_json`.

### Verification already performed

- `uv run python` import smoke-test: `kano`, `product`, `solutions`,
  `cli.main` all import cleanly.
- Schema migration round-trip on a fresh tmp DB: `gate_set('go', '...')` →
  `gate_get` → `gate_set('', '')` → `gate_get` all round-trip correctly.
- `kano.categorize_topic('does-not-exist')` is graceful.
- `cargo check` passes.
- `node --check` passes on all 7 touched JS files.
- `uv run reddit-cli research --help` lists all 3 new commands.
- CodeGraph re-synced.
- Pre-existing test failure (`avatarInitials: single token`) and pre-existing
  build error (`CollectReconCard.js` untracked) verified unrelated via
  `git stash` regression check on main.

## How to view only this session's diff

The simplest path: there are no commits yet for this session, so the
review is against the working tree. The full surface lives in the 20
files in the **In scope** table above, all under file paths anchored
at the repo root.

If you'd prefer per-feature commits instead of one bundle, three are
natural:

1. Lifecycle schema + JTBD prompt + Kano + Stage-Gate (Python side)
2. Tauri commands + api.js wiring (Rust + JS bridge)
3. UI: Playbook screen + Solutions Kano UI + Stage-Gate UI + Science
   process catalog

Let me know which split — or one bundled commit — Codex prefers.
