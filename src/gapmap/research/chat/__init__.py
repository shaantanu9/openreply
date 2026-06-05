"""Chat with a collected topic — streaming LLM answers grounded in the corpus.

Supported providers:
  - anthropic  (native SDK, streaming)
  - openai, openrouter, groq, deepseek, mistral, google, ollama (OpenAI-compatible)

The provider + model come from the env (LLM_PROVIDER / LLM_MODEL) or can be
passed explicitly. If nothing is configured, we auto-detect the first provider
whose key is present.

The chat function is a generator that yields text chunks — callers can either
print them live (CLI streaming) or concatenate into one string.
"""
from __future__ import annotations

import json
import os
import threading
from collections.abc import Iterator

from ...core.config import load_config
from ...core.db import get_db

# --- provider registry -----------------------------------------------------

_OPENAI_COMPATIBLE = {
    "openai":     ("OPENAI_API_KEY",     None,                                 "gpt-4o-mini"),
    "openrouter": ("OPENROUTER_API_KEY", "https://openrouter.ai/api/v1",        "anthropic/claude-sonnet-4-6"),
    "groq":       ("GROQ_API_KEY",       "https://api.groq.com/openai/v1",      "llama-3.3-70b-versatile"),
    "deepseek":   ("DEEPSEEK_API_KEY",   "https://api.deepseek.com/v1",         "deepseek-chat"),
    "mistral":    ("MISTRAL_API_KEY",    "https://api.mistral.ai/v1",           "mistral-large-latest"),
    "google":     ("GOOGLE_API_KEY",     "https://generativelanguage.googleapis.com/v1beta/openai/", "gemini-2.0-flash"),
    # NVIDIA NIM — OpenAI-compatible. Browse models at https://build.nvidia.com.
    "nvidia":     ("NVIDIA_API_KEY",     "https://integrate.api.nvidia.com/v1", "meta/llama-3.3-70b-instruct"),
    # Last-resort default — only used if LLM_MODEL isn't set AND the live /api/tags
    # autopick also returns nothing. `gemma3:4b` is a broadly-available chat model.
    "ollama":     (None,                 None,                                  "gemma3:4b"),
}


def _ollama_base_url() -> str:
    return (os.getenv("OLLAMA_BASE_URL") or "http://localhost:11434").rstrip("/") + "/v1"


def _auto_detect_provider() -> str | None:
    """Pick the first provider whose key is present in env.

    Fallback: if no paid key is set, try to ping a local Ollama.
    """
    if os.getenv("ANTHROPIC_API_KEY"):
        return "anthropic"
    for name, (env_key, _, _) in _OPENAI_COMPATIBLE.items():
        if env_key and os.getenv(env_key):
            return name
    # Ollama: user-set URL wins, else probe default localhost.
    if os.getenv("OLLAMA_BASE_URL"):
        return "ollama"
    try:
        import urllib.request
        with urllib.request.urlopen("http://localhost:11434/api/version", timeout=1):
            return "ollama"
    except Exception:
        return None


def _resolve_provider(provider: str | None) -> tuple[str, str]:
    prov = (provider or os.getenv("LLM_PROVIDER") or _auto_detect_provider() or "").lower()
    if not prov:
        raise RuntimeError(
            "No LLM provider configured. Set a key in Settings → API keys, "
            "or export one of ANTHROPIC_API_KEY / OPENAI_API_KEY / "
            "OPENROUTER_API_KEY / GROQ_API_KEY / etc."
        )
    model = os.getenv("LLM_MODEL") or _default_model(prov)
    return prov, model


def _default_model(provider: str) -> str:
    if provider == "anthropic":
        return "claude-sonnet-4-6"
    if provider in _OPENAI_COMPATIBLE:
        return _OPENAI_COMPATIBLE[provider][2]
    return "gpt-4o-mini"


# --- topic context --------------------------------------------------------

# Palace timeout wrapper extracted to chat/timeout.py (unit-tested in isolation).
from .timeout import (  # noqa: E402
    PALACE_CHAT_TIMEOUT,
    _PALACE_CHAT_TIMEOUT,
    _call_with_timeout,
    call_with_timeout,
)


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
        try:
            st = palace.stats() or {}
            by_topic = (st.get("by_topic") or {}) if isinstance(st, dict) else {}
            if topic and isinstance(by_topic, dict) and int(by_topic.get(topic, 0) or 0) == 0:
                return {"_skip": True}
        except Exception:
            pass
        return palace.search_posts(query=question, topic=topic, k=k, rerank=True)

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
                if (p.get("source") or "") not in ("arxiv", "openalex", "semantic_scholar", "scholar"):
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

