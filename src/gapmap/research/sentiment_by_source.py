"""Per-source sentiment aggregation.

For each source (reddit/hn/arxiv/pubmed/etc.) that has posts for a topic,
run ONE LLM call summarizing the sentiment + dominant emotions of that
source community on the topic. Persist as graph_nodes kind='source_sentiment'
so the UI can render fast on re-open without re-running the LLM.
"""
from __future__ import annotations

import json
import re
from typing import Any

from ..analyze.providers.base import get_provider
from ..core.db import get_db
from ..graph.build import _upsert_edge, _upsert_node
from ..graph.schema import ensure_graph_schema, make_node_id
from .prompts import load_extractor


# Posts-per-source we sample for the LLM. Above this, the corpus is too
# big for the prompt; below this, the source is too sparse for a reliable
# sentiment read.
SAMPLE_PER_SOURCE = 30
MIN_POSTS_PER_SOURCE = 3


SOURCE_LABELS = {
    "reddit": "Reddit",
    "hn": "Hacker News",
    "devto": "Dev.to",
    "stackoverflow": "Stack Overflow",
    "lemmy": "Lemmy",
    "mastodon": "Mastodon",
    "github": "GitHub trending",
    "github_issues": "GitHub issues",
    "arxiv": "arXiv preprints",
    "pubmed": "PubMed",
    "openalex": "OpenAlex",
    "scholar": "Semantic Scholar",
    "gnews": "Google News",
    "trends": "Google Trends",
    "appstore": "App Store reviews",
    "playstore": "Play Store reviews",
    "rss_marketing": "Marketing / growth (15 feeds)",
    "rss_persuasion": "Persuasion / behavioral",
    "rss_swipe": "Ad swipe files",
    # miroclaw-derived sources
    "duckduckgo": "DuckDuckGo web",
    "gdelt": "GDELT news",
    "tavily": "Tavily web",
    "worldbank": "World Bank (macro)",
    "fred": "FRED (US macro)",
    "bis": "BIS (policy rates)",
    "yfinance": "Yahoo Finance",
    "openmeteo": "Open-Meteo (weather)",
    "acled": "ACLED (events)",
}


def _slug(s: str) -> str:
    out = re.sub(r"[^a-z0-9]+", "-", (s or "").lower()).strip("-")
    return out[:60] or "unnamed"


def _format_corpus(rows: list[dict[str, Any]]) -> str:
    parts = []
    for r in rows:
        body = (r.get("selftext") or "")[:400]
        title = r.get("title") or ""
        parts.append(f"[{r.get('id', '?')}] {title}\n{body}")
    return "\n\n".join(parts)


def _parse_json(raw: str) -> dict[str, Any]:
    cleaned = raw.strip()
    for fence in ("```json", "```"):
        if cleaned.startswith(fence):
            cleaned = cleaned[len(fence):].lstrip()
    if cleaned.endswith("```"):
        cleaned = cleaned[:-3].rstrip()
    try:
        parsed = json.loads(cleaned)
        if isinstance(parsed, dict):
            return parsed
        return {"_parse_error": True, "_raw": raw}
    except json.JSONDecodeError:
        return {"_parse_error": True, "_raw": raw}


def _sources_for_topic(topic: str) -> list[dict[str, Any]]:
    """Return [{source: 'reddit', n_posts: 247}, ...] sorted by n_posts desc.

    Uses the NORMALIZED source family — so all youtube_* rows (comments,
    descriptions, transcripts) roll up under a single ``youtube`` bucket
    instead of fragmenting into 3 separate sentiment cards. See
    ``sources/source_families.py`` for the normalization rules.
    """
    from ..sources.source_families import NORMALIZED_SOURCE_SQL
    db = get_db()
    rows = list(db.query(
        f"""
        SELECT {NORMALIZED_SOURCE_SQL} AS source, count(*) AS n
        FROM topic_posts tp
        JOIN posts p ON p.id = tp.post_id
        WHERE tp.topic = :topic
        GROUP BY {NORMALIZED_SOURCE_SQL}
        ORDER BY n DESC
        """,
        {"topic": topic},
    ))
    return [{"source": r["source"], "n_posts": int(r["n"])} for r in rows]


def _sample_posts_for_source(topic: str, source_type: str, limit: int) -> list[dict[str, Any]]:
    """Sample posts for ONE source family.

    Filters by the NORMALIZED family — so asking for ``source='youtube'``
    pulls every YouTube row regardless of subtype (comment / description
    / transcript). The sentiment prompt sees the full picture rather
    than a single fragment.
    """
    from ..sources.source_families import NORMALIZED_SOURCE_SQL
    db = get_db()
    return list(db.query(
        f"""
        SELECT p.id, p.title, substr(coalesce(p.selftext, ''), 1, 600) AS selftext,
               p.score, p.num_comments
        FROM topic_posts tp
        JOIN posts p ON p.id = tp.post_id
        WHERE tp.topic = :topic AND {NORMALIZED_SOURCE_SQL} = :src
        ORDER BY coalesce(p.score, 0) + coalesce(p.num_comments, 0) DESC, p.created_utc DESC
        LIMIT :lim
        """,
        {"topic": topic, "src": source_type, "lim": limit},
    ))


