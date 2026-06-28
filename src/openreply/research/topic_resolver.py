"""One-source-of-truth topic resolver — stops "3 rows for one search" bugs.

The problem this solves: user types "Indian student exam stress" → we end
up with three topic_prefs rows:
  1. "Indian student exam stress"   (user-typed, caps preserved)
  2. "indian student exam stress"   (LLM canonicalization lowercased it)
  3. "indian-student-exam-pain"     (some other codepath slugified it)

All three have posts tagged against them. The Dashboard shows three tiles.
The graph splits evidence across three corpora. Synthesis ignores two-thirds
of the posts.

Fix: every write path (collect, _tag_posts, MCP upsert_semantic, product
registration, anywhere else) now calls `resolve_topic(user_input)` to get
the canonical storage key BEFORE touching topic_posts / topic_prefs / graph.

Resolution order (cheapest → most expensive):
  1. `strip()` + collapse internal whitespace + `casefold()`
  2. Lookup the normalized form in `topic_aliases` table — a reverse index
     we populate as variants are observed
  3. If no alias exists, check `topic_canonicalizations.original = input`
     (legacy path from discover._canonicalize_topic)
  4. If still unresolved, this IS the canonical form — insert itself as
     alias so the next variant lands on us

All hops are case-insensitive. No LLM call.

Public API:
  - resolve_topic(user_input, register=True) -> canonical_topic_str
  - register_alias(user_input, canonical)
  - merge_duplicate_topics(dry_run=True) -> {merged: [...], kept: [...]}
"""
from __future__ import annotations

import logging
import re
from typing import Any

from ..core.db import get_db

logger = logging.getLogger(__name__)

# ─── Internal normalization ────────────────────────────────────────────
_WS = re.compile(r"\s+")
_SLUG = re.compile(r"[^a-z0-9]+")


def _norm_loose(s: str) -> str:
    """Liberal normalization for bucket matching — casefold + collapse
    whitespace + strip. Does NOT remove punctuation or slugify; "indian
    student" and "Indian  Student" bucket together but "indian-student"
    stays separate here (we catch that via `_norm_slug` below)."""
    if not s:
        return ""
    return _WS.sub(" ", s.strip()).casefold()


def _norm_slug(s: str) -> str:
    """Strict slug — used as a second-level bucket so hyphenated variants
    ("indian-student-exam") join their space-separated siblings ("indian
    student exam") in the alias index."""
    if not s:
        return ""
    return _SLUG.sub("-", _norm_loose(s)).strip("-")


def _ensure_alias_table() -> None:
    db = get_db()
    if "topic_aliases" in db.table_names():
        return
    db["topic_aliases"].create(
        {
            "alias_norm": str,     # either _norm_loose OR _norm_slug output
            "canonical": str,      # the storage key all variants collapse to
            "source": str,         # 'user' | 'llm' | 'slug' | 'auto'
            "created_at": str,
        },
        pk="alias_norm",
    )
    db["topic_aliases"].create_index(["canonical"])


# ─── Public API ────────────────────────────────────────────────────────
def resolve_topic(user_input: str, register: bool = False) -> str:
    """Return the canonical storage key for a topic input.

    Contract refinement (2026-04-21 clarification): this function ONLY
    resolves to another string when a prior LLM canonicalization or an
    explicit merge created an alias binding. It does NOT auto-lowercase,
    auto-slugify, or silently redirect user input. User intent wins —
    if they type a new casing / hyphenation, it's treated as their input,
    not silently rewritten.

    Args:
        user_input: whatever the user typed.
        register: default False. Only True when called from the LLM
                  canonicalize path or an explicit merge — we never
                  populate aliases from user input alone.

    Returns:
        The canonical string from topic_aliases if one exists, otherwise
        user_input.strip() unchanged.
    """
    if not user_input or not user_input.strip():
        return ""
    stripped = user_input.strip()
    db = get_db()
    _ensure_alias_table()

    loose = _norm_loose(stripped)
    slug = _norm_slug(stripped)

    # Consult the alias table — populated only by the LLM canonicalize path
    # and retroactive merges. Never auto-populated from user input.
    for norm in (loose, slug):
        if not norm:
            continue
        rows = list(db.query(
            "SELECT canonical FROM topic_aliases WHERE alias_norm = ?", [norm]
        ))
        if rows:
            return rows[0]["canonical"]

    # No alias binding exists → user input IS the canonical. Do not insert
    # anything; the user is in charge of what their topic is called.
    return stripped


