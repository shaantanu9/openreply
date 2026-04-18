# reddit-myind

Reddit research toolkit — **PRAW fetch → SQLite store → optional LLM analysis**.
Two surfaces: a `reddit-cli` for humans/scripts, and an MCP server for Claude Code.

## Install

```bash
git clone <this-repo> && cd reddit-myind
python3.11 -m venv .venv && source .venv/bin/activate
pip install -e ".[all]"          # everything
# or: pip install -e .            # base (fetch + CLI + DB only)
# or: pip install -e ".[mcp]"     # base + MCP server
# or: pip install -e ".[analyze]" # base + LLM analysis
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

```bash
# fetch — all writes to SQLite (data/reddit.db) with dedup
reddit-cli fetch posts --sub resumes --sort hot --limit 100
reddit-cli fetch comments --post <post_id> --depth 5
reddit-cli fetch user --name spez --limit 200
reddit-cli search "ATS resume" --sub cscareerquestions --limit 50

# stream — keyword monitor that appends hits to SQLite
reddit-cli stream --sub resumes --keywords "ats,rejection" --tag pain-points

# query / export — zero LLM
reddit-cli query "SELECT author, count(*) c FROM posts WHERE sub='resumes' GROUP BY author ORDER BY c DESC LIMIT 20"
reddit-cli export posts --sub resumes --since 7d --format csv --out out.csv

# analyze — needs an LLM key
reddit-cli analyze themes --sub resumes --since 7d --provider anthropic
reddit-cli analyze summarize --post <post_id>
reddit-cli analyze painpoints --sub cscareerquestions --top 50

# mcp
reddit-cli mcp serve
```

All commands support `--json` for machine-readable output.

## MCP (Claude Code)

Add to your Claude Code settings:

```json
{
  "mcpServers": {
    "reddit-myind": {
      "command": "reddit-cli",
      "args": ["mcp", "serve"],
      "env": { "REDDIT_MYIND_DATA_DIR": "/absolute/path/to/data" }
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
