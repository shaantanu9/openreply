"""Corpus grounding for chat — turns a topic + question into the evidence
context block the LLM answers from.

This is the heart of "answers grounded on THIS topic's data":
  * _semantic_evidence  — MemPalace (ChromaDB + MiniLM ONNX + BM25) retrieval,
                          bounded by the palace timeout, with SQL fallback.
  * _topic_context      — assembles findings + evidence posts + paper excerpts
                          into a numbered, citation-tagged markdown context,
                          optionally scoped to a source family.
  * _format_sources_block — deterministic ## Sources block appended after the
                          stream so the user always sees attribution.

Extracted from the old monolithic chat.py so the grounding can be tested + a
`chat doctor` can probe exactly where a given topic falls down (no palace index,
empty corpus, name mismatch, etc.). Heavy deps (palace, corpus_format,
paper_fulltext, coordination) stay lazily imported inside the functions.
"""
from __future__ import annotations

import os

from ...core.db import get_db
from .source_intent import _detect_source_intent
from .timeout import _PALACE_CHAT_TIMEOUT, _call_with_timeout


def resolve_indexed_topic(by_topic: dict, topic: str) -> str | None:
    """Resolve the exact key palace indexed this topic under.

    Returns the matching key — exact preferred, else a case/whitespace-insensitive
    variant that actually has docs — or None if the topic truly isn't indexed.
    This fixes "chat works for one topic but not another": the UI may pass
    "Machine Learning" while palace stored "machine learning", and an exact-match
    gate would wrongly skip semantic retrieval and silently degrade to SQL.
    """
    if not topic or not isinstance(by_topic, dict):
        return topic or None
    if int(by_topic.get(topic, 0) or 0) > 0:
        return topic
    key = topic.strip().lower()
    for t, n in by_topic.items():
        if int(n or 0) > 0 and str(t).strip().lower() == key:
            return t
    return None


def _semantic_evidence(topic: str, question: str, k: int) -> tuple[list[dict], str]:
    """Use Palace (ChromaDB + BM25) to retrieve posts most semantically
    relevant to the user's question.

    Returns (posts, retrieval_label). Posts are dicts with the same shape
    as the engagement-ranked SQL fallback so the renderer downstream
    doesn't have to branch. retrieval_label is shown in the context so
    the LLM (and the user reading the chat) knows whether retrieval was
    semantic or fell back to engagement-ranking.
    """
    if not (question or "").strip():
        return [], ""
    # Hard kill-switch for users on broken chromadb installs (segfault on
    # `coll.query()` / `coll.count()` — tracked in skill `tauri-python-
    # sidecar-app` Phase X). Set GAPMAP_DISABLE_PALACE=1 to bypass palace
    # entirely and fall back to engagement-ranked SQL retrieval.
    if os.environ.get("GAPMAP_DISABLE_PALACE", "").strip().lower() in ("1","true","yes","on"):
        return [], ""
    try:
        from ...retrieval import palace
    except Exception:
        return [], ""
    if not palace.is_available() or not palace.is_model_ready():
        return [], ""
    # Empty-collection guard. ChromaDB's Rust backend SEGFAULTS on
    # `coll.query(where={topic:X})` when zero docs match — kills the
    # entire chat process before any tokens stream. `palace.stats()`
    # uses a direct SQLite read (no segfault), so we use its by-topic
    # count to skip the query entirely when this topic isn't indexed.
    # When `by_topic` isn't available (older palace builds), we still
    # try the query — segfaults on those installs are caller-visible
    # via the Tauri streaming watchdogs.
    # The store I/O below (stats + count + query) is what blocks when the
    # enrich-worker holds the ChromaDB palace during a collect. Run it under a
    # wall-clock ceiling: on timeout we fall back to engagement-ranked SQL
    # retrieval instead of hanging the whole chat. (The per-topic index gate
    # also avoids the zero-match Rust-backend segfault — see palace.search_posts.)
    # Heartbeat so the enrich-worker yields its ChromaDB writes while we read
    # (see core.coordination + enrich_worker's chat-backoff). Best-effort.
    try:
        from ...core.coordination import mark_chat_active
        mark_chat_active()
    except Exception:
        pass

    def _lookup():
        eff_topic = topic
        try:
            st = palace.stats() or {}
            by_topic = (st.get("by_topic") or {}) if isinstance(st, dict) else {}
            if topic and isinstance(by_topic, dict):
                # Tolerate case/whitespace topic-name drift so we query palace
                # under the name it was actually indexed under, instead of
                # silently skipping semantic retrieval.
                eff_topic = resolve_indexed_topic(by_topic, topic)
                if eff_topic is None:
                    return {"_skip": True}
        except Exception:
            eff_topic = topic
        return palace.search_posts(query=question, topic=eff_topic, k=k, rerank=True)

    ok, res = _call_with_timeout(_lookup, _PALACE_CHAT_TIMEOUT)
    if not ok:
        # Palace busy (a collect is likely embedding into it) or it errored —
        # degrade to SQL retrieval rather than block the chat.
        return [], ""
    if not res or res.get("_skip") or not res.get("ok") or not res.get("results"):
        return [], ""

    db = get_db()
    posts: list[dict] = []
    for r in res["results"]:
        pid = r.get("id")
        if not pid:
            continue
        # Pull canonical row from the posts table so we get title/url/etc.
        row = next(iter(db.query(
            "SELECT id, title, sub AS subreddit, score, num_comments, "
            "       coalesce(source_type,'reddit') AS source, url, "
            "       substr(coalesce(selftext,''),1,400) AS snip "
            "FROM posts WHERE id = ? LIMIT 1",
            (pid,),
        )), None)
        if row:
            posts.append(row)
    label = f"semantic (Palace · {len(posts)} hits for your question)"
    return posts, label


