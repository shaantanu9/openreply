# Changelog

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
