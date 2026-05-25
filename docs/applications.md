# reddit-myind — applications & value

Why the knowledge graph + shareable HTML viewer actually matter,
what they do for humans and for AI agents, and where they don't.

---

## What it does for you (human)

### 1. Sees patterns you can't see in a corpus

A table of 374 posts is unreadable. A graph *shows* you in 3 seconds:

- **Hub painpoints** — issues evidenced by 10+ posts → validated
- **Orphan painpoints** — single-source noise → drop them
- **Painpoint + 3 DIY-workaround edges** — users are so stuck they're building their own fix. **Strongest buy-signal there is.**
- **Competitor clusters** — "these 4 products all fail the same way" → your positioning map

### 2. Shareable artifact

The HTML file is one attachment:

- Drop into Slack for a cofounder/team
- Screenshot for a tweet thread
- Embed in a pitch deck
- Send to a VC: "here's the market map"

If the graph looks sharp and has 1–2 non-obvious findings, it's the kind of thing that goes on Product Hunt — **as the output of a tool**, not as the tool itself ("I mapped the gap in X market, here it is").

### 3. Persistent research memory

Come back in a week, open the HTML, still see what you learned. The SQLite + graph *is* your research state. You can:

- Re-run collection to *add* to an existing graph (dedup is automatic)
- Compare graphs across topics
- Diff a graph today vs last month → see trends

---

## What it does for AI agents

### 1. Context efficiency (huge)

Without graph:
```
gapmap_get_corpus(limit=300) → 300 posts into context → synthesize
```

With graph:
```
gapmap_graph_top_nodes(kind='painpoint', limit=15)   → 15 curated hubs
gapmap_graph_neighbors(node_id='...')                → evidence posts
→ answer with 10× less context
```

On a long research session this is the difference between "3 questions then OOM" and "30 questions".

### 2. Structured queries beat brute-force reading

- "Painpoints in ≥3 subs with a DIY-workaround edge" → **one graph query**
- Without graph: re-read 300 posts each time

### 3. Cross-session handoff

Next Claude Code session opens fresh context. It calls `gapmap_graph_stats(topic)` → knows exactly what's been researched. **The graph is the persistent state between sessions.** Without it, every session starts from zero.

### 4. Multi-agent compose

- Agent A: collects corpus → builds structural graph
- Agent B: enriches via LLM → upserts semantic nodes
- Agent C: runs a gap report → queries the graph

Each step idempotent, typed, independent.

---

## What it ISN'T

| Claim | Reality |
|---|---|
| "Finds the gap for you" | Surfaces candidates, human decides |
| "Replaces user interviews" | No — points you at which users to DM |
| "Works on any data quality" | Garbage in, garbage out — enrichment quality matters |
| "Instantly goes viral" | Needs: sharp graph + 2 non-obvious findings + good narrative |

---

## Concrete applications

### A. You want to build a product

```bash
reddit-cli research collect --topic "freelance invoicing" --aggressive
reddit-cli research graph build --topic "freelance invoicing"
```

Then in a Claude Code session:

- `gapmap_graph_top_nodes(kind='painpoint', limit=20)`
- Find painpoints linked to DIY workarounds **and** competitor complaints
- Output: shortlist of 3 validated product bets + who to interview

### B. You want content / marketing

```bash
reddit-cli research graph export --topic "freelance invoicing" --out gap-map.html
```

- Screenshot the cluster around "tax integration"
- Tweet: "Here are the 5 things freelancers complain about in 2026. Pain map ↓"

### C. You're doing ongoing tracking

Weekly:

```bash
reddit-cli research collect --topic "AI coding assistants"
# dedup adds only new posts
reddit-cli research graph build --topic "AI coding assistants"
```

Diff the graph vs last week → new painpoints = emerging trends.

### D. Agent memory

The graph is how your next Claude Code session knows what your last one learned. No copy-paste, no "remind me what we were doing".

---

## The honest test

Pick a topic you actually care about and run:

```bash
uv run reddit-cli research collect --topic "YOUR TOPIC" --aggressive
uv run reddit-cli research graph build --topic "YOUR TOPIC"
uv run reddit-cli research graph export --topic "YOUR TOPIC" --out test.html
open test.html
```

Judge by the artifact. Does it tell you something non-obvious? If yes, valuable. If no — either need more data, better enrichment, or rethink the approach.
