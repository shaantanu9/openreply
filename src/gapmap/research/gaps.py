"""Gap extraction — runs the 4 externalized extractors over a topic corpus.

Each extractor is a YAML file in prompts/ (painpoints, features, complaints, diy).
LLM provider is pluggable (anthropic/openai/ollama).

Every extractor returns a structured JSON list. We retry JSON parsing once
after stripping code fences; if it still fails we surface the raw text
rather than crashing so Claude can salvage it downstream.
"""
from __future__ import annotations

import json
import re
from typing import Any

from ..analyze.providers.base import get_provider
from .collect import corpus_for, corpus_temporal_split
from .corpus_format import format_corpus as _format_corpus
from .prompts import load_extractor


def _parse_json(raw: str) -> list[dict] | dict:
    cleaned = raw.strip()
    # 1. Strip markdown fences anywhere — including a ```json block that follows
    #    a preamble line ("Here are the findings:\n```json [...] ```"). Weaker
    #    models (small Ollama, some cloud) ignore "no fences / no preamble" in
    #    the prompt, and a strict json.loads on the raw text then silently
    #    yields 0 findings (the bug behind "feature list / DIY not working").
    if "```" in cleaned:
        m = re.search(r"```(?:json)?\s*(.+?)```", cleaned, re.DOTALL | re.IGNORECASE)
        if m:
            cleaned = m.group(1).strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass
    # 2. Tolerant fallback: pull the first BALANCED JSON array (or object) out of
    #    the text even when the model wrapped it in prose. Scans for the first
    #    '[' / '{' and matches its close bracket (string-aware) so trailing
    #    commentary doesn't break the parse.
    for opener, closer in (("[", "]"), ("{", "}")):
        start = cleaned.find(opener)
        if start < 0:
            continue
        depth = 0
        in_str = False
        esc = False
        for i in range(start, len(cleaned)):
            c = cleaned[i]
            if in_str:
                if esc:
                    esc = False
                elif c == "\\":
                    esc = True
                elif c == '"':
                    in_str = False
                continue
            if c == '"':
                in_str = True
            elif c == opener:
                depth += 1
            elif c == closer:
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(cleaned[start:i + 1])
                    except json.JSONDecodeError:
                        break
    return {"_raw": raw, "_parse_error": True}


# Widest per-excerpt window for academic rows whose abstract was replaced
# with cached full text (corpus_for(prefer_fulltext=True) flags them with
# `_fulltext`). Must be >= corpus_for._FULLTEXT_MAX_CHARS so the substituted
# slice isn't re-truncated back down to the Reddit-sized excerpt.
_FULLTEXT_EXCERPT_CHARS = 4000


def _format_corpus_mixed(rows: list[dict], excerpt_chars: int = 600) -> str:
    """Like corpus_format.format_corpus, but rows flagged ``_fulltext`` (their
    selftext is a cached academic full-text slice) are rendered with a wide
    excerpt window so the full text reaches the LLM instead of being clipped
    to the normal Reddit-sized excerpt. All other rows are unchanged.

    Falls back to the standard formatter when no row is flagged, so behaviour
    for non-prefer_fulltext callers is byte-identical to before.
    """
    if not any(r.get("_fulltext") for r in rows):
        return _format_corpus(rows, excerpt_chars=excerpt_chars)
    from .corpus_format import _format_row
    wide = max(_FULLTEXT_EXCERPT_CHARS, excerpt_chars)
    rendered = [
        _format_row(r, excerpt_chars=(wide if r.get("_fulltext") else excerpt_chars))
        for r in rows
    ]
    return "\n\n".join(rendered)


