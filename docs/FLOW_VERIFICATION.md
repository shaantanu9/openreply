# OpenReply — End-to-End Flow Verification

**Last verified:** 2026-05-25 by Claude (Opus 4.7)
**Build under test:** `~/Desktop/OpenReply_0.1.0_aarch64.dmg` (159 MB, ad-hoc signed, arm64)
**Branch:** `multi-source` · **Project:** Supabase `tjikcnsfaaqihgegecpi` · **Site:** https://openreply.myind.ai

This file is the live test record for the four moving parts that have to work
together: the **Python package** (`openreply`), the **CLI** (both as a venv install
and as the bundled DMG sidecar), the **MCP server** (FastMCP over stdio), and
the **public API** at openreply.myind.ai. Re-run any of the commands below to
re-verify a layer in isolation.

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                     │
│   Desktop (Tauri)                                                   │
│   ┌─────────────────┐         ┌──────────────────────────────┐      │
│   │ Rust host       │ stdio   │ Python sidecar (openreply-cli)  │      │
│   │ (./openreply)      │◀───────▶│ - CLI surface (typer)        │      │
│   └─────────────────┘         │ - MCP server (FastMCP)       │      │
│           │ tauri::invoke     │ - 147 tools                  │      │
│           ▼                   │ - reads/writes ~/Library/…/  │      │
│   ┌─────────────────┐         │   openreply.db (SQLite)         │      │
│   │ JS frontend     │         └──────────────────────────────┘      │
│   │ (Vite-bundled)  │                       │ HTTPS                 │
│   └─────────────────┘                       ▼                       │
│           │                       ┌──────────────────────┐          │
│           │                       │ External LLM/APIs    │          │
│           │ reqwest               │ (Anthropic, OpenAI,  │          │
│           └──────────────────────▶│  Reddit, arXiv, …)   │          │
│                                   └──────────────────────┘          │
│                                                                     │
│                                                                     │
│   Website (openreply.myind.ai · openreply_web repo · Vercel)              │
│   ┌──────────────────────────────────────────────────────┐          │
│   │ Next.js 16 + Supabase                                │          │
│   │   /v1/health                                         │          │
│   │   /v1/device/activate (issues HS256 JWT)             │          │
│   │   /api/v1/licence/me   (bearer-gated)                │          │
│   │   /api/v1/trial/start                                │          │
│   │   /api/v1/coupon/redeem (bearer-gated)               │          │
│   │   /dashboard /redeem /pricing /sign-in (public UI)   │          │
│   └──────────────────────────────────────────────────────┘          │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 1. Python CLI — local install (developers)

**Install:**

```bash
cd ~/Documents/GitHub/reddit-myind
uv pip install -e .
```

**Tests + observed output:**

```bash
.venv/bin/openreply health --json
# → {"ok":true, "data_dir":"~/Library/Application Support/com.shantanu.openreply/openreply",
#    "db_path":".../openreply.db",
#    "checks":[{id:"data_dir",ok:true},{id:"db",ok:true,detail:"57 tables..."},
#              {id:"palace",ok:true,detail:"ONNX ready at ~/.cache/chroma/..."},
#              {id:"llm",ok:false,level:"warn",detail:"No LLM provider..."},
#              {id:"reddit",ok:false,level:"info"}]}

.venv/bin/openreply info --json
# → mode=public, posts=105709, graph_nodes=60865, topic_posts=46954

.venv/bin/openreply query "SELECT count(*) FROM posts" --json
# → [{"count(*)": 105709}]
```

**Status:** ✅ All three commands return clean JSON. `mode=public` is correct
(no Reddit OAuth configured — falls back to public JSON). The two `warn`/`info`
checks (`llm`, `reddit`) are non-blocking by design.

---

## 2. CLI — bundled DMG sidecar

**Path inside the .app:**
```
/Applications/OpenReply.app/Contents/MacOS/openreply-cli
                                           ↑ same binary the Tauri host shells out to
```

