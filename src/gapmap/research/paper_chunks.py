"""Chunk a paper's full text into embedding-friendly windows.

Strategy: section-aware sliding window with sentence-boundary respect.
Each chunk's ``id`` is stable (``"{post_id}#sec={name}#ord={n}"``) so
re-runs are upserts, not inserts. Chunk text is hashed; unchanged hashes
skip re-embedding.

Inputs: ``paper_full_texts`` (cached text) + ``paper_sections`` (boundaries).
Output: ``paper_chunks`` rows + (optionally) Mempalace upserts.

Defaults are tuned for MiniLM/bge-style 384/512-token embedders:
    target ≈ 1500 chars (~380 tokens)
    overlap ≈ 200 chars
Both env-tunable via ``PAPER_CHUNK_TARGET_CHARS`` / ``PAPER_CHUNK_OVERLAP_CHARS``.

Public API:

    chunk_paper(post_id, *, force=False) -> dict
    get_chunks(post_id) -> list[dict]
    chunk_topic(topic, *, embed=True, limit=None) -> dict
"""
from __future__ import annotations

import hashlib
import os
import re
from datetime import datetime, timezone
from typing import Any, Iterable

from ..core.db import get_db
from .paper_fulltext import _cache_path
from .paper_sections import parse_sections_for, get_sections

TARGET_CHARS = int(os.getenv("PAPER_CHUNK_TARGET_CHARS") or 1500)
OVERLAP_CHARS = int(os.getenv("PAPER_CHUNK_OVERLAP_CHARS") or 200)
MIN_CHUNK_CHARS = 200  # below this we drop the chunk (heading-only / artefact)

# Sentence-end heuristic. Conservative — we'd rather chunk on paragraph
# boundaries when present and only fall back to sentence ends.
_SENT_END_RE = re.compile(r"(?<=[.!?])\s+(?=[A-Z(])")
_PARAGRAPH_RE = re.compile(r"\n\s*\n")


def _ensure_table() -> None:
    """Create paper_chunks idempotently."""
    db = get_db()
    if "paper_chunks" not in db.table_names():
        db["paper_chunks"].create(
            {
                "id": str,
                "post_id": str,
                "section": str,
                "ord": int,
                "char_start": int,
                "char_end": int,
                "text": str,
                "char_count": int,
                "hash": str,
                "embedded_at": str,
                "embed_backend": str,
                "created_at": str,
            },
            pk="id",
        )
        db["paper_chunks"].create_index(["post_id"])
        db["paper_chunks"].create_index(["section"])
        db["paper_chunks"].create_index(["hash"])


