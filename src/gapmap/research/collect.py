"""Collect orchestrator — builds a topic-scoped corpus in SQLite.

Steps:
  1. Discover relevant subs (or accept user-provided list)
  2. Fetch top posts (month + year) from each sub
  3. Run a budgeted, parallelized set of query-template searches against
     r/all (covers every sub) — see the GAPMAP_SEARCH_* env knobs below
  4. Tag every collected post with the research topic so we can query it
     back later regardless of which sub it came from

Works in both auth and public mode; just uses the existing fetch modules.
"""
from __future__ import annotations

import itertools
import os
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from concurrent.futures import TimeoutError as FuturesTimeout
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any


def _ts_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")

from ..core.db import get_db
from ..core.pullpush_client import CUTOFF_UTC
from ..fetch.historical import fetch_historical
from ..fetch.posts import fetch_posts
from ..fetch.search import search_reddit
from .discover import discover_subs
from .prompts import render_queries

# Politeness delay between HTTP calls — Reddit's public endpoint is tight.
_SLEEP = 2.0

# Max concurrent workers for the "extra sources" stage. Each worker hits a
# different provider (HN / arXiv / GitHub / …), so this is parallelism across
# independent hosts — not hammering any single one.
_PARALLEL_SOURCES = 6


# --- Reddit search fan-out controls (env-tunable) -------------------------
# History: the search stage used to run every (template × keyword × sub)
# combination SEQUENTIALLY with a 2 s sleep between each. With 24 templates,
# 6 keywords and ~12 discovered subs that is 144 unique queries × 12 subs ≈
# 1,700 searches × ~4 s ≈ over an hour, all on the main thread — the dominant
# cause of "collect takes 15+ minutes / feels stuck on query expansion".
#
# Fixes (all overridable so behaviour can be tuned without a rebuild):
#   * GAPMAP_MAX_SEARCH_QUERIES — cap the total number of distinct search
#     queries actually executed (default 24). Queries are picked round-robin
#     across keywords + categories so the budget keeps breadth, not just the
#     first category of the first keyword.
#   * GAPMAP_SEARCH_WORKERS — run the (now-capped) searches through a bounded
#     thread pool instead of one-at-a-time (default 4).
#   * GAPMAP_SEARCH_SUB_CAP — how many discovered subs to additionally scope
#     each query to when sub_scope_search is on (default 0 = search r/all only,
#     which already covers every sub and kills the ×N-subs multiplier).
#   * GAPMAP_SOURCE_TIMEOUT_SEC — overall budget (seconds) to wait for the
#     parallel external-source pool to drain before giving up on stragglers
#     like yt-dlp / pytrends / pubmed (default 90).
_SEARCH_PACING = 1.0  # light per-request politeness inside each search worker


def _env_int(name: str, default: int, *, minimum: int = 0) -> int:
    try:
        return max(minimum, int(os.getenv(name, str(default)) or default))
    except (TypeError, ValueError):
        return default


def _env_float(name: str, default: float, *, minimum: float = 0.0) -> float:
    try:
        return max(minimum, float(os.getenv(name, str(default)) or default))
    except (TypeError, ValueError):
        return default


def _build_search_worklist(
    keywords: list[str],
    categories: list[str] | None,
    budget: int,
) -> list[tuple[str, str]]:
    """Return up to ``budget`` distinct ``(category, query)`` pairs.

    Selection is round-robin across keywords AND categories so a small budget
    still yields a spread (pain/features/complaints/diy for several keywords)
    instead of front-loading all of one category for the primary keyword.
    """
    # Per keyword, interleave categories so index order isn't "all pain first".
    per_kw: list[list[tuple[str, str]]] = []
    for kw in keywords:
        rq = render_queries(kw, categories=categories)
        cols = [[(cat, q) for q in qs] for cat, qs in rq.items()]
        interleaved = [it for tup in itertools.zip_longest(*cols) for it in tup if it]
        if interleaved:
            per_kw.append(interleaved)

    flat: list[tuple[str, str]] = []
    seen: set[str] = set()
    # Round-robin across keywords: kw1[0], kw2[0], …, kw1[1], kw2[1], …
    for tup in itertools.zip_longest(*per_kw):
        for item in tup:
            if not item:
                continue
            _cat, q = item
            if q in seen:
                continue
            seen.add(q)
            flat.append(item)
            if len(flat) >= budget:
                return flat
    return flat


def _fallback_keyword_candidates(topic: str) -> list[str]:
    """Generate deterministic keyword fanout when LLM expansion is weak/missing."""
    topic = (topic or "").strip()
    if not topic:
        return []
    low = topic.lower()
    tokens = [t for t in re.findall(r"[a-z0-9]+", low) if len(t) >= 2]
    stop = {"the", "and", "for", "with", "from", "that", "this", "app", "tool", "software", "service"}
    core = [t for t in tokens if t not in stop]
    out: list[str] = [topic]
    if core:
        out.append(" ".join(core[:2]))
        out.append(" ".join(core))
        if len(core) >= 2:
            out.extend([f"{core[0]} {core[-1]}", f"{core[0]} problems", f"{core[0]} alternatives"])
        else:
            out.extend([f"{core[0]} problems", f"{core[0]} alternatives", f"{core[0]} reviews"])
    else:
        # Ultra-short user input (e.g. "a"): still fan out instead of a dead-end single query.
        out.extend([f"{topic} problems", f"{topic} alternatives", f"{topic} reviews", f"{topic} community"])
    seen: set[str] = set()
    deduped: list[str] = []
    for k in out:
        s = " ".join(k.split()).strip()
        if not s:
            continue
        key = s.lower()
        if key in seen:
            continue
        seen.add(key)
        deduped.append(s)
    return deduped


