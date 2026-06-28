import json
import openreply.sources.digg as mod

_CLI_OUT = json.dumps({"results": [{
    "clusterUrlId": "abc123",
    "title": "AI agents go mainstream",
    "tldr": "Everyone is shipping agents.",
    "rank": 3,
    "postCount": 40,
    "uniqueAuthors": 25,
}]})

def test_digg_missing_binary_skips(monkeypatch):
    monkeypatch.setattr(mod.shutil, "which", lambda _b: None)
    rows = mod.fetch_digg("ai agents", limit=5)
    assert len(rows) == 1 and "_error" in rows[0]

def test_digg_maps_rows(monkeypatch):
    monkeypatch.setattr(mod.shutil, "which", lambda _b: "/usr/local/bin/digg-pp-cli")
    monkeypatch.setattr(mod, "_run_cli", lambda *a, **k: json.loads(_CLI_OUT))
    rows = mod.fetch_digg("ai agents", limit=5)
    assert rows[0]["source_type"] == "digg"
    assert rows[0]["url"].endswith("abc123")
    assert "Everyone is shipping" in rows[0]["selftext"]
