# reddit-myind — design

**Date:** 2026-04-18
**Status:** MVP

## Goal

A single Python package that exposes Reddit research as both a CLI and an MCP server,
backed by SQLite for dedup + queryability, with optional pluggable LLM analysis.

## Surfaces

1. **CLI** (`reddit-cli`) — Typer app. Primary human/script interface. Always usable.
2. **MCP server** — FastMCP. For Claude Code sessions. No LLM calls inside; Claude is the LLM.

Both share the same `core/` + `fetch/` modules. Zero duplication.

## Modules

| Module | Responsibility |
|--------|---------------|
| `core.config` | Load `.env` / `config.toml`, resolve data dir, validate secrets |
| `core.client` | PRAW `Reddit` singleton, lazy-init, rate-limit respecting |
| `core.db` | SQLite schema, idempotent upserts, migrations |
| `core.exporters` | JSON / CSV / Parquet writers |
| `fetch.posts` | `fetch_posts(sub, sort, time, limit) -> list[Post]` + persist |
| `fetch.comments` | `fetch_comments(post_id, depth)` with CommentForest expansion |
| `fetch.users` | `fetch_user(name, limit)` posts + comments |
| `fetch.search` | `search(query, sub?, limit)` |
| `fetch.stream` | Long-running keyword monitor, writes hits to SQLite |
| `analyze.providers.base` | `LLMProvider` ABC: `complete(prompt, system?, max_tokens?)` |
| `analyze.providers.{anthropic,openai,ollama}` | Concrete providers |
| `analyze.themes` | Cluster N posts into themes |
| `analyze.summarize` | Summarize a thread (post + comments) |
| `analyze.painpoints` | Extract user pain points from a set of posts |
| `cli.main` | Typer app wiring commands |
| `mcp.server` | FastMCP tools mirroring fetch/query |

## SQLite schema

```sql
CREATE TABLE fetches(
  id INTEGER PRIMARY KEY, kind TEXT, params_json TEXT,
  started_at TEXT, ended_at TEXT, rows INTEGER, error TEXT
);
CREATE TABLE subreddits(
  name TEXT PRIMARY KEY, subscribers INTEGER, description TEXT, fetched_at TEXT
);
CREATE TABLE posts(
  id TEXT PRIMARY KEY, sub TEXT, author TEXT, title TEXT, selftext TEXT,
  url TEXT, score INTEGER, upvote_ratio REAL, num_comments INTEGER,
  created_utc REAL, is_self BOOLEAN, over_18 BOOLEAN, flair TEXT,
  permalink TEXT, fetched_at TEXT
);
CREATE TABLE comments(
  id TEXT PRIMARY KEY, post_id TEXT, parent_id TEXT, author TEXT,
  body TEXT, score INTEGER, created_utc REAL, depth INTEGER, fetched_at TEXT
);
CREATE TABLE users(
  name TEXT PRIMARY KEY, link_karma INTEGER, comment_karma INTEGER,
  created_utc REAL, is_mod BOOLEAN, fetched_at TEXT
);
CREATE TABLE streams(
  id INTEGER PRIMARY KEY, name TEXT, sub TEXT, keywords TEXT,
  started_at TEXT, active BOOLEAN DEFAULT 1
);
CREATE TABLE stream_hits(
  stream_id INTEGER, item_type TEXT, item_id TEXT,
  matched_at TEXT, keywords_matched TEXT,
  PRIMARY KEY (stream_id, item_type, item_id)
);
```

## Config resolution order

1. Env vars (including from `./.env` if present)
2. `~/.config/reddit-myind/.env` (chmod 600 recommended)
3. `config.toml` next to `.env` (for non-secret defaults)

## Non-goals (MVP)

- No posting / voting / commenting from the tool. Research-only surface.
- No web UI.
- No provider abstraction beyond the three concrete ones; no LangChain.
- No queue / scheduler — streams run in foreground. Add `systemd`/`launchd` examples later.
