"""Research package — trimmed to the OpenReply keep-set (collect / discover / gaps).

The research/academic/product/consultancy subsystems were removed in the OpenReply
reshape (see docs/OPENREPLY_RESHAPE.md). What remains powers the agent knowledge
refresh (collect + sub discovery) and content angles (gaps).
"""
from .collect import collect, corpus_for, corpus_temporal_split
from .discover import discover_subs
from .gaps import clear_temporal_gaps, find_gaps, find_temporal_gaps, run_extractor

__all__ = [
    "collect",
    "corpus_for",
    "corpus_temporal_split",
    "discover_subs",
    "find_gaps",
    "find_temporal_gaps",
    "clear_temporal_gaps",
    "run_extractor",
]