@dataclass
class CollectResult:
    topic: str
    subs: list[str] = field(default_factory=list)
    posts_fetched: int = 0
    by_source: dict[str, int] = field(default_factory=dict)
    errors: list[str] = field(default_factory=list)


def _ensure_topics_table() -> None:
    db = get_db()
    if "topic_posts" in db.table_names():
        return
    db["topic_posts"].create(
        {"topic": str, "post_id": str, "source": str, "added_at": str},
        pk=("topic", "post_id"),
    )
    db["topic_posts"].create_index(["topic"])


def _tag_posts(topic: str, post_ids: list[str], source: str) -> int:
    """Insert (topic, post_id) rows into topic_posts.

    Passes the candidate post_ids through a relevance gate first — Reddit
    / HN search routinely over-matches on short topic phrases ("meditation
    sound frequency brainwave" surfaces r/politics threads), and without
    a gate those garbage posts end up in the corpus and the LLM extractor
    dutifully reports "ICE accountability" as a meditation-app painpoint.

    The gate is best-effort: if the embedder isn't available (chromadb
    missing or transient failure), we fall through to the un-gated insert
    so collect keeps working. Use GAPMAP_RELEVANCE_GATE_THRESHOLD to tune;
    set to 0 to disable.
    """
    if not post_ids:
        return 0
    _ensure_topics_table()
    # Alias lookup (read-only) — if this topic was previously bound by an
    # LLM canonicalization, redirect to the canonical. For un-aliased inputs
    # we leave the topic as-is: user's word stands.
    try:
        from .topic_resolver import resolve_topic
        topic = resolve_topic(topic, register=False)
    except Exception:
        pass
    db = get_db()
    from datetime import datetime, timezone
    import os

    # ── Relevance gate ────────────────────────────────────────────────
    # Threshold of 0 disables the gate. Default 0.28 is recall-leaning —
    # tuned to keep borderline posts in while still stopping the "meditation
    # → Epstein threads" over-match pattern.
    try:
        gate_threshold = float(os.getenv("GAPMAP_RELEVANCE_GATE_THRESHOLD", "0.28"))
    except (TypeError, ValueError):
        gate_threshold = 0.28

    # Local-file ingestion and explicit persona-teach actions already carry
    # explicit user intent ("ingest this file" / "teach this persona this
    # video"), so semantic relevance gating can incorrectly drop the
    # synthetic post and break provenance linking. The "teach:" prefix is
    # set by persona.teach.teach_from_youtube.
    src_str = str(source or "")
    skip_relevance_gate = src_str.startswith("local:") or src_str.startswith("teach:")
    if (not skip_relevance_gate) and gate_threshold > 0 and post_ids:
        try:
            from .relevance import score_posts
            rows_for_scoring = list(db.query(
                f"SELECT id, title, selftext FROM posts WHERE id IN ({','.join(['?']*len(post_ids))})",
                post_ids,
            ))
            scored = score_posts(topic, rows_for_scoring)
            if scored:
                passing = {pid for pid, sc in scored if sc >= gate_threshold}
                # Keep any post we couldn't score (unknown IDs) — better to
                # admit than to silently drop on a bookkeeping miss.
                known_ids = {r["id"] for r in rows_for_scoring}
                post_ids = [pid for pid in post_ids
                            if pid in passing or pid not in known_ids]
        except Exception:
            # Embedder failed or chromadb missing — fall through un-gated.
            pass

    # ── Quality gate (opt-in, strict mode only) ──────────────────────
    # Runs AFTER relevance so we only spend quality-check cycles on posts
    # already known to be on-topic. Lenient-mode quality is not applied
    # here — the CLI diagnostic (`research collect-quality-check`) can
    # surface lenient-level drops on demand without changing the default
    # ingest behaviour.
    strict_quality = (os.getenv("GAPMAP_STRICT_QUALITY") or "").strip() in ("1", "true", "yes", "on")
    if strict_quality and post_ids:
        try:
            from .quality_gate import passes_quality
            rows_for_quality = list(db.query(
                f"SELECT id, title, selftext, score, author "
                f"FROM posts WHERE id IN ({','.join(['?']*len(post_ids))})",
                post_ids,
            ))
            quality_pass = {r["id"] for r in rows_for_quality if passes_quality(dict(r), strict=True)}
            known_ids = {r["id"] for r in rows_for_quality}
            post_ids = [pid for pid in post_ids
                        if pid in quality_pass or pid not in known_ids]
        except Exception:
            # Never let a quality-gate bug block ingest — fall through.
            pass

    if not post_ids:
        return 0
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    rows = [
        {"topic": topic, "post_id": pid, "source": source, "added_at": now}
        for pid in post_ids
        if pid
    ]
    # Ignore-on-conflict so rerunning a topic doesn't error
    db["topic_posts"].insert_all(rows, pk=("topic", "post_id"), ignore=True)

    # Enqueue for async extraction by the long-lived worker. Idempotent via
    # composite PK (topic, post_id, kind) — rerunning collect doesn't create
    # duplicate queue rows. The worker picks these up in FIFO batches of 5
    # and extracts findings into graph_nodes incrementally. See
    # docs/superpowers/plans/2026-04-21-incremental-enrichment.md Task 2.
    try:
        db["extraction_queue"].insert_all(
            [
                {
                    "topic": topic,
                    "post_id": pid,
                    "kind": "post",
                    "queued_at": now,
                    "attempts": 0,
                }
                for pid in post_ids
                if pid
            ],
            pk=("topic", "post_id", "kind"),
            ignore=True,
        )
    except Exception:
        # Queue table may not exist on first-run-before-schema paths; never
        # let an enqueue failure break collect itself (the data is the
        # source of truth — worker will backfill via init_schema's
        # INSERT OR IGNORE on next boot).
        pass
    return len(rows)


