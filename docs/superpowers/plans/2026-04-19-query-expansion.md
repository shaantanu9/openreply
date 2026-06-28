# Query expansion — Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans.

**Goal:** Extend `_canonicalize_topic` to return scored search keywords; have `collect.py` fan out per-source queries across the high-relevance ones.

**Spec:** `docs/superpowers/specs/2026-04-19-query-expansion-design.md`

---

## Task 1: Schema migration — `keywords_json` column

**File:** `src/reddit_research/core/db.py::init_schema`

- [ ] Inside the `topic_canonicalizations` block, add `"keywords_json": str` to the column dict. Then, after the block, add a lazy migration:

```python
    # Lazy migration for installs created before keywords_json was introduced.
    cols = {c.name for c in db["topic_canonicalizations"].columns}
    if "keywords_json" not in cols:
        db.executescript(
            "ALTER TABLE topic_canonicalizations ADD COLUMN keywords_json TEXT DEFAULT ''"
        )
```

- [ ] Smoke: `.venv/bin/python -c "..."` confirms column exists.
- [ ] Commit.

## Task 2: Update LLM prompt + parsing

**File:** `src/reddit_research/research/discover.py`

- [ ] Replace `_CANONICAL_PROMPT_SYSTEM` and `_CANONICAL_PROMPT_USER` with:

```python
_CANONICAL_PROMPT_SYSTEM = (
    "You validate a user's topic string AND expand it into a search-keyword "
    "set. Return the canonical form (with typo correction), alternative "
    "interpretations, and 5-8 scored search keywords for querying Reddit, "
    "academic search engines, HN, and app stores. Return JSON only."
)
_CANONICAL_PROMPT_USER = (
    'Topic: "{topic}"\n\n'
    "Return JSON:\n"
    "{{\n"
    '  "canonical": "<best guess>",\n'
    '  "variants": ["<alt1>", "<alt2>"],\n'
    '  "confidence": "high" | "low",\n'
    '  "search_keywords": ['
    '{{"keyword": "<term>", "relevance": "high" | "medium" | "low"}}, ...'
    "]\n"
    "}}\n\n"
    "Rules:\n"
    "- Include the canonical itself as the FIRST keyword (relevance high).\n"
    "- 5-8 keywords total. Each 1-4 words. No duplicates.\n"
    "- high: searcher would definitely use this term.\n"
    "- medium: related, plausibly useful.\n"
    "- low: tangentially related.\n"
    "- Include common product names that dominate the domain.\n"
)
```

- [ ] In `_canonicalize_topic`, after `confidence = ...`, also extract:

```python
    raw_keywords = parsed.get("search_keywords") or []
    keywords: list[dict] = []
    for kw in raw_keywords:
        if not isinstance(kw, dict):
            continue
        k = str(kw.get("keyword") or "").strip()
        rel = str(kw.get("relevance") or "low").strip().lower()
        if k and rel in ("high", "medium", "low"):
            keywords.append({"keyword": k, "relevance": rel})
    # Always ensure canonical is in the keyword list.
    if keywords and not any(k["keyword"].lower() == canonical.lower() for k in keywords):
        keywords.insert(0, {"keyword": canonical, "relevance": "high"})
```

- [ ] Update the returned dict + `_cache_canonical` to include `search_keywords: keywords`.
- [ ] Update `_load_canonical` to also pull `keywords_json` and parse, returning `search_keywords` in the dict.
- [ ] Update `_cache_canonical` to write `keywords_json = json.dumps(result.get("search_keywords") or [])`.

## Task 3: Tests

**File:** `tests/test_integration.py` (append)

```python
def test_canonicalize_returns_search_keywords(
    clean_env: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import json
    from reddit_research.research import discover as discover_mod

    monkeypatch.setenv("LLM_PROVIDER", "openrouter")
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-fake")

    def fake_llm(topic):
        return json.dumps({
            "canonical": "calorie tracking app",
            "variants": ["macro tracking"],
            "confidence": "high",
            "search_keywords": [
                {"keyword": "calorie tracking", "relevance": "high"},
                {"keyword": "MyFitnessPal", "relevance": "high"},
                {"keyword": "food log", "relevance": "medium"},
                {"keyword": "weight loss", "relevance": "low"},
            ],
        })
    monkeypatch.setattr(discover_mod, "_llm_canonical_call", fake_llm)

    r = discover_mod._canonicalize_topic("calari tracking app")
    kws = r.get("search_keywords") or []
    assert kws, "expected non-empty keyword list"
    # canonical should be present with high relevance
    assert any(k["keyword"] == "calorie tracking" and k["relevance"] == "high" for k in kws)
    # low-relevance entries preserved (filtered at consume time, not here)
    assert any(k["relevance"] == "low" for k in kws)
```

