"""Evidence-weighted answers — a Consensus-style verdict on a claim.

Ask a yes/no-ish claim about a topic ("users want offline mode", "the pricing
is too high") and get back a verdict — supported / contradicted / mixed /
insufficient — with the count of supporting vs contradicting sources, a
confidence, and a breakdown by source type (what *users* say vs what *papers*
say). Evidence posts are retrieved by keyword from the topic corpus, then an
LLM classifies each excerpt's stance toward the claim.

Cached per (topic, claim_id) in ``evidence_verdicts``. Skips gracefully when no
LLM is configured.
"""
from __future__ import annotations

import json as _json
import re as _re
from datetime import datetime, timezone
from typing import Any

from ..core.db import get_db

_STOP = {
    "the", "a", "an", "and", "or", "of", "to", "for", "in", "on", "with", "is",
    "are", "be", "this", "that", "it", "do", "does", "want", "need", "have",
    "they", "their", "users", "user", "people", "too", "very", "more", "less",
}

_SYSTEM = (
    "You are an evidence adjudicator. Given a claim and a numbered list of "
    "real user/post excerpts, classify each excerpt's stance toward the claim. "
    "Return JSON only — no prose."
)

_USER_TMPL = (
    'Claim: "{claim}"\n\n'
    "Excerpts:\n{corpus}\n\n"
    "For EACH excerpt, decide its stance toward the claim:\n"
    '  "support"    — the excerpt provides evidence FOR the claim\n'
    '  "contradict" — the excerpt provides evidence AGAINST the claim\n'
    '  "neutral"    — unrelated or no clear stance\n\n'
    "Return a JSON array, one object per excerpt, EXACTLY:\n"
    '[{{"id": "<post_id>", "stance": "support|contradict|neutral"}}]\n'
    "JSON only."
)


def _slug(s: str) -> str:
    s = _re.sub(r"[^a-zA-Z0-9]+", "-", (s or "").strip().lower()).strip("-")
    return s[:80] or "claim"


def _keywords(claim: str, max_kw: int = 6) -> list[str]:
    toks = [t for t in _re.split(r"[^a-zA-Z0-9]+", (claim or "").lower()) if t]
    out, seen = [], set()
    for t in toks:
        if len(t) >= 4 and t not in _STOP and t not in seen:
            seen.add(t)
            out.append(t)
        if len(out) >= max_kw:
            break
    return out


def _ensure_table() -> None:
    db = get_db()
    db.execute(
        "CREATE TABLE IF NOT EXISTS evidence_verdicts ("
        " topic TEXT NOT NULL,"
        " claim_id TEXT NOT NULL,"
        " claim TEXT,"
        " verdict TEXT,"
        " supporting_count INTEGER,"
        " contradicting_count INTEGER,"
        " neutral_count INTEGER,"
        " confidence REAL,"
        " evidence_post_ids TEXT,"
        " sources_breakdown TEXT,"
        " provider TEXT,"
        " updated_at TEXT,"
        " PRIMARY KEY (topic, claim_id))"
    )
    db.conn.commit()


def _retrieve(topic: str, claim: str, limit: int) -> list[dict]:
    db = get_db()
    kws = _keywords(claim)
    if not kws:
        return []
    like_clause = " OR ".join(
        "(lower(p.title) LIKE ? OR lower(coalesce(p.selftext,'')) LIKE ?)"
        for _ in kws
    )
    params: list[Any] = [topic]
    for k in kws:
        params.extend([f"%{k}%", f"%{k}%"])
    params.append(int(limit))
    rows = list(db.query(
        f"SELECT p.id, coalesce(p.title,'') AS title, coalesce(p.selftext,'') AS selftext,"
        f" coalesce(p.source_type,'reddit') AS source_type, coalesce(p.score,0) AS score"
        f" FROM posts p JOIN topic_posts tp ON tp.post_id = p.id"
        f" WHERE tp.topic = ? AND ({like_clause})"
        f" ORDER BY p.score DESC LIMIT ?",
        params,
    ))
    return rows