def run_extractor(
    extractor: str,
    topic: str,
    provider: str | None = None,
    corpus_limit: int = 120,
    min_score: int = 1,
    max_tokens: int = 2048,
    prefer_fulltext: bool = False,
) -> list[dict] | dict:
    """Run a single extractor ('painpoints', 'features', 'complaints', 'diy').

    prefer_fulltext (opt-in; only the find_gaps path enables it) asks
    ``corpus_for`` to substitute cached academic full text for the abstract
    excerpt on the top academic papers — see corpus_for's docstring. When on,
    those rows are rendered with a wider per-excerpt window so the substituted
    full text isn't re-truncated to the Reddit-sized excerpt; non-academic
    rows still use the normal excerpt length.
    """
    import os as _os
    from ..analyze.providers.base import resolve_provider
    rows = corpus_for(
        topic, limit=corpus_limit, min_score=min_score,
        prefer_fulltext=prefer_fulltext,
    )
    if not rows:
        return []
    ext = load_extractor(extractor)
    # Per-excerpt length. Long excerpts push small-context models (llama3.2:3b)
    # past their 4K/8K default context window, causing silent truncation and
    # malformed JSON. Default 600 chars × 120 rows = 72 KB ≈ 20 K tokens.
    # For Ollama we shrink to 250 chars (~8 K tokens at 40 rows) so the full
    # corpus fits in an 8K context with headroom for the JSON response.
    resolved = resolve_provider(provider)
    default_excerpt = 250 if resolved == "ollama" else 600
    try:
        excerpt_chars = int(_os.getenv("CORPUS_EXCERPT_CHARS") or default_excerpt)
    except ValueError:
        excerpt_chars = default_excerpt
    corpus = _format_corpus_mixed(rows, excerpt_chars=excerpt_chars)
    # Small local models generate painfully slowly with big num_predict under
    # format=json. Cap at 1024 for Ollama — more than enough for a JSON array
    # of 10-20 findings. Override with EXTRACTOR_MAX_TOKENS.
    if resolved == "ollama":
        try:
            max_tokens = min(max_tokens, int(_os.getenv("EXTRACTOR_MAX_TOKENS") or 1024))
        except ValueError:
            max_tokens = 1024
    user = ext["user_template"].format(topic=topic, corpus=corpus)
    raw = get_provider(provider).complete(
        prompt=user,
        system=ext["system"],
        max_tokens=max_tokens,
        temperature=0.2,
    )
    return _parse_json(raw)


def _load_temporal_gaps_cache(topic: str) -> list[dict] | None:
    """Return a cached trends result from graph_nodes, or None if not cached.

    We persist each classified painpoint as a `kind='temporal_gap'` row
    whose metadata_json carries `{classification, pre_2025_freq, post_2025_freq,
    summary, evidence, ...}`. Subsequent `find_temporal_gaps` calls read
    from here instead of re-running the 30–90s LLM pass.
    """
    from ..core.db import get_db
    import json as _json
    db = get_db()
    rows = list(db.query(
        "SELECT label, metadata_json FROM graph_nodes "
        "WHERE topic = ? AND kind = 'temporal_gap'",
        (topic,),
    ))
    if not rows:
        return None
    out: list[dict] = []
    for r in rows:
        try:
            meta = _json.loads(r.get("metadata_json") or "{}")
        except Exception:
            meta = {}
        # Rebuild the original LLM shape so callers don't need to know the
        # row lives in graph_nodes. `painpoint` is the label; other fields
        # come from metadata.
        out.append({"painpoint": r.get("label") or "", **meta})
    return out


def _persist_temporal_gaps(topic: str, items: list[dict]) -> int:
    """Write trends results to `graph_nodes` as kind='temporal_gap'.

    Idempotent: re-runs upsert on the same `topic::temporal_gap::<slug>` id,
    so a force-rerun replaces the old row instead of duplicating.
    Returns the number of rows written (items that had a non-empty
    `painpoint` / `title` label).
    """
    from ..core.db import get_db
    from ..graph.build import _upsert_node, _upsert_edge
    import re as _re
    import json as _json
    if not items:
        return 0
    db = get_db()
    # Ensure the topic root node exists so edges have something to point at.
    topic_node = _upsert_node(db, topic, "topic", topic, topic)

    def _slug(s: str) -> str:
        s = _re.sub(r"[^a-zA-Z0-9]+", "-", (s or "").strip().lower()).strip("-")
        return s[:80] or "unnamed"

    written = 0
    for it in items:
        title = (it.get("painpoint") or it.get("title") or "").strip()
        if not title:
            continue
        # Strip `painpoint`/`title` from the meta payload — they live in the
        # `label` column. Everything else (classification, freqs, summary,
        # evidence, post IDs) flows into `metadata_json` untouched.
        meta = {k: v for k, v in it.items() if k not in ("painpoint", "title")}
        node_id = _upsert_node(
            db, topic, "temporal_gap", _slug(title), title, metadata=meta,
        )
        _upsert_edge(db, topic, topic_node, node_id, "has_temporal_gap")
        written += 1
    return written