MODE_PROMPTS: dict[str, str] = {
    "ask": (
        "Answer the user's question using the topic context below. "
        "Treat cross-source corroborated signals as primary: prioritize findings backed by 2+ sources "
        "and relation edges. Cite specific painpoints/workarounds/evidence posts and mention source overlap. "
        "Mark any single-source claim as tentative. Prefer bullet points. If evidence is insufficient, say so."
    ),
    "plan": (
        "Produce a concrete 1-week validation plan for building a product in this space. "
        "Include: (1) which 5 users to talk to and where to find them, "
        "(2) the top 3 painpoint hypotheses to validate, "
        "(3) a minimum-viable prototype to test, "
        "(4) a go/no-go metric. Use numbered bullets."
    ),
    "features": (
        "List the top 5 features to build, sorted by (pain × gap × evidence strength). "
        "For each feature provide: name, who it's for, the painpoint it solves, "
        "and whether any existing competitor does it. Prioritize painpoints validated across multiple sources; "
        "label single-source signals as tentative. Use markdown with short paragraphs."
    ),
    "sources": (
        "Summarize what each data source uniquely contributes. "
        "One bullet per source describing the dominant signal from that corpus, "
        "then a 2-sentence synthesis across all sources based on cross-source relation overlap. Keep it tight."
    ),
    "bullets": (
        "Give me only bullet-point learnings. Three sections: "
        "(a) what users want, (b) what they DIY today, (c) the biggest gap. "
        "Nothing else — no intros or conclusions."
    ),
}


def system_prompt() -> str:
    return (
        "You are a senior product researcher. You analyze multi-source corpora "
        "(Reddit, HN, app stores, arXiv, etc.) to identify market gaps. "
        "Ground every claim in the context you're given — do not hallucinate. "
        "Quote evidence verbatim where possible. "
        "When you reference an evidence post from the Evidence section, cite it "
        "inline with its bracketed number, e.g. \"users complain about X [3]\". "
        "Do NOT invent citation numbers — only use ones present in the Evidence "
        "section. Do NOT add a Sources / References list yourself; one will be "
        "appended automatically after your response."
    )


def build_user_prompt(topic: str, question: str, mode: str,
                      citations_out: list | None = None) -> str:
    # Pass the user's question into _topic_context so Palace can retrieve
    # semantically-relevant evidence posts instead of blind top-engagement.
    # `citations_out` is filled in-place with the numbered evidence list so
    # `chat_stream` can append the Sources block after the LLM finishes.
    context = _topic_context(topic, question=question, citations_out=citations_out)
    instruction = MODE_PROMPTS.get(mode, MODE_PROMPTS["ask"])
    return (
        f"{instruction}\n\n"
        f"--- TOPIC CONTEXT ---\n"
        f"{context}\n"
        f"--- USER QUESTION ---\n"
        f"{question.strip() or '(follow the instruction above for the default response)'}"
    )


# --- streaming callers ----------------------------------------------------

# Streaming-aware HTTP timeout shared by every provider client below.
# Without it the OpenAI/Anthropic SDKs default to a 600 s ceiling, so a
# provider that accepts the connection then stalls mid-stream (the classic
# "NVIDIA socket stall" / "ollama runner crashed mid-load") leaves the chat
# process hung for up to 10 minutes with zero tokens and no exit — the UI
# spins until its 5-minute watchdog gives up. A short connect timeout fails
# fast when the endpoint is unreachable; a generous read timeout tolerates a
# slow free-tier first token (queue waits of 30-90 s are common) while still
# bounding a genuine mid-stream stall to ~2 minutes, after which the SDK
# raises and `cmd_research_chat` surfaces a clean `{event: "error"}`.
def _stream_timeout():
    import httpx
    return httpx.Timeout(connect=15.0, read=120.0, write=30.0, pool=15.0)


def _stream_anthropic(model: str, system: str, user: str, max_tokens: int) -> Iterator[str]:
    from anthropic import Anthropic

    cfg = load_config()
    if not cfg.anthropic_api_key:
        raise RuntimeError("ANTHROPIC_API_KEY not set")
    client = Anthropic(api_key=cfg.anthropic_api_key, timeout=_stream_timeout())
    with client.messages.stream(
        model=model,
        max_tokens=max_tokens,
        system=system,
        messages=[{"role": "user", "content": user}],
    ) as stream:
        for text in stream.text_stream:
            yield text