def collect(
    topic: str,
    subs: list[str] | None = None,
    limit_per_sub: int = 50,
    limit_per_query: int = 25,
    query_categories: list[str] | None = None,
    sub_scope_search: bool = True,
    include_historical: bool = False,
    historical_days: int = 730,
    historical_limit_per_sub: int = 500,
    aggressive: bool = False,
    sources: list[str] | None = None,  # extra sources: hn/appstore/playstore/scholar/stackoverflow/trends
    skip_reddit: bool = False,  # skip Reddit fetch stages (2+3); useful for external-only reruns
    skip_extraction: bool = False,  # skip inline LLM extraction at end of collect
    progress=None,  # optional callable(message: str) for CLI progress
) -> CollectResult:
    """Run the full collection for a topic.

    Args:
      subs: override discovery with a user-provided list of sub names.
      limit_per_sub: top-of-month + top-of-year each fetch this many posts.
      limit_per_query: search fetch this many per query template.
      query_categories: subset of ['pain','features','complaints','diy'].
      sub_scope_search: if True, restrict searches to the discovered subs.
      include_historical: also pull pre-May-2025 posts via pullpush.
      historical_days: days to look back from the May-2025 pullpush cutoff.
      historical_limit_per_sub: max historical posts per sub.
      aggressive: preset that maxes limits + enables comments + historical.
    """
    # Aggressive preset — overrides conservative defaults
    if aggressive:
        limit_per_sub = max(limit_per_sub, 100)
        limit_per_query = max(limit_per_query, 50)
        include_historical = True
        historical_days = max(historical_days, 1095)  # 3 years
        historical_limit_per_sub = max(historical_limit_per_sub, 1000)
        query_categories = query_categories or ["pain", "features", "complaints", "diy"]
        if not sources:
            # Full free-and-reliable source sweep — matches the "10-source
            # pipeline" the Science + onboarding screens promise. Each source
            # runs in its own thread (see _PARALLEL_SOURCES below) and errors
            # are captured per-source, so one flaky provider doesn't kill the
            # rest. Sources that need explicit config (lemmy / mastodon need
            # instance URLs; github_issues + scholar hit rate limits without
            # tokens) are left opt-in via `--sources` instead of aggressive.
            sources = [
                "hn",             # Hacker News
                "appstore",       # App Store reviews (iOS consumer)
                "playstore",      # Play Store reviews (Android consumer)
                "trustpilot",     # Customer reviews (non-app-store web)
                "producthunt",    # Product Hunt launches + early-adopter reactions
                "rss_products",   # Product launch/news RSS bundle
                "rss_tech_news",  # Tech news RSS bundle
                "arxiv",          # arXiv preprints
                "openalex",       # OpenAlex academic catalogue
                "pubmed",         # PubMed (biomed literature)
                "gnews",          # Google News
                "devto",          # Dev.to posts
                "stackoverflow",  # Stack Overflow Q&A
                "github",         # GitHub trending repos
                "trends",         # Google Trends series (returns series, not posts)
                "youtube",        # YouTube video comments via yt-dlp (no API key)
                # Opt-in via explicit --sources flag (not in aggressive default):
                #   alternativeto  — Cloudflare blocks unauth clients (known flaky)
                #   lemmy/mastodon — need explicit instance URLs
                #   github_issues  — rate-limited without GITHUB_TOKEN
                #   scholar        — Google Scholar blocks aggressively
            ]
    elif not sources:
        # Non-aggressive default: still pull from a baseline of FAST FREE
        # external sources so "quick" mode is never reddit-only. Users
        # expect to see HN / arXiv / GitHub alongside Reddit even on a
        # short collect. Historical pullpush + heavy stores (app/play/gnews
        # /pubmed/openalex/trends) stay gated behind aggressive — those add
        # minutes and aren't free-fast.
        sources = [
            "hn",            # Hacker News — fast, free, 1 call
            "arxiv",         # arXiv — fast, free, 1 call
            "devto",         # Dev.to — fast, free, 1 call
            "stackoverflow", # Stack Overflow — fast, free, 1 call
            "github",        # GitHub trending — fast, free, 1 call
            "rss_tech_news", # RSS tech bundle for broad market chatter
            "rss_products",  # RSS product bundle for launch/feedback signal
            "gnews",         # Google News for general-topic recall
        ]
    # `result.topic` ends up being set to the canonical after canonicalization
    # below. Populate with original here; we update after _canonicalize_topic
    # resolves (handles the no-LLM-configured passthrough case cleanly).
    result = CollectResult(topic=topic)

    # Alias lookup — if a PRIOR LLM canonicalization bound this input to
    # another form (e.g. user previously typed "calari tracking" which was
    # canonicalized to "calorie tracking"), reuse that canonical so the
    # second collect augments the existing corpus instead of forking a new
    # topic. Read-only check — does NOT auto-normalize user input.
    try:
        from .topic_resolver import resolve_topic
        resolved = resolve_topic(topic, register=False)
        if resolved and resolved != topic:
            # Alias exists → collapse onto existing topic.
            topic = resolved
            result.topic = resolved
    except Exception:
        pass

    # Instant visibility: create the topic_prefs row NOW — BEFORE the 30-60s
    # canonicalize LLM call — so the topic shows up in `list_topics` the moment
    # a collect starts instead of only after canonicalization (and the first
    # tagged posts) land. If canonicalize later rewrites the name, we MIGRATE
    # this row to the canonical below (dropping the typed-form row only when it
    # has no posts). That migration is what prevents the phantom-duplicate the
    # old "insert typed, then separately insert canonical" code left behind
    # (the reason this insert was previously deferred — fix 2026-04-21).
    # Instant-topic restore: 2026-06-01.
    _typed_for_prefs = topic
    try:
        from ..core.db import get_db as _get_db
        _db_early = _get_db()
        _db_early.conn.execute(
            "INSERT INTO topic_prefs (topic, scheduled, last_run_seen, last_run_ts) "
            "VALUES (?, 0, ?, ?) "
            "ON CONFLICT(topic) DO UPDATE SET last_run_ts=excluded.last_run_ts",
            (topic, _ts_iso(), _ts_iso()),
        )
        _db_early.conn.commit()
    except Exception:
        pass

    # Canonicalize ONCE at the top so every downstream query (reddit sub
    # discovery, reddit search, HN, arXiv, OpenAlex, PubMed, Scholar, etc.)
    # hits the corrected domain. "calari tracking app" → "calorie tracking app"
    # before anything fans out. We keep the user's original `topic` as the
    # storage key so the UI still labels it with what they typed; only search
    # queries use the canonical string.
    #
    # First call to `_canonicalize_topic` triggers an LLM round-trip on cache
    # miss. With Ollama cold-start (first prompt after app boot) that can
    # take 30-90 s, during which the UI shows zero progress and the user
    # thinks the app is hung. Emit a `canonicalizing topic via LLM…` line
    # before the call and a `→ canonical: "X"` line after, so the wait is
    # legible. Cache hits return in <1 ms — `_canonicalize_topic` itself
    # checks the SQLite cache before any provider call.
    if progress:
        progress(f"canonicalizing topic via LLM (first run may take ~30-60s on cold model)…")
    try:
        from .discover import _canonicalize_topic
        _canon = _canonicalize_topic(topic)
        search_topic = (
            _canon.get("canonical") or topic
            if (_canon.get("confidence") in ("high", "low"))
            else topic
        )
        if progress and isinstance(_canon, dict):
            _conf = _canon.get("confidence", "unknown")
            _canonical = _canon.get("canonical") or topic
            if _canonical and _canonical.strip().lower() != topic.strip().lower():
                progress(f"  → canonical: \"{_canonical}\" (confidence: {_conf})")
            else:
                progress(f"  → canonical: \"{_canonical}\" (confidence: {_conf}, no rewrite)")
    except Exception:
        search_topic = topic
        if progress:
            progress("  ! canonicalize failed; using user-typed topic as-is")
    if search_topic != topic:
        # Capture the original typed form BEFORE we overwrite `topic` below —
        # we need it to register the user-typed → canonical alias. (Bug fix
        # 2026-06-01: this previously bound canonical→canonical because both
        # `topic` and `result.topic` were already reassigned to `search_topic`
        # before the register_alias calls, so the typed form never resolved.
        # A freshly-collected topic then looked empty when viewed under the
        # name the user actually typed — papers and posts appeared missing.)
        original_typed = topic
        result.errors.append(
            f"info: search using canonical '{search_topic}' (user typed '{original_typed}')"
        )
        # LLM rewrote the input. Use the canonical as the storage key; any
        # future search with the original typed form will now resolve to
        # this canonical via the alias binding, so the user never sees two
        # rows for the same concept.
        topic = search_topic
        result.topic = search_topic
        try:
            from .topic_resolver import register_alias
            # Anchor the canonical to itself (idempotent) …
            register_alias(search_topic, search_topic, source="llm")
            # … and bind the user-typed ORIGINAL to the canonical. This is the
            # ONLY place aliases get populated, which is why merges stay
            # system-only (user re-searches never create alias rows).
            register_alias(original_typed, search_topic, source="llm")
        except Exception:
            pass

        # Migrate the early instant-visibility row from the typed form to the
        # canonical. Ensure the canonical row exists, then drop the typed row
        # ONLY when it has no tagged posts (i.e. it was the placeholder we just
        # created) — so we never delete a real pre-existing topic that happens
        # to match the typed string. This is what keeps instant-visibility from
        # leaving a phantom duplicate.
        try:
            from ..core.db import get_db as _get_db
            _dbm = _get_db()
            _dbm.conn.execute(
                "INSERT INTO topic_prefs (topic, scheduled, last_run_seen, last_run_ts) "
                "VALUES (?, 0, ?, ?) "
                "ON CONFLICT(topic) DO UPDATE SET last_run_ts=excluded.last_run_ts",
                (search_topic, _ts_iso(), _ts_iso()),
            )
            if original_typed != search_topic:
                _posts_n = _dbm.conn.execute(
                    "SELECT count(*) FROM topic_posts WHERE topic = ?", (original_typed,)
                ).fetchone()[0]
                if not _posts_n:
                    _dbm.conn.execute(
                        "DELETE FROM topic_prefs WHERE topic = ?", (original_typed,)
                    )
            _dbm.conn.commit()
        except Exception:
            pass

    # Now that the canonical is settled, do the ONE topic_prefs insert.
    try:
        from ..core.db import get_db as _get_db
        _db = _get_db()
        _db.conn.execute(
            "INSERT INTO topic_prefs (topic, scheduled, last_run_seen, last_run_ts) "
            "VALUES (?, 0, ?, ?) "
            "ON CONFLICT(topic) DO UPDATE SET last_run_ts=excluded.last_run_ts",
            (topic, _ts_iso(), _ts_iso()),
        )
        _db.conn.commit()
    except Exception:
        pass

    # Query expansion — use the LLM-scored keywords from the canonicalize
    # call to fan out per-source queries. Recall 3-5× vs the single canonical
    # string. `high`-only by default; `aggressive` adds `medium` too. Cap via
    # GAPMAP_MAX_KEYWORDS. For RSS sources we widen keyword fanout because
    # feeds are broad and strict phrase-only matching under-recalls.
    # Default lowered to 1 on 2026-04-20 — 5 keywords × 11 sources × 1 s
    # politeness ≈ 55 s added to every aggressive collect, which felt like
    # a hang to users. Opt in to higher recall via the env var once you've
    # seen the baseline latency.
    try:
        # Raised default 1 -> 4 -> 6 on 2026-04-24 so topics like "public
        # speaking anxiety app" capture synonyms (confident speaking,
        # speaking tricks, etc) out of the box. 6 × 1 s per-keyword
        # politeness adds ~5 s to external-source fan-out which is
        # negligible vs the collection's total wall-time. Tune via env.
        _max_kw = int(os.getenv("GAPMAP_MAX_KEYWORDS", "6") or "6")
    except ValueError:
        _max_kw = 6
    try:
        _min_kw = int(os.getenv("GAPMAP_MIN_KEYWORDS", "3") or "3")
    except ValueError:
        _min_kw = 3
    _max_kw = max(1, _max_kw)
    _min_kw = max(1, min(_min_kw, _max_kw))
    _min_rel = "medium" if aggressive else "high"
    _rel_rank = {"high": 3, "medium": 2, "low": 1}
    _min_rank = _rel_rank.get(_min_rel, 3)
    _all_canon_keywords = [
        k["keyword"]
        for k in (_canon.get("search_keywords") if isinstance(_canon, dict) else []) or []
        if k.get("keyword")
    ]
    search_keywords = [
        k["keyword"]
        for k in (_canon.get("search_keywords") if isinstance(_canon, dict) else []) or []
        if _rel_rank.get(k.get("relevance", "low"), 0) >= _min_rank
    ][:_max_kw]
    fallback_keywords = _fallback_keyword_candidates(search_topic)
    if len(search_keywords) < _min_kw:
        merged = list(dict.fromkeys([*search_keywords, *fallback_keywords]))
        search_keywords = merged[:_max_kw]
    # Always guarantee at least the canonical topic.
    if not search_keywords:
        search_keywords = [search_topic]
    # RSS-only enhancement: ensure enough LLM-derived terms are available for
    # feed matching, even when GAPMAP_MAX_KEYWORDS is globally conservative.
    if sources and any(str(s).startswith("rss") for s in sources):
        try:
            _rss_kw_cap = int(os.getenv("GAPMAP_RSS_KEYWORDS", "5") or "5")
        except ValueError:
            _rss_kw_cap = 5
        _rss_kw_cap = max(1, _rss_kw_cap)
        _dedup = list(dict.fromkeys([*search_keywords, *_all_canon_keywords, *fallback_keywords, search_topic]))
        search_keywords = _dedup[: max(len(search_keywords), _rss_kw_cap)]

    # Thread-safe log — prevents interleaved stdout writes when the parallel
    # stage has multiple workers emitting progress at once. Also guards
    # result.by_source / result.errors / result.posts_fetched mutations.
    _log_lock = threading.Lock()

    def _log(msg: str) -> None:
        if progress:
            with _log_lock:
                progress(msg)

    # 1. Discover if not provided (skip if skip_reddit and no subs given)
    if skip_reddit and not subs:
        # No need to discover subs if we're not fetching from Reddit at all.
        result.subs = []
        _log("skip_reddit=true → skipping Reddit discovery + fetch")
    elif subs is None:
        _log(f"discovering subs for '{search_topic}'…")
        try:
            found = discover_subs(search_topic, limit=8)
            # New shape: {"subs": [...], "confirmation": {...}}. Tolerate the
            # old list form for backward-compat with mocked tests.
            found_subs = found.get("subs", found) if isinstance(found, dict) else found
            subs = [s["name"] for s in found_subs if s.get("name")]
            # Expand subreddit discovery using top alternate keywords.
            for kw in search_keywords[1:4]:
                try:
                    alt = discover_subs(kw, limit=6)
                    alt_subs = alt.get("subs", alt) if isinstance(alt, dict) else alt
                    for s in alt_subs:
                        n = s.get("name")
                        if n and n not in subs:
                            subs.append(n)
                except Exception:
                    pass
            subs = subs[:12]
            _log(f"  → {subs}")
            time.sleep(_SLEEP)
            result.subs = subs
        except Exception as e:
            # Reddit public JSON intermittently returns empty / 403 / 429 —
            # don't kill the entire collect (HN / arXiv / App Store / gnews /
            # trends etc. are all independent of Reddit and should still run).
            _log(f"  ! discover failed: {type(e).__name__}: {e}. "
                 f"Continuing with non-Reddit sources only.")
            result.errors.append(f"discover_subs: {e}")
            subs = []
            result.subs = []
            skip_reddit = True  # don't let step 2/3 try to use empty subs
    else:
        result.subs = subs

    # 3b setup. We kick the external-sources pool off IN PARALLEL with the
    # Reddit stages below. Each external adapter hits a distinct host (HN,
    # arXiv, App Store, …), so there's no rate-limit contention with Reddit.
    # SQLite WAL (enabled in core.db) tolerates concurrent writers. Running
    # them concurrently turns a ~5-minute sequential collect into ~2-3 min
    # and — importantly — gives the user visible progress on ALL sources
    # from the start, instead of staring at reddit-only logs for minutes.
    ext_pool: ThreadPoolExecutor | None = None
    ext_futures: dict = {}
    ext_valid: list[str] = []
    if sources:
        from ..sources.collect_adapter import SOURCES

        for src in sources:
            if src in SOURCES:
                ext_valid.append(src)
            else:
                _log(f"  ! unknown source: {src}")
                result.errors.append(f"unknown source: {src}")

        def _run_source(src: str) -> tuple[str, int | dict | None, Exception | None, float]:
            """Run one source fetch; return (src, value, error, elapsed_s)."""
            t0 = time.monotonic()
            _log(f"[{src}] starting…")
            try:
                fn = SOURCES[src]
                # Adapters now accept either a single string (legacy) OR a
                # list of keywords (fanout). TypeError fallback keeps compat
                # with any adapter that hasn't been updated yet.
                try:
                    out = fn(search_keywords)
                except TypeError:
                    out = fn(search_keywords[0] if search_keywords else search_topic)
                return (src, out, None, time.monotonic() - t0)
            except Exception as e:
                return (src, None, e, time.monotonic() - t0)

        if ext_valid:
            workers = min(_PARALLEL_SOURCES, len(ext_valid))
            _log(f"[parallel] fetching {len(ext_valid)} sources across {workers} workers (concurrently with Reddit)…")
            ext_pool = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="gap-src")
            ext_futures = {ext_pool.submit(_run_source, s): s for s in ext_valid}

    # Wrap Reddit stages in try/finally so the external pool is always drained
    # and shut down, even if a Reddit stage raises unexpectedly. Without this,
    # an aborted collect could leak up to 6 daemon threads per abort.
    try:
        if not skip_reddit:
            # 2. Top-of-month / top-of-year per sub
            for sub in subs:
                for tf in ("month", "year"):
                    try:
                        _log(f"fetch r/{sub} top({tf}) limit={limit_per_sub}")
                        rows = fetch_posts(sub=sub, sort="top", limit=limit_per_sub, time_filter=tf)
                        tagged = _tag_posts(search_topic, [r["id"] for r in rows], source=f"top:{sub}:{tf}")
                        with _log_lock:
                            result.posts_fetched += tagged
                            result.by_source[f"top:{sub}:{tf}"] = tagged
                    except Exception as e:
                        msg = f"top {sub}/{tf}: {e}"
                        _log(f"  ! {msg}")
                        with _log_lock:
                            result.errors.append(msg)
                    time.sleep(_SLEEP)

            # 3. Parameterized searches — fan out across expanded keywords, but
            # CAPPED and PARALLELIZED (see the GAPMAP_SEARCH_* env docs above).
            # We build a budgeted (category, query) worklist, decide the target
            # subs (r/all by default — it already covers every sub), then run
            # the searches through a bounded thread pool instead of one-at-a-time.
            _budget = _env_int("GAPMAP_MAX_SEARCH_QUERIES", 24, minimum=1)
            worklist = _build_search_worklist(search_keywords, query_categories, _budget)

            # Targets: r/all by default. Only scope to individual subs if the
            # caller asked AND a positive cap is configured — capped to the top
            # N subs so we never re-introduce the ×(all subs) explosion.
            _sub_cap = _env_int("GAPMAP_SEARCH_SUB_CAP", 0, minimum=0)
            if sub_scope_search and subs and _sub_cap > 0:
                targets: list[str | None] = [None, *subs[:_sub_cap]]
            else:
                targets = [None]

            tasks = [(cat, q, tgt) for (cat, q) in worklist for tgt in targets]
            _workers = min(_env_int("GAPMAP_SEARCH_WORKERS", 4, minimum=1), max(1, len(tasks)))
            _log(
                f"query expansion: {len(search_keywords)} keywords → "
                f"{len(worklist)} queries (capped at {_budget}); "
                f"{len(tasks)} searches across {_workers} workers"
            )

            def _run_search(task: tuple[str, str, str | None]):
                cat, q, tgt = task
                try:
                    rows = search_reddit(
                        query=q,
                        sub=tgt,
                        sort="relevance",
                        time_filter="year",
                        limit=limit_per_query,
                    )
                    tagged = _tag_posts(
                        search_topic,
                        [r["id"] for r in rows],
                        source=f"search:{cat}:{tgt or 'all'}:{q}",
                    )
                    # Light per-request pacing so a wide pool doesn't burst the
                    # public endpoint into a 429. PRAW (auth mode) self-throttles.
                    time.sleep(_SEARCH_PACING)
                    return (cat, q, tgt, tagged, None)
                except Exception as e:  # noqa: BLE001 — captured per-task, never fatal
                    return (cat, q, tgt, 0, e)

            if tasks:
                with ThreadPoolExecutor(
                    max_workers=_workers, thread_name_prefix="gap-search"
                ) as spool:
                    sfutures = {spool.submit(_run_search, t): t for t in tasks}
                    for fut in as_completed(sfutures):
                        cat, q, tgt, tagged, err = fut.result()
                        if err is not None:
                            msg = f"search {cat} {q!r}: {err}"
                            _log(f"  ! {msg}")
                            with _log_lock:
                                result.errors.append(msg)
                        else:
                            _log(
                                f"search {cat!r}: {q!r}"
                                + (f" in r/{tgt}" if tgt else "")
                                + f" → {tagged}"
                            )
                            with _log_lock:
                                result.posts_fetched += tagged
                                key = f"search:{cat}"
                                result.by_source[key] = result.by_source.get(key, 0) + tagged

        # 4. Historical — pullpush (pre-May-2025). Runs on main thread after
        # Reddit stages finish; pullpush is a different host from Reddit's
        # public API but keeping it sequential avoids contention with a
        # still-running top/search burst. External-source pool keeps
        # streaming in parallel.
        if include_historical:
            for sub in subs:
                try:
                    _log(f"historical r/{sub} last {historical_days}d pre-cutoff, limit={historical_limit_per_sub}")
                    hrows = fetch_historical(
                        sub=sub,
                        kind="submission",
                        days=historical_days,
                        limit=historical_limit_per_sub,
                    )
                    tagged = _tag_posts(search_topic, [r["id"] for r in hrows], source=f"pullpush:{sub}")
                    with _log_lock:
                        result.posts_fetched += tagged
                        result.by_source[f"pullpush:{sub}"] = tagged
                except Exception as e:
                    msg = f"pullpush {sub}: {e}"
                    _log(f"  ! {msg}")
                    with _log_lock:
                        result.errors.append(msg)
                time.sleep(_SLEEP)
    finally:
        # 3b (drain). Join the external-source pool — some workers may still
        # be in flight while Reddit finished early, or the pool may already
        # be done if Reddit took a long time. Collect per-source results so
        # the final log line reflects every provider. Always executed, even
        # if a Reddit stage raised — keeps the pool from leaking threads.
        if ext_pool is not None and ext_futures:
            done_count = 0
            # Overall budget to wait for the pool. Stragglers (yt-dlp YouTube,
            # pytrends, pubmed) can otherwise hang the entire collect for many
            # minutes. We process whatever finishes within the budget and mark
            # the rest as timed-out — see GAPMAP_SOURCE_TIMEOUT_SEC above.
            _src_timeout = _env_float("GAPMAP_SOURCE_TIMEOUT_SEC", 90.0, minimum=5.0)
            pending = set(ext_futures.keys())
            try:
                for fut in as_completed(ext_futures, timeout=_src_timeout):
                    pending.discard(fut)
                    src, out, err, elapsed = fut.result()
                    done_count += 1
                    prefix = f"[{done_count}/{len(ext_valid)}] [{src}]"
                    if err is not None:
                        msg = f"{prefix} ✗ {err} ({elapsed:.1f}s)"
                        _log(msg)
                        with _log_lock:
                            result.errors.append(f"source:{src}: {err}")
                    elif src == "trends":
                        # trends returns dict of keyword → trend series, not a post count
                        _log(f"{prefix} ✓ trends series collected ({elapsed:.1f}s)")
                        with _log_lock:
                            result.by_source[f"source:{src}"] = out
                    else:
                        n = int(out or 0)
                        _log(f"{prefix} ✓ {n} posts ({elapsed:.1f}s)")
                        with _log_lock:
                            result.posts_fetched += n
                            result.by_source[f"source:{src}"] = n
            except FuturesTimeout:
                # Budget elapsed before every source finished — keep what we got.
                for fut in pending:
                    if not fut.done():
                        src = ext_futures[fut]
                        _log(f"  ! [{src}] ✗ timed out after {_src_timeout:.0f}s — skipped")
                        with _log_lock:
                            result.errors.append(f"source:{src}: timed out after {_src_timeout:.0f}s")
            # Don't block on still-running daemon-ish workers (yt-dlp etc.);
            # cancel what hasn't started and let the rest die with the process.
            ext_pool.shutdown(wait=False, cancel_futures=True)

    # Legacy inline-extraction path. Preserved for CLI back-compat with
    # callers that don't run the long-lived enrich worker. Tauri's
    # `start_collect` command sets `skip_extraction=True` because the
    # frontend supervises the worker which incrementally drains the
    # `extraction_queue` we populated in `_tag_posts`. Keeping this gated
    # also means the DMG footprint doesn't block on a 2-minute LLM call
    # at the tail of every collect.
    #
    # Current tree no longer has a direct `enrich_from_llm(topic=...)` call
    # here (removed during the multi-source refactor), but we keep the flag
    # plumbed so any future inline step inherits the opt-out automatically
    # — and so the contract documented in the plan holds.
    if not skip_extraction and aggressive:
        try:
            from ..graph.semantic import enrich_from_llm
            enrich_from_llm(topic=search_topic)
        except Exception as e:
            result.errors.append(f"inline_enrich: {e}")

    _log(f"done. {result.posts_fetched} posts tagged for '{search_topic}'.")
    return result


