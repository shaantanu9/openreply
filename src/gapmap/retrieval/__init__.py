"""Local semantic-search retrieval layer for the posts corpus.

Wraps ChromaDB (SQLite-backed, offline all-MiniLM-L6-v2 embedder) behind a
tiny API so the rest of the codebase doesn't depend on Chroma's surface
directly. If chromadb isn't installed (extras not pulled), every function
returns a degraded result (`{"ok": False, "skipped": True, "reason": ...}`)
so the app keeps working without the retrieval layer.
"""
from .palace import (
    PalaceStore,
    get_palace,
    is_available,
    search_posts,
    related_posts,
    reindex_all,
    stats,
    upsert_post,
    upsert_posts_many,
    is_model_ready,
    model_status,
    warmup_model,
)

__all__ = [
    "PalaceStore",
    "get_palace",
    "is_available",
    "search_posts",
    "related_posts",
    "reindex_all",
    "stats",
    "upsert_post",
    "upsert_posts_many",
    "is_model_ready",
    "model_status",
    "warmup_model",
]
