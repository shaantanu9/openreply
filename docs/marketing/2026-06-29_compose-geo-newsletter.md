# OpenReply Week in Build: Compose, Repurpose, and a Real GEO Check

Hi —

This week we shipped the missing half of OpenReply: **the ability to turn everything it hears into content you can actually publish**.

And we did not stop at drafting. We also taught it to check whether AI search engines are citing you — using live web data, not a model’s best guess.

---

## The big idea

OpenReply already listens across Reddit, Hacker News, X, App Store reviews, YouTube, arXiv, and ~15 other sources. It builds a local knowledge graph of painpoints, feature wishes, competitors, and DIY workarounds.

Now it writes from that graph.

## Compose is live

The new **Compose** screen drafts:

- Posts, threads, and articles
- Short-form and long-form video scripts
- Follow-up replies and sequels
- Repurposed posts from any account you Watch

Pick a kind, optionally set the platform and angle, and OpenReply blends your agent’s voice + knowledge + corpus into a structured draft. Edit, save, or schedule it.

The **Repurpose** flow is my favorite: go to Watch, click **Rewrite →** on any post, and land in Compose with the source text pre-filled and the Repurpose pill already selected. The agent keeps the insight, drops the original framing, and writes it in your voice.

## Auto-pilot: daily drafts while you sleep

Compose now has an **Auto-pilot** panel. Set it to daily, and every morning you get:

- **1 content draft** from your agent’s brain (default: post)
- **1 reply draft** to the top opportunity found that day

Both are throttled and waiting in your Queue for review. Nothing posts without you.

## GEO got real

Generative Engine Optimization — getting cited by ChatGPT, Perplexity, Gemini — used to be a guessing game.

OpenReply’s **AI Visibility** screen now tracks queries and classifies each result as:

- **Cited** — your brand appears
- **Competitor** — someone else appears
- **Absent** — no one appears

With a **Perplexity API key**, it calls Perplexity Sonar directly, matches your agent’s website domain against the URLs Sonar actually cited, and reports Share of Voice + competitor chips. No key? It falls back to the LLM-based check.

Checks run on schedule but are throttled to ~once per 20 hours, so they will not quietly burn your budget.

## Why now

Search is splitting in two:

1. Traditional search → links
2. AI search → synthesized answers

If you are only optimizing for links, you are invisible in the second one. GEO is how you show up when a buyer asks an AI "what is the best ___ for ___?"

OpenReply now lets you create content *and* measure whether that content is moving the citation needle.

## Try it

OpenReply is open source:

```bash
git clone https://github.com/shaantanu9/openreply.git
uv sync --all-extras
uv run openreply agent create --name "Your Agent" --niche "your niche"
uv run openreply content generate --kind post
```

Or grab the desktop app at [openreply.myind.ai](https://openreply.myind.ai/).

As always, everything stays local-first and BYOK. Your corpus, your keys, your machine.

— Shantanu

P.S. If you are using OpenReply for a specific niche, reply and tell me which one. The next GEO example I write may use your market.
