"""Go-to-Market Launch Brief — synthesizes a per-topic deliverable from
existing artefacts (corpus, empathy maps, interviews, surveys, findings).

Two-pass design:

1. **Deterministic pass** — pure SQL over what's already in the DB:
   - Top channels (subs / sources) ranked by engagement
   - Best post-time-of-day from `created_utc`
   - Top authors per channel
   - MVP feature list from `graph_nodes WHERE kind='intervention'` × RICE
   - Pricing range from VW survey aggregate
   - PMF / NPS readouts
   - Persona shapes from existing empathy_maps + interviews

   This pass ALWAYS works (offline, no LLM key required) and produces a
   usable launch brief even when the topic has only a corpus.

2. **LLM augmentation** — optional. When a provider is configured:
   - Refine 2-3 ICP personas with one-liner + JTBD from the corpus
   - Infer demographics (age range, geography, occupation, income bracket)
   - Re-rank channels by ICP fit and suggest external (ProductHunt, HN,
     Twitter, Discord, dev.to)
   - Synthesize positioning statement + 3-step launch sequence

Output schema (always present, fields fall back to `None` / `[]` if
unavailable):
```
{
  ok: bool,
  topic: str,
  generated_at: ISO timestamp,
  audience: {
    icp_personas: [{name, one_liner, jtbd, signals_count}],
    demographics: {age_range, geography, occupations, income_bracket},
    persona_count: int,
  },
  launch_channels: [
    {name, type, posts, avg_score, total_engagement, top_authors,
     fit_rationale?, fit_score?}
  ],
  best_post_time: {hour_utc, day_of_week, sample_n},
  market_requirements: {
    mvp_features: [{label, rice_score, kano, moscow}],
    pricing: {opp, ipp, pmc, pme, n} | null,
    pmf: {pct_very_disappointed, threshold_met, n_total} | null,
    nps: {nps, promoters, passives, detractors, n} | null,
    positioning_statement?,
  },
  launch_sequence: [{step, action, target_channels, success_metric, eta}] | [],
  llm_augmented: bool,
  provider?, model?,
}
```
"""
from __future__ import annotations

import json
import os
from collections import Counter
from datetime import datetime, timezone
from typing import Any

from ..core.db import get_db


# ── Deterministic helpers ──────────────────────────────────────────────

def _channel_ranking(db, topic: str, limit: int = 12) -> list[dict[str, Any]]:
    """Top sub × source combos by engagement. Reddit gets per-sub
    granularity; other sources collapse to the source label."""
    sql = """
        SELECT
          coalesce(p.source_type, 'reddit') AS type,
          coalesce(p.sub, coalesce(p.source_type, 'reddit')) AS name,
          COUNT(*)             AS posts,
          ROUND(AVG(coalesce(p.score, 0)), 1)        AS avg_score,
          SUM(coalesce(p.score, 0)
              + coalesce(p.num_comments, 0) * 2)     AS total_engagement
        FROM posts p
        JOIN topic_posts tp ON tp.post_id = p.id
        WHERE tp.topic = :topic
        GROUP BY type, name
        ORDER BY total_engagement DESC
        LIMIT :lim
    """
    out: list[dict[str, Any]] = []
    for row in db.query(sql, {"topic": topic, "lim": limit}):
        d = dict(row)
        d["top_authors"] = _top_authors_for_channel(db, topic, d["name"], d["type"])
        out.append(d)
    return out


def _top_authors_for_channel(db, topic: str, name: str, ctype: str, k: int = 3) -> list[str]:
    """Top-k authors by post count in a given (channel × topic). Filters
    out the [deleted] / AutoModerator / null bucket."""
    sql = """
        SELECT p.author, COUNT(*) c
        FROM posts p
        JOIN topic_posts tp ON tp.post_id = p.id
        WHERE tp.topic = :topic
          AND coalesce(p.sub, coalesce(p.source_type, 'reddit')) = :name
          AND coalesce(p.source_type, 'reddit') = :type
          AND p.author IS NOT NULL
          AND p.author NOT IN ('[deleted]', 'AutoModerator', '')
        GROUP BY p.author
        ORDER BY c DESC
        LIMIT :k
    """
    return [
        r["author"] for r in db.query(
            sql, {"topic": topic, "name": name, "type": ctype, "k": k},
        )
    ]


