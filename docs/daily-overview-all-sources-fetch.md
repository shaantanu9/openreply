# Daily Overview — Fetching Data From All Sources (Handoff)

> **Purpose:** Self-contained context doc. Drop this into a fresh session to
> continue work on making the "Daily Update" feed on the Overview page reliably
> pull from **all** sources. Everything needed (flow, file:line, gaps, plan) is
> here — no prior context required.
>
> **Date:** 2026-06-30 · **Repo:** reddit-myind · **Branch:** public-main

---

## TL;DR

The Daily Overview ("Daily Update") feed fetches via a **collect → corpus →
rank** pipeline, not a direct fetcher. A source only appears in the feed if it
(1) successfully writes to the corpus during `collect()`, (2) gets surfaced by
the ranker's 240-item corpus read, and (3) falls inside the freshness window.
The current in-progress diff already fixed the daily-delta windowing and added
product sources. **The remaining work is source reliability** — the `community`
(lemmy/mastodon) and `research` (scholar) buckets fetch nothing in practice.

---

## Architecture — the 3 layers

### Layer 1: Frontend (SWR pattern)
`app-tauri/src/or/dynamic.js`

- `dynamic.js:448-460` — on overview open: `loadCachedDigest()` paints the
  cached digest from `localStorage` instantly, then calls `api.agentDigest(false)`
  and repaints + re-caches.
- `dynamic.js:430-438` — **Refresh now** button → `api.agentDigest(true)` forces
  a fresh build (`digestPaint({ building: true })` shows the spinner state).
- `dynamic.js:421-429` — search box → `api.agentDigestSearch(q)` (on-demand,
  read-only, does not persist).
- `dynamic.js:300-306` — `DIGEST_CATS` (news/articles/community/research) +
  `digestCatOf()` — must stay in sync with `digest.py` category rules.
- `dynamic.js:338-416` — `digestPaint()` renders the briefing column + the feed
  column (category pills + scroll list).

Cache key: `or.digest.${a.id}` in `localStorage`; only reused if `d.day === today`
(`dynamic.js:440-447`).

### Layer 2: IPC
- `api.js:195` — `agentDigest(rebuild) => call("agent_digest", { rebuild })`
- `api.js:196` — `agentDigestSearch(query) => call("agent_digest_search", {query})`
- `api.js:83` — both registered in the Tauri command allow-list.
- Tauri command → Python CLI (`agent_digest`).

### Layer 3: Backend build
`src/openreply/reply/digest.py` — `build_digest()` at `digest.py:328`.

Pipeline (only runs on first-call-of-day or `rebuild=True`; otherwise returns
the cached `reply_digest` row at `digest.py:347-350`):

```
_digest_sources_for_agent(a)        # source list                 digest.py:107
   ↓
collect(topic, sources=…,           # fetch → shared corpus       digest.py:384
        skip_reddit=True,
        skip_extraction=True,
        extra_keywords=…)
   ↓
learn_for_agent(ingest_limit=25)    # ingest into brain           digest.py:402
   ↓
_fresh_items(since_utc, exclude…)   # rank top-N FROM corpus      digest.py:406
   ↓
_synthesize(a, feed, provider)      # LLM goal-framed briefing    digest.py:414
   ↓
reply_digest row (1 per agent/day)  # cache                       digest.py:431
```

**Key insight:** the feed is built from the **corpus** (`_fresh_items` →
`list_corpus`), NOT from `collect()`'s return value. `collect()` just populates
the corpus; the ranker decides what surfaces. A source can collect successfully
and still not appear if it gets buried under the 240-item corpus cap.

---

## The source buckets

`CATEGORY_SOURCES` at `digest.py:30`:

| Bucket | Sources | Reliability |
|---|---|---|
| `news` | gnews, rss_tech_news, rss_products, rss_listings, duckduckgo, appstore, playstore, trustpilot | ✅ free/fast |
| `articles` | devto, hn, github, producthunt | ✅ free/fast |
| `community` | lemmy, mastodon | ⚠️ **need instance URLs — usually empty** |
| `research` | arxiv, pubmed, scholar | ⚠️ **scholar blocks aggressively** |

- `DIGEST_SOURCES` (`digest.py:38`) = flat list of all of the above.
- `_digest_sources_for_agent(a)` (`digest.py:107`) = `DIGEST_SOURCES` + any
  connected Reach sources via `connected_collection_sources()` (`digest.py:113`),
  minus `{reddit, reddit_free}` (`digest.py:111`). **Reddit is intentionally
  excluded** — it lives on the Opportunities surface, not "what's new."
- Category mapping for surfaced corpus items: `_CATEGORY_RULES` at `digest.py:44`
  + `_category_of()` at `digest.py:56` (prefix-tolerant: `github_trending`,
  `scholar:kw`, `rss_*` all resolve).

---

## What has to succeed for a source to appear (3 gates)

1. **collect() writes it to corpus.** Each source is wrapped in its own try, so
   one flaky provider doesn't kill the others — but it silently yields nothing.
   Per-source counts land in `sources_json.by_source` (`digest.py:421`).