def corpus_temporal_split(
    topic: str,
    cutoff_utc: int | None = None,
    limit_per_bucket: int = 100,
    min_score: int = 1,
) -> dict:
    """Return the topic corpus split into pre/post May-2025 buckets.

    Use this to ask Claude (or another LLM) to compare pain patterns across
    the two eras — chronic vs emerging vs fading signals.
    """
    cutoff = cutoff_utc or CUTOFF_UTC
    db = get_db()

    def _pull(where_clause: str, params: list) -> list[dict]:
        # Academic sources (arxiv/pubmed/scholar/openalex) + ingested files
        # don't have Reddit-style engagement scores; many return score=0.
        # Exempt them from the min_score floor — otherwise the LLM never sees
        # the very papers the user collected to ground their analysis.
        sql = f"""
            SELECT p.id, p.sub, p.author, p.title,
                   substr(p.selftext, 1, 500) AS selftext,
                   p.score, p.num_comments, p.created_utc,
                   coalesce(p.source_type, 'reddit') AS source_type
            FROM posts p JOIN topic_posts tp ON tp.post_id = p.id
            WHERE tp.topic = ?
              AND (p.score >= ? OR coalesce(p.source_type,'reddit') != 'reddit')
              {where_clause}
            ORDER BY (p.num_comments * 2 + p.score) DESC
            LIMIT ?
        """
        return list(db.query(sql, [topic, min_score, *params, limit_per_bucket]))

    return {
        "topic": topic,
        "cutoff_utc": cutoff,
        "pre_2025": _pull("AND p.created_utc < ?", [cutoff]),
        "post_2025": _pull("AND p.created_utc >= ?", [cutoff]),
    }


