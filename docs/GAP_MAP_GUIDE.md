# Gap Map — complete guide

A single source-of-truth for how Gap Map works end-to-end: what every source does, how the LLM sees your data, how to read the Build Guide, and every knob you can turn. Written as the session doc across all recent upgrades — use the table of contents to jump to what you need.

## Contents

1. [What Gap Map is](#what-gap-map-is)
2. [Quick start (first topic in 5 minutes)](#quick-start)
3. [LLM configuration](#llm-configuration)
4. [Data sources — all 16 of them](#data-sources)
5. [Ingest your own documents (CSV / MD / PDF)](#ingest-your-own-documents)
6. [The topic page — 8 tabs explained](#the-topic-page)
7. [The Report as a Build Guide](#the-report-as-a-build-guide)
8. [The chat experience](#the-chat-experience)
9. [Architecture highlights](#architecture-highlights)
10. [File layout + privacy](#file-layout--privacy)
11. [Troubleshooting](#troubleshooting)
12. [Upgrade history (sessions log)](#upgrade-history)

---

<a id="what-gap-map-is"></a>
## 1. What Gap Map is

Gap Map is a desktop research tool that turns raw chatter — Reddit threads, Hacker News discussions, arXiv papers, App Store reviews, GitHub issues, YouTube comments, your own PDFs — into a **build guide backed by direct citations**. Every painpoint traces to its original source. Every competitor claim traces to a Reddit post you can read. Every cited science paper is one click away from its DOI.

It runs **entirely locally**:
- **Tauri 2** desktop shell + vanilla JS frontend (cream/orange theme)
- **Python sidecar** (PyInstaller bundle in production, `.venv` in dev) for all the heavy lifting
- **SQLite** with WAL mode for the corpus, with thread-local connections for parallel fetchers
- **Your LLM keys stay in** `~/.config/reddit-myind/.env` with chmod 600 — never uploaded

The research loop:

```
  collect (parallel fan-out)  →  enrich (LLM extraction)  →  read the Build Guide  →  DM the users  →  refine  →  recollect
```

---

<a id="quick-start"></a>
## 2. Quick start

### (1) Configure an LLM

Open **Settings → API keys & provider**. The modal lists 8 providers:

| Provider | Strength | Free tier? |
|---|---|---|
| Anthropic | Best JSON extraction, long context | Limited credits |
| OpenAI | Flagship GPT-4o / o1 | Limited credits |
| **OpenRouter** | One key → 342+ models (Claude, GPT, Llama, DeepSeek, …) | Pay-per-token, very cheap |
| Groq | Fastest inference (Llama 3.3, Mixtral) | Generous free tier |
| DeepSeek | Cheap + strong on code | Low-cost |
| Mistral | Multilingual | Limited free |
| Google Gemini | Big free tier | Yes |
| **Ollama (local)** | 100% local, 100% private | Totally free |

Save a key, click **Test**. You should see `✓ <model> · <ms> · reply: OK`. Then click a model chip to set it as the default. The banner at the top of the modal shows the active `<provider> · <model>` — same pill is duplicated in every topic page header.

**Dynamic model list (new):** every provider's chip list is **fetched live** from its `/models` endpoint when you have a key saved. OpenRouter shows all 342 models with a search box. Anthropic shows every Claude version available to your key. When no key is saved yet, a static curated shortlist preview is shown. Fetch results are cached for 5 minutes per provider. Live fetch happens server-side (Rust → `reqwest`) to bypass browser CORS.

### (2) First topic

Click **+ New topic** on the home screen → enter the topic name → optionally toggle **Aggressive** (pulls historical + all extra sources). Collect runs for 1–5 minutes depending on sources + Reddit auth state.

The collect pipeline is:

1. Discover the 8 most-relevant subreddits
2. Reddit top-of-month + top-of-year per sub (sequential, 2 s politeness)
3. Parameterized searches over each sub (pain / features / complaints / DIY templates)
4. **Parallel fan-out across non-Reddit sources** — up to 6 workers, hits HN / arXiv / OpenAlex / PubMed / Scholar / GitHub / App Store / Play Store / gnews / DevTo / trends / YouTube simultaneously
5. Historical backfill via pullpush.io (pre-May-2025 Reddit)

### (3) Read the Build Guide

Open the topic → click **Report** tab. That markdown doc *is* your build guide — ranked painpoints with evidence, DIY workarounds (= your feature backlog), named competitors, explicit feature wishes, science evidence with DOIs, and a "first 20 users to DM" list. See [§7](#the-report-as-a-build-guide).

---

<a id="llm-configuration"></a>
## 3. LLM configuration

### Active provider and model

The **active-LLM pill** in the topic page header shows which provider + model will handle enrich / chat / extractions. Click it to open the BYOK modal.

- Change provider/model at any time — every analysis step reads the current default at call-time, so swapping affects the *next* Enrich / Chat / Report, not past data.
- Each cloud provider's chip row is a live fetch from its `/models` endpoint. Filter input appears automatically when > 15 models. Active model floats to top of the sorted list.
- Cloud providers without a saved key show the static curated picks as a preview.

### Ollama (local)

If you want 100% local / offline:

1. Install Ollama (https://ollama.com/download)
2. In BYOK modal → Ollama card → click **Pull model** → pick `gemma3:4b` (~2.5 GB, fastest good default)
3. App auto-detects the service and lists installed models as clickable chips — click to activate

The BYOK modal can **start / stop the Ollama service** and **pull / delete models** directly. No terminal needed.

### BYOK behind the scenes

All keys live in one file: `~/.config/reddit-myind/.env` (chmod 600).

```
LLM_PROVIDER=openrouter
LLM_MODEL=anthropic/claude-sonnet-4-6
OPENROUTER_API_KEY=sk-or-…
YOUTUBE_API_KEY=AIza…
ANTHROPIC_API_KEY=sk-ant-…
…
```

The Python sidecar reads the file via `load_dotenv` at startup. Every extractor / chat / gap-finder uses `resolve_provider()` to pick the right provider based on `LLM_PROVIDER` + whichever key is set. No code path hardcodes a provider anymore.

**Fix: OpenAI-compatible providers.** Earlier builds routed OpenRouter / Groq / Mistral / DeepSeek / Gemini all into a hardcoded `OpenAIProvider()` that demanded `OPENAI_API_KEY`. Now `OpenAIProvider` accepts a `provider` arg and has a `_PROVIDER_CONFIG` table (per-provider env key + base URL + default model), so every OpenAI-compatible provider works correctly.

---

<a id="data-sources"></a>
## 4. Data sources — all 16 of them

### Reddit (always on)

Uses PRAW. Public mode works without auth (60 req/min); save Reddit client ID + secret in the BYOK "Data sources" tab to bump to 100 req/min.

### Non-Reddit sources (parallel fan-out, 6 workers)

| Source | Endpoint | Auth | Rate limit |
|---|---|---|---|
| **HN** (Hacker News) | Algolia HN search | None | Generous |
| **arXiv** | `export.arxiv.org/api/query` (Atom) | None | Polite (UA attached) |
| **OpenAlex** | `api.openalex.org/works` | None | 10 r/s (polite pool via `mailto:`) |
| **PubMed** | NCBI E-utilities | Optional `NCBI_API_KEY` | 3 r/s free → 10 r/s with key |
| **Semantic Scholar** | `api.semanticscholar.org/graph/v1` | Optional `SEMANTIC_SCHOLAR_API_KEY` | 1 r/s free → 100 r/s with key |
| **App Store reviews** | iTunes RSS + search | None | UA identifies traffic |
| **Play Store reviews** | `google-play-scraper` (web scrape) | None | Fragile — package-maintained |
| **GitHub trending + issues** | GitHub REST v3 | Optional `GITHUB_TOKEN` | 60 r/h anon → 5 000 r/h with token |
| **DevTo** | `dev.to/api/articles` | None | Public |
| **Lemmy / Mastodon** | Federated API (needs instance URL) | None | Instance-dependent |
| **Google News** (gnews) | RSS via feedparser | None | Polite |
| **StackOverflow** | Stack Exchange API | None | 300 r/day anon |
| **Wikipedia** | REST API | None | Very generous |
| **Google Trends** | pytrends | None | Returns series, not posts |
| **YouTube comments** (new) | YouTube Data API v3 | Required `YOUTUBE_API_KEY` | 10 000 units/day free |
| **Discourse forum** | Needs explicit instance URL | None | Opt-in, not in aggressive default |

### Aggressive mode (default when enabled)

```
["hn", "appstore", "playstore", "arxiv", "openalex", "pubmed",
 "gnews", "devto", "stackoverflow", "github", "trends"]
```

YouTube is NOT in aggressive-default — enable it by saving a `YOUTUBE_API_KEY` and using a manual `--sources youtube` override, or rerun after saving the key.

### Polite traffic compliance (post-audit)

Every science + app-review adapter now sends a `User-Agent` header:
```
reddit-myind/0.1 (+https://github.com/shaantanu98/reddit-myind; mailto:shantanubombatkar2@gmail.com)
```

Shared `polite_get(url)` helper handles `Retry-After` on 429 (single retry, capped at 15 s). OpenAlex includes `mailto:` in the query string for polite-pool priority. Scholar sleeps 1.1 s between pages (free tier floor) or 0.1 s if `SEMANTIC_SCHOLAR_API_KEY` is set.

---

<a id="ingest-your-own-documents"></a>
## 5. Ingest your own documents

Open the **Ingest** screen or run `reddit-cli ingest file --path ./paper.pdf --topic "<topic>" --source-type ingest`.

Supported extensions: `.csv` `.json` `.txt` `.vtt` `.srt` `.md` `.pdf`

### PDF extraction — dual extractor

The PDF pipeline tries the richer engine first, falls back to the always-available one:

- **Preferred: `opendataloader-pdf`** — Java-backed (needs JRE 11+). Preserves headings, tables, sections (Abstract / Methods / Results / References) as markdown. Dramatically improves LLM extraction quality on scientific papers. 22 MB wheel. Install via `pip install "reddit-myind[ingest-rich]"`.
- **Fallback: `pypdf`** — pure Python, no external deps. Flat text. Always available.

If both return empty (scanned image-only PDFs), the ingest surfaces a clear error: "run `ocrmypdf in.pdf out.pdf` first."

Ingested PDFs land in `source_type='ingest'`, show up in the **Research** tab under "Ingested docs", and feed the same corpus the LLM reads from.

---

<a id="the-topic-page"></a>
## 6. The topic page — 8 tabs

| Tab | What it shows | What to do with it |
|---|---|---|
| **🕸 Map** | Interactive D3 force-graph of every finding + its evidence posts | Click nodes to zoom to evidence. Rebuild to re-extract. |
| **📄 Report** | Citation-rich markdown — **the Build Guide** | Read top-to-bottom. See [§7](#the-report-as-a-build-guide). |
| **🔎 Evidence** | Raw findings per kind with live filter + "show more" | Type in the filter to narrow by label. Pagination: 20 per kind, reveal 20 at a time. |
| **📈 Trends** | Keyword frequency over time | Validate chronic vs emerging vs fading signals. |
| **◈ Sources** | Post counts per source + date range + top subreddits | Gut-check the corpus balance. |
| **📚 Research** (new) | arXiv / OpenAlex / PubMed / Scholar / Ingested PDFs, grouped | Sort Most-cited / Newest. Each paper has **Open** (→ URL) + **Cite** (→ markdown citation copied to clipboard). |
| **💬 Chat** | Streaming LLM chat grounded in the graph + corpus | 5 presets + free-form. Auto-grow textarea. Per-message copy + regenerate. Export thread as `.md`. |
| **⚡ Actions** | Rerun collect, ingest, export, delete | Danger zone. |
| **🧪 Solutions** | Prototype variants (optional) | Visual brainstorming. |

### Topic-page header always shows

- **Crumbs** `Workspace / <topic>`
- **Active collect** pulse chip (when a collect is running for this topic)
- **Stats chips** `<posts> · <pains> · <DIY> · <sources>`
- **Active LLM pill** `<provider> · <model>` — click to open BYOK modal
- **Rerun collect** + **Delete**

### Chat tab details

- **Compact preset pills** (replaces the old tall preset cards) — horizontally scrollable on narrow widths
- **Auto-grow textarea** — Enter = send, Shift+Enter = newline, Cmd/Ctrl+Enter still works
- **Animated typing dots** while the assistant warms up (streaming LLM)
- **Per-message hover actions** — Copy (every assistant reply), Regenerate (last reply only)
- **Relative timestamps** ("2m ago") with 30 s live refresh
- **Export conversation** as `.md` with full thread + tool-call collapsibles
- **Source-aware evidence** — LLM sees `[arxiv:2401.12345]` / `[r_abc] r/rust` / `[ingest:paper.pdf]` / `[youtube:vid_id]` prefixes so it weights peer-reviewed claims differently from Reddit anecdotes
- **History persists to localStorage** per topic (`gapmap.chat.<topic>`, last 50 messages) — survives page reloads

### Evidence tab details

- **Live filter input** at top — 180 ms debounced, narrows all 4 kinds by label substring
- **Search preserves focus + caret** across re-renders
- **Pagination** 20 per kind + "Show N more"; Rust-side cap bumped from 20 → 100 per kind
- **Error card with retry** on load failure

### Research tab details

- **Sort toggle** — Most-cited (score DESC) / Newest (created_utc DESC)
- **Per-paper card** — source badge (color-coded: arxiv=rose, openalex=lavender, pubmed=sky, scholar=mint, ingest=gold), title, abstract excerpt, citation count, author, date
- **Open button** → external browser via `api.openUrl()`
- **Cite button** → copies markdown citation: `**Title** — Author — _arXiv · 2024-01-15 · 42 cites_ — https://arxiv.org/abs/…`

### Toasts + error cards

All over the topic page:
- **Toast stack** (bottom right) — ok / warn / err variants, auto-dismiss in 5 s, manual close button
- **Error cards with retry** replace the old "Error: …" text-only states on Report / Evidence / Sources / Research tabs
- **Skeleton loaders** (animated shimmer matching card shapes) instead of generic "Loading…" text

---

<a id="the-report-as-a-build-guide"></a>
## 7. The Report as a Build Guide

The Report tab is **not a summary** — it's a build guide. Seven sections, each answering a specific product question:

| Section | Product question | What to do with it |
|---|---|---|
| **Corpus stats + Science & research evidence** | What data backs this report? | Click each paper's DOI/URL → read the actual science |
| **🔥 Painpoints** (ranked by frequency + cross-source) | What's the market pain? | Trust the HIGH severity + MULTI-source ones. Cross-source = Reddit *and* arXiv — peer-reviewed + lived experience |
| **🛠 DIY workarounds** | What's your backlog? | **Every row is a feature that doesn't exist in a shipping product.** Strongest possible signal. |
| **😡 Competitors** | What's your positioning? | For each named product + its weakness, build the anti-version. Don't clone. |
| **💡 Feature wishes** | What's your roadmap? | Top 3–5 are day-one. Tail can wait. |
| **First 20 users to interview** | How do you validate? | Real Reddit handles, publicly living the problem. DM them today. |
| **📖 How to use this report** | Day 1 → Day 6+ workflow | Action items with dates. |

Each evidence post is rendered with source-aware citation — arXiv papers say arXiv, App Store reviews say App Store ⭐, Reddit threads show `r/sub`. All links are real and clickable.

---

<a id="architecture-highlights"></a>
## 8. Architecture highlights

### Parallel multi-source collect

- `ThreadPoolExecutor(max_workers=6)` wraps the "extra sources" stage
- Reddit stages stay sequential (2 s politeness) — Reddit 429s on concurrent public-mode hits
- Progress events are lock-protected so parallel workers don't interleave mid-line
- Expected speedup: ~4–6× on aggressive collects

### SQLite thread-safety

- **`get_db()`** returns a per-thread `Database` via `threading.local()` — sqlite3 connections can't cross threads
- **PRAGMA journal_mode=WAL** + **busy_timeout=5000** on every new connection → concurrent writers serialize on a short filesystem lock, concurrent readers never block
- **`init_schema()`** runs exactly once under a `threading.Lock()` — all other threads reuse the already-created tables

### LLM provider resolution

- **`resolve_provider()`** priority: explicit arg → `LLM_PROVIDER` env (if its key is set) → first key found → reachable Ollama → ValueError
- **`OpenAIProvider(provider=...)`** accepts any OpenAI-compatible vendor; base URL + env key + default model looked up in `_PROVIDER_CONFIG`
- Model override: `LLM_MODEL` env trumps per-provider default

### Ollama hardening (for small-model users)

Small local models (`llama3.2:3b`, `gemma3:4b`) have two failure modes that used to silently produce zero findings:

| Problem | Fix |
|---|---|
| httpx timeout at exactly 120 s → `enrich failed: timed out` | Timeout bumped to **600 s** default, overridable via `OLLAMA_TIMEOUT=<seconds>` env var |
| JSON output truncated at `num_predict=2048` → parse error → `isinstance(..., list)` check drops the payload → `painpoints_added: 0` even though the LLM ran successfully | Ollama `format: "json"` flag applied automatically when the system prompt mentions "JSON". Constrains the grammar to valid JSON output, so even truncated arrays are syntactically closed |

**Bigger models are still recommended** for complex extraction: `gemma3:4b` or `llama3.1:8b+` produce dramatically better painpoint lists than `llama3.2:3b`. But with these fixes, even the 3 B model now returns real findings instead of silent zeros.

Config env vars:
```bash
OLLAMA_BASE_URL=http://localhost:11434    # where the daemon is
OLLAMA_TIMEOUT=600                        # per-generation timeout (seconds)
LLM_PROVIDER=ollama
LLM_MODEL=llama3.2:3b
```

### Source-aware LLM prompts

Every LLM-facing path (`gaps.py`, `chat.py`, `report_pro.py`) uses `research/corpus_format.py::format_corpus()`. Each row gets a source-tagged header:

```
[arxiv:2401.12345] arXiv — Paper title
<abstract excerpt>

[r_abc123] r/rust (12↑ 5c) — Reddit title
<excerpt>

[appstore:tracktype] App Store review (4★) — Review title
<review body>

[youtube:dQw4w9WgXcQ] YouTube — Video title
<comment body>

[ingest:paper.pdf] Local file — Title
<markdown body>
```

The LLM knows what it's reading and weights peer-reviewed claims differently from Reddit anecdotes. Scholar / OpenAlex citation counts show in the prefix so the model can tier evidence.

### Dynamic model list per provider

- Rust command `list_provider_models(provider)` hits the vendor's `/models` endpoint server-side (bypasses browser CORS for Anthropic / OpenAI / Groq / etc.)
- Normalizes each vendor's shape to uniform `[{id, context_length?, description?}]`
- Filters non-chat models (embeddings / Whisper / DALL-E / TTS / moderation; `bert` family for Ollama; non-`generateContent` for Google)
- 5 min cache per provider; invalidated on any `byok_set` so new keys unlock live fetch immediately

### runpy warning fix

- `cli/__init__.py` no longer eager-imports `main` — prevents the `'reddit_research.cli.main' found in sys.modules` warning when Tauri spawns `python -m reddit_research.cli.main`
- Every sidecar spawn now gets clean stderr

---

<a id="file-layout--privacy"></a>
## 9. File layout + privacy

| Thing | Location |
|---|---|
| API keys + env vars | `~/.config/reddit-myind/.env` (chmod 600) |
| Corpus DB | `~/Library/Application Support/com.shantanu.gapmap/reddit.db` |
| Gap Map HTML viewers | same dir as DB, per topic |
| Generated reports (markdown) | same dir, per topic |
| Ollama model cache | `~/.ollama/models` |
| Chroma embed cache (when palace is used) | `~/.cache/chroma/onnx_models/` |

**Nothing uploads anywhere.** All LLM calls go direct from your machine to the provider you chose (or stay on-box via Ollama). All fetches go direct from your machine to the source API. All corpus storage is local SQLite.

---

<a id="troubleshooting"></a>
## 10. Troubleshooting

| Symptom | Fix |
|---|---|
| "No LLM key yet" | Settings → add key → Test → pick a default model |
| "Ollama not reachable" | Settings → Ollama → Start service, or run `ollama serve` |
| "gemma4:e2b" or any model **hangs 0 tokens** | `ollama rm <model> && ollama pull gemma3:4b` — `gemma4` isn't a real family |
| `OPENAI_API_KEY not set` when using OpenRouter/Groq/etc. | Fixed in bundle #10 — restart dev server so latest Python is loaded |
| `OperationalError: no such table: …` | Run a collect first — tables are populated on first real write |
| `ANTHROPIC_API_KEY not set` when you have Ollama | Fixed — `resolve_provider()` no longer hardcodes Anthropic |
| Enrich returns zero findings on new topic | Corpus has no high-score posts — rerun in aggressive mode to pull historical + extra sources |
| Research tab empty | No academic sources fetched — rerun aggressive, or ingest a PDF |
| PDF ingest "empty text" | Scanned image PDF — run `ocrmypdf in.pdf out.pdf` first |
| `RuntimeWarning: 'reddit_research.cli.main' found in sys.modules` | Fixed in bundle #14 — empty `cli/__init__.py` |
| Chat shows "No LLM key" but you have keys saved | No default picked — open BYOK and click any model chip |
| Play Store adapter crashes | `pip install google-play-scraper>=1.2` — fixed in bundle #17 |
| YouTube tab/source empty | Need `YOUTUBE_API_KEY` — Settings → Data sources → YouTube |
| Semantic Scholar 429 blocks | Get free `SEMANTIC_SCHOLAR_API_KEY` (takes a few days approval) for 100× rate |
| Reddit rate limit in public mode | Save Reddit client ID + secret in Data sources tab (60 → 100 r/min) |
| Chat dots animation forever | LLM model too large for your RAM (e.g. 70B on 16 GB) — switch to a smaller Ollama model |
| "Load failed" on Report file | Asset protocol scope — already fixed; restart Tauri dev |
| Tauri dev server won't pick up new Rust command | `cargo check` in `src-tauri/` then restart Tauri dev |

---

<a id="upgrade-history"></a>
## 11. Upgrade history (this session)

17 bundles shipped across the session. Each has a dedicated changelog under `changelogs/`.

| # | Bundle | What changed |
|---|---|---|
| 07 | **Splash theme** | Dark navy → cream/orange, matches app shell |
| 08 | **BYOK curated chips** | Click-to-activate model chips per provider (replaced free-text model field) |
| 09 | **Topic page UI polish** | Toasts, error cards with retry, skeleton loaders, Evidence pagination, subreddit pagination, chat history persistence, active-LLM pill in header |
| 10 | **Fix provider routing** | `OpenAIProvider` now supports OpenRouter / Groq / DeepSeek / Mistral / Google / OpenAI via `_PROVIDER_CONFIG` table — killed the "OPENAI_API_KEY not set" bug for every OpenAI-compat provider |
| 11 | **Parallel multi-source collect** | `ThreadPoolExecutor(6)` + thread-local SQLite + WAL mode. ~4–6× faster aggressive collects |
| 12 | **Gap Map theme match** | Map-tab D3 viewer dark palette → cream/orange to match the rest of the app |
| 13 | **Research + PDFs first class** | Papers with score=0 no longer excluded from LLM; source-aware prompt formatting; dual PDF extractor (opendataloader-pdf preferred, pypdf fallback); new Research tab on topic page; Report upgraded to build guide |
| 14 | **runpy warning fix** | `cli/__init__.py` de-eager-imported; `RuntimeWarning` gone on every sidecar spawn |
| 15 | **Chat / Evidence / Research UX** | Compact preset pills, auto-grow textarea, typing dots, per-message copy/regen, relative timestamps, export chat as .md, Evidence search filter, Research sort toggle + copy-citation |
| 16 | **Dynamic provider models** | Replaced hardcoded chip lists with live `/models` fetch via new Rust `list_provider_models` command + reqwest. OpenRouter returns 342 live models with inline search |
| 17 | **Every source polite + YouTube** | Shared `_http.polite_get` with User-Agent, `mailto:` for OpenAlex polite pool, Scholar rate limit fix + `SEMANTIC_SCHOLAR_API_KEY` support, `NCBI_API_KEY` surfaced, `google-play-scraper` installed, `run_youtube` wired into `SOURCES`, BYOK "Reddit" tab renamed to "Data sources" with YouTube / Scholar / PubMed key fields |

### Skill evolutions (global `~/.claude/skills/`)

`tauri-python-sidecar-app` skill gained three new gotchas:
- `OPENAI_API_KEY not set` misrouting (bundle #10)
- `SQLite objects created in a thread` (bundle #11)
- `database is locked` + WAL fix (bundle #11)
- `RuntimeWarning: 'pkg.cli.main' found in sys.modules` (bundle #14)

---

## Appendix — command cheat sheet

```bash
# First-time dev install
uv sync --all-extras
pip install "google-play-scraper>=1.2"    # Play Store
pip install "opendataloader-pdf"          # PDF structure-aware ingest (needs Java 11+)

# CLI usage (same binary the Tauri sidecar spawns)
reddit-cli --help
reddit-cli research collect "my topic" --aggressive
reddit-cli research collect "my topic" --sources youtube,arxiv,hn  # specific sources only
reddit-cli ingest file --path ./paper.pdf --topic "my topic" --source-type ingest
reddit-cli research graph build --topic "my topic"
reddit-cli research graph enrich --topic "my topic" --provider openrouter
reddit-cli research report-pro --topic "my topic" --out report.md
reddit-cli research chat "my topic" "what's the top pain point?" --json

# DB inspection
reddit-cli query "SELECT kind, count(*) FROM graph_nodes WHERE topic='my topic' GROUP BY kind"
reddit-cli query "SELECT source_type, count(*) FROM posts JOIN topic_posts tp ON tp.post_id=posts.id WHERE tp.topic='my topic' GROUP BY source_type"

# Rebuild the Python sidecar for production DMG
pyinstaller reddit-cli.spec
cp dist/reddit-cli app-tauri/src-tauri/binaries/reddit-cli-aarch64-apple-darwin
codesign --force --deep --sign - app-tauri/src-tauri/binaries/reddit-cli-aarch64-apple-darwin
```

---

*Generated from the session work on 2026-04-19. Refer to individual changelogs under `changelogs/` for the line-level diff per feature.*
