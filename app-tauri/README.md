# Gap Map — desktop app (Tauri)

Soft-dashboard Tauri wrapper for the `reddit-myind` research tool.
The Python CLI runs as a bundled sidecar; all UI is vanilla JS + the
`variant-6-soft-dashboard` design.

## First-time setup

From the `reddit-myind` repo root:

```bash
# 1. Build the Python sidecar (reddit-cli binary)
./scripts/build-pyinstaller.sh

# 2. Copy the binary into app-tauri/src-tauri/binaries/
# (Replace <triple> with your platform, e.g. aarch64-apple-darwin)
cp dist/reddit-cli app-tauri/src-tauri/binaries/reddit-cli-aarch64-apple-darwin

# 3. Install Node deps (from app-tauri/)
cd app-tauri
npm install

# 4. Run in dev mode
npm run tauri dev
```

The app opens a window, boots the soft-dashboard UI, and calls the
sidecar to populate real data.

## What's in each directory

```
app-tauri/
├── index.html               # entry (loads style.css + main.js)
├── package.json             # npm deps + scripts
├── vite.config.js           # Vite on port 1420 (Tauri expects this)
├── src/                     # frontend (vanilla JS + ES modules)
│   ├── style.css            # soft-dashboard design from variant-6
│   ├── main.js              # hash router, modal wiring
│   ├── api.js               # invoke() + event wrapper + DOM helpers
│   └── screens/
│       ├── home.js          # hero + stats + activity + topic tiles
│       ├── collect.js       # live progress log
│       ├── topic.js         # embeds gap-map.html in iframe
│       ├── settings.js      # config + table counts
│       └── ingest.js        # (stub) local file drop
└── src-tauri/               # Rust backend
    ├── Cargo.toml
    ├── tauri.conf.json      # sidecar declared here
    ├── binaries/            # platform-specific reddit-cli builds
    └── src/
        ├── main.rs          # Tauri builder + invoke handlers
        ├── cli.rs           # sidecar wrapper (run_cli + run_cli_streaming)
        └── commands.rs      # #[tauri::command] bridge functions
```

## Available commands (Rust → Python)

| Command | Purpose |
|---|---|
| `cli_info()` | `reddit-cli info --json` |
| `list_topics()` | inventory of all collected topics |
| `overview_stats()` | global post/painpoint/source counts |
| `recent_activity()` | last 12 fetches |
| `discover_subs(topic, limit)` | `research discover` |
| `start_collect(topic, aggressive)` | kicks off `research collect` with live event streaming |
| `build_graph(topic)` | `research graph build` |
| `export_html(topic)` | generates gap-map HTML → returns path |
| `get_findings(topic, kind)` | query painpoints/products/workarounds/features |
| `app_data_dir()` | the `REDDIT_MYIND_DATA_DIR` path |

Events:
- `collect:progress` — fired per stdout/stderr line during a collect
- `collect:done` — fired when the collect subprocess terminates

## Build for distribution

```bash
npm run tauri build
# → target/release/bundle/dmg/Gap Map_0.1.0_aarch64.dmg
```

Code signing + notarization requires the env vars documented in
`docs/tauri-app-plan.md` (Apple Developer ID, team ID, app password).

## Known v1 limitations

- Icons are placeholders — replace `src-tauri/icons/*` with proper brand assets
- Ingest screen is a stub — CLI works today, UI coming in v1.1
- No license gating yet — Gumroad integration in v1.2
- Topic detail only shows the Map tab — Report/Corpus/Temporal tabs in v1.1
