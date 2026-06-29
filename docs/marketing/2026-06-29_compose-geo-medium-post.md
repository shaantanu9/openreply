# OpenReply’s New Compose + GEO Stack: From Listening to Being Cited by AI Search

**What changed:** OpenReply now turns raw market listening into drafted posts, threads, scripts, and articles — and checks whether AI search engines actually cite your brand while doing it.

If you build or market products online, you have two jobs now:

1. **Show up where conversations happen** (Reddit, Hacker News, X, LinkedIn, YouTube, App Store reviews…).
2. **Show up when AI answers the question** — ChatGPT, Perplexity, Gemini, Copilot.

The second one is Generative Engine Optimization (GEO). It is not SEO with a new coat of paint. It is the discipline of making your brand, product, and proof discoverable enough that an LLM cites you instead of a competitor.

OpenReply’s latest release connects both jobs in one desktop app.

---

## What is OpenReply?

OpenReply is an **open-source social marketing reply and content co-pilot**. It listens across 20+ sources — Reddit, Hacker News, X, Mastodon, Bluesky, Dev.to, Stack Overflow, Product Hunt, App Store, Google Play, YouTube, arXiv, PubMed, GitHub, RSS, and more — and turns that signal into:

- A local SQLite corpus you own.
- A knowledge graph of painpoints, feature wishes, competitors, and workarounds.
- Draft replies and original content tuned to your agent’s voice.
- A citation check that tells you whether AI search engines mention your brand.

It ships as a desktop app, an MCP server for Claude Code / Cursor, and a CLI.

---

## What is Generative Engine Optimization (GEO)?

GEO is the practice of increasing the chance that a generative AI answer engine cites your brand, product, or content when a user asks a question in your market.

Unlike traditional SEO, you are not optimizing for a ranked list of blue links. You are optimizing for **inclusion inside a synthesized answer**. That means:

- Your brand must appear in sources the model trusts.
- Your claims must be specific, quotable, and grounded.
- Your product must be associated with the exact questions buyers ask.

OpenReply now measures this directly.

---

## The new Compose screen: listen once, write everywhere

OpenReply’s **Compose** screen turns what the system learned from the web into platform-native drafts.

### 7 content kinds supported

| Kind | Best for |
|------|----------|
| **Post** | Single-platform updates (X, LinkedIn, Reddit) |
| **Thread** | 5–8 numbered parts that build an argument |
| **Article** | Long-form with title, intro, sections, takeaway |
| **Script** | Short-form video: hook + 3 beats + CTA |
| **YouTube** | Long-form with segments and `[VISUAL: …]` cues |
| **Follow-up reply** | Answer the latest turn in a pasted conversation |
| **Follow-up post** | Part 2 of a prior draft, linked by `parent_id` |
| **Repurpose** | Rewrite any source post in your agent’s voice |

### How Compose works

1. Pick a content kind.
2. Optionally set the platform (X / LinkedIn / Reddit) and an angle.
3. OpenReply blends the agent’s voice, linked persona knowledge, topic corpus, and Unified Brain graph.
4. A structured draft lands in `content_items` as an editable card.
5. Save, schedule, or queue it.

Platform hints are built in. A LinkedIn draft reads differently from an X post because the engine knows the length, tone, and format each surface rewards.

### Repurpose from Watch

The **Watch** screen now fetches posts from tracked accounts and adds a **Rewrite →** button per post. Click it, and the post text is carried into Compose with the **Repurpose** pill already selected. The agent keeps the insight, sheds the original framing, and writes it in your voice.

---

## Auto-pilot: daily content + daily reply, without the daily effort

Compose now has an **Auto-pilot** panel. Set it once, and every day OpenReply drafts:

- **1 piece of content** from your agent’s brain/knowledge (default: a post).
- **1 reply** to the top fresh opportunity it found.

Both are throttled to about once per 20 hours, so a fast scheduler cannot burn through your BYOK tokens. Drafts are waiting in the Queue when you open the app. You review before anything goes live.

This sits on top of the existing scheduled auto-flow:

1. **Auto-find** new opportunities on the agent’s cadence.
2. **Learn** from fetched posts into persona memories and beliefs.
3. **Post due** queued replies (or surface a reminder).
4. **Refresh AI-visibility** GEO checks.

---

## GEO inside OpenReply: AI Visibility

The **AI Visibility** screen is OpenReply’s GEO command center.

### What it measures

For each tracked query, it tells you:

- **Cited** — your brand appears in the AI answer.
- **Competitor** — another brand is cited instead.
- **Absent** — no brand is mentioned.

It also computes **Share of Voice** against named competitors and shows a **citation-rate-over-time** chart once you have two days of history.

### Real web citations via Perplexity Sonar

The previous GEO check used the configured LLM’s own answer as a proxy. That worked, but it was not the live answer engine.

Now, when you add a **Perplexity API key**, OpenReply calls **Perplexity Sonar** directly. Sonar returns the live answer plus the actual URLs it cited. OpenReply matches your agent’s **website domain** against those URLs and classifies the result as cited, competitor, or absent using the real sources.

If no Perplexity key is set, it falls back to the LLM-based check.

### Cost-safe scheduled checks

GEO checks run automatically on the launchd scheduler, but they are throttled to roughly once per 20 hours. A fast tick interval will not drain your Perplexity or BYOK budget.

---

## Why this matters for builders and marketers

### 1. You stop guessing what content to create

OpenReply does not brainstorm from a blank page. It generates from the actual painpoints, feature wishes, and workarounds your market is talking about right now.

### 2. You stop guessing whether AI search sees you

GEO is a lagging indicator if you measure it manually. OpenReply turns it into a dashboard: track queries, see trends, and know when competitors start eating your share of voice.

### 3. Everything stays local-first and BYOK

Your corpus lives in SQLite on your machine. LLM calls use your own keys (Anthropic, OpenAI, Gemini, OpenRouter, Groq, DeepSeek, Mistral, or local Ollama). You are not feeding a vendor’s training pipeline.

---

## How to try it

OpenReply is open source under MIT.

```bash
git clone https://github.com/shaantanu9/openreply.git && cd openreply
uv sync --all-extras
```

Create an agent:

```bash
uv run openreply agent create --name "Acme Notes" \
  --niche "AI note-taking" \
  --keywords "obsidian alternative, note taking app" \
  --website "https://acmenotes.example.com"
```

Generate content:

```bash
uv run openreply content generate --kind post
```

Check AI visibility:

```bash
uv run openreply reply geo-check --query "best AI note taking app"
```

Or use the desktop app at [openreply.myind.ai](https://openreply.myind.ai/).

---

## Bottom line

Content and citations are no longer separate workflows. OpenReply’s Compose + GEO stack turns market listening into drafted content, and then checks whether that content moves the only metric that matters for the next generation of search: **whether the machines that answer questions mention you at all**.

If you are optimizing for 2025, you are optimizing for links.

If you are optimizing for 2026, you are optimizing for citations.

OpenReply is built for the second one.

---

*OpenReply is open-source social marketing reply & content co-pilot. Desktop app, MCP server, and CLI. Learn more at [openreply.myind.ai](https://openreply.myind.ai/) and [github.com/shaantanu9/openreply](https://github.com/shaantanu9/openreply).*
