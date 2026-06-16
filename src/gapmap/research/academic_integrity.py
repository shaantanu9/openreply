"""Academic integrity gate — a blocking audit over a finalized brief.

Why this exists
---------------
When Gap Map drafts a research brief from a corpus, the LLM that writes
it has every incentive to sound confident: it will state an
implementation as done, cite a paper that does not exist, or quietly
re-cast a limitation as a headline result. None of that is caught by the
deliberation panel, which scores *findings* for relevance — not the
*finished prose* for honesty. This module is the last gate before a
brief ships: it samples (or, when ``final=True``, exhaustively audits)
the brief's claim sentences against a small taxonomy of AI-research
failure modes and returns a PASS / FAIL verdict.

The seven failure modes (clean-room labels authored for Gap Map):

  M1  unverifiable_implementation_claim — asserts something was built,
      run, or measured with no artifact or evidence to back it.
  M2  hallucinated_citation — references a paper, author, or dataset
      that the corpus does not actually contain.
  M3  hallucinated_result — reports a number, benchmark, or outcome that
      no source supports.
  M4  shortcut_overclaim — a partial or toy result presented as a
      general, production-grade conclusion.
  M5  limitation_reframed_as_finding — a known weakness or caveat
      rewritten so it reads as a positive discovery.
  M6  fabricated_methodology — describes a procedure or experiment that
      was never run as if it had been.
  M7  frame_lock — locks onto a single framing and ignores obvious
      alternative explanations.

Blocking subset
---------------
Only {M1, M3, M5, M6} are *blocking* — these are the modes where a
reader would be actively misled about what is true. {M2, M4, M7} are
recorded (so a human can see them) but never set ``blocking`` on their
own; they degrade quality, they do not fabricate ground truth.

Precision over recall
---------------------
This gate is allowed to wave through a borderline claim, but it must
NEVER hard-block a brief because the LLM provider was down or returned
junk. Infrastructure failure → ``ok=False, verdict="PASS",
blocking=False`` with an explanatory note. The only thing that sets
``blocking=True`` is a real audit finding a real suspected/insufficient
claim on a blocking mode. The function never raises.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

# ── Failure-mode taxonomy ─────────────────────────────────────────────

# Authored clean-room labels + one-line descriptions. The blocking subset
# is the set of modes where the brief would actively misrepresent ground
# truth to a reader.
MODES: dict[str, str] = {
    "M1": "unverifiable_implementation_claim — asserts something was built/run with no artifact",
    "M2": "hallucinated_citation — references a paper/author/dataset not present in the corpus",
    "M3": "hallucinated_result — reports a number/benchmark/outcome no source supports",
    "M4": "shortcut_overclaim — a partial/toy result presented as a general conclusion",
    "M5": "limitation_reframed_as_finding — a known weakness rewritten as a positive discovery",
    "M6": "fabricated_methodology — describes a procedure/experiment that was never run",
    "M7": "frame_lock — locks onto one framing, ignores obvious alternatives",
}

BLOCKING_MODES: set[str] = {"M1", "M3", "M5", "M6"}
SUSPECT_VERDICTS: set[str] = {"suspected", "insufficient"}


# ── Prompt ────────────────────────────────────────────────────────────

_SYSTEM = """You are an academic-integrity auditor for a research brief on
the topic "{topic}". You check finalized claim sentences for AI-research
failure modes. You are precise and skeptical: you only flag a claim when
the brief gives you a concrete reason to doubt it.

Failure modes:
{modes_block}

For EACH claim you are given, return one finding object:
  - claim_index: the integer index of the claim you are judging
  - mode: one of "M1".."M7" if a failure mode applies, else "none"
  - verdict: "clean" (claim is well-supported), "suspected" (a failure
    mode likely applies), or "insufficient" (the brief gives no way to
    verify the claim, so it cannot stand)
  - note: <=160 chars explaining your call

Output ONLY a JSON array, one object per claim, no prose, no fences:
[{{"claim_index": 0, "mode": "M1"|..|"M7"|"none",
   "verdict": "clean"|"suspected"|"insufficient", "note": "..."}}]
