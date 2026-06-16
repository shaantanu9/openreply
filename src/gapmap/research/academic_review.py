"""Multi-reviewer academic peer-review panel.

Where `deliberate.py` runs a 5-persona *debate* that tiers individual
findings (Confirmed / Probable / Minority / Discarded), this module runs a
classic *journal peer review*: a small panel of reviewers each reads the
WHOLE list of review items once, scores it, and the panel's scores are
synthesised into a single editorial decision (accept / minor / major /
reject) — the way an editor-in-chief would weigh a referee report.

Why this exists
---------------
A synthesis that survives a finding-level debate can still be unpublishable
as a whole — methodology too thin, the domain framing wrong, a single
fatal concern that no per-finding vote surfaces. Peer review judges the
package, not the parts, and gives the user a familiar verdict plus the
dissent that drove it.

The five default reviewer identities (clean-room, authored for Gap Map):

  1. editor_in_chief       — weighs overall contribution & fit, balances
                             the panel.
  2. methodology_reviewer  — interrogates rigour, sampling, evidence chain.
  3. domain_reviewer       — checks the framing against the field's prior art.
  4. perspective_reviewer  — asks whose viewpoint is missing / over-weighted.
  5. devils_advocate       — must surface at least one critical concern; the
                             referee who refuses to wave anything through.

Each reviewer makes ONE LLM call and returns:
    {score: 0-100, strengths: [str], weaknesses: [str],
     recommendation: "accept"|"minor"|"major"|"reject",
     critical_concerns: [str]}

Synthesis
---------
mean(reviewer scores) → editorial_decision:
    >=80 accept · 65-79 minor_revision · 50-64 major_revision · <50 reject
Any non-empty critical_concerns downgrades an would-be "accept" to
"minor_revision" and flips critical_blocks=True. Dissent = reviewers whose
recommendation is "major" or "reject".

Fail-soft
---------
Every LLM call is wrapped. If the provider can't be resolved or every
reviewer call fails, a deterministic fallback is returned: each reviewer
gets score 60 / recommendation "major" / provenance "fallback", the
decision is "major_revision", and ok=False. The function NEVER raises for
user-facing failures. An empty items list short-circuits to the same
"major_revision" / ok=False shape with a note on each reviewer.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any


# ── Reviewer identities ───────────────────────────────────────────────

DEFAULT_ROLES: list[dict[str, str]] = [
    {
        "key": "editor_in_chief",
        "name": "Editor-in-Chief",
        "bias": "Weighs overall contribution, novelty and fit. Balances the "
                "panel rather than nit-picking; cares whether the work is "
                "worth publishing at all.",
    },
    {
        "key": "methodology_reviewer",
        "name": "Methodology Reviewer",
        "bias": "Interrogates rigour — sampling, evidence chain, whether "
                "claims are supported by the cited material. Distrusts "
                "conclusions that outrun their evidence.",
    },
    {
        "key": "domain_reviewer",
        "name": "Domain Reviewer",
        "bias": "Checks the framing against the field's prior art. Flags "
                "claims that ignore established work or mislabel known "
                "concepts.",
    },
    {
        "key": "perspective_reviewer",
        "name": "Perspective Reviewer",
        "bias": "Asks whose viewpoint is missing or over-weighted. Surfaces "
                "blind spots, unrepresented stakeholders, and framing bias.",
    },
    {
        "key": "devils_advocate",
        "name": "Devil's Advocate",
        "bias": "Refuses to wave anything through. MUST surface at least one "
                "genuine critical concern. Never simply accepts.",
    },
]

VALID_RECS = {"accept", "minor", "major", "reject"}


# ── Prompt construction ───────────────────────────────────────────────

def _system_prompt(role: dict[str, str]) -> str:
    """Per-reviewer system prompt. The devil's advocate gets an extra hard
    rule so it always returns at least one critical concern."""
    is_da = role.get("key") == "devils_advocate"
    da_rule = (
        "\nHARD RULE: You MUST list at least one item in critical_concerns. "
        "There is always something. Do not return an empty critical_concerns."
        if is_da else ""
    )
    return (
        f"You are {role.get('name', 'a Reviewer')}, an academic peer reviewer.\n"
        f"Bias: {role.get('bias', '')}\n\n"
        "You are reviewing a set of REVIEW ITEMS (claims / literature gaps) "
        "drawn from a research synthesis. Judge the synthesis as a WHOLE — "
        "the way a journal referee weighs a submission — not item by item.\n\n"
        "Return ONLY a JSON object (no prose, no fences):\n"
        "{\n"
        '  "score": 0-100,\n'
        '  "strengths": ["short phrase", ...],\n'
        '  "weaknesses": ["short phrase", ...],\n'
        '  "recommendation": "accept" | "minor" | "major" | "reject",\n'
        '  "critical_concerns": ["a blocking concern", ...]\n'
        "}\n"
        "score reflects publication-readiness. critical_concerns are issues "
        "that would block acceptance; leave it empty only if there genuinely "
        "are none." + da_rule
    )


def _user_prompt(topic: str, items: list[dict]) -> str:
    """Render the item list as a compact review packet."""
    lines = [f'TOPIC: "{topic}"', "", "REVIEW ITEMS:"]
    for i, it in enumerate(items):
        title = (it.get("title") or it.get("label") or it.get("key")
                 or "(untitled)")
        detail = (it.get("detail") or it.get("summary") or "")
        posts = it.get("supporting_post_ids") or []
        lines.append(
            f"[{i}] {str(title).strip()[:200]}\n"
            f"     detail: {str(detail).strip()[:300]!r}\n"
            f"     supporting_posts: {len(posts)}"
        )
    lines.append("")
    lines.append("Review the synthesis as a whole and return the JSON object.")
    return "\n".join(lines)


# ── Tolerant JSON parsing (deliberate.py house style) ─────────────────

def _strip_fences(raw: str) -> str:
    cleaned = (raw or "").strip()
    for fence in ("```json", "```"):
        if cleaned.startswith(fence):
            cleaned = cleaned[len(fence):].lstrip()
    if cleaned.endswith("```"):
        cleaned = cleaned[:-3].rstrip()
    # Slice to the outermost object if the model wrapped it in prose.
    if not cleaned.startswith("{"):
        i, j = cleaned.find("{"), cleaned.rfind("}")
        if i >= 0 and j > i:
            cleaned = cleaned[i:j + 1]
    return cleaned


def _as_str_list(val: Any, *, limit: int = 8) -> list[str]:
    """Coerce a value into a clean list of short strings."""
    if isinstance(val, str):
        val = [val]
    if not isinstance(val, list):
        return []
    out: list[str] = []
    for v in val:
        if v is None:
            continue
        s = str(v).strip()
        if s:
            out.append(s[:300])
        if len(out) >= limit:
            break
    return out


def _parse_review(raw: str) -> dict[str, Any] | None:
    """Parse one reviewer's JSON object tolerantly. Returns a normalised
    review dict or None when the response is unusable."""
    cleaned = _strip_fences(raw)
    try:
        obj = json.loads(cleaned)
    except Exception:
        return None
    if not isinstance(obj, dict):
        return None
    try:
        score = int(round(float(obj.get("score"))))
    except Exception:
        return None
    score = max(0, min(100, score))
    rec = str(obj.get("recommendation") or "").strip().lower()
    if rec not in VALID_RECS:
        # Map the score to a recommendation when the model omitted it.
        rec = ("accept" if score >= 80 else "minor" if score >= 65
               else "major" if score >= 50 else "reject")
    return {
        "score": score,
        "recommendation": rec,
        "strengths": _as_str_list(obj.get("strengths")),
        "weaknesses": _as_str_list(obj.get("weaknesses")),
        "critical_concerns": _as_str_list(obj.get("critical_concerns")),
    }


# ── Synthesis ─────────────────────────────────────────────────────────

def _decision_from_score(mean_score: float) -> str:
    """Threshold map: >=80 accept · 65-79 minor · 50-64 major · <50 reject."""
    if mean_score >= 80:
        return "accept"
    if mean_score >= 65:
        return "minor_revision"
    if mean_score >= 50:
        return "major_revision"
    return "reject"


# ── Fallback construction ─────────────────────────────────────────────

def _fallback_reviewers(roles: list[dict[str, str]], *, note: str) -> list[dict[str, Any]]:
    """Deterministic neutral panel used when no LLM review is available."""
    return [{
        "role": r["key"],
        "score": 60,
        "recommendation": "major",
        "strengths": [],
        "weaknesses": [note] if note else [],
        "critical_concerns": [],
        "provenance": "fallback",
    } for r in roles]


def _fallback_result(topic: str, n_items: int, roles: list[dict[str, str]],
                     provider_name: str, now_iso: str, *, note: str) -> dict[str, Any]:
    """Assemble the canonical deterministic fallback envelope (ok=False)."""
    reviewers = _fallback_reviewers(roles, note=note)
    return {
        "ok": False,
        "topic": topic,
        "n_items": n_items,
        "reviewers": reviewers,
        "mean_score": 60.0,
        "editorial_decision": "major_revision",
        "critical_blocks": False,
        "dissent": [{"role": r["role"], "recommendation": "major", "why": note}
                    for r in reviewers],
        "provider": provider_name,
        "generated_at": now_iso,
    }


# ── Public API ────────────────────────────────────────────────────────

def run_review_panel(
    topic: str,
    items: list[dict],
    *,
    provider: str | None = None,
    rounds: int = 1,
    roles: list[dict] | None = None,
) -> dict:
    """Run a multi-reviewer peer-review panel over `items`.

    Args:
        topic: the topic the items belong to (shown to each reviewer).
        items: review items, each shaped like `academic_mode._build_review_items`
               produces (`key`/`title`/`detail`/`supporting_post_ids`).
        provider: override LLM provider chain. None = use resolve_provider.
        rounds: number of review rounds; each round re-runs every reviewer and
                the last successful review per reviewer is kept (1-3).
        roles: optional custom reviewer identities; else the 5 defaults.

    Returns:
        Always a dict in the documented envelope. Never raises for
        user-facing failures — provider problems fall back to a neutral,
        deterministic "major_revision" panel with ok=False.
    """
    now_iso = datetime.now(timezone.utc).isoformat(timespec="seconds")
    panel = roles if (roles and len(roles) >= 1) else DEFAULT_ROLES
    # Normalise role dicts so every entry has a usable "key"/"name".
    panel = [{
        "key": str(r.get("key") or r.get("name") or f"reviewer_{i}").strip() or f"reviewer_{i}",
        "name": str(r.get("name") or r.get("key") or f"Reviewer {i}").strip(),
        "bias": str(r.get("bias") or ""),
    } for i, r in enumerate(panel)]
    rounds = max(1, min(3, int(rounds or 1)))

    # Empty input → deterministic non-LLM short-circuit.
    if not items:
        return _fallback_result(
            topic, 0, panel, "", now_iso,
            note="no review items supplied; nothing to peer-review",
        )

    # ── Resolve the provider once (fail-soft) ──
    prov_name = ""
    prov_obj = None
    try:
        from ..analyze.providers.base import resolve_provider, get_provider
        prov_name = resolve_provider(provider)
        prov_obj = get_provider(prov_name)
    except Exception:
        prov_obj = None

    if prov_obj is None:
        return _fallback_result(
            topic, len(items), panel, prov_name, now_iso,
            note="LLM provider unavailable; returned neutral fallback review",
        )

    user_prompt = _user_prompt(topic, items)

    # ── Run each reviewer; keep the last successful parse across rounds ──
    parsed_by_role: dict[str, dict[str, Any]] = {}
    for _r in range(rounds):
        for role in panel:
            sys_prompt = _system_prompt(role)
            try:
                raw = prov_obj.complete(
                    prompt=user_prompt, system=sys_prompt,
                    max_tokens=1800, temperature=0.4,
                )
            except Exception:
                continue
            review = _parse_review(raw)
            if review is None:
                continue
            # Devil's advocate must surface a concern — synthesise one if the
            # model returned none, so the hard rule holds even on a terse reply.
            if role["key"] == "devils_advocate" and not review["critical_concerns"]:
                review["critical_concerns"] = [
                    "Unresolved concern flagged by adversarial review; "
                    "the synthesis needs an independent rebuttal."
                ]
            parsed_by_role[role["key"]] = review

    # Every call failed → deterministic fallback.
    if not parsed_by_role:
        return _fallback_result(
            topic, len(items), panel, prov_name, now_iso,
            note="all reviewer calls failed; returned neutral fallback review",
        )

    # ── Assemble reviewer rows (in panel order; fill gaps with fallbacks) ──
    reviewers: list[dict[str, Any]] = []
    for role in panel:
        review = parsed_by_role.get(role["key"])
        if review is not None:
            reviewers.append({
                "role": role["key"],
                "score": review["score"],
                "recommendation": review["recommendation"],
                "strengths": review["strengths"],
                "weaknesses": review["weaknesses"],
                "critical_concerns": review["critical_concerns"],
                "provenance": "reviewed",
            })
        else:
            # A single reviewer failed while others succeeded: neutral filler
            # so the panel size stays stable, but provenance marks it.
            reviewers.append({
                "role": role["key"],
                "score": 60,
                "recommendation": "major",
                "strengths": [],
                "weaknesses": ["reviewer did not return a usable review"],
                "critical_concerns": [],
                "provenance": "fallback",
            })

    # ── Synthesis ──
    mean_score = round(sum(r["score"] for r in reviewers) / len(reviewers), 1)
    decision = _decision_from_score(mean_score)

    # Any non-empty critical_concerns blocks an outright accept.
    critical_blocks = False
    any_critical = any(r["critical_concerns"] for r in reviewers)
    if any_critical and decision == "accept":
        decision = "minor_revision"
        critical_blocks = True

    # Dissent = reviewers recommending major / reject.
    dissent: list[dict[str, Any]] = []
    for r in reviewers:
        if r["recommendation"] in {"major", "reject"}:
            why = (r["critical_concerns"][0] if r["critical_concerns"]
                   else (r["weaknesses"][0] if r["weaknesses"]
                         else "recommended substantial revision"))
            dissent.append({
                "role": r["role"],
                "recommendation": r["recommendation"],
                "why": why,
            })

    return {
        "ok": True,
        "topic": topic,
        "n_items": len(items),
        "reviewers": reviewers,
        "mean_score": mean_score,
        "editorial_decision": decision,
        "critical_blocks": critical_blocks,
        "dissent": dissent,
        "provider": prov_name,
        "generated_at": now_iso,
    }