Same Typer surface as the venv install. The DMG is shipped from
`scripts/publish-mac.sh` which uses `openreply-cli.spec` (PyInstaller).

**Test commands (after mounting the DMG):**

```bash
CLI="/Volumes/OpenReply/OpenReply.app/Contents/MacOS/openreply-cli"
"$CLI" health --json                          # → ok=true
"$CLI" info --json | jq '.tables.posts'       # → 105709
"$CLI" query "SELECT count(*) FROM posts" --json
"$CLI" research search-all --query "ai coding" \
  | jq '{ok, buckets: (.buckets|keys), first_post: .buckets.posts[0].title}'
# → ok=true, buckets includes posts/graph_nodes/analyses/paper_analyses/hypotheses/feedback,
#    first_post="Fission-AI/OpenSpec"
```

**Status:** ✅ Bundled sidecar fully working from inside the DMG. Reads/writes
the same `~/Library/Application Support/com.shantanu.openreply/openreply/openreply.db`
as the venv install — single source of truth.

### One-click `openreply` in your terminal

Settings → **Command line tool** → Install creates a symlink at
`/usr/local/bin/openreply → <OpenReply.app>/Contents/MacOS/openreply-cli`. After that,
`openreply …` works from any terminal session.

---

## 3. MCP server — FastMCP over stdio

The sidecar's `mcp serve` subcommand exposes 147 tools, all prefixed
`openreply_*`. Any MCP client (Claude Code, Claude Desktop, Cursor, Windsurf,
Cline) can spawn it.

**Protocol handshake test:**

```bash
{ echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0"}}}'
  echo '{"jsonrpc":"2.0","method":"notifications/initialized"}'
  echo '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
  sleep 3
} | .venv/bin/openreply mcp serve --transport stdio 2>/dev/null
```

**Observed responses:**

```json
{"jsonrpc":"2.0","id":1,"result":{
  "protocolVersion":"2024-11-05",
  "capabilities":{
    "experimental":{},"logging":{},
    "prompts":{"listChanged":false},
    "resources":{"subscribe":false,"listChanged":false},
    "tools":{"listChanged":true},
    "extensions":{"io.modelcontextprotocol/ui":{}}
  },
  "serverInfo":{"name":"openreply","version":"3.2.4"}
}}
```

In-process Python verification (faster than full protocol):

```bash
.venv/bin/python -c "
import asyncio
from openreply.mcp.server import mcp
tools = asyncio.run(mcp.list_tools())
print(f'total: {len(tools)}')
print(f'all openreply_ prefixed:', all(t.name.startswith('openreply_') for t in tools))
print(f'first 5:', sorted(t.name for t in tools)[:5])
"
# → total: 147
#   all openreply_ prefixed: True
#   first 5: ['openreply_analyze_paper', 'openreply_analyze_papers_bulk',
#             'openreply_audience_personas', 'openreply_audience_personas_get',
#             'openreply_clean_corpus']
```

**Status:** ✅ Server identifies as `openreply` v3.2.4. 147 `openreply_*` tools registered
(verified in-process via `mcp.list_tools()`). Initialize handshake responds
correctly over stdio.

### Install OpenReply MCP into your client

From any installed OpenReply.app:

```bash
.venv/bin/openreply mcp install --client claude-code     # ~/.claude.json
.venv/bin/openreply mcp install --client claude-desktop  # macOS Library config
.venv/bin/openreply mcp install --client cursor          # ~/.cursor/mcp.json
.venv/bin/openreply mcp install --client windsurf
.venv/bin/openreply mcp install --client cline
```

The install command writes the entry with `--all-extras` (required — without
it, `uv run` strips `fastmcp` from the optional-deps extras group and the
server crashes on import).

After install: restart your MCP client → 147 tools appear under
`mcp__openreply__*`.

---

## 4. Public website API — openreply.myind.ai

Deployed via Vercel from `shaantanu9/openreply_web`. Two surfaces:
unauthenticated diagnostics, and bearer-authenticated operations.