def clear_temporal_gaps(topic: str) -> int:
    """Drop the cached trends rows so the next call re-runs the LLM.

    Used by the "Re-run analysis" button in the Trends tab. Deletes both
    `kind='temporal_gap'` graph_nodes and their `has_temporal_gap` edges.
    Returns the row count that was deleted.
    """
    from ..core.db import get_db
    db = get_db()
    # Find all IDs first so we can match edges on either endpoint.
    ids = [
        r["id"]
        for r in db.query(
            "SELECT id FROM graph_nodes WHERE topic=? AND kind='temporal_gap'",
            (topic,),
        )
    ]
    if not ids:
        return 0
    placeholders = ",".join(["?"] * len(ids))
    db.execute(
        f"DELETE FROM graph_edges WHERE topic=? AND (src IN ({placeholders}) OR dst IN ({placeholders}))",
        (topic, *ids, *ids),
    )
    db.execute(
        "DELETE FROM graph_nodes WHERE topic=? AND kind='temporal_gap'",
        (topic,),
    )
    db.conn.commit()
    return len(ids)


def find_temporal_gaps(
    topic: str,
    provider: str | None = None,
    per_bucket: int = 80,
    min_score: int = 1,
    max_tokens: int = 3000,
    force: bool = False,
) -> list[dict] | dict:
    """Classify pain points by temporal pattern (chronic/emerging/fading).

    Requires a corpus with both pre-May-2025 (historical) and post-May-2025
    (recent) data. Use `collect(..., include_historical=True)` beforehand.

    Caching: on success, the LLM output is persisted to `graph_nodes` as
    `kind='temporal_gap'`. Subsequent calls (same topic) skip the LLM and
    return the cached rows unless `force=True`. Use `clear_temporal_gaps`
    to invalidate. Error/empty dict results are NOT cached — caller can
    retry freely.
    """
    # Cache hit — skip the 30-90s LLM pass.
    if not force:
        cached = _load_temporal_gaps_cache(topic)
        if cached is not None:
            return cached

    split = corpus_temporal_split(
        topic=topic, limit_per_bucket=per_bucket, min_score=min_score
    )
    pre, post = split["pre_2025"], split["post_2025"]
    if not pre and not post:
        return {"_error": f"No corpus for topic={topic!r}. Run collect first."}
    if not pre:
        return {"_error": "No pre-May-2025 data. Run collect --historical / --aggressive first."}
    if not post:
        return {"_error": "No post-May-2025 data. Run a current-mode collect first."}

    ext = load_extractor("temporal_gaps")
    user = ext["user_template"].format(
        topic=topic,
        pre_corpus=_format_corpus(pre),
        post_corpus=_format_corpus(post),
    )
    raw = get_provider(provider).complete(
        prompt=user, system=ext["system"], max_tokens=max_tokens, temperature=0.2
    )
    result = _parse_json(raw)

    # Persist the successful run so future calls hit the DB cache instead.
    # Only list results get cached — error/parse-error dicts stay ephemeral
    # so the caller can retry without clearing.
    if isinstance(result, list):
        try:
            _persist_temporal_gaps(topic, result)
        except Exception:
            # Don't fail the whole call if persistence fails — return the
            # in-memory result anyway. User can still see it, just re-runs
            # on next visit.
            pass
    return result


# (summary_key, extractor_file, ui_short_name)
# `ui_short_name` is what the UI + --only flag speak. Keep both long+short
# so legacy callers can still pass "diy_workarounds" without confusion.
_EXTRACTORS: tuple[tuple[str, str, str], ...] = (
    ("painpoints",         "painpoints", "painpoints"),
    ("feature_wishes",     "features",   "features"),
    ("product_complaints", "complaints", "complaints"),
    ("diy_workarounds",    "diy",        "workarounds"),
)


def _normalize_only(only: str | None) -> str | None:
    """Map a user-supplied --only value to the canonical summary key.

    Accepts short names (painpoints/features/complaints/workarounds) OR the
    full summary keys (painpoints/feature_wishes/product_complaints/
    diy_workarounds). Returns None for empty/missing, raises ValueError for
    unknown values so the CLI can surface a clean error.
    """
    if not only:
        return None
    val = only.strip().lower()
    valid = {}
    for summary_key, _file, short in _EXTRACTORS:
        valid[summary_key] = summary_key
        valid[short] = summary_key
    if val not in valid:
        raise ValueError(
            f"unknown --only={only!r}. Use one of: "
            + ", ".join(sorted({v for v in valid.keys()}))
        )
    return valid[val]


