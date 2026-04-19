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
from collections.abc import Iterator

from ..core.config import load_config
from ..core.db import get_db

# --- provider registry -----------------------------------------------------

_OPENAI_COMPATIBLE = {
    "openai":     ("OPENAI_API_KEY",     None,                                 "gpt-4o-mini"),
    "openrouter": ("OPENROUTER_API_KEY", "https://openrouter.ai/api/v1",        "anthropic/claude-sonnet-4-6"),
    "groq":       ("GROQ_API_KEY",       "https://api.groq.com/openai/v1",      "llama-3.3-70b-versatile"),
    "deepseek":   ("DEEPSEEK_API_KEY",   "https://api.deepseek.com/v1",         "deepseek-chat"),
    "mistral":    ("MISTRAL_API_KEY",    "https://api.mistral.ai/v1",           "mistral-large-latest"),
    "google":     ("GOOGLE_API_KEY",     "https://generativelanguage.googleapis.com/v1beta/openai/", "gemini-2.0-flash"),
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

def _topic_context(topic: str, limit_posts: int = 8) -> str:
    """Build a compact markdown context block for the LLM."""
    db = get_db()

    # Painpoints / features / products / workarounds
    findings = {}
    for kind in ("painpoint", "feature_wish", "product", "workaround"):
        rows = list(db.query(
            "SELECT label, metadata_json FROM graph_nodes "
            "WHERE topic=? AND kind=? "
            "ORDER BY (SELECT count(*) FROM graph_edges e "
            "          WHERE e.topic=graph_nodes.topic "
            "            AND (e.src=graph_nodes.id OR e.dst=graph_nodes.id)) DESC "
            "LIMIT 12",
            (topic, kind),
        ))
        findings[kind] = [r["label"] for r in rows]

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
    posts = reddit_sample + other_sample

    parts = [f"# Topic: {topic}", ""]

    if sources:
        parts.append("## Source breakdown")
        for s in sources:
            parts.append(f"- **{s['source']}** — {s['n']} posts")
        parts.append("")

    for kind, label in (
        ("painpoint", "Painpoints"),
        ("workaround", "DIY workarounds (strong gap signals)"),
        ("product", "Products complained about"),
        ("feature_wish", "Feature wishes"),
    ):
        items = findings.get(kind) or []
        if items:
            parts.append(f"## {label}")
            for i in items[:10]:
                parts.append(f"- {i}")
            parts.append("")

    if posts:
        from .corpus_format import _format_row
        parts.append("## Evidence (mixed sources)")
        for p in posts:
            # Re-use the source-aware formatter so arxiv / pubmed / ingest
            # rows cite correctly instead of being mislabelled as r/reddit.
            # `selftext` column is named `snip` here — alias it.
            row = dict(p)
            row["selftext"] = p.get("snip", "")
            row["sub"] = p.get("subreddit") or ""
            header_and_body = _format_row(row, excerpt_chars=300)
            # Make it a markdown bullet.
            lines = header_and_body.split("\n", 1)
            if len(lines) == 2:
                parts.append(f"- {lines[0]}\n  > {lines[1].strip()}")
            else:
                parts.append(f"- {lines[0]}")
        parts.append("")

    return "\n".join(parts)


# --- prompt modes ---------------------------------------------------------

MODE_PROMPTS: dict[str, str] = {
    "ask": (
        "Answer the user's question using the topic context below. "
        "Cite specific painpoints, workarounds, or evidence posts where relevant. "
        "Prefer bullet points. If you don't have enough evidence, say so honestly."
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
        "and whether any existing competitor does it. Use markdown with short paragraphs."
    ),
    "sources": (
        "Summarize what each data source uniquely contributes. "
        "One bullet per source describing the dominant signal from that corpus, "
        "then a 2-sentence synthesis across all sources. Keep it tight."
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
        "Quote evidence verbatim where possible."
    )


def build_user_prompt(topic: str, question: str, mode: str) -> str:
    context = _topic_context(topic)
    instruction = MODE_PROMPTS.get(mode, MODE_PROMPTS["ask"])
    return (
        f"{instruction}\n\n"
        f"--- TOPIC CONTEXT ---\n"
        f"{context}\n"
        f"--- USER QUESTION ---\n"
        f"{question.strip() or '(follow the instruction above for the default response)'}"
    )


# --- streaming callers ----------------------------------------------------

def _stream_anthropic(model: str, system: str, user: str, max_tokens: int) -> Iterator[str]:
    from anthropic import Anthropic

    cfg = load_config()
    if not cfg.anthropic_api_key:
        raise RuntimeError("ANTHROPIC_API_KEY not set")
    client = Anthropic(api_key=cfg.anthropic_api_key)
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
        extra_headers["HTTP-Referer"] = "https://github.com/shaantanu98/reddit-myind"
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
    """Stream tokens from the selected provider."""
    prov, model = _resolve_provider(provider)
    user = build_user_prompt(topic, question, mode)
    sys = system_prompt()

    if prov == "anthropic":
        yield from _stream_anthropic(model, sys, user, max_tokens)
    elif prov in _OPENAI_COMPATIBLE:
        yield from _stream_openai_compatible(prov, model, sys, user, max_tokens)
    else:
        raise RuntimeError(f"Unknown provider: {prov}")


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
]


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

        return {"error": f"unknown tool: {name}"}
    except Exception as e:
        return {"error": str(e)}


AGENT_SYSTEM = (
    "You are a senior product researcher with access to a local SQLite corpus of "
    "multi-source data (Reddit, HN, app stores, arXiv, etc.) about user-specified topics. "
    "Use the tools to gather evidence BEFORE drawing conclusions — never invent data. "
    "Cite specific painpoints, workarounds, or evidence posts in your final answer. "
    "Prefer the `get_findings` / `source_breakdown` tools over ad-hoc SQL when they fit. "
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

    prov = (provider or os.getenv("LLM_PROVIDER") or _auto_detect_provider() or "").lower()
    if not prov:
        return {"ok": False, "error": "no provider configured"}
    mdl = model or os.getenv("LLM_MODEL") or _default_model(prov)

    t0 = time.time()
    try:
        if prov == "anthropic":
            from anthropic import Anthropic
            cfg = load_config()
            if not cfg.anthropic_api_key:
                return {"ok": False, "provider": prov, "error": "ANTHROPIC_API_KEY not set"}
            client = Anthropic(api_key=cfg.anthropic_api_key)
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
            client = OpenAI(api_key=api_key, base_url=base)
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
    return {
        "topic": topic,
        "provider": prov,
        "model": model,
        "posts": posts[0]["n"] if posts else 0,
    }