def corpus_for(topic: str, limit: int = 200, min_score: int = 1) -> list[dict[str, Any]]:
    """Pull the collected corpus for a topic, newest-engaged first.

    min_score only gates Reddit posts. Academic sources (arxiv / pubmed /
    openalex / scholar) and ingested files (pdfs / local docs) are always
    included regardless of score, because their fetchers don't populate a
    meaningful engagement number — a zero-citation arxiv paper is still
    signal, and silently filtering it was a bug.
    """
    db = get_db()
    _sql = """
            SELECT p.id, p.sub, p.author, p.title, p.selftext,
                   p.score, p.num_comments, p.created_utc, p.permalink,
                   p.url, coalesce(p.source_type, 'reddit') AS source_type
            FROM posts p
            JOIN topic_posts tp ON tp.post_id = p.id
            WHERE tp.topic = ?
              AND (p.score >= ? OR coalesce(p.source_type,'reddit') != 'reddit')
            ORDER BY (p.num_comments * 2 + p.score) DESC
            LIMIT ?
            """
    rows = list(db.query(_sql, [topic, min_score, limit]))
    if rows:
        return rows
    # Zero rows under the literal topic. The corpus may live under a canonical
    # name: collect resolves topics on WRITE (resolve_topic), so an older /
    # drifted product topic (e.g. "Indian samaj community help app", whose data
    # was LLM-canonicalized to "Indian community help app" at collect time) has
    # its posts stored under the canonical key. Resolve READ-ONLY and retry
    # ONCE. Guarded on empty so a topic that has its own corpus is never
    # hijacked by a canonicalization mapping.
    try:
        from .topic_resolver import canonical_for_read
        canonical = canonical_for_read(topic)
    except Exception:
        canonical = topic
    if canonical and canonical != topic:
        return list(db.query(_sql, [canonical, min_score, limit]))
    return rows
