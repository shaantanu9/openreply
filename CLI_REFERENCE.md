# Gap Map — CLI Reference

> `reddit-cli` — Typer app. Every command supports `--json` for machine-readable NDJSON output.
> Entry point: `uv run reddit-cli` (dev) or `reddit-cli` (installed).

---

## 1. Install & Setup

```bash
# Install dependencies
uv sync --all-extras

# Check Reddit API credentials
reddit-cli auth login --client-id <ID> --client-secret <SECRET> --username <U> --password <P>
reddit-cli auth check

# Connect MCP to Claude Code
reddit-cli mcp install

# Connect MCP to Cursor (HTTP daemon)
reddit-cli mcp install --client cursor
bash scripts/mcp_http_daemon.sh start
```

**Config resolution:** env vars → `~/.config/reddit-myind/.env` (chmod 600 recommended) → `config.toml`.

**Data dir:** `~/Library/Application Support/com.shantanu.gapmap/reddit-myind/` (macOS). Override with `REDDIT_MYIND_DATA_DIR`.

---

## 2. Auth

```bash
reddit-cli auth login
  --client-id ID          Reddit app client ID
  --client-secret SECRET  Reddit app secret
  --username USER         Reddit username
  --password PASS         Reddit password

reddit-cli auth check     # Verify credentials work
```

---

## 3. Fetch

```bash
# Fetch posts from a subreddit
reddit-cli fetch posts --sub learnprogramming --sort top --time month --limit 100
reddit-cli fetch posts -s nocode --sort hot --json

# Fetch comment tree for a post
reddit-cli fetch comments --post abc123 --depth 3

# Firehose of a sub's recent comments (no auth required)
reddit-cli fetch sub-comments --sub startups --limit 200

# Historical posts via pullpush archive (pre-May-2025)
reddit-cli fetch historical --sub learnprogramming --kind submission --days 730 --limit 1000
reddit-cli fetch historical -s machinelearning --kind comment --days 365

# Fetch a user's activity
reddit-cli fetch user --name username --kind both --limit 200
reddit-cli fetch user -u username --kind posts
```

**`fetch posts` sort values:** hot | new | top | rising | controversial
**`fetch posts` time_filter:** hour | day | week | month | year | all

---

## 4. Search

```bash
# Search Reddit globally
reddit-cli search "meditation apps" --sort relevance --time all --limit 50

# Scope to a subreddit
reddit-cli search "burnout" --sub cscareerquestions --sort top --time year

# Output as JSON
reddit-cli search "LLM latency" --json
```

---

## 5. Query & Export

```bash
# Run a SQL query against the local SQLite store
reddit-cli query "SELECT title, score FROM posts WHERE sub='learnprogramming' ORDER BY score DESC LIMIT 10"
reddit-cli query "SELECT * FROM topic_posts WHERE topic = :topic" --topic "meditation apps"

# Export posts/comments to JSON, CSV, or Parquet
reddit-cli export posts --format json --out ./posts.json
reddit-cli export posts --sub startups --since 7d --format csv --out ./startups.csv
reddit-cli export comments --since 30d --format parquet --out ./comments.parquet
reddit-cli export posts --sql "SELECT * FROM posts WHERE score > 100" --format json

# Long-running keyword stream (blocking)
reddit-cli stream --sub startups --keywords "painpoint,problem,frustrated" --watch both
reddit-cli stream -s learnprogramming -k "help,stuck" --json   # NDJSON for UI
reddit-cli stream -s AskReddit --watch posts   # no keyword filter = firehose
```

---

## 6. Research Pipeline