def _stream_openai_compatible(
    provider: str, model: str, system: str, user: str, max_tokens: int
) -> Iterator[str]:
    from openai import OpenAI

    env_key, base_url, _ = _OPENAI_COMPATIBLE[provider]
    if provider == "ollama":
        api_key = "ollama"
        base = _ollama_base_url()
    else:
        api_key = os.getenv(env_key) if env_key else None
        if not api_key:
            raise RuntimeError(f"{env_key} not set")
        base = base_url

    client = OpenAI(api_key=api_key, base_url=base)
    extra_headers = {}
    if provider == "openrouter":
        from ...core.identity import GITHUB_URL
        extra_headers["HTTP-Referer"] = GITHUB_URL
        extra_headers["X-Title"] = "Gap Map"

    stream = client.chat.completions.create(
        model=model,
        max_tokens=max_tokens,
        stream=True,
        messages=[
            {"role": "system", "content": system},
            {"role": "user",   "content": user},
        ],
        extra_headers=extra_headers or None,
    )
    for chunk in stream:
        if not chunk.choices:
            continue
        delta = chunk.choices[0].delta
        text = getattr(delta, "content", None)
        if text:
            yield text


def chat_stream(
    topic: str,
    question: str,
    *,
    mode: str = "ask",
    provider: str | None = None,
    max_tokens: int = 1800,
) -> Iterator[str]:
    """Stream tokens from the selected provider, then append a citations block.

    Two layers of citation:
      1. The context block numbers each evidence post `[N]` and the system
         prompt instructs the LLM to reference them inline. LLM cooperation
         varies — bigger models tend to cite, smaller ones often forget.
      2. After the stream completes, this function yields a deterministic
         `## Sources` block listing every evidence post with title + URL.
         That guarantees the user always sees source attribution, even
         when the LLM didn't bother with inline `[N]` markers.
    """
    prov, model = _resolve_provider(provider)
    citations: list[dict] = []
    user = build_user_prompt(topic, question, mode, citations_out=citations)
    sys = system_prompt()

    if prov == "anthropic":
        yield from _stream_anthropic(model, sys, user, max_tokens)
    elif prov in _OPENAI_COMPATIBLE:
        yield from _stream_openai_compatible(prov, model, sys, user, max_tokens)
    else:
        raise RuntimeError(f"Unknown provider: {prov}")

    # Append the deterministic Sources block once the LLM stream finishes.
    # Yielding as a single chunk so the frontend's incremental markdown
    # renderer paints it atomically — easier than streaming a partial
    # heading character-by-character.
    sources_block = _format_sources_block(citations)
    if sources_block:
        yield sources_block


# ─── Agent mode (tool-use loop) ────────────────────────────────────────────
#
# Currently Anthropic-only. OpenAI-compatible function-calling can be added
# later; the tool registry + executor are provider-agnostic.

