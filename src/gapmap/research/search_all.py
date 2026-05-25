"""Unified cross-table search — the "find everything about X" primitive.

Feeds two callers:

1. The GUI Search tab (single input → grouped results across every table
   the app cares about: posts, graph nodes, analyses, papers, hypotheses,
   feedback).
2. Older pipelines (insights, concepts, solutions) that want a corpus
   slice scoped by a user's query instead of the whole topic. Saving
   search results to `mcp_analyses` means the same query can seed
   downstream LLM calls without re-running the search.

Two modes:

- **normal** — SQL LIKE across indexed text columns. Fast (<100 ms on
  typical corpora), deterministic, no network.
- **aggressive** — normal + palace semantic search (if installed) + a
  small LLM-assisted query-expansion pass that rewrites the query into
  3-4 paraphrases and unions their LIKE hits. Slower (1-5 s) but
  surfaces semantic matches SQL can't.

Every run persists a summary row to `mcp_analyses` with `kind='search'`
so:
  a) the AI Analyses tab shows search history per topic
  b) future pipelines can `SELECT content FROM mcp_analyses WHERE
     kind='search' AND topic=:t` to seed prompts with "recently
     searched-for things"
  c) aggressive-mode query expansions are reusable without a second
     LLM call
"""
from __future__ import annotations

import json
from typing import Any

from ..core.db import get_db


_LIKE_LIMIT = 30  # per-bucket cap — UI renders top-N, full count shown separately

# Stop-words that hurt LIKE recall when broken out as standalone tokens.
# Kept tiny on purpose — we want "ats" / "resume" / "ios" to survive but
# drop the connectives that pollute every row.
_STOPWORDS = frozenset({
    "a", "an", "and", "or", "the", "of", "to", "for", "in", "on", "at",
    "by", "with", "from", "as", "is", "are", "was", "were", "be", "been",
    "this", "that", "these", "those", "it", "its", "i", "we", "you",
    "my", "our", "your", "but", "not", "no", "so", "if", "then", "than",
    "do", "does", "did", "have", "has", "had", "will", "would", "can",
    "could", "should", "may", "might", "about", "into", "out", "over",
    "after", "before", "while", "when", "what", "which", "who", "how",
})


def _significant_tokens(q: str) -> list[str]:
    """Split a query into distinctive tokens for fallback LIKE searches.
    Drops stop-words and 1-char fragments. Preserves order and dedup."""
    if not q:
        return []
    import re as _re
    parts = _re.findall(r"[A-Za-z0-9_+#-]{2,}", q.lower())
    seen: set[str] = set()
    out: list[str] = []
    for p in parts:
        if p in _STOPWORDS or p in seen:
            continue
        seen.add(p)
        out.append(p)
    return out


def _like(q: str) -> str:
    return f"%{q.replace('%', '').replace('_', '')}%"


def _search_posts(db, topic: str | None, q: str, limit: int = _LIKE_LIMIT) -> list[dict]:
    sql = """
        SELECT p.id, p.title, substr(p.selftext, 1, 400) AS excerpt,
               coalesce(p.source_type, 'reddit') AS source,
               p.author, p.score, p.url, p.permalink, p.created_utc
        FROM posts p
    """
    params: dict[str, Any] = {"q": _like(q)}
    if topic:
        sql += " JOIN topic_posts tp ON tp.post_id = p.id WHERE tp.topic = :topic"
        params["topic"] = topic
        sql += " AND (p.title LIKE :q OR p.selftext LIKE :q)"
    else:
        sql += " WHERE (p.title LIKE :q OR p.selftext LIKE :q)"
    sql += " ORDER BY p.score DESC NULLS LAST LIMIT :lim"
    params["lim"] = limit
    return list(db.query(sql, params))


def _search_graph_nodes(db, topic: str | None, q: str, limit: int = _LIKE_LIMIT) -> list[dict]:
    sql = """
        SELECT id, topic, kind, label, metadata_json, created_at
        FROM graph_nodes
        WHERE (label LIKE :q OR metadata_json LIKE :q)
    """
    params: dict[str, Any] = {"q": _like(q), "lim": limit}
    if topic:
        sql += " AND topic = :topic"
        params["topic"] = topic
    sql += " ORDER BY created_at DESC LIMIT :lim"
    return list(db.query(sql, params))


def _search_analyses(db, topic: str | None, q: str, limit: int = _LIKE_LIMIT) -> list[dict]:
    # Guarded against legacy DBs where mcp_analyses might not exist yet.
    try:
        sql = """
            SELECT id, topic, kind, source, tool, provider, model,
                   substr(content, 1, 600) AS excerpt, created_at
            FROM mcp_analyses
            WHERE content LIKE :q
        """
        params: dict[str, Any] = {"q": _like(q), "lim": limit}
        if topic:
            sql += " AND topic = :topic"
            params["topic"] = topic
        sql += " ORDER BY created_at DESC LIMIT :lim"
        return list(db.query(sql, params))
    except Exception:
        return []