2. **`_fresh_items` surfaces it** (`digest.py:167`). Reads `list_corpus(limit=240)`
   (`digest.py:183`) and ranks by
   `0.55·freshness + 0.25·engagement + 0.20·source_weight` (`digest.py:199`).
   `per_cat_floor=3` guarantees each category's top-3 get in *if present in corpus*
   — this is what keeps the pills non-empty.
3. **Freshness window includes it.** Daily-delta logic (in current diff):
   - Strict "since last digest" window first (`digest.py:241`)
   - Fall back to `fallback_days=3` if thin (`digest.py:247-254`)
   - Undated items as last resort so feed is never empty (`digest.py:257-262`)

---

## Current uncommitted state (already fixed)

`git diff src/openreply/reply/digest.py` — 158 insertions, 42 deletions. Already done:

- ✅ Daily-delta windowing (`since_utc`, `exclude_ids`, fallback tiers) — feed was
  previously a flat 7-day window with no day-over-day delta.
- ✅ Product sources mixed into news/articles (appstore, playstore, trustpilot,
  rss_listings, producthunt).
- ✅ `_agent_extra_keywords()` (`digest.py:88`) — folds product/brand/persona/
  keywords into the collect fan-out (product + persona aware).
- ✅ `_digest_sources_for_agent()` auto-appends connected Reach sources.

`src/openreply/research/collect.py` — 9 insertions (default source list tweaks).

---

## Remaining work (the actual gaps)

### P1 — Community bucket fetches nothing
`lemmy`/`mastodon` (`digest.py:34`) return nothing without explicit instance URLs.
Reddit is (correctly) excluded. **Options:**
- (a) Document that Community needs Reach connections (bluesky/mastodon) wired —
  already auto-appended via `connected_collection_sources()` (`digest.py:113`).
- (b) Accept Community is often empty and de-emphasize the pill when count=0.

### P1 — `scholar` blocks aggressively
In the `research` bucket (`digest.py:35`). Swap to more reliable academic sources
already recognized by `_CATEGORY_RULES` (`digest.py:45`):
`openalex`, `crossref` (and keep `arxiv` + `pubmed`).

### P2 — Dead-provider visibility
`sources_json.by_source` (`digest.py:421`) records per-source counts but isn't
surfaced anywhere. A source failing silently (0 every day) is invisible. Add a
debug tooltip / dev surface showing `by_source` so dead providers are obvious.

### P2 — Corpus cap can bury low-volume sources
`list_corpus(limit=240)` (`digest.py:183`) means a low-volume source's fresh items
can get buried under 240 higher-volume ones. If a source collects but never
appears, raise the cap or query per-category in `_fresh_items`.

---

## Proposed action items (pick from these)

- [ ] **(b)** Swap `scholar` → `openalex` + `crossref` in `CATEGORY_SOURCES`
      research bucket (`digest.py:35`). Low risk, high reliability win.
- [ ] **(a)** Add a `by_source` debug surface (tooltip or dev-only panel) to the
      Daily Update card so dead providers are visible.
- [ ] **(c)** Raise the `list_corpus` cap (`digest.py:183`) or make `_fresh_items`
      query per-category so low-volume sources aren't buried.
- [ ] Decide Community bucket strategy: wire Reach connections vs de-emphasize
      empty pill in `dynamic.js` (`DIGEST_CATS` / `digestPaint`).
- [ ] After changes: `graphify update .`, add a changelog entry under
      `changelogs/`, update `FEATURES.md` Daily Update section.

---

## Key file:line reference card

| What | Location |
|---|---|
| Frontend SWR load | `app-tauri/src/or/dynamic.js:448-460` |
| Refresh button | `app-tauri/src/or/dynamic.js:430-438` |
| Feed render | `app-tauri/src/or/dynamic.js:338-416` |
| Frontend category map | `app-tauri/src/or/dynamic.js:300-306` |
| IPC bindings | `app-tauri/src/or/api.js:195-196`, `:83` |
| Source buckets | `src/openreply/reply/digest.py:30` |
| Source list for agent | `src/openreply/reply/digest.py:107` |
| Category mapping | `src/openreply/reply/digest.py:44,56` |
| build_digest | `src/openreply/reply/digest.py:328` |
| collect() call | `src/openreply/reply/digest.py:384` |
| _fresh_items (ranker) | `src/openreply/reply/digest.py:167` |
| corpus cap (240) | `src/openreply/reply/digest.py:183` |
| ranking formula | `src/openreply/reply/digest.py:199` |
| by_source counts | `src/openreply/reply/digest.py:421` |
| search_news (on-demand) | `src/openreply/reply/digest.py:437` |
| collect default sources | `src/openreply/research/collect.py:386-445` |

---

## How to resume in a fresh session

Paste this file and say: *"Continue from this handoff — start with [action item]."*
All the context needed is above. Re-run `graphify update .` after edits and keep
the changelog + FEATURES.md in lockstep per repo rules.