# Source-family intent detection extracted to chat/source_intent.py
# (pure keyword matching, unit-tested in isolation).
from .source_intent import (  # noqa: E402
    SOURCE_FAMILIES,
    _SOURCE_FAMILIES,
    _detect_source_intent,
    detect_source_intent,
)


def _topic_context(topic: str, limit_posts: int = 8, question: str | None = None,
                   citations_out: list | None = None) -> str:
    """Build a compact markdown context block for the LLM.

    If `question` is provided AND Palace (ChromaDB + ONNX model) is ready,
    the evidence section uses semantic retrieval against the question.
    Otherwise falls back to engagement-ranked SQL across all sources.

    `citations_out` (optional): if a list is passed, it's filled with one
    dict per evidence post in the same order they appear in the context
    (1-indexed). Each dict carries the fields needed to render a citation
    line: ``{n, title, source, url, post_id, subreddit}``. Callers use this
    to append a deterministic Sources block at the end of the response —
    so even if the LLM forgets the prompted [N] inline citations, the user
    still gets a clickable list of every source the answer drew on.
    """
    db = get_db()

    post_prefix = f"{topic}::post::"

    # Painpoints / features / products / workarounds
    # Rank by cross-source corroboration first, then evidence volume.
    findings = {}
    for kind in ("painpoint", "feature_wish", "product", "workaround"):
        # `source_diversity` = # distinct source types of posts linked to a
        # finding. CRITICAL: look posts up BY PRIMARY KEY via
        # `p.id = substr(other_endpoint, len(prefix)+1)`. The previous form,
        # `JOIN posts p ON (e2.src = :prefix || p.id OR e2.dst = :prefix || p.id)`,
        # concatenated the prefix onto every post id, so no index applied and
        # SQLite did a full posts scan PER edge PER finding-node — O(nodes ×
        # edges × posts). On a big topic (124 painpoints, 198k edges, 157k
        # posts) that ORDER BY made chat's context build take ~54 s ("chat
        # hangs after the start event"). The PK-lookup rewrite is ~545x faster
        # (54 s → 0.1 s), same results. Verified 2026-06-02.
        rows = list(db.query(
            "SELECT gn.label, gn.metadata_json, "
            "       (SELECT count(*) FROM graph_edges e "
            "          WHERE e.topic=gn.topic "
            "            AND (e.src=gn.id OR e.dst=gn.id) "
            "            AND e.kind IN ('evidenced_by','wished_in','about_product','built_in','solves','supports')) AS evidence_count, "
            "       (SELECT count(DISTINCT coalesce(p.source_type,'reddit')) "
            "          FROM graph_edges e2 "
            "          JOIN posts p ON p.id = substr(CASE WHEN e2.src=gn.id THEN e2.dst ELSE e2.src END, length(?)+1) "
            "         WHERE e2.topic=gn.topic "
            "           AND (e2.src=gn.id OR e2.dst=gn.id) "
            "           AND e2.kind IN ('evidenced_by','wished_in','about_product','built_in','solves','supports')) AS source_diversity "
            "FROM graph_nodes gn "
            "WHERE gn.topic=? AND gn.kind=? "
            "ORDER BY source_diversity DESC, evidence_count DESC, gn.label ASC "
            "LIMIT 12",
            (post_prefix, topic, kind),
        ))
        findings[kind] = rows

    # Source breakdown
    sources = list(db.query(
        "SELECT coalesce(p.source_type,'reddit') AS source, count(*) AS n "
        "FROM topic_posts tp JOIN posts p ON p.id=tp.post_id "
        "WHERE tp.topic=? "
        "GROUP BY coalesce(p.source_type,'reddit') "
        "ORDER BY n DESC",
        (topic,),
    ))

    # Sample evidence posts — mix high-engagement Reddit with academic /
    # ingested sources so every source type gets a voice. Pure engagement
    # ranking drowned out arxiv papers (which have score=0 by design).
    reddit_sample = list(db.query(
        "SELECT p.id, p.title, p.sub AS subreddit, p.score, p.num_comments, "
        "       coalesce(p.source_type,'reddit') AS source, p.url, "
        "       substr(coalesce(p.selftext,''),1,400) AS snip "
        "FROM topic_posts tp JOIN posts p ON p.id=tp.post_id "
        "WHERE tp.topic=? AND coalesce(p.source_type,'reddit')='reddit' "
        "ORDER BY coalesce(p.score,0)+coalesce(p.num_comments,0) DESC "
        "LIMIT ?",
        (topic, max(limit_posts // 2, 1)),
    ))
    other_sample = list(db.query(
        "SELECT p.id, p.title, p.sub AS subreddit, p.score, p.num_comments, "
        "       coalesce(p.source_type,'reddit') AS source, p.url, "
        "       substr(coalesce(p.selftext,''),1,400) AS snip "
        "FROM topic_posts tp JOIN posts p ON p.id=tp.post_id "
        "WHERE tp.topic=? AND coalesce(p.source_type,'reddit')!='reddit' "
        "ORDER BY coalesce(p.score,0) DESC, p.created_utc DESC "
        "LIMIT ?",
        (topic, max(limit_posts - len(reddit_sample), 1)),
    ))
    # Try Palace semantic retrieval first (only if a question was passed).
    # On miss/no-model, fall back to the engagement-ranked sample below.
    semantic_posts, retrieval_label = _semantic_evidence(topic, question or "", k=limit_posts)
    if semantic_posts:
        posts = semantic_posts
        evidence_heading = f"## Evidence — {retrieval_label}"
    else:
        posts = reddit_sample + other_sample
        evidence_heading = "## Evidence — top engagement (no semantic retrieval available)"

    # ── Source-scoped answers ─────────────────────────────────────────────
    # If the question targets a source family ("what do papers say", "what
    # does the news say", "what do app reviews complain about"…), scope the
    # evidence to just those source types so the answer reflects that source
    # — topping up from SQL when semantic retrieval under-represented it.
    scope_note = None
    intent = _detect_source_intent(question or "")
    if intent:
        scope_label, scope_sources = intent
        srcset = set(scope_sources)
        scoped = [p for p in posts if (p.get("source") or "reddit") in srcset]
        if len(scoped) < limit_posts:
            have = {p.get("id") for p in scoped}
            ph = ",".join("?" * len(scope_sources))
            extra = list(db.query(
                "SELECT p.id, p.title, p.sub AS subreddit, p.score, p.num_comments, "
                "       coalesce(p.source_type,'reddit') AS source, p.url, "
                "       substr(coalesce(p.selftext,''),1,400) AS snip "
                "FROM topic_posts tp JOIN posts p ON p.id=tp.post_id "
                f"WHERE tp.topic=? AND coalesce(p.source_type,'reddit') IN ({ph}) "
                "ORDER BY coalesce(p.score,0) DESC, p.created_utc DESC "
                "LIMIT ?",
                (topic, *scope_sources, limit_posts * 3),
            ))
            for e in extra:
                if e["id"] not in have:
                    scoped.append(e)
                    have.add(e["id"])
                if len(scoped) >= limit_posts:
                    break
        if scoped:
            posts = scoped[:limit_posts]
            evidence_heading = f"## Evidence — scoped to {scope_label} ({', '.join(scope_sources)})"
            scope_note = (
                f"The user is asking specifically about **{scope_label}**. "
                f"Answer using ONLY the {scope_label} evidence below "
                f"(source types: {', '.join(scope_sources)}). Do not lean on other sources, "
                f"and make clear the answer reflects {scope_label} specifically."
            )
        else:
            posts = []
            evidence_heading = f"## Evidence — none from {scope_label}"
            scope_note = (
                f"The user asked about **{scope_label}**, but this topic has NO data collected "
                f"from those sources ({', '.join(scope_sources)}). Say so plainly and suggest "
                f"collecting from that source — do NOT fabricate {scope_label} findings."
            )

    parts = [f"# Topic: {topic}", ""]
    if scope_note:
        parts.append("## ⚠ Source scope")
        parts.append(scope_note)
        parts.append("")

    if sources:
        parts.append("## Source breakdown")
        for s in sources:
            parts.append(f"- **{s['source']}** — {s['n']} posts")
        parts.append("")

    # Cross-source relation summary (semantic-to-semantic links from all
    # sources together). Gives chat a fused base before conclusions.
    relation_rows = list(db.query(
        "SELECT kind, count(*) AS n "
        "FROM graph_edges "
        "WHERE topic=? "
        "  AND kind IN ('related_to','potentially_solves','could_address') "
        "GROUP BY kind "
        "ORDER BY n DESC",
        (topic,),
    ))
    if relation_rows:
        rel_total = sum(int(r["n"] or 0) for r in relation_rows)
        parts.append("## Cross-source semantic relations")
        parts.append(f"- Total relation edges: **{rel_total}**")
        for r in relation_rows:
            parts.append(f"- {r['kind']}: {r['n']}")
        parts.append("")

    for kind, label in (
        ("painpoint", "Painpoints"),
        ("workaround", "DIY workarounds (strong gap signals)"),
        ("product", "Products complained about"),
        ("feature_wish", "Feature wishes"),
    ):
        rows = findings.get(kind) or []
        items = [r["label"] for r in rows]
        if items:
            parts.append(f"## {label}")
            for r in rows[:10]:
                diversity = int(r.get("source_diversity") or 0)
                evidence = int(r.get("evidence_count") or 0)
                confidence = "multi-source" if diversity >= 2 else "single-source"
                parts.append(f"- {r['label']}  ({evidence} evidence, {diversity} sources, {confidence})")
            parts.append("")

    if posts:
        from ..corpus_format import _format_row
        parts.append(evidence_heading)
        parts.append("Cite these sources inline as [1], [2], etc. when you reference them.")
        parts.append("")

        # If any evidence row is an academic paper with full-text already
        # cached, splice in a longer excerpt so the LLM sees actual paper
        # content (methodology, results, limitations) instead of just the
        # 2000-char abstract. We DON'T trigger downloads here — that would
        # block chat for 5-15s per paper. The user runs
        # `research paper-fulltext --topic <T>` ahead of time (or the
        # desktop app does it lazily) to populate the cache.
        try:
            from ..paper_fulltext import get_full_text
            paper_text_cache: dict[str, str] = {}
            for p in posts:
                if (p.get("source") or "") not in (
                    "arxiv", "openalex", "semantic_scholar", "scholar", "pubmed", "europepmc"
                ):
                    continue
                # cache_only=True: NEVER download here. A topic with N uncached
                # papers would otherwise block chat for N×5-15s synchronously
                # (the 57s "chat stalls after start" bug). Full text is
                # populated ahead of time by the research pipeline.
                ft = get_full_text(p["id"], cache_only=True)
                if ft.get("ok") and ft.get("text"):
                    # Front-load the first 2.5k chars (intro/abstract) and
                    # last 1k (conclusions/limitations) — the bits an
                    # analyst usually quotes. Keeps prompt tokens bounded
                    # at ~1000/paper × 8 papers = 8k tokens, well within
                    # any modern context window.
                    full = ft["text"]
                    head = full[:2500].strip()
                    tail = full[-1000:].strip() if len(full) > 3500 else ""
                    excerpt = head + ("\n\n[…paper continues…]\n\n" + tail if tail else "")
                    paper_text_cache[p["id"]] = excerpt
        except Exception:
            paper_text_cache = {}

        for idx, p in enumerate(posts, start=1):
            # Re-use the source-aware formatter so arxiv / pubmed / ingest
            # rows cite correctly instead of being mislabelled as r/reddit.
            # `selftext` column is named `snip` here — alias it.
            row = dict(p)
            row["selftext"] = p.get("snip", "")
            row["sub"] = p.get("subreddit") or ""
            header_and_body = _format_row(row, excerpt_chars=300)
            lines = header_and_body.split("\n", 1)
            # Prefix each evidence post with [N] so the LLM can reference it.
            if len(lines) == 2:
                parts.append(f"- [{idx}] {lines[0]}\n  > {lines[1].strip()}")
            else:
                parts.append(f"- [{idx}] {lines[0]}")
            # When we have full-text for THIS paper, append the long excerpt
            # AFTER the standard formatted row so abstract+title still front
            # the citation. The LLM gets the abstract for context-skimming
            # AND the deeper content for fact pulls.
            ftxt = paper_text_cache.get(p.get("id"))
            if ftxt:
                parts.append(f"  [paper full-text excerpt for [{idx}]]:")
                parts.append(f"  > {ftxt[:5000]}")
            # Stash citation metadata for post-stream rendering. We fall back
            # to a synthesized Reddit URL if `url` is empty (legacy posts
            # collected before we persisted permalinks).
            if citations_out is not None:
                pid = p.get("id") or ""
                source = p.get("source") or "reddit"
                url = (p.get("url") or "").strip()
                sub = (p.get("subreddit") or "").strip()
                if not url and source == "reddit" and pid and sub:
                    url = f"https://www.reddit.com/r/{sub}/comments/{pid}/"
                citations_out.append({
                    "n": idx,
                    "title": (p.get("title") or "").strip()[:200],
                    "source": source,
                    "url": url,
                    "post_id": pid,
                    "subreddit": sub,
                })
        parts.append("")

    return "\n".join(parts)


def _format_sources_block(citations: list) -> str:
    """Render a deterministic 'Sources' markdown block from `citations_out`.

    Always emitted at the end of a chat response so the user can verify
    every claim — even if the LLM forgot to cite inline. Format matches
    common academic markdown so renderers turn URLs into clickable links.
    """
    if not citations:
        return ""
    out = ["", "---", "## Sources", ""]
    for c in citations:
        title = c.get("title") or "(untitled)"
        url = c.get("url") or ""
        src = c.get("source") or "reddit"
        sub = c.get("subreddit") or ""
        # `r/foo` for reddit, otherwise the source label (arxiv, hn, …).
        prefix = f"r/{sub}" if (src == "reddit" and sub) else src
        if url:
            out.append(f"[{c['n']}] **{prefix}** — [{title}]({url})")
        else:
            out.append(f"[{c['n']}] **{prefix}** — {title}")
    out.append("")
    return "\n".join(out)


# --- prompt modes ---------------------------------------------------------
