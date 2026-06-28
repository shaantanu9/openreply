from openreply.core.scrub import scrub_secrets


def test_redacts_known_key_prefixes():
    for s in [
        "sk-ant-abc123DEF456ghi789jkl",
        "sk-or-v1-abcdef0123456789abcdef",
        "gsk_ABCD1234efgh5678IJKL",
        "xai-abcdef0123456789ABCDEF",
        "AIzaSyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p",
        "nvapi-abc123DEF456ghi789",
        "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    ]:
        out = scrub_secrets(f"error: key {s} failed")
        assert s not in out and "REDACTED" in out


def test_redacts_key_value_and_bearer():
    assert "supersecretval" not in scrub_secrets("ANTHROPIC_API_KEY=supersecretval123456")
    assert "tok_abc123xyz789" not in scrub_secrets(
        "Authorization: Bearer tok_abc123xyz789longenough"
    )
    # auth_token= keeps the key name but redacts the value
    scrubbed_auth = scrub_secrets("cookie auth_token=AAAA1111BBBB2222CCCC; ct0=xyz")
    assert "auth_token" in scrubbed_auth
    assert "AAAA1111BBBB2222CCCC" not in scrub_secrets("auth_token=AAAA1111BBBB2222CCCC")


def test_leaves_normal_text_alone():
    s = "Collected 42 posts from r/python about note taking apps"
    assert scrub_secrets(s) == s


def test_handles_empty_and_none():
    assert scrub_secrets("") == ""
    assert scrub_secrets(None) == ""  # type: ignore
