"""Product Hunt auth resolution: env token → stored key → minted client_credentials."""
import openreply.sources.producthunt as ph


def _clear_env(monkeypatch):
    for k in ("PH_TOKEN", "PH_CLIENT_ID", "PH_CLIENT_SECRET"):
        monkeypatch.delenv(k, raising=False)


def test_env_token_wins(monkeypatch):
    _clear_env(monkeypatch)
    monkeypatch.setenv("PH_TOKEN", "env-token")
    assert ph._token() == "env-token"


def test_stored_key_used_when_no_env(monkeypatch):
    _clear_env(monkeypatch)
    monkeypatch.setattr(ph, "_stored", lambda src: "stored-token" if src == "producthunt" else "")
    assert ph._token() == "stored-token"


def test_client_pair_from_env(monkeypatch):
    _clear_env(monkeypatch)
    monkeypatch.setenv("PH_CLIENT_ID", "cid")
    monkeypatch.setenv("PH_CLIENT_SECRET", "csec")
    assert ph._client_pair() == ("cid", "csec")


def test_mint_client_credentials_caches(monkeypatch):
    _clear_env(monkeypatch)
    ph._MINTED.clear()
    monkeypatch.setattr(ph, "_stored", lambda src: "")
    monkeypatch.setenv("PH_CLIENT_ID", "cid")
    monkeypatch.setenv("PH_CLIENT_SECRET", "csec")

    calls = {"n": 0}

    class _Resp:
        def raise_for_status(self):  # noqa: D401
            return None

        def json(self):
            return {"access_token": "minted-abc", "expires_in": 7200}

    def _fake_post(url, **kw):
        calls["n"] += 1
        assert "oauth/token" in url
        assert kw["json"]["grant_type"] == "client_credentials"
        return _Resp()

    monkeypatch.setattr(ph.httpx, "post", _fake_post)
    assert ph._token() == "minted-abc"
    assert ph._token() == "minted-abc"      # second call served from cache
    assert calls["n"] == 1, "token should be minted once and cached"


def test_no_credentials_returns_none(monkeypatch):
    _clear_env(monkeypatch)
    ph._MINTED.clear()
    monkeypatch.setattr(ph, "_stored", lambda src: "")
    assert ph._token() is None


def test_fetch_returns_error_row_without_token(monkeypatch):
    _clear_env(monkeypatch)
    ph._MINTED.clear()
    monkeypatch.setattr(ph, "_stored", lambda src: "")
    rows = ph.fetch_producthunt("notion", limit=5)
    assert rows and rows[0].get("_error")
    assert "PH_TOKEN" in rows[0]["_error"]
