"""Unit tests for chat/source_intent.py — loaded in TRUE isolation.

The module is pure (stdlib only), so we exec it directly from its file without
importing the heavy `openreply.research.chat` package (which pulls DB/config). This
is the whole point of the decomposition: every chat piece is testable alone.
"""
import importlib.util
import pathlib

_ROOT = pathlib.Path(__file__).resolve().parents[1]


def _load(rel_path, name):
    spec = importlib.util.spec_from_file_location(name, _ROOT / rel_path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


si = _load("src/openreply/research/chat/source_intent.py", "chat_source_intent")


def test_papers_intent_detected():
    res = si.detect_source_intent("what do the research papers say about burnout?")
    assert res is not None
    label, sources = res
    assert label == "research papers"
    assert "arxiv" in sources and "pubmed" in sources


def test_app_reviews_intent():
    res = si.detect_source_intent("what do app store reviews complain about?")
    assert res is not None and res[0] == "app store reviews"


def test_developer_sources_intent():
    res = si.detect_source_intent("what does hacker news / github think?")
    assert res is not None and res[0] == "developer sources"


def test_generic_question_has_no_source_intent():
    assert si.detect_source_intent("what should we build next?") is None
    assert si.detect_source_intent("") is None
    assert si.detect_source_intent(None) is None


def test_score_breaks_ties_by_more_keyword_hits():
    # "papers" + "research" + "study" → research papers wins decisively
    res = si.detect_source_intent("summarize the research study papers")
    assert res[0] == "research papers"


def test_backward_compat_aliases_present():
    assert si._detect_source_intent is si.detect_source_intent
    assert si._SOURCE_FAMILIES is si.SOURCE_FAMILIES
    assert len(si.SOURCE_FAMILIES) == 6