def _best_post_time(db, topic: str) -> dict[str, Any] | None:
    """Hour-of-day + day-of-week with highest engagement-per-post.
    Returns None if the corpus has fewer than 20 timestamped posts."""
    rows = list(db.query(
        """
        SELECT p.created_utc, coalesce(p.score, 0) + coalesce(p.num_comments, 0) AS eng
        FROM posts p
        JOIN topic_posts tp ON tp.post_id = p.id
        WHERE tp.topic = :topic
          AND p.created_utc IS NOT NULL
          AND p.created_utc > 0
        """,
        {"topic": topic},
    ))
    if len(rows) < 20:
        return None
    hour_eng: dict[int, list[int]] = {}
    dow_eng: dict[int, list[int]] = {}
    for r in rows:
        ts = float(r["created_utc"])
        eng = int(r["eng"] or 0)
        dt = datetime.fromtimestamp(ts, tz=timezone.utc)
        hour_eng.setdefault(dt.hour, []).append(eng)
        dow_eng.setdefault(dt.weekday(), []).append(eng)
    best_hour = max(
        hour_eng.items(),
        key=lambda kv: sum(kv[1]) / max(1, len(kv[1])),
    )[0] if hour_eng else None
    best_dow = max(
        dow_eng.items(),
        key=lambda kv: sum(kv[1]) / max(1, len(kv[1])),
    )[0] if dow_eng else None
    days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    return {
        "hour_utc": best_hour,
        "day_of_week": days[best_dow] if best_dow is not None else None,
        "sample_n": len(rows),
    }


def _mvp_features(db, topic: str, k: int = 8) -> list[dict[str, Any]]:
    """Top interventions by RICE score, with Kano + MoSCoW chips."""
    if "graph_nodes" not in db.table_names():
        return []
    rows = list(db.query(
        """
        SELECT id, label, metadata_json
        FROM graph_nodes
        WHERE topic = :topic AND kind = 'intervention'
          AND label IS NOT NULL AND label != ''
        ORDER BY created_at DESC
        """,
        {"topic": topic},
    ))
    out: list[dict[str, Any]] = []
    for r in rows:
        meta: dict[str, Any] = {}
        try:
            meta = json.loads(r.get("metadata_json") or "{}") or {}
        except Exception:
            pass
        rice = meta.get("rice") or {}
        rice_score = rice.get("score") if isinstance(rice, dict) else None
        out.append({
            "label": r.get("label"),
            "rice_score": rice_score,
            "kano": meta.get("kano"),
            "moscow": meta.get("moscow"),
        })
    # Sort by RICE desc, putting None last
    out.sort(key=lambda x: (x["rice_score"] is None, -(x["rice_score"] or 0)))
    return out[:k]


def _pricing_aggregate(db, topic: str) -> dict[str, Any] | None:
    """Read VW aggregate if available (best-effort — survey tables are
    optional). Returns None if not enough data."""
    if "vw_responses" not in db.table_names():
        return None
    try:
        # Re-uses the same shape as research/surveys.py vw_aggregate
        from .surveys import vw_aggregate
        agg = vw_aggregate(topic=topic)
        if isinstance(agg, dict) and (agg.get("n") or 0) > 0:
            return agg
    except Exception:
        pass
    return None


def _pmf_score(db, topic: str) -> dict[str, Any] | None:
    if "pmf_responses" not in db.table_names():
        return None
    try:
        from .surveys import pmf_score
        s = pmf_score(topic=topic)
        if isinstance(s, dict) and (s.get("n_total") or 0) > 0:
            return s
    except Exception:
        pass
    return None


def _nps_score(db, topic: str) -> dict[str, Any] | None:
    if "nps_responses" not in db.table_names():
        return None
    try:
        from .surveys import nps_score
        s = nps_score(topic=topic)
        if isinstance(s, dict) and (s.get("n") or 0) > 0:
            return s
    except Exception:
        pass
    return None


def _personas_from_audience_table(db, topic: str) -> list[dict[str, Any]]:
    """Phase-1 personas — read from the new `audience_personas` table
    when available. These are clustered from real authors so they're
    citation-backed; prefer them over the empathy/interview shapes."""
    if "audience_personas" not in db.table_names():
        return []
    rows = list(db.query(
        "SELECT cluster_id, label, bio, persona, member_count, post_count, "
        "       tightness, exemplar_post_ids, llm_augmented, demographics_json "
        "FROM audience_personas WHERE topic = ? "
        "ORDER BY member_count DESC LIMIT 5",
        [topic],
    ))
    out: list[dict[str, Any]] = []
    for r in rows:
        try:
            demo = json.loads(r.get("demographics_json") or "{}") or {}
        except Exception:
            demo = {}
        try:
            ex_ids = json.loads(r.get("exemplar_post_ids") or "[]") or []
        except Exception:
            ex_ids = []
        out.append({
            "name":          r.get("label") or f"Cluster {r.get('cluster_id')}",
            "one_liner":     r.get("bio") or "",
            "jtbd":          "",
            "signals_count": (r.get("post_count") or 0) + (r.get("member_count") or 0),
            "source":        "audience_clustering",
            "members_count": r.get("member_count") or 0,
            "exemplar_post_ids": ex_ids[:3],
            "tightness":     r.get("tightness") or 0.0,
            "ages_signals":  demo.get("ages") or [],
            "occupations_signals": demo.get("occupations") or [],
            "geography_signals":   demo.get("geography") or [],
            "from_real_users": True,
        })
    return out


