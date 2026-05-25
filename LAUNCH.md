# Gap Map — Launch Readiness

> Last updated: 2026-05-16. Based on codebase inspection + changelogs. Items not personally verified in a live run are marked 🟡.

---

## Desktop App (Gap Map.app)

| Item | Status | Notes |
|---|---|---|
| Multi-source collect (13+ sources, 6-worker parallel) | ✅ | Reddit, HN, arXiv, PubMed, OpenAlex, Semantic Scholar, Crossref, GitHub, App Store, Play Store, Google News, Trends, Dev.to, SO, YouTube, RSS, Bluesky, Lemmy, Mastodon, Wikipedia, Trustpilot, AlternativeTo, ProductHunt |
| LLM synthesis — Insights tab (Minto + Ulwick + deliberation) | ✅ | 8 providers, per-provider corpus caps, persisted to `topic_insights` |
| Paper research pipeline (search → fulltext → chunk → analyze) | ✅ | 6 academic sources, Palace chunk search |
| Knowledge graph (structural + semantic + relations) | ✅ | PageRank, Louvain communities, betweenness |
| Topic management (soft-delete, restore, trash, duplicate merge) | ✅ | 7-day soft-delete recovery |
| Product Mode (register product → sweep → signals → digest) | ✅ | Daily sweeps, DOCX/PPTX export |
| Audience personas + Launch Brief | ✅ | ICP clustering from real authors, go-to-market brief |
| Hypothesis tracking / Decision Journal | ✅ | Phase 3 shipped |
| Weekly monitoring + delta view | ✅ | Phase 4 shipped |
| Export: DOCX + PPTX pitch deck | ✅ | Requires `python-docx` / `python-pptx` |
| Ingest local files (PDF, CSV, MD, VTT, SRT) | ✅ | `ingest file` + `ingest folder` commands |
| Onboarding / empty-state (welcome.js) | 🟡 | `welcome.js` exists with 32+ onboarding references; verify first-run UX end-to-end |
| Tauri 2 build config (tauri.conf.json) | ✅ | `com.shantanu.gapmap`, arm64 + x86_64, icons, CSP, asset-protocol scope |
| Splashscreen | ✅ | 360×240 transparent splash.html |
| PyInstaller spec (gapmap-cli.spec) | ✅ | ONNX bundled, all lazy-import deps declared |
| Sidecar binary — arm64 on disk | 🟡 | 231 MB binary is from Apr 21; predates audience/iterate/launch/deliberate features. Must rebuild before release: `scripts/publish-mac.sh --arch arm64` |
| ffmpeg sidecar | ✅ | 48 MB arm64 binary in binaries/; `scripts/fetch-ffmpeg.sh` handles CI + local |
| macOS code signing (Developer ID Application cert) | 🔴 | User has Apple Developer Program but NOT Developer ID Application cert. Must create before signing/notarization works. See `docs/manual-todo/publish-macos.md` step 2. |
| Notarization (Apple) | 🔴 | Depends on Developer ID cert. `release.yml` is wired; only secrets are missing. |
| `JWT_DESKTOP_SECRET` in GitHub Secrets | 🔴 | Panics at release build if missing. Generate: `openssl rand -hex 32`. Add to GitHub + export locally. |
| GitHub Actions release CI (release.yml) | ✅ | Cross-platform matrix (mac arm64/x86_64, Linux, Windows), tauri-action, notarization plumbed |
| DMG window styling | ✅ | Window size + app-icon position configured in tauri.conf.json |
| Auto-update (tauri-plugin-updater) | 🔴 | Not configured. Users must manually download every new version. Future scope (TAURI_SIGNING_PRIVATE_KEY already in CI env). |
| License activation flow (`JWT_DESKTOP_SECRET` HMAC) | 🟡 | `build.rs` bakes the secret. Flow exists in `DEVICE_ACTIVATION_FLOW.md`; smoke test needed. |
| Linux + Windows ffmpeg sidecar | 🔴 | Missing on Linux/Windows targets. Ingest-video degrades gracefully. Out of scope for macOS-only v0.1.0 beta. |

---

## MCP Server

