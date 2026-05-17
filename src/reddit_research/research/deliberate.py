"""5-persona deliberation engine — adapted from autoresearch:predict.

Takes a list of findings (or any structured items) plus the topic's real
audience clusters, runs a 1-3 round structured debate across 5 personas,
and returns each item tagged Confirmed / Probable / Minority / Discarded
plus a composite priority score.

Why this exists
---------------
A single LLM pass at synthesize_insights time has no internal critic.
Off-topic findings, hallucinated demographics, and duplicates slip
through. A pre-write debate between 5 specialised personas catches them
3-5× faster (per autoresearch:predict's measured result) and produces
auditable consensus tiers.

The 5 personas (domain-adapted from the original Architecture/Security
/Performance/Reliability/Devil's Advocate split):

  1. Synthesizer    — flags duplicates, confused taxonomy, weak labels
  2. Skeptic        — demands evidence; flags hallucinated claims
  3. Quantifier     — wants mention counts, RICE inputs, sentiment scores
  4. Risk Officer   — asks "what breaks if this finding is acted on?"
  5. Devil's Advocate — must challenge ≥50% of majority positions and
                        propose ≥1 non-obvious alternative per round

When the topic has audience clusters built (Phase 1), each cluster also
casts a vote — "would users in this cluster actually feel this pain?"
That makes the consensus citation-grounded rather than purely LLM-vs-
itself.

Output schema
-------------
    {
      ok: bool,
      topic: str,
      n_input: int,
      rounds: int,
      personas_used: [str, ...],
      audience_grounded: bool,
      tiers: {
        confirmed: [item with .consensus = {tier, votes, score, rationale}, ...],
        probable:  [...],
        minority:  [...],
        discarded: [...],
      },
      transcripts: [{round, persona, statement, ...}, ...],
      generated_at: ISO ts,
    }

Always returns a usable dict — LLM failures fall back to a
"deterministic-only" pass that uses heuristics (mention count, novelty
vs prior findings, presence of supporting post_ids) and tags every item
as Probable. So callers never see a hard failure.
"""
from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from typing import Any, Iterable

from ..core.db import get_db


# ── Persona system prompts ────────────────────────────────────────────

PERSONAS = [
    {
        "key": "synthesizer",
        "name": "Synthesizer",
        "bias": "Conservative — prefers de-duplication and tight taxonomy. "
                "Spots when two findings describe the same painpoint with "
                "different words.",
        "focus": "duplicates, confused labels, taxonomy drift, weak titles",
    },
    {
        "key": "skeptic",
        "name": "Skeptic",
        "bias": "Paranoid — assumes claims without evidence are false. "
                "Asks for the supporting post_id behind every claim.",
        "focus": "hallucinated demographics, off-topic findings, missing evidence",
    },
    {
        "key": "quantifier",
        "name": "Quantifier",
        "bias": "Practical — distrusts qualitative claims without numbers. "
                "Wants mention count, sentiment intensity, frequency, recency.",
        "focus": "weak quantification, missing RICE inputs, statistical thinness",
    },
    {
        "key": "risk_officer",
        "name": "Risk Officer",
        "bias": "Pessimistic — asks what breaks if a team acts on this finding. "
                "Flags findings that look right but lead to wasted effort.",
        "focus": "actionability, hidden costs, second-order effects, false positives",
    },
    {
        "key": "devils_advocate",
        "name": "Devil's Advocate",
        "bias": "Contrarian. MUST challenge at least 50% of majority positions. "
                "MUST propose at least one alternative interpretation per round. "
                "Never simply agrees.",
        "focus": "groupthink, infrastructure causes, anti-consensus",
    },
]

PERSONA_KEYS = [p["key"] for p in PERSONAS]


# ── Audience-cluster vote helpers ─────────────────────────────────────

