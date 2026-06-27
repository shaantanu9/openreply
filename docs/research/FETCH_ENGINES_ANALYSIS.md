# Fetch Engines Analysis — last30days-skill, web-edge-engine, vs OpenReply (gapmap)

> Detailed analysis of two external fetch/research engines and how they relate to
> OpenReply's current data-source/fetch layer. Both external engines were **run live
> and verified working** (keyless). Conclusion: keep gapmap as OpenReply's fetch
> backbone, selectively adopt last30days' ranking + desktop-source patterns, and treat
> web-edge-engine as the blueprint for a future hosted/web OpenReply.
>
> Sources analyzed:
> `/Users/shantanubombatkar/Documents/GitHub/fintech_repos/last30days-skill` (v3.8.3) and
> its `examples/web-edge-engine`.

---

## 1. last30days-skill (Python) — what it is

"An AI agent-led search engine scored by upvotes, likes, and real money." A multi-source
"last 30 days" research skill (Claude/Codex skill + Go MCP server). Pipeline
(`lib/pipeline.py:run()`):

```
topic → planner (LLM QueryPlan) → parallel fetch (ThreadPoolExecutor, 4–16 workers,
  per (subquery×source)) → normalize → signals(relevance/freshness/quality) →
  dedupe → supplemental entity searches (X handles/subreddits) → retry thin sources →
  rerank (LLM or heuristic) → cluster (text-sim + cross-source entity merge) →
  Report (clusters, ranked, items_by_source) → HTML brief + SQLite store
```

**~18 sources** (`lib/*.py`), by auth class:
- **Keyless/public:** reddit (public JSON, 6-tier cascade), hackernews (Algolia), polymarket
  (Gamma API), github (anon tier), grounding (Brave free / DDG / SearXNG).
- **API-key:** tiktok/instagram/threads/pinterest (`SCRAPECREATORS_API_KEY`), x
  (`XAI_API_KEY`/`XQUIK_API_KEY`), bluesky (app password), perplexity, web backends
  (Brave/Exa/Serper/Parallel).
- **Cookie/binary (desktop-only):** x via **bird** (browser cookies AUTH_TOKEN/CT0 + Node
  GraphQL sidecar), truthsocial (cookies/token), youtube via **yt-dlp** (+ transcripts,
  ffmpeg/whisper), digg via `digg-pp-cli`, xiaohongshu.

**Ranking (the "scored by upvotes/likes/money"):** `rerank.py` composite —
`0.60·rerank + 0.20·RRF + 0.10·freshness + 0.05·source_quality + 0.05·engagement`, with
entity-grounding penalties/floors (first-party, interaction, rescue). RRF fusion across
sources; engagement = log-scaled likes/points/comments/views. Clustering = greedy
text-similarity + 2nd-pass cross-source entity merge, MMR representatives.

**Store/watchlist:** `store.py` SQLite (topics/research_runs/findings + FTS5), URL-dedup,
sighting deltas → `watchlist.py`/`briefing.py` digests. **MCP:** Go server (`mcp/`)
exposing one `research` tool, embeds the Python engine.

**Run (verified keyless):**
```bash
python3 skills/last30days/scripts/last30days.py "open source reddit tools" --quick --no-browser-cookies --emit compact
# → HN + Reddit, ranked clusters w/ engagement [450pts,220cmt]; no LLM key required (heuristic fallback)
python3 skills/last30days/scripts/last30days.py --diagnose --no-browser-cookies   # availability JSON
```
Keyless sources: reddit, hackernews, polymarket, github, grounding, youtube (yt-dlp). API
keys unlock the rest (`SCRAPECREATORS_API_KEY` is primary). 5-tier credential cascade
(env → project .env → global .env → macOS Keychain → `pass`).

---

## 2. web-edge-engine (TypeScript) — what it is

The **edge-safe subset** of the same engine, in **pure Web APIs** (`fetch`, Web Crypto),
~450 LOC across `engine/{types,http,util,sources,rank,index}.ts`. Same code runs in
**Deno (Supabase Edge), Node 18+, Vercel Edge**.

- **4 keyless sources out-of-the-box:** reddit (search.rss), hackernews (Algolia),
  github (REST), grounding (DuckDuckGo HTML). Key-gated upgrades: Brave, ScrapeCreators, etc.
- **Pipeline:** `runResearch(opts, config, onSource?)` → fan-out (concurrency 16) →
  per-source dedupe → RRF `fuse()` (source weights reddit 1.0 / hn 0.9 / github 0.85 /
  grounding 0.8) → optional LLM `rerank()` (OpenRouter/OpenAI; deterministic fallback) →
  `Report`. **SSE streaming** via `onSource` (one `source` event each, then `report`).
- **Deploys:** Next.js route (`app/api/research/route.ts`, Node or Edge) + browser client
  (`research`/`researchStream`); Supabase Edge function (`--no-verify-jwt`) + background-job
  table (`research_jobs`) for long `deep` runs.
- **Excluded by design:** cookie/binary sources (X-bird, yt-dlp, ffmpeg, Digg, XHS) — they
  need local cookies/binaries → desktop only.