def extract_sentiment_for_source(
    topic: str,
    source_type: str,
    provider: str | None = None,
) -> dict[str, Any]:
    """Run the sentiment extractor for ONE source.

    Returns either {label, confidence, dominant_emotions, summary,
    common_themes, representative_quote, n_posts, source} or
    {_skipped: True, reason: ...} or {_parse_error: True, _raw: ...}.
    """
    posts = _sample_posts_for_source(topic, source_type, SAMPLE_PER_SOURCE)
    if len(posts) < MIN_POSTS_PER_SOURCE:
        return {
            "_skipped": True,
            "reason": f"only {len(posts)} posts (need ≥{MIN_POSTS_PER_SOURCE})",
            "source": source_type,
            "n_posts": len(posts),
        }

    label = SOURCE_LABELS.get(source_type, source_type)
    ext = load_extractor("sentiment_source")
    user = ext["user_template"].format(
        topic=topic,
        source_label=label,
        n_posts=len(posts),
        corpus=_format_corpus(posts),
    )
    raw = get_provider(provider).complete(
        prompt=user, system=ext["system"], max_tokens=600, temperature=0.2
    )
    parsed = _parse_json(raw)
    if parsed.get("_parse_error"):
        return {**parsed, "source": source_type, "n_posts": len(posts)}
    parsed["source"] = source_type
    parsed["source_label"] = label
    parsed["n_posts"] = len(posts)
    return parsed


def persist_sentiment_for_source(
    topic: str,
    source_type: str,
    sentiment: dict[str, Any],
) -> str | None:
    """Upsert one source_sentiment node + topic --has_source_sentiment--> sentiment edge.
    Returns the node id, or None if skipped.
    """
    if not sentiment or sentiment.get("_skipped") or sentiment.get("_parse_error"):
        return None

    ensure_graph_schema()
    db = get_db()
    topic_node = make_node_id(topic, "topic", topic)
    if db["graph_nodes"].count_where("id = ?", [topic_node]) == 0:
        _upsert_node(db, topic, "topic", topic, topic)

    label = sentiment.get("source_label") or SOURCE_LABELS.get(source_type, source_type)
    node_id = _upsert_node(
        db, topic, "source_sentiment", _slug(source_type), label,
        metadata={
            "source": source_type,
            "label": sentiment.get("label"),
            "confidence": sentiment.get("confidence"),
            "dominant_emotions": sentiment.get("dominant_emotions") or [],
            "summary": sentiment.get("summary"),
            "common_themes": sentiment.get("common_themes") or [],
            "representative_quote": sentiment.get("representative_quote"),
            "n_posts": sentiment.get("n_posts"),
        },
    )
    _upsert_edge(db, topic, topic_node, node_id, "has_source_sentiment")
    return node_id


def sentiment_for_topic(
    topic: str,
    provider: str | None = None,
) -> dict[str, Any]:
    """Run the per-source sentiment loop for a topic.

    For every source that has ≥MIN_POSTS_PER_SOURCE posts:
      1. Sample top-engagement posts
      2. LLM call → sentiment dict
      3. Persist as source_sentiment node

    Returns: {topic, sources: [...], persisted: N, skipped: M}
    """
    sources = _sources_for_topic(topic)
    out: dict[str, Any] = {
        "topic": topic,
        "sources": [],
        "persisted": 0,
        "skipped": 0,
    }
    if not sources:
        out["error"] = f"No corpus for topic={topic!r}. Run collect first."
        return out

    for src in sources:
        sent = extract_sentiment_for_source(topic, src["source"], provider=provider)
        node_id = persist_sentiment_for_source(topic, src["source"], sent)
        out["sources"].append({
            **{k: v for k, v in sent.items() if k != "_raw"},
            "persisted": bool(node_id),
        })
        if node_id:
            out["persisted"] += 1
        else:
            out["skipped"] += 1

    try:
        from ..core.db import save_mcp_analysis
        save_mcp_analysis(
            topic=topic, source="app", kind="sentiment",
            tool="run_sentiment_by_source",
            content=json.dumps(out, ensure_ascii=False, default=str),
            content_type="json",
            provider=provider or "",
            model="",
            params={"source_count": len(sources)},
        )
    except Exception:
        pass

    return out