### 4.1 Unauthenticated probes

```bash
curl -sS https://openreply.myind.ai/v1/health
# → {"ok":true}  HTTP 200

curl -sS -X POST -H "Content-Type: application/json" -d '{}' \
  https://openreply.myind.ai/v1/device/activate
# → {"ok":false,"error":"missing required fields"}  HTTP 400
#   (proves the endpoint mounted + validates input)

curl -sSI https://openreply.myind.ai/dashboard | head -1
# → HTTP/2 200  (returns HTML — client-side auth check redirects unauth)

curl -sSI https://openreply.myind.ai/redeem | head -1
# → HTTP/2 200  (returns HTML — same pattern)
```

**Status:** ✅ Production deployment is live + healthy. Endpoints respond at
sub-second latencies.

### 4.2 Bearer-authenticated endpoints

```bash
# Missing-bearer behavior — should be a clean 401, not a 500
curl -sS https://openreply.myind.ai/api/v1/licence/me
# → {"ok":false,"error":"missing bearer token"}  HTTP 401

curl -sS -X POST -H "Content-Type: application/json" -d '{"coupon_code":"OPENREPLY-LAUNCH"}' \
  https://openreply.myind.ai/api/v1/coupon/redeem
# → {"ok":false,"error":"missing bearer token"}  HTTP 401
```

To exercise the success paths you need a real Supabase access token. Easiest
way: sign in at https://openreply.myind.ai/sign-in, open DevTools → Application
→ Local Storage → copy the `access_token` from the `sb-…-auth-token` entry.
Then:

```bash
TOKEN="<paste here>"

# Returns the current licence + features
curl -sS -H "Authorization: Bearer $TOKEN" https://openreply.myind.ai/api/v1/licence/me \
  | jq '{ok, plan: .licence.plan_id, key: .licence.activation_key,
         devices: .licence.devices|length, max: .licence.max_devices}'

# Redeem the seeded launch coupon — issues a fresh activation key
curl -sS -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"coupon_code":"OPENREPLY-LAUNCH"}' \
  https://openreply.myind.ai/api/v1/coupon/redeem \
  | jq '{ok, activation_key, plan_id, is_trial}'
```

**Status:** ✅ All auth-gated endpoints reject unauthenticated traffic cleanly.
Coupon `OPENREPLY-LAUNCH` is seeded in Supabase with 100 redemptions, no expiry.

---

## 5. How the four parts integrate

