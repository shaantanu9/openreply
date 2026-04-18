# reddit-myind

Reddit research toolkit — **PRAW fetch → SQLite store → optional LLM analysis**.
Two surfaces: a `reddit-cli` for humans/scripts, and an MCP server for Claude Code.

## Install (uv — one command)

This project is managed by [uv](https://docs.astral.sh/uv/) — it handles Python,
the venv, and the lockfile automatically. Install uv once:

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
# or: pip install uv
```

Then:

```bash
git clone <this-repo> && cd reddit-myind
uv sync --all-extras               # everything (praw + mcp + analyze + dev)
# or: uv sync                      # base only
# or: uv sync --extra mcp          # base + MCP server
# or: uv sync --extra analyze      # base + LLM analysis
```

Run commands with `uv run`, or activate the venv:

```bash
uv run reddit-cli --help
# or:
source .venv/bin/activate
reddit-cli --help
```

## Setup (OAuth, no password stored)

1. Go to https://www.reddit.com/prefs/apps → **create another app**
2. Type: **web app**. Redirect URI: `http://localhost:8080`
3. Note the **client ID** (small text under the app name) and **secret**.
4. Run:

```bash
reddit-cli auth login      # prompts for client id+secret, opens browser, writes ~/.config/reddit-myind/.env
reddit-cli auth check      # verify it works
```

The OAuth refresh token is stored in `~/.config/reddit-myind/.env` (chmod 600). Your Reddit password is never asked for or stored. PRAW refreshes the access token automatically from here on.

## CLI usage

Prefix every command below with `uv run` (or activate `.venv` once).

```bash
# fetch — all writes to SQLite (data/reddit.db) with dedup
uv run reddit-cli fetch posts --sub resumes --sort hot --limit 100
uv run reddit-cli fetch comments --post <post_id> --depth 5
uv run reddit-cli fetch user --name spez --limit 200
uv run reddit-cli search "ATS resume" --sub cscareerquestions --limit 50

# stream — keyword monitor that appends hits to SQLite
uv run reddit-cli stream --sub resumes --keywords "ats,rejection"

# query / export — zero LLM
uv run reddit-cli query "SELECT author, count(*) c FROM posts WHERE sub='resumes' GROUP BY author ORDER BY c DESC LIMIT 20"
uv run reddit-cli export posts --sub resumes --since 7d --format csv --out out.csv

# analyze — needs an LLM key
uv run reddit-cli analyze themes --sub resumes --since 7d --provider anthropic
uv run reddit-cli analyze summarize --post <post_id>
uv run reddit-cli analyze painpoints --sub cscareerquestions --top 50

# mcp
uv run reddit-cli mcp serve
```

All commands support `--json` for machine-readable output.

## MCP (Claude Code)

Add to your Claude Code settings:

```json
{
  "mcpServers": {
    "reddit-myind": {
      "command": "uv",
      "args": ["--directory", "/absolute/path/to/reddit-myind", "run", "reddit-cli", "mcp", "serve"]
    }
  }
}
```

Tools exposed: `reddit_fetch_posts`, `reddit_fetch_comments`, `reddit_fetch_user`,
`reddit_search`, `reddit_query_db`, `reddit_sub_stats`.

The MCP server intentionally has **no LLM calls** — Claude Code is the LLM.

## Data model (SQLite)

- `fetches` — audit log of every fetch
- `subreddits`, `posts`, `comments`, `users` — deduped on Reddit ID
- `streams`, `stream_hits` — keyword monitor hits

## Project layout

```
src/reddit_research/
  core/      # client, db, config, exporters
  fetch/     # posts, comments, users, search, stream
  analyze/   # providers (anthropic/openai/ollama) + themes/summarize/painpoints
  cli/       # Typer app (entry point: reddit-cli)
  mcp/       # FastMCP server
```

## Responsible use

This tool is for **research and analysis**, not mass posting or vote manipulation.
Respect [Reddit's API terms](https://support.reddithelp.com/hc/en-us/articles/16160319875092)
and the [Responsible Builder Policy](https://support.reddithelp.com/hc/en-us/articles/42728983564564).
PRAW's built-in rate limiting (100 req/min OAuth) is left on by default — do not disable it.