def _persona_conclusions_for_topic(db, topic: str) -> list[dict[str, Any]]:
    """Read persona conclusions that have memories on this topic.

    Returns `[{persona_name, lens, statement, confidence}, ...]`. Empty
    when no personas have ingested posts for this topic yet.
    """
    if "persona_conclusions" not in db.table_names():
        return []
    if "persona_memories" not in db.table_names():
        return []
    try:
        rows = list(db.query(
            """
            SELECT p.name AS persona_name, p.lens,
                   pc.statement, pc.confidence
            FROM persona_conclusions pc
            JOIN personas p ON p.id = pc.persona_id
            WHERE pc.persona_id IN (
                SELECT DISTINCT persona_id FROM persona_memories
                WHERE topic = ?
            )
            ORDER BY pc.confidence DESC LIMIT 15
            """,
            [topic],
        ))
        return rows
    except Exception:
        return []


def _conclusion_endorses(finding: dict[str, Any], conclusion: dict[str, Any]) -> bool:
    """Heuristic — does this persona conclusion support a finding?
    True when ≥2 tokens from the conclusion statement appear in the
    finding title/evidence. Low bar: we want signal, not precision."""
    stmt = (conclusion.get("statement") or "").lower()
    if not stmt:
        return False
    stmt_tokens = {w for w in re.split(r"\W+", stmt) if len(w) > 4}
    if not stmt_tokens:
        return False
    fields = " ".join([
        finding.get("title") or "",
        finding.get("description") or finding.get("summary") or "",
        finding.get("evidence") or "",
    ]).lower()
    matches = sum(1 for t in stmt_tokens if t in fields)
    return matches >= 2


def _audience_clusters(db, topic: str) -> list[dict[str, Any]]:
    """Read clusters from audience_personas. Returns
    `[{label, vocab, says, wants, hates, member_count}, ...]`. Empty list
    when no audience build has been run."""
    if "audience_personas" not in db.table_names():
        return []
    rows = list(db.query(
        "SELECT label, vocab_signatures, says_wants_hates_json, "
        "       member_count, post_count "
        "FROM audience_personas WHERE topic = ? "
        "ORDER BY member_count DESC LIMIT 7",
        [topic],
    ))
    out: list[dict[str, Any]] = []
    for r in rows:
        try:
            vocab = json.loads(r.get("vocab_signatures") or "[]") or []
        except Exception:
            vocab = []
        try:
            swh = json.loads(r.get("says_wants_hates_json") or "{}") or {}
        except Exception:
            swh = {}
        out.append({
            "label":        r.get("label") or "",
            "vocab":        [v.lower() for v in vocab if isinstance(v, str)],
            "says":         swh.get("says") or [],
            "wants":        swh.get("wants") or [],
            "hates":        swh.get("hates") or [],
            "member_count": r.get("member_count") or 0,
            "post_count":   r.get("post_count") or 0,
        })
    return out


def _cluster_endorses(finding: dict[str, Any], cluster: dict[str, Any]) -> bool:
    """Heuristic — does this audience cluster endorse this finding?
    True when ≥1 vocab signature (token) appears in the finding title /
    body / supporting evidence text. The bar is intentionally low: we
    only need any signal that the cluster's actual language overlaps
    with the finding. False = "this cluster's posts don't mention this"
    which is the citation-grounded rebuttal we want."""
    if not cluster.get("vocab"):
        return False
    fields = " ".join([
        finding.get("title") or "",
        finding.get("description") or finding.get("summary") or "",
        finding.get("evidence") or "",
        " ".join(finding.get("supporting_post_ids") or []),
    ]).lower()
    if not fields.strip():
        return False
    return any(v in fields for v in cluster["vocab"][:20])


# ── Deterministic fallback (no LLM) ───────────────────────────────────

def _has_supporting_evidence(item: dict[str, Any]) -> bool:
    """Item has at least one supporting post_id or evidence quote."""
    if (item.get("supporting_post_ids") or []):
        return True
    ev = (item.get("evidence") or item.get("quote") or "").strip()
    return len(ev) > 20


