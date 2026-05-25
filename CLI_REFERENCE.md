# Gap Map — CLI Reference

> `gapmap` — Typer app. Every command supports `--json` for machine-readable NDJSON output.
> Entry point: `uv run gapmap` (dev) or `gapmap` (installed).

---

## 1. Install & Setup

```bash
# Install dependencies
uv sync --all-extras

# Check Reddit API credentials
gapmap auth login --client-id <ID> --client-secret <SECRET> --username <U> --password <P>
gapmap auth check

# Connect MCP to Claude Code
gapmap mcp install

# Connect MCP to Cursor (HTTP daemon)
gapmap mcp install --client cursor
bash scripts/mcp_http_daemon.sh start
```

**Config resolution:** env vars → `~/.config/gapmap/.env` (chmod 600 recommended) → `config.toml`.

**Data dir:** `~/Library/Application Support/com.shantanu.gapmap/gapmap/` (macOS). Override with `GAPMAP_DATA_DIR`.

---

## 2. Auth

```bash
gapmap auth login
  --client-id ID          Reddit app client ID
  --client-secret SECRET  Reddit app secret
  --username USER         Reddit username
  --password PASS         Reddit password

gapmap auth check     # Verify credentials work
```

---

## 3. Fetch

```bash
# Fetch posts from a subreddit
gapmap fetch posts --sub learnprogramming --sort top --time month --limit 100
gapmap fetch posts -s nocode --sort hot --json

# Fetch comment tree for a post
gapmap fetch comments --post abc123 --depth 3

# Firehose of a sub's recent comments (no auth required)
gapmap fetch sub-comments --sub startups --limit 200

# Historical posts via pullpush archive (pre-May-2025)
gapmap fetch historical --sub learnprogramming --kind submission --days 730 --limit 1000
gapmap fetch historical -s machinelearning --kind comment --days 365

# Fetch a user's activity
gapmap fetch user --name username --kind both --limit 200
gapmap fetch user -u username --kind posts
```

**`fetch posts` sort values:** hot | new | top | rising | controversial
**`fetch posts` time_filter:** hour | day | week | month | year | all

---

## 4. Search

```bash
# Search Reddit globally
gapmap search "meditation apps" --sort relevance --time all --limit 50

# Scope to a subreddit
gapmap search "burnout" --sub cscareerquestions --sort top --time year

# Output as JSON
gapmap search "LLM latency" --json
```

---

## 5. Query & Export

```bash
# Run a SQL query against the local SQLite store
gapmap query "SELECT title, score FROM posts WHERE sub='learnprogramming' ORDER BY score DESC LIMIT 10"
gapmap query "SELECT * FROM topic_posts WHERE topic = :topic" --topic "meditation apps"

# Export posts/comments to JSON, CSV, or Parquet
gapmap export posts --format json --out ./posts.json
gapmap export posts --sub startups --since 7d --format csv --out ./startups.csv
gapmap export comments --since 30d --format parquet --out ./comments.parquet
gapmap export posts --sql "SELECT * FROM posts WHERE score > 100" --format json

# Long-running keyword stream (blocking)
gapmap stream --sub startups --keywords "painpoint,problem,frustrated" --watch both
gapmap stream -s learnprogramming -k "help,stuck" --json   # NDJSON for UI
gapmap stream -s AskReddit --watch posts   # no keyword filter = firehose
```

---

## 6. Research Pipeline

```bash
# Step 1: Discover relevant subreddits for a topic
gapmap research discover --topic "presentation skills" --limit 10
gapmap research discover -t "no-code tools" --json

# Topic canonicalization (typo correction + keyword fan-out)
gapmap research canonicalize --topic "meditaiton apps"

# Step 2: Collect corpus (runs fetches across all sources)
gapmap research collect --topic "presentation skills"
gapmap research collect -t "nocode" --aggressive    # maxes all limits
gapmap research collect -t "habit apps" --subs "habitica,selfimprovement,productivity"

# Step 3: Get corpus stats
gapmap research topic-stats --topic "presentation skills"

# Step 4: Extract gaps
gapmap research gaps --topic "presentation skills"
gapmap research temporal-gaps -t "presentation skills"  # pre/post May-2025 split

# Step 5: Synthesize insights (LLM-backed)
gapmap research synthesize --topic "presentation skills"

# Generate report (full pipeline summary)
gapmap research report --topic "presentation skills" --format markdown

# Paper research
gapmap research papers --topic "spaced repetition" --query "spaced repetition learning"
gapmap research analyze-papers --topic "spaced repetition" --limit 10

# CSV import
gapmap research ingest-csv --path ./user-interviews.csv --topic "presentation skills" --source-type interviews

# Scheduling
gapmap research schedule-enable --topic "presentation skills" --enabled
gapmap research schedule-tick   # run all scheduled topics (used by launchd/cron)
```

---

## 7. Ingest Local Files

```bash
# Single file (CSV, JSON, TXT, MD, PDF, VTT, SRT)
gapmap ingest file --path ./interviews.csv --topic "my product" --source-type interviews
gapmap ingest file -p ./design-doc.pdf -t "auth flow" -s spec

# Entire folder (recursive, skips .git, node_modules, binaries)
gapmap ingest folder --path ./learnings/ --topic "auth flow" --source-type learning_material
gapmap ingest folder -p ./docs -t "presentation skills" --ext "md,pdf"
```

---

## 8. Analyze (LLM-backed)

```bash
# Cluster posts into themes
gapmap analyze themes --sub learnprogramming --since 30d
gapmap analyze themes --provider ollama --json

# Summarize a single thread
gapmap analyze summarize --post abc123
gapmap analyze summarize -p abc123 --provider anthropic

# Extract pain points from stored posts
gapmap analyze painpoints --sub startups --since 7d
gapmap analyze painpoints --provider groq --top 20 --json
```

**`--provider` values:** anthropic | openai | openrouter | groq | deepseek | mistral | gemini | ollama

---

## 9. Graph

```bash
# Build the structural knowledge graph
gapmap research graph build --topic "presentation skills"

# Graph stats
gapmap research graph stats --topic "presentation skills"

# Top nodes by degree
gapmap research graph top-nodes --topic "presentation skills" --kind painpoint --limit 20

# Export graph as D3 JSON
gapmap research graph export --topic "presentation skills" --out ./graph.json
```

---

## 10. MCP Server

```bash
# Run MCP server (stdio — for Claude Code / Claude Desktop)
gapmap mcp serve

# Run MCP HTTP daemon (for Cursor — survives 5-min cycling)
gapmap mcp serve --transport http --host 127.0.0.1 --port 8765

# Install/remove MCP entry in a client config
gapmap mcp install                          # → ~/.claude.json (Claude Code)
gapmap mcp install --client cursor          # → ~/.cursor/mcp.json
gapmap mcp install --client claude-desktop  # → ~/Library/Application Support/Claude/...
gapmap mcp install --rotate-token           # generate fresh auth token
gapmap mcp uninstall

# Status
gapmap mcp status
gapmap mcp clients   # list known client configs

# Diagnostics
gapmap mcp stats                # tool call counts, slow calls
gapmap mcp stats --slow         # tools >5s
gapmap mcp logs                 # tail structured event log
gapmap mcp logs --since 1h      # last hour
gapmap mcp logs --severity error
```

---

## 11. Global Flags

| Flag | Description |
|---|---|
| `--json` | Output machine-readable JSON (or NDJSON for streams) instead of rich tables |
| `--help` | Show command help |
| `--version` | Show version |

All options are also readable from `gapmap <command> --help`.
