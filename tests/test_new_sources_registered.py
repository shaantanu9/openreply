from openreply.sources.collect_adapter import SOURCES

NEW = ["polymarket", "truthsocial", "digg", "tiktok",
       "instagram", "threads", "pinterest", "x"]

def test_new_sources_in_registry():
    for s in NEW:
        assert s in SOURCES, f"{s} missing from SOURCES"
        assert callable(SOURCES[s])
