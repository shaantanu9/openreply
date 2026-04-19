# Query expansion — design

**Date:** 2026-04-19
**Status:** Approved, ready for implementation planning
**Scope:** Extend `_canonicalize_topic` to also return scored search keywords; `collect.py` uses them to query each source with multiple variants, not just the canonical string.

## Goal

Today's fix (commit `768f04b`) sends ONE canonical query per source. Recall is limited — "calorie tracking app" misses posts that say "food log", "macro tracker", or "MyFitnessPal". Extend to **query expansion**: the same LLM call that canonicalizes also returns 5-8 scored keywords (synonyms, product names, category terms). `collect.py` loops over high-relevance keywords for each source.

## Non-goals
- Per-source custom keyword sets (one list, reused across sources).
- Hand-editable keyword overrides (future: could expose in UI).
- Semantic (embedding-based) expansion — LLM-generated list only.
- Translating keywords to other languages.

---

## 1. Data shape

Extended return of `_canonicalize_topic`:
```python
{
    "canonical": str,
    "variants": list[str],          # existing — for "Did you mean?" modal
    "confidence": "high" | "low" | "unknown",
    "search_keywords": [
        {"keyword": str, "relevance": "high" | "medium" | "low"},
        ...
    ],
}
```

`search_keywords` always contains the canonical as the first entry with `relevance="high"`. 5-8 entries total. Each keyword is 1-4 words (short enough to work in search APIs with strict query lengths).

## 2. LLM prompt extension

Current prompt returns `{canonical, variants, confidence}`. Extend to also return `search_keywords`. One API call, not two — saves money and latency.

```
SYSTEM:
You validate a user's topic string AND expand it into a search-keyword set.
Return the canonical form (with typo correction), alternative interpretations,
and 5-8 scored search keywords for querying Reddit, academic search engines,
HN, and app stores.

USER:
Topic: "{topic}"

Return JSON:
{
  "canonical": "<best guess of the topic>",
  "variants": ["<alt1>", "<alt2>"],
  "confidence": "high" | "low",
  "search_keywords": [
    {"keyword": "<term>", "relevance": "high" | "medium" | "low"},
    ...
  ]
}

Rules:
- Include the canonical itself as the FIRST keyword (relevance "high").
- 5-8 keywords total. Each 1-4 words. No duplicates.
- "high": a searcher looking for this topic would definitely use this term.
- "medium": related, plausibly useful. Adds noise if overused.
- "low": tangentially related. Excluded from default collect runs.
- Include common product names that dominate the domain (e.g. for "calorie
  tracking app": MyFitnessPal, Lose It, Cronometer).
```

## 3. Cache

Reuse `topic_canonicalizations` — add one column `keywords_json TEXT` (lazy migration at startup; existing rows get `NULL` and will re-LLM on next use to populate it).

## 4. Consumption in `collect.py`

- After `search_topic = _canon["canonical"]`, also extract `kw_list = [k["keyword"] for k in _canon["search_keywords"] if k["relevance"] == "high"]`.
- Aggressive mode: include `"medium"` too.
- Cap at **`GAPMAP_MAX_KEYWORDS`** env var (default 5; aggressive caps at 8).
- **Reddit stages:** `render_queries` already expands to multiple queries per category; concatenate keyword variants before passing. The existing per-query politeness delay `_SLEEP` prevents hammering.
- **Extra sources** (`collect_adapter.py`): each source adapter receives one topic string today. Change the contract: adapters receive a **list of keywords**, loop over them internally with per-source delay. Start with a shared `delay_s=1.0` between queries per adapter.
- Storage key is still the canonical (no change — all keyword variants store under the same `topic`).

## 5. Risks
- **Rate limits:** HN (60 r/min), arXiv (politeness ~3 r/sec). With 5 keywords per adapter and 6-second cumulative delay per adapter, typical collect bumps from ~60s to ~120s. Acceptable.
- **Noise creep:** `medium`-relevance keywords can drift off-topic. Aggressive mode only.
- **Cache miss after schema migration:** one-time; re-LLM on next collect is acceptable.
- **LLM latency:** still one call, same prompt. ~200-300 tokens returned vs 150 before. Negligible cost increase.

## 6. Acceptance criteria
- `_canonicalize_topic` result includes a non-empty `search_keywords` list when LLM is configured.
- `keywords_json` column exists in `topic_canonicalizations`.
- Running collect for "calari tracking app" fires multiple search queries (visible in the log): "calorie tracking", "macro tracking", "MyFitnessPal", etc., not just "calorie tracking app".
- `GAPMAP_MAX_KEYWORDS=1` reduces to single-query behavior (back-compat escape hatch).
- All previously-passing tests still pass; 3 new tests cover expansion.