def _personas_from_existing(db, topic: str) -> list[dict[str, Any]]:
    """Build a persona list. Prefers the Phase-1 audience_personas
    clusters (citation-backed); falls back to empathy_maps + interviews
    if no audience build has been run yet."""
    real = _personas_from_audience_table(db, topic)
    if real:
        return real
    personas: dict[str, dict[str, Any]] = {}
    if "empathy_maps" in db.table_names():
        for r in db.query(
            "SELECT persona, says_json, thinks_json, does_json, feels_json "
            "FROM empathy_maps WHERE topic = :topic",
            {"topic": topic},
        ):
            p = (r.get("persona") or "primary").strip()
            n = 0
            for col in ("says_json", "thinks_json", "does_json", "feels_json"):
                try:
                    n += len(json.loads(r.get(col) or "[]") or [])
                except Exception:
                    pass
            personas.setdefault(p, {"name": p, "signals_count": 0, "source": "empathy"})
            personas[p]["signals_count"] += n
    if "interviews" in db.table_names():
        for r in db.query(
            "SELECT persona FROM interviews "
            "WHERE topic = :topic AND persona IS NOT NULL AND persona != ''",
            {"topic": topic},
        ):
            p = (r.get("persona") or "").strip()
            if not p:
                continue
            personas.setdefault(p, {"name": p, "signals_count": 0, "source": "interview"})
            personas[p]["signals_count"] += 1
            if personas[p].get("source") == "empathy":
                personas[p]["source"] = "empathy+interview"
    return sorted(personas.values(), key=lambda x: -x["signals_count"])[:5]


def _author_signals(db, topic: str) -> dict[str, Any]:
    """Aggregate signals from the corpus that hint at demographics.
    Pure deterministic — counts mentions of common age/job/geo terms."""
    rows = list(db.query(
        """
        SELECT lower(coalesce(p.title, '') || ' ' || coalesce(p.selftext, '')) AS text
        FROM posts p
        JOIN topic_posts tp ON tp.post_id = p.id
        WHERE tp.topic = :topic
        LIMIT 1500
        """,
        {"topic": topic},
    ))
    age_kw = Counter()
    role_kw = Counter()
    geo_kw = Counter()
    AGE_PATTERNS = ["teen", "college", "student", "20s", "30s", "40s", "retired", "millennial", "gen z", "gen x", "boomer"]
    ROLE_PATTERNS = ["founder", "engineer", "developer", "designer", "manager", "ceo", "freelance", "consultant", "marketer", "pm ", "ux", "product manager", "data scientist", "analyst", "researcher", "teacher", "doctor", "nurse", "lawyer"]
    GEO_PATTERNS = ["us", "uk", "canada", "germany", "india", "australia", "europe", "asia", "africa", "remote", "san francisco", "new york", "london", "berlin", "bangalore", "toronto"]
    for r in rows:
        t = r.get("text") or ""
        if not t:
            continue
        for kw in AGE_PATTERNS:
            if kw in t:
                age_kw[kw] += 1
        for kw in ROLE_PATTERNS:
            if kw in t:
                role_kw[kw.strip()] += 1
        for kw in GEO_PATTERNS:
            if f" {kw} " in f" {t} " or f" {kw}." in f" {t} ":
                geo_kw[kw] += 1
    return {
        "ages":       [k for k, _ in age_kw.most_common(5)],
        "occupations": [k for k, _ in role_kw.most_common(8)],
        "geography":  [k for k, _ in geo_kw.most_common(8)],
        "samples":    len(rows),
    }


# ── LLM augmentation (optional) ────────────────────────────────────────

