# OpenReply — CLI Reference

> `openreply` — Typer app. Most commands support `--json` for machine-readable NDJSON output.
> Entry point: `uv run openreply` (dev) or `openreply` (installed).

---

## 1. Install & Setup

```bash
# Install dependencies
uv sync --all-extras

# Connect a credential (Reddit, X, cookies, API keys)
openreply creds list
openreply creds save reddit --client-id <ID> --client-secret <SECRET>
openreply creds verify reddit

# Connect MCP to Claude Code
openreply mcp install

# Connect MCP to Cursor (HTTP daemon)
openreply mcp install --client cursor
bash scripts/mcp_http_daemon.sh start
```

**Config resolution:** env vars → `~/.config/openreply/.env` (chmod 600 recommended) → `config.toml`.

**Data dir:** `~/Library/Application Support/com.shantanu.openreply/openreply/` (macOS). Override with `OPENREPLY_DATA_DIR`.

**Command surface:** top-level commands (`search`, `stream`, `query`, `export`, `collect-growth`, `health`, `info`, `daemon`) plus grouped commands (`reply`, `agent`, `content`, `publish`, `persona`, `creds`, `feeds`, `ingest`, `mcp`, `whisper`, `ytdlp`, `x-account`). Run `openreply <group> --help` for a group's subcommands.

---

## 2. Credentials (`creds`)

```bash
openreply creds list                 # status of every cookie/key-gated source
openreply creds import                # bulk-import from .env / clipboard
openreply creds save <source> ...     # save a credential for a source
openreply creds verify <source>       # live-test a credential
openreply creds delete <source>
openreply creds toggle <source>       # enable/disable a connected source
openreply creds preview <source>      # masked preview of a stored credential
```

Subcommands: `list`, `import`, `save`, `verify`, `delete`, `toggle`, `preview`.

---

## 3. Fetch & Search (top-level)

```bash
# Search Reddit globally
openreply search "meditation apps" --sort relevance --time all --limit 50

# Scope to a subreddit
openreply search "burnout" --sub cscareerquestions --sort top --time year
openreply search "LLM latency" --json

# Long-running keyword stream (blocking; Ctrl+C to stop)
openreply stream --sub startups --keywords "painpoint,problem,frustrated" --watch both
openreply stream -s learnprogramming -k "help,stuck" --json   # NDJSON for UI
openreply stream -s AskReddit --watch posts                   # no keywords = firehose
```

**`search` sort values:** relevance | hot | new | top | comments
**`search`/`stream` time_filter:** hour | day | week | month | year | all

---

## 4. Query & Export (top-level)

```bash
# Run a raw SQL query against the local SQLite store
openreply query "SELECT title, score FROM posts WHERE sub='learnprogramming' ORDER BY score DESC LIMIT 10"
openreply query "SELECT * FROM topic_posts WHERE topic = :topic" --topic "meditation apps"

# Export rows to JSON / CSV / Parquet
openreply export posts --format json --out ./posts.json
openreply export posts --sub startups --since 7d --format csv --out ./startups.csv
openreply export comments --since 30d --format parquet --out ./comments.parquet
openreply export posts --sql "SELECT * FROM posts WHERE score > 100" --format json
```

Tables available to `query`: posts, comments, users, subreddits, fetches, stream, topic_posts, and more — see `openreply mcp` → `openreply_describe_schema` for the live schema.

---

## 5. Collect content (`collect-growth`)

```bash
# Fetch social + open-source + web content for a topic and persist to SQLite
openreply collect-growth --topic "presentation skills"
openreply collect-growth -t "nocode tools" --json
```

---

## 6. Ingest local files (`ingest`)

```bash
# Single file (CSV, JSON, TXT, MD, PDF, VTT, SRT)
openreply ingest file --path ./interviews.csv --topic "my product" --source-type interviews

# A URL
openreply ingest url --url https://example.com/post --topic "auth flow"

# Entire folder (recursive, skips .git, node_modules, binaries)
openreply ingest folder --path ./learnings/ --topic "auth flow"

# A video file (transcribed via Whisper)
openreply ingest video --path ./talk.mp4 --topic "presentation skills"

# Search + ingest YouTube results
openreply ingest youtube-search --query "presentation tips" --topic "presentation skills"
```