# Tool definitions in Anthropic's input_schema format.
AGENT_TOOLS = [
    {
        "name": "list_topics",
        "description": "List every topic in the database with post/painpoint/source counts. Use to discover what's already been collected.",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "run_query",
        "description": (
            "Run a read-only SQL query against the SQLite corpus. "
            "Only SELECT / WITH / PRAGMA / EXPLAIN are allowed — any mutation is rejected. "
            "Available tables: posts, topic_posts, graph_nodes, graph_edges, fetches. "
            "Results are truncated to 100 rows."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "sql": {"type": "string", "description": "A SELECT statement."},
            },
            "required": ["sql"],
        },
    },
    {
        "name": "get_findings",
        "description": (
            "Return the top findings of a given kind for a topic, ordered by evidence strength. "
            "Use this instead of ad-hoc SQL when you want LLM-extracted signals."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "topic": {"type": "string"},
                "kind": {
                    "type": "string",
                    "enum": ["painpoint", "workaround", "product", "feature_wish"],
                },
                "limit": {"type": "integer", "default": 10, "minimum": 1, "maximum": 30},
            },
            "required": ["topic", "kind"],
        },
    },
    {
        "name": "source_breakdown",
        "description": "Per-source post counts for a topic (reddit / HN / appstore / arXiv / etc).",
        "input_schema": {
            "type": "object",
            "properties": {"topic": {"type": "string"}},
            "required": ["topic"],
        },
    },
    {
        "name": "sample_posts",
        "description": (
            "Return the top N most-engaged raw posts for a topic — title + first 300 chars + score + source. "
            "Use sparingly; findings are usually more useful."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "topic": {"type": "string"},
                "limit": {"type": "integer", "default": 5, "minimum": 1, "maximum": 20},
            },
            "required": ["topic"],
        },
    },
    {
        "name": "semantic_search",
        "description": (
            "Hybrid semantic + keyword search over the posts corpus using a local "
            "embedding model. Use when the user asks about a concept, complaint, or "
            "pattern rather than an exact keyword — for example 'posts where users "
            "lose their data' or 'complaints about slow performance'. Returns posts "
            "ranked by meaning, even when they don't use the exact phrasing of the "
            "query. Works across all topics unless `topic` is specified. Skips "
            "silently (returns `{skipped: true}`) when the user hasn't enabled the "
            "semantic-search model from Settings — in that case fall back to "
            "`run_query` with a LIKE clause or `get_findings`."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Concept or question in natural language. Not a SQL clause.",
                },
                "topic": {
                    "type": "string",
                    "description": "Optional — restrict results to this research topic.",
                },
                "source": {
                    "type": "string",
                    "description": (
                        "Optional — restrict to a single source_type "
                        "(reddit / hn / appstore / playstore / arxiv / openalex / "
                        "pubmed / gnews / devto / stackoverflow / github / trends)."
                    ),
                },
                "limit": {"type": "integer", "default": 10, "minimum": 1, "maximum": 30},
            },
            "required": ["query"],
        },
    },
    {
        "name": "fetch_more_papers",
        "description": (
            "EXPENSIVE / NETWORK + LLM. Go fetch NEW academic papers for a topic when the "
            "existing corpus is thin or the user explicitly asks to 'find more papers / "
            "research / studies'. Searches arXiv, PubMed, OpenAlex, Semantic Scholar, "
            "Crossref and Google Scholar in parallel, stores the results, pulls full text "
            "for the top-cited few, and runs LLM analysis on them. The new papers are then "
            "queryable by the OTHER tools (`get_findings`, `run_query`, `semantic_search`) "
            "and citable in your answer. Use AT MOST ONCE per answer — it can take 30-120s. "
            "Do NOT call it just to re-summarize papers already in the corpus."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "topic": {"type": "string", "description": "The research topic to tag the new papers under."},
                "query": {
                    "type": "string",
                    "description": "Optional search string. Narrow it to the user's angle (e.g. 'OCR for complex document layouts'). Defaults to the topic.",
                },
                "limit_per_source": {"type": "integer", "default": 4, "minimum": 1, "maximum": 6},
                "max_fulltext": {
                    "type": "integer", "default": 2, "minimum": 0, "maximum": 4,
                    "description": "How many top-cited papers to pull full text + run LLM analysis on. Higher = slower.",
                },
                "year_from": {"type": "integer", "description": "Optional lower-bound publication year."},
            },
            "required": ["topic"],
        },
    },
    {
        "name": "fetch_more_evidence",
        "description": (
            "EXPENSIVE / NETWORK. Go fetch NEW community evidence (HN, Stack Overflow, "
            "Dev.to, Google News, and optionally Reddit) for a topic when the corpus lacks "
            "real-world signal or the user asks to 'pull more discussion / complaints / "
            "posts'. New posts are stored, tagged to the topic, and become queryable by the "
            "OTHER tools. Raw fetch only — it does NOT run painpoint extraction, so query "
            "the new posts with `semantic_search` or `run_query` afterward. Reddit is the "
            "slowest source (sub discovery); leave it off unless the user wants it. Use AT "
            "MOST ONCE per answer — it can take 30-120s."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "topic": {"type": "string", "description": "The research topic to tag the new posts under."},
                "sources": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": (
                        "Which non-Reddit sources to sweep. Defaults to "
                        "['hn','stackoverflow','devto','gnews']. Valid: hn, stackoverflow, "
                        "devto, gnews, appstore, playstore, trends, scholar."
                    ),
                },
                "include_reddit": {
                    "type": "boolean", "default": False,
                    "description": "Also run the (slower) Reddit collection. Default false.",
                },
                "limit": {
                    "type": "integer", "default": 25, "minimum": 5, "maximum": 60,
                    "description": "Posts to fetch per query / source.",
                },
            },
            "required": ["topic"],
        },
    },
]


def _run_bounded(fn, timeout: float, *args, **kwargs) -> dict:
    """Run a blocking fetch on a worker thread with a wall-clock ceiling.

    Returns the fn's dict result, or a structured `{ok: false, timed_out}`
    message on overrun so the agent loop never wedges on a slow network /
    provider call. The underlying thread is left to finish on its own (the
    fetched rows still land in SQLite), but the agent stops waiting."""
    import concurrent.futures as _fut
    with _fut.ThreadPoolExecutor(max_workers=1) as ex:
        fut = ex.submit(fn, *args, **kwargs)
        try:
            return fut.result(timeout=timeout)
        except _fut.TimeoutError:
            return {
                "ok": False,
                "timed_out": True,
                "error": (
                    f"Fetch exceeded {timeout:.0f}s and is still running in the "
                    "background. Any rows it has already pulled are saved — answer "
                    "from the existing corpus now, and the user can re-ask in a "
                    "moment for the rest."
                ),
            }
        except Exception as e:
            return {"ok": False, "error": str(e)[:300]}


