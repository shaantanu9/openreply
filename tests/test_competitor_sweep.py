from openreply.research.competitor_intel import sweep, registry


def test_run_competitor_sweep_end_to_end(monkeypatch):
    registry.add_competitor("psw", "Notion", subreddits=["Notion"])

    monkeypatch.setattr(sweep, "_collect",
        lambda topic, sources, keywords, provider, progress: {"posts_fetched": 12})
    # Use REAL find_gaps shape: painpoint/product/feature keys, example_post_ids, string severity
    monkeypatch.setattr(sweep, "_find_gaps", lambda topic, provider: {
        "painpoints": [{"painpoint": "slow sync", "example_post_ids": ["p1"], "severity": "high"}],
        "product_complaints": [{"product": "expensive", "example_post_ids": ["p2"], "severity": "medium"}],
        "feature_wishes": [{"feature": "offline mode", "example_post_ids": ["p3"]}],
    })
    monkeypatch.setattr(sweep, "_enrich_graph", lambda topic: None)
    monkeypatch.setattr(sweep, "_sentiment", lambda topic, provider: {
        "overall": -0.4, "by_source": {"appstore": {"score": -0.4, "n": 5,
                                                     "pos": 1, "neg": 3, "neu": 1}}})

    out = sweep.run_competitor_sweep("psw", "Notion")
    assert out["ok"] is True
    assert out["posts_fetched"] == 12
    assert out["findings"] == 2          # 1 painpoint + 1 product_complaint → complaints
    assert out["opportunities"] == 1     # 1 feature wish → competitor_vulnerability
    assert out["snapshot_id"]
    snap = sweep.latest_snapshot("psw", "Notion")
    assert snap["metrics"]["sentiment_score"] == -0.4

    # Prove titles and citations are populated (the real-shape fix)
    from openreply.research.competitor_intel import signals
    finds = signals.list_findings("psw", "Notion")
    assert any(f["title"] for f in finds), "at least one finding must have a non-empty title"
    assert any(f.get("evidence_post_ids") for f in finds), \
        "at least one finding must have non-empty evidence_post_ids"

    # Prove "high" severity mapped to ~0.9
    assert any(f["severity"] >= 0.8 for f in finds), \
        "'high' severity must map to ~0.9, not crash or default to 0.5"


def test_sweep_computes_delta_on_second_run(monkeypatch):
    registry.add_competitor("psd", "X")
    monkeypatch.setattr(sweep, "_collect",
        lambda *a, **k: {"posts_fetched": 3})
    monkeypatch.setattr(sweep, "_enrich_graph", lambda topic: None)
    monkeypatch.setattr(sweep, "_sentiment",
        lambda topic, provider: {"overall": 0.0, "by_source": {}})
    # Realistic keys
    monkeypatch.setattr(sweep, "_find_gaps", lambda topic, provider: {
        "painpoints": [{"painpoint": "a", "example_post_ids": ["1"]}]})
    sweep.run_competitor_sweep("psd", "X")
    monkeypatch.setattr(sweep, "_find_gaps", lambda topic, provider: {
        "painpoints": [{"painpoint": "a", "example_post_ids": ["1"]},
                       {"painpoint": "b", "example_post_ids": ["2"]}]})
    out = sweep.run_competitor_sweep("psd", "X")
    assert out["delta"]["new_complaints"] >= 1


def test_sweep_preserves_zero_severity(monkeypatch):
    from openreply.research.competitor_intel import signals
    registry.add_competitor("psz", "Zed")
    monkeypatch.setattr(sweep, "_collect", lambda *a, **k: {"posts_fetched": 1})
    monkeypatch.setattr(sweep, "_enrich_graph", lambda topic: None)
    monkeypatch.setattr(sweep, "_sentiment", lambda topic, provider: {"overall": 0.0, "by_source": {}})
    # Use realistic keys with numeric 0 severity (numeric path must preserve it)
    monkeypatch.setattr(sweep, "_find_gaps", lambda topic, provider: {
        "painpoints": [{"painpoint": "minor nit", "example_post_ids": ["z1"], "severity": 0}]})
    sweep.run_competitor_sweep("psz", "Zed")
    finds = signals.list_findings("psz", "Zed")
    assert any(f["severity"] == 0 for f in finds), "severity 0 must be preserved, not promoted to 0.5"