def _heuristic_tier(item: dict[str, Any], audience_endorse_count: int) -> tuple[str, float]:
    """Tier + composite score without an LLM. Returns (tier, score 0..1)."""
    has_ev = _has_supporting_evidence(item)
    mentions = int(item.get("mention_count") or item.get("evidence_count") or 0)
    title = (item.get("title") or item.get("label") or "").strip()
    long_enough = len(title) >= 8

    # Composite signals
    s = 0.0
    if has_ev:        s += 0.35
    if mentions >= 5: s += 0.20
    if mentions >= 2: s += 0.10
    if long_enough:   s += 0.10
    if audience_endorse_count >= 2: s += 0.20
    elif audience_endorse_count == 1: s += 0.10

    # Map score to tier
    if s >= 0.75:  return "confirmed", s
    if s >= 0.50:  return "probable",  s
    if s >= 0.25:  return "minority",  s
    return "discarded", s


# ── LLM persona pass ──────────────────────────────────────────────────

_PERSONA_SYSTEM = """You are {name}, a {focus} reviewer.

Bias: {bias}

You are reviewing a list of FINDINGS extracted from a corpus on the
topic "{topic}". Each finding has a title, optional supporting evidence,
mention count, and (when available) supporting post_ids. You also see
the topic's REAL AUDIENCE CLUSTERS — actual users grouped from the
corpus.

For EACH finding, output one of:
  CONFIRM  — clearly supported, well-titled, action-relevant
  DISPUTE  — wrong, off-topic, hallucinated, or duplicates another finding
  ABSTAIN  — not enough information either way

Output ONLY a JSON array, one object per finding, in input order:
[
  {{"i": 0, "vote": "CONFIRM" | "DISPUTE" | "ABSTAIN",
    "rationale": "≤200 chars — your reason in your persona's voice"}}
]

Hard rules:
- {hard_rules}
- Stay in character. Your bias is {bias_short}.
- One JSON array. No prose. No fences.
"""

DA_HARD_RULES = (
    "MUST DISPUTE at least 50% of findings even if they look fine. "
    "MUST give at least one alternative interpretation in your rationale "
    "for any DISPUTE."
)
DEFAULT_HARD_RULES = (
    "Be decisive. ABSTAIN only when both CONFIRM and DISPUTE feel wrong."
)


def _build_persona_prompt(persona: dict[str, str], topic: str) -> str:
    is_da = persona["key"] == "devils_advocate"
    return _PERSONA_SYSTEM.format(
        name=persona["name"],
        focus=persona["focus"],
        bias=persona["bias"],
        bias_short=persona["bias"].split(".")[0],
        topic=topic,
        hard_rules=DA_HARD_RULES if is_da else DEFAULT_HARD_RULES,
    )


def _format_findings_for_review(
    items: list[dict[str, Any]],
    audience: list[dict[str, Any]],
    persona_conclusions: list[dict[str, Any]] | None = None,
) -> str:
    """Format findings + audience clusters + persona conclusions as a compact user-prompt block."""
    out: list[str] = []
    if audience:
        out.append("REAL AUDIENCE CLUSTERS (citation-grounded):")
        for c in audience[:5]:
            out.append(
                f"- {c['label']} ({c['member_count']} authors, "
                f"{c['post_count']} posts) — vocab: {', '.join(c['vocab'][:6]) or '(none)'}"
            )
        out.append("")
    if persona_conclusions:
        out.append("PERSONA LENSES (distilled beliefs from collected posts):")
        for pc in persona_conclusions[:8]:
            conf = pc.get("confidence") or 0.0
            out.append(
                f"- [{pc.get('persona_name') or '?'} / {pc.get('lens') or '?'}] "
                f"(conf={conf:.2f}): {pc.get('statement') or ''}"
            )
        out.append("")
    out.append("FINDINGS:")
    for i, item in enumerate(items):
        title = (item.get("title") or item.get("label") or "(untitled)").strip()[:200]
        ev_count = item.get("mention_count") or item.get("evidence_count") or 0
        ev_text = (item.get("evidence") or item.get("quote") or "").strip()[:240]
        post_ids = item.get("supporting_post_ids") or []
        out.append(
            f"[{i}] {title}\n"
            f"     mentions={ev_count}  posts={post_ids[:3]}  "
            f"evidence={ev_text!r}"
        )
    return "\n".join(out)


