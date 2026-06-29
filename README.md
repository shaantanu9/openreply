# OpenReply

**Multi-source product research — desktop app, MCP server, and CLI.**

OpenReply collects signals from 23+ sources (Reddit, Hacker News, arXiv, PubMed, GitHub, App Store, YouTube, and more), runs LLM synthesis across 8 providers, and surfaces the gaps competitors haven't filled.

Three surfaces, one SQLite store:

| Surface | Use it when |
|---|---|
| **Desktop app** (`OpenReply.app`) | GUI research — collect, synthesize, graph, export |
| **MCP server** (90+ tools) | Claude Code / Cursor integration — research inside your IDE |
| **CLI** (`openreply`) | Automation, scripting, headless pipelines |

---

## Install

### MCP server + CLI (Python, no desktop required)

Requirements: Python 3.11+, [uv](https://docs.astral.sh/uv/).

```bash
git clone https://github.com/shaantanu9/openreply.git && cd openreply
uv sync --all-extras        # everything (fetch + mcp + analyze + dev)
# or: uv sync               # base fetch only
# or: uv sync --extra mcp   # + MCP server
# or: uv sync --extra analyze  # + LLM analysis
```

### Desktop app

**Download OpenReply → [openreply.myind.ai](https://openreply.myind.ai/)**

Or pull a build directly: `.dmg` (macOS Apple Silicon + Intel) / `.msi` / `.exe` (Windows) / `.AppImage` / `.deb` (Linux) from the [latest release](https://github.com/myind-ai/openreply/releases/latest).

---

## Quick start

### 1. Reddit auth (OAuth — no password stored)

```bash
uv run openreply auth login    # opens browser, writes token to ~/.config/openreply/.env
uv run openreply auth check    # verify
```

### 2. Add an LLM key (for synthesis and gap-finding)

```bash
export ANTHROPIC_API_KEY=sk-...   # or OPENAI_API_KEY / GEMINI_API_KEY / OLLAMA auto-detected
```

### 3. Research a topic end-to-end

```bash
uv run openreply research discover --topic "meditation apps"   # find subreddits
uv run openreply research collect  --topic "meditation apps"   # pull all sources
uv run openreply research gaps     --topic "meditation apps" --provider anthropic
uv run openreply research report   --topic "meditation apps" --out report.md
```

---

## MCP server (Claude Code / Cursor)

Add to your Claude Code config in one command:

```bash
uv run openreply mcp install
```

Or wire it manually:

```json
{
  "mcpServers": {
    "openreply": {
      "command": "uv",
      "args": ["--directory", "/absolute/path/to/openreply", "run", "openreply", "mcp", "serve"]
    }
  }
}
```

For Cursor (HTTP daemon, survives 5-min cycling):

```bash
uv run openreply mcp install --client cursor
bash scripts/mcp_http_daemon.sh start
```

**90+ tools across 9 categories:**

| Category | Example tools |
|---|---|
| Fetch | `openreply_fetch_posts`, `openreply_fetch_hn`, `openreply_fetch_arxiv`, `openreply_fetch_youtube` |
| Research | `openreply_research_collect`, `openreply_find_gaps`, `openreply_synthesize_insights` |
| Papers | `openreply_paper_research_pipeline`, `openreply_paper_chunk_search`, `openreply_paper_fulltext` |
| Graph | `openreply_graph_build`, `openreply_graph_communities`, `openreply_graph_pagerank` |
| Product mode | `openreply_product_signals`, `openreply_product_digest`, `openreply_product_sweep` |
| Personas | `openreply_audience_personas`, `openreply_launch_brief` |
| Export | `openreply_export_docx`, `openreply_export_pptx`, `openreply_papers_export` |
| Jobs | `openreply_jobs_submit`, `openreply_jobs_get` (async, survives reconnects) |
| Admin | `openreply_diagnostics`, `openreply_describe_schema`, `openreply_query_db` |

Full reference: [`MCP_TOOLS.md`](MCP_TOOLS.md)

---

## CLI reference

```bash
# Fetch (all writes to SQLite with dedup)
uv run openreply fetch posts --sub resumes --sort hot --limit 100
uv run openreply fetch hn    --query "product research" --limit 50
uv run openreply fetch arxiv --query "LLM agents" --limit 20
uv run openreply fetch historical --sub resumes --days 730  # pullpush, 2012–2025

# Search, query, export
uv run openreply search "ATS resume" --sub cscareerquestions
uv run openreply query "SELECT author, count(*) c FROM posts GROUP BY author ORDER BY c DESC LIMIT 20"
uv run openreply export posts --sub resumes --since 7d --format csv --out out.csv

# Analyze
uv run openreply analyze themes     --sub resumes --since 7d --provider anthropic
uv run openreply analyze painpoints --sub cscareerquestions --top 50

# Ingest local files
uv run openreply ingest file   path/to/doc.pdf  --topic "meditation apps"
uv run openreply ingest folder path/to/docs/    --topic "meditation apps"

# MCP
uv run openreply mcp serve          # stdio (Claude Code)
uv run openreply mcp install        # write to ~/.claude.json
uv run openreply mcp status
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
openreply/
  src/openreply/
    sources/     # 23+ source adapters (one file each)
    core/        # client, db, config, exporters
    fetch/       # posts, comments, users, search, stream
    analyze/     # providers (anthropic/openai/ollama/gemini) + themes/gaps/synthesis
    graph/       # knowledge graph (structural + semantic + relations)
    mcp/         # FastMCP server (90+ tools, async job queue, Palace search)
    cli/         # Typer entry point (openreply)
  app-tauri/     # Tauri 2 desktop app (OpenReply.app)
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
  OPENREPLY_GUIDE.md    — end-user desktop app guide
  MCP_INFRA.md          — MCP transport, job queue, operating playbook
  FEATURES.md           — feature coverage and status
  manual-todo/          — manual steps (certs, secrets, store setup)
```

---

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). The quickest way to contribute:

- **New data source** — add a source adapter in `src/openreply/sources/` (~50 lines, follow `arxiv.py`)
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