def _q_escape(s: str) -> str:
    return s.replace("'", "''")


def _exec_tool(name: str, args: dict) -> dict:
    """Dispatch a tool call. Returns a JSON-serializable dict."""
    db = get_db()
    try:
        if name == "list_topics":
            rows = list(db.query(
                "SELECT tp.topic, count(DISTINCT tp.post_id) AS posts, "
                "       count(DISTINCT coalesce(p.source_type,'reddit')) AS sources, "
                "       (SELECT count(*) FROM graph_nodes n WHERE n.topic=tp.topic AND n.kind='painpoint') AS painpoints "
                "FROM topic_posts tp LEFT JOIN posts p ON p.id=tp.post_id "
                "GROUP BY tp.topic ORDER BY posts DESC LIMIT 50"
            ))
            return {"topics": rows}

        if name == "run_query":
            sql = (args.get("sql") or "").strip()
            lower = sql.lower().lstrip()
            if not (lower.startswith("select") or lower.startswith("with")
                    or lower.startswith("pragma") or lower.startswith("explain")):
                return {"error": "only SELECT/WITH/PRAGMA/EXPLAIN allowed"}
            for bad in ("insert ", "update ", "delete ", "drop ", "alter ",
                        "create ", "replace ", "truncate "):
                if bad in lower:
                    return {"error": f"blocked keyword: {bad.strip()}"}
            rows = list(db.query(sql))
            truncated = len(rows) > 100
            return {"rows": rows[:100], "truncated": truncated, "row_count": len(rows)}

        if name == "get_findings":
            topic = args.get("topic") or ""
            kind = args.get("kind") or "painpoint"
            limit = min(int(args.get("limit") or 10), 30)
            rows = list(db.query(
                "SELECT n.label, n.metadata_json, "
                "       (SELECT count(*) FROM graph_edges e "
                "        WHERE e.topic=n.topic AND (e.src=n.id OR e.dst=n.id)) AS evidence_count "
                "FROM graph_nodes n "
                "WHERE n.topic=? AND n.kind=? "
                "ORDER BY evidence_count DESC LIMIT ?",
                (topic, kind, limit),
            ))
            return {"findings": rows, "topic": topic, "kind": kind}

        if name == "source_breakdown":
            topic = args.get("topic") or ""
            rows = list(db.query(
                "SELECT coalesce(p.source_type,'reddit') AS source, count(*) AS posts "
                "FROM topic_posts tp JOIN posts p ON p.id=tp.post_id "
                "WHERE tp.topic=? "
                "GROUP BY coalesce(p.source_type,'reddit') ORDER BY posts DESC",
                (topic,),
            ))
            return {"sources": rows, "topic": topic}

        if name == "sample_posts":
            topic = args.get("topic") or ""
            limit = min(int(args.get("limit") or 5), 20)
            rows = list(db.query(
                "SELECT p.title, p.sub AS subreddit, p.score, p.num_comments, "
                "       coalesce(p.source_type,'reddit') AS source, "
                "       substr(coalesce(p.selftext,''),1,300) AS snippet "
                "FROM topic_posts tp JOIN posts p ON p.id=tp.post_id "
                "WHERE tp.topic=? "
                "ORDER BY coalesce(p.score,0)+coalesce(p.num_comments,0) DESC LIMIT ?",
                (topic, limit),
            ))
            return {"posts": rows, "topic": topic}

        if name == "semantic_search":
            # Import lazily so the chat command still loads even when the
            # retrieval extras aren't installed (the tool just returns a
            # skip-stub in that case — see palace.search_posts).
            try:
                from ...retrieval.palace import (
                    is_available, is_model_ready, search_posts,
                )
            except ImportError:
                return {"skipped": True, "reason": "retrieval extras not installed"}
            if not is_available():
                return {"skipped": True, "reason": "chromadb not installed"}
            if not is_model_ready():
                return {
                    "skipped": True,
                    "reason": "semantic-search model not downloaded yet. "
                              "The user can enable it from Settings → Semantic search. "
                              "Fall back to run_query with a LIKE clause.",
                }
            query = (args.get("query") or "").strip()
            if not query:
                return {"error": "query is required"}
            topic = args.get("topic") or None
            source = args.get("source") or None
            limit = min(int(args.get("limit") or 10), 30)
            try:
                from ...core.coordination import mark_chat_active
                mark_chat_active()
            except Exception:
                pass
            # Same cross-process hazard as _semantic_evidence: a collect's
            # enrich-worker can hold the ChromaDB palace and block this read.
            # Bound it so agent-mode chat degrades instead of hanging — the
            # model is told to fall back to run_query/get_findings on a skip.
            ok, r = _call_with_timeout(
                lambda: search_posts(query, topic=topic, source_type=source, k=limit),
                _PALACE_CHAT_TIMEOUT,
            )
            if not ok:
                return {"skipped": True, "reason": "semantic search timed out "
                        "(palace busy — a collection may be embedding). Use "
                        "run_query with a LIKE clause or get_findings instead."}
            if not r or not r.get("ok"):
                return {"error": (r or {}).get("error") or (r or {}).get("reason") or "semantic_search failed"}
            # Strip giant text payloads down for the LLM context window —
            # 300 chars per hit is enough to ground a citation.
            hits = []
            for h in r.get("results", []):
                hits.append({
                    "id": h.get("id"),
                    "score": h.get("score"),
                    "topic": (h.get("metadata") or {}).get("topic"),
                    "source": (h.get("metadata") or {}).get("source_type"),
                    "sub": (h.get("metadata") or {}).get("sub"),
                    "text": (h.get("text") or "")[:300],
                })
            return {"hits": hits, "query": query, "count": len(hits)}

        if name == "fetch_more_papers":
            topic = (args.get("topic") or "").strip()
            if not topic:
                return {"error": "topic is required"}
            from ..paper_pipeline import run_paper_research
            res = _run_bounded(
                run_paper_research,
                150.0,
                topic=topic,
                query=(args.get("query") or None),
                limit_per_source=max(1, min(int(args.get("limit_per_source") or 4), 6)),
                max_fulltext=max(0, min(int(args.get("max_fulltext") or 2), 4)),
                year_from=args.get("year_from"),
            )
            if not res.get("ok"):
                return res
            # Trim the analyses to a citation-sized payload — the full text is
            # already in SQLite and reachable via the other tools.
            slim = [
                {
                    "title": a.get("title"),
                    "url": a.get("url"),
                    "source": a.get("source_type"),
                    "citations": a.get("citation_count"),
                    "takeaway": (a.get("takeaway") or a.get("summary") or "")[:400],
                }
                for a in (res.get("analyses") or [])
            ]
            return {
                "ok": True,
                "topic": res.get("topic"),
                "query": res.get("query"),
                "new_papers": res.get("search_total", 0),
                "by_source": res.get("by_source", {}),
                "fulltext_ok": res.get("fulltext_ok", 0),
                "analyzed": res.get("analyzed", 0),
                "papers": slim,
                "note": "New papers are now in the corpus — cite them by title/URL, "
                        "or call get_findings / semantic_search for more detail.",
            }

        if name == "fetch_more_evidence":
            topic = (args.get("topic") or "").strip()
            if not topic:
                return {"error": "topic is required"}
            from ..collect import collect
            srcs = args.get("sources")
            if not isinstance(srcs, list) or not srcs:
                srcs = ["hn", "stackoverflow", "devto", "gnews"]
            include_reddit = bool(args.get("include_reddit", False))
            limit = max(5, min(int(args.get("limit") or 25), 60))

            def _do_collect():
                r = collect(
                    topic,
                    sources=srcs,
                    skip_reddit=not include_reddit,
                    skip_extraction=True,   # raw fetch; agent queries the new rows itself
                    limit_per_query=limit,
                    limit_per_sub=limit,
                )
                return {
                    "ok": True,
                    "topic": getattr(r, "topic", topic),
                    "posts_fetched": getattr(r, "posts_fetched", 0),
                    "by_source": getattr(r, "by_source", {}) or {},
                    "errors": (getattr(r, "errors", []) or [])[:5],
                }

            res = _run_bounded(_do_collect, 150.0)
            if res.get("ok"):
                res["note"] = ("New posts are now tagged to the topic — query them with "
                               "semantic_search or run_query, then cite what you find.")
            return res

        return {"error": f"unknown tool: {name}"}
    except Exception as e:
        return {"error": str(e)}


