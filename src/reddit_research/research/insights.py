"""Phase-1 Insight Engine — one long-context Claude call that produces a
structured market report from the full multi-source corpus.

Contrast with `gaps.py` (the legacy extractor pipeline):
  - gaps.py runs 4 separate LLM calls (painpoints / features / complaints / diy)
    on 50-post batches. Each call sees only a narrow slice.
  - insights.py packs ~1500-2000 posts across all source types into ONE call,
    asks Claude to SYNTHESIZE across sources, and returns a single coherent
    JSON report with opportunity scoring + competitor landscape + quadrant.

Spec: docs/specs/2026-04-20-insight-engine.md (Phase 1).
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any

from ..analyze.providers.base import resolve_provider
from ..core.db import get_db
from .corpus_format import format_corpus as _format_corpus
from .prompts import load_extractor


# Per-source sampling caps. Balances representation so Reddit's 80%+ post
# count doesn't drown academic papers or app-store reviews. Tuned for the
# ~200K-token budget (1M context capable but prompt caching is cheaper on
# smaller prompts). Env overrides let heavy users push limits up.
_PER_SOURCE_CAPS = {
    "reddit":        int(os.getenv("INSIGHTS_CAP_REDDIT", "80")),
    "hn":            int(os.getenv("INSIGHTS_CAP_HN", "40")),
    "appstore":      int(os.getenv("INSIGHTS_CAP_APPSTORE", "40")),
    "playstore":     int(os.getenv("INSIGHTS_CAP_PLAYSTORE", "40")),
    "arxiv":         int(os.getenv("INSIGHTS_CAP_ARXIV", "30")),
    "openalex":      int(os.getenv("INSIGHTS_CAP_OPENALEX", "20")),
    "pubmed":        int(os.getenv("INSIGHTS_CAP_PUBMED", "20")),
    "scholar":       int(os.getenv("INSIGHTS_CAP_SCHOLAR", "20")),
    "gnews":         int(os.getenv("INSIGHTS_CAP_GNEWS", "15")),
    "devto":         int(os.getenv("INSIGHTS_CAP_DEVTO", "15")),
    "stackoverflow": int(os.getenv("INSIGHTS_CAP_SO", "15")),
    "github":        int(os.getenv("INSIGHTS_CAP_GITHUB", "10")),
    "ingest":        int(os.getenv("INSIGHTS_CAP_INGEST", "30")),
    # Phase-4-era customer-feedback sources
    "trustpilot":    int(os.getenv("INSIGHTS_CAP_TRUSTPILOT", "40")),
    "producthunt":   int(os.getenv("INSIGHTS_CAP_PRODUCTHUNT", "25")),
    "alternativeto": int(os.getenv("INSIGHTS_CAP_ALTERNATIVETO", "15")),
}
# Hard upper bound on total selected posts — keeps token cost bounded even
# if every cap above is cranked up. Claude 4.7 (1M ctx) handles 2000
# comfortably; narrowed per-provider below.
_HARD_CAP = int(os.getenv("INSIGHTS_HARD_CAP", "2000"))

# Provider-adaptive corpus caps. Our full prompt at HARD_CAP=2000 is
# ~200K input tokens. Any provider with <200K context window needs a
# smaller slice OR we'll hit "context_length_exceeded" at runtime. These
# caps are conservative (target ≤ 50% of context window so response +
# system + user template + output still fit).
#
# Override any of these with INSIGHTS_HARD_CAP=N env var if you know
# your model can take more.
_PROVIDER_CAPS = {
    "anthropic":  2000,  # 1M ctx (Opus 4.7) — full budget
    "openai":     1500,  # GPT-4 128K ctx — still plenty
    # OpenRouter free tier caps prompt tokens ~16K. ~400 posts keeps
    # input under that. Paid users can bump via INSIGHTS_HARD_CAP=N.
    "openrouter":  400,
    "google":     2000,  # Gemini 1M+ ctx
    "groq":        300,  # ~32K ctx on most models
    "deepseek":    800,  # ~128K on DeepSeek-V3
    "mistral":     600,  # ~128K on large
    "ollama":      100,  # 8K–32K typical — small local models
}


def _cap_for_provider(provider: str) -> int:
    """Return the corpus cap appropriate for this provider's context window.
    Env override `INSIGHTS_HARD_CAP` wins if set — for power users with big
    local models (e.g. llama3.1:70b on a GPU with 128K context)."""
    env_override = os.getenv("INSIGHTS_HARD_CAP")
    if env_override and env_override.isdigit():
        return int(env_override)
    return _PROVIDER_CAPS.get(provider, 800)


def _select_corpus(topic: str, min_score: int = 0) -> list[dict[str, Any]]:
    """Pull a balanced sample of posts across source types for `topic`.

    Per-source ordering: (score + 2 × num_comments) DESC so high-engagement
    posts surface first. Academic sources (arxiv/openalex/pubmed/scholar)
    bypass the min_score filter because their native scores are meaningless
    (citation counts aren't populated in our schema).

    Returns list of dicts ready for `format_corpus`.
    """
    db = get_db()
    selected: list[dict[str, Any]] = []
    academic = {"arxiv", "openalex", "pubmed", "scholar"}

    # Get the distinct source types present for this topic first — avoids
    # running N SQL queries for sources we don't have data from.
    present = [
        r["src"] for r in db.query(
            "SELECT DISTINCT coalesce(p.source_type, 'reddit') AS src "
            "FROM topic_posts tp JOIN posts p ON p.id = tp.post_id "
            "WHERE tp.topic = ?",
            [topic],
        )
    ]

    for src in present:
        cap = _PER_SOURCE_CAPS.get(src, 15)
        # Academic sources: ignore score floor. Reddit: honour min_score.
        score_clause = "" if src in academic else "AND p.score >= :min_score"
        rows = list(db.query(
            f"""
            SELECT p.id, p.sub, p.author, p.title,
                   substr(p.selftext, 1, 600) AS selftext,
                   p.score, p.num_comments, p.created_utc,
                   coalesce(p.source_type, 'reddit') AS source_type
            FROM topic_posts tp
            JOIN posts p ON p.id = tp.post_id
            WHERE tp.topic = :topic
              AND coalesce(p.source_type, 'reddit') = :src
              {score_clause}
            ORDER BY (coalesce(p.score,0) + 2 * coalesce(p.num_comments,0)) DESC
            LIMIT :cap
            """,
            {"topic": topic, "src": src, "min_score": min_score, "cap": cap},
        ))
        selected.extend(rows)

    # Apply hard cap on the union. Keeps highest-score posts across sources.
    if len(selected) > _HARD_CAP:
        selected.sort(
            key=lambda r: (r.get("score") or 0) + 2 * (r.get("num_comments") or 0),
            reverse=True,
        )
        selected = selected[:_HARD_CAP]

    return selected


def _parse_insight_json(raw: str) -> dict:
    """Parse Claude's JSON output with truncation-recovery.

    Handles three realities:
      1. Clean JSON (normal case) — direct json.loads.
      2. Code-fenced + preamble — strip fences, find first `{`.
      3. Truncated output (free-tier LLMs cut off mid-string) — attempt
         progressive trimming: peel back character-by-character looking
         for a balanced `}` that parses. Recovers however much of the
         schema landed before the cutoff; the rest of the fields are
         just absent and the UI degrades gracefully.
    """
    cleaned = raw.strip()
    for fence in ("```json", "```"):
        if cleaned.startswith(fence):
            cleaned = cleaned[len(fence):].lstrip()
    if cleaned.endswith("```"):
        cleaned = cleaned[:-3].rstrip()
    if not cleaned.startswith("{"):
        brace = cleaned.find("{")
        if brace >= 0:
            cleaned = cleaned[brace:]

    # Fast path — clean JSON
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass

    # Recovery path — trim from the end until we find a balanced, parseable
    # prefix. Most truncations end mid-string or mid-array inside a deeply-
    # nested field (findings[5].narrative). Closing the brackets on the
    # spot almost always recovers findings[0..4] intact.
    recovered = _try_recover_truncated_json(cleaned)
    if recovered is not None:
        recovered["_truncated"] = True
        return recovered

    try:
        return json.loads(cleaned)  # re-raise with same error for diagnostics
    except json.JSONDecodeError as e:
        return {"_parse_error": True, "_raw": raw[:2000], "_error": str(e)}


def _try_recover_truncated_json(s: str) -> dict | None:
    """Attempt to recover a truncated JSON object.

    Strategy: for each possible cut-point from end toward start, try
    closing any open strings/arrays/objects and parsing. Return the first
    successful parse. Caps work at 50 attempts so a garbage string fails
    fast instead of iterating 10000 chars.
    """
    if not s.strip().startswith("{"):
        return None
    # Try cutting at promising boundaries first — commas and brackets —
    # before falling back to arbitrary character positions.
    # Candidates: every index where s[i] is in ',' ']' '}'
    boundaries = [i for i, ch in enumerate(s) if ch in ',]}]']
    boundaries.reverse()  # try from end inward
    for cut in boundaries[:50]:
        prefix = s[: cut + 1]
        candidate = _balance_json(prefix)
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            continue
    return None


def _balance_json(s: str) -> str:
    """Close any open strings, arrays, and objects in `s` so it parses
    as valid JSON. Best-effort — doesn't fix invalid syntax inside, only
    missing closing brackets at the tail."""
    in_str = False
    escape = False
    stack: list[str] = []
    for ch in s:
        if escape:
            escape = False
            continue
        if ch == "\\" and in_str:
            escape = True
            continue
        if ch == '"':
            in_str = not in_str
            continue
        if in_str:
            continue
        if ch == "{":
            stack.append("}")
        elif ch == "[":
            stack.append("]")
        elif ch in "]}":
            if stack and stack[-1] == ch:
                stack.pop()
    out = s
    # Close an open string first
    if in_str:
        out = out + '"'
    # Trim dangling comma before closing
    out = out.rstrip()
    if out.endswith(","):
        out = out[:-1]
    # Close containers LIFO
    while stack:
        out += stack.pop()
    return out


def _ensure_topic_insights_table() -> None:
    """One row per topic, overwritten on re-run. Schema mirrors spec Phase 1."""
    db = get_db()
    if "topic_insights" in db.table_names():
        return
    db["topic_insights"].create(
        {
            "topic": str,
            "report_json": str,
            "generated_at": str,
            "corpus_size": int,
            "provider": str,
            "model": str,
        },
        pk="topic",
    )


def _persist(topic: str, report: dict, provider: str, model: str, corpus_size: int) -> None:
    _ensure_topic_insights_table()
    db = get_db()
    db["topic_insights"].upsert(
        {
            "topic": topic,
            "report_json": json.dumps(report, ensure_ascii=False, default=str),
            "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "corpus_size": corpus_size,
            "provider": provider,
            "model": model,
        },
        pk="topic",
    )


def synthesize_insights(
    topic: str,
    provider: str | None = None,
    persist: bool = True,
    min_score: int = 0,
) -> dict[str, Any]:
    """Run the one-shot synthesis call and return the parsed report.

    Graceful-skip when no LLM is configured (returns `{ok:False, skipped:True,
    reason}`) so the UI never raises on an unconfigured collect.
    """
    try:
        provider = resolve_provider(provider)
    except RuntimeError as e:
        return {
            "ok": False, "skipped": True, "topic": topic,
            "reason": str(e),
        }

    rows = _select_corpus(topic, min_score=min_score)
    if not rows:
        return {
            "ok": False,
            "topic": topic,
            "error": f"No corpus for topic={topic!r}. Run `research collect` first.",
        }

    # Trim corpus to what the provider's context window can swallow.
    # Keeps highest-engagement posts; drops the long tail that small
    # models would truncate anyway. See `_cap_for_provider` for rationale.
    provider_cap = _cap_for_provider(provider)
    if len(rows) > provider_cap:
        rows.sort(
            key=lambda r: (r.get("score") or 0) + 2 * (r.get("num_comments") or 0),
            reverse=True,
        )
        rows = rows[:provider_cap]

    ext = load_extractor("insights_synthesis")
    sources_present = sorted({r.get("source_type") or "reddit" for r in rows})
    corpus_text = _format_corpus(rows)
    user_prompt = ext["user_template"].format(
        topic=topic,
        corpus=corpus_text,
        corpus_size=len(rows),
        source_count=len(sources_present),
    )

    # Adaptive max_tokens per provider. Phase-2's richer JSON schema
    # (Minto + hypothesis cards + disconfirming_evidence) wants ~12000
    # tokens of output budget on paid tiers, but free-tier OpenRouter
    # accounts cap well below that (observed: 2681). Rather than fail
    # hard, we:
    #   1. Pick a provider-appropriate max_tokens ceiling
    #   2. Auto-retry with 2x smaller budget on 402/credit errors
    # The LLM may truncate the JSON at smaller budgets, but `format:json`
    # (Ollama) + Claude's tolerance for partial JSON usually still
    # produces a usable report. See OLLAMA_CORPUS_LIMIT-style env override.
    from ..analyze.providers.base import get_provider
    prov = get_provider(provider)
    # Default budget per provider. Paid-account users can override via
    # INSIGHTS_MAX_TOKENS. Free-tier OpenRouter gets the smallest budget.
    provider_budget = {
        "anthropic":  12000,
        "openai":     10000,
        "google":     12000,
        "openrouter":  4000,   # free tier cap ≈ 2681; 4000 is safe for $5 credit
        "groq":        4000,
        "deepseek":    8000,
        "mistral":     6000,
        "ollama":      6000,
    }.get(provider, 6000)
    try:
        provider_budget = int(os.getenv("INSIGHTS_MAX_TOKENS") or provider_budget)
    except ValueError:
        pass

    def _complete(max_tokens: int):
        return prov.complete(
            prompt=user_prompt,
            system=ext["system"],
            max_tokens=max_tokens,
            temperature=0.2,
        )

    raw = None
    last_err = None
    # Two-dimensional retry:
    #   • output budget (max_tokens): shrink on 402 / credit errors
    #   • input size (corpus rows):   shrink on "prompt tokens limit exceeded"
    # Each retry halves whichever dimension caused the failure.
    budgets = [provider_budget, max(2000, provider_budget // 2), 2000]
    current_rows = rows
    for attempt_budget in budgets:
        try:
            raw = _complete(attempt_budget)
            break
        except Exception as e:
            last_err = str(e).lower()
            # Output-budget overflow → try smaller max_tokens next iter
            if any(kw in last_err for kw in ("fewer max", "token limit", "you requested up to")):
                continue
            # Input-size overflow → halve corpus and re-format the user prompt
            if any(kw in last_err for kw in ("prompt tokens", "context length", "input too long", "too many tokens")):
                current_rows = current_rows[: max(50, len(current_rows) // 2)]
                user_prompt = ext["user_template"].format(
                    topic=topic,
                    corpus=_format_corpus(current_rows),
                    corpus_size=len(current_rows),
                    source_count=len(sources_present),
                )
                continue
            # Credit error (no retry helps if the plan is exhausted) — bail fast
            if "402" in last_err or "credits" in last_err:
                # But try one more time with smallest budget in case it's max_tokens not prompt
                continue
            # Any other error — network, auth, parsing — bail
            break
    if raw is None:
        err_str = str(last_err or "unknown")
        hint = ""
        if "402" in err_str or "credits" in err_str:
            hint = " — add credits at your provider, or switch to a free one (Ollama / Groq)"
        elif "prompt tokens" in err_str or "context length" in err_str:
            hint = f" — corpus still too large for this model's context window; set INSIGHTS_HARD_CAP to a smaller value"
        return {"ok": False, "topic": topic, "error": f"LLM call failed: {err_str[:200]}{hint}"}

    report = _parse_insight_json(raw)
    if report.get("_parse_error"):
        return {
            "ok": False,
            "topic": topic,
            "error": f"Failed to parse LLM JSON: {report.get('_error')}",
            "raw_preview": report.get("_raw", "")[:500],
        }

    # Stamp metadata from the pipeline — Claude sometimes omits corpus_coverage
    # despite the schema, so we overwrite with ground truth.
    report["corpus_coverage"] = {
        "total_posts_considered": len(rows),
        "sources_represented": sources_present,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    report["ok"] = True
    report["topic"] = topic
    report["provider"] = provider

    # Phase-2 post-processing: Ulwick scoring, credible intervals, Popper
    # validation on hypothesis cards. Total_corpus is the `rows` count we
    # actually sent to the LLM — drives the Bayesian CI math.
    _normalize_scores(report, total_corpus=len(rows))

    if persist:
        model = os.getenv("LLM_MODEL") or getattr(prov, "_model", "") or ""
        _persist(topic, report, provider, model, len(rows))

    return report


def _normalize_scores(report: dict, total_corpus: int = 0) -> None:
    """Phase-2 post-processing of the synthesis report.

    Responsibilities:
      1. Clamp Ulwick importance/satisfaction to 1-10 and re-derive
         opportunity_score = importance + max(importance - satisfaction, 0)
         (range 0-20) when the model returns nonsense or out-of-range.
      2. Clamp competitor_coverage to 0-1.
      3. Derive triangulation_strength from source_breakdown if the LLM
         forgot to include it.
      4. Attach a Bayesian credible interval to every finding — replaces
         a raw evidence count with "87% CI: X%-Y% of the corpus".
      5. Validate hypothesis cards against Popper's criterion — no
         falsifiers → drop the card with a warning in `_dropped_hypotheses`.
      6. Backward-compat: older reports in `topic_insights` used
         `pain_weight` (0-10). If the new report doesn't include it but
         does include `importance`, mirror the old field for UI shims.
    """
    findings = report.get("findings") or []
    for f in findings:
        # Ulwick scoring
        imp = _clamp(f.get("importance"), 1, 10, default=5.0)
        sat = _clamp(f.get("satisfaction"), 1, 10, default=5.0)
        # Ulwick formula (0-20 scale). Users want: high importance + low
        # satisfaction → high opportunity. Overserved or unimportant → low.
        opp_raw = f.get("opportunity_score")
        if (not isinstance(opp_raw, (int, float))) or opp_raw < 0 or opp_raw > 20:
            opp = imp + max(imp - sat, 0.0)
        else:
            opp = float(opp_raw)
        cc = _clamp(f.get("competitor_coverage"), 0.0, 1.0, default=0.5)
        f["importance"] = round(imp, 1)
        f["satisfaction"] = round(sat, 1)
        f["opportunity_score"] = round(_clamp(opp, 0, 20, default=imp), 1)
        f["competitor_coverage"] = round(cc, 2)
        # Legacy mirror — earlier UIs render `pain_weight` in some places.
        # Derive from importance so those views still work.
        if "pain_weight" not in f:
            f["pain_weight"] = round(imp, 1)

        # Triangulation strength — derive from source_breakdown if missing
        if not f.get("triangulation_strength"):
            diversity = len([v for v in (f.get("source_breakdown") or {}).values() if v > 0])
            f["triangulation_strength"] = (
                "strong" if diversity >= 3 else "moderate" if diversity == 2 else "narrow"
            )
        f["source_diversity"] = len([
            v for v in (f.get("source_breakdown") or {}).values() if v > 0
        ])

        # Credible interval on evidence prevalence. Treat evidence_post_ids
        # length as "successes", total_corpus as "trials". 87% CI follows
        # the methodology doc's example (Guest/Bunce convention).
        ev_n = len(f.get("evidence_post_ids") or [])
        if total_corpus > 0 and ev_n > 0:
            lo, hi = _credible_interval(ev_n, total_corpus, confidence=0.87)
            f["evidence_prevalence_ci"] = {
                "lower_pct": round(lo * 100, 1),
                "upper_pct": round(hi * 100, 1),
                "n": ev_n,
                "of": total_corpus,
                "confidence": 0.87,
            }

    # Hypothesis card validation — Popper's criterion.
    # Drop cards without measurable falsifiers; remember why for UI surfacing.
    kept_hypotheses = []
    dropped = []
    for h in report.get("hypotheses") or []:
        errors = _validate_hypothesis(h)
        if errors:
            dropped.append({"hypothesis": h, "errors": errors})
            continue
        # Clamp sane time_box + budget defaults
        try:
            h["time_box_days"] = max(3, min(30, int(h.get("time_box_days") or 14)))
        except (TypeError, ValueError):
            h["time_box_days"] = 14
        try:
            h["budget_usd"] = max(0, int(h.get("budget_usd") or 100))
        except (TypeError, ValueError):
            h["budget_usd"] = 100
        kept_hypotheses.append(h)
    report["hypotheses"] = kept_hypotheses
    if dropped:
        report["_dropped_hypotheses"] = dropped


def _clamp(v: Any, lo: float, hi: float, default: float) -> float:
    try:
        fv = float(v)
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, fv))


def _credible_interval(
    successes: int, total: int, confidence: float = 0.87
) -> tuple[float, float]:
    """Beta-binomial posterior credible interval.

    Replaces raw "N=14" counts with honest statements like "87% CI:
    5.2%–11.8% of relevant posts mention this." Uses Jeffreys prior
    (Beta(0.5, 0.5)) implicit in the Beta(successes+1, total-successes+1)
    parametrisation — fine for moderate N, conservative at tails.

    Returns (lower, upper) as proportions in [0, 1]. If scipy isn't
    available, degrade gracefully to a simple Wald-style approximation
    so the feature still works in minimal installs.
    """
    if total <= 0 or successes < 0:
        return (0.0, 0.0)
    try:
        from scipy.stats import beta as _beta
    except ImportError:
        # Fallback: symmetric interval around p_hat, width inversely scaling
        # with sqrt(N). Less accurate at the tails but good enough for UI.
        import math
        p = successes / total
        half = 1.96 * math.sqrt(max(p * (1 - p), 0.01) / total)
        return (max(0.0, p - half), min(1.0, p + half))
    a = successes + 1
    b = total - successes + 1
    lo = float(_beta.ppf((1 - confidence) / 2, a, b))
    hi = float(_beta.ppf(1 - (1 - confidence) / 2, a, b))
    return (lo, hi)


def _validate_hypothesis(h: dict) -> list[str]:
    """Popper's criterion: no falsifier → not a hypothesis.

    Returns list of validation errors (empty = valid). Called by
    `_normalize_scores` to drop invalid cards rather than surfacing them.
    We keep dropped cards in `_dropped_hypotheses` so the UI can show a
    "the LLM tried to propose this but didn't give a falsifier — dropped"
    hint for transparency.
    """
    errors: list[str] = []
    if not h.get("we_believe") or not h.get("experiences") or not h.get("for"):
        errors.append("missing core fields (we_believe / experiences / for)")
    falsifiers = h.get("falsifiers") or []
    if not isinstance(falsifiers, list) or len(falsifiers) == 0:
        errors.append("FATAL: no falsifiers — fails Popper's criterion")
    elif not all(isinstance(f, str) and len(f.strip()) > 5 for f in falsifiers):
        errors.append("falsifier entries too short or non-text")
    if not h.get("cheapest_test"):
        errors.append("missing cheapest_test — lean-startup cycle needs a concrete experiment")
    return errors


def load_insights(topic: str) -> dict | None:
    """Fetch the cached insight report for a topic. None if never generated."""
    _ensure_topic_insights_table()
    db = get_db()
    rows = list(db.query(
        "SELECT report_json, generated_at, corpus_size, provider, model "
        "FROM topic_insights WHERE topic = ?",
        [topic],
    ))
    if not rows:
        return None
    r = rows[0]
    try:
        report = json.loads(r["report_json"])
    except Exception:
        return None
    report["_cached"] = True
    report["_generated_at"] = r.get("generated_at")
    report["_corpus_size"] = r.get("corpus_size")
    report["_provider"] = r.get("provider")
    report["_model"] = r.get("model")
    return report


__all__ = ["synthesize_insights", "load_insights", "_select_corpus"]
