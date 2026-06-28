# OpenReply — CLI Reference

> `openreply` — Typer app. Every command supports `--json` for machine-readable NDJSON output.
> Entry point: `uv run openreply` (dev) or `openreply` (installed).

---

## 1. Install & Setup

```bash
# Install dependencies
uv sync --all-extras

# Check Reddit API credentials
openreply auth login --client-id <ID> --client-secret <SECRET> --username <U> --password <P>
openreply auth check

# Connect MCP to Claude Code
openreply mcp install

# Connect MCP to Cursor (HTTP daemon)
openreply mcp install --client cursor
bash scripts/mcp_http_daemon.sh start
```

**Config resolution:** env vars → `~/.config/openreply/.env` (chmod 600 recommended) → `config.toml`.

**Data dir:** `~/Library/Application Support/com.shantanu.openreply/openreply/` (macOS). Override with `OPENREPLY_DATA_DIR`.

---

## 2. Auth

```bash
openreply auth login
  --client-id ID          Reddit app client ID
  --client-secret SECRET  Reddit app secret
  --username USER         Reddit username
  --password PASS         Reddit password

openreply auth check     # Verify credentials work
```

---

## 3. Fetch

```bash
# Fetch posts from a subreddit
openreply fetch posts --sub learnprogramming --sort top --time month --limit 100
openreply fetch posts -s nocode --sort hot --json

# Fetch comment tree for a post
openreply fetch comments --post abc123 --depth 3

# Firehose of a sub's recent comments (no auth required)
openreply fetch sub-comments --sub startups --limit 200

# Historical posts via pullpush archive (pre-May-2025)
openreply fetch historical --sub learnprogramming --kind submission --days 730 --limit 1000
openreply fetch historical -s machinelearning --kind comment --days 365

# Fetch a user's activity
openreply fetch user --name username --kind both --limit 200
openreply fetch user -u username --kind posts
```

**`fetch posts` sort values:** hot | new | top | rising | controversial
**`fetch posts` time_filter:** hour | day | week | month | year | all

---

## 4. Search

```bash
# Search Reddit globally
openreply search "meditation apps" --sort relevance --time all --limit 50

# Scope to a subreddit
openreply search "burnout" --sub cscareerquestions --sort top --time year

# Output as JSON
openreply search "LLM latency" --json
```

---

## 5. Query & Export

```bash
# Run a SQL query against the local SQLite store
openreply query "SELECT title, score FROM posts WHERE sub='learnprogramming' ORDER BY score DESC LIMIT 10"
openreply query "SELECT * FROM topic_posts WHERE topic = :topic" --topic "meditation apps"

# Export posts/comments to JSON, CSV, or Parquet
openreply export posts --format json --out ./posts.json
openreply export posts --sub startups --since 7d --format csv --out ./startups.csv
openreply export comments --since 30d --format parquet --out ./comments.parquet
openreply export posts --sql "SELECT * FROM posts WHERE score > 100" --format json

# Long-running keyword stream (blocking)
openreply stream --sub startups --keywords "painpoint,problem,frustrated" --watch both
openreply stream -s learnprogramming -k "help,stuck" --json   # NDJSON for UI
openreply stream -s AskReddit --watch posts   # no keyword filter = firehose
```

---

## 6. Research Pipeline

```bash
# Step 1: Discover relevant subreddits for a topic
openreply research discover --topic "presentation skills" --limit 10
openreply research discover -t "no-code tools" --json

# Topic canonicalization (typo correction + keyword fan-out)
openreply research canonicalize --topic "meditaiton apps"

# Step 2: Collect corpus (runs fetches across all sources)
openreply research collect --topic "presentation skills"
openreply research collect -t "nocode" --aggressive    # maxes all limits
openreply research collect -t "habit apps" --subs "habitica,selfimprovement,productivity"

# Step 3: Get corpus stats
openreply research topic-stats --topic "presentation skills"

# Step 4: Extract gaps
openreply research gaps --topic "presentation skills"
openreply research temporal-gaps -t "presentation skills"  # pre/post May-2025 split

# Step 5: Synthesize insights (LLM-backed)
openreply research synthesize --topic "presentation skills"

# Generate report (full pipeline summary)
openreply research report --topic "presentation skills" --format markdown

# Paper research
openreply research papers --topic "spaced repetition" --query "spaced repetition learning"
openreply research analyze-papers --topic "spaced repetition" --limit 10

# CSV import
openreply research ingest-csv --path ./user-interviews.csv --topic "presentation skills" --source-type interviews

# Scheduling
openreply research schedule-enable --topic "presentation skills" --enabled
openreply research schedule-tick   # run all scheduled topics (used by launchd/cron)
```

---

## 7. Ingest Local Files

```bash
# Single file (CSV, JSON, TXT, MD, PDF, VTT, SRT)
openreply ingest file --path ./interviews.csv --topic "my product" --source-type interviews
openreply ingest file -p ./design-doc.pdf -t "auth flow" -s spec

# Entire folder (recursive, skips .git, node_modules, binaries)
openreply ingest folder --path ./learnings/ --topic "auth flow" --source-type learning_material
openreply ingest folder -p ./docs -t "presentation skills" --ext "md,pdf"
```

---

## 8. Analyze (LLM-backed)

```bash
# Cluster posts into themes
openreply analyze themes --sub learnprogramming --since 30d
openreply analyze themes --provider ollama --json

# Summarize a single thread
openreply analyze summarize --post abc123
openreply analyze summarize -p abc123 --provider anthropic

# Extract pain points from stored posts
openreply analyze painpoints --sub startups --since 7d
openreply analyze painpoints --provider groq --top 20 --json
```

**`--provider` values:** anthropic | openai | openrouter | groq | deepseek | mistral | gemini | ollama

---

## 9. Graph

```bash
# Build the structural knowledge graph
openreply research graph build --topic "presentation skills"

# Graph stats
openreply research graph stats --topic "presentation skills"

# Top nodes by degree
openreply research graph top-nodes --topic "presentation skills" --kind painpoint --limit 20

# Export graph as D3 JSON
openreply research graph export --topic "presentation skills" --out ./graph.json
```

---

## 10. MCP Server

```bash
# Run MCP server (stdio — for Claude Code / Claude Desktop)
openreply mcp serve

# Run MCP HTTP daemon (for Cursor — survives 5-min cycling)
openreply mcp serve --transport http --host 127.0.0.1 --port 8765

# Install/remove MCP entry in a client config
openreply mcp install                          # → ~/.claude.json (Claude Code)
openreply mcp install --client cursor          # → ~/.cursor/mcp.json
openreply mcp install --client claude-desktop  # → ~/Library/Application Support/Claude/...
openreply mcp install --rotate-token           # generate fresh auth token
openreply mcp uninstall

# Status
openreply mcp status
openreply mcp clients   # list known client configs

# Diagnostics
openreply mcp stats                # tool call counts, slow calls
openreply mcp stats --slow         # tools >5s
openreply mcp logs                 # tail structured event log
openreply mcp logs --since 1h      # last hour
openreply mcp logs --severity error
```

---

## 11. Global Flags

| Flag | Description |
|---|---|
| `--json` | Output machine-readable JSON (or NDJSON for streams) instead of rich tables |
| `--help` | Show command help |
| `--version` | Show version |

All options are also readable from `openreply <command> --help`.