AGENT_SYSTEM = (
    "You are a senior product researcher with access to a local SQLite corpus of "
    "multi-source data (Reddit, HN, app stores, arXiv, etc.) about user-specified topics. "
    "Use the tools to gather evidence BEFORE drawing conclusions — never invent data. "
    "Cite specific painpoints, workarounds, or evidence posts in your final answer. "
    "\n\n"
    "Tool selection heuristics:\n"
    "• `get_findings` — when the user wants already-extracted painpoints / workarounds / "
    "feature wishes / products for a specific topic. Fastest, cleanest.\n"
    "• `semantic_search` — when the question is conceptual or cross-topic: "
    "'posts about users losing data', 'complaints about slow sync', 'what else looks like "
    "this painpoint?'. Hybrid embedding + BM25. Skip if it returns "
    "`{skipped: true}` and fall back to `run_query` with LIKE.\n"
    "• `source_breakdown` — when the user wants to know where the evidence comes from.\n"
    "• `sample_posts` — raw post snippets for a topic, ordered by engagement. Use sparingly "
    "(findings are usually more useful).\n"
    "• `run_query` — last resort for ad-hoc aggregates / filters that don't fit the above.\n"
    "• `fetch_more_papers` — EXPENSIVE. Go pull NEW academic papers when the corpus is thin "
    "or the user asks to 'find more papers / research / studies'. Then re-query with "
    "`get_findings` / `semantic_search` and cite the new papers. At most once per answer.\n"
    "• `fetch_more_evidence` — EXPENSIVE. Go pull NEW community posts (HN, Stack Overflow, "
    "Dev.to, news, optionally Reddit) when there's little real-world signal. It does no "
    "extraction, so query the new posts with `semantic_search` / `run_query` afterward. "
    "At most once per answer.\n"
    "\n"
    "Workflow: first check what's ALREADY collected with the read tools. Only reach for a "
    "`fetch_more_*` tool when the existing corpus genuinely can't answer the question — and "
    "when you do fetch, follow up by querying the freshly-added rows before you conclude. "
    "Never call a fetch tool just to restate papers you already have.\n"
    "\n"
    "When you're done gathering, stop calling tools and write a concise answer in markdown."
)


