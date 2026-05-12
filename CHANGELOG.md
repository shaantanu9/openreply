# Changelog

## [2026-04-27a]
Marketing corpus + tactic-library foundation for insights.

### Added
- `src/reddit_research/research/tactic_library.py`
- `data/tactics_seed.json`
- `scripts/ingest_marketing_books.py`
- `CHANGELOG.md`

### Changed
- `src/reddit_research/sources/rss_catalog.py`
- `src/reddit_research/sources/collect_adapter.py`
- `src/reddit_research/cli/main.py`
- `app-tauri/src/screens/topic.js`
- `src/reddit_research/research/insights.py`
- `app-tauri/src/screens/insights.js`
- `app-tauri/src/style.css`

## [2026-04-27b]
Closed remaining proposal gaps with persistence and robustness.

### Changed
- `src/reddit_research/graph/semantic.py`
- `src/reddit_research/research/tactic_library.py`
- `src/reddit_research/research/sentiment_by_source.py`
- `src/reddit_research/graph/build.py`
- `scripts/ingest_marketing_books.py`
- `data/tactics_seed.json`

## [2026-04-27c]
Added a structured paper-writing + experiment pipeline with CLI and MCP access.

### Added
- `src/reddit_research/research/paper_pipeline.py`

### Changed
- `src/reddit_research/cli/main.py`
- `src/reddit_research/mcp/server.py`
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
- `src/reddit_research/cli/main.py`
- `CHANGELOG.md`
