# Source-Addition Playbook — Learning miroclaw's Data Layer, Adding ALL Candidate Sources to OpenReply

> **Date:** 2026-06-07 · **Status:** Implementation playbook + decision framework (no production code changed yet)
> **Learned from:** `~/Documents/miro_jyotish/miroclaw_jyotish/backend/app/services/data_sources/` (`base.py`, `router.py`, `collector.py`, `sources/*`)
> **Target:** `reddit-myind` (OpenReply) — `src/openreply/sources/`
> **Companion:** `docs/specs/MIROCLAW_OPENREPLY_FULL_ANALYSIS.md` (the strategic "which sources help" decision — this file is the *how to add any/all of them* mechanics + comparison)

**Goal of this file:** document the full mechanics for adding *any* external source to OpenReply (learned from miroclaw's clean pattern), provide a **template + step-by-step recipe**, then **catalog every candidate source** (all 12 from miroclaw + extras) with a **scoring framework** so we can later compare and add the best — not just GDELT + web search.

---

## PART 1 — The two source architectures, side by side

Both repos use the same philosophy ("one file per source + register it"), but different contracts.

| Concern | miroclaw | OpenReply |
|---|---|---|
| **Unit of a source** | A class `XSource(BaseSource)` with `fetch(query, max_results, start_date, end_date)` | A module function `fetch_<name>(query, limit, ...) -> list[dict]` |
| **Output contract** | `DataResult` dataclass (`source, category, title, content, url, published_at, relevance_score, metadata`) | **Common `posts` row dict** (`id, sub, source_type, author, title, selftext, url, score, upvote_ratio, num_comments, created_utc, is_self, over_18, flair, permalink, fetched_at`) |
| **Registry** | `sources/__init__.py` → `ALL_SOURCES = {id: Class}` | `sources/__init__.py` → import + `__all__`; plus a `collect_<name>` in `collect_adapter.py` |
| **Selection** | `router.py` keyword → source-id list (LLM-free) | Caller picks sources (collect UI / CLI flags); no central router yet |
| **Parallel fetch** | `collector.py` `ThreadPoolExecutor` + dedup | `collect_adapter.py` per-source `collect_*` with `log_fetch_start/end` + `upsert_posts`; orchestrated by `collect.py` ThreadPool |
| **Never-raise rule** | `_safe_fetch` wrapper catches + returns `[]` | each adapter try/except → `[]`; `log_fetch_end(..., error=...)` |
| **Key gating** | `requires_api_key` flag; router skips when env var absent | lazy import + env check inside the fetch fn; degrade to `[]` |
| **HTTP politeness** | per-source | centralized `sources/_http.py` (`polite_get`, UA, Retry-After) |
| **Persistence** | returns to caller (LLM text) | writes to SQLite `posts` table via `upsert_posts` |

**Takeaway:** miroclaw's `BaseSource`/`DataResult` is a slightly cleaner *abstraction*; OpenReply's `posts`-row contract is more *powerful downstream* (dedup + graph + sentiment + audience clustering all work for free on any new source). **We keep OpenReply's contract** and **borrow miroclaw's best ideas** (router, historical flags, min-year guards, `requires_api_key`).

---

## PART 2 — The canonical OpenReply "add a source" recipe

Every new source touches the same **6 files** (7 if it introduces a new source *family*). This is the exact wiring trail traced from existing sources (`gnews`, `hackernews`).

### Step 1 — `src/openreply/sources/<name>.py` (the fetcher)
Write `fetch_<name>(query, limit=50, **opts) -> list[dict]` returning rows in the **common posts shape**. Rules:
- **Never raise** — catch, return `[]`.
- Use `sources/_http.polite_get` for HTTP (gets UA + Retry-After for free).
- Lazy-import optional deps with the standard message: `raise RuntimeError("Install sources extra: pip install -e '.[sources]'")`.
- `source_type` = your stable id; `permalink=None` for non-Reddit sources (the frontend prepends reddit.com to permalink — a non-empty value makes a broken link); put the real link in `url`.
- Synthesize a stable `id` (`f"<name>_{hash(...) & 0xffffffff:x}"`).
- Map a real timestamp into `created_utc` (epoch seconds) when available — downstream temporal/forecast features depend on it.

**Template:**
```python
"""<Source> — <one-line what + key/no-key + historical?>."""
from __future__ import annotations
from datetime import datetime, timezone
import httpx
from ._http import polite_get

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")

def fetch_<name>(query: str, limit: int = 50,
                 start_date: str | None = None,
                 end_date: str | None = None) -> list[dict]:
    try:
        r = polite_get("https://api.example.com/search",
                       params={"q": query, "limit": limit})
        r.raise_for_status()
        data = r.json()
    except httpx.HTTPError:
        return []
    rows: list[dict] = []
    for it in data.get("items", [])[:limit]:
        rows.append({
            "id": f"<name>_{hash(it.get('id') or it.get('url') or '') & 0xffffffff:x}",
            "sub": (it.get("section") or "<name>")[:60],
            "source_type": "<name>",
            "author": it.get("author") or "",
            "title": (it.get("title") or "")[:300],
            "selftext": (it.get("body") or it.get("summary") or "")[:2000],
            "url": it.get("url") or "",
            "score": int(it.get("score") or 0),
            "upvote_ratio": None,
            "num_comments": int(it.get("comments") or 0),
            "created_utc": float(it.get("ts") or 0.0),
            "is_self": 0, "over_18": 0, "flair": None,
            "permalink": None,
            "fetched_at": _now_iso(),
        })
    return rows
```

### Step 2 — `src/openreply/sources/__init__.py`
Add `from .<name> import fetch_<name>` and append `"fetch_<name>"` to `__all__`. Update the module docstring's "zero-config / config-gated" lists.

### Step 3 — `src/openreply/sources/collect_adapter.py`
Add a `collect_<name>(topic_or_keywords, limit=...)` so multi-source collect includes it. Simple sources use the existing helper:
```python
def collect_<name>(topic_or_keywords, limit: int = 50) -> int:
    from .<name> import fetch_<name>
    return _run_simple_list(topic_or_keywords, "<name>", fetch_<name>, limit)
```
`_run_simple_list` already does keyword expansion + `log_fetch_start/end` + `upsert_posts` + error capture. Custom flows (per-app reviews, date ranges) follow the `collect_hn`/`collect_appstore` shape instead.

### Step 4 — `src/openreply/mcp/server.py`
Register the MCP tool (mirrors `openreply_fetch_gnews` at server.py:1746):
```python
def openreply_fetch_<name>(query: str, limit: int = 30) -> list[dict]:
    """<docstring the LLM/UI sees>."""
    from ..sources.<name> import fetch_<name>
    return fetch_<name>(query=query, limit=limit)
```

### Step 5 — `src/openreply/cli/main.py`
Add `<name>` to the source-list help string (~line 1315) and its dispatch branch.

### Step 6 — `pyproject.toml`
If the source needs a new lib, add it to `[project.optional-dependencies] sources`. **Sidecar caution:** anything added here gets frozen into the PyInstaller DMG — prefer pure-Python/`httpx`-only deps; avoid heavy/native libs (see Part 6).

### Step 7 (only if a new source FAMILY) — `source_families.py` + `app-tauri/src/lib/postLink.js`
If the source emits subtypes (like `youtube_*`) or is "reddit-like", update `YT_FAMILY`/`REDDIT_FAMILY` on **both** the Python and JS sides, or the rows go invisible to sentiment/sources/audience.

### Acceptance per source
- [ ] `fetch_<name>("test")` returns posts-shaped rows or `[]` (never raises).
- [ ] Rows appear in `posts` after `collect_<name>`.
- [ ] `openreply_fetch_<name>` callable via MCP/CLI.
- [ ] No new heavy/native dep in the default bundle.
- [ ] `created_utc` populated (forecast/temporal features need it).

---

## PART 3 — The best ideas to borrow FROM miroclaw (not the sources — the design)

These are the architecture lessons worth importing regardless of which sources we add:

1. **A keyword router** (`router.py`). OpenReply has no central "given this topic, which sources?" selector — the user picks manually. Porting a keyword→source map (e.g. *fintech topic → add Trustpilot + App Store + GitHub issues*; *science topic → arXiv + PubMed + OpenAlex*) would auto-pick a smart default source set per topic. **High value, LLM-free, ~120 lines.**
2. **Historical-capability flags + per-source min-year guard.** miroclaw tags each source as historical-capable and skips sources with no data for old windows (eliminating pre-1997 timeout waste). **This is exactly what the P1 forecast engine's leak-free `historical_collector` needs.** Adopt a `SUPPORTS_HISTORICAL` / `MIN_YEAR` registry.
3. **`requires_api_key` declared up-front** so the orchestrator skips key-less sources cleanly instead of failing mid-collect.
4. **`relevance_score` stamped per row** (miroclaw computes a query-match relevance). OpenReply mostly leaves `score=0` for non-Reddit; a lightweight relevance heuristic would improve ranking/dedup.
5. **`category` tagging** (news/web/economic/sentiment). Maps onto OpenReply's `source_families` idea — useful for the Sources tab + sentiment bucketing.

---

## PART 4 — Catalog of ALL candidate sources (the full menu to compare)

Below is every source from miroclaw's 12 **plus** extra generally-useful ones, each with: what it gives, key, historical, posts-row fit, OpenReply relevance, effort, verdict. Use the scoring framework in Part 5 to rank.

### Group A — miroclaw's 12

| Source | Gives | Key | Historical | OpenReply fit | Effort | Verdict |
|---|---|---|---|---|---|---|
| **GDELT** | Structured global news/events, India-or-any country filter, date ranges | No | **Yes** | Event-driven topics; **forecast ground-truth/seed**; fills news-history hole | Low (`gdeltdoc`) | **ADD (high)** |
| **DuckDuckGo** | General web+news search (keyless) | No | No | OpenReply has **no general web search**; context/seed fallback | Low (`duckduckgo-search`) | **ADD (med)** |
| **Tavily** | High-quality web search (LLM-grade) | Yes (free 1k/mo) | No | Better web context than DDG; forecast seed | Low | **ADD (med, key-gated)** |
| **World Bank** | Country macro indicators (GDP, CPI, unemployment…), annual | No | Yes (1960+) | Only **market-sizing/TAM** enrichment | Low (`wbgapi`) | **OPTIONAL (market-sizing)** |
| **FRED** | US macro series (rates, VIX, yields), deep history | Yes (free) | Yes | Market-sizing/macro context only | Low | **OPTIONAL (market-sizing)** |
| **BIS** | Central-bank rates, REER, credit/GDP, monthly | No | Yes | Market-sizing/macro only | Med (CSV parse) | **OPTIONAL (niche)** |
| **Google Trends** | Search-interest time series | No | Yes (2004+) | **Already have** (`fetch_trends`) | — | **SKIP (dupe)** |
| **Google News** | Localized news RSS | No | No | **Already have** (`fetch_gnews`) | — | **SKIP (dupe)** |
| **India RSS** | Newspaper RSS feeds | No | No | **Already have** generic `fetch_rss` + `rss_catalog` | — | **SKIP (dupe)** |
| **yfinance** | Stock/commodity OHLCV | No | Yes | Irrelevant unless markets/fintech topic | Low | **SKIP (off-domain)** |
| **Open-Meteo** | Weather/rainfall | No | Yes (1940+) | Irrelevant to product gaps | Low | **SKIP (off-domain)** |
| **ACLED** | Conflict/protest events | Yes (free) | Yes | Irrelevant to product gaps | Med (OAuth) | **SKIP (off-domain)** |

### Group B — Extra sources worth considering (NOT in miroclaw, native to OpenReply's domain)
These are higher-value *for gap discovery* than most of miroclaw's finance set. Listed so the comparison is complete.

| Source | Gives | Key | OpenReply fit | Verdict |
|---|---|---|---|---|
| **Reddit (authenticated)** | Deeper historical/comments beyond public | OAuth | Core voice-of-customer | Already core |
| **G2 / Capterra reviews** | B2B SaaS reviews (pain/wishes, competitor) | Scrape/key | **Very high** — direct competitor pain | Consider |
| **Glassdoor / Indeed** | Employee/role pain (for ops/HR topics) | Scrape | Niche-high | Consider |
| **Amazon product reviews** | Consumer-product pain at scale | Scrape/key | High for consumer topics | Consider |
| **Quora / StackExchange (beyond SO)** | Q&A intent signals | API | Medium | Consider |
| **Indie Hackers / Hacker News Who-is-hiring** | Builder/market signals | Scrape | Medium | Consider |
| **Crunchbase / ProductHunt (have PH)** | Funding/competitor launches → "gap-will-be-filled" ground truth | Key | High for forecast event-dim | Consider (forecast) |
| **App store rank/SDK trackers (data.ai-style)** | Adoption trajectory | Key (paid) | Medium | Later |

---

## PART 5 — Comparison framework (how to pick the best to add)

Score each candidate 1–5 on these weighted criteria; rank by weighted total. This is the objective basis for "compare the best and add in ours."

| Criterion | Weight | 5 = | 1 = |
|---|---|---|---|
| **Domain relevance** (does it surface user pain / wishes / competitor signal / forecast ground-truth?) | ×3 | Direct voice-of-customer or forecast truth | Off-domain (finance/weather) |
| **Uniqueness** (does OpenReply already cover this?) | ×2 | No overlap | Exact dupe |
| **Cost/keys** (friction to enable) | ×2 | Keyless, unlimited | Paid/registration/OAuth |
| **Historical support** (needed by forecast engine) | ×2 | Deep date-range | None |
| **Packaging safety** (pure-python/httpx vs heavy/native dep) | ×2 | httpx-only | Heavy native (sidecar risk) |
| **Implementation effort** | ×1 | `_run_simple_list` one-file | Custom auth + parsing |

**Pre-computed ranking (using the verdicts above):**
1. **GDELT** — relevance(4)×3 + unique(5)×2 + cost(5)×2 + hist(5)×2 + packaging(4)×2 + effort(4) = **64**
2. **DuckDuckGo** — 4×3 +5×2 +5×2 +1×2 +5×2 +4 = **52**
3. **Tavily** — 4×3 +5×2 +3×2 +1×2 +5×2 +4 = **48**
4. **G2/Capterra (extra)** — 5×3 +5×2 +2×2 +1×2 +3×2 +2 = **49** *(high relevance, but scrape/key + effort)*
5. **World Bank** — 2×3 +5×2 +5×2 +5×2 +4×2 +4 = **48** *(but only useful for market-sizing — discount accordingly)*
6. **FRED** — 2×3 +5×2 +4×2 +5×2 +5×2 +4 = **48** *(same caveat)*
7. **BIS** — 2×3 +5×2 +5×2 +5×2 +4×2 +2 = **46** *(market-sizing only, more effort)*
8. **yfinance / Open-Meteo / ACLED** — relevance 1 dominates → bottom; **do not add** unless a specific markets/climate topic demands it.
9. **Google Trends / News / India-RSS** — uniqueness 1 → **skip (dupes)**.

> Note: "market-sizing" sources (World Bank/FRED/BIS) score deceptively high on mechanics but their *relevance* is gated to one feature. Only add them when/if the market-sizing enrichment is actually built.

---

## PART 6 — Packaging & sidecar safety (mandatory)

OpenReply ships as a Tauri + PyInstaller DMG. Every source dep is frozen into the binary.
- **Prefer httpx-only sources** (GDELT via REST instead of pulling pandas-heavy `gdeltdoc`? evaluate — `gdeltdoc` pulls pandas which is *already* a transitive dep via analyze extra, so acceptable; verify before committing).
- **Avoid** adding heavy/native libs to the default `sources` extra. If a source needs one (e.g. a scraper with a headless browser), gate it behind a **separate optional extra** and a feature flag — never in the default DMG (see `tauri-fresh-install-triage` for the decompression-failure class this prevents).
- **Key-gated sources degrade to `[]`** when the env var is absent — never hard-fail the collect.
- Re-run `codegraph sync` after wiring; add a changelog; update `FEATURES.md` Sources entry.

---

## PART 7 — miroclaw `DataResult` → OpenReply `posts` row mapping (for any port)

| miroclaw `DataResult` | OpenReply `posts` row |
|---|---|
| `source` | `source_type` |
| `category` | (→ `source_families` family; optionally a `category` tag) |
| `title` | `title` |
| `content` | `selftext` |
| `url` | `url` |
| `published_at` (ISO) | `created_utc` (convert ISO→epoch seconds) |
| `relevance_score` | `score` (or a separate relevance field) |
| `metadata{}` | fold key bits into `sub`/`flair`; drop the rest |
| — | `id` (synthesize stable hash), `permalink=None`, `is_self=0`, `over_18=0`, `num_comments`, `upvote_ratio=None`, `fetched_at` |

A ~15-line adapter converts any miroclaw `XSource.fetch()` output into OpenReply rows — useful if we want to lift a source's *fetch logic* wholesale and just reshape the output.

---

## PART 8 — Recommended phased add order

1. **Phase S1 (now):** GDELT (`sources/gdelt.py` + full wiring). Highest score, keyless, historical, serves both discovery *and* the forecast engine.
2. **Phase S2:** General web search — DuckDuckGo (keyless) + Tavily (key-gated). Fills the no-web-search hole; primary use = forecast seed/ground-truth context.
3. **Phase S3 (borrow the design):** port miroclaw's **router** (keyword→source map) + **historical-capability/min-year registry** — this benefits *every* source and is a prerequisite for clean leak-free historical collection in P1.
4. **Phase S4 (only if market-sizing built):** World Bank + FRED (+ BIS) behind the market-sizing feature, key-gated.
5. **Phase S5 (domain-native, higher relevance than finance):** evaluate G2/Capterra/Amazon reviews for consumer/B2B pain — these out-score most finance sources on *relevance*; effort is the blocker.
6. **Never (default):** yfinance, Open-Meteo, ACLED — off-domain; add only per-topic on demand.

---

## PART 9 — Anti-patterns / gotchas

- **Don't set a non-empty `permalink` for non-Reddit sources** — the frontend turns it into a broken reddit.com link. Put the link in `url`.
- **Don't leave `created_utc=0`** when a timestamp exists — temporal split + forecast features silently lose the row.
- **Don't let a source raise** — one bad source must not kill a multi-source collect. Catch → `[]` → `log_fetch_end(error=...)`.
- **Don't add a heavy/native dep to the default `sources` extra** — sidecar bundle risk.
- **Don't forget `source_families.py` + `postLink.js`** for a new family — rows go invisible to sentiment/sources/audience.
- **Don't re-import duplicate sources** (Trends/Google News/RSS) — OpenReply already has them.
- **Don't claim a source is "historical" without a min-year guard** — old-window queries will timeout-waste (miroclaw's documented lesson).

---

## Appendix — Files touched per new source (checklist)
- [ ] `src/openreply/sources/<name>.py` (fetcher, posts-row, never-raise)
- [ ] `src/openreply/sources/__init__.py` (import + `__all__` + docstring lists)
- [ ] `src/openreply/sources/collect_adapter.py` (`collect_<name>` via `_run_simple_list`)
- [ ] `src/openreply/mcp/server.py` (`openreply_fetch_<name>` tool)
- [ ] `src/openreply/cli/main.py` (source list + dispatch)
- [ ] `pyproject.toml` (`[project.optional-dependencies] sources`, if new dep)
- [ ] `src/openreply/sources/source_families.py` + `app-tauri/src/lib/postLink.js` (only if new family)
- [ ] `changelogs/…`, `FEATURES.md`, `codegraph sync`
