# Flutter port feasibility — can OpenReply become a Flutter app?

**Date:** 2026-04-21
**Short answer:** Yes, but there are three very different meanings of
"Flutter app" with very different costs and trade-offs. Pick the one
that matches what you actually want.

---

## TL;DR

| Path | Effort | Desktop? | Mobile? | Backend preserved? | Recommended when |
|---|---|---|---|---|---|
| **A — Flutter desktop UI, keep Python sidecar** | 3-4 wk | ✅ | ❌ | 100 % | You want desktop UX + one codebase across mac/win/linux |
| **B — Flutter UI + FastAPI localhost server** | 2-3 wk | ✅ | ⚠️ cloud | 100 % | Clean API boundary, future cloud path |
| **C — Full rewrite in Dart** | 3-5 months | ✅ | ✅ | 0 % (rewrite) | Mobile-first, willing to lose ChromaDB / FastMCP |

**Our recommendation: Path B now, evaluate C only after first 100
paying users.**

---

## 1. Current stack — what's holding us together

```
┌──────────────────────────────────────────────────┐
│  Tauri 2 (Rust core)                              │
│  + vanilla-JS frontend (4,500 lines style.css,   │
│    18 screen modules, 73 Tauri commands)          │
└────────────┬─────────────────────────────────────┘
             │ stdio pipe (JSON)
             ▼
┌──────────────────────────────────────────────────┐
│  Python CLI / MCP sidecar (~8,500 lines)         │
│  + 73 FastMCP tools                               │
│  + 30+ Typer CLI commands                         │
│  + PyInstaller bundle (~220 MB per rebuild)       │
└──┬────────┬───────────┬──────────┬──────────────┘
   │        │           │          │
   ▼        ▼           ▼          ▼
 SQLite  ChromaDB   Claude /    Reddit / HN /
  (WAL)  (MiniLM    OpenAI /    arXiv / AppStore
          ONNX)     Ollama …     (13+ sources)
```

The hard parts — the ones that make OpenReply *OpenReply* — all live in
the Python layer:

- Claude-native synthesis with Minto pyramid + Popper + Ulwick
  (`insights.py`, ~1,500 lines)
- ChromaDB MiniLM semantic gate (`relevance.py`, `relations.py`,
  `cluster.py`, `embedder.py`)
- Hypothesis state machine (`hypothesis_tracker.py`)
- Product Mode delta engine (`product_sweep.py`, `signals.py`,
  `product_digest.py`)
- Topic resolver + trash + feedback + saved views + custom prompts
- 13+ source adapters
- 73 MCP tools via FastMCP

These add up to roughly **8,500 lines of Python** plus battle-tested
third-party deps (chromadb, fastmcp, anthropic, openai, praw,
sqlite-utils, etc.). Rewriting any of it is expensive and risky.

---

## 2. Path A — Flutter desktop UI + keep Python sidecar

### What it looks like

```
┌────────────────────────────────────┐
│ Flutter desktop (Dart)             │
│  + 18 screens rewritten in widgets │
│  + uses `dart:io::Process`         │
└─────┬──────────────────────────────┘
      │ stdio / JSON
      ▼
┌────────────────────────────────────┐
│ Unchanged Python sidecar           │
│ (CLI + MCP + research engine)      │
└────────────────────────────────────┘
```

Flutter takes the role Tauri plays today — hosts the UI, spawns the
Python child, reads/writes JSON. Everything below the stdio line is
unchanged.

### What changes

- Frontend: `app-tauri/src/**` (~18 screens, 4,500 lines CSS, 73 API
  bindings) → rewritten in Dart / Flutter widgets.
- Tauri `commands.rs` → Dart wrapper that shells out to the same CLI
  commands with JSON output.
- `tauri.conf.json` / `capabilities/` → Flutter project scaffolding +
  `desktop` build targets.
- Sidecar packaging: still PyInstaller. The Flutter app bundle embeds
  it via `flutter_distributor` with platform-specific wiring.