_LLM_PROMPT = """You are a go-to-market analyst.

Given:
- Topic: {topic}
- Top channels (most engaged): {channels}
- Existing personas signals: {personas}
- Free-form deterministic signals from the corpus:
    age mentions: {ages}
    occupations: {occupations}
    geography: {geography}
- Top user-requested features (RICE-ranked): {features}
- Pricing aggregate (Van Westendorp, may be null): {pricing}

Produce ONLY a JSON object with this shape (no preamble, no fences):
{{
  "icp_personas": [
    {{"name": str, "one_liner": str, "jtbd": str}}
  ],
  "demographics": {{
    "age_range": str,
    "geography": str,
    "occupations": [str, ...],
    "income_bracket": str
  }},
  "channel_fit": [
    {{"name": str, "fit_rationale": str, "fit_score": 0-10}}
  ],
  "external_channels": [
    {{"name": str, "why": str}}
  ],
  "positioning_statement": str,
  "launch_sequence": [
    {{"step": int, "action": str, "target_channels": [str, ...], "success_metric": str, "eta": str}}
  ]
}}

Aim for 2-3 ICP personas, 3-step launch sequence, and 3-5 external
channels (ProductHunt / HN / Twitter / Discord / dev.to / Slack / etc.)
that match the topic. Be specific, action-oriented, falsifiable.
"""


def _llm_augment(topic: str, det: dict[str, Any], provider: str | None = None) -> dict[str, Any] | None:
    """Run the optional LLM pass. Returns the parsed JSON dict on success,
    or None on any failure (no LLM key, parse error, network)."""
    try:
        from ..analyze.providers.base import resolve_provider, get_provider
        prov_name = resolve_provider(provider)
    except Exception:
        return None
    try:
        prov = get_provider(prov_name)
    except Exception:
        return None
    prompt = _LLM_PROMPT.format(
        topic=topic,
        channels=json.dumps([{"name": c["name"], "type": c["type"], "engagement": c["total_engagement"]} for c in det["launch_channels"][:8]]),
        personas=json.dumps([p["name"] for p in det["audience"]["icp_personas"]]),
        ages=json.dumps(det["audience"]["demographics"].get("ages", [])),
        occupations=json.dumps(det["audience"]["demographics"].get("occupations", [])),
        geography=json.dumps(det["audience"]["demographics"].get("geography", [])),
        features=json.dumps([{"label": f["label"], "rice": f.get("rice_score")} for f in det["market_requirements"]["mvp_features"][:8]]),
        pricing=json.dumps(det["market_requirements"].get("pricing")),
    )
    try:
        raw = prov.complete(prompt=prompt, system="You output only valid JSON.", max_tokens=2000, temperature=0.3)
    except Exception:
        return None
    cleaned = (raw or "").strip()
    for fence in ("```json", "```"):
        if cleaned.startswith(fence):
            cleaned = cleaned[len(fence):].lstrip()
    if cleaned.endswith("```"):
        cleaned = cleaned[:-3].rstrip()
    # Salvage: find first { ... } block
    if not cleaned.startswith("{"):
        i = cleaned.find("{")
        j = cleaned.rfind("}")
        if i >= 0 and j > i:
            cleaned = cleaned[i:j + 1]
    try:
        parsed = json.loads(cleaned)
    except Exception:
        return None
    if not isinstance(parsed, dict):
        return None
    return {
        "parsed": parsed,
        "provider": prov_name,
        "model": os.getenv("LLM_MODEL") or getattr(prov, "_model", "") or "",
    }


# ── Public API ─────────────────────────────────────────────────────────

def _ensure_table(db) -> None:
    if "launch_briefs" not in db.table_names():
        db["launch_briefs"].create(
            {
                "topic": str,
                "brief_json": str,
                "generated_at": str,
                "provider": str,
                "model": str,
            },
            pk="topic",
        )