```bash
# Step 1: Discover relevant subreddits for a topic
reddit-cli research discover --topic "presentation skills" --limit 10
reddit-cli research discover -t "no-code tools" --json

# Topic canonicalization (typo correction + keyword fan-out)
reddit-cli research canonicalize --topic "meditaiton apps"

# Step 2: Collect corpus (runs fetches across all sources)
reddit-cli research collect --topic "presentation skills"
reddit-cli research collect -t "nocode" --aggressive    # maxes all limits
reddit-cli research collect -t "habit apps" --subs "habitica,selfimprovement,productivity"

# Step 3: Get corpus stats
reddit-cli research topic-stats --topic "presentation skills"

# Step 4: Extract gaps
reddit-cli research gaps --topic "presentation skills"
reddit-cli research temporal-gaps -t "presentation skills"  # pre/post May-2025 split

# Step 5: Synthesize insights (LLM-backed)
reddit-cli research synthesize --topic "presentation skills"

# Generate report (full pipeline summary)
reddit-cli research report --topic "presentation skills" --format markdown

# Paper research
reddit-cli research papers --topic "spaced repetition" --query "spaced repetition learning"
reddit-cli research analyze-papers --topic "spaced repetition" --limit 10

# CSV import
reddit-cli research ingest-csv --path ./user-interviews.csv --topic "presentation skills" --source-type interviews

# Scheduling
reddit-cli research schedule-enable --topic "presentation skills" --enabled
reddit-cli research schedule-tick   # run all scheduled topics (used by launchd/cron)
```

---

## 7. Ingest Local Files

```bash
# Single file (CSV, JSON, TXT, MD, PDF, VTT, SRT)
reddit-cli ingest file --path ./interviews.csv --topic "my product" --source-type interviews
reddit-cli ingest file -p ./design-doc.pdf -t "auth flow" -s spec

# Entire folder (recursive, skips .git, node_modules, binaries)
reddit-cli ingest folder --path ./learnings/ --topic "auth flow" --source-type learning_material
reddit-cli ingest folder -p ./docs -t "presentation skills" --ext "md,pdf"
```

---

## 8. Analyze (LLM-backed)

```bash
# Cluster posts into themes
reddit-cli analyze themes --sub learnprogramming --since 30d
reddit-cli analyze themes --provider ollama --json

# Summarize a single thread
reddit-cli analyze summarize --post abc123
reddit-cli analyze summarize -p abc123 --provider anthropic

# Extract pain points from stored posts
reddit-cli analyze painpoints --sub startups --since 7d
reddit-cli analyze painpoints --provider groq --top 20 --json
```

**`--provider` values:** anthropic | openai | openrouter | groq | deepseek | mistral | gemini | ollama

---

## 9. Graph

```bash
# Build the structural knowledge graph
reddit-cli research graph build --topic "presentation skills"

# Graph stats
reddit-cli research graph stats --topic "presentation skills"

# Top nodes by degree
reddit-cli research graph top-nodes --topic "presentation skills" --kind painpoint --limit 20

# Export graph as D3 JSON
reddit-cli research graph export --topic "presentation skills" --out ./graph.json
```

---

## 10. MCP Server

```bash
# Run MCP server (stdio — for Claude Code / Claude Desktop)
reddit-cli mcp serve

# Run MCP HTTP daemon (for Cursor — survives 5-min cycling)
reddit-cli mcp serve --transport http --host 127.0.0.1 --port 8765

# Install/remove MCP entry in a client config
reddit-cli mcp install                          # → ~/.claude.json (Claude Code)
reddit-cli mcp install --client cursor          # → ~/.cursor/mcp.json
reddit-cli mcp install --client claude-desktop  # → ~/Library/Application Support/Claude/...
reddit-cli mcp install --rotate-token           # generate fresh auth token
reddit-cli mcp uninstall

# Status
reddit-cli mcp status
reddit-cli mcp clients   # list known client configs

# Diagnostics
reddit-cli mcp stats                # tool call counts, slow calls
reddit-cli mcp stats --slow         # tools >5s
reddit-cli mcp logs                 # tail structured event log
reddit-cli mcp logs --since 1h      # last hour
reddit-cli mcp logs --severity error
```

---

## 11. Global Flags

| Flag | Description |
|---|---|
| `--json` | Output machine-readable JSON (or NDJSON for streams) instead of rich tables |
| `--help` | Show command help |
| `--version` | Show version |

All options are also readable from `reddit-cli <command> --help`.