### What stays

- **All 8,500 lines of Python research code.** Untouched.
- `pyproject.toml`, FastMCP server, 73 MCP tools, CLI entry point.
- ChromaDB, MiniLM ONNX, palace store, all 13+ source adapters.
- SQLite schema + WAL mode + every migration.
- Every contract we've shipped this session.

### Effort breakdown

| Task | Days |
|---|---|
| Flutter project scaffold + dependency setup | 1 |
| Port state management pattern (api.js → Dart Riverpod / Bloc) | 2 |
| Port 18 screens (home, topic, insights, bets, product, compare, etc.) | 10-14 |
| Theme system (light + dark, matches current palette) | 2 |
| Sidecar spawn + stdio JSON wrapper | 2 |
| Event streaming (collect log, chat stream) | 2 |
| Tab + route management | 2 |
| Packaging + code signing (macOS, Windows, Linux) | 3 |
| QA against the current Tauri app | 3 |
| **Total** | **~25 days** (~3-4 weeks) |

### Pros

- **Preserves 100 % of backend.** Zero risk to the research engine.
- **Native performance.** Flutter desktop is faster than WebView-based
  Tauri for heavy animations, large lists, canvas rendering.
- **Single Dart codebase** for mac / win / linux.
- **Better widget-level tests** (`flutter_test`) than our current
  vanilla-JS setup.

### Cons / risks

- **No mobile.** Python sidecar doesn't run on iOS; Android needs
  chaquopy or python-for-android which is fragile.
- **Packaging pain.** Bundling a 220 MB Python binary into a Flutter
  app is doable but less polished than Tauri's `externalBin` setup.
- **Two runtimes.** Dart + Python in one bundle. Bigger download
  (~250-300 MB) vs. Tauri's ~230 MB.
- **Process lifecycle.** We just shipped MCP zombie guards because
  subprocess lifecycle is tricky. Flutter's `Process` API gives you
  the same challenges — the guards we wrote today are still needed.
- **Loss of the vanilla-JS ecosystem.** The current frontend uses
  Lucide icons, dynamic imports, CSS-only dark mode. Flutter
  equivalents exist but require rewrites.

---

## 3. Path B — Flutter UI + Python as a FastAPI localhost server

### What it looks like

```
┌────────────────────────────────────┐
│ Flutter UI (Dart)                  │
│  + uses `package:dio` HTTP client  │
│  + WebSocket for streaming events  │
└─────┬──────────────────────────────┘
      │ HTTP + WebSocket (localhost:8732)
      ▼
┌────────────────────────────────────┐
│ Python FastAPI server              │
│  wraps the existing CLI + MCP      │
│  fastapi + uvicorn reading from    │
│  the same modules                  │
└────────────────────────────────────┘
```

Instead of stdio, we put a tiny HTTP API in front of the existing
Python research engine. Every current `@tauri::command` becomes a
`@app.post("/topic/{topic}/synthesize")` endpoint. Every streaming
operation becomes a WebSocket endpoint.

### Why this might be better than A

- **Clean contract.** OpenAPI spec from the FastAPI routes → Flutter
  generates its client. No manual JSON gymnastics.
- **Mobile path.** If we later run the Python server in the cloud
  instead of localhost, a Flutter mobile app works unchanged. Local
  and cloud share one API.
- **Testability.** HTTP endpoints are trivially testable with
  `httpx.AsyncClient` — no need to mock subprocesses.
- **Windows subprocess pain avoided.** Windows has famously bad
  stdio buffering in Python; localhost HTTP sidesteps it.
- **Multiple clients.** Future CLI, web UI, or mobile app all speak
  to the same local daemon.

### Why not