def build_launch_brief(
    topic: str,
    *,
    llm: bool = True,
    provider: str | None = None,
    persist: bool = True,
) -> dict[str, Any]:
    """Build a complete go-to-market brief for `topic`. Always returns a
    usable dict; LLM failures degrade silently to the deterministic-only
    section."""
    db = get_db()
    if "topic_posts" not in db.table_names():
        return {
            "ok": False,
            "topic": topic,
            "error": "topic_posts table missing — collect a topic first",
        }

    channels = _channel_ranking(db, topic)
    posts_total = sum(c["posts"] for c in channels)
    if posts_total == 0:
        return {
            "ok": False,
            "topic": topic,
            "error": f"No posts for topic={topic!r}. Run a collect first.",
        }

    sigs = _author_signals(db, topic)
    personas = _personas_from_existing(db, topic)

    det: dict[str, Any] = {
        "ok": True,
        "topic": topic,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "audience": {
            "icp_personas": personas,
            "demographics": {
                "ages":        sigs["ages"],
                "occupations": sigs["occupations"],
                "geography":   sigs["geography"],
                "samples":     sigs["samples"],
                "age_range":   None,
                "income_bracket": None,
            },
            "persona_count": len(personas),
        },
        "launch_channels": channels,
        "best_post_time":  _best_post_time(db, topic),
        "market_requirements": {
            "mvp_features": _mvp_features(db, topic),
            "pricing":      _pricing_aggregate(db, topic),
            "pmf":          _pmf_score(db, topic),
            "nps":          _nps_score(db, topic),
        },
        "launch_sequence": [],
        "llm_augmented": False,
    }

    if llm:
        aug = _llm_augment(topic, det, provider=provider)
        if aug:
            p = aug["parsed"]
            # Merge LLM output non-destructively. Deterministic data wins
            # for counts/measures; LLM wins for narrative text.
            if isinstance(p.get("icp_personas"), list) and p["icp_personas"]:
                # Keep deterministic signals_count, layer in LLM one_liner/jtbd.
                by_name = {x["name"].lower(): x for x in personas}
                merged: list[dict[str, Any]] = []
                for lp in p["icp_personas"]:
                    name = (lp.get("name") or "").strip()
                    if not name:
                        continue
                    base = by_name.get(name.lower(), {"name": name, "signals_count": 0, "source": "llm"})
                    base = dict(base)
                    base["one_liner"] = lp.get("one_liner") or ""
                    base["jtbd"] = lp.get("jtbd") or ""
                    merged.append(base)
                if merged:
                    det["audience"]["icp_personas"] = merged
                    det["audience"]["persona_count"] = len(merged)
            demo = p.get("demographics") or {}
            if isinstance(demo, dict):
                det["audience"]["demographics"].update({
                    "age_range":      demo.get("age_range"),
                    "geography_text": demo.get("geography"),
                    "occupations_text": demo.get("occupations"),
                    "income_bracket": demo.get("income_bracket"),
                })
            # Layer fit_rationale + fit_score into channel rows by name match
            fits = {(c.get("name") or "").lower(): c for c in (p.get("channel_fit") or []) if isinstance(c, dict)}
            for ch in det["launch_channels"]:
                f = fits.get((ch["name"] or "").lower())
                if f:
                    ch["fit_rationale"] = f.get("fit_rationale")
                    ch["fit_score"] = f.get("fit_score")
            ext = p.get("external_channels") or []
            if isinstance(ext, list):
                det["external_channels"] = [
                    {"name": x.get("name"), "why": x.get("why")}
                    for x in ext if isinstance(x, dict) and x.get("name")
                ]
            det["market_requirements"]["positioning_statement"] = p.get("positioning_statement") or None
            seq = p.get("launch_sequence") or []
            if isinstance(seq, list):
                det["launch_sequence"] = [s for s in seq if isinstance(s, dict) and s.get("action")]
            det["llm_augmented"] = True
            det["provider"] = aug["provider"]
            det["model"] = aug["model"]

    if persist:
        try:
            _ensure_table(db)
            db["launch_briefs"].upsert(
                {
                    "topic":        topic,
                    "brief_json":   json.dumps(det, ensure_ascii=False, default=str),
                    "generated_at": det["generated_at"],
                    "provider":     det.get("provider", "") or "",
                    "model":        det.get("model", "") or "",
                },
                pk="topic",
            )
        except Exception:
            pass
    return det


def get_launch_brief(topic: str) -> dict[str, Any]:
    """Read the most-recent persisted brief for `topic`. Returns
    `{ok: False, ...}` when none exists."""
    db = get_db()
    if "launch_briefs" not in db.table_names():
        return {"ok": False, "topic": topic, "error": "no brief generated yet"}
    row = db.execute(
        "SELECT brief_json, generated_at, provider, model "
        "FROM launch_briefs WHERE topic = ?",
        [topic],
    ).fetchone()
    if not row:
        return {"ok": False, "topic": topic, "error": "no brief generated yet"}
    try:
        d = json.loads(row[0])
        if isinstance(d, dict):
            d.setdefault("ok", True)
            d.setdefault("topic", topic)
            d["cached"] = True
            return d
    except Exception as e:
        return {"ok": False, "topic": topic, "error": f"corrupt cache: {e!s:.150}"}
    return {"ok": False, "topic": topic, "error": "unparseable cache"}
