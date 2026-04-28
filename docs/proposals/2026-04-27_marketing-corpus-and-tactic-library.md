# Marketing Corpus + Tactic Library

**Date:** 2026-04-27
**Status:** Proposal
**Owner:** shantanubombatkar2@gmail.com

## Goal

Give the gap-finding / sentiment engine a **marketing brain**: free, scrape-friendly sources (RSS + public-domain books) feeding into the existing corpus, plus a `tactic_library` table the LLM can map any user complaint to a proven persuasion tactic.

## Why

- Current adapters surface what users say, not how to *answer* it.
- Cialdini's 7 triggers + STEPPS + Eugene Schwartz's 5 awareness stages = the canonical playbook. All free in the public domain or via RSS.
- Existing infra already supports it: `rss_catalog.py`, `paper_fulltext.py`, `paper_chunks.py`, ChromaDB embeddings, `oc_*` adapter pattern.

## Scope at a glance

| # | Item | Status | Effort |
|---|---|---|---|
| 1 | Expand `rss_catalog.marketing` (3 → 15+ feeds) | ⏳ Pending | 30 min |
| 2 | Add new category `persuasion` (Cialdini-adjacent psychology) | ⏳ Pending | 20 min |
| 3 | Add `swipe` category (annotated historic ads — swiped.co, RGE) | ⏳ Pending | 20 min |
| 4 | Wire 3 new categories into `collect_adapter.SOURCES` + `CATEGORY_LABELS` | ⏳ Pending | 15 min |
| 5 | Pretty labels in `cli/main.py` collect wizard | ⏳ Pending | 10 min |
| 6 | Public-domain book ingest script (`scripts/ingest_marketing_books.py`) | ⏳ Pending | 1.5 h |
| 7 | `tactic_library` SQLite table + seed from book chunks | ⏳ Pending | 2 h |
| 8 | LLM mapping step in `gaps.py` / `insights.py`: gap → matching tactic | ⏳ Pending | 2 h |
| 9 | UI: show "Suggested tactics" panel on gap detail screen | ⏳ Pending | 1.5 h |
| 10 | Changelog entry + manual-todo for follow-ups | ⏳ Pending | 10 min |
| — | Existing `rss_marketing` (HubSpot, CXL, Growth.Design) | ✅ Done | — |
| — | `paper_fulltext` PDF download + chunking | ✅ Done | — |
| — | ChromaDB ONNX embeddings | ✅ Done | — |
| — | `oc_*` adapter pattern (bluesky / substack / producthunt) | ✅ Done | — |

## Sources we'll add

### RSS feeds (free, no API keys)
**Expand `marketing` category:**
- Marketing Examples — `https://marketingexamples.com/rss.xml`
- Demand Curve — `https://www.demandcurve.com/rss.xml`
- First Round Review — `https://review.firstround.com/rss` (already in startup, dedupe)
- Reforge blog — `https://www.reforge.com/blog/rss.xml`
- ConversionXL Institute — `https://cxl.com/institute/feed/`
- Stacked Marketer (free tier) — `https://newsletter.stackedmarketer.com/feed`
- Indie Hackers Marketing — `https://www.indiehackers.com/tags/marketing/feed.xml`
- Really Good Emails — `https://reallygoodemails.com/feed.xml`
- Lenny's Newsletter (already in startup, dedupe)

**New `persuasion` category:**
- Growth.Design case studies — `https://growth.design/feed.rss` (move here)
- Nielsen Norman Group — `https://www.nngroup.com/feed/rss/` (already in design, leave; cross-ref)
- Choice Hacking — `https://www.choicehacking.com/feed/`
- Behavioral Scientist — `https://behavioralscientist.org/feed/`
- The Sludge (BIT/IBE) — `https://www.bi.team/feed/`
- Farnam Street — `https://fs.blog/feed/`

