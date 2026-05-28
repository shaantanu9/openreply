# Changelog

## [v0.1.1 — 2026-05-28] · Graphify-pattern port + perf

Ported the high-value patterns from the external `graphify` tool into our
own knowledge graph (`src/gapmap/graph/`). Additive only — every existing
command behaves identically; the new artifacts sit alongside.

### New artifacts (additive)

- **Edge confidence provenance** — every edge now carries `EXTRACTED`
  (deterministic SQL join), `INFERRED` (LLM enrichment or strong
  structural signal like shared evidence), or `AMBIGUOUS` (cosine-only
  with no corroboration) in `metadata_json`. One-shot
  `graph backfill-confidence` tags pre-existing rows.
- **Leiden community detection** — `graph communities` runs Leiden
  (graspologic) with Louvain fallback, hub exclusion, oversized-community
  splitting, and tiny-community filtering. Persists `community_id` into
  node metadata so the viewer can colour and the report can surface
  surprising connections.
- **GRAPH_REPORT.md** — `graph report` emits an 8-section markdown audit
  per topic: corpus check · edge-confidence breakdown · god nodes ·
  communities · surprising connections · knowledge gaps · cross-source
  bridges · cost summary.
- **Insight queries** — `graph insights --section all` exposes four
  pure-read lenses: surprising_connections (edges across communities),
  knowledge_gaps (painpoints with no candidate solver), cross_source_bridges
  (findings triangulated across ≥3 sources), god_nodes (top semantic-kind
  nodes by degree).
- **Cost ledger** — `graph cost` reads a JSONL ledger at `data/cost/<topic>.jsonl`
  with per-call provider/model/tokens/USD. 13 models pre-priced.
- **D3 viewer lenses** — the exported HTML viewer gains a right-rail
  control strip: search box · ⚡ Surprising (highlight cross-community
  edges) · 🕳 Gaps (highlight unsolved painpoints) · 🌉 Bridges
  (highlight ≥3-source findings) · ⊕ confidence cycle · 🎨 Communities
  (per-node community-color ring). Edges restyled by confidence (solid
  / dashed / dotted+faded).
- **Backup-on-edit** — `research repair-topic-graph` now snapshots the
  topic's nodes+edges to `data/backups/<slug>_<ts>.json` before delete.
  `--no-backup` to opt out.
- **NFKC ID normalization** — `make_node_id` folds unicode equivalents
  so "Café" written two ways can't dupe.

### Performance (measured on a 5,633-node / 12,254-edge topic)

| Operation | Before | After | Speedup |
|---|---|---|---|
| `knowledge_gaps` | 188 s | 5.6 ms | **33,657×** |
| `build_nx` warm cache hit | 394 ms | 3.5 ms | **112×** |
| `detect_communities_leiden` (skeleton) | 1,136 ms | 26 ms | **44×** |
| `cross_source_bridges` | ~10 ms | 0.3 ms | 33× |
| `detect_communities_leiden` (full) | 2,555 ms | 597 ms | 4.3× |

Achieved via: skeleton-only clustering default (clusters the ~300 nodes
the viewer renders, not all 5K+) · 4 JSON-expression indexes on
`metadata_json` hot paths · composite `(topic, kind)` index on
`graph_edges` · `ANALYZE` after schema bump · correlated-`NOT EXISTS`
rewrite to two flat queries · in-process `build_nx` memoization keyed
by `(topic, max_ts | node_count | edge_count)`.

### One-time migration cost

First `ensure_graph_schema()` call after upgrade materializes the new
JSON-path indexes (~1–2 minutes for a typical topic, single time).
After that, every insight + report call is single-digit ms.

### CLI commands added

```bash
gapmap research graph backfill-confidence --topic "<t>"   # one-shot
gapmap research graph communities         --topic "<t>"
gapmap research graph report              --topic "<t>"
gapmap research graph insights --section all --topic "<t>"
gapmap research graph cost                --topic "<t>"
```

### Files touched

11 source files (5 new modules: `communities.py`, `insights.py`,
`report.py`, `cost.py`, ~700 new lines in `export.py` for the viewer
upgrades; modified: `__init__.py`, `schema.py`, `build.py`, `semantic.py`,
`relations.py`, `analyze.py`, `cli/main.py`). Two per-change markdown
notes in `changelogs/2026-05-28_*.md`. No schema column changes — all new
state lives inside existing `metadata_json` blobs.

---

## [v0.1.0 — 2026-05-12]

First public release. Multi-source research gap finder ships as a signed
+ notarized macOS DMG (arm64 + x86_64). Distribution via GitHub Releases
plus mirrored to the marketing site.