def canonical_for_read(topic: str) -> str:
    """Resolve a topic to its canonical storage key for READ-ONLY lookups.

    `resolve_topic` deliberately does NOT consult `topic_canonicalizations`
    (the 2026-04-21 clarification: a write path must never silently redirect
    what the user typed). But READ paths — corpus fetch, enrichment, map
    export — just need to find where the data actually landed. When a user's
    search was LLM-canonicalized at collect time (e.g. product topic
    "Indian samaj community help app" → corpus stored under
    "Indian community help app"), the alias table may not carry the binding
    while `topic_canonicalizations.original` does. This helper honors both:

      1. topic_aliases (loose/slug normalized)        — same as resolve_topic
      2. topic_canonicalizations.original (casefold)  — legacy discover path

    Returns the input unchanged when nothing maps. Never writes, never
    registers. Safe to call on any read because callers gate on it (see
    `corpus_for`, which only resolves when the literal topic has zero rows).
    """
    if not topic or not topic.strip():
        return topic or ""
    stripped = topic.strip()
    # Step 1 — alias table (reuse resolve_topic's normalized lookup).
    resolved = resolve_topic(stripped, register=False)
    if resolved and resolved != stripped:
        return resolved
    # Step 2 — legacy LLM-canonicalization table, case-insensitive on the
    # original side. Only honor a mapping that actually points somewhere else.
    db = get_db()
    try:
        if "topic_canonicalizations" in db.table_names():
            for r in db.query(
                "SELECT canonical FROM topic_canonicalizations "
                "WHERE lower(original) = lower(?) AND canonical != '' "
                "AND canonical != original LIMIT 1",
                [stripped],
            ):
                c = (r["canonical"] or "").strip()
                if c:
                    return c
    except Exception as e:
        logger.debug("canonical_for_read canonicalizations lookup failed: %s", e)
    return stripped


def find_existing_topic(user_input: str) -> dict[str, Any] | None:
    """Read-only: does a semantically-identical topic ALREADY exist in the
    corpus? Returns the best existing variant + post count, or None if
    nothing matches the loose/slug normalization.

    Use this to prompt the user: "A topic 'indian student exam stress'
    with 139 posts already exists. Open it, add more data to it, or
    create a new separate topic?" Lets the UI respect user intent
    without silently merging.
    """
    if not user_input or not user_input.strip():
        return None
    stripped = user_input.strip()
    loose = _norm_loose(stripped)
    slug = _norm_slug(stripped)
    existing = _find_existing_variant(loose, slug)
    if not existing or existing == stripped:
        return None
    db = get_db()
    try:
        n = next(db.query(
            "SELECT count(*) AS n FROM topic_posts WHERE topic = ?", [existing]
        ))["n"]
    except Exception:
        n = 0
    return {"existing_topic": existing, "posts": n, "user_input": stripped}


def _find_existing_variant(loose: str, slug: str) -> str | None:
    """Scan topic_prefs + distinct topic_posts for a row whose normalized
    form matches. Return the form with the most posts (or most recently
    used) — that's the winner."""
    db = get_db()
    candidates: dict[str, int] = {}
    try:
        for r in db.query("SELECT topic FROM topic_prefs"):
            t = r["topic"] or ""
            if _norm_loose(t) == loose or _norm_slug(t) == slug:
                candidates[t] = candidates.get(t, 0)
    except Exception:
        pass
    try:
        for r in db.query(
            "SELECT topic, count(*) AS n FROM topic_posts GROUP BY topic"
        ):
            t = r["topic"] or ""
            if _norm_loose(t) == loose or _norm_slug(t) == slug:
                candidates[t] = candidates.get(t, 0) + r["n"]
    except Exception:
        pass
    if not candidates:
        return None
    # Winner = most posts (ties broken by lexicographic for determinism)
    return sorted(candidates.items(), key=lambda kv: (-kv[1], kv[0]))[0][0]


