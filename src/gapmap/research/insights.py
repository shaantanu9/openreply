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


def _attach_suggested_tactics(report: dict[str, Any]) -> None:
    """Attach top persuasion tactics per finding (best-effort)."""
    findings = report.get("findings")
    if not isinstance(findings, list) or not findings:
        return
    try:
        from .tactic_library import find_matching_tactics, seed_from_json
        # Idempotent seed call; makes sure fresh installs have baseline tactics.
        seed_from_json()
    except Exception:
        return
    for f in findings:
        if not isinstance(f, dict):
            continue
        text = " ".join(
            [
                str(f.get("title") or ""),
                str(f.get("narrative") or ""),
                str(f.get("best_quote") or ""),
            ]
        ).strip()
        if not text:
            continue
        try:
            tactics = find_matching_tactics(text, k=5)
        except Exception:
            tactics = []
        if not tactics:
            continue
        f["suggested_tactics"] = tactics[:2]
        # Keep a JSON-serializable mirror for downstream UI contracts.
        f["suggested_tactics_json"] = json.dumps(f["suggested_tactics"], ensure_ascii=False)


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
    academic = {"arxiv", "openalex", "pubmed", "scholar", "semantic_scholar", "crossref", "europepmc"}

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
    deliberate: bool = False,
    deliberate_rounds: int = 1,
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

    # AG-C T2.4 — inject user feedback as a negative-examples block so
    # the LLM doesn't re-surface findings the user already flagged as
    # wrong / off-topic / spam. Best-effort: failures here never block
    # synthesis (e.g. finding_feedback table absent in legacy DBs).
    try:
        from .feedback import feedback_for_prompt
        fb = feedback_for_prompt(topic=topic, limit=10)
        neg_lines: list[str] = []
        for verdict, titles in fb.items():
            for t in titles:
                neg_lines.append(f'- "{t}" — user marked as {verdict}')
        if neg_lines:
            user_prompt = (
                user_prompt
                + "\n\n## Previously-flagged mistakes on this topic — DO NOT repeat\n"
                + "\n".join(neg_lines)
            )
    except Exception:
        pass

    # Graph context — inject top-ranked knowledge-graph nodes for this topic
    # so the LLM sees the structural topology (pain-points, interventions,
    # competitors already identified) before synthesising findings. Best-effort:
    # silently skips when graph is empty or the table doesn't exist yet.
    try:
        from ..core.db import get_db as _get_db
        _db = _get_db()
        if "graph_nodes" in _db.table_names():
            _grows = list(_db.query(
                """
                SELECT n.id, n.kind, n.label,
                       (SELECT count(*) FROM graph_edges e
                        WHERE e.topic = n.topic
                          AND (e.src = n.id OR e.dst = n.id)) AS degree
                FROM graph_nodes n
                WHERE n.topic = ?
                ORDER BY degree DESC LIMIT 20
                """,
                [topic],
            ))
            if _grows:
                _glines = [
                    f"[{r['kind']}] {r['label']} (degree={r['degree']})"
                    for r in _grows
                ]
                user_prompt = (
                    user_prompt
                    + "\n\n## Knowledge Graph — top nodes already identified\n"
                    + "\n".join(_glines)
                    + "\nUse these to cross-check your findings and avoid duplicating known nodes."
                )
    except Exception:
        pass

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
    # Each retry halves whichever dimension caused the failure. The final
    # floor is 300 rather than 2000 so a credit-capped provider (OpenRouter
    # free tier with <500 tokens remaining) can still get one last try.
    budgets = [provider_budget, max(2000, provider_budget // 2), 2000, 300]
    current_rows = rows
    import re as _re
    for attempt_budget in budgets:
        try:
            raw = _complete(attempt_budget)
            break
        except Exception as e:
            last_err = str(e).lower()
            # Output-budget overflow → try smaller max_tokens next iter.
            # OpenRouter specifically reports "can only afford N" — parse that
            # number and retry with exactly that budget minus a safety margin.
            afford = _re.search(r"can only afford\s+(\d+)", last_err)
            if afford:
                try:
                    exact = max(100, int(afford.group(1)) - 20)
                    raw = _complete(exact)
                    break
                except Exception as ee:
                    last_err = str(ee).lower()
                    # fall through to generic 402 path below
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
        err_code = None
        hint = ""
        if "402" in err_str or "credits" in err_str:
            err_code = "credits_exhausted"
            hint = " — your provider is out of credits. Add credits, or switch to a free local provider (Ollama) in Settings → AI Keys."
        elif "401" in err_str or "invalid api" in err_str or "unauthorized" in err_str:
            err_code = "invalid_key"
            hint = " — the API key appears invalid. Re-save it in Settings → AI Keys."
        elif "prompt tokens" in err_str or "context length" in err_str:
            err_code = "context_overflow"
            hint = " — corpus still too large for this model's context window; set INSIGHTS_HARD_CAP to a smaller value."
        return {
            "ok": False,
            "topic": topic,
            "error": f"LLM call failed: {err_str[:200]}{hint}",
            "error_code": err_code,
            "provider": provider,
        }

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

    # Relevance gate on findings — drops hallucinated / off-topic findings
    # the LLM produced from garbage corpus (see research/relevance.py). Uses
    # ChromaDB MiniLM to score each finding.title against the topic and drops
    # anything below GAPMAP_FINDING_RELEVANCE_THRESHOLD (default 0.40).
    # Precision-leaning so we don't drop real findings on borderline semantic
    # distance — only clearly off-topic ones.
    try:
        threshold = float(os.getenv("GAPMAP_FINDING_RELEVANCE_THRESHOLD", "0.40"))
    except (TypeError, ValueError):
        threshold = 0.40
    if threshold > 0 and isinstance(report.get("findings"), list):
        try:
            from .relevance import filter_findings
            gate = filter_findings(topic, report["findings"], threshold=threshold)
            if gate.get("ok") and not gate.get("skipped"):
                report["findings"] = gate["kept"]
                if gate.get("dropped"):
                    report["_relevance_dropped_findings"] = gate["dropped"]
                    report["_relevance_dropped_count"] = gate["dropped_count"]
                    report["_relevance_threshold"] = threshold
        except Exception as e:
            report["_relevance_gate_error"] = str(e)

    _attach_suggested_tactics(report)

    # Per-topic best-config override for deliberate (2026-05-03 Phase 4).
    # When `iterate.apply_best_config(run_id)` was called for this
    # topic + 'deliberate' loop, those values override the caller's
    # request unless the caller explicitly passed non-default values.
    if deliberate:
        try:
            from . import iterate as _it
            applied = _it.get_applied_config(topic, "deliberate")
            if applied and isinstance(applied.get("config"), dict):
                cfg = applied["config"]
                if deliberate_rounds == 1 and "rounds" in cfg:
                    deliberate_rounds = int(cfg["rounds"])
        except Exception:
            pass

    # Phase 3 (2026-05-03) — optional 5-persona deliberation.
    # When `deliberate=True`, every finding is reviewed by the 5 personas
    # (Synthesizer / Skeptic / Quantifier / Risk Officer / Devil's
    # Advocate) plus the topic's audience clusters; each lands tagged
    # Confirmed / Probable / Minority / Discarded. The discard tier is
    # NOT pruned from `findings` — callers can filter on
    # `f["consensus"]["tier"]` instead, so we never silently drop signal.
    if deliberate and isinstance(report.get("findings"), list) and report["findings"]:
        try:
            from .deliberate import deliberate as _run_deliberation
            d = _run_deliberation(
                report["findings"],
                topic=topic,
                rounds=deliberate_rounds,
                provider=provider,
                use_llm=True,
                persist_log=True,
            )
            # Build a fast lookup so we can stamp `consensus` onto each
            # finding by index. The deliberate engine returns tier
            # buckets; flatten them and re-zip into the original list
            # ordering.
            stamped: dict[int, dict[str, Any]] = {}
            for tier_items in d.get("tiers", {}).values():
                for it in tier_items:
                    cons = it.get("consensus")
                    # Match by title — the deliberate engine doesn't
                    # carry an external ID. Title duplicates would be
                    # caught by the Synthesizer persona's DISPUTE.
                    title = (it.get("title") or it.get("label") or "").strip()
                    for i, f in enumerate(report["findings"]):
                        if (f.get("title") or f.get("label") or "").strip() == title and i not in stamped:
                            stamped[i] = cons
                            break
            for i, f in enumerate(report["findings"]):
                if i in stamped:
                    f["consensus"] = stamped[i]
            report["deliberation"] = {
                "rounds": d.get("rounds"),
                "personas_used": d.get("personas_used"),
                "audience_grounded": d.get("audience_grounded"),
                "counts": d.get("counts"),
                "provider": d.get("provider"),
                "generated_at": d.get("generated_at"),
            }
        except Exception as e:
            report["deliberation_error"] = str(e)[:200]

    if persist:
        model = os.getenv("LLM_MODEL") or getattr(prov, "_model", "") or ""
        _persist(topic, report, provider, model, len(rows))

    # Mandatory unified-log row so the GUI's AI Analyses tab (and any MCP
    # client querying mcp_analyses) picks up this run regardless of who
    # triggered it. Best-effort — never block the pipeline on a log failure.
    try:
        from ..core.db import save_mcp_analysis
        save_mcp_analysis(
            topic=topic, source="app", kind="insights",
            tool="synthesize_insights",
            content=json.dumps(report, ensure_ascii=False, default=str),
            content_type="json",
            provider=provider,
            model=os.getenv("LLM_MODEL") or getattr(prov, "_model", "") or "",
            params={"corpus_size": len(rows), "min_score": min_score},
        )
    except Exception:
        pass

    return report


# ─────────────────────────────────────────────────────────── chunked synth ──


# Provider-adaptive parallelism. Bumping this past what the vendor allows
# leads to 429 bursts or (on local Ollama) CPU-scheduler thrash. Keys match
# `resolve_provider()` return values. Missing key falls back to 2.
_PARALLEL_WORKERS = {
    "anthropic":  4,
    "openai":     4,
    "google":     4,
    "openrouter": 3,   # stricter per-key RPM on free tier
    "groq":       2,   # RPM limits are tight
    "deepseek":   4,
    "mistral":    3,
    "ollama":     1,   # one inference at a time locally
}


_CHUNK_PROMPT_SYSTEM = (
    "You extract user pain points from a batch of posts about a specific "
    "topic. Return STRICT JSON with one key `findings` — a list of objects, "
    "each with: title (5-10 words, verb-first), evidence (one quoted line "
    "from the posts), frequency (1-N = how many posts mention this pain), "
    "importance (1-10), satisfaction (1-10, how well current solutions "
    "address this). No prose outside the JSON."
)

_CHUNK_USER_TEMPLATE = (
    "Topic: {topic}\n\n"
    "Chunk {chunk_idx} of {chunk_total} ({n_rows} posts).\n\n"
    "Posts:\n{corpus}\n\n"
    'Return JSON: {{"findings": [{{"title": "...", "evidence": "...", '
    '"frequency": 3, "importance": 8, "satisfaction": 3}}, ...]}}'
)


def _chunk_rows(rows: list[dict], chunk_size: int) -> list[list[dict]]:
    """Split rows into fixed-size chunks preserving source diversity.

    Greedy round-robin by source_type so each chunk sees multiple sources
    instead of one chunk of all-Reddit followed by one of all-arXiv. This
    gives the LLM cross-source signal inside every chunk.
    """
    by_src: dict[str, list[dict]] = {}
    for r in rows:
        by_src.setdefault(r.get("source_type") or "reddit", []).append(r)
    # Round-robin append
    interleaved: list[dict] = []
    while any(by_src.values()):
        for src in list(by_src.keys()):
            if by_src[src]:
                interleaved.append(by_src[src].pop(0))
    return [interleaved[i:i + chunk_size] for i in range(0, len(interleaved), chunk_size)]


def _normalize_title(title: str) -> str:
    """Deterministic key for dedup. Strips punctuation + lowercases +
    drops common filler words + de-pluralizes so "can't find healthy
    recipes" and "cant find healthy recipe" hash to the same bucket."""
    import re as _re
    t = (title or "").lower().strip()
    # Strip apostrophes WITHOUT inserting a space, so "can't" → "cant"
    # instead of "can t".
    t = t.replace("'", "").replace("\u2019", "")
    t = _re.sub(r"[^a-z0-9 ]+", " ", t)
    t = _re.sub(r"\s+", " ", t).strip()
    fillers = {"a", "an", "the", "to", "for", "of", "my", "on", "is", "in"}
    # Crude de-pluralization: drop trailing 's' from words > 3 chars.
    # Catches recipes/recipe, features/feature, apps/app without mangling
    # "ios", "pass", "class" (<= 3 char after 's' strip is still 3+).
    def _singular(w: str) -> str:
        if len(w) > 3 and w.endswith("s") and not w.endswith("ss"):
            return w[:-1]
        return w
    return " ".join(_singular(w) for w in t.split() if w not in fillers)


def _merge_findings(partial_findings_per_chunk: list[list[dict]]) -> list[dict]:
    """Fold N per-chunk finding lists into one deterministically.

    Keyed by `_normalize_title`. For duplicates:
      - frequency: sum (represents combined evidence across chunks)
      - importance: max (most urgent wins)
      - satisfaction: min (least-served wins)
      - evidence: keep the longest non-empty quote
      - chunk_sources: set of chunk indices that produced this finding
    """
    merged: dict[str, dict] = {}
    for chunk_idx, findings in enumerate(partial_findings_per_chunk):
        for f in findings or []:
            if not isinstance(f, dict):
                continue
            title = str(f.get("title") or "").strip()
            if not title:
                continue
            key = _normalize_title(title)
            if not key:
                continue
            freq = int(f.get("frequency") or 1)
            imp = int(f.get("importance") or 5)
            sat = int(f.get("satisfaction") or 5)
            ev = str(f.get("evidence") or "").strip()
            if key not in merged:
                merged[key] = {
                    "title": title,
                    "evidence": ev,
                    "frequency": freq,
                    "importance": imp,
                    "satisfaction": sat,
                    "chunk_sources": {chunk_idx},
                }
            else:
                m = merged[key]
                m["frequency"] += freq
                m["importance"] = max(m["importance"], imp)
                m["satisfaction"] = min(m["satisfaction"], sat)
                m["chunk_sources"].add(chunk_idx)
                if len(ev) > len(m["evidence"]):
                    m["evidence"] = ev
    # Post-process: compute opportunity_score (Ulwick) + serialize chunk_sources.
    out: list[dict] = []
    for m in merged.values():
        m["opportunity_score"] = m["importance"] + max(m["importance"] - m["satisfaction"], 0)
        m["chunk_sources"] = sorted(m["chunk_sources"])
        out.append(m)
    # Sort by opportunity_score DESC, then frequency DESC
    out.sort(key=lambda x: (x.get("opportunity_score", 0), x.get("frequency", 0)), reverse=True)
    return out


# Per-provider default chunk size. OpenRouter free-tier caps input at
# ~1358 tokens, so a chunk at 40 rows (~4000 tokens) is guaranteed to
# fail even after halving. Start small — the retry ladder can shrink,
# but cannot grow. Users can override via --chunk-size.
_DEFAULT_CHUNK_SIZE = {
    "anthropic":  40,
    "openai":     40,
    "google":     40,
    "openrouter": 8,    # free tier: ~1358 token input cap
    "groq":       15,
    "deepseek":   30,
    "mistral":    20,
    "ollama":     20,   # depends on num_ctx, but 20 is safe for 4k models
}


def _strip_html(s: str) -> str:
    """Convert RSS/HTML `selftext` to Markdown via `markdownify`.

    RSS feeds ship full `<p>`/`<a>`/`<ul>` markup which bloats chunk
    char-count 3-5× with near-zero signal for LLMs. Markdown preserves
    the useful structure (lists / bold / inline links) in a form the
    LLM parses naturally, while collapsing the wrapper tags.

    We strip `<a>` and `<img>` entirely (UTM-laden URLs are pure noise
    for our use case — titles/descriptions already contain the real
    signal). Collapses whitespace at the end.

    Falls back to the original string if markdownify / bs4 aren't
    installed — the `sources` extra pulls them in, but we keep this
    resilient so importing this module never raises in minimal envs.
    Also short-circuits on obviously non-HTML content to avoid
    unnecessary bs4 parsing cost.
    """
    if not s or "<" not in s:
        return s
    try:
        from markdownify import markdownify as _md
    except ImportError:
        # No markdownify → cheap regex fallback.
        import re as _re
        s2 = _re.sub(r"<[^>]+>", " ", s)
        s2 = _re.sub(r"&(nbsp|amp|lt|gt|quot|#\d+);", " ", s2)
        s2 = _re.sub(r"\s+", " ", s2).strip()
        return s2
    try:
        import re as _re
        out = _md(s, heading_style="ATX", strip=["a", "img"])
        # Collapse runs of blank lines / whitespace that markdownify
        # leaves around stripped tags.
        out = _re.sub(r"\n{3,}", "\n\n", out)
        out = _re.sub(r"[ \t]{2,}", " ", out)
        return out.strip()
    except Exception:
        # Malformed HTML → fall back to returning the raw string; the
        # corpus-excerpt truncation downstream still bounds its size.
        return s


def synthesize_insights_chunked(
    topic: str,
    provider: str | None = None,
    chunk_size: int | None = None,
    max_workers: int | None = None,
    max_tokens_per_chunk: int = 800,
    persist: bool = True,
    min_score: int = 0,
    progress=None,
) -> dict[str, Any]:
    """Chunked synth — map-reduce over the corpus.

    Each chunk is one small LLM call (800 max_tokens by default) that
    returns a partial `findings` list. Chunks run in parallel up to
    `max_workers`. Then a deterministic merge unions findings by
    normalized title, sums frequencies, keeps max importance / min
    satisfaction, and the longest evidence snippet.

    No final synthesis LLM call — the merge is pure code so the output is
    stable, cheap, and sidesteps the 402/credit issue that kills the
    single-call path when the provider has low credits.

    `max_workers=1` = sequential. `None` = auto (provider-adaptive).
    `progress(msg: str)` — optional callback for per-chunk status lines.
    """
    import concurrent.futures as _cf
    import threading as _threading
    import time as _time

    try:
        provider = resolve_provider(provider)
    except RuntimeError as e:
        return {"ok": False, "skipped": True, "topic": topic, "reason": str(e)}

    rows = _select_corpus(topic, min_score=min_score)
    if not rows:
        return {
            "ok": False, "topic": topic,
            "error": f"No corpus for topic={topic!r}. Run `research collect` first.",
        }

    # Strip HTML from selftext BEFORE chunking. RSS feeds shove full markup
    # into the summary, bloating chunk char-count 3-5× — on OpenRouter's
    # 1358-token free-tier cap, that's the difference between "chunk fits"
    # and "another 402". Do this once up-front so every chunk benefits.
    for r in rows:
        if isinstance(r.get("selftext"), str):
            r["selftext"] = _strip_html(r["selftext"])
        if isinstance(r.get("title"), str):
            r["title"] = _strip_html(r["title"])

    # Same provider-aware cap as single-call mode — if the user has a huge
    # corpus, we still bound the total work. Chunking buys us FASTER output
    # per chunk, not infinite scale.
    provider_cap = _cap_for_provider(provider)
    if len(rows) > provider_cap:
        rows.sort(
            key=lambda r: (r.get("score") or 0) + 2 * (r.get("num_comments") or 0),
            reverse=True,
        )
        rows = rows[:provider_cap]

    # Provider-adaptive chunk size — defaults are conservative on
    # low-credit providers. Explicit chunk_size arg wins.
    if chunk_size is None:
        chunk_size = _DEFAULT_CHUNK_SIZE.get(provider, 20)

    chunks = _chunk_rows(rows, chunk_size)
    workers = max_workers if max_workers is not None else _PARALLEL_WORKERS.get(provider, 2)
    workers = max(1, min(workers, len(chunks)))

    def _log(msg: str) -> None:
        if progress:
            try:
                progress(msg)
            except Exception:
                pass

    _log(f"[chunked] {len(rows)} rows → {len(chunks)} chunks × {chunk_size} rows, workers={workers}, provider={provider}")

    from ..analyze.providers.base import get_provider
    prov = get_provider(provider)

    sources_present = sorted({r.get("source_type") or "reddit" for r in rows})

    # Stable lock so logs don't interleave mid-word when workers write back
    _lock = _threading.Lock()

    def _run_chunk(idx: int, chunk_rows: list[dict]) -> tuple[int, list[dict], str | None]:
        import re as _re
        _debug = os.getenv("CHUNK_DEBUG") == "1"
        t0 = _time.monotonic()
        # One unified shrink loop. Each error adjusts one or more of:
        #   current_rows       — input corpus size
        #   current_excerpt    — per-row char budget
        #   current_max_tokens — output cap
        # Next iteration rebuilds the prompt with the new values and retries.
        # This handles cascading errors cleanly: "can only afford 96" → lower
        # max_tokens → retry → "prompt tokens exceeded" → shrink corpus →
        # retry → eventually fits.
        current_rows = list(chunk_rows)
        current_excerpt = 180
        current_max_tokens = max_tokens_per_chunk
        raw: str | None = None
        last_err: str | None = None
        MAX_ATTEMPTS = 7
        for attempt in range(MAX_ATTEMPTS):
            corpus_text = _format_corpus(current_rows, excerpt_chars=current_excerpt)
            user = _CHUNK_USER_TEMPLATE.format(
                topic=topic,
                chunk_idx=idx + 1,
                chunk_total=len(chunks),
                n_rows=len(current_rows),
                corpus=corpus_text,
            )
            if _debug:
                with _lock:
                    _log(
                        f"[chunk {idx + 1} attempt {attempt}] "
                        f"rows={len(current_rows)} ex={current_excerpt} "
                        f"max_tokens={current_max_tokens} "
                        f"prompt_chars={len(user) + len(_CHUNK_PROMPT_SYSTEM)}"
                    )
            try:
                raw = prov.complete(
                    prompt=user,
                    system=_CHUNK_PROMPT_SYSTEM,
                    max_tokens=current_max_tokens,
                    temperature=0.2,
                )
                break
            except Exception as e:
                last_err = str(e)
                msg = last_err.lower()
                if _debug:
                    with _lock:
                        _log(f"[chunk {idx + 1} attempt {attempt}] ERR: {last_err[:180]}")
                adjusted = False
                # --- Output side: "can only afford N" ---
                # Floor 30, margin 4 — aggressively small so ~96-token
                # OpenRouter remainders still pass the floor check.
                afford = _re.search(r"can only afford\s+(\d+)", msg)
                if afford:
                    new_mt = max(30, int(afford.group(1)) - 4)
                    if new_mt < current_max_tokens:
                        current_max_tokens = new_mt
                        adjusted = True
                # --- Input side: "limit exceeded: X > Y" ---
                overflow = _re.search(r"(?:limit exceeded|token[s]? limit)[:\s]+(\d+)\s*>\s*(\d+)", msg)
                if overflow:
                    current_tokens = int(overflow.group(1))
                    allowed_tokens = int(overflow.group(2))
                    # Keep 30% headroom for system prompt + JSON overhead.
                    target_ratio = (allowed_tokens * 0.7) / max(current_tokens, 1)
                    new_rows = max(1, int(len(current_rows) * target_ratio))
                    new_excerpt = max(60, int(current_excerpt * target_ratio))
                    if new_rows < len(current_rows) or new_excerpt < current_excerpt:
                        current_rows = current_rows[:new_rows]
                        current_excerpt = new_excerpt
                        adjusted = True
                elif any(k in msg for k in ("prompt tokens", "context length", "input too long", "too many tokens")):
                    # Generic input-too-big (no parseable numbers) → halve.
                    if len(current_rows) > 1:
                        current_rows = current_rows[: max(1, len(current_rows) // 2)]
                        current_excerpt = max(60, current_excerpt // 2)
                        adjusted = True
                if not adjusted:
                    # Nothing we recognize → bail this chunk.
                    break
                # else: continue to next attempt with adjusted values
        if raw is None:
            return (idx, [], (last_err or "unknown")[:200])

        # Reuse the tolerant JSON parser — chunk output is plain
        # {"findings": [...]} so extracting the list is trivial.
        parsed = _parse_insight_json(raw)
        if parsed.get("_parse_error"):
            with _lock:
                _log(f"[chunk {idx + 1}/{len(chunks)}] parse error; skipping")
            return (idx, [], parsed.get("_error") or "parse error")
        findings = parsed.get("findings") if isinstance(parsed, dict) else None
        findings = findings if isinstance(findings, list) else []
        dt = _time.monotonic() - t0
        with _lock:
            _log(f"[chunk {idx + 1}/{len(chunks)}] ✓ {len(findings)} findings ({dt:.1f}s)")
        return (idx, findings, None)

    per_chunk: list[list[dict]] = [[] for _ in range(len(chunks))]
    errors: list[str] = []

    if workers == 1:
        # Sequential
        for i, ch in enumerate(chunks):
            idx, findings, err = _run_chunk(i, ch)
            per_chunk[idx] = findings
            if err:
                errors.append(f"chunk {idx + 1}: {err}")
    else:
        # Parallel
        with _cf.ThreadPoolExecutor(max_workers=workers, thread_name_prefix="insights-chunk") as pool:
            futures = {pool.submit(_run_chunk, i, ch): i for i, ch in enumerate(chunks)}
            for fut in _cf.as_completed(futures):
                try:
                    idx, findings, err = fut.result()
                    per_chunk[idx] = findings
                    if err:
                        errors.append(f"chunk {idx + 1}: {err}")
                except Exception as e:
                    errors.append(f"chunk worker crashed: {e}")

    merged_findings = _merge_findings(per_chunk)

    # If EVERY chunk failed → surface a real error. Previously we returned
    # ok:True with an empty findings list, which silently painted an empty
    # report. Classify the root cause from the first error so the UI shows
    # the right CTA (Switch provider / Retry / Deep scan already-on).
    if not merged_findings and errors:
        first_err = errors[0]
        low = first_err.lower()
        err_code = None
        hint = ""
        if "can only afford" in low or "credits" in low or "402" in low:
            err_code = "credits_exhausted"
            hint = " — all chunks hit credit limits. Switch to Ollama (local, free) in Settings → AI Keys."
        elif any(k in low for k in ("prompt tokens", "context length", "input too long")):
            err_code = "context_overflow"
            hint = " — all chunks still too big even after shrinking. Re-run with --chunk-size 2 or switch to Ollama."
        elif "401" in low or "invalid api" in low or "unauthorized" in low:
            err_code = "invalid_key"
            hint = " — the API key appears invalid. Re-save it in Settings → AI Keys."
        return {
            "ok": False,
            "topic": topic,
            "provider": provider,
            "error": f"All {len(chunks)} chunks failed. First error: {first_err[:220]}{hint}",
            "error_code": err_code,
            "_chunk_errors": errors[:5],
            "corpus_coverage": {
                "total_posts_considered": len(rows),
                "chunks_run": len(chunks),
                "chunks_failed": len(chunks),
                "workers": workers,
                "mode": "chunked",
            },
        }

    report: dict[str, Any] = {
        "ok": True,
        "topic": topic,
        "provider": provider,
        "findings": merged_findings,
        "competitors": [],       # chunked mode doesn't synthesize these
        "hypotheses": [],
        "executive_summary": "",
        "disconfirming_evidence": [],
        "corpus_coverage": {
            "total_posts_considered": len(rows),
            "sources_represented": sources_present,
            "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "chunks_run": len(chunks),
            "chunks_failed": sum(1 for ch in per_chunk if not ch),
            "workers": workers,
            "mode": "chunked",
        },
        "_mode": "chunked",
        "_partial": True,  # UI can show "chunked scan — findings only" badge
        "_chunk_errors": errors[:5],
    }

    _normalize_scores(report, total_corpus=len(rows))

    # Same relevance gate as the single-shot path (see ~line 466 for rationale).
    try:
        threshold = float(os.getenv("GAPMAP_FINDING_RELEVANCE_THRESHOLD", "0.40"))
    except (TypeError, ValueError):
        threshold = 0.40
    if threshold > 0 and isinstance(report.get("findings"), list):
        try:
            from .relevance import filter_findings
            gate = filter_findings(topic, report["findings"], threshold=threshold)
            if gate.get("ok") and not gate.get("skipped"):
                report["findings"] = gate["kept"]
                if gate.get("dropped"):
                    report["_relevance_dropped_findings"] = gate["dropped"]
                    report["_relevance_dropped_count"] = gate["dropped_count"]
                    report["_relevance_threshold"] = threshold
        except Exception as e:
            report["_relevance_gate_error"] = str(e)

    _attach_suggested_tactics(report)

    if persist and merged_findings:
        model = os.getenv("LLM_MODEL") or getattr(prov, "_model", "") or ""
        _persist(topic, report, provider, model, len(rows))

    try:
        from ..core.db import save_mcp_analysis
        save_mcp_analysis(
            topic=topic, source="app", kind="insights",
            tool="synthesize_insights_chunked",
            content=json.dumps(report, ensure_ascii=False, default=str),
            content_type="json",
            provider=provider,
            model=os.getenv("LLM_MODEL") or getattr(prov, "_model", "") or "",
            params={"corpus_size": len(rows), "chunk_size": chunk_size,
                    "max_workers": max_workers, "chunks_with_errors": len(errors)},
        )
    except Exception:
        pass

    _log(f"[chunked] merged → {len(merged_findings)} findings, {len(errors)} chunk error(s)")
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
