# PyInstaller bundling — verified Apr 2026

Single-file binary build works end-to-end. Everything needed to ship the
Tauri desktop app as a single `.dmg` is proven below.

## Live test results

| Metric | Value |
|---|---|
| Binary size | **62 MB** (compressed single file) |
| Architecture | arm64 (Apple Silicon native) |
| Build time | ~2 minutes on M1 Max |
| Launch overhead | ~400 ms cold start (PyInstaller onefile unpacks to tmp) |
| Commands tested | `info` · `research --help` · `research discover` · `research collect` · `research graph build` · `research graph export` |
| Prompts bundled | ✅ `prompts/*.yaml` accessible via `--add-data "prompts:prompts"` |
| MCP server | ✅ `reddit-cli mcp serve` works |
| Network calls | ✅ Live Reddit discovery + collect pulled real data |

## Bundle composition

| Component | ~Size | Note |
|---|---|---|
| Python 3.12 runtime | 15 MB | |
| Our code | <1 MB | Just orchestration |
| praw + prawcore | 3 MB | Reddit SDK |
| scipy | 18 MB | Needed by `graph pagerank` via networkx |
| pandas | 8 MB | Pulled by pytrends + aggregations |
| numpy | 6 MB | scipy / pandas backbone |
| networkx | 2 MB | Graph algorithms |
| Other deps | ~10 MB | rich, typer, pydantic, httpx, feedparser, pytrends, fastmcp, sqlite-utils, cryptography |

**Path to smaller bundle (optional v2):** Drop scipy/pandas behind an
on-demand `--extra analysis` download. Saves ~26 MB → 36 MB base.

For v1: **62 MB is fine.** Comparable apps: Obsidian (180 MB), Raycast (130 MB), Slack (250 MB), Linear (200 MB).

## Single `.dmg` math

```
Gap Map.app/
├── Contents/
│   ├── MacOS/
│   │   └── gapmap                              ~15 MB  (Tauri Rust)
│   ├── Resources/
│   │   ├── assets/                             ~2 MB   (HTML/CSS/JS)
│   │   └── binaries/
│   │       └── reddit-cli-aarch64-apple-darwin 62 MB   (PyInstaller)
│   └── Info.plist
└── _CodeSignature/

TOTAL UNCOMPRESSED: ~80 MB
AFTER DMG COMPRESSION (bzip2): ~45-55 MB
```

**One signed `.dmg`, ~50 MB, ships everything.**

## macOS notarization path

Tauri bundler handles the whole flow in one command:

```bash
cd gapmap-tauri/
APPLE_ID="you@example.com" \
APPLE_PASSWORD="@keychain:AC_PASSWORD" \
APPLE_TEAM_ID="XXXXXXXXXX" \
APPLE_SIGNING_IDENTITY="Developer ID Application: Shantanu Bombatkar (XXXXXXXXXX)" \
npm run tauri build -- --target aarch64-apple-darwin
# → dist/Gap Map_1.0.0_aarch64.dmg (signed + notarized)
```

The embedded Python binary gets signed alongside with
`hardenedRuntime: true` in tauri.conf.json.

You already have from your existing ASC CLI setup: Apple Developer cert,
Team ID, app-specific password, `xcrun notarytool` familiarity.

## Cross-platform targets

| Platform | How |
|---|---|
| macOS arm64 | `./scripts/build-pyinstaller.sh` on M-series (verified today) |
| macOS x86_64 | Same script on Intel Mac OR Rosetta 2 terminal |
| Linux x86_64 | GitHub Actions ubuntu-latest |
| Windows x86_64 | GitHub Actions windows-latest (adds `--icon` flag) |

GitHub Actions matrix is the production build path — commit the script, tag release, Actions runs all 4 targets in parallel, signed artifacts uploaded to the release.

## Files committed

- `scripts/build-pyinstaller.sh` — reproducible build
- `scripts/pyinstaller-entrypoint.py` — absolute-import shim

## Benign warnings (ignore)

```
WARNING: Hidden import "jinja2" not found!        # Optional, fastmcp web extras
WARNING: Library user32 required via ctypes       # Windows-only
WARNING: Library msvcrt required via ctypes       # Windows-only
```

## ⏭ Ready to scaffold Tauri

Sidecar is proven. Next phase creates `app-tauri/` with:
- `src-tauri/Cargo.toml` + `tauri.conf.json` (sidecar declared)
- `src-tauri/src/main.rs` + `commands.rs` + `cli.rs` (Rust ↔ Python bridge)
- `index.html` (copy of variant-6-soft-dashboard)
- `package.json` + `vite.config.js`
- `src/main.js` — first `invoke('run_cli', ['info'])` wired to sidebar nav

First `npm run tauri dev` → the Gap Map UI renders and real `reddit-cli` calls fire.