def register_alias(alias: str, canonical: str, source: str = "user") -> None:
    """Idempotently record alias → canonical mapping."""
    if not alias or not canonical:
        return
    from datetime import datetime, timezone
    db = get_db()
    _ensure_alias_table()
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    for norm in {_norm_loose(alias), _norm_slug(alias)}:
        if not norm:
            continue
        try:
            db["topic_aliases"].upsert({
                "alias_norm": norm,
                "canonical": canonical,
                "source": source,
                "created_at": now,
            }, pk="alias_norm")
        except Exception as e:
            logger.debug("alias register failed: %s", e)


def merge_duplicate_topics(
    dry_run: bool = True,
) -> dict[str, Any]:
    """Retroactive sweep — merge ONLY the duplicate rows that the system
    created itself via LLM canonicalization or slug transformation.

    User re-searches are NEVER merged, because we can't tell if the user
    meant to reuse data or start fresh. They're handled at search-time
    via `find_existing_topic` + UI prompt, not here.

    A row is considered "system-caused" if it's connected to another row
    by an entry in `topic_canonicalizations` (original → canonical). That's
    the only signal that tells us: "these two strings exist because the LLM
    rewrote one into the other". Pure case/slug variants of user input
    without an LLM link stay separate until the user explicitly merges them.

    Winner rules:
      1. The canonical side of the topic_canonicalizations row wins by default
      2. If multiple canonical candidates exist (both were LLM outputs), the
         one with the most posts wins
      3. Ties broken lexicographically

    Side effects when apply=True:
      - INSERT OR IGNORE topic_posts rows from losers → winner
      - DELETE topic_posts / topic_prefs / graph_nodes / graph_edges under losers
      - Register loser → winner in topic_aliases (source=merge)
    """
    db = get_db()
    if "topic_canonicalizations" not in db.table_names():
        return {"ok": True, "dry_run": dry_run, "merge_count": 0,
                "reason": "no topic_canonicalizations table — nothing to merge",
                "merges": []}

    # Build a graph of (original, canonical) pairs where both live in
    # topic_prefs/topic_posts. Each connected component is a merge bucket.
    known_topics: set[str] = set()
    try:
        for r in db.query("SELECT topic FROM topic_prefs"):
            known_topics.add(r["topic"] or "")
    except Exception:
        pass
    try:
        for r in db.query("SELECT DISTINCT topic FROM topic_posts"):
            known_topics.add(r["topic"] or "")
    except Exception:
        pass
    known_topics.discard("")

    # Pairs to consider: rows of topic_canonicalizations where both original
    # and canonical appear in known_topics (a real duplicate we can merge)
    pairs: list[tuple[str, str]] = []
    for r in db.query(
        "SELECT original, canonical FROM topic_canonicalizations "
        "WHERE canonical != '' AND canonical != original"
    ):
        o, c = r["original"] or "", r["canonical"] or ""
        if o in known_topics and c in known_topics:
            pairs.append((o, c))

    # Also pull from topic_aliases (source=llm|merge) — a topic explicitly
    # flagged as an alias that now has its own rows (race between tag_posts
    # and canonicalize) should also merge.
    _ensure_alias_table()
    try:
        for r in db.query(
            "SELECT alias_norm, canonical FROM topic_aliases WHERE source IN ('llm','merge')"
        ):
            c = r["canonical"]
            if not c or c not in known_topics:
                continue
            # Find concrete topics whose loose/slug norm matches alias_norm
            for t in known_topics:
                if t == c:
                    continue
                if _norm_loose(t) == r["alias_norm"] or _norm_slug(t) == r["alias_norm"]:
                    pairs.append((t, c))
    except Exception:
        pass

    if not pairs:
        return {"ok": True, "dry_run": dry_run, "merge_count": 0,
                "reason": "no LLM-caused duplicates detected",
                "merges": []}

    # Union-find over pairs so N>2 component chains merge together.
    parent: dict[str, str] = {}
    def find(x: str) -> str:
        while parent.setdefault(x, x) != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x
    def union(a: str, b: str) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    for a, b in pairs:
        union(a, b)

    # Group topics by root
    buckets: dict[str, list[str]] = {}
    for t in set([p for ab in pairs for p in ab]):
        buckets.setdefault(find(t), []).append(t)

    # Post counts for winner selection
    counts: dict[str, int] = {}
    try:
        for r in db.query("SELECT topic, count(*) AS n FROM topic_posts GROUP BY topic"):
            counts[r["topic"] or ""] = r["n"]
    except Exception:
        pass

    merges: list[dict[str, Any]] = []
    for _, members in buckets.items():
        if len(members) < 2:
            continue
        members_sorted = sorted(members, key=lambda t: (-counts.get(t, 0), t))
        winner = members_sorted[0]
        losers = members_sorted[1:]
        merges.append({
            "winner": winner,
            "winner_posts": counts.get(winner, 0),
            "losers": losers,
            "loser_posts": [counts.get(t, 0) for t in losers],
            "source": "llm_canonicalization",
        })

    if dry_run:
        return {"ok": True, "dry_run": True, "merge_count": len(merges),
                "merges": merges}

    # Apply merges
    total_moved_posts = 0
    for m in merges:
        winner = m["winner"]
        for loser in m["losers"]:
            try:
                # INSERT OR IGNORE-style via temp table — copy loser rows
                # onto winner where (winner, post_id) doesn't already exist.
                db.conn.execute(
                    "INSERT OR IGNORE INTO topic_posts (topic, post_id, source, added_at) "
                    "SELECT ?, post_id, source, added_at FROM topic_posts WHERE topic = ?",
                    (winner, loser),
                )
                # Count how many rows actually moved (winner count pre/post)
                db.conn.execute("DELETE FROM topic_posts WHERE topic = ?", (loser,))
                db.conn.execute("DELETE FROM topic_prefs WHERE topic = ?", (loser,))
                # Graph nodes/edges — point them at the winner too
                for tbl in ("graph_nodes", "graph_edges"):
                    try:
                        db.conn.execute(
                            f"UPDATE OR IGNORE {tbl} SET topic = ? WHERE topic = ?",
                            (winner, loser),
                        )
                    except Exception:
                        pass
                # Record alias so future writes with `loser` land on winner
                register_alias(loser, winner, source="merge")
            except Exception as e:
                logger.warning("merge %s → %s failed: %s", loser, winner, e)
        db.conn.commit()
        total_moved_posts += sum(m["loser_posts"])

    return {"ok": True, "dry_run": False, "merge_count": len(merges),
            "posts_moved": total_moved_posts, "merges": merges}


