"""Agent mode — Anthropic tool-use loop over the corpus.

The LLM can call tools (list_topics / run_query / get_findings / source_breakdown
/ sample_posts / semantic_search / fetch_more_papers / fetch_more_evidence) to
explore the SQLite corpus + palace and pull fresh data mid-conversation. The tool
registry + executor are provider-agnostic; the streaming loop is Anthropic-only
for now.

Extracted from the monolithic chat.py so the agent layer is isolated from the
plain chat path. Heavy deps (palace, paper_pipeline, collect) stay lazily
imported inside _exec_tool.
"""
from __future__ import annotations

import json
from collections.abc import Iterator

from ...core.db import get_db
from .llm_dispatch import _resolve_provider


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
