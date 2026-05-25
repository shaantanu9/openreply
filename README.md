# Gap Map

**Multi-source product research — desktop app, MCP server, and CLI.**

Gap Map collects signals from 23+ sources (Reddit, Hacker News, arXiv, PubMed, GitHub, App Store, YouTube, and more), runs LLM synthesis across 8 providers, and surfaces the gaps competitors haven't filled.

Three surfaces, one SQLite store:

| Surface | Use it when |
|---|---|
| **Desktop app** (`Gap Map.app`) | GUI research — collect, synthesize, graph, export |
| **MCP server** (90+ tools) | Claude Code / Cursor integration — research inside your IDE |
| **CLI** (`gapmap`) | Automation, scripting, headless pipelines |

---

## Install

### MCP server + CLI (Python, no desktop required)

Requirements: Python 3.11+, [uv](https://docs.astral.sh/uv/).

```bash
git clone https://github.com/shaantanu9/gap-map-pro.git && cd gap-map-pro
uv sync --all-extras        # everything (fetch + mcp + analyze + dev)
# or: uv sync               # base fetch only
# or: uv sync --extra mcp   # + MCP server
# or: uv sync --extra analyze  # + LLM analysis
```

### Desktop app

Download the latest `.dmg` (macOS) / `.msi` (Windows) / `.AppImage` (Linux) from the [Releases](https://github.com/shaantanu9/gap-map-pro/releases) page.

---

## Quick start

### 1. Reddit auth (OAuth — no password stored)

```bash
uv run gapmap auth login    # opens browser, writes token to ~/.config/gapmap/.env
uv run gapmap auth check    # verify
```

### 2. Add an LLM key (for synthesis and gap-finding)

```bash
export ANTHROPIC_API_KEY=sk-...   # or OPENAI_API_KEY / GEMINI_API_KEY / OLLAMA auto-detected
```

### 3. Research a topic end-to-end

```bash
uv run gapmap research discover --topic "meditation apps"   # find subreddits
uv run gapmap research collect  --topic "meditation apps"   # pull all sources
uv run gapmap research gaps     --topic "meditation apps" --provider anthropic
uv run gapmap research report   --topic "meditation apps" --out report.md
```

---

## MCP server (Claude Code / Cursor)

Add to your Claude Code config in one command:

```bash
uv run gapmap mcp install
```

Or wire it manually:

```json
{
  "mcpServers": {
    "gapmap": {
      "command": "uv",
      "args": ["--directory", "/absolute/path/to/gap-map-pro", "run", "gapmap", "mcp", "serve"]
    }
  }
}
```

For Cursor (HTTP daemon, survives 5-min cycling):

```bash
uv run gapmap mcp install --client cursor
bash scripts/mcp_http_daemon.sh start
```

**90+ tools across 9 categories:**

| Category | Example tools |
|---|---|
| Fetch | `gapmap_fetch_posts`, `gapmap_fetch_hn`, `gapmap_fetch_arxiv`, `gapmap_fetch_youtube` |
| Research | `gapmap_research_collect`, `gapmap_find_gaps`, `gapmap_synthesize_insights` |
| Papers | `gapmap_paper_research_pipeline`, `gapmap_paper_chunk_search`, `gapmap_paper_fulltext` |
| Graph | `gapmap_graph_build`, `gapmap_graph_communities`, `gapmap_graph_pagerank` |
| Product mode | `gapmap_product_signals`, `gapmap_product_digest`, `gapmap_product_sweep` |
| Personas | `gapmap_audience_personas`, `gapmap_launch_brief` |
| Export | `gapmap_export_docx`, `gapmap_export_pptx`, `gapmap_papers_export` |
| Jobs | `gapmap_jobs_submit`, `gapmap_jobs_get` (async, survives reconnects) |
| Admin | `gapmap_diagnostics`, `gapmap_describe_schema`, `gapmap_query_db` |

Full reference: [`MCP_TOOLS.md`](MCP_TOOLS.md)

---

## CLI reference

```bash
# Fetch (all writes to SQLite with dedup)
uv run gapmap fetch posts --sub resumes --sort hot --limit 100
uv run gapmap fetch hn    --query "product research" --limit 50
uv run gapmap fetch arxiv --query "LLM agents" --limit 20
uv run gapmap fetch historical --sub resumes --days 730  # pullpush, 2012–2025

# Search, query, export
uv run gapmap search "ATS resume" --sub cscareerquestions
uv run gapmap query "SELECT author, count(*) c FROM posts GROUP BY author ORDER BY c DESC LIMIT 20"
uv run gapmap export posts --sub resumes --since 7d --format csv --out out.csv

# Analyze
uv run gapmap analyze themes     --sub resumes --since 7d --provider anthropic
uv run gapmap analyze painpoints --sub cscareerquestions --top 50

# Ingest local files
uv run gapmap ingest file   path/to/doc.pdf  --topic "meditation apps"
uv run gapmap ingest folder path/to/docs/    --topic "meditation apps"

# MCP
uv run gapmap mcp serve          # stdio (Claude Code)
uv run gapmap mcp install        # write to ~/.claude.json
uv run gapmap mcp status
```

All commands support `--json` for machine-readable NDJSON output.

Full reference: [`CLI_REFERENCE.md`](CLI_REFERENCE.md)

---

## Data sources

| Source | Via | Timeframe |
|---|---|---|
| Reddit live | PRAW OAuth | May 2025 → now |
| Reddit historical | Pullpush (Pushshift successor) | Dec 2012 → May 2025 |
| Hacker News | Algolia API | All time |
| arXiv / PubMed / OpenAlex / Semantic Scholar / Crossref | Public APIs | All time |
| GitHub repos + issues | GitHub API | All time |
| App Store + Google Play | Scraper | Current |
| YouTube | yt-dlp | Current |
| Google News + Trends | gnews / pytrends | Current |
| Stack Overflow | API | All time |
| Dev.to / ProductHunt | API | Current |
| Bluesky / Lemmy / Mastodon | API | Current |
| RSS | feedparser | Current |
| Trustpilot / AlternativeTo | Scraper | Current |
| Wikipedia | REST API | Current |
| Local files | PDF, CSV, MD, VTT, SRT | — |

---

## Pain-point classification

Historical + live data lets you classify gaps as:

- **CHRONIC** — strong in both eras → durable, safe to build
- **EMERGING** — only recent → early-mover opportunity
- **FADING** — only historical → likely solved

---

## Architecture

```
gap-map-pro/
  src/gapmap/
    sources/     # 23+ source adapters (one file each)
    core/        # client, db, config, exporters
    fetch/       # posts, comments, users, search, stream
    analyze/     # providers (anthropic/openai/ollama/gemini) + themes/gaps/synthesis
    graph/       # knowledge graph (structural + semantic + relations)
    mcp/         # FastMCP server (90+ tools, async job queue, Palace search)
    cli/         # Typer entry point (gapmap)
  app-tauri/     # Tauri 2 desktop app (Gap Map.app)
    src/         # Vanilla JS frontend (main.js, api.js, style.css)
    src-tauri/   # Rust shell + Python sidecar bridge
  prompts/       # YAML prompt templates — tune without touching code
  scripts/       # build, publish, fetch-ffmpeg, mcp_http_daemon
```

Full architecture: [`ARCHITECTURE.md`](ARCHITECTURE.md)

---

## Project layout

```
ARCHITECTURE.md   — system design, data flow, component map
MCP_TOOLS.md      — all 90+ MCP tools with parameters
CLI_REFERENCE.md  — all CLI commands
docs/
  GAP_MAP_GUIDE.md      — end-user desktop app guide
  MCP_INFRA.md          — MCP transport, job queue, operating playbook
  FEATURES.md           — feature coverage and status
  manual-todo/          — manual steps (certs, secrets, store setup)
```

---

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). The quickest way to contribute:

- **New data source** — add a source adapter in `src/gapmap/sources/` (~50 lines, follow `arxiv.py`)
- **Prompt improvements** — edit any `prompts/*.yaml` without touching code
- **Tests** — `tests/` is sparse; any coverage of real behavior is welcome
- **Bug reports** — use the [bug report template](.github/ISSUE_TEMPLATE/bug_report.yml)

---

## License

MIT — see [`LICENSE`](LICENSE).

---

## Responsible use

This tool is for **research and analysis**, not mass posting or vote manipulation.
Respect [Reddit's API terms](https://support.reddithelp.com/hc/en-us/articles/16160319875092)
and the [Responsible Builder Policy](https://support.reddithelp.com/hc/en-us/articles/42728983564564).
PRAW's built-in rate limiting (100 req/min OAuth) is left on — do not disable it.
