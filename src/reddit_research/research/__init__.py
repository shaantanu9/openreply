from .discover import discover_subs
from .collect import collect, corpus_for, corpus_temporal_split
from .gaps import find_gaps, find_temporal_gaps, run_extractor
from .report import render_markdown
from .solutions import solutions_pipeline, synthesize_solutions_for_painpoint
from .why import extract_why_for_painpoint, extract_why_for_topic
from .science import fetch_science_for_painpoint

__all__ = [
    "discover_subs",
    "collect",
    "corpus_for",
    "corpus_temporal_split",
    "find_gaps",
    "find_temporal_gaps",
    "run_extractor",
    "render_markdown",
    "solutions_pipeline",
    "synthesize_solutions_for_painpoint",
    "extract_why_for_painpoint",
    "extract_why_for_topic",
    "fetch_science_for_painpoint",
]