| Cross-cut | Where it goes |
|---|---|
| **CLI ↔ DB** | Both venv `openreply` and the bundled `openreply-cli` use `openreply.core.config._resolve_data_dir()` → `~/Library/Application Support/com.shantanu.openreply/openreply/openreply.db`. Single SQLite file, both readers see identical state. |
| **CLI ↔ MCP** | `openreply mcp serve` is the SAME entrypoint module, just with `FastMCP` driving stdio I/O. Every MCP tool ultimately calls into `openreply.research.*` / `openreply.fetch.*` / etc. — no parallel implementations. |
| **GUI ↔ CLI** | Tauri host (`openreply` Rust binary) spawns `openreply-cli` for every backend op via `tokio::process::Command`. `OPENREPLY_DATA_DIR` env is passed in explicitly so the sidecar opens the same DB the GUI reads. |
| **CLI ↔ Website** | When activation is required (gate ON), the Rust `license_activate` command POSTs to `openreply.myind.ai/v1/device/activate`. JWT secret on both sides MUST match (`JWT_DESKTOP_SECRET` ↔ Vercel's `TOKEN_SIGNING_SECRET`). |
| **Website ↔ Supabase** | All website endpoints (signup, trial start, coupon redeem, licence me) talk to Supabase project `tjikcnsfaaqihgegecpi`. Tables: `licenses`, `license_devices`, `coupons`, `coupon_redemptions`, `mcp_events`, …. |

---

## 6. Known limitations (intentional, documented)

| Limitation | Reason | Workaround |
|---|---|---|
| License gate is **OFF by default** (`OPENREPLY_LICENSE_GATE_ENABLED` unset) | DMG distribution to friends doesn't need accounts | Flip to `true` when you start issuing paid keys |
| `mailer_autoconfirm: true` on Supabase auth | Frictionless signup — no email verification today | Wire Resend SMTP + flip to `false` via the runbook in `docs/manual-todo/resend-setup.md` |
| Bundled DMG is **ad-hoc signed** (not Developer-ID notarized) | Faster local builds | Run `scripts/publish-mac.sh --sign` with Apple env in `.env.publish` for notarized DMG |
| First launch on Gatekeeper-protected Mac requires right-click → Open | Ad-hoc sig | One-time per recipient |
| MCP tools that hit external APIs (Reddit, Anthropic, etc.) need credentials | BYOK pattern | Settings → BYOK (or env vars) |

---

## 7. Reproduction recipes

### Test the local CLI

```bash
cd ~/Documents/GitHub/reddit-myind
uv pip install -e .
.venv/bin/openreply health --json
.venv/bin/openreply info --json
.venv/bin/openreply research search-all --query "your topic"
```

### Test the bundled DMG sidecar (without launching the GUI)

```bash
hdiutil attach "$HOME/Desktop/OpenReply_0.1.0_aarch64.dmg" -nobrowse -quiet
CLI="/Volumes/OpenReply/OpenReply.app/Contents/MacOS/openreply-cli"
"$CLI" health --json
"$CLI" info --json
hdiutil detach "/Volumes/OpenReply" -quiet
```

### Test the MCP server end-to-end against Claude Code

```bash
.venv/bin/openreply mcp install --client claude-code
# → writes ~/.claude.json with the openreply entry
# Restart Claude Code → check the /mcp panel → 147 tools live
```

### Test the production website API

```bash
curl https://openreply.myind.ai/v1/health        # → {"ok":true}
# All other endpoints: see Section 4 above
```

### Launch the full GUI

```bash
open "$HOME/Desktop/OpenReply_0.1.0_aarch64.dmg"  # mounts in Finder
# Drag OpenReply.app to /Applications
# Right-click → Open the first time (Gatekeeper)
```

---

## 8. Test result summary (2026-05-25)

| Layer | Test | Result |
|---|---|---|
| Python CLI (venv) | health, info, query | ✅ |
| Python CLI (bundled) | health, info, query, search-all | ✅ |
| MCP server | initialize handshake | ✅ (`{name: "openreply", v: "3.2.4"}`) |
| MCP tool registry | list_tools, prefix audit | ✅ (147 tools, all `openreply_*`) |
| Website /v1/health | unauth GET | ✅ (200, `{"ok":true}`) |
| Website /v1/device/activate | empty POST | ✅ (400, `"missing required fields"`) |
| Website /api/v1/licence/me | unauth GET | ✅ (401, `"missing bearer token"`) |
| Website /api/v1/coupon/redeem | unauth POST | ✅ (401, `"missing bearer token"`) |
| Website /dashboard | unauth GET | ✅ (200 HTML, 11k bytes) |
| Website /redeem | unauth GET | ✅ (200 HTML, 10k bytes) |
| Supabase migrations | tables + redeem_coupon() | ✅ (applied via Management API) |
| Seeded coupon | `OPENREPLY-LAUNCH` | ✅ (100 redemptions, no expiry) |
| GUI from DMG | process spawn + Home loaded | ✅ (saw `openreply`, `openreply-cli enrich-worker --serve`, `product-list` calls in `ps aux`) |

---

## 9. What to update next time

- Bump `version` in `tauri.conf.json` + `pyproject.toml` before each DMG cut
- Re-run Section 8's matrix end-to-end on the new DMG
- Update the activation-flow status in Section 6 if you flip the license gate ON
- If you wire Resend SMTP, update the `mailer_autoconfirm` line under known limitations
