"""`chat doctor` — probe a topic's chat-readiness end-to-end.

Answers "why doesn't chat work / answer well for THIS topic?" with a structured,
ordered report. Each check is one of the real failure modes we mapped:

  corpus        — any posts collected for the topic?
  corpus_text   — do those posts actually carry title/body text to ground on?
  findings      — LLM-extracted painpoints/features (soft: chat works without them)
  palace_*      — ChromaDB installed? ONNX model cached? indexed FOR THIS TOPIC?
  name_match    — is the topic indexed under a different case/whitespace variant?
  provider      — is an LLM provider/model resolvable?

Pure orchestration over db + palace + llm_dispatch, so it's unit-testable with
fakes and callable from the CLI (`research chat-doctor`) or a Tauri command.
"""
from __future__ import annotations

from typing import Any, Callable

from ...core.db import get_db


def _add(report: dict, name: str, ok: bool, detail: str, fix: str | None = None, *, hard: bool = True) -> None:
    report["checks"].append({"name": name, "ok": ok, "detail": detail, "fix": fix})
    if not ok and hard:
        report["ok"] = False


def diagnose(topic: str, provider: str | None = None, *, db: Any = None) -> dict:
    """Return a structured chat-readiness report for `topic`.

    `db` is injectable for tests; defaults to the app DB.
    """
    db = db if db is not None else get_db()
    report: dict = {"topic": topic, "ok": True, "checks": []}

    # 1. Corpus -------------------------------------------------------------
    n_posts = _count(db, "SELECT count(*) AS n FROM topic_posts WHERE topic=?", (topic,))
    _add(report, "corpus", n_posts > 0, f"{n_posts} posts in topic_posts",
         fix="Run a collect for this topic first." if n_posts == 0 else None)

    if n_posts > 0:
        n_text = _count(
            db,
            "SELECT count(*) AS n FROM posts p JOIN topic_posts tp ON p.id=tp.post_id "
            "WHERE tp.topic=? AND trim(coalesce(p.title,'')||coalesce(p.selftext,'')) != ''",
            (topic,),
        )
        _add(report, "corpus_text", n_text > 0,
             f"{n_text}/{n_posts} posts carry title/body text",
             fix="Posts exist but have no text to ground on — re-collect with content."
                 if n_text == 0 else None)

    # 2. Findings (soft — chat works via palace without them) ----------------
    n_find = _count(
        db,
        "SELECT count(*) AS n FROM graph_nodes WHERE topic=? "
        "AND kind IN ('painpoint','feature_wish','workaround','product')",
        (topic,),
    )
    _add(report, "findings", n_find > 0,
         f"{n_find} extracted findings"
         + ("" if n_find else " — chat still works via palace; enrich to sharpen answers"),
         fix=None, hard=False)

    # 3. Palace (semantic retrieval) ----------------------------------------
    indexed = 0
    try:
        from ...retrieval import palace
        avail = bool(palace.is_available())
        _add(report, "palace_available", avail,
             "ChromaDB importable" if avail else "ChromaDB not installed — semantic retrieval OFF (SQL fallback only)",
             fix="Rebuild the sidecar with the `retrieval` extras." if not avail else None,
             hard=False)
        ready = avail and bool(palace.is_model_ready())
        if avail:
            _add(report, "palace_model", ready,
                 "MiniLM ONNX model cached" if ready else "ONNX embedding model not downloaded",
                 fix="Settings → Semantic search → Enable (80 MB)." if not ready else None,
                 hard=False)
        by_topic: dict = {}
        if ready:
            st = palace.stats() or {}
            by_topic = (st.get("by_topic") or {}) if isinstance(st, dict) else {}
            indexed = int(by_topic.get(topic, 0) or 0)
            total = int(st.get("count", 0) or 0) if isinstance(st, dict) else 0
            _add(report, "palace_indexed", indexed > 0 or n_posts == 0,
                 f"{indexed} posts indexed for this topic (palace total {total})",
                 fix="Posts exist but aren't embedded — run `research palace reindex`."
                     if indexed == 0 and n_posts > 0 else None,
                 hard=False)
            # name-variant mismatch — the classic "works for one topic, not another"
            if indexed == 0 and by_topic:
                key = (topic or "").strip().lower()
                variants = [t for t in by_topic if t != topic and t.strip().lower() == key]
                if variants:
                    _add(report, "palace_name_match", False,
                         f"topic indexed under a different name variant: {variants!r}",
                         fix=f"Chat queries topic={topic!r} but palace stores {variants!r}; "
                             f"canonicalize the topic name or re-index.")
    except Exception as e:  # noqa: BLE001
        _add(report, "palace_available", False, f"palace probe failed: {e}", hard=False)

    # 4. Provider -----------------------------------------------------------
    try:
        from .llm_dispatch import _resolve_provider
        prov, model = _resolve_provider(provider)
        _add(report, "provider", True, f"{prov} / {model}")
    except Exception as e:  # noqa: BLE001
        _add(report, "provider", False, str(e), fix="Add an LLM key in Settings → API keys.")

    # Verdict ---------------------------------------------------------------
    grounding_ok = (n_posts > 0) and (n_find > 0 or indexed > 0)
    report["grounding"] = "ok" if grounding_ok else "weak"
    report["verdict"] = "ready" if report["ok"] else "blocked"
    report["summary"] = _summarize(report)
    return report


def _summarize(report: dict) -> str:
    fails = [c for c in report["checks"] if not c["ok"]]
    if not fails:
        g = report.get("grounding")
        return "Chat is ready." + ("" if g == "ok" else " (grounding is thin — collect/enrich more.)")
    first = fails[0]
    return f"Blocked: {first['name']} — {first['detail']}." + (f" Fix: {first['fix']}" if first.get("fix") else "")


def format_report(report: dict) -> str:
    """Human-readable rendering for the CLI."""
    lines = [f"chat doctor — topic: {report['topic']!r}  [{report['verdict']}]"]
    for c in report["checks"]:
        mark = "✓" if c["ok"] else "✗"
        lines.append(f"  {mark} {c['name']:16} {c['detail']}")
        if c.get("fix"):
            lines.append(f"      ↳ fix: {c['fix']}")
    lines.append(f"  → {report['summary']}")
    return "\n".join(lines)


def _count(db: Any, sql: str, params: tuple) -> int:
    try:
        rows = list(db.query(sql, params))
        return int(rows[0]["n"]) if rows else 0
    except Exception:
        return 0
