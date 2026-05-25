"""Tactic library for mapping painpoints to persuasion tactics.

This module keeps a lightweight SQLite table (`tactic_library`) and a seeded
JSON catalogue of tactics. Matching is intentionally deterministic + cheap:
token-overlap scoring over tactic name/description/when_to_use, with optional
example snippets included for UI rendering.
"""
from __future__ import annotations

import json
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ..core.config import load_config
from ..retrieval import palace


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _db_path() -> Path:
    return load_config().db_path


def _seed_path() -> Path:
    return Path(__file__).resolve().parents[3] / "data" / "tactics_seed.json"


_TACTIC_COLLECTION = "tactic_library"


def ensure_schema() -> None:
    """Create the tactic_library table if it does not exist."""
    db = sqlite3.connect(_db_path())
    try:
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS tactic_library (
              id INTEGER PRIMARY KEY,
              slug TEXT UNIQUE,
              name TEXT,
              framework TEXT,
              description TEXT,
              when_to_use TEXT,
              examples_json TEXT,
              embedding_id TEXT,
              created_at TEXT,
              updated_at TEXT
            );
            """
        )
        db.execute(
            "CREATE INDEX IF NOT EXISTS idx_tactic_library_framework ON tactic_library(framework);"
        )
        db.commit()
    finally:
        db.close()


def _upsert_vector_index(items: list[dict[str, Any]]) -> None:
    """Best-effort Chroma index for tactic semantic matching."""
    if not items:
        return
    if not palace.is_available():
        return
    try:
        import chromadb
    except Exception:
        return
    try:
        client = chromadb.PersistentClient(path=palace._palace_path())
        coll = client.get_or_create_collection(
            _TACTIC_COLLECTION,
            metadata={"hnsw:space": "cosine"},
        )
        ids: list[str] = []
        docs: list[str] = []
        metas: list[dict[str, Any]] = []
        for item in items:
            slug = str(item.get("slug") or "").strip()
            if not slug:
                continue
            ids.append(slug)
            docs.append(
                " ".join(
                    [
                        str(item.get("name") or ""),
                        str(item.get("description") or ""),
                        str(item.get("when_to_use") or ""),
                    ]
                ).strip()
            )
            metas.append(
                {
                    "slug": slug,
                    "name": str(item.get("name") or ""),
                    "framework": str(item.get("framework") or "custom"),
                }
            )
        if ids:
            coll.upsert(ids=ids, documents=docs, metadatas=metas)
    except Exception:
        # Never block core flow on vector index issues.
        return


def seed_from_json(seed_file: str | None = None) -> dict[str, Any]:
    """Upsert tactics from `data/tactics_seed.json` into SQLite."""
    ensure_schema()
    path = Path(seed_file) if seed_file else _seed_path()
    if not path.exists():
        return {"ok": False, "error": f"Seed file not found: {path}"}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:
        return {"ok": False, "error": f"Invalid seed JSON: {e}"}
    items = payload if isinstance(payload, list) else []
    now = _utc_now()
    db = sqlite3.connect(_db_path())
    written = 0
    try:
        for item in items:
            if not isinstance(item, dict):
                continue
            slug = str(item.get("slug") or "").strip()
            name = str(item.get("name") or "").strip()
            if not slug or not name:
                continue
            framework = str(item.get("framework") or "custom").strip().lower() or "custom"
            description = str(item.get("description") or "").strip()
            when_to_use = str(item.get("when_to_use") or "").strip()
            examples = item.get("examples") if isinstance(item.get("examples"), list) else []
            examples_json = json.dumps(examples, ensure_ascii=False)
            embedding_id = str(item.get("embedding_id") or "").strip() or None
            db.execute(
                """
                INSERT INTO tactic_library
                  (slug, name, framework, description, when_to_use, examples_json, embedding_id, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(slug) DO UPDATE SET
                  name=excluded.name,
                  framework=excluded.framework,
                  description=excluded.description,
                  when_to_use=excluded.when_to_use,
                  examples_json=excluded.examples_json,
                  embedding_id=excluded.embedding_id,
                  updated_at=excluded.updated_at
                """,
                (slug, name, framework, description, when_to_use, examples_json, embedding_id, now, now),
            )
            written += 1
        db.commit()
    finally:
        db.close()
    _upsert_vector_index([it for it in items if isinstance(it, dict)])
    return {"ok": True, "seed_file": str(path), "written": written}


def _tokenize(text: str) -> set[str]:
    return {
        t for t in re.findall(r"[a-z0-9]+", (text or "").lower())
        if len(t) >= 3 and t not in {"the", "and", "for", "with", "that", "from", "this", "have"}
    }


def find_matching_tactics(text: str, k: int = 5) -> list[dict[str, Any]]:
    """Return top-k tactics for a free-form painpoint/gap text."""
    ensure_schema()
    query_tokens = _tokenize(text)
    if not query_tokens:
        return []
    db = sqlite3.connect(_db_path())
    db.row_factory = sqlite3.Row
    try:
        rows = db.execute(
            """
            SELECT slug, name, framework, description, when_to_use, examples_json
            FROM tactic_library
            """
        ).fetchall()
    finally:
        db.close()

    # Primary path: Chroma cosine search over tactic documents.
    chroma_candidates: dict[str, float] = {}
    if palace.is_available():
        try:
            import chromadb
            client = chromadb.PersistentClient(path=palace._palace_path())
            coll = client.get_or_create_collection(
                _TACTIC_COLLECTION,
                metadata={"hnsw:space": "cosine"},
            )
            raw = coll.query(query_texts=[text], n_results=max(3, int(k or 5) * 3))
            ids = (raw.get("ids") or [[]])[0]
            dists = (raw.get("distances") or [[]])[0]
            for i, sid in enumerate(ids):
                try:
                    dist = float(dists[i]) if i < len(dists) else 1.0
                except Exception:
                    dist = 1.0
                chroma_candidates[str(sid)] = max(0.0, 1.0 - dist)
        except Exception:
            chroma_candidates = {}

    scored: list[tuple[float, dict[str, Any]]] = []
    for row in rows:
        doc = " ".join(
            [
                row["name"] or "",
                row["description"] or "",
                row["when_to_use"] or "",
            ]
        )
        doc_tokens = _tokenize(doc)
        if not doc_tokens:
            continue
        inter = len(query_tokens & doc_tokens)
        lexical = 0.0
        if inter > 0:
            union = len(query_tokens | doc_tokens) or 1
            lexical = inter / union
        chroma = chroma_candidates.get(str(row["slug"]), 0.0)
        score = max(chroma, lexical)
        if score <= 0:
            continue
        try:
            examples = json.loads(row["examples_json"] or "[]")
        except Exception:
            examples = []
        scored.append(
            (
                score,
                {
                    "slug": row["slug"],
                    "name": row["name"],
                    "framework": row["framework"],
                    "description": row["description"] or "",
                    "when_to_use": row["when_to_use"] or "",
                    "examples": examples[:3] if isinstance(examples, list) else [],
                    "score": round(float(score), 4),
                    "match_method": "chroma" if chroma > 0 else "lexical",
                },
            )
        )
    scored.sort(key=lambda it: it[0], reverse=True)
    return [it[1] for it in scored[: max(1, int(k or 5))]]


__all__ = ["ensure_schema", "seed_from_json", "find_matching_tactics"]