def agent_stream_anthropic(topic: str, question: str, max_tool_turns: int = 6,
                           max_tokens: int = 2500) -> Iterator[dict]:
    """Tool-use loop over Anthropic. Yields structured events:
        {"event": "text",        "text": "..."}          — streamed text tokens
        {"event": "tool_call",   "id": "...", "name": "...", "input": {...}}
        {"event": "tool_result", "id": "...", "output": {...}}
        {"event": "error",       "error": "..."}
    """
    from anthropic import Anthropic

    cfg = load_config()
    if not cfg.anthropic_api_key:
        yield {"event": "error", "error": "Agent mode currently requires ANTHROPIC_API_KEY. Set one in Settings → Manage keys."}
        return
    model = os.getenv("LLM_MODEL") or "claude-sonnet-4-6"
    client = Anthropic(api_key=cfg.anthropic_api_key)

    # Seed: topic + question go in the first user message.
    user_msg = (
        f"Research topic: **{topic}**\n\n"
        f"Question: {question or '(Do the default research — summarize the biggest gaps with evidence.)'}"
    )
    messages: list[dict] = [{"role": "user", "content": user_msg}]

    for _turn in range(max_tool_turns):
        # Non-streaming for simplicity in tool loop; we still yield text chunks.
        # (Anthropic's streaming + tools combo works but adds complexity; keep simple.)
        resp = client.messages.create(
            model=model,
            max_tokens=max_tokens,
            system=AGENT_SYSTEM,
            tools=AGENT_TOOLS,
            messages=messages,
        )

        # Emit any text blocks; collect tool_use blocks for the next turn.
        tool_uses = []
        for block in resp.content:
            btype = getattr(block, "type", None)
            if btype == "text":
                yield {"event": "text", "text": block.text}
            elif btype == "tool_use":
                tool_uses.append(block)
                yield {
                    "event": "tool_call",
                    "id": block.id,
                    "name": block.name,
                    "input": block.input,
                }

        if resp.stop_reason != "tool_use" or not tool_uses:
            # Done — either natural stop or no tools invoked
            break

        # Execute each tool, feed results back
        messages.append({"role": "assistant", "content": resp.content})
        tool_results = []
        for tu in tool_uses:
            out = _exec_tool(tu.name, tu.input or {})
            yield {"event": "tool_result", "id": tu.id, "output": out}
            tool_results.append({
                "type": "tool_result",
                "tool_use_id": tu.id,
                "content": json.dumps(out, default=str)[:8000],
            })
        messages.append({"role": "user", "content": tool_results})


# ─── Test + introspection helpers ─────────────────────────────────────────