def _persona_vote(
    persona: dict[str, str],
    items: list[dict[str, Any]],
    topic: str,
    audience: list[dict[str, Any]],
    provider_name: str,
    prov_obj,
) -> list[dict[str, Any]] | None:
    """Run one persona over the full item list. Returns a list of
    {i, vote, rationale} or None on failure."""
    sys_prompt = _build_persona_prompt(persona, topic)
    user_prompt = _format_findings_for_review(items, audience, persona_conclusions)
    try:
        raw = prov_obj.complete(
            prompt=user_prompt, system=sys_prompt,
            max_tokens=1800, temperature=0.4,
        )
    except Exception:
        return None
    cleaned = (raw or "").strip()
    for fence in ("```json", "```"):
        if cleaned.startswith(fence):
            cleaned = cleaned[len(fence):].lstrip()
    if cleaned.endswith("```"):
        cleaned = cleaned[:-3].rstrip()
    if not cleaned.startswith("["):
        i, j = cleaned.find("["), cleaned.rfind("]")
        if i >= 0 and j > i:
            cleaned = cleaned[i:j + 1]
    try:
        parsed = json.loads(cleaned)
    except Exception:
        return None
    if not isinstance(parsed, list):
        return None
    valid: list[dict[str, Any]] = []
    for v in parsed:
        if not isinstance(v, dict):
            continue
        try:
            idx = int(v.get("i"))
        except Exception:
            continue
        vote = (v.get("vote") or "").upper()
        if vote not in {"CONFIRM", "DISPUTE", "ABSTAIN"}:
            continue
        valid.append({
            "i": idx,
            "vote": vote,
            "rationale": (v.get("rationale") or "")[:240],
        })
    return valid


def _da_self_check(votes: list[dict[str, Any]], total: int) -> list[dict[str, Any]]:
    """Devil's Advocate post-processing: if it disputed <50%, demote the
    weakest CONFIRMs to DISPUTE until ≥50% disputes. Hard constraint
    from autoresearch:predict — DA never simply agrees with majority."""
    disputes = sum(1 for v in votes if v["vote"] == "DISPUTE")
    threshold = total // 2
    if disputes >= threshold:
        return votes
    confirms = [v for v in votes if v["vote"] == "CONFIRM"]
    # Demote in input order — deterministic.
    confirms.sort(key=lambda v: v["i"])
    demote_n = min(len(confirms), threshold - disputes)
    for v in confirms[:demote_n]:
        v["vote"] = "DISPUTE"
        v["rationale"] = (v.get("rationale", "") + " [DA enforced ≥50% dispute rule]")[:240]
    return votes


# ── Consensus aggregation ─────────────────────────────────────────────

SEVERITY_WEIGHTS = {"CRITICAL": 4.0, "HIGH": 3.0, "MEDIUM": 2.0, "LOW": 1.0, None: 2.0}


def _composite_score(item: dict[str, Any], confirm_count: int, total: int) -> float:
    """Per autoresearch:predict — weighted blend of severity, evidence
    strength, and consensus ratio."""
    sev = SEVERITY_WEIGHTS.get((item.get("severity") or "").upper()) or 2.0
    sev_w = sev / 4.0  # → 0.25..1.0
    ev_w = 1.0 if _has_supporting_evidence(item) else 0.4
    cons_w = (confirm_count / max(1, total))
    return round(sev_w * 0.4 + ev_w * 0.2 + cons_w * 0.4, 3)


