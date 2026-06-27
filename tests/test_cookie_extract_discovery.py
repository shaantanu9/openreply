"""Cookie-DB discovery + extraction over a SYNTHETIC Chrome store.

Proves the fix for "Connections all not-connected": modern Chrome keeps cookies
under <Profile>/Network/Cookies across multiple profiles, not the legacy
Default/Cookies the old code scanned. We build a fake Chromium profile tree with
a real SQLite cookie DB (unencrypted test value) and assert discovery + read.
No real browser, Keychain, or credentials involved.
"""
from __future__ import annotations

import sqlite3
from pathlib import Path

from gapmap.sources import _cookie_extract as ce


def _make_cookie_db(path: Path, host: str, name: str, value: str, version: int = 24):
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path))
    try:
        conn.execute(
            "CREATE TABLE cookies (host_key TEXT, name TEXT, value TEXT, encrypted_value BLOB)"
        )
        conn.execute("CREATE TABLE meta (key TEXT, value TEXT)")
        conn.execute("INSERT INTO meta VALUES ('version', ?)", [str(version)])
        conn.execute(
            "INSERT INTO cookies (host_key, name, value, encrypted_value) VALUES (?,?,?,?)",
            [host, name, value, b""],
        )
        conn.commit()
    finally:
        conn.close()


def test_discovers_all_profiles_modern_and_legacy(tmp_path):
    base = tmp_path / "Chrome"
    # modern path in two profiles + a legacy path in a third
    _make_cookie_db(base / "Default" / "Network" / "Cookies", ".x.com", "auth_token", "a")
    _make_cookie_db(base / "Profile 1" / "Network" / "Cookies", ".x.com", "auth_token", "b")
    _make_cookie_db(base / "Profile 2" / "Cookies", ".x.com", "auth_token", "c")

    dbs = ce._chromium_cookie_dbs(base)
    rels = {str(p.relative_to(base)) for p in dbs}
    assert rels == {
        "Default/Network/Cookies",
        "Profile 1/Network/Cookies",
        "Profile 2/Cookies",
    }


def test_missing_base_returns_empty(tmp_path):
    assert ce._chromium_cookie_dbs(tmp_path / "nope") == []


def test_extract_reads_unencrypted_cookie(tmp_path):
    db = tmp_path / "Default" / "Network" / "Cookies"
    _make_cookie_db(db, ".reddit.com", "reddit_session", "SESSION_XYZ")
    got = ce._extract_chromium_cookies(db, "Chrome Safe Storage", "reddit.com", ["reddit_session"])
    assert got == {"reddit_session": "SESSION_XYZ"}


def test_family_extract_picks_correct_profile(tmp_path, monkeypatch):
    base = tmp_path / "Chrome"
    # only Profile 1 has the linkedin cookies — proves we don't stop at Default
    _make_cookie_db(base / "Default" / "Network" / "Cookies", ".x.com", "auth_token", "a")
    db = base / "Profile 1" / "Network" / "Cookies"
    _make_cookie_db(db, ".linkedin.com", "li_at", "LI_TOKEN")
    conn = sqlite3.connect(str(db))
    conn.execute("INSERT INTO cookies (host_key, name, value, encrypted_value) VALUES (?,?,?,?)",
                 [".linkedin.com", "JSESSIONID", "JS_TOKEN", b""])
    conn.commit(); conn.close()

    monkeypatch.setitem(ce._CHROMIUM_BROWSERS, "chrome", (base, "Chrome Safe Storage"))
    monkeypatch.setattr(ce.platform, "system", lambda: "Darwin")
    got = ce._chromium_family_cookies("chrome", ["linkedin.com"], ["li_at", "JSESSIONID"])
    assert got == {"li_at": "LI_TOKEN", "JSESSIONID": "JS_TOKEN"}