Subcommands: `file`, `url`, `folder`, `video`, `youtube-search`.

---

## 7. Feeds (`feeds`)

```bash
openreply feeds list                       # list configured RSS/Atom feeds
openreply feeds add --url <feed-url>        # register a feed
openreply feeds validate                    # check every feed resolves
openreply feeds enable <feed>               # enable/disable a feed
openreply feeds remove <feed>
```

Subcommands: `list`, `validate`, `add`, `remove`, `enable`.

---

## 8. Reply engine (`reply`)

The core OpenReply surface — find opportunities, draft replies, manage the queue, growth plan, GEO checks, sub intelligence, alerts, ideas, and analytics.

```bash
# Brand & platforms
openreply reply platforms                  # list supported platforms
openreply reply brand-set ...              # configure brand voice/positioning
openreply reply brand-get

# Opportunities → drafts → queue → post
openreply reply find --topic "presentation skills"   # surface reply opportunities
openreply reply list
openreply reply source-counts
openreply reply draft <opportunity-id>
openreply reply set-status <id> <status>
openreply reply save-draft <id>
openreply reply drafts
openreply reply approve <id>
openreply reply queue
openreply reply snooze <id>
openreply reply post-due                   # post all approved drafts that are due

# Growth plan & playbook
openreply reply growth-plan
openreply reply growth-get
openreply reply goal-set ...
openreply reply playbook
openreply reply evolve                     # evolve strategy from results

# Sub intelligence
openreply reply sub-discover
openreply reply sub-list
openreply reply sub-intel <sub>
openreply reply sub-track <sub>
openreply reply sub-check

# GEO (generative-engine optimization) checks
openreply reply geo-list
openreply reply geo-add ...
openreply reply geo-set ...
openreply reply geo-delete <id>
openreply reply geo-check <id>
openreply reply geo-check-all
openreply reply geo-history <id>

# Alerts, rules, ideas, analytics, notifications, bot
openreply reply rules
openreply reply alert-list / alert-add / alert-delete
openreply reply ideas / idea-draft / idea-status
openreply reply analytics
openreply reply account-status
openreply reply notify-get / notify-set / notify-test
openreply reply bot-poll
```

Subcommands: `platforms`, `brand-set`, `brand-get`, `find`, `list`, `source-counts`, `draft`, `set-status`, `save-draft`, `drafts`, `approve`, `queue`, `snooze`, `post-due`, `growth-plan`, `growth-get`, `rules`, `alert-list`, `alert-add`, `alert-delete`, `geo-list`, `geo-add`, `geo-set`, `geo-delete`, `geo-check`, `geo-check-all`, `geo-history`, `analytics`, `account-status`, `sub-discover`, `sub-list`, `sub-intel`, `sub-track`, `sub-check`, `goal-set`, `playbook`, `evolve`, `ideas`, `idea-draft`, `idea-status`, `notify-get`, `notify-set`, `notify-test`, `bot-poll`.

---

## 9. Agents (`agent`)

Persona-backed reply agents with their own knowledge corpus, knowledge graph, autopilot, and watched accounts.

```bash
openreply agent create --name "Helpful Dev" ...
openreply agent list
openreply agent get <id>
openreply agent use <id>                   # set the active agent
openreply agent update <id> ...
openreply agent delete <id>

# Knowledge & corpus
openreply agent knowledge <id>
openreply agent learn <id>                 # ingest knowledge for the agent
openreply agent learn-status <id>
openreply agent corpus <id>
openreply agent corpus-check <id>
openreply agent teach-video <id> --url <yt-url>

# Knowledge graph / brain
openreply agent build-graph <id>
openreply agent graph <id>
openreply agent brain <id>
openreply agent brain-relink <id>

# Autopilot
openreply agent autopilot <id>
openreply agent autopilot-set <id> ...
openreply agent autopilot-run <id>

# Watched accounts
openreply agent watch-add <id> --handle <user>
openreply agent watch-list <id>
openreply agent watch-remove <id> <handle>
openreply agent watch-fetch <id>
openreply agent refresh <id>

# Persona linkage
openreply agent link-persona <id> <persona-id>
openreply agent unlink-persona <id>
openreply agent personas <id>
```