- **One more layer** to start / stop / health-check.
- **Port collision risk** (pick a random high port, retry on conflict).
- **Slight latency overhead** (~1-2 ms per call vs. stdio's ~0.5 ms).
- **Not significantly easier** than Path A if you don't care about
  mobile or multi-client.

### Effort

Same UI port as A (~3 weeks) plus **3-5 days** to add the FastAPI
layer + the localhost daemon lifecycle. Total ~3.5-4 weeks.

### Reuses existing work

The hand-rolled async job management in `cli.rs` (spawning Python
children, tracking PIDs, sending SIGTERM, event streaming) becomes
unnecessary. FastAPI + WebSockets handle all of that cleanly.

---

## 4. Path C — Full rewrite to Dart

### What this means

Everything in Dart. No Python. Flutter app runs on mac, win, linux,
iOS, Android from one codebase.

### What has to be rewritten

| Python file / module | ~LOC | Dart equivalent | Exists? |
|---|---|---|---|
| `research/insights.py` | 1,500 | Claude SDK for Dart + custom synth | Partial — `anthropic_dart` exists, thin |
| `research/insights.py` — Minto / Popper / Ulwick logic | 500 | Pure port | Must be written |
| `research/relevance.py`, `relations.py`, `cluster.py` | 800 | ONNX runtime + MiniLM | Doable — `onnxruntime` Dart pkg |
| ChromaDB persistent client | deps only | `sqlite3` + custom HNSW in Dart | **Nothing off-the-shelf** |
| FastMCP server (`mcp/server.py`) | 1,400 | MCP impl in Dart | **Does not exist** |
| 13+ source adapters | 2,000 | Dart HTTP clients | Port each |
| 30+ CLI Typer commands | 2,500 | Dart `args` package | Port each |
| Product Mode (`product_*.py`) | 1,200 | Pure port | Must be written |
| Hypothesis / trash / topic resolver / feedback / saved views | 800 | Pure port | Must be written |
| Prompt templates (prompts/*.yaml) | — | Same YAML | No change |

**Total: ~10,000 lines of Python → ~15,000 lines of Dart** (Dart is
more verbose for the same logic).

### The unsolvable parts

- **ChromaDB has no Dart equivalent.** Their Rust core is being
  factored out (`chromadb-core`) but no FFI / Dart bindings exist as
  of late 2025. Options:
  1. Use `hnswlib` via FFI — possible but non-trivial; you rewrite the
     palace layer.
  2. Outsource embeddings to an HTTP service (OpenAI, Anthropic) —
     kills the offline-first story.
  3. Ship without semantic search — kills 30 % of the product value.
- **FastMCP in Dart doesn't exist.** You'd be building the MCP server
  from scratch + keeping the Python one in parallel for Claude Code /
  Cursor users.
- **PRAW has no Dart equivalent.** Raw Reddit OAuth is doable via
  Dart's `oauth2` package but it's another rewrite.

### Effort

Realistic estimate: **3-5 engineer-months** full-time. More if you
want feature parity with today's 73 MCP tools + 30 CLI commands.

### Pros

- True single-codebase across desktop + mobile.
- No Python runtime → smaller bundles (30 MB vs. 250 MB).
- Dart / Flutter is genuinely nicer than vanilla JS for UI work.

### Cons

- 3-5 months of engineering with zero user-facing progress.
- Loss of the Python ecosystem: no drop-in `praw`, no `anthropic`
  SDK updates, no `chromadb` improvements. You maintain your own.
- MCP is Python-native. Claude Code + Cursor already work with
  Python. Rewriting it is a strictly negative ROI move unless you
  keep a Python MCP in parallel (which defeats the "one language"
  pitch).
- Every new research feature now has to be written in Dart.

---

## 5. Mobile as a separate question

None of the three paths give you "free" mobile:

- **Path A / B:** desktop-only. Mobile would need a hosted cloud
  Python server (Phase D/E/G territory from the Dual-Mode Pivot —
  explicitly deferred today).
- **Path C:** mobile works, but you lost ChromaDB semantic search,
  FastMCP, and 6 months of research features.

If mobile is a hard requirement within 6 months, the realistic plan
is not C. It's:

1. Keep the Python backend.
2. Run it in a small managed container (Fly.io, Railway, etc.).
3. Build a Flutter mobile app that talks to it over HTTPS.
4. Desktop keeps the local-first story; mobile uses the cloud.

This is Phase D/E/G of the Dual-Mode Pivot you already have written
up. Flutter makes the mobile side easier, not harder.

---

## 6. What we'd recommend — concretely

### If you just want a Flutter UI because Tauri / vanilla-JS frustrates you

**Path A.** Port the UI, keep the sidecar. 3-4 weeks. Zero backend
risk. Every feature we've built this session still works.

### If you're thinking ahead to mobile + cloud

**Path B.** Add a FastAPI layer (5 days), then port the UI to Flutter
(~3 weeks). The FastAPI server runs locally today, in the cloud
later. Mobile Flutter ships on top unchanged.

### If someone tells you "just rewrite it in Flutter for mobile"

Don't. Path C loses every moat we've built. Go Path B + hosted
Python server. You get mobile + keep ChromaDB + keep FastMCP +
keep Python ecosystem.

---

## 7. Cost / benefit calibration

To make the recommendation concrete — our investment in the current
Python backend across this session:

- 8,500 lines of tested Python
- 73 MCP tools
- 30+ CLI commands
- 21 passing regression tests
- ChromaDB + MiniLM offline semantic search
- Production guards (MCP zombies, data-dir single source of truth)
- Full Product Mode (Dual-Mode Pivot phases A/B/C/F)

Total effort in that Python stack: **~4-6 months** of equivalent
greenfield work. Rewriting it in Dart (Path C) doesn't add product
value; it re-pays that invoice.

Rewriting the UI (Path A / B) costs 3-4 weeks and trades vanilla-JS
for Flutter widgets. Whether that's worth it depends on how much
frontend effort you expect in the next year:

- If we're shipping 5+ new screens in the next 6 months → Flutter pays
  back.
- If the UI is mostly stable → don't bother.

---

## 8. Concrete proof-of-concept plan (if you want to validate Path B)

Before committing to the full 3-4 week port, validate the FastAPI
layer first. 3 days of work:

### Day 1 — FastAPI scaffold

- Add `fastapi` + `uvicorn` deps.
- One endpoint: `GET /health` returns `{status: ok, data_dir: ...}`.
- Run as `reddit-cli serve-http --port 8732`.

### Day 2 — Wrap existing commands

- `POST /topics` → `list_products()` equivalent.
- `POST /topic/{topic}/synthesize` → wraps `synthesize_insights()`.
- `GET /topic/{topic}/insights` → reads cached report.
- `WebSocket /collect/{topic}` → streams collect-log events.

### Day 3 — Minimal Flutter proof

- New `app-flutter/` directory with Flutter desktop scaffold.
- One screen: list topics, open one, render the Minto header.
- Uses `package:dio` against `localhost:8732`.

End-state: we know whether FastAPI + Flutter + Python daemon work
together, without committing to porting the full UI. Decision point
after day 3.

---

## 9. Summary

- **Can it be converted to Flutter?** Yes.
- **Should the backend be rewritten?** No — that's 3-5 months with
  zero product value added. Path C is a trap.
- **Should the frontend be rewritten?** Maybe. Flutter desktop is
  genuinely nicer than our vanilla-JS stack, but 3-4 weeks buys
  aesthetic + DX improvements, not user-facing features.
- **For mobile — is Flutter the answer?** Flutter on top, Python in
  the cloud. That's the Dual-Mode Pivot D/E/G plan with a Flutter
  mobile client. No shortcut.

**Decision owner: whoever holds the product roadmap.** If retention
is the constraint, ship more research features on the current stack
first. If the UI is actively blocking users (they can't use it
fluently), Path A or B wins.

For the next 30 days, our investment compounds more when spent on
shipping Tier-1..6 polish and the Dual-Mode Pivot D/E/G validation
than on a Flutter rewrite.
