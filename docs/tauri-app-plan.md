# Tauri desktop app plan — "Gap Map"

**Short answer: yes, 100% doable, and honestly the *right* choice given:**
- You already have the `variant-6-soft-dashboard.html` design as a polished HTML/CSS/SVG artifact. Tauri's webview renders it verbatim with zero translation — Flutter would cost you 3-5 days re-implementing it.
- Everything data-side is already Python. Tauri spawns `reddit-cli` as a sidecar subprocess.
- Bundle size stays under 30 MB (vs Flutter's ~50 MB+).
- You can reuse your ASC CLI / Apple Developer cert for macOS code signing.

The plan below assumes **Tauri v2** (stable since Oct 2024) + **vanilla JS** frontend (the HTML is already written — no framework needed for v1).

---

## 🏗 Architecture at a glance

```
┌────────────────────────────── gapmap.app ─────────────────────────────────┐
│                                                                           │
│  ┌────────────────── Webview (variant-6-soft-dashboard.html) ──────────┐  │
│  │                                                                    │  │
│  │   Sidebar     Main                                                 │  │
│  │   ┌─────┐    ┌────────────────────────────────────────────────┐    │  │
│  │   │     │    │  Hero  Stats  Activity  Topics  Graph  Findings│    │  │
│  │   │ nav │    │                                                │    │  │
│  │   │     │    │  (all rendered from HTML; JS modules bind to   │    │  │
│  │   │ pro │    │   invoke() calls from Rust)                    │    │  │
│  │   └─────┘    └────────────────────────────────────────────────┘    │  │
│  └──────────────────────────┬─────────────────────────────────────────┘  │
│                             │ @tauri-apps/api invoke / event.listen       │
│  ┌──────────────────────────▼────────────────── Rust core ─────────────┐  │
│  │                                                                     │  │
│  │   #[tauri::command] list_topics()      ─────────┐                   │  │
│  │   #[tauri::command] start_collect()             │                   │  │
│  │   #[tauri::command] build_graph()               │                   │  │
│  │   #[tauri::command] export_html()     spawn sidecar                 │  │
│  │   #[tauri::command] ingest_file()               │                   │  │
│  │   #[tauri::command] save_settings()             │                   │  │
│  │   #[tauri::command] install_mcp()               │                   │  │
│  │                                                 ▼                   │  │
│  │                                     ┌──────────────────────────┐   │  │
│  │                                     │ reddit-cli-<target>      │   │  │
│  │                                     │ (PyInstaller sidecar)    │   │  │
│  │                                     │                          │   │  │
│  │                                     │ • query / fetch / research/ collect
│  │                                     │ • research graph build/export
│  │                                     │ • ingest file            │   │  │
│  │                                     │ • mcp serve (for Claude Code)
│  │                                     └──────────┬───────────────┘   │  │
│  └────────────────────────────────────────────────┼───────────────────┘  │
│                                                   ▼                      │
│                          ~/Library/Application Support/gapmap/           │
│                          ├─ reddit.db                                    │
│                          ├─ settings.json                                │
│                          ├─ exports/*.html                               │
│                          └─ keychain items (Reddit OAuth, LLM keys)      │
└───────────────────────────────────────────────────────────────────────────┘
```

---

## 📦 Stack decisions (and why)

| Layer | Choice | Why |
|---|---|---|
| Framework | **Tauri v2** | Smaller bundle, system webview, Rust security, better signing story than Electron |
| Frontend | **Vanilla JS + ES modules** | `variant-6` is already raw HTML/CSS — zero re-implementation. Can migrate to Svelte/React later |
| Build tool | **Vite** (Tauri default) | Fast HMR, Tauri-native |
| Rust deps | `tauri`, `tauri-plugin-store`, `tauri-plugin-updater`, `tauri-plugin-dialog`, `tauri-plugin-fs`, `keyring`, `serde_json`, `anyhow`, `tokio` | Standard Tauri v2 loadout |
| Python bundling | **PyInstaller** → Tauri sidecar binaries | Per-platform native binaries, no user-side Python install |
| Settings storage | `tauri-plugin-store` JSON + `keyring` for secrets | Non-secrets in JSON; OAuth tokens + LLM keys in macOS Keychain / Windows Credential Manager / Linux secret-service |
| Licensing | **Gumroad license key API** | $0 to start, simple verify endpoint, handles one-time $49 |
| Updater | `tauri-plugin-updater` | Built-in, signed, zero infra |
| Icons | Existing assets | Your Kaabil/MyInd icon pipeline |

---

## 🧩 Directory structure

```
gapmap-tauri/
├── package.json                      # Vite + Tauri deps
├── vite.config.js
├── index.html                        ← entry, loads src/main.js
├── src/                              ← frontend
│   ├── main.js                       # boot + hash router
│   ├── style.css                     # from variant-6 verbatim
│   ├── api.js                        # thin wrapper over invoke() + listen()
│   ├── router.js                     # hash-based SPA router
│   ├── screens/
│   │   ├── home.js                   # renders hero, stats, activity, topic grid
│   │   ├── topic.js                  # map/report/corpus tabs for one topic
│   │   ├── collect.js                # live progress view
│   │   ├── ingest.js                 # file drop
│   │   └── settings.js               # Reddit + LLM keys + MCP
│   ├── components/
│   │   ├── StatCard.js               # stat-card DOM builder
│   │   ├── TopicTile.js              # topic-tile with emoji cover
│   │   ├── FindingItem.js            # finding row with bullet
│   │   ├── ActivityItem.js           # activity feed item
│   │   └── SrcChip.js                # source-type chip
│   └── embed/
│       └── gap-map.html              ← existing D3 viewer (loaded via iframe
│                                        on the map screen, so we reuse it)
├── src-tauri/                        ← Rust backend
│   ├── Cargo.toml
│   ├── tauri.conf.json               # app ID, sidecar config, permissions
│   ├── build.rs
│   ├── icons/                        # macOS / Win / Linux / retina
│   ├── binaries/                     # PyInstaller outputs
│   │   ├── reddit-cli-aarch64-apple-darwin
│   │   ├── reddit-cli-x86_64-apple-darwin
│   │   ├── reddit-cli-x86_64-pc-windows-msvc.exe
│   │   └── reddit-cli-x86_64-unknown-linux-gnu
│   └── src/
│       ├── main.rs                   # tauri::Builder setup, plugins, manage state
│       ├── commands.rs               # #[tauri::command] functions
│       ├── cli.rs                    # sidecar wrapper (spawn + streaming)
│       ├── settings.rs               # keyring reads/writes
│       ├── license.rs                # Gumroad verify
│       └── mcp.rs                    # ~/.claude.json patch logic
└── scripts/
    ├── build-python.sh               # PyInstaller per-target
    └── package-all.sh                # full cross-platform build

```

---

## 🔌 Five critical integration points

### 1. Python CLI as a sidecar

```json
// src-tauri/tauri.conf.json (excerpt)
{
  "tauri": {
    "bundle": {
      "resources": ["binaries/*"],
      "externalBin": ["binaries/reddit-cli"]
    },
    "allowlist": {
      "shell": {
        "sidecar": true,
        "scope": [
          { "name": "binaries/reddit-cli", "sidecar": true, "args": true }
        ]
      }
    }
  }
}
```

Rust calls it:

```rust
// src-tauri/src/cli.rs
use tauri::api::process::Command;

pub async fn run_cli(args: Vec<&str>) -> Result<serde_json::Value, String> {
    let output = Command::new_sidecar("reddit-cli")
        .map_err(|e| e.to_string())?
        .args(args)
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(output.stderr);
    }
    serde_json::from_str(&output.stdout).map_err(|e| e.to_string())
}
```

### 2. Streaming progress for long commands

```rust
// src-tauri/src/commands.rs
use tauri::{AppHandle, Manager};

#[tauri::command]
pub async fn start_collect(
    app: AppHandle,
    topic: String,
    aggressive: bool,
) -> Result<(), String> {
    let mut args = vec!["research", "collect", "--topic", &topic];
    if aggressive { args.push("--aggressive"); }

    let (mut rx, _child) = Command::new_sidecar("reddit-cli")
        .map_err(|e| e.to_string())?
        .args(args)
        .spawn()
        .map_err(|e| e.to_string())?;

    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            if let CommandEvent::Stderr(line) = event {
                app.emit_all("collect_progress", line).ok();
            }
        }
        app.emit_all("collect_done", ()).ok();
    });
    Ok(())
}
```

Frontend:

```js
// src/screens/collect.js
import { listen } from '@tauri-apps/api/event';

await listen('collect_progress', (e) => appendLine(e.payload));
await listen('collect_done', () => routeTo('topic/' + topicId));
await invoke('start_collect', { topic, aggressive: true });
```

### 3. Embed the `variant-6` HTML

Two options; go with Option A for v1:

**Option A: Use `variant-6` HTML as the app shell itself.** The whole UI is the existing HTML — just add `<script type="module" src="./main.js"></script>` that wires DOM elements to `invoke()` calls.

**Option B: Render each screen from scratch in JS.** More componentized; more work. Save for v2 when refactoring.

For the interactive D3 gap-map graph, **load the existing `gap-map.html` in an iframe** on the topic/map screen:

```html
<iframe src="./embed/gap-map.html?topic=atsresume" 
        style="width:100%;height:100%;border:0;border-radius:18px"></iframe>
```

Pass the topic via URL query string; the embedded page reads it and requests its own data via `window.parent.postMessage` back to the shell.

### 4. MCP install button (from Settings)

```rust
// src-tauri/src/mcp.rs
use std::path::PathBuf;

#[tauri::command]
pub async fn install_mcp(app: AppHandle) -> Result<PathBuf, String> {
    let cli_path = app
        .path_resolver()
        .resolve_resource("binaries/reddit-cli")
        .ok_or("binary not found")?;

    let claude_config = dirs::home_dir()
        .unwrap()
        .join(".claude.json");

    let mut cfg: serde_json::Value = if claude_config.exists() {
        serde_json::from_str(&std::fs::read_to_string(&claude_config).unwrap_or_default())
            .unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    cfg["mcpServers"]["gapmap"] = serde_json::json!({
        "command": cli_path.to_str().unwrap(),
        "args": ["mcp", "serve"]
    });

    std::fs::write(&claude_config, serde_json::to_string_pretty(&cfg).unwrap())
        .map_err(|e| e.to_string())?;

    Ok(claude_config)
}
```

Click a button in Settings → writes to `~/.claude.json` → user restarts Claude Code → 40 MCP tools available.

### 5. Settings + secrets

Non-secrets (UI prefs, data dir, feature flags) → `tauri-plugin-store` JSON at `~/Library/Application Support/gapmap/settings.json`.

Secrets (Reddit OAuth tokens, Anthropic key, GitHub token) → `keyring` crate → macOS Keychain / Windows Cred Mgr / Linux secret-service. Never written to disk in plaintext.

```rust
use keyring::Entry;

#[tauri::command]
pub async fn save_reddit_token(refresh_token: String) -> Result<(), String> {
    let entry = Entry::new("gapmap", "reddit_refresh_token")
        .map_err(|e| e.to_string())?;
    entry.set_password(&refresh_token).map_err(|e| e.to_string())?;
    Ok(())
}
```

At CLI-spawn time, read the secret from keychain and pass as env var to the Python subprocess:

```rust
let token = Entry::new("gapmap", "reddit_refresh_token")?.get_password()?;
Command::new_sidecar("reddit-cli")?
    .env("REDDIT_REFRESH_TOKEN", token)
    .args(args);
```

---

## 🚨 The one real risk — Python bundle size

PyInstaller with all our deps (praw, httpx, sqlite-utils, fastmcp, anthropic, google-play-scraper, pytrends, networkx, scipy, pandas, feedparser, pyyaml, typer, rich) = **~80–120 MB per target binary** before compression.

### Mitigation plan

1. **Core vs extras split**
   - Core bundle: praw, httpx, sqlite-utils, typer, rich, pyyaml — ~20 MB
   - Analysis bundle (scipy/pandas/networkx/pytrends): downloaded on first use from our CDN as a tarball
   - Result: initial app ~30 MB; full features unlock ~60 MB on first run

2. **PyInstaller UPX compression** — shrinks ~30%

3. **Per-platform bundles** — ship only the binary matching the user's platform. macOS `.dmg` has arm64 OR x86_64, not both (universal builds double size).

4. **Worst case acceptance** — if the bundle ends up 100 MB, it's still smaller than most Electron apps (Slack, Discord, Obsidian all 200+ MB). Users don't notice.

---

## 📅 Week-by-week build plan

### Week 1 — Scaffold + Python bundling

- [ ] `npm create tauri-app@latest gapmap -- --template vanilla-ts`
- [ ] Set up `tauri.conf.json` with app ID `com.shantanu.gapmap`
- [ ] Write `scripts/build-python.sh` running PyInstaller per target:
  ```bash
  cd reddit-myind
  uv run pyinstaller --onefile --name reddit-cli \
    --paths=src --collect-all reddit_research \
    src/reddit_research/cli/main.py
  cp dist/reddit-cli ../gapmap/src-tauri/binaries/reddit-cli-$(rustc -vV | grep host | cut -d' ' -f2)
  ```
- [ ] Verify sidecar: `invoke('run_cli', ['info'])` → JSON
- [ ] Copy `variant-6-soft-dashboard.html` → `src/index.html`; lift `<style>` to `src/style.css`
- [ ] Wire sidebar nav → hash router → render empty screen placeholders

**Output:** bootable app, sidecar calls work, routing works, UI is the HTML.

### Week 2 — Home screen + collect flow

- [ ] `src/screens/home.js` — fetch topic list via `invoke('list_topics')`, render topic tiles
- [ ] Hero stat card data from `invoke('get_overview_stats')` (sum across topics)
- [ ] Activity feed from `invoke('get_recent_fetches')` (reads `fetches` table)
- [ ] "New topic" modal → routes to `/collect/<topic-slug>`
- [ ] `src/screens/collect.js` — `invoke('start_collect')` + listen to `collect_progress` events
- [ ] Progress bar + log tail
- [ ] On `collect_done` → `invoke('build_graph')` → `invoke('export_html')` → navigate to topic/map

**Output:** user types topic, sees progress, ends at a map.

### Week 3 — Topic detail screens + ingest + settings

- [ ] `src/screens/topic.js` with tabs: Map / Report / Corpus / Temporal
- [ ] Map tab: iframe to `embed/gap-map.html?topic=X` (reuse existing viewer)
- [ ] Report tab: fetch markdown via `invoke('get_report_pro')`, render with `marked` or similar
- [ ] Corpus tab: `invoke('query_corpus', { topic, limit: 100 })` → DataTable
- [ ] `src/screens/ingest.js` — Tauri dialog `open()` for file picker, call `invoke('ingest_file')`
- [ ] `src/screens/settings.js` — Reddit creds status, LLM keys, data dir, **MCP install button**
- [ ] Gumroad license verification + paywall gate on Pro features

**Output:** full product loop works end-to-end.

### Week 4 — Polish, signing, ship

- [ ] App icon set (use existing Kaabil/MyInd design pipeline)
- [ ] Tauri bundler: `npm run tauri build` → `.dmg`, `.exe`, `.AppImage`
- [ ] macOS: notarize via `xcrun altool` (use existing Apple Developer cert)
- [ ] Windows: sign with EV cert (or SmartScreen warning until reputation builds)
- [ ] `tauri-plugin-updater` with self-hosted manifest at `gapmap.io/updates.json`
- [ ] Landing page + Gumroad product setup
- [ ] TestFlight-equivalent: share early `.dmg` with 10 beta users
- [ ] Launch on Product Hunt + HN + relevant subs

**Output:** shippable, signed, distributable, monetizable.

---

## 🧱 Rust command list (complete contract)

All return `Result<T, String>` for graceful error surfacing to the frontend.

```rust
// Topic management
#[tauri::command] fn list_topics() -> Vec<Topic>;
#[tauri::command] fn get_topic_stats(topic: String) -> TopicStats;
#[tauri::command] fn delete_topic(topic: String);

// Collection (long-running, stream progress events)
#[tauri::command] fn start_collect(topic: String, aggressive: bool, sources: Vec<String>);
#[tauri::command] fn cancel_collect();

// Graph
#[tauri::command] fn build_graph(topic: String) -> GraphStats;
#[tauri::command] fn enrich_graph(topic: String, provider: String) -> EnrichSummary;
#[tauri::command] fn graph_stats(topic: String) -> GraphStats;
#[tauri::command] fn graph_pagerank(topic: String, top_n: u32) -> Vec<NodeRank>;

// Export
#[tauri::command] fn export_html(topic: String) -> PathBuf;
#[tauri::command] fn export_report_pro(topic: String) -> PathBuf;
#[tauri::command] fn export_json(topic: String) -> serde_json::Value;

// Ingest
#[tauri::command] fn ingest_file(path: PathBuf, topic: String, source_type: String) -> u32;

// Live data for UI
#[tauri::command] fn get_findings(topic: String, kind: String) -> Vec<Finding>;
#[tauri::command] fn get_evidence(topic: String, node_id: String) -> Vec<Post>;
#[tauri::command] fn query_corpus(topic: String, limit: u32) -> Vec<Post>;

// Settings / auth
#[tauri::command] fn get_settings() -> Settings;
#[tauri::command] fn save_settings(settings: Settings);
#[tauri::command] fn save_secret(key: String, value: String);
#[tauri::command] fn reddit_auth_login();           // opens OAuth URL in browser
#[tauri::command] fn verify_reddit_auth() -> bool;

// MCP
#[tauri::command] fn install_mcp() -> PathBuf;
#[tauri::command] fn uninstall_mcp();
#[tauri::command] fn mcp_status() -> bool;

// License
#[tauri::command] fn verify_license(key: String) -> bool;
#[tauri::command] fn get_license_status() -> LicenseStatus;

// System
#[tauri::command] fn open_path(path: PathBuf);      // "Reveal in Finder"
#[tauri::command] fn get_data_dir() -> PathBuf;
#[tauri::command] fn get_app_version() -> String;
```

---

## 🎨 Frontend JS modules — implementation sketches

### `src/api.js`

```js
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export const api = {
  listTopics:      ()                => invoke('list_topics'),
  startCollect:    (topic, aggr=true) => invoke('start_collect', { topic, aggressive: aggr }),
  buildGraph:      (topic)           => invoke('build_graph', { topic }),
  exportHtml:      (topic)           => invoke('export_html', { topic }),
  getFindings:     (topic, kind)     => invoke('get_findings', { topic, kind }),
  getEvidence:     (topic, nodeId)   => invoke('get_evidence', { topic, nodeId }),
  ingestFile:      (path, topic, st) => invoke('ingest_file',  { path, topic, sourceType: st }),
  installMcp:      ()                => invoke('install_mcp'),
  mcpStatus:       ()                => invoke('mcp_status'),
  onCollectLog:    (cb)              => listen('collect_progress', e => cb(e.payload)),
  onCollectDone:   (cb)              => listen('collect_done', cb),
};
```

### `src/screens/home.js`

```js
import { api } from '../api.js';

export async function render() {
  const root = document.querySelector('#main');
  const topics = await api.listTopics();
  const activity = await api.getRecentFetches();

  root.innerHTML = `
    <section class="hero">...</section>
    <div class="stat-grid">...</div>
    <div class="two-col">
      <div class="card">(sentiment chart)</div>
      <div class="card">(activity feed)</div>
    </div>
    <section class="topic-grid">
      ${topics.map(topicTileHtml).join('')}
    </section>
  `;
  
  // Wire topic-tile clicks
  root.querySelectorAll('.topic-tile').forEach(el => {
    el.onclick = () => location.hash = `#/topic/${el.dataset.topic}`;
  });
}
```

The key trick: **all DOM is from variant-6 HTML**, we just replace hardcoded content with `.innerHTML` templated from Rust-fetched data.

---

## ⚠️ Known risks + mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| PyInstaller bundle too large (>80MB) | Bloated installer | Split core vs analysis tier; download on-demand |
| macOS notarization fails for embedded Python | Can't ship to non-dev Macs | Enable hardened runtime + sign each Python binary; document `xcrun notarytool` flow |
| Windows SmartScreen flags unsigned binary | Users see warning | EV cert ($200-400/yr) or wait for reputation to build |
| MCP path breaks on app move/update | `reddit-cli` location changes, Claude Code can't find it | Auto re-register on app start if `mcpServers.gapmap.command` is stale |
| SQLite locking on concurrent commands | Weird errors | Enforce single-collect-at-a-time via Rust Mutex; for reads, WAL mode is safe |
| Pullpush / Reddit / App Store API changes | Scrapers break silently | Python already fails gracefully; add "last successful fetch" indicator per source on Settings page |
| Users expect real-time Slack ingest | Scope creep | v1 = file ingest only; document "Slack export → drop file" as official path |

---

## 💰 Monetization integration

### Gumroad license verification

```rust
// src-tauri/src/license.rs
async fn verify_gumroad(key: &str) -> Result<bool, String> {
    let params = serde_json::json!({
        "product_id": "YOUR_GUMROAD_PRODUCT_ID",
        "license_key": key,
    });
    let resp = reqwest::Client::new()
        .post("https://api.gumroad.com/v2/licenses/verify")
        .form(&params)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let body: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    Ok(body["success"].as_bool().unwrap_or(false))
}
```

### Free vs Pro gate

Settings enforces:
- Free = up to 3 topics, no scheduled runs, no PNG/PDF export, no `gapmap.io` publish
- Pro = unlimited, all features

```js
// src/lib/paywall.js
export async function requirePro(feature) {
  const { tier } = await api.getLicenseStatus();
  if (tier === 'pro') return true;
  showPaywallModal(`${feature} is a Pro feature ($49 lifetime)`);
  return false;
}
```

---

## 🎯 What I can do right now

**Pick one:**

### (A) Write the scaffolding commands + full `tauri.conf.json`
I generate `package.json`, `vite.config.js`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, and all the stub Rust files + README. You just run `npm install && npm run tauri dev`.
*~45 min work, gets you to "it boots" immediately*

### (B) Write the complete PyInstaller build script first
We test that `reddit-cli` bundles correctly on your Mac before committing to Tauri. If it fails, we need to fix our Python deps before touching Tauri. Cheapest reality check.
*~20 min, proves the hardest technical risk is solvable*

### (C) Full scaffold (A) + PyInstaller verify (B) together
Aggressive but gets you to a working app by end of week. I'll output the entire initial commit in one go.
*~2 hours of my work, ~2 days of your review/test*

### (D) Start with just the Rust command layer in this repo
Add `src-tauri/` inside `reddit-myind` as a subdirectory — keep everything in one repo until launch. Easier merging, shared `.env`, shared docs.
*Hybrid approach — I recommend this for v1*

---

## 🏁 My honest recommendation

**Go with (D): Tauri lives inside `reddit-myind/app-tauri/` subdirectory for v1.**

Reasons:
- Shared `docs/` already has `methodology.md`, `self-gap-analysis.md`, `desktop-app-spec.md`, `tauri-app-plan.md` (this doc)
- Shared `pyproject.toml` version = app version
- Shared git history = one `git push` ships CLI + app
- Same `.env.example` works for both
- When we split later, `git subtree split` is clean

Then:

1. **Today:** I write the scaffold under `app-tauri/` (~2 hours)
2. **Tomorrow:** Run PyInstaller, verify sidecar works
3. **Week 1–4:** Follow the plan above
4. **Launch:** Extract to separate repo if needed for distribution

**Say the word and I execute.** The shortest path to a shippable, monetizable desktop app is through this plan.
