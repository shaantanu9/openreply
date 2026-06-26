# Social Content Tool — Build & Migration Plan

> **Goal:** Stand up a **new git repo** for a social-media **content-creation tool**,
> reusing the proven Tauri 2 + Python-sidecar architecture from `reddit-myind`
> (Gap Map). This plan tells you exactly **which files to copy**, **what to delete**,
> **what new code to write**, the **phased milestones**, and the **exact git commands**
> to create the repo and connect a remote.
>
> Read alongside `docs/architecture/TAURI_AND_FETCH_ARCHITECTURE.md` (the deep dive on
> the shell + fetch engine you're reusing).

---

## 0. The core idea in one sentence

Gap Map is an **inbound** engine (pull content from ~61 platforms → store → analyze).
A content tool is the **same engine plus an outbound half** (generate → schedule →
**publish** to platforms). You keep the shell, the sidecar bridge, the per-platform
auth, and the LLM layer; you drop the research/gaps/papers/graph subsystems; you add a
`publish/` layer, a `content`/`drafts` data model, a Composer UI, and a scheduler.

```
REUSE (inbound + plumbing)            ADD (outbound)
──────────────────────────            ─────────────────────────
Tauri shell + sidecar bridge          publish/<platform>.py adapters
source_credentials (auth)             drafts / publish_log tables
~20 fetch adapters (ideation)         content CLI group
8-provider LLM layer                  Composer + Calendar/Queue screens
SQLite + streaming events             scheduler (schedule-tick pattern)
```

---

## 1. Open decisions (defaults chosen — change before M1 if you disagree)

| # | Decision | Default | Why |
|---|----------|---------|-----|
| D1 | Repo strategy | **Fork-and-strip** (copy subset into fresh repo) | Cleanest history; no Gap Map baggage |
| D2 | First platform | **X / Twitter (official API v2)** | Simplest official API; proves the outbound path |
| D3 | Keep Python sidecar? | **Yes** | Reuses fetch adapters, creds, LLM layer untouched |
| D4 | Frontend | **Keep vanilla JS + Vite** (option to migrate to React later) | Lowest friction; copy `api.js` pattern as-is |
| D5 | App identity | name `social-forge`, bundle id `com.<you>.socialforge` | Replace all `gapmap`/`com.shantanu.gapmap` strings |
| D6 | Launch platforms after M1 | LinkedIn, Instagram/FB (Meta Graph), then cookie-only (TikTok, X-via-cookie) | API-based first, scraping-based later |

> If any of D1–D6 is wrong, fix it here first — the file manifest in §3 depends on them.

---

## 2. Target repo structure (new repo)

```
social-forge/
├── app-tauri/
│   ├── index.html                  # (copy, strip research nav)
│   ├── src/
│   │   ├── main.js                 # (copy, trim routes to content screens)
│   │   ├── api.js                  # (copy AS-IS — the caching/invoke layer)
│   │   ├── screens/
│   │   │   ├── composer.js         # NEW — multi-platform draft editor + preview
│   │   │   ├── calendar.js         # NEW — scheduled queue (drafts.scheduled_at)
│   │   │   ├── connections.js      # (copy Reach Connections → rename)
│   │   │   ├── ideas.js            # (adapt from collect screen — pull trends)
│   │   │   └── settings.js         # (copy, trim)
│   │   └── lib/
│   └── src-tauri/
│       ├── src/
│       │   ├── main.rs             # (copy, trim generate_handler! to content cmds)
│       │   ├── commands.rs         # (copy bridge pattern, add publish cmds)
│       │   ├── cli.rs              # (copy AS-IS — sidecar spawn/daemon/stream)
│       │   └── db.rs               # (copy AS-IS — native read path)
│       ├── tauri.conf.json         # (copy, change identity + CSP connect-src + externalBin name)
│       └── capabilities/default.json  # (copy, rename binary + events)
├── src/socialforge/                # the Python sidecar package (renamed from gapmap)
│   ├── cli/main.py                 # (copy, trim to: content / publish / auth / sources / mcp)
│   ├── core/
│   │   ├── db.py                   # (copy, keep posts; ADD drafts/publish_log)
│   │   ├── credentials.py          # (copy AS-IS — source_credentials store)
│   │   ├── client.py, public_client.py  # (copy — for ideation fetch)
│   ├── sources/                    # (copy a SUBSET — see §3)
│   ├── publish/                    # NEW — outbound adapters
│   │   ├── base.py                 # post_* contract + result shape
│   │   ├── x.py                    # M1
│   │   ├── linkedin.py, meta.py    # M3+
│   ├── content/                    # NEW — generation + scheduling
│   │   ├── generate.py             # LLM caption/thread/script generation
│   │   ├── drafts.py               # draft CRUD
│   │   └── schedule.py             # schedule-tick: fire due drafts
│   ├── analyze/providers/          # (copy AS-IS — 8 LLM providers)
│   └── mcp/server.py               # (copy, swap tool registry to content tools)
├── pyproject.toml                  # (copy, rename package + console_scripts entry)
├── scripts/                        # (copy build/sidecar packaging scripts, rename)
├── docs/
│   └── ARCHITECTURE.md             # (copy TAURI_AND_FETCH_ARCHITECTURE.md as the seed)
├── changelogs/
├── README.md                       # NEW
└── .gitignore                      # (copy)
```

---

## 3. File manifest — exactly what to copy from `reddit-myind`

### 3a. Copy AS-IS (no logic change, only identity strings)
```
app-tauri/src/api.js
app-tauri/src-tauri/src/cli.rs
app-tauri/src-tauri/src/db.rs
app-tauri/src-tauri/capabilities/default.json
src/gapmap/core/credentials.py
src/gapmap/core/db.py                 (keep schema infra; you'll add tables)
src/gapmap/core/client.py
src/gapmap/core/public_client.py
src/gapmap/analyze/providers/**       (all 8 LLM providers + base ABC)
scripts/  (sidecar build/packaging, e.g. pyinstaller spec + codesign helpers)
.gitignore
gapmap-cli.spec                       (rename → socialforge-cli.spec)
```

### 3b. Copy + TRIM (remove research/gaps/papers/graph branches)
```
app-tauri/index.html                  → keep shell, drop research/papers/map nav
app-tauri/src/main.js                 → keep router, drop renderTopic/Map/Papers
app-tauri/src-tauri/src/main.rs       → keep ~15 content commands, drop ~180 research ones
app-tauri/src-tauri/src/commands.rs   → keep bridge helpers + a few; drop research bridges
app-tauri/src-tauri/tauri.conf.json   → change identity, externalBin name, CSP connect-src
src/gapmap/cli/main.py                → keep: auth, ingest(optional), feeds(optional),
                                        sources fetch (for ideation); ADD content/publish groups;
                                        DROP: research, paper-*, graph, persona, product
src/gapmap/mcp/server.py              → swap tool registry to content/publish tools
```

### 3c. Copy a SUBSET of `sources/` (for IDEATION only — what platforms you create for)
Keep the ones whose audience you'll write content for; drop academic/econ:
```
KEEP:  reddit_free.py, collect_adapter.py (trimmed), hn.py, youtube.py,
       producthunt.py, devto.py, x_twitter.py, linkedin.py, instagram.py,
       tiktok.py, threads.py, rss*.py, trends.py, gnews.py, source_families.py
DROP:  arxiv, pubmed, openalex, crossref, dblp, europepmc, semantic_scholar, scholar,
       worldbank, fred, bis, yfinance, openmeteo, polymarket, acled, gdelt,
       and the whole research/, graph/, retrieval/ packages
```

### 3d. DO NOT COPY
```
src/gapmap/research/**, src/gapmap/graph/**, src/gapmap/retrieval/**
app-tauri/data/*.db (start clean)
.codegraph/, graphify-out/ (regenerate fresh)
all docs except the architecture seed
node_modules, .venv, target/, dist/, build/ (rebuild)
```

---

## 4. New data model (add to `core/db.py`)

```sql
-- Drafts authored in the Composer
CREATE TABLE drafts (
  id TEXT PRIMARY KEY,
  title TEXT,
  body TEXT NOT NULL,             -- canonical text; per-platform variants in variants_json
  variants_json TEXT,             -- {"x": "...", "linkedin": "...", "instagram": "..."}
  media_json TEXT,                -- [{"path": "...", "kind": "image|video", "alt": "..."}]
  platforms_json TEXT,            -- ["x","linkedin"]
  status TEXT DEFAULT 'draft',    -- draft | scheduled | publishing | published | failed
  scheduled_at INTEGER,           -- epoch; NULL = not scheduled
  source_topic TEXT,              -- which ideation topic seeded it (optional)
  created_at INTEGER,
  updated_at INTEGER
);
CREATE INDEX idx_drafts_status_sched ON drafts(status, scheduled_at);

-- One row per (draft, platform) publish attempt
CREATE TABLE publish_log (
  id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  posted_at INTEGER,
  remote_id TEXT,                 -- tweet id / post urn / media id
  remote_url TEXT,
  status TEXT,                    -- ok | error
  error TEXT,
  metrics_json TEXT               -- backfilled later: likes/comments/views
);
CREATE INDEX idx_publog_draft ON publish_log(draft_id);
```
Reuse the existing `posts`, `topic_posts`, `fetches`, `source_credentials` tables for
ideation + auth. Keep WAL + `_retry_on_locked` exactly as Gap Map does.

---

## 5. New code contracts

### 5a. `publish/base.py`
```python
# Mirror of the sources/ adapter contract, but outbound.
def post_<platform>(draft: dict, creds: dict) -> dict:
    """Publish one draft to one platform.
    Returns {"status":"ok|error","remote_id":...,"remote_url":...,"error":...}
    Never raises — return error dict so the CLI/Tauri layer can log it."""
```
Auth comes from the **same** store you reuse: `credentials.api_key("x")` /
`credentials.cookie_header("x")`. No new auth system.

### 5b. CLI (`cli/main.py`, new `content` + `publish` Typer groups)
```
socialforge content generate --from-topic "X" --platforms x,linkedin --json
socialforge content draft  --body "..." --platforms x --schedule "2026-07-01T09:00"
socialforge content list   --status scheduled --json
socialforge content publish --draft <id> [--platform x] --json
socialforge content schedule-tick                 # fire all due drafts (called on a timer)
socialforge sources fetch  --source reddit_free --query "X"   # ideation (reused)
socialforge auth connect   --source x             # reuse Reach Connections flow
```

### 5c. Tauri commands (`commands.rs` + `main.rs` generate_handler!)
```
draft_save, draft_list, draft_get, draft_delete           (native db.rs reads where hot)
content_generate            → run_cli_streaming "gen:progress"/"gen:done"
start_publish               → run_cli_streaming "publish:progress"/"publish:done"
publish_status, schedule_tick
connections_list, connect_source, verify_source           (reuse existing)
```
Follow the **command triangle** and **streaming** patterns documented in the architecture guide.

### 5d. Scheduler
Reuse Gap Map's `research schedule-enable/tick` shape: the app calls
`schedule_tick` on an interval (or via the `loop`/`schedule` skill / OS cron) →
`content/schedule.py` selects `drafts WHERE status='scheduled' AND scheduled_at<=now`
→ calls the right `publish/*` adapter → writes `publish_log`.

---

## 6. Phased milestones

| Milestone | Outcome | Done when |
|---|---|---|
| **M0 — Scaffold** | New repo builds & runs empty shell | `pnpm tauri dev` opens window; sidecar daemon handshakes; `socialforge info --json` works |
| **M1 — One platform e2e** | Compose → publish a real X post | Composer screen → `start_publish` → tweet appears; `publish_log` row written; `publish:done` event renders |
| **M2 — Scheduling** | Drafts auto-publish at a time | `content schedule-tick` fires a due draft; Calendar screen shows queue |
| **M3 — Generation** | LLM drafts from a topic | `content generate --from-topic` returns platform-tuned variants into Composer |
| **M4 — More platforms** | LinkedIn + Meta (IG/FB) | Each via `publish/<p>.py`; Connections verifies creds |
| **M5 — Ideation loop** | Pull trends to seed content | Reused fetch adapters surface angles in the Ideas screen |
| **M6 — Metrics backfill** | Pull post performance | Reused fetch adapters write `publish_log.metrics_json` |

Build M1 **before** anything else — it proves the outbound path through all three layers.

---

## 7. Identity rename checklist (do during M0)

Replace every occurrence:
```
gapmap            → socialforge
gapmap-cli        → socialforge-cli
com.shantanu.gapmap → com.<you>.socialforge
GAPMAP_DATA_DIR   → SOCIALFORGE_DATA_DIR  (and all GAPMAP_* envs)
"Gap Map"         → "Social Forge"
```
Files that hold identity: `pyproject.toml` (`[project.scripts]`, package name),
`tauri.conf.json` (`identity`, `productName`, `externalBin`, `assetProtocol.scope`,
CSP `connect-src` for your platform APIs), `capabilities/default.json` (binary name +
event names), `cli.rs` (data-dir + sidecar name + env vars), `main.rs`, and the
PyInstaller `.spec`. Use the `flutter-app-identity-audit` mindset (grep every secret/ID
string) and the `tauri-python-sidecar-app` skill for the Tauri-specific spots.

---

## 8. Git: create the new repo & connect a remote (exact commands)

> Run these **in the new repo folder** after you copy the files in per §3.

```bash
# 1. Create + init the new repo locally
mkdir ~/Documents/GitHub/social-forge && cd ~/Documents/GitHub/social-forge
#    ... copy the files from §3 into here ...
git init -b main

# 2. First commit (stage explicit paths; never `git add -A` blindly)
git add app-tauri src pyproject.toml scripts docs .gitignore README.md SOCIAL_CONTENT_TOOL_PLAN.md
git status                      # eyeball what's staged
git commit -m "chore: scaffold social-forge from gap-map architecture"

# 3. Create the GitHub repo and connect it (private)
gh repo create social-forge --private --source=. --remote=origin
#    OR if you made the repo in the GitHub UI:
#    git remote add origin https://github.com/<you>/social-forge.git

# 4. Push
git push -u origin main
```
After M0/M1, commit per the repo rules: **one feature = one commit**, conventional
prefix, explicit paths, no AI attribution.

---

## 9. Risks & failure modes (validate early)

1. **Cookie-only platforms break often** (X-via-cookie, TikTok, IG scraping). → Start
   with **official APIs** (D2); treat cookie publishing as best-effort.
2. **Platform API approval lag** — X/LinkedIn/Meta dev apps need review for write
   scopes. → Apply for developer access on day 1 of M1; build against it.
3. **Sidecar binary signing** — same macOS Gatekeeper hang Gap Map fixed with the dev
   `.venv` bypass + codesign. → Copy `scripts/` packaging + the `tauri-python-sidecar-app`
   gotchas.
4. **Media upload** — most publish APIs need a 2-step (upload media → attach id). →
   Model `media_json` with a post-upload `remote_media_id` field.
5. **Rate limits / duplicate posts** — make `publish` idempotent: check `publish_log`
   for an existing `ok` row per (draft, platform) before posting.
6. **Token/secret leakage in logs** — keep `scrub_secrets` from `cli.rs` in the
   streaming path.

---

## 10. Skills to invoke while building

- `tauri-python-sidecar-app` — **invoke first** for any `cli.rs`/`tauri.conf.json`/sidecar work.
- `postiz` — social scheduling & publishing prior art (closest to §5).
- `meta-ads-app-launch` + the `Meta_ads_mcp` tools — IG/FB publishing & boosting (M4).
- `fastmcp-app-integration` — expose the `content` commands as MCP tools.
- `flutter-app-identity-audit` (mindset) — the §7 rename/secret sweep.
- `superpowers:brainstorming` — before M1 if any of D1–D6 is still open.

---

## 11. First concrete tasks (when you say go)

1. M0 scaffold: copy §3a/§3b files, run the §7 rename, get `tauri dev` + sidecar handshake green.
2. Add `drafts`/`publish_log` to `core/db.py` (§4).
3. Write `publish/base.py` + `publish/x.py` (§5a) against the X API v2.
4. Add `content publish` CLI (§5b) + `start_publish` Tauri command (§5c).
5. Build a minimal `composer.js` that posts one draft and renders `publish:done`.
6. Demo M1 end-to-end → then iterate to M2+.
```
