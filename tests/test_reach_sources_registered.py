"""Agent Reach ports are wired into the source registry + collect dispatch."""
from __future__ import annotations

_FETCHERS = [
    "fetch_v2ex", "fetch_web_reader", "fetch_bilibili", "fetch_xiaoyuzhou",
    "fetch_exa_search", "fetch_xueqiu", "fetch_xiaohongshu", "fetch_linkedin",
    "fetch_reddit_free",
]
_COLLECT = ["v2ex", "bilibili", "xueqiu", "exa", "xiaohongshu", "reddit_free",
            "web", "linkedin", "xiaoyuzhou"]


def test_fetchers_exported():
    import gapmap.sources as S
    for fn in _FETCHERS:
        assert hasattr(S, fn), f"{fn} not exported from gapmap.sources"
        assert fn in S.__all__


def test_collect_dispatch_registered():
    from gapmap.sources.collect_adapter import SOURCES
    for key in _COLLECT:
        assert key in SOURCES and callable(SOURCES[key]), f"{key} missing from SOURCES"


def test_reddit_free_in_reddit_family():
    from gapmap.sources.source_families import REDDIT_FAMILY, normalize_source_type
    assert "reddit_free" in REDDIT_FAMILY
    assert normalize_source_type("reddit_free") == "reddit_free"