def answer(topic: str, claim: str, *, limit: int = 30,
           provider: str | None = None) -> dict[str, Any]:
    """Adjudicate a claim against the topic corpus. Returns the verdict dict and
    caches it. {ok, verdict, supporting, contradicting, confidence, breakdown}."""
    _ensure_table()
    posts = _retrieve(topic, claim, limit)
    if not posts:
        return {"ok": False, "topic": topic, "claim": claim,
                "verdict": "insufficient", "error": "no matching evidence in corpus"}

    # Build a compact numbered corpus.
    lines = []
    for p in posts:
        body = (p["title"] + " — " + p["selftext"]).strip()[:300]
        lines.append(f'[{p["id"]}] {body}')
    corpus = "\n".join(lines)

    try:
        from ..analyze.providers.base import get_provider, resolve_provider
        provider_name = resolve_provider(provider)
        prov = get_provider(provider)
    except Exception as e:
        return {"ok": False, "skipped": True, "reason": str(e),
                "topic": topic, "claim": claim}

    try:
        raw = prov.complete(
            prompt=_USER_TMPL.format(claim=claim, corpus=corpus),
            system=_SYSTEM, max_tokens=1500, temperature=0.1,
        )
    except Exception as e:
        return {"ok": False, "error": f"llm call failed: {e}",
                "topic": topic, "claim": claim}

    from .gaps import _parse_json
    parsed = _parse_json(raw)
    if not isinstance(parsed, list):
        return {"ok": False, "skipped": True, "reason": "parse_failed",
                "topic": topic, "claim": claim}

    stance_by_id = {}
    for item in parsed:
        if isinstance(item, dict) and item.get("id"):
            st = str(item.get("stance") or "neutral").lower()
            if st not in ("support", "contradict", "neutral"):
                st = "neutral"
            stance_by_id[str(item["id"])] = st

    src_by_id = {p["id"]: p["source_type"] for p in posts}
    support = contradict = neutral = 0
    breakdown: dict[str, dict[str, int]] = {}
    ev_ids: list[str] = []
    for pid, st in stance_by_id.items():
        src = src_by_id.get(pid, "reddit")
        breakdown.setdefault(src, {"support": 0, "contradict": 0, "neutral": 0})
        breakdown[src][st] += 1
        if st == "support":
            support += 1; ev_ids.append(pid)
        elif st == "contradict":
            contradict += 1; ev_ids.append(pid)
        else:
            neutral += 1

    decisive = support + contradict
    if decisive < 3:
        verdict = "insufficient"
    elif support >= 2 * max(contradict, 1) and support > contradict:
        verdict = "supported"
    elif contradict >= 2 * max(support, 1) and contradict > support:
        verdict = "contradicted"
    else:
        verdict = "mixed"
    confidence = round((max(support, contradict) / decisive) if decisive else 0.0, 3)

    db = get_db()
    now_iso = datetime.now(timezone.utc).isoformat(timespec="seconds")
    claim_id = _slug(claim)
    db.execute(
        "INSERT INTO evidence_verdicts(topic,claim_id,claim,verdict,supporting_count,"
        "contradicting_count,neutral_count,confidence,evidence_post_ids,sources_breakdown,"
        "provider,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)"
        " ON CONFLICT(topic,claim_id) DO UPDATE SET claim=excluded.claim,"
        " verdict=excluded.verdict, supporting_count=excluded.supporting_count,"
        " contradicting_count=excluded.contradicting_count, neutral_count=excluded.neutral_count,"
        " confidence=excluded.confidence, evidence_post_ids=excluded.evidence_post_ids,"
        " sources_breakdown=excluded.sources_breakdown, provider=excluded.provider,"
        " updated_at=excluded.updated_at",
        [topic, claim_id, claim, verdict, support, contradict, neutral, confidence,
         _json.dumps(ev_ids[:20]), _json.dumps(breakdown), provider_name, now_iso],
    )
    db.conn.commit()
    return {
        "ok": True, "topic": topic, "claim": claim, "claim_id": claim_id,
        "verdict": verdict, "supporting": support, "contradicting": contradict,
        "neutral": neutral, "confidence": confidence, "analyzed": len(stance_by_id),
        "sources_breakdown": breakdown, "evidence_post_ids": ev_ids[:20],
        "provider": provider_name,
    }


def get(topic: str) -> dict[str, Any]:
    """List cached verdicts for a topic, newest first."""
    _ensure_table()
    db = get_db()
    rows = list(db.query(
        "SELECT claim_id, claim, verdict, supporting_count, contradicting_count,"
        " neutral_count, confidence, sources_breakdown, updated_at"
        " FROM evidence_verdicts WHERE topic = ? ORDER BY updated_at DESC",
        [topic],
    ))
    for r in rows:
        try:
            r["sources_breakdown"] = _json.loads(r.get("sources_breakdown") or "{}")
        except Exception:
            r["sources_breakdown"] = {}
    return {"ok": True, "topic": topic, "count": len(rows), "rows": rows}


__all__ = ["answer", "get"]
