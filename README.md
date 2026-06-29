# OpenReply

**Open-source social marketing reply & content co-pilot — desktop app, MCP server, and CLI.**

OpenReply listens across 20+ sources (Reddit, Hacker News, X, Mastodon, Bluesky, Dev.to, Stack Overflow, Product Hunt, and more), surfaces the conversations worth joining, and drafts on-brand replies & content with your own AI agents — bring-your-own-LLM across 8 providers.

Three surfaces, one SQLite store:

| Surface | Use it when |
|---|---|
| **Desktop app** (`OpenReply.app`) | GUI — find opportunities, manage agents, draft replies & posts |
| **MCP server** | Claude Code / Cursor integration — research & drafting inside your IDE |
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

### 1. Add an LLM key (bring your own)

```bash
export ANTHROPIC_API_KEY=sk-...   # or OPENAI_API_KEY / GEMINI_API_KEY / OLLAMA auto-detected
```

### 2. Create an agent (your brand/niche persona)

```bash
uv run openreply agent create --name "Acme Notes" --niche "AI note-taking" \
  --persona "ex-teacher, founder" --keywords "note taking app, obsidian alternative"
uv run openreply agent learn          # build the agent's knowledge from its sources
```

### 3. Find conversations and draft on-brand replies

```bash
uv run openreply reply find                    # score reply opportunities across sources
uv run openreply reply draft --id <opp-id>     # draft an on-voice reply
uv run openreply content generate --kind post  # draft original content from agent knowledge
uv run openreply reply queue                   # review the queue before posting
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

**120 tools across these categories:**

| Category | Example tools |
|---|---|
| Fetch (sources) | `openreply_fetch_posts`, `openreply_fetch_hn`, `openreply_fetch_x`, `openreply_fetch_mastodon`, `openreply_fetch_youtube` |
| Corpus | `openreply_collect`, `openreply_get_corpus`, `openreply_discover_subs`, `openreply_sub_stats` |
| Graph (brain) | `openreply_graph_build`, `openreply_graph_communities`, `openreply_graph_neighbors` |
| Memory | `openreply_palace_status`, `openreply_palace_reindex`, `openreply_semantic_search` |
| Connections | `openreply_creds_list`, `openreply_creds_verify`, `openreply_connections` |
| Jobs | `openreply_jobs_submit`, `openreply_jobs_get` (async, survives reconnects) |
| Admin | `openreply_diagnostics`, `openreply_describe_schema`, `openreply_query_db` |

Full reference: [`MCP_TOOLS.md`](MCP_TOOLS.md)

---

## CLI reference

```bash
# Agents — your brand/niche personas
uv run openreply agent create --name "Acme Notes" --niche "AI note-taking" --keywords "obsidian alternative"
uv run openreply agent learn                 # build knowledge from the agent's sources
uv run openreply agent watch-add --handle naval   # track a creator to learn from / repurpose

# Find & reply
uv run openreply reply find                  # score reply opportunities across all sources
uv run openreply reply draft --id <opp-id>   # draft an on-voice reply
uv run openreply reply queue                 # review queued replies
uv run openreply reply post-due              # post approved/scheduled replies

# Content
uv run openreply content generate --kind post     # post | thread | script | article | repurpose
uv run openreply content list

# Publish (credential-gated, opt-in)
uv run openreply publish x --id <content-id>

# Search, query, export, ingest
uv run openreply search "ATS resume" --sub cscareerquestions
uv run openreply query "SELECT author, count(*) c FROM posts GROUP BY author ORDER BY c DESC LIMIT 20"
uv run openreply ingest url https://example.com/post   # pull a page into the corpus

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

## Architecture

```
openreply/
  src/openreply/
    sources/     # 20+ source adapters (one file each)
    core/        # client, db, config, exporters
    fetch/       # posts, comments, users, search, stream
    analyze/     # LLM providers (anthropic/openai/ollama/gemini)
    reply/       # agents, opportunities, drafting, brain, knowledge, content, watch
    persona/     # persona memory + knowledge blend
    graph/       # knowledge graph (structural + semantic + relations)
    retrieval/   # embeddings + Palace semantic memory
    mcp/         # FastMCP server (120 tools, async job queue, Palace search)
    cli/         # Typer entry point (openreply)
  app-tauri/     # Tauri 2 desktop app (OpenReply.app)
    src/or/      # Vanilla JS frontend (views, shell, api, dynamic)
    src-tauri/   # Rust shell + Python sidecar bridge
  prompts/       # YAML prompt templates — tune without touching code
  scripts/       # build, publish, fetch-ffmpeg, mcp_http_daemon
```

Full architecture: [`ARCHITECTURE.md`](ARCHITECTURE.md)

---

## Project layout

```
ARCHITECTURE.md   — system design, data flow, component map
MCP_TOOLS.md      — MCP tools with parameters
CLI_REFERENCE.md  — all CLI commands
docs/
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

OpenReply is for **genuine, on-brand participation** — drafting replies and content
you review before posting. It is **not** for spam, mass posting, or vote manipulation.
Keep a human in the loop, respect each platform's terms (e.g.
[Reddit's API terms](https://support.reddithelp.com/hc/en-us/articles/16160319875092)
and the [Responsible Builder Policy](https://support.reddithelp.com/hc/en-us/articles/42728983564564)),
and leave built-in rate limiting on — do not disable it.