## Task 4: Consume in `collect.py`

**File:** `src/reddit_research/research/collect.py`

- [ ] After the existing `_canon = _canonicalize_topic(topic)` block, add:

```python
    import os as _os
    _max_kw = int(_os.getenv("OPENREPLY_MAX_KEYWORDS", "5") or "5")
    _min_rel = "medium" if aggressive else "high"
    _rel_rank = {"high": 3, "medium": 2, "low": 1}
    search_keywords = [
        k["keyword"]
        for k in (_canon.get("search_keywords") or [])
        if _rel_rank.get(k.get("relevance", "low"), 0) >= _rel_rank[_min_rel]
    ][:_max_kw]
    if not search_keywords:
        search_keywords = [search_topic]
```

- [ ] In the Reddit search stage, wrap `render_queries(search_topic, ...)` — instead use:

```python
        all_queries: dict[str, list[str]] = {}
        for kw in search_keywords:
            q_for_kw = render_queries(kw, categories=query_categories)
            for category, qs in q_for_kw.items():
                all_queries.setdefault(category, []).extend(qs)
        queries = all_queries
```

Then continue with the existing loop. Add a dedup pass so we don't hit the same query twice if two keywords render the same phrase:

```python
        queries = {cat: list(dict.fromkeys(qs)) for cat, qs in queries.items()}
```

- [ ] For extra sources, update `_run_source(src)` to pass keywords. Change `fn(search_topic)` to `fn(search_keywords)` IF the adapter supports it; else fall back for backward compat:

```python
            try:
                fn = SOURCES[src]
                try:
                    out = fn(search_keywords)  # new contract
                except TypeError:
                    # Fallback: adapter still takes a single string.
                    out = fn(search_keywords[0] if search_keywords else search_topic)
                return (src, out, None, time.monotonic() - t0)
```

- [ ] Commit.

## Task 5: Source adapter contract — accept list

**File:** `src/reddit_research/sources/collect_adapter.py`

- [ ] For each `run_*` function, change the first-arg signature from `topic: str` to `topic_or_keywords: str | list[str]`. Normalize to a list internally and loop:

```python
def run_hn(topic_or_keywords: str | list[str], limit_per_tag: int = 30) -> int:
    keywords = [topic_or_keywords] if isinstance(topic_or_keywords, str) else list(topic_or_keywords)
    storage_topic = keywords[0] if keywords else ""
    fid = log_fetch_start("source:hn", {"keywords": keywords, "limit": limit_per_tag})
    total = 0
    try:
        for kw in keywords:
            for tags in ("story", "ask_hn,show_hn"):
                rows = fetch_hn(query=kw, tags=tags, sort="relevance", limit=limit_per_tag)
                total += _persist(storage_topic, rows, source_tag=f"hn:{tags}:{kw}")
            time.sleep(1.0)  # politeness between keywords for same source
        log_fetch_end(fid, rows=total)
    except Exception as e:
        log_fetch_end(fid, rows=0, error=str(e))
    return total
```

Apply the same pattern to `run_appstore`, `run_playstore`, `run_scholar`, `run_arxiv`, `run_openalex`, `run_pubmed`, `run_github`, `run_github_issues`, `run_stackoverflow`, `run_devto`, `run_gnews`, `run_lemmy`, `run_mastodon`. For `run_trends`, keep the single-string path (trends takes one base keyword).

- [ ] `import time` at the top if not already imported.
- [ ] Commit.

## Task 6: Verification

- [ ] `.venv/bin/pytest -v tests/test_integration.py` — all previously-passing tests still pass + new keyword test passes.
- [ ] Manual: CLI `reddit-cli research collect --topic "calari tracking app" --sources hn --aggressive` — the fetches table should show multiple `source:hn:*:kw1`, `source:hn:*:kw2` rows, one per expanded keyword.
- [ ] Update the changelog entry.