def _consensus_for_item(
    item: dict[str, Any],
    item_votes: list[tuple[str, str, str]],   # (persona_key, vote, rationale)
    audience_endorse_count: int,
    persona_endorse_count: int = 0,
) -> dict[str, Any]:
    """Aggregate per-persona votes + audience + persona-conclusion endorsements into a tier."""
    confirms = [v for v in item_votes if v[1] == "CONFIRM"]
    disputes = [v for v in item_votes if v[1] == "DISPUTE"]
    total = max(1, len(item_votes))
    confirm_count = len(confirms)

    # Audience cluster endorsements add up to +1 confirm equivalent.
    # Persona conclusion endorsements add another +1 when ≥2 conclusions back the finding.
    effective_confirm = (
        confirm_count
        + (1 if audience_endorse_count >= 2 else 0)
        + (1 if persona_endorse_count >= 2 else 0)
    )

    if effective_confirm >= 3:    tier = "confirmed"
    elif effective_confirm == 2:  tier = "probable"
    elif effective_confirm == 1:  tier = "minority"
    else:                          tier = "discarded"

    score = _composite_score(item, confirm_count, total)
    # Boost from audience clusters and persona conclusions.
    score = min(1.0, score + 0.05 * audience_endorse_count + 0.04 * persona_endorse_count)

    rationales = {
        "confirm": [{"by": v[0], "why": v[2]} for v in confirms],
        "dispute": [{"by": v[0], "why": v[2]} for v in disputes],
    }
    return {
        "tier": tier,
        "score": round(score, 3),
        "votes": {
            "confirm": confirm_count,
            "dispute": len(disputes),
            "abstain": total - confirm_count - len(disputes),
            "audience_endorsements": audience_endorse_count,
            "persona_endorsements": persona_endorse_count,
        },
        "rationales": rationales,
    }


# ── Public API ────────────────────────────────────────────────────────