### Highlights

- **Multi-source corpus** — Reddit + HN + arXiv + GitHub + Stack Overflow
  + Dev.to + Google News + Google Trends + Play Store + App Store +
  PubMed + Bluesky + Substack + ProductHunt unified into one searchable
  topic-scoped SQLite corpus.
- **Audience personas from real users** — clusters real authors per
  topic into citation-backed ICP personas. Auto-builds on collect:done.
- **Iterate / autoresearch loop** — Karpathy-style config-grid sweeper
  that writes the winning combo back as a per-topic override.
- **Improve pipeline** — one-click guided runner (audience → synthesize
  → deliberate → launch) with per-topic best configs applied.
- **Launch & GTM** — audience + demographics + channels + MVP + pricing
  + sequence, per topic.
- **Idea scan** — corpus scan → gap synthesis → opportunity ranking.
- **Persona phase 4** — meta-agent ingest, orchestra dashboard,
  contradiction detection, teach-from-video.
- **Lifecycle UI** — JTBD + Kano + Stage-Gate + Playbook + Science
  catalog + Empathy maps + Interviews + PMF + Pricing + PERT + PRD.
- **Performance** — native rusqlite read path (Rust opens WAL-mode DB
  directly, sidecar spawn cost 30-70s → sub-10ms), long-running Python
  sidecar daemon, stale-while-revalidate localStorage cache on every
  per-tab loader, dense graph relations post-pass.
- **DMG packaging** — Info.plist with `gapmap://` URL scheme + usage
  descriptions, hardened-runtime entitlements for PyInstaller, ONNX
  embedding model bundled (offline-first semantic search), ad-hoc
  signed sidecar for Gatekeeper-cache warmup, multi-arch ffmpeg fetch.

### Known limitations shipped

- Linux + Windows builds in the release matrix are unsigned and ffmpeg
  sidecar absent on those platforms (ingest-video degrades).
- Tauri auto-updater not yet wired — manual download per release.
- Mac App Store path is not pursued (sandbox incompatible with the
  Python sidecar + arbitrary user-data writes).

### Build / release infrastructure

- `release.yml` GitHub Actions workflow — arm64 + x86_64 macOS DMGs +
  Linux deb/AppImage + Windows MSI, drives Apple notarization via
  tauri-action.
- `scripts/publish-mac.sh` — local one-button DMG build with --sign.
- `scripts/finish-publish.sh` — resumer for after Apple cert lands.
- `docs/manual-todo/publish-macos.md` — 9-step manual checklist.
- 91 passing tests, 3 skipped (Reddit creds / Ollama / slow).

## [2026-04-27a]
Marketing corpus + tactic-library foundation for insights.

### Added
- `src/gapmap/research/tactic_library.py`
- `data/tactics_seed.json`
- `scripts/ingest_marketing_books.py`
- `CHANGELOG.md`

### Changed
- `src/gapmap/sources/rss_catalog.py`
- `src/gapmap/sources/collect_adapter.py`
- `src/gapmap/cli/main.py`
- `app-tauri/src/screens/topic.js`
- `src/gapmap/research/insights.py`
- `app-tauri/src/screens/insights.js`
- `app-tauri/src/style.css`

## [2026-04-27b]
Closed remaining proposal gaps with persistence and robustness.

### Changed
- `src/gapmap/graph/semantic.py`
- `src/gapmap/research/tactic_library.py`
- `src/gapmap/research/sentiment_by_source.py`
- `src/gapmap/graph/build.py`
- `scripts/ingest_marketing_books.py`
- `data/tactics_seed.json`

## [2026-04-27c]
Added a structured paper-writing + experiment pipeline with CLI and MCP access.

### Added
- `src/gapmap/research/paper_pipeline.py`

### Changed
- `src/gapmap/cli/main.py`
- `src/gapmap/mcp/server.py`
- `CHANGELOG.md`

## [2026-04-27d]
Wired paper-pipeline actions into the Report tab UI and Tauri invoke bridge.

### Changed
- `app-tauri/src/api.js`
- `app-tauri/src/screens/topic.js`
- `app-tauri/src-tauri/src/commands.rs`
- `app-tauri/src-tauri/src/main.rs`
- `CHANGELOG.md`

## [2026-05-01a]
Fixed warm-daemon LLM settings reload so newly saved NVIDIA defaults are picked up without restarting the app.

### Added
- `tests/test_cli_daemon_env.py`

### Changed
- `src/gapmap/cli/main.py`
- `CHANGELOG.md`
