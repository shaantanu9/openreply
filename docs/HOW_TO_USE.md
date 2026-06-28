# How to use OpenReply

OpenReply turns raw chatter — Reddit threads, HN discussions, arXiv papers, App Store reviews, GitHub issues, PDFs you own — into a product build guide backed by direct citations. This doc walks through how each piece fits together so you know what to click, what to ingest, and what to trust in the output.

## The pipeline in one picture

```
  Reddit ──┐
  HN ──────┤
  arXiv ───┤        corpus              graph                build guide
  PubMed ──┼──▶  (SQLite posts)  ─▶  (painpoints,  ─▶   (Report tab:
  OpenAlex ┤      multi-source         feature wishes,        evidence +
  Scholar ─┤      parallel fetch       DIY workarounds,       prioritised
  App/Play ┤      ──────────────       products)              features +
  GitHub ──┤      dedup + score        ──────────────         paper citations)
  Your PDFs┘      gate bypass          LLM extraction
  ──────
  YOU ingest              ^                      ^                  ^
                    (research collect)    (graph enrich)      (Report tab)
```

Everything is offline and local. Keys, DB, and generated HTML live under `~/.config/reddit-myind/` and `~/Library/Application Support/com.shantanu.openreply/`.

## Step 1 — Configure an LLM

1. Open **Settings → API keys & provider**.
2. Save a key for any one of: Anthropic, OpenAI, OpenRouter, Groq, DeepSeek, Mistral, Gemini.
   Or set the Ollama base URL (default `http://localhost:11434`) and click **Pull model** to get `gemma3:4b`.
3. Click **Test** on that provider — must show `✓ model · latency · reply: OK`.
4. Click a model chip to set it as the default. The banner at the top of the modal shows the active provider and model. The same pill lives in the topic-page header.

You can swap providers at any time — every analysis step reads the default at call-time, so changing it affects the next Enrich / Chat / Report without touching old data.

## Step 2 — Collect a topic

Click **+ New topic** (or run `reddit-cli research collect "<topic>"`).

What happens:
1. **Discovery.** The tool finds the 8 most-relevant subreddits for your topic.
2. **Reddit top posts.** For each sub, pulls top-of-month + top-of-year.
3. **Parameterized searches.** Runs pain/feature/complaint/DIY query templates over each sub.
4. **Extra sources (parallel fan-out).** In Aggressive mode, fires HN / App Store / Play Store / arXiv / OpenAlex / PubMed / Scholar / GitHub / DevTo / Lemmy / Mastodon / gnews / stackoverflow / trends in parallel across 6 workers. Expect ~4–6× faster than the old serial run.
5. **Historical backfill.** pullpush.io for pre-May-2025 data.

Every row lands in the `posts` table with a `source_type` column (`reddit`, `arxiv`, `pubmed`, `appstore`, …). Deduping is by row id; re-running a collect is safe.

## Step 3 — Ingest your own documents (optional)

Drag a file into the **Ingest** screen (or `reddit-cli ingest file --path ./paper.pdf --topic "<topic>" --source-type ingest`).

Supported formats: `.csv .json .txt .vtt .srt .md .pdf`

**PDF extraction:**
- If **Java 11+** is installed, the app uses `opendataloader-pdf` which preserves headings (Abstract / Methods / Results / References) and tables as markdown. This dramatically improves LLM extraction quality on scientific papers.
- Otherwise it falls back to `pypdf` (flat text). Still works.
- Scanned image-only PDFs yield empty text — run `ocrmypdf in.pdf out.pdf` first, then re-ingest.

Ingested docs show up under the **Research** tab tagged as "Ingested docs", and feed the same corpus the LLM reads from.

## Step 4 — Enrich (LLM extraction)

Click **Enrich** on the Map tab (or let the first Map load auto-enrich). The LLM runs four extractors over the corpus:

- **Painpoints** — what users complain about (severity, frequency, classification as chronic / emerging / fading).
- **Feature wishes** — what users explicitly ask for.
- **Products complained about** — named competitors with their weak spots.
- **DIY workarounds** — what users are building themselves. **This is the strongest signal** — each workaround is a feature that doesn't exist in a shipping product.

