"""Source-pack resolution + health checks for competitor sweeps.

Regression coverage for the 2026-07-01 "only 3-4 databases fetched" fix:
  - the "hackernews" key must resolve (alias → run_hn), not be dropped
  - the legacy default pack must auto-upgrade to the new reliable pack
  - unknown/invalid ids are filtered out
  - health.check_source classifies outcomes with a typed vocabulary
"""
from openreply.research.competitor_intel import registry, sweep, health
from openreply.sources.collect_adapter import SOURCES


def test_hackernews_alias_is_registered():
    # Both the canonical id and the spelled-out alias resolve to the same runner.
    assert "hn" in SOURCES
    assert "hackernews" in SOURCES
    assert SOURCES["hackernews"] is SOURCES["hn"]


def test_default_pack_uses_only_registered_ids():
    for src in registry.DEFAULT_SOURCE_PACK:
        assert src in SOURCES, f"DEFAULT_SOURCE_PACK id {src!r} not in SOURCES"


def test_resolve_sources_explicit_wins():
    comp = {"source_config": {"enabled_adapters": ["appstore"]}}
    assert sweep._resolve_sources(comp, ["hn", "reddit_free"]) == ["hn", "reddit_free"]


def test_resolve_sources_upgrades_legacy_pack():
    # A competitor still carrying the exact pre-fix default is treated as
    # "unconfigured" and upgraded to the new pack (which includes hn/gnews/…).
    comp = {"source_config": {"enabled_adapters": list(sweep._LEGACY_DEFAULT_PACK)}}
    resolved = sweep._resolve_sources(comp, None)
    assert resolved == list(registry.DEFAULT_SOURCE_PACK)
    assert "hn" in resolved              # legacy "hackernews" replaced by working set
    assert "gnews" in resolved           # new reliable source pulled in


def test_resolve_sources_honors_custom_config_but_filters_invalid():
    comp = {"source_config": {"enabled_adapters": ["appstore", "hackernews", "not_a_real_source"]}}
    resolved = sweep._resolve_sources(comp, None)
    assert "appstore" in resolved
    assert "hackernews" in resolved          # valid via alias
    assert "not_a_real_source" not in resolved


def test_resolve_sources_empty_falls_back_to_default():
    assert sweep._resolve_sources({"source_config": {}}, None) == list(registry.DEFAULT_SOURCE_PACK)


def test_check_source_unregistered():
    r = health.check_source("definitely_not_a_source", "Notion")
    assert r["state"] == health.UNREGISTERED
    assert r["rows"] == 0


def test_check_source_classifies_credential(monkeypatch):
    # producthunt with no token → needs_credential (offline: stub the runner to 0).
    monkeypatch.delenv("PH_TOKEN", raising=False)
    monkeypatch.delenv("PRODUCTHUNT_TOKEN", raising=False)
    monkeypatch.setitem(SOURCES, "producthunt", lambda kw: 0)
    r = health.check_source("producthunt", "Notion")
    assert r["state"] == health.NEEDS_CREDENTIAL
    assert "PH_TOKEN" in r["note"]


def test_check_source_ok(monkeypatch):
    monkeypatch.setitem(SOURCES, "hn", lambda kw: 7)
    r = health.check_source("hn", "Notion")
    assert r["state"] == health.OK
    assert r["rows"] == 7


def test_check_sources_summary(monkeypatch):
    monkeypatch.setitem(SOURCES, "hn", lambda kw: 5)
    monkeypatch.setitem(SOURCES, "devto", lambda kw: 0)
    out = health.check_sources("Notion", sources=["hn", "devto", "bogus"])
    assert out["checked"] == 3
    assert out["working"] == 1
    assert out["summary"][health.OK] == ["hn"]
    assert "bogus" in out["summary"][health.UNREGISTERED]