# ─── Arbitrary two-topic merge (user-driven) ───────────────────────────
def _topic_keyed_tables(db) -> list[str]:
    """Every user table that has a `topic` column — derived from the live
    schema so a newly-added table can never silently be missed by a merge."""
    out: list[str] = []
    seen: set[str] = set()
    for tname in db.table_names():
        if tname in seen:
            continue
        seen.add(tname)
        try:
            cols = [c.name for c in db[tname].columns]
        except Exception:
            continue
        if "topic" in cols:
            out.append(tname)
    return out


def _post_count(db, topic: str) -> int:
    try:
        return next(
            db.query(
                "SELECT count(*) AS n FROM topic_posts WHERE topic = ?", [topic]
            )
        )["n"]
    except Exception:
        return 0


def _known_topics(db) -> set[str]:
    known: set[str] = set()
    for sql in (
        "SELECT topic FROM topic_prefs",
        "SELECT DISTINCT topic FROM topic_posts",
    ):
        try:
            for r in db.query(sql):
                known.add(r["topic"] or "")
        except Exception:
            pass
    known.discard("")
    return known


def _repoint_topic(db, source: str, target: str) -> None:
    """Move ALL of ``source``'s data onto ``target`` across every
    topic-keyed table.

    The uniform ``UPDATE OR IGNORE … ; DELETE …`` pair correctly handles
    all three table classes in one pass:

      * composite PK incl. topic (``topic_posts(topic, post_id)``,
        ``extraction_queue``, ``experiments``, ``topic_pipeline_config``)
        — rows already present under the target are skipped by the
        ``OR IGNORE``; the source's leftovers are then deleted (dedupes
        shared posts).
      * single row per topic (``topic_prefs``, ``topic_insights``,
        ``launch_briefs``, ``topic_favorites``) — the target's existing
        row blocks the update (topic is the PK), so the target keeps its
        own report and the source row is dropped.
      * plain ``topic`` column (chats, graph, personas, papers, …) —
        every row is re-pointed; nothing is left to delete.

    ``graph_nodes`` (id PK) / ``graph_edges`` (src,dst,kind PK) fit the
    same pattern: id/PK collisions are ignored and the leftovers deleted.

    Caller wraps this in a transaction for all-or-nothing safety.
    """
    for tbl in _topic_keyed_tables(db):
        try:
            db.execute(
                f"UPDATE OR IGNORE {tbl} SET topic = :t WHERE topic = :s",
                {"t": target, "s": source},
            )
            db.execute(f"DELETE FROM {tbl} WHERE topic = :s", {"s": source})
        except Exception as e:  # noqa: BLE001 — skip any odd table, keep going
            logger.debug("repoint %s failed for %s: %s", tbl, source, e)