def _search_paper_analyses(db, topic: str | None, q: str, limit: int = _LIKE_LIMIT) -> list[dict]:
    try:
        sql = """
            SELECT post_id, topic, summary, takeaway, relevance, ts
            FROM paper_analyses
            WHERE (summary LIKE :q OR takeaway LIKE :q)
        """
        params: dict[str, Any] = {"q": _like(q), "lim": limit}
        if topic:
            sql += " AND topic = :topic"
            params["topic"] = topic
        sql += " ORDER BY ts DESC LIMIT :lim"
        return list(db.query(sql, params))
    except Exception:
        return []


def _search_hypotheses(db, topic: str | None, q: str, limit: int = _LIKE_LIMIT) -> list[dict]:
    try:
        sql = """
            SELECT id, topic, status, card_json, created_at
            FROM hypothesis_tests
            WHERE card_json LIKE :q
        """
        params: dict[str, Any] = {"q": _like(q), "lim": limit}
        if topic:
            sql += " AND topic = :topic"
            params["topic"] = topic
        sql += " ORDER BY created_at DESC LIMIT :lim"
        return list(db.query(sql, params))
    except Exception:
        return []


def _search_feedback(db, topic: str | None, q: str, limit: int = _LIKE_LIMIT) -> list[dict]:
    try:
        sql = """
            SELECT id, topic, finding_title, finding_kind, verdict, note, created_at
            FROM finding_feedback
            WHERE (finding_title LIKE :q OR note LIKE :q)
        """
        params: dict[str, Any] = {"q": _like(q), "lim": limit}
        if topic:
            sql += " AND topic = :topic"
            params["topic"] = topic
        sql += " ORDER BY created_at DESC LIMIT :lim"
        return list(db.query(sql, params))
    except Exception:
        return []


def _palace_hits(topic: str | None, q: str, k: int = 15) -> list[dict]:
    """Best-effort semantic search via the ChromaDB palace. Returns empty
    on any import / availability failure so the SQL path still works.

    Hard 8s timeout: a corrupt HNSW index or a cold ONNX warmup can take
    minutes; we never block the aggressive search_all path on that — the
    palace's own self-heal happens on the next call."""
    try:
        from ..retrieval import palace  # type: ignore
        if not palace.is_available():
            return []
        import concurrent.futures as _fut
        with _fut.ThreadPoolExecutor(max_workers=1) as _ex:
            fut = _ex.submit(palace.search_posts, q, topic=topic, k=k)
            try:
                resp = fut.result(timeout=8.0)
            except _fut.TimeoutError:
                return []
        rows = (resp or {}).get("results") if isinstance(resp, dict) else (resp or [])
        return [
            {
                "id": r.get("id"),
                "score": r.get("score"),
                "text": (r.get("text") or "")[:400],
                "metadata": r.get("metadata") or {},
            }
            for r in (rows or [])
        ]
    except Exception:
        return []


def _expand_query_with_llm(query: str, provider: str | None = None) -> list[str]:
    """LLM-assisted query expansion. Returns 3-4 paraphrased variants of
    the original query. Used in aggressive mode — doubled recall with a
    single ~300 ms call. Skipped silently when no provider is configured."""
    try:
        from ..analyze.providers.base import get_provider, resolve_provider
        resolve_provider(provider)  # raises if no provider is configured
        prov = get_provider(provider)
    except Exception:
        return []
    system = (
        "You expand short research queries into alternative phrasings for "
        "SQL LIKE search. Output ONLY a JSON array of 3-4 paraphrases. "
        "Paraphrases must cover synonyms, jargon, and user-language variants "
        "(e.g. 'crash' → ['freezes', 'quits unexpectedly', 'force-close']). "
        "No explanations, no preamble, pure JSON."
    )
    user = f"Query: {query!r}\n\nJSON array of paraphrases:"
    try:
        raw = prov.complete(prompt=user, system=system, max_tokens=200, temperature=0.3)
    except Exception:
        return []
    cleaned = raw.strip()
    for fence in ("```json", "```"):
        if cleaned.startswith(fence):
            cleaned = cleaned[len(fence):].lstrip()
    if cleaned.endswith("```"):
        cleaned = cleaned[:-3].rstrip()
    try:
        parsed = json.loads(cleaned)
    except Exception:
        return []
    if not isinstance(parsed, list):
        return []
    return [str(s).strip() for s in parsed if str(s).strip()][:4]