**Critical:** the corpus filter no longer drops score=0 academic papers. arXiv preprints and PubMed papers without citation counts used to be silently ghosted — they now reach the LLM alongside Reddit threads. The LLM sees each row with a source-aware prefix so it can weight peer-reviewed claims vs anecdotal ones:

```
[arxiv:2401.12345] arXiv — Paper title
<abstract>

[r_abc123] r/rust (12↑ 5c) — Reddit title
<excerpt>
```

## Step 5 — Read the tabs

| Tab | What it shows | What to do with it |
|---|---|---|
| **Map** | Interactive D3 force-graph of every finding + its linked posts | Click a node to see its evidence panel. Zoom to inspect clusters. |
| **Report** | Deterministic markdown synthesis | **Read top-to-bottom.** Acts as a build guide. See below. |
| **Evidence** | Raw findings list grouped by kind | Click a finding to see its supporting posts — check if a painpoint is saturated (≥12 evidence, ≥2 sources) before trusting it. |
| **Trends** | Keyword frequency over time | Validate whether a painpoint is rising (emerging) or fading. |
| **Sources** | Post counts per source type + date range + top subreddits | Gut-check the corpus balance. If you're 95% Reddit, collect papers next. |
| **Research** | arXiv / OpenAlex / PubMed / Scholar / Ingested PDFs, grouped | Read the actual papers. Each card has an **Open** button → DOI / URL. |
| **Chat** | Ask questions grounded in the graph | Try the "1-week plan" / "Features to build" presets. Evidence now mixes Reddit + papers so answers are science-backed. |
| **Solutions** | Prototype / design variants (optional) | Use for visual brainstorming. |

## Step 6 — The Report tab as your build guide

The Report is regenerated on demand and contains six sections, each answering a specific product question:

1. **Corpus stats + Science & research evidence** — what data backs this report. Every paper is listed with its DOI/URL so your claims are re-verifiable.
2. **Painpoints** — ranked by frequency, cross-source confirmation (Reddit + papers), severity badge, direct evidence quotes.
3. **DIY workarounds** — what users build themselves. Each row is your product backlog.
4. **Competitors** — named products + their weaknesses. Your positioning map.
5. **Feature wishes** — explicit asks with frequency counts. Your roadmap.
6. **First 20 users to interview** — highest-engagement authors from the top 3 painpoints. These are real Reddit handles you can DM today.
7. **How to use this report** — a footer telling you what to do with each section (day 1 through day 6+).

**The report is designed to be read once and acted on.** It's not a summary — it's a build plan.

## Step 7 — Iterate

The loop:

```
  collect → enrich → read Report → DM users → refine topic → recollect
```

Things to change between runs:
- **Different subs** — edit via Rerun collect and override the discovered sub list.
- **More historical** — aggressive mode pulls 3 years of pre-May-2025 data.
- **Different provider/model** — swap in Settings; next Enrich uses it.
- **Own documents** — drop PDFs into Ingest to add private signal (interview transcripts, Slack exports, customer calls, leaked strategy decks).

## Conventions — where things live

| Thing | Location |
|---|---|
| API keys + env | `~/.config/reddit-myind/.env` (chmod 600, never uploaded) |
| Corpus DB | `~/Library/Application Support/com.shantanu.openreply/reddit.db` |
| OpenReply HTML viewers | same dir as DB, per topic |
| Reports | generated on the fly, also saved next to the DB |

## Troubleshooting

- **"Chat is blocked: no LLM key"** — Settings → add key → Test → pick a default model.
- **"Enrichment skipped: no corpus"** — run Rerun collect first.
- **"No such model" on Ollama** — Settings → Ollama → Pull model → pick `gemma3:4b` (~2.5 GB).
- **PDF ingest says "empty text"** — run `ocrmypdf in.pdf out.pdf` and re-ingest.
- **Enrich returns zero findings on a new topic** — your corpus probably has no high-signal posts yet. Rerun collect in Aggressive mode (pulls historical + all extra sources).
- **Research tab empty** — no academic sources in this topic. Rerun collect with Aggressive mode (enables arXiv, OpenAlex, PubMed by default), or drop a PDF into Ingest.