| Item | Status | Notes |
|---|---|---|
| 90+ FastMCP tools registered | ✅ | All tool categories implemented and verified in source |
| `gapmap mcp install` (Claude Code) | ✅ | Writes to `~/.claude.json`, aligns data dir, generates auth token |
| `gapmap mcp install --client cursor` | ✅ | HTTP daemon config at `~/.cursor/mcp.json` |
| `gapmap mcp install --client claude-desktop` | ✅ | |
| HTTP daemon for Cursor (`scripts/mcp_http_daemon.sh`) | ✅ | start/stop/restart/status/logs, survives Cursor 5-min cycling |
| Async job queue (for long-running tools) | ✅ | 4-thread pool, SQLite-persisted, survives daemon restarts |
| Cooperative cancel + live progress | ✅ | JobCancelled propagates as BaseException; 5 tools wired |
| Palace semantic search (ONNX MiniLM) | ✅ | Cold-start pre-warm, HNSW auto-heal on corruption |
| Tool timeout safety net (90s hard ceiling) | ✅ | Returns structured timeout dict with async_hint |
| Structured event log + `mcp stats` | ✅ | Per-tool timing, slow-call threshold (>5s → warn) |
| Auth token gating | 🟡 | Token generated and injected into env; actual request-level gating should be verified |
| `gapmap_diagnostics` health probe | ✅ | DB + Palace + LLM + corpus checks in one call |

---

## CLI

| Item | Status | Notes |
|---|---|---|
| All fetch commands (posts, comments, user, historical, stream) | ✅ | |
| Search, query, export | ✅ | JSON / CSV / Parquet output |
| Research pipeline (discover, collect, gaps, synthesize, report) | ✅ | |
| Ingest local files (file + folder) | ✅ | |
| Analyze (themes, summarize, painpoints) | ✅ | |
| Schedule (enable, tick, schedule-seen) | ✅ | For launchd/cron automation |
| MCP management (install, uninstall, status, serve, clients, stats, logs) | ✅ | |
| `--json` flag on all commands | ✅ | Machine-readable NDJSON |
| Auth (login, check) | ✅ | PRAW credential setup |
| Help text accuracy | 🟡 | Docstrings exist; verify against current behavior after sidecar rebuild |

---

## Documentation

| Item | Status | Notes |
|---|---|---|
| ARCHITECTURE.md | ✅ | Created this session |
| MCP_TOOLS.md | ✅ | Created this session |
| CLI_REFERENCE.md | ✅ | Created this session |
| LAUNCH.md (this file) | ✅ | Created this session |
| docs/GAP_MAP_GUIDE.md | ✅ | End-user guide for the desktop app |
| docs/MCP_INFRA.md | ✅ | Transport architecture, job queue, operating playbook |
| docs/FEATURES.md | ✅ | Phase-by-phase feature coverage |
| README.md | 🟡 | Verify it references the new doc files and has correct install steps |
| docs/manual-todo/publish-macos.md | ✅ | 9-step macOS release checklist |

---

## Pre-Launch Manual Steps (must do by hand)

These steps cannot be automated — they require human action before cutting a release.

1. **Create Developer ID Application cert** — Log into developer.apple.com → Certificates → New → "Developer ID Application". Export as `.p12` (with passphrase). You currently have Apple Development + iPhone Distribution certs only — neither works for notarized DMGs outside the App Store. See `docs/manual-todo/publish-macos.md` step 2.

2. **Generate `JWT_DESKTOP_SECRET`** — Run `openssl rand -hex 32`. This secret is baked at build time into the binary; never change it after first release (existing licenses will break). Add to: (a) GitHub Repo Secrets as `JWT_DESKTOP_SECRET`, (b) your local shell env before running `publish-mac.sh`.

3. **Add GitHub Secrets** — `APPLE_CERTIFICATE` (base64 p12), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_PASSWORD` (app-specific), `APPLE_TEAM_ID`, `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, `JWT_DESKTOP_SECRET`. Full list in `docs/manual-todo/publish-macos.md`.

4. **Rebuild the Python sidecar** — The arm64 binary on disk is from Apr 21 and lacks audience/iterate/launch/deliberate/paper-pipeline features. Run: `scripts/publish-mac.sh --arch arm64` (or `scripts/build-pyinstaller.sh`). Then re-run `codesign --force --deep --sign -` on the result.

5. **Smoke test the signed DMG locally** — After sidecar rebuild + cert setup, run `scripts/publish-mac.sh --arch arm64 --sign`. Verify: `spctl -a -vv <path-to-DMG>` reports "Notarized Developer ID". Test first-run onboarding, BYOK modal, and a collect run.

6. **Set Reddit API credentials in environment** — Users need a Reddit app at https://www.reddit.com/prefs/apps. Document the 3 required env vars (`REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_USERNAME`/`REDDIT_PASSWORD` OR username-only for read-only mode) in end-user docs.

7. **Tag and push** — `git tag v0.1.0 && git push origin v0.1.0`. The `release.yml` CI builds arm64 + x86_64 + Linux + Windows in parallel, notarizes macOS, and uploads to a draft GitHub Release. Review the draft before publishing.