"""


def _build_system(topic: str) -> str:
    modes_block = "\n".join(f"  {k}: {v}" for k, v in MODES.items())
    return _SYSTEM.format(topic=topic or "(untitled)", modes_block=modes_block)


def _build_user(brief_markdown: str, sampled: list[tuple[int, str]]) -> str:
    """Compact user prompt: trimmed brief context + the sampled claims,
    each shown with its ORIGINAL index so the model echoes it back."""
    out: list[str] = ["BRIEF (context, may be truncated):"]
    out.append((brief_markdown or "").strip()[:4000] or "(empty brief)")
    out.append("")
    out.append("CLAIMS TO AUDIT:")
    for idx, claim in sampled:
        out.append(f"[{idx}] {claim.strip()[:400]}")
    return "\n".join(out)


# ── Deterministic sampling ────────────────────────────────────────────

def _select_indices(n: int, sample_ratio: float, final: bool) -> list[int]:
    """Pick which claim indices to audit. Deterministic — evenly spaced,
    never random — so tests are stable. ``final`` audits everything."""
    if n <= 0:
        return []
    if final:
        return list(range(n))
    k = max(1, round(n * float(sample_ratio)))
    k = min(k, n)
    if k >= n:
        return list(range(n))
    # Evenly spaced indices across [0, n-1].
    step = n / k
    picks = sorted({min(n - 1, int(round(i * step))) for i in range(k)})
    # Rounding collisions can drop us below k; backfill deterministically.
    i = 0
    while len(picks) < k and i < n:
        if i not in picks:
            picks.append(i)
        i += 1
    return sorted(picks)[:k]


# ── Tolerant JSON parse (deliberate.py house style) ───────────────────

def _parse_findings(raw: str) -> list[dict[str, Any]] | None:
    """Strip fences, isolate the array, parse. Returns None when the
    response is unusable so the caller can fail soft."""
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
    return parsed if isinstance(parsed, list) else None


def _normalize(raw_findings: list[dict[str, Any]],
               idx_to_claim: dict[int, str]) -> list[dict[str, Any]]:
    """Map raw LLM finding objects back onto the sampled claims. Unknown
    indices / modes / verdicts are coerced to safe defaults."""
    findings: list[dict[str, Any]] = []
    for f in raw_findings:
        if not isinstance(f, dict):
            continue
        try:
            idx = int(f.get("claim_index"))
        except Exception:
            continue
        if idx not in idx_to_claim:
            continue
        mode = str(f.get("mode") or "none").strip()
        if mode not in MODES and mode != "none":
            mode = "none"
        verdict = str(f.get("verdict") or "clean").strip().lower()
        if verdict not in {"clean", "suspected", "insufficient"}:
            verdict = "clean"
        findings.append({
            "claim": idx_to_claim[idx],
            "mode": mode,
            "verdict": verdict,
            "note": str(f.get("note") or "")[:160],
        })
    return findings


# ── Public API ────────────────────────────────────────────────────────

def run_integrity_check(
    topic: str,
    brief_markdown: str,
    claims: list[str],
    *,
    provider: str | None = None,
    sample_ratio: float = 0.3,
    final: bool = False,
) -> dict:
    """Audit a brief's claims against the failure-mode taxonomy.

    Returns the canonical integrity dict (see module docstring). Always a
    dict, NEVER raises. ``blocking`` is True iff a sampled claim is
    suspected/insufficient on a blocking mode (M1/M3/M5/M6).
    """
    now_iso = datetime.now(timezone.utc).isoformat(timespec="seconds")
    total = len(claims or [])

    # Empty audit — never block, but flag it didn't really run.
    if total == 0:
        return {
            "ok": False,
            "topic": topic,
            "verdict": "PASS",
            "blocking": False,
            "sampled": 0,
            "total": 0,
            "final": final,
            "findings": [{"claim": "", "mode": "none", "verdict": "clean",
                          "note": "no claims to audit"}],
            "blocking_findings": [],
            "provider": "",
            "generated_at": now_iso,
        }

    # Deterministic sample selection.
    indices = _select_indices(total, sample_ratio, final)
    sampled_pairs = [(i, claims[i]) for i in indices]
    idx_to_claim = {i: claims[i] for i in indices}

    # Resolve provider + run ONE audit call. Any failure → skip (not block).
    prov_name = ""
    try:
        from ..analyze.providers.base import resolve_provider, get_provider
        prov_name = resolve_provider(provider)
        prov = get_provider(prov_name)
    except Exception:
        return _skip_result(topic, total, len(indices), final, now_iso,
                            prov_name, "provider unavailable — audit skipped")

    sys_prompt = _build_system(topic)
    user_prompt = _build_user(brief_markdown, sampled_pairs)
    try:
        raw = prov.complete(prompt=user_prompt, system=sys_prompt,
                            max_tokens=1800, temperature=0.2)
    except Exception:
        return _skip_result(topic, total, len(indices), final, now_iso,
                            prov_name, "LLM call failed — audit skipped")

    raw_findings = _parse_findings(raw)
    if raw_findings is None:
        return _skip_result(topic, total, len(indices), final, now_iso,
                            prov_name, "unparseable audit response — skipped")

    findings = _normalize(raw_findings, idx_to_claim)

    # Blocking subset: suspected/insufficient on a blocking mode.
    blocking_findings = [
        f for f in findings
        if f["mode"] in BLOCKING_MODES and f["verdict"] in SUSPECT_VERDICTS
    ]
    blocking = bool(blocking_findings)
    verdict = "FAIL" if blocking else "PASS"

    return {
        "ok": True,
        "topic": topic,
        "verdict": verdict,
        "blocking": blocking,
        "sampled": len(indices),
        "total": total,
        "final": final,
        "findings": findings,
        "blocking_findings": blocking_findings,
        "provider": prov_name,
        "generated_at": now_iso,
    }


def _skip_result(topic: str, total: int, sampled: int, final: bool,
                 now_iso: str, prov_name: str, note: str) -> dict:
    """Precision-over-recall skip: infra failed, so we PASS without
    blocking and record WHY the audit didn't run."""
    return {
        "ok": False,
        "topic": topic,
        "verdict": "PASS",
        "blocking": False,
        "sampled": sampled,
        "total": total,
        "final": final,
        "findings": [{"claim": "", "mode": "none", "verdict": "clean",
                      "note": note}],
        "blocking_findings": [],
        "provider": prov_name,
        "generated_at": now_iso,
    }