def _slide(text: str, base_offset: int) -> list[tuple[int, int]]:
    """Slide a window of TARGET_CHARS over ``text``, snapping breaks to
    paragraph or sentence boundaries when possible. Returns
    ``[(char_start, char_end), ...]`` with offsets relative to ``base_offset``.
    """
    n = len(text)
    if n <= TARGET_CHARS:
        return [(base_offset, base_offset + n)] if n >= MIN_CHUNK_CHARS else []
    spans: list[tuple[int, int]] = []
    cursor = 0
    while cursor < n:
        end = min(cursor + TARGET_CHARS, n)
        # Snap to nearest paragraph break in the back-half of the window
        # so chunks don't sever paragraphs.
        if end < n:
            window = text[cursor:end]
            backsearch_lo = int(len(window) * 0.5)  # only snap back at most half
            para = list(_PARAGRAPH_RE.finditer(window, backsearch_lo))
            if para:
                end = cursor + para[-1].start()
            else:
                sents = list(_SENT_END_RE.finditer(window, backsearch_lo))
                if sents:
                    end = cursor + sents[-1].start() + 1
        end = max(end, cursor + MIN_CHUNK_CHARS)  # don't get stuck
        spans.append((base_offset + cursor, base_offset + end))
        if end >= n:
            break
        # Step forward by (target - overlap) but never less than half the
        # window — prevents pathological infinite loops on weird text.
        step = max(TARGET_CHARS - OVERLAP_CHARS, TARGET_CHARS // 2)
        cursor = max(cursor + step, end - OVERLAP_CHARS)
    # Drop the trailing chunk if it ended up too small after snap-back.
    if spans and (spans[-1][1] - spans[-1][0]) < MIN_CHUNK_CHARS and len(spans) > 1:
        spans.pop()
    return spans


def _hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8", errors="replace")).hexdigest()[:32]


def _load_full_text(post_id: str) -> tuple[str | None, str | None]:
    """Return (text, source) for a post with a cached full-text, else (None, None)."""
    db = get_db()
    rows = list(db.query(
        "SELECT source FROM paper_full_texts WHERE post_id = ? AND status='ok'",
        [post_id],
    ))
    if not rows:
        return None, None
    src = rows[0]["source"]
    cache = _cache_path(src, post_id)
    if not cache.exists():
        return None, None
    return cache.read_text(encoding="utf-8", errors="replace"), src


def chunk_paper(post_id: str, *, force: bool = False, embed: bool = True) -> dict[str, Any]:
    """Build chunks for a single paper. Idempotent — unchanged chunk
    hashes are skipped on re-runs. When ``embed=True``, freshly-changed
    chunks are upserted into Mempalace's ``paper_chunks`` collection.

    Returns ``{ok, post_id, n_chunks, n_new, n_unchanged, embedded}``.
    """
    # Explicit academic-source guard (defense in depth — chunking normally only
    # runs after the academic-only full-text gate, but never embed a
    # reddit/appstore/etc. post into the paper palace by accident).
    if embed:
        from .sources import is_academic_source
        _src_rows = list(get_db().query(
            "SELECT coalesce(source_type,'reddit') AS s FROM posts WHERE id = ?",
            [post_id],
        ))
        if _src_rows and not is_academic_source(_src_rows[0]["s"]):
            return {"ok": True, "post_id": post_id, "n_chunks": 0,
                    "n_new": 0, "n_unchanged": 0, "embedded": 0,
                    "skipped": "non_academic_source"}

    text, source = _load_full_text(post_id)
    if text is None:
        return {"ok": False, "post_id": post_id,
                "error": "no full-text cache (run paper-fulltext first)"}

    # Ensure sections are parsed. parse_sections_for is idempotent.
    parse_sections_for(post_id, force=False)
    sections = get_sections(post_id) or [{
        "name": "body", "ord": 0, "char_start": 0, "char_end": len(text),
        "char_count": len(text), "raw_heading": "",
    }]

    _ensure_table()
    db = get_db()

    chunks: list[dict] = []
    chunk_ord = 0
    for sec in sections:
        sec_text = text[sec["char_start"]:sec["char_end"]]
        spans = _slide(sec_text, base_offset=sec["char_start"])
        for (cs, ce) in spans:
            ctext = text[cs:ce].strip()
            if len(ctext) < MIN_CHUNK_CHARS:
                continue
            chunks.append({
                "id": f"{post_id}#sec={sec['name']}#ord={chunk_ord}",
                "post_id": post_id,
                "section": sec["name"],
                "ord": chunk_ord,
                "char_start": cs,
                "char_end": ce,
                "text": ctext,
                "char_count": len(ctext),
                "hash": _hash(ctext),
            })
            chunk_ord += 1

    if not chunks:
        return {"ok": True, "post_id": post_id, "n_chunks": 0,
                "n_new": 0, "n_unchanged": 0, "embedded": 0}

    # Diff against existing rows by id+hash so unchanged chunks skip
    # re-embedding (the expensive step).
    existing = {
        r["id"]: r["hash"]
        for r in db.query(
            "SELECT id, hash FROM paper_chunks WHERE post_id = ?", [post_id],
        )
    }
    n_new = sum(1 for c in chunks if existing.get(c["id"]) != c["hash"])
    n_unchanged = len(chunks) - n_new

    if force:
        # Clean slate — caller asked for it.
        db.execute("DELETE FROM paper_chunks WHERE post_id = ?", [post_id])
        existing = {}
        n_new = len(chunks)
        n_unchanged = 0

    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    rows_to_write: list[dict] = []
    for c in chunks:
        row = dict(c)
        row["created_at"] = now
        row["embedded_at"] = ""
        row["embed_backend"] = ""
        rows_to_write.append(row)
    db["paper_chunks"].upsert_all(rows_to_write, pk="id", alter=True)

    embedded = 0
    if embed and n_new > 0:
        # Upsert only the changed chunks into Mempalace's paper_chunks
        # collection. Unchanged chunks already have stable ids and were
        # embedded on a prior run.
        changed = [c for c in chunks if existing.get(c["id"]) != c["hash"]]
        try:
            from ..retrieval import palace
            res = palace.upsert_paper_chunks(changed, post_id=post_id)
            if res.get("ok"):
                embedded = res.get("upserted", 0)
                # Stamp embedded_at + backend on the rows we successfully embedded.
                if embedded:
                    backend = res.get("backend", "")
                    db.execute(
                        "UPDATE paper_chunks SET embedded_at = ?, embed_backend = ?"
                        " WHERE post_id = ? AND id IN ({})".format(
                            ",".join(["?"] * len(changed))
                        ),
                        [now, backend, post_id, *[c["id"] for c in changed]],
                    )
        except Exception:
            # Embedding failure should never block the chunk write; the
            # rows are already persisted and a future re-run will retry.
            pass

    return {
        "ok": True, "post_id": post_id, "source": source,
        "n_chunks": len(chunks), "n_new": n_new, "n_unchanged": n_unchanged,
        "embedded": embedded,
    }


def get_chunks(post_id: str, *, section: str | None = None) -> list[dict]:
    """Return persisted chunks for a paper, ordered."""
    _ensure_table()
    db = get_db()
    if section:
        return list(db.query(
            "SELECT id, post_id, section, ord, char_start, char_end, text,"
            " char_count, hash, embedded_at, embed_backend"
            " FROM paper_chunks WHERE post_id = ? AND section = ?"
            " ORDER BY ord",
            [post_id, section],
        ))
    return list(db.query(
        "SELECT id, post_id, section, ord, char_start, char_end, text,"
        " char_count, hash, embedded_at, embed_backend"
        " FROM paper_chunks WHERE post_id = ? ORDER BY ord",
        [post_id],
    ))


# ─── Abstract-level fallback ─────────────────────────────────────────────────
# Only ~38 of 10k papers have open-access full text; the other 90%+ are paywalled
# (`not_oa`). But ~6k have a usable title+abstract. Embedding that abstract as a
# single `section="abstract"` chunk into the SAME `paper_chunks` collection makes
# every such paper retrievable by `search_paper_chunks` (→ paper chat) and gives
# `paper_neighbors` a vector to mean-pool (→ relates_to edges) — turning a 38-paper
# corpus into a ~6k-paper one with zero network calls. Full-text chunks are always
# preferred; we only abstract-chunk papers that have no full-text chunks yet.

def _load_abstract(post_id: str) -> str | None:
    """Title + abstract (selftext) for a paper, as one grounding blob. Returns
    None when there's not enough text to be worth embedding."""
    db = get_db()
    rows = list(db.query(
        "SELECT coalesce(title,'') AS title, coalesce(selftext,'') AS body "
        "FROM posts WHERE id = ?",
        [post_id],
    ))
    if not rows:
        return None
    title = (rows[0]["title"] or "").strip()
    body = (rows[0]["body"] or "").strip()
    text = (f"{title}\n\n{body}" if title and body else (title or body)).strip()
    return text if len(text) >= MIN_CHUNK_CHARS else None


def chunk_paper_abstract(
    post_id: str, *, force: bool = False, embed: bool = True,
) -> dict[str, Any]:
    """Embed a paper's abstract as a single ``section="abstract"`` chunk.

    Idempotent (stable id + hash). No-op when the paper already has full-text
    chunks (those are richer) unless ``force``. Returns
    ``{ok, post_id, embedded, skipped?}``.
    """
    if embed:
        from .sources import is_academic_source
        _src = list(get_db().query(
            "SELECT coalesce(source_type,'reddit') AS s FROM posts WHERE id = ?",
            [post_id],
        ))
        if _src and not is_academic_source(_src[0]["s"]):
            return {"ok": True, "post_id": post_id, "embedded": 0,
                    "skipped": "non_academic_source"}

    _ensure_table()
    db = get_db()

    # Prefer full text — skip abstract-chunking papers that already have real
    # full-text chunks (any non-abstract section).
    if not force:
        has_ft = list(db.query(
            "SELECT 1 FROM paper_chunks WHERE post_id = ? AND section != 'abstract' LIMIT 1",
            [post_id],
        ))
        if has_ft:
            return {"ok": True, "post_id": post_id, "embedded": 0,
                    "skipped": "has_fulltext_chunks"}

    text = _load_abstract(post_id)
    if not text:
        return {"ok": True, "post_id": post_id, "embedded": 0,
                "skipped": "no_abstract"}

    cid = f"{post_id}#sec=abstract#ord=0"
    h = _hash(text)
    existing = list(db.query(
        "SELECT hash, coalesce(embedded_at,'') AS embedded_at "
        "FROM paper_chunks WHERE id = ?", [cid],
    ))
    # Skip ONLY when the row is unchanged AND actually embedded into the palace.
    # A row whose hash matches but whose embedded_at is empty was stranded by a
    # failed/interrupted embed on a prior run — fall through to re-embed it,
    # otherwise it stays in the table forever but is never retrievable.
    if (existing and existing[0]["hash"] == h
            and existing[0]["embedded_at"] and not force):
        return {"ok": True, "post_id": post_id, "embedded": 0,
                "skipped": "unchanged"}

    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    chunk = {
        "id": cid, "post_id": post_id, "section": "abstract", "ord": 0,
        "char_start": 0, "char_end": len(text), "text": text,
        "char_count": len(text), "hash": h,
    }
    db["paper_chunks"].upsert_all(
        [{**chunk, "created_at": now, "embedded_at": "", "embed_backend": ""}],
        pk="id", alter=True,
    )

    embedded = 0
    if embed:
        from ..retrieval import palace
        # One retry — the ONNX embedder + ChromaDB occasionally fail a single
        # upsert under sustained sequential load in a bulk run, stranding the
        # row (in the table, not in the palace). A cheap retry catches most of
        # those; whatever still fails is healed on the next run (the skip check
        # requires embedded_at to be set).
        for _attempt in range(2):
            try:
                res = palace.upsert_paper_chunks([chunk], post_id=post_id)
                if res.get("ok") and res.get("upserted"):
                    embedded = res["upserted"]
                    db.execute(
                        "UPDATE paper_chunks SET embedded_at = ?, embed_backend = ? WHERE id = ?",
                        [now, res.get("backend", ""), cid],
                    )
                    break
            except Exception:
                pass  # rows persisted; retry / future re-run handles the embed

    return {"ok": True, "post_id": post_id, "embedded": embedded}


def chunk_abstracts_all(
    topic: str | None = None,
    *,
    embed: bool = True,
    limit: int | None = None,
    force: bool = False,
) -> dict[str, Any]:
    """Abstract-chunk every academic paper (optionally topic-scoped) that has an
    abstract but no full-text chunks. Local-CPU + idempotent. Returns aggregate
    counts."""
    db = get_db()
    _academic = ("arxiv", "pubmed", "openalex", "scholar",
                 "semantic_scholar", "crossref", "europepmc")
    ph = ",".join("?" for _ in _academic)
    sql = (
        f"SELECT p.id FROM posts p "
        f"WHERE coalesce(p.source_type,'') IN ({ph}) "
        f"AND length(coalesce(p.selftext,'') || coalesce(p.title,'')) >= ? "
    )
    params: list[Any] = [*_academic, MIN_CHUNK_CHARS]
    if topic:
        sql += " AND p.id IN (SELECT post_id FROM topic_posts WHERE topic = ?) "
        params.append(topic)
    if limit:
        sql += " LIMIT ?"
        params.append(int(limit))
    targets = list(db.query(sql, params))
    out = {"ok": True, "topic": topic, "total": len(targets),
           "embedded": 0, "skipped": 0, "errors": 0}
    for t in targets:
        try:
            r = chunk_paper_abstract(t["id"], force=force, embed=embed)
            if r.get("embedded"):
                out["embedded"] += 1
            else:
                out["skipped"] += 1
        except Exception:
            out["errors"] += 1
    return out


def chunk_topic(
    topic: str | None = None,
    *,
    embed: bool = True,
    limit: int | None = None,
    force: bool = False,
) -> dict[str, Any]:
    """Chunk every cached paper for a topic (or all topics when None).
    Returns aggregate counts."""
    db = get_db()
    sql = (
        "SELECT pft.post_id FROM paper_full_texts pft"
        " WHERE pft.status = 'ok'"
    )
    params: list[Any] = []
    if topic:
        sql += (
            " AND pft.post_id IN ("
            "  SELECT post_id FROM topic_posts WHERE topic = ?"
            " )"
        )
        params.append(topic)
    if limit:
        sql += " LIMIT ?"
        params.append(int(limit))
    targets = list(db.query(sql, params))
    out = {"ok": True, "topic": topic, "total": len(targets),
           "chunked": 0, "embedded_total": 0, "errors": 0}
    for t in targets:
        r = chunk_paper(t["post_id"], force=force, embed=embed)
        if r.get("ok"):
            out["chunked"] += 1
            out["embedded_total"] += r.get("embedded", 0)
        else:
            out["errors"] += 1
    return out


__all__ = [
    "TARGET_CHARS",
    "OVERLAP_CHARS",
    "MIN_CHUNK_CHARS",
    "chunk_paper",
    "chunk_paper_abstract",
    "chunk_abstracts_all",
    "get_chunks",
    "chunk_topic",
]