**Run (verified keyless):**
```bash
cd examples/web-edge-engine
node --experimental-transform-types driver.ts "local-first software"
# → reddit + grounding(DDG) items, RRF-ranked, zero secrets
```
(`driver.ts` added during this analysis calls `runResearch`.) TS config needs
`moduleResolution:"bundler"`, `allowImportingTsExtensions:true`.

### The Tauri port guide (highly relevant)
`docs/TAURI_PORT_GUIDE.md` is a full **Rust desktop port spec** of the Python engine:
`tokio` + `futures::buffer_unordered(16)` for the pool, `reqwest`+`governor` for
retry/rate-limit, **cookie extraction in Rust** (Firefox `rusqlite`, Safari binarycookies
parser, Chromium AES-128-CBC via `pbkdf2`/`aes`/`cbc` + `keyring`), sidecars for
bird/yt-dlp/ffmpeg, `rusqlite` store. Phased roadmap: keyless core → cookies+X → paid
social → LLM → persistence → distribution.

---

## 3. OpenReply's current fetch (gapmap) — recap

(Full detail: `docs/architecture/TAURI_AND_FETCH_ARCHITECTURE.md`.)
- **Reddit without the API:** PRAW→cookie `.json`→RSS **tier cascade** (`fetch/_reddit_tiers.py`,
  `sources/reddit_free.py`); `discover_subs` + LLM canonicalization.
- **~58 source adapters** (`sources/collect_adapter.py`) on one `run_<source>()` contract;
  parallel collect (`research/collect.py`, ThreadPool, per-source timeout/fail-soft).
- **BYOK LLM** (8 providers, auto-resolved); credentials store (Reach Connections, cookies).
- **Tauri 2 + Python sidecar** + SQLite; already wired into the OpenReply app via the
  `reply`/`agent`/`content` commands.

---

## 4. Head-to-head

| Dimension | gapmap (OpenReply now) | last30days (Python) | web-edge-engine (TS) |
|---|---|---|---|
| Runtime | Python sidecar in Tauri | Python CLI / Go MCP | Deno/Node/Edge (web) |
| Sources | ~58 (broad: social+news+academic+econ) | ~18 (social+market+web, engagement-rich) | 4 keyless + key-gated |
| Reddit | tier cascade (cookie→RSS) | 6-tier cascade (RSS + shreddit + arctic-shift + SC) | search.rss keyless |
| Ranking | relevance gate + graph/gaps | **RRF + LLM rerank + engagement + entity floors** | RRF + optional LLM rerank |
| Clustering | graph (MiniLM) | text-sim + cross-source entity merge + MMR | dedupe only |
| Engagement scoring | partial | **strong (upvotes/likes/views, log-scaled)** | engagement bonus in fusion |
| Cookie/binary sources | cookies via Reach (x/linkedin…) | bird(X)/yt-dlp/digg/ffmpeg | excluded (desktop-only) |
| Web/serverless | no | no | **yes (Next.js + Supabase SSE)** |
| BYOK LLM | 8 providers | multi (Gemini/OpenAI/xAI/OpenRouter + local) | OpenRouter/OpenAI + deterministic |
| Verified running | yes (in app) | **yes, keyless** | **yes, keyless** |

---

## 5. Recommendation — "we can continue using that too"

**Keep gapmap as OpenReply's fetch backbone.** It already powers the app, fetches Reddit
without an API key, covers the most sources, has the BYOK LLM layer and the credentials
store, and is wired through the Tauri command triangle. No reason to rip it out.

**Selectively adopt from last30days (high-value, low-risk):**
1. **Engagement-weighted RRF ranking + entity-grounding floors** (`rerank.py`) — directly
   improves OpenReply's Opportunity scoring (relevance × intent × fit → add engagement +
   RRF fusion across platforms). This is the single best borrow.
2. **Cross-source entity clustering + MMR** (`cluster.py`) — dedupe/group mentions in the
   Inbox across platforms.
3. **Desktop-only sources via the TAURI_PORT_GUIDE patterns** — X via bird (cookies),
   yt-dlp YouTube, polymarket — to extend OpenReply's reach beyond gapmap's set, using the
   guide's Rust cookie-extraction + sidecar approach (matches our Tauri architecture).
4. **Watchlist/sighting deltas** (`store.py`) — powers the Inbox "new since last run" + alerts.

**Use web-edge-engine as the blueprint for a hosted/web OpenReply** (later): if we ever
want OpenReply in the browser (no desktop install), its Next.js + Supabase SSE engine is
drop-in for the keyless + key-gated sources, with the background-job table for deep runs.

**Both external engines run with zero keys** — so we can keep them as optional, pluggable
research backends (e.g., a "last30days" enrichment pass) without committing to keys.

---

## 6. Verified run commands (quick reference)
```bash
# Python skill (keyless): HN + Reddit, ranked clusters
python3 last30days-skill/skills/last30days/scripts/last30days.py "TOPIC" --quick --no-browser-cookies --emit compact

# Portable TS engine (keyless): reddit + DDG, RRF-ranked
cd last30days-skill/examples/web-edge-engine && node --experimental-transform-types driver.ts "TOPIC"

# OpenReply (current): agent-scoped multi-source
gapmap reply find --platforms reddit_free,hn --json
```