Subcommands: `create`, `list`, `get`, `use`, `update`, `delete`, `knowledge`, `learn`, `learn-status`, `corpus`, `corpus-check`, `autopilot`, `autopilot-set`, `autopilot-run`, `build-graph`, `graph`, `brain`, `brain-relink`, `teach-video`, `watch-add`, `watch-list`, `watch-remove`, `watch-fetch`, `refresh`, `link-persona`, `unlink-persona`, `personas`.

---

## 10. Content engine (`content`)

```bash
openreply content generate --topic "..." ...   # generate a content draft
openreply content update <id> ...
openreply content list
openreply content delete <id>
```

Subcommands: `generate`, `update`, `list`, `delete`.

---

## 11. Personas (`persona`)

```bash
openreply persona list
openreply persona create --name "..." ...
openreply persona update <id> ...
openreply persona delete <id>

# Ingest signal into a persona's memory
openreply persona ingest <id> ...
openreply persona teach-video <id> --url <yt-url>
openreply persona ingest-peers <id>

# Memory & graph
openreply persona memories <id>
openreply persona graph <id>
openreply persona backfill <id>

# Conclusions / sharing / chat
openreply persona conclude <id>
openreply persona conclusions <id>
openreply persona share <id>
openreply persona rejections <id>
openreply persona chat <id>
```

Subcommands: `list`, `create`, `delete`, `update`, `ingest`, `teach-video`, `ingest-peers`, `memories`, `graph`, `backfill`, `conclude`, `conclusions`, `share`, `rejections`, `chat`.

---

## 12. Publishing (`publish` & `x-account`)

```bash
# Publish posts/replies to X
openreply publish status
openreply publish set-creds ...
openreply publish clear-creds
openreply publish x --text "..."
openreply publish x-reply --to <tweet-id> --text "..."

# Manage X accounts / library
openreply x-account add ...
openreply x-account import-browser          # import cookies from a browser session
openreply x-account list
openreply x-account remove <handle>
openreply x-account profile <handle>
openreply x-account fetch-posts <handle>
openreply x-account fetch-thread <tweet-id>
openreply x-account save-to-library <id>
```

`publish` subcommands: `status`, `set-creds`, `clear-creds`, `x`, `x-reply`.
`x-account` subcommands: `add`, `import-browser`, `list`, `remove`, `profile`, `fetch-posts`, `fetch-thread`, `save-to-library`.

---

## 13. Whisper & yt-dlp

```bash
# Whisper transcription models
openreply whisper list                      # downloaded models
openreply whisper catalogue                 # available models
openreply whisper download <model>
openreply whisper delete <model>
openreply whisper default <model>           # set default model

# yt-dlp binary management
openreply ytdlp version
openreply ytdlp update
```

`whisper` subcommands: `list`, `catalogue`, `download`, `delete`, `default`.
`ytdlp` subcommands: `version`, `update`.

---

## 14. MCP Server (`mcp`)

```bash
# Run MCP server (stdio — for Claude Code / Claude Desktop)
openreply mcp serve

# Run MCP HTTP daemon (for Cursor — survives 5-min cycling)
openreply mcp serve --transport http --host 127.0.0.1 --port 8765

# Install/remove MCP entry in a client config
openreply mcp install                          # → ~/.claude.json (Claude Code)
openreply mcp install --client cursor          # → ~/.cursor/mcp.json
openreply mcp install --client claude-desktop  # → ~/Library/Application Support/Claude/...
openreply mcp uninstall

# Status & client discovery
openreply mcp status
openreply mcp clients                          # list known client configs
openreply mcp config                           # print resolved MCP config

# Diagnostics
openreply mcp stats                            # tool call counts, slow calls
openreply mcp logs                             # tail structured event log
```

Subcommands: `serve`, `clients`, `install`, `config`, `uninstall`, `status`, `logs`, `stats`.

---

## 15. Health & info

```bash
openreply health      # diagnostics: data dir, DB schema, ONNX model, LLM provider
openreply info        # config + DB stats + which backend mode is active
openreply daemon      # long-running stdin/stdout daemon used by the Tauri Rust shell
```

---

## 16. Global Flags

| Flag | Description |
|---|---|
| `--json` | Output machine-readable JSON (or NDJSON for streams) instead of rich tables |
| `--help` | Show command help |
| `--version` | Show version |

All options are also readable from `openreply <command> --help`.