def search_all(
    query: str,
    topic: str | None = None,
    aggressive: bool = False,
    provider: str | None = None,
    persist: bool = True,
) -> dict[str, Any]:
    """Run a cross-table search and return grouped results.

    Returns:
        {
          ok: bool,
          query: str,
          topic: str | None,
          mode: "normal" | "aggressive",
          expansions: [str, ...],         # aggressive only
          buckets: {
            posts:            [row, ...],
            graph_nodes:      [row, ...],
            analyses:         [row, ...],
            paper_analyses:   [row, ...],
            hypotheses:       [row, ...],
            feedback:         [row, ...],
            semantic:         [row, ...], # aggressive only
          },
          counts: {bucket_name: int, total: int},
          persisted: bool,
        }
    """
    db = get_db()
    queries = [query]
    expansions: list[str] = []
    if aggressive:
        # LLM call must not hang the MCP transport. _expand_query_with_llm
        # itself swallows exceptions, but a slow provider can still keep us
        # waiting for tens of seconds. Run on a thread with a hard timeout
        # so aggressive mode degrades to "normal + semantic" instead of
        # killing the connection.
        import concurrent.futures as _fut
        try:
            with _fut.ThreadPoolExecutor(max_workers=1) as _ex:
                fut = _ex.submit(_expand_query_with_llm, query, provider)
                expansions = fut.result(timeout=12.0) or []
        except Exception:
            expansions = []
        queries.extend(expansions)

    # Token-fallback: if the original `query` is multi-word and likely to
    # miss as a single LIKE phrase ("collect freezes after upgrade" rarely
    # appears verbatim), break it into 2-3 distinctive tokens and union
    # those LIKE hits too. Cheap, deterministic, no network. Only kicks
    # in when the literal phrase has whitespace and is longer than two
    # words — preserves precise short-query behaviour.
    tokens = _significant_tokens(query)
    if len(tokens) >= 2:
        # Cap at 4 extra tokens so the fan-out stays bounded even on long
        # queries.
        queries.extend(tokens[:4])

    # De-dup buckets across primary + expansion queries using id-ish keys.
    def _union(rows_list, key_fn):
        seen: set = set()
        merged: list = []
        for rows in rows_list:
            for r in rows:
                k = key_fn(r)
                if k in seen:
                    continue
                seen.add(k)
                merged.append(r)
        return merged

    posts_all            = [_search_posts(db, topic, q) for q in queries]
    graph_all            = [_search_graph_nodes(db, topic, q) for q in queries]
    analyses_all         = [_search_analyses(db, topic, q) for q in queries]
    paper_analyses_all   = [_search_paper_analyses(db, topic, q) for q in queries]
    hypotheses_all       = [_search_hypotheses(db, topic, q) for q in queries]
    feedback_all         = [_search_feedback(db, topic, q) for q in queries]

    buckets = {
        "posts":           _union(posts_all,           lambda r: r.get("id")),
        "graph_nodes":     _union(graph_all,           lambda r: r.get("id")),
        "analyses":        _union(analyses_all,        lambda r: r.get("id")),
        "paper_analyses":  _union(paper_analyses_all,  lambda r: (r.get("post_id"), r.get("topic"))),
        "hypotheses":      _union(hypotheses_all,      lambda r: r.get("id")),
        "feedback":        _union(feedback_all,        lambda r: r.get("id")),
    }
    if aggressive:
        buckets["semantic"] = _palace_hits(topic, query, k=15)

    counts = {k: len(v) for k, v in buckets.items()}
    counts["total"] = sum(counts.values())

    result: dict[str, Any] = {
        "ok": True,
        "query": query,
        "topic": topic,
        "mode": "aggressive" if aggressive else "normal",
        "expansions": expansions,
        "buckets": buckets,
        "counts": counts,
        "persisted": False,
    }

    # Persist a compact summary (no full-row payload — keeps mcp_analyses
    # table light). Older pipelines can read the summary to rebuild context
    # without re-running the search.
    if persist:
        try:
            from ..core.db import save_mcp_analysis
            summary = {
                "query": query,
                "topic": topic,
                "mode": result["mode"],
                "expansions": expansions,
                "counts": counts,
                "top_post_ids":        [r.get("id") for r in buckets["posts"][:10]],
                "top_finding_ids":     [r.get("id") for r in buckets["graph_nodes"][:10]],
                "top_analysis_ids":    [r.get("id") for r in buckets["analyses"][:10]],
            }
            save_mcp_analysis(
                topic=topic or "",
                source="app",
                kind="search",
                tool=("search_all_aggressive" if aggressive else "search_all"),
                content=json.dumps(summary, ensure_ascii=False, default=str),
                content_type="json",
                provider=provider or "",
                model="",
                params={"query": query, "aggressive": aggressive},
            )
            result["persisted"] = True
        except Exception:
            pass

    return result