**New `swipe` category:**
- Swiped.co — `https://swiped.co/feed/`
- AdAge Creativity — `https://adage.com/section/creativity/rss.xml`
- Ads of the World (RSS via 3rd-party) — `https://rss.app/feeds/adsoftheworld.xml` *(verify URL)*

### Public-domain books (one-shot ingest via `paper_fulltext` pipeline)
| Title | Author | Source URL | License |
|---|---|---|---|
| Scientific Advertising | Claude Hopkins | archive.org/details/scientificadve00hopk | PD |
| My Life in Advertising | Claude Hopkins | archive.org | PD |
| The Psychology of Advertising (1908) | Walter Dill Scott | gutenberg.org / archive.org | PD |
| Advertising and Selling | H. L. Hollingworth | archive.org | PD |
| The Psychology of Salesmanship | W. W. Atkinson | gutenberg.org | PD |
| Principles of Advertising | Daniel Starch | archive.org | PD |
| The Robert Collier Letter Book (1937 ed.) | Robert Collier | archive.org | PD-US (verify) |

## Implementation steps

### Step 1 — expand RSS catalog
**File:** `src/reddit_research/sources/rss_catalog.py`
- Append entries to `CATALOG["marketing"]`.
- Add new keys: `CATALOG["persuasion"]`, `CATALOG["swipe"]`.
- Add to `CATEGORY_LABELS`: `"persuasion": "Persuasion / behavioral"`, `"swipe": "Ad swipe files"`.
- Optionally add `"persuasion"` and `"marketing"` to `DEFAULT_CATEGORIES` if we want them in the bundled `rss` source.

### Step 2 — wire into collect adapter
**File:** `src/reddit_research/sources/collect_adapter.py` (line ~849-859)
- Append two lines to `SOURCES`:
  ```python
  "rss_persuasion": _rss_category_runner("persuasion"),
  "rss_swipe": _rss_category_runner("swipe"),
  ```

### Step 3 — pretty labels in CLI wizard
**File:** `src/reddit_research/cli/main.py`
- Find the `oc_*` pretty-label map added in commit `8c695b5`.
- Add: `"rss_persuasion": "Persuasion / behavioral"`, `"rss_swipe": "Ad swipe files"`, refreshed `"rss_marketing": "Marketing / growth (15 feeds)"`.

### Step 4 — public-domain book ingest
**New file:** `scripts/ingest_marketing_books.py`
- Hardcoded list of (title, author, pdf_url) tuples.
- For each: synthesize a `post_id = "pdbook_<slug>"`, set `source = "marketing_book"`, insert a stub row in `posts` (title = book title, author, url = archive.org URL, selftext = "" placeholder).
- Call `paper_fulltext.get_full_text(post_id, force=True)` — but it needs a resolver for `marketing_book` source. **Alternative:** download PDF directly with `httpx`, write to `paper_cache/marketing_book/<slug>.txt` via the existing `_extract_text` helper, then mark `paper_full_texts` row as `ok`.
- After ingest, run `paper_chunks.chunk_paper(post_id)` so chunks land in ChromaDB and are queryable.

### Step 5 — tactic library
**New file:** `src/reddit_research/research/tactic_library.py`
- Schema (auto-create on first use):
  ```sql
  CREATE TABLE IF NOT EXISTS tactic_library (
    id INTEGER PRIMARY KEY,
    slug TEXT UNIQUE,                -- "scarcity", "loss_aversion"
    name TEXT,                       -- "Scarcity"
    framework TEXT,                  -- "cialdini" | "steppz" | "schwartz" | "fogg" | "custom"
    description TEXT,                -- 1-paragraph summary
    when_to_use TEXT,                -- LLM-generated trigger conditions
    examples_json TEXT,              -- list of {source_post_id, snippet}
    embedding_id TEXT,               -- ChromaDB id for semantic match
    created_at TEXT,
    updated_at TEXT
  );
  ```
