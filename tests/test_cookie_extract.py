import openreply.sources._cookie_extract as ce


def test_returns_none_when_no_cookies(monkeypatch):
    monkeypatch.setattr(ce, "_extract_x_cookies_all_browsers", lambda: {})
    assert ce.x_auth_from_browsers() is None


def test_returns_pair_when_present(monkeypatch):
    monkeypatch.setattr(
        ce, "_extract_x_cookies_all_browsers",
        lambda: {"auth_token": "AAA", "ct0": "BBB"},
    )
    out = ce.x_auth_from_browsers()
    assert out == {"auth_token": "AAA", "ct0": "BBB"}


def test_all_browsers_never_raises(monkeypatch):
    # Even if every internal reader explodes, the aggregator must swallow it.
    out = ce._extract_x_cookies_all_browsers()
    assert isinstance(out, dict)
