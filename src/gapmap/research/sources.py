"""Single source of truth for which post source_types are academic papers.
Used to gate the paper palace: ONLY these sources are embedded into the
paper-chunk collection and considered for paper relationships/gaps. Mirrors
the set hardcoded in intents.py:194 — keep them in sync."""
from __future__ import annotations

ACADEMIC_SOURCES = frozenset(
    {"arxiv", "pubmed", "openalex", "scholar", "semantic_scholar", "crossref"}
)

def is_academic_source(source_type: str | None) -> bool:
    return bool(source_type) and source_type.strip().lower() in ACADEMIC_SOURCES