- Seed file: `data/tactics_seed.json` with 30-40 entries (Cialdini 7 + STEPPS 6 + Schwartz 5 awareness + Fogg behavior model + 10 copywriting devices).
- `seed_from_json()` loads file and upserts; `find_matching_tactics(text, k=5)` does ChromaDB cosine search → returns top tactics.

### Step 6 — gap → tactic mapping
**Modify:** `src/reddit_research/research/gaps.py` (or `insights.py`)
- After a gap is identified, call `tactic_library.find_matching_tactics(gap.summary, k=5)`.
- LLM prompt: "Given this user pain `{gap.summary}` and these candidate tactics `{tactics}`, pick the 2 best and explain in 1 sentence each how to apply."
- Persist result on the gap row as `suggested_tactics_json`.

### Step 7 — UI surfacing
**Modify:** Tauri frontend gap detail screen
- New collapsible panel "💡 Suggested tactics" rendering `suggested_tactics_json`.
- Click a tactic → modal with the seed description + example snippets from books.

## How to test

### Smoke tests (after each step)

| Step | Test |
|---|---|
| 1 | `python -c "from reddit_research.sources.rss_catalog import CATALOG; print(len(CATALOG['marketing']), len(CATALOG['persuasion']), len(CATALOG['swipe']))"` → ≥15, ≥5, ≥3 |
| 2 | `python -c "from reddit_research.sources.collect_adapter import SOURCES; print('rss_persuasion' in SOURCES, 'rss_swipe' in SOURCES)"` → True True |
| 3 | Run app → collect wizard → confirm "Persuasion / behavioral" + "Ad swipe files" appear with pretty labels |
| 4 | `python scripts/ingest_marketing_books.py --dry-run` then full run; verify `data/paper_cache/marketing_book/*.txt` exist and `SELECT COUNT(*) FROM paper_full_texts WHERE post_id LIKE 'pdbook_%' AND status='ok'` ≥ 6 |
| 5 | `python -c "from reddit_research.research.tactic_library import seed_from_json, find_matching_tactics; seed_from_json(); print(find_matching_tactics('users say onboarding is too long', k=3))"` → returns 3 tactics with cosine scores |
| 6 | Pick a known topic with existing gaps → run `find_gaps` → confirm `suggested_tactics_json` populated; eyeball quality |
| 7 | Open gap detail in UI → tactics panel renders; click → modal with description |

### End-to-end test
1. Create new topic "fitness app onboarding".
2. Enable sources: existing reddit/HN + new `rss_marketing`, `rss_persuasion`, `rss_swipe`.
3. Run collect (aggressive preset).
4. Run `find_gaps`.
5. Open one gap → confirm:
   - Evidence pulled from at least 2 marketing/persuasion sources.
   - "Suggested tactics" panel shows 2 tactics with applied advice referencing book chunks.
6. Run `chat` over the topic asking "what does Hopkins say about headlines?" → answer cites `pdbook_scientific-advertising` chunks.

### Rollback
- All RSS additions are additive — remove entries from `rss_catalog.py` to disable.
- Book ingest writes to its own `marketing_book` source — `DELETE FROM posts WHERE source='marketing_book'` reverses it.
- `tactic_library` table is self-contained — `DROP TABLE tactic_library` if abandoning.

## Open questions

1. Should `rss_persuasion` be added to `DEFAULT_CATEGORIES` so the bundled `rss` source pulls it by default? (Lean: no — keep opt-in.)
2. Tactic-mapping LLM call adds cost per gap. Cache by gap-hash? (Lean: yes, in `tactic_library_cache` table.)
3. Books like Cialdini's *Influence* are NOT public domain — we can only ingest pre-1929 / clearly-PD works. Confirm copyright per title before pushing to `data/`.

## Out of scope (future)

- Paid sources (Reforge full content, Trends.vc reports).
- Video transcripts (Y Combinator talks, founder podcasts) — separate adapter via `youtube` + transcript API.
- Image-ad OCR for swipe files.
