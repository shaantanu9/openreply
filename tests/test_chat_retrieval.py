"""Tests for chat/retrieval_context.resolve_indexed_topic — the topic-name
canonicalization that stops semantic retrieval silently falling back to SQL when
the UI passes a differently-cased/spaced topic name than palace indexed under.
"""
from gapmap.research.chat.retrieval_context import resolve_indexed_topic as r


def test_exact_match_preferred():
    assert r({"ai": 5}, "ai") == "ai"


def test_case_insensitive_variant():
    assert r({"Machine Learning": 30}, "machine learning") == "Machine Learning"


def test_whitespace_variant():
    assert r({"ai ": 3}, "ai") == "ai "


def test_no_indexed_topic_returns_none():
    assert r({"other": 5}, "ai") is None
    assert r({}, "ai") is None


def test_variant_with_zero_docs_is_ignored():
    # "AI" exists but has 0 docs → not a usable match.
    assert r({"AI": 0}, "ai") is None


def test_exact_zero_falls_through_to_nonzero_variant():
    assert r({"ai": 0, "AI": 7}, "ai") == "AI"


def test_empty_topic_is_noop():
    assert r({"ai": 5}, "") is None