def test_provider(provider: str | None = None, model: str | None = None) -> dict:
    """Tiny round-trip ping. Returns {ok, provider, model, latency_ms, reply, error?}."""
    import time

    # Did the CALLER explicitly pick this provider (e.g. BYOK Test button on
    # the Anthropic row)? If so, we must NOT fall back to LLM_MODEL — that
    # env var carries the user's CURRENTLY-SELECTED default model, which
    # is usually for a DIFFERENT provider. Sending an NVIDIA model name to
    # Anthropic produces a misleading 401/404. Use per-provider defaults
    # instead so each Test row pings its own provider correctly.
    explicit_provider = bool(provider)
    prov = (provider or os.getenv("LLM_PROVIDER") or _auto_detect_provider() or "").lower()
    if not prov:
        return {"ok": False, "error": "no provider configured"}

    if model:
        mdl = model                                # caller supplied → trust
    elif explicit_provider:
        mdl = _default_model(prov)                 # per-provider default (no env fallback)
    else:
        mdl = os.getenv("LLM_MODEL") or _default_model(prov)

    t0 = time.time()
    try:
        if prov == "anthropic":
            from anthropic import Anthropic
            cfg = load_config()
            if not cfg.anthropic_api_key:
                return {"ok": False, "provider": prov, "error": "ANTHROPIC_API_KEY not set"}
            client = Anthropic(api_key=cfg.anthropic_api_key, timeout=_stream_timeout())
            resp = client.messages.create(
                model=mdl, max_tokens=20,
                messages=[{"role": "user", "content": "Reply with just: OK"}],
            )
            reply = " ".join(b.text for b in resp.content if getattr(b, "type", "") == "text").strip()
        elif prov in _OPENAI_COMPATIBLE:
            from openai import OpenAI
            env_key, base_url, _ = _OPENAI_COMPATIBLE[prov]
            if prov == "ollama":
                api_key = "ollama"; base = _ollama_base_url()
            else:
                api_key = os.getenv(env_key) if env_key else None
                if not api_key:
                    return {"ok": False, "provider": prov, "error": f"{env_key} not set"}
                base = base_url
            client = OpenAI(api_key=api_key, base_url=base, timeout=_stream_timeout())
            resp = client.chat.completions.create(
                model=mdl, max_tokens=20,
                messages=[{"role": "user", "content": "Reply with just: OK"}],
            )
            reply = (resp.choices[0].message.content or "").strip()
        else:
            return {"ok": False, "error": f"unknown provider: {prov}"}
    except Exception as e:
        return {
            "ok": False, "provider": prov, "model": mdl,
            "latency_ms": int((time.time() - t0) * 1000),
            "error": str(e),
        }

    return {
        "ok": True, "provider": prov, "model": mdl,
        "latency_ms": int((time.time() - t0) * 1000),
        "reply": reply[:80],
    }


def list_ollama_models() -> dict:
    """Query the Ollama /api/tags endpoint for installed models."""
    import urllib.request

    base = (os.getenv("OLLAMA_BASE_URL") or "http://localhost:11434").rstrip("/")
    try:
        with urllib.request.urlopen(f"{base}/api/tags", timeout=3) as r:
            body = r.read().decode("utf-8")
        data = json.loads(body)
        models = []
        for m in data.get("models", []) or []:
            name = m.get("name") or m.get("model")
            if not name:
                continue
            # Skip embedding-only models (heuristic on family names)
            fam = (m.get("details", {}) or {}).get("family") or ""
            if fam in ("bert", "nomic-bert") or "embed" in name.lower():
                continue
            models.append({
                "name": name,
                "size_mb": round((m.get("size") or 0) / (1024 * 1024)),
                "family": fam,
                "param_size": (m.get("details", {}) or {}).get("parameter_size", ""),
            })
        return {"ok": True, "url": base, "models": models}
    except Exception as e:
        return {"ok": False, "url": base, "error": str(e)}


def chat_meta(topic: str, provider: str | None = None) -> dict:
    """Return a small dict describing what will be used + the current corpus size."""
    prov, model = _resolve_provider(provider)
    db = get_db()
    posts = list(db.query("SELECT count(*) AS n FROM topic_posts WHERE topic=?", (topic,)))

    # Surface Palace (semantic retrieval) status so the chat UI can show
    # whether questions will be answered from semantic search or fall back
    # to engagement-ranked SQL.
    palace_status: dict = {"available": False, "model_ready": False, "indexed_for_topic": 0}
    try:
        from ...retrieval import palace
        palace_status["available"] = palace.is_available()
        palace_status["model_ready"] = palace_status["available"] and palace.is_model_ready()
        if palace_status["model_ready"]:
            stats = palace.stats() or {}
            # stats may include a per-topic breakdown; surface this topic's count.
            by_topic = (stats.get("by_topic") or {}) if isinstance(stats, dict) else {}
            palace_status["indexed_for_topic"] = int(by_topic.get(topic, 0) or 0)
            palace_status["indexed_total"] = int(stats.get("count", 0) or 0)
    except Exception:
        pass

    return {
        "topic": topic,
        "provider": prov,
        "model": model,
        "posts": posts[0]["n"] if posts else 0,
        "palace": palace_status,
    }