def merge_topics(source: str, target: str, apply: bool = False) -> dict[str, Any]:
    """Merge two arbitrary user-chosen topics: re-point ALL of ``source``'s
    data into ``target``, then remove the source.

    Unlike :func:`merge_duplicate_topics` (which only collapses topics that
    the system itself split via LLM canonicalization), this merges two
    topics the user has explicitly decided are the same — regardless of
    name similarity.

    ``apply=False`` (default) is a non-mutating dry-run returning a preview
    of exactly what would move. ``apply=True`` performs the merge inside a
    single transaction (all-or-nothing).

    Returns a report dict; ``ok=False`` with an ``error`` on invalid input
    (empty names, self-merge, or missing source).
    """
    db = get_db()
    source = (source or "").strip()
    target = (target or "").strip()

    if not source or not target:
        return {"ok": False, "error": "both source and target are required"}
    if source == target:
        return {"ok": False, "error": "cannot merge a topic into itself"}
    if source not in _known_topics(db):
        return {"ok": False, "error": f"source topic not found: {source}"}

    def _count_topic(tbl: str) -> int:
        try:
            return next(
                db.query(
                    f"SELECT count(*) AS n FROM {tbl} WHERE topic = ?", [source]
                )
            )["n"]
        except Exception:
            return 0

    src_posts = _post_count(db, source)
    tgt_posts = _post_count(db, target)
    try:
        dup = next(
            db.query(
                "SELECT count(*) AS n FROM topic_posts a "
                "WHERE a.topic = ? AND EXISTS ("
                "  SELECT 1 FROM topic_posts b "
                "  WHERE b.topic = ? AND b.post_id = a.post_id)",
                [source, target],
            )
        )["n"]
    except Exception:
        dup = 0

    report: dict[str, Any] = {
        "ok": True,
        "dry_run": not apply,
        "source": source,
        "target": target,
        "source_posts": src_posts,
        "target_posts": tgt_posts,
        "posts_to_move": max(0, src_posts - dup),
        "duplicate_posts_skipped": dup,
        "nodes_to_move": _count_topic("graph_nodes"),
        "chats_to_move": _count_topic("chat_conversations"),
        "tables_touched": _topic_keyed_tables(db),
    }

    if not apply:
        return report

    # All-or-nothing: the sqlite3 connection context manager commits on
    # success and rolls back on any exception inside the block.
    with db.conn:
        _repoint_topic(db, source, target)
        # Route future references to `source` toward `target`.
        register_alias(source, target, source="merge")
        try:
            db.execute(
                "UPDATE topic_canonicalizations SET canonical = :t "
                "WHERE canonical = :s",
                {"t": target, "s": source},
            )
        except Exception:
            pass

    report["merged"] = True
    report["target_posts_after"] = _post_count(db, target)
    return report


__all__ = [
    "resolve_topic",
    "register_alias",
    "merge_duplicate_topics",
    "merge_topics",
]