def find_gaps(
    topic: str,
    provider: str | None = None,
    corpus_limit: int = 120,
    min_score: int = 1,
    only: str | None = None,
    parallel: bool = False,
    progress_cb: Any = None,
) -> dict[str, Any]:
    """Run the four extractors and return a consolidated gap report.

    Args:
        only: Optional summary key (painpoints/feature_wishes/…) or short name
            (painpoints/features/complaints/workarounds). When set, runs only
            that extractor — the other categories are absent from the result.
        parallel: When True, runs all selected extractors concurrently via a
            thread pool. Skipped for Ollama (local models serialize LLM calls
            via a single inference queue anyway; parallel launch just thrashes
            CPU/RAM). Ignored when only=1 extractor.
        progress_cb: Optional callable invoked at lifecycle boundaries:
            ``progress_cb("corpus", {corpus_size, provider, extractors})``
            ``progress_cb("start",  {kind})`` before each extractor fires
            ``progress_cb("done",   {kind, findings})`` after each finishes
            ``progress_cb("error",  {kind, error})`` on extractor exception
            The callback is called synchronously from the worker thread for
            parallel runs — keep it cheap (typically just a stdout print).
    """
    import os as _os
    from ..analyze.providers.base import resolve_provider

    # Peek at the chain head for perf-tuning only. We keep the original
    # `provider` (possibly None) for the extractor calls so get_provider(None)
    # returns a FallbackProvider — that way a mid-run Ollama crash falls
    # through to any cloud key the user has set, instead of failing the whole
    # enrichment.
    head_provider = resolve_provider(provider)

    # Adaptive corpus size for small local models. Ollama on CPU with a 3B
    # model processes ~100-post prompts so slowly that the constrained-JSON
    # sampler hits timeouts. Cap at 50 for Ollama unless user has explicitly
    # set OLLAMA_CORPUS_LIMIT, which is the escape hatch for GPU users
    # running big models (llama3.1:70b can eat 120 posts fine).
    if head_provider == "ollama":
        try:
            ollama_cap = int(_os.getenv("OLLAMA_CORPUS_LIMIT") or 50)
        except ValueError:
            ollama_cap = 50
        corpus_limit = min(corpus_limit, ollama_cap)

    try:
        only_key = _normalize_only(only)
    except ValueError as e:
        return {"topic": topic, "provider": head_provider, "error": str(e)}

    selected = [
        (summary_key, file, short)
        for summary_key, file, short in _EXTRACTORS
        if only_key is None or summary_key == only_key
    ]

    # Academic rows get cached full text (methods/results/limitations)
    # substituted for the ≤500-char abstract — see corpus_for(prefer_fulltext).
    # Disable with GAPMAP_GAPS_FULLTEXT=0 if a provider's context is too small.
    prefer_fulltext = (_os.getenv("GAPMAP_GAPS_FULLTEXT") or "1").strip() not in (
        "0", "false", "no",
    )

    out: dict[str, Any] = {"topic": topic, "provider": head_provider, "corpus_size": None}
    rows = corpus_for(
        topic, limit=corpus_limit, min_score=min_score,
        prefer_fulltext=prefer_fulltext,
    )
    out["corpus_size"] = len(rows)
    if not rows:
        out["error"] = f"No corpus found for topic={topic!r}. Run `gapmap research collect` first."
        return out

    if progress_cb is not None:
        try:
            progress_cb("corpus", {
                "corpus_size": len(rows),
                "provider": head_provider,
                "extractors": [s for _k, _f, s in selected],
                "parallel": bool(parallel and len(selected) > 1 and head_provider != "ollama"),
            })
        except Exception:
            pass

    def _run_one(summary_key: str, file: str, short: str) -> tuple[str, Any, Any]:
        if progress_cb is not None:
            try: progress_cb("start", {"kind": short})
            except Exception: pass
        try:
            result = run_extractor(
                file, topic, provider=provider,
                corpus_limit=corpus_limit, min_score=min_score,
                prefer_fulltext=prefer_fulltext,
            )
            if progress_cb is not None:
                try: progress_cb("done", {"kind": short, "findings": result})
                except Exception: pass
            return summary_key, result, None
        except Exception as e:
            if progress_cb is not None:
                try: progress_cb("error", {"kind": short, "error": str(e)})
                except Exception: pass
            return summary_key, [], e

    # Parallel only helps when the provider can serve N concurrent requests.
    # Ollama's single inference queue means 4 parallel callers just wait in
    # the same line — no speedup and it multiplies RAM/OOM risk. Cloud
    # providers handle the fan-out fine.
    can_parallel = (
        parallel
        and len(selected) > 1
        and head_provider != "ollama"
    )

    if can_parallel:
        from concurrent.futures import ThreadPoolExecutor, as_completed
        with ThreadPoolExecutor(max_workers=min(4, len(selected))) as ex:
            futures = [
                ex.submit(_run_one, sk, fl, sh)
                for sk, fl, sh in selected
            ]
            for fut in as_completed(futures):
                summary_key, result, _err = fut.result()
                out[summary_key] = result
    else:
        for summary_key, file, short in selected:
            _k, result, _err = _run_one(summary_key, file, short)
            out[summary_key] = result

    return out