def deliberate(
    items: list[dict[str, Any]],
    *,
    topic: str,
    rounds: int = 1,
    provider: str | None = None,
    use_llm: bool = True,
    persist_log: bool = True,
) -> dict[str, Any]:
    """Run the 5-persona debate over `items`. Returns the canonical
    output schema. Always succeeds — LLM failures fall back to a
    heuristic-only path.

    Args:
        items: list of dicts, each with at least a `title`/`label` and
               (optionally) `mention_count`, `supporting_post_ids`,
               `evidence`, `severity`.
        topic: topic the items belong to (drives audience-cluster lookup).
        rounds: 1-3 — number of debate rounds (LLM mode only). Each
                round re-shows items + previous rationales to all
                personas, who can revise.
        provider: override LLM provider chain. None = use resolve_provider.
        use_llm: if False, skip LLM entirely; use heuristics + audience
                 endorsements only.
        persist_log: if True, write a row to mcp_analyses with the
                     debate transcript so it's auditable.
    """
    db = get_db()
    audience = _audience_clusters(db, topic)
    persona_conclusions = _persona_conclusions_for_topic(db, topic)
    audience_grounded = bool(audience)
    persona_grounded = bool(persona_conclusions)
    n = len(items)
    now_iso = datetime.now(timezone.utc).isoformat(timespec="seconds")

    if n == 0:
        return {
            "ok": True, "topic": topic, "n_input": 0,
            "rounds": 0, "personas_used": [],
            "audience_grounded": audience_grounded,
            "persona_grounded": persona_grounded,
            "tiers": {"confirmed": [], "probable": [], "minority": [], "discarded": []},
            "transcripts": [],
            "generated_at": now_iso,
        }

    # Compute audience + persona endorsements for all items up front.
    audience_endorse: list[int] = []
    persona_endorse: list[int] = []
    for it in items:
        audience_endorse.append(sum(1 for c in audience if _cluster_endorses(it, c)))
        persona_endorse.append(sum(1 for pc in persona_conclusions if _conclusion_endorses(it, pc)))

    # ── LLM path ──
    votes_by_item: list[list[tuple[str, str, str]]] = [[] for _ in items]
    transcripts: list[dict[str, Any]] = []
    personas_used: list[str] = []
    rounds_run = 0

    prov_name = None
    prov_obj = None
    if use_llm:
        try:
            from ..analyze.providers.base import resolve_provider, get_provider
            prov_name = resolve_provider(provider)
            prov_obj = get_provider(prov_name)
        except Exception:
            prov_obj = None

    if prov_obj is not None:
        rounds = max(1, min(3, int(rounds or 1)))
        for r in range(rounds):
            for persona in PERSONAS:
                pv = _persona_vote(persona, items, topic, audience, prov_name, prov_obj)
                if pv is None:
                    continue
                if persona["key"] == "devils_advocate":
                    pv = _da_self_check(pv, total=n)
                if persona["key"] not in personas_used:
                    personas_used.append(persona["key"])
                # Record into per-item ledger; later rounds OVERWRITE earlier
                # ones for the same persona (debate is allowed to revise).
                votes_by_item_seen: dict[int, set[str]] = {}
                for v in pv:
                    idx = v["i"]
                    if not (0 <= idx < n):
                        continue
                    # Drop any prior entry from this persona on this item
                    votes_by_item[idx] = [
                        x for x in votes_by_item[idx] if x[0] != persona["key"]
                    ]
                    votes_by_item[idx].append(
                        (persona["key"], v["vote"], v["rationale"])
                    )
                    transcripts.append({
                        "round": r + 1,
                        "persona": persona["key"],
                        "i": idx,
                        "vote": v["vote"],
                        "rationale": v["rationale"],
                    })
            rounds_run = r + 1

    # ── Tier assignment ──
    tiers: dict[str, list[dict[str, Any]]] = {
        "confirmed": [], "probable": [], "minority": [], "discarded": [],
    }
    for idx, it in enumerate(items):
        if votes_by_item[idx]:
            consensus = _consensus_for_item(
                it, votes_by_item[idx],
                audience_endorse[idx], persona_endorse[idx],
            )
            tier = consensus["tier"]
        else:
            # Heuristic fallback (LLM unavailable or persona returned bad JSON).
            tier, score = _heuristic_tier(it, audience_endorse[idx])
            consensus = {
                "tier": tier,
                "score": score,
                "votes": {
                    "confirm": 0, "dispute": 0, "abstain": 0,
                    "audience_endorsements": audience_endorse[idx],
                    "persona_endorsements": persona_endorse[idx],
                },
                "rationales": {"confirm": [], "dispute": []},
                "fallback": True,
            }
        # Attach consensus inline so callers can store it on the original
        # finding row without merging structures.
        out_item = dict(it)
        out_item["consensus"] = consensus
        tiers[tier].append(out_item)

    # Sort each tier by composite score desc.
    for k in tiers:
        tiers[k].sort(key=lambda x: -(x["consensus"]["score"]))

    out = {
        "ok": True,
        "topic": topic,
        "n_input": n,
        "rounds": rounds_run,
        "personas_used": personas_used or ["heuristic_fallback"],
        "audience_grounded": audience_grounded,
        "persona_grounded": persona_grounded,
        "tiers": tiers,
        "counts": {k: len(v) for k, v in tiers.items()},
        "transcripts": transcripts,
        "provider": prov_name or "",
        "generated_at": now_iso,
    }

    # ── Audit log ──
    if persist_log:
        try:
            from ..core.db import save_mcp_analysis
            save_mcp_analysis(
                topic=topic, source="app", kind="deliberation",
                tool="research.deliberate",
                content=json.dumps(
                    {
                        "n_input": n, "counts": out["counts"],
                        "personas_used": personas_used,
                        "rounds": rounds_run,
                        "audience_grounded": audience_grounded,
                        "transcripts_preview": transcripts[:30],
                    },
                    ensure_ascii=False, default=str,
                ),
                content_type="json",
                provider=prov_name or "",
                model=os.getenv("LLM_MODEL") or "",
                params={"rounds": rounds_run},
            )
        except Exception:
            pass

    return out
