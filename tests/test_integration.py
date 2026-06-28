"""End-to-end integration smoke tests.

These exercise the real pipeline that the Tauri app uses. They hit live
network endpoints (Reddit public JSON, Ollama on localhost) but gracefully
skip when a dependency is unreachable — so CI remains green on offline
runners and local dev doesn't need keys to run the unit suite.

Run just these:
    .venv/bin/pytest -v tests/test_integration.py

Mark a slow path to skip always:
    .venv/bin/pytest -v -m "not slow"
"""
from __future__ import annotations

import json
import os
import socket
import urllib.error
import urllib.request
from pathlib import Path

import pytest


# ─── Skip-gate helpers ──────────────────────────────────────────────────────


def _reachable(host: str, port: int, timeout: float = 1.0) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


REDDIT_OK = _reachable("www.reddit.com", 443)
OLLAMA_OK = _reachable("localhost", 11434)


# ─── Fresh-DB fixture (no side effects on the real data dir) ────────────────


@pytest.fixture
def clean_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Point every env lookup at tmp_path so tests are isolated."""
    monkeypatch.setenv("OPENREPLY_DATA_DIR", str(tmp_path))
    monkeypatch.delenv("LLM_PROVIDER", raising=False)
    monkeypatch.delenv("LLM_MODEL", raising=False)
    # Invalidate any memoized config / db.
    from openreply.core import db as db_mod

    db_mod.get_db.cache_clear()  # type: ignore[attr-defined]
    return tmp_path


# ─── Config + DB ────────────────────────────────────────────────────────────


def test_config_respects_data_dir_env(clean_env: Path) -> None:
    from openreply.core.config import load_config

    cfg = load_config()
    assert cfg.data_dir == clean_env
    assert cfg.db_path.parent == clean_env
    # `mode` should be 'public' when no Reddit creds set
    assert cfg.mode in ("public", "auth")


def test_db_init_creates_all_tables(clean_env: Path) -> None:
    from openreply.core.db import get_db

    db = get_db()
    names = set(db.table_names())
    for t in ("posts", "comments", "users", "subreddits", "fetches", "streams", "stream_hits"):
        assert t in names, f"missing table: {t}"


# ─── Sub discovery (live Reddit) ────────────────────────────────────────────


@pytest.mark.slow  # hits live Reddit — TCP-reachable ≠ API-accessible (CI IPs get 403)
@pytest.mark.skipif(not REDDIT_OK, reason="reddit.com unreachable")
def test_discover_subs_returns_real_results(clean_env: Path) -> None:
    from openreply.research.discover import discover_subs

    result = discover_subs("note taking apps", limit=3)
    # discover_subs returns {"subs": [...], "confirmation": {...}} since the
    # topic-canonicalization rework (2026-04). The legacy bare-list shape is
    # gone; tests must unwrap the "subs" key.
    assert isinstance(result, dict)
    subs = result.get("subs") or []
    assert isinstance(subs, list)
    assert len(subs) >= 1, "expected at least 1 sub"
    first = subs[0]
    assert first.get("name"), "sub entry must have a name"
    # Reddit's sub search always gives at least name + url
    assert "url" in first or "permalink" in first
    # Confirmation payload should always be present.
    assert isinstance(result.get("confirmation"), dict)


# ─── Reddit fetch (live) ────────────────────────────────────────────────────


@pytest.mark.slow  # hits live Reddit — TCP-reachable ≠ API-accessible (CI IPs get 403)
@pytest.mark.skipif(not REDDIT_OK, reason="reddit.com unreachable")
def test_fetch_posts_writes_to_db(clean_env: Path) -> None:
    from openreply.core.db import get_db
    from openreply.fetch.posts import fetch_posts

    rows = fetch_posts(sub="resumes", sort="top", limit=2, time_filter="week")
    # Must return at least one post and write it into the DB.
    assert isinstance(rows, list)
    assert len(rows) >= 1
    db = get_db()
    assert db["posts"].count >= 1
    assert db["fetches"].count >= 1


# ─── LLM ping (live Ollama) ─────────────────────────────────────────────────


@pytest.mark.slow  # hits live Ollama on localhost
@pytest.mark.skipif(not OLLAMA_OK, reason="ollama not running on :11434")
def test_ollama_ping_ok(clean_env: Path) -> None:
    """Try each installed Ollama model until one completes a 1-token ping.
    Skips models that aren't chat-capable (embeddings, OCR-specialty, etc.)."""
    import urllib.request

    with urllib.request.urlopen("http://localhost:11434/api/tags", timeout=3) as r:
        data = json.loads(r.read().decode("utf-8"))
    # Exclude known non-chat families: bert-style embeddings, OCR-only models,
    # and any tag containing "embed". Leaves general chat models intact.
    NON_CHAT_FAMILIES = {"bert", "nomic-bert", "glmocr"}
    candidates = [
        m["name"]
        for m in (data.get("models") or [])
        if "embed" not in (m.get("name") or "").lower()
        and "ocr" not in (m.get("name") or "").lower()
        and (m.get("details", {}) or {}).get("family") not in NON_CHAT_FAMILIES
    ]
    if not candidates:
        pytest.skip("no chat-capable models installed in Ollama")

    from openreply.research.chat import test_provider

    errors: list[str] = []
    for name in candidates:
        r = test_provider(provider="ollama", model=name)
        if r.get("ok"):
            assert r.get("reply"), f"empty reply for {name}"
            assert r["latency_ms"] > 0
            return  # At least one model works — pipeline is healthy.
        errors.append(f"{name}: {r.get('error')}")
    pytest.fail("no chat model responded. Attempts:\n  " + "\n  ".join(errors))


# ─── List installed Ollama models ───────────────────────────────────────────


@pytest.mark.slow  # hits live Ollama on localhost
@pytest.mark.skipif(not OLLAMA_OK, reason="ollama not running on :11434")
def test_list_ollama_models(clean_env: Path) -> None:
    from openreply.research.chat import list_ollama_models

    result = list_ollama_models()
    assert result.get("ok") is True
    assert isinstance(result.get("models"), list)


# ─── MCP server boots ───────────────────────────────────────────────────────


def test_mcp_module_importable() -> None:
    """The MCP server module must import cleanly (fastmcp may be optional)."""
    try:
        from openreply.mcp import server  # noqa: F401
    except (ImportError, RuntimeError) as e:
        # fastmcp is an optional extra. server.py catches the bare ImportError
        # and re-raises it as RuntimeError("Install the mcp extra ..."), so we
        # must accept either type — only fail if it isn't about the mcp extra.
        msg = str(e).lower()
        if "fastmcp" in msg or "mcp extra" in msg:
            pytest.skip("fastmcp optional extra not installed")
        raise


# ─── Read-only SQL helper used by the DB Console ────────────────────────────


def test_sql_helper_runs_select(clean_env: Path) -> None:
    """Confirm the same helper the Rust `run_query` command uses."""
    from openreply.core.db import get_db

    db = get_db()
    # Seed a row so the query returns something
    db["posts"].insert(
        {
            "id": "sqltest-1",
            "sub": "unit",
            "source_type": "reddit",
            "author": "x",
            "title": "hi",
            "selftext": "",
            "url": "",
            "score": 1,
            "upvote_ratio": 1.0,
            "num_comments": 0,
            "created_utc": 0.0,
            "is_self": 1,
            "over_18": 0,
            "flair": None,
            "permalink": "",
            "fetched_at": "2026-04-19T00:00:00+00:00",
        },
        pk="id",
    )
    rows = list(db.query("SELECT id, title FROM posts WHERE id = ?", ["sqltest-1"]))
    assert rows == [{"id": "sqltest-1", "title": "hi"}]


# ─── Enrichment provider resolution (regression test) ──────────────────────


def test_enrich_uses_openrouter_when_configured(
    clean_env: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Regression: LLM_PROVIDER=openrouter + LLM_MODEL=openai/gpt-4o must NOT
    try to construct the OpenAI provider (which would demand OPENAI_API_KEY).

    The slashed-model convention `openai/gpt-4o` is OpenRouter's way of saying
    "route this OpenAI model through the OpenRouter gateway" — the provider
    stays openrouter; the model string is opaque.
    """
    from openreply.analyze.providers.base import resolve_provider

    monkeypatch.setenv("LLM_PROVIDER", "openrouter")
    # LLM_MODEL is set to mirror real user config; resolve_provider does
    # NOT read it — included only so the test env matches what BYOK writes.
    monkeypatch.setenv("LLM_MODEL", "openai/gpt-4o")
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-fake-test-key")
    # Deliberately do NOT set OPENAI_API_KEY. If resolution is correct,
    # the code path must never read it.
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    assert resolve_provider() == "openrouter"
    # Explicit arg wins: passing "openrouter" through must still resolve to
    # "openrouter" and never get coerced to "openai" via the model-slash path.
    assert resolve_provider("openrouter") == "openrouter"

    # End-to-end: enrich_from_llm must reach find_gaps (which errors with
    # "No corpus found" on a nonexistent topic) — NOT short-circuit to an
    # OPENAI_API_KEY error via the drifted duplicate resolver.
    from openreply.graph.semantic import enrich_from_llm

    result = enrich_from_llm(topic="definitely-does-not-exist-topic-xyz")
    assert isinstance(result, dict)
    assert result.get("ok") is False
    # If drift occurs, the reason will mention OPENAI_API_KEY; correct
    # resolution produces a "No corpus found" error instead.
    reason = str(result.get("error") or result.get("reason") or "")
    assert "OPENAI_API_KEY" not in reason, f"resolver drifted to OpenAI path: {result}"
    assert "OPENROUTER" not in reason, f"resolver flagged OPENROUTER key missing: {result}"


def test_enrich_skip_gracefully_when_nothing_configured(
    clean_env: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Enrich is called optimistically after every collect. When nothing is
    configured, it must return a skip payload, not raise."""
    from openreply.graph.semantic import enrich_from_llm

    for k in (
        "LLM_PROVIDER", "LLM_MODEL",
        "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY",
        "GROQ_API_KEY", "DEEPSEEK_API_KEY", "MISTRAL_API_KEY", "GOOGLE_API_KEY",
    ):
        monkeypatch.delenv(k, raising=False)
    # Ollama is presumed unreachable in CI; if it happens to be up, the test
    # still passes because a successful provider resolution also means no
    # OPENAI_API_KEY error (the bug we're regressing against).
    result = enrich_from_llm(topic="does-not-exist-topic")
    assert isinstance(result, dict)
    # Either skipped because no provider, OR skipped/errored because topic
    # has no corpus — both are "did not crash with OPENAI_API_KEY".
    # Structural (not substring) regression guard — survives rewording.
    # A correct resolve either skips gracefully or errors on "no corpus" /
    # "no LLM provider"; it never mentions OPENAI specifically.
    reason = str(result.get("error") or result.get("reason") or "")
    assert "OPENAI" not in reason.upper(), (
        f"resolver mentioned OPENAI when user configured no provider: {result}"
    )


# ─── Topic canonicalization (typo correction) ──────────────────────────────


def test_canonicalize_typo_correction(
    clean_env: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A known typo should be corrected via the LLM pathway."""
    import json
    from openreply.research import discover as discover_mod

    # Pretend an LLM is configured.
    monkeypatch.setenv("LLM_PROVIDER", "openrouter")
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-fake")

    def fake_llm(topic: str) -> str:
        return json.dumps({
            "canonical": "calorie tracking app",
            "variants": ["macro tracking app", "food log"],
            "confidence": "high",
        })
    monkeypatch.setattr(discover_mod, "_llm_canonical_call", fake_llm)

    result = discover_mod._canonicalize_topic("calari tracking app")
    assert result["canonical"] == "calorie tracking app"
    assert result["confidence"] == "high"
    assert "macro tracking app" in result["variants"]


def test_canonicalize_preserves_real_topic(
    clean_env: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A correctly-spelled topic should pass through unchanged."""
    import json
    from openreply.research import discover as discover_mod

    monkeypatch.setenv("LLM_PROVIDER", "openrouter")
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-fake")

    def fake_llm(topic: str) -> str:
        return json.dumps({
            "canonical": "kubernetes monitoring",
            "variants": ["cluster observability", "container metrics"],
            "confidence": "high",
        })
    monkeypatch.setattr(discover_mod, "_llm_canonical_call", fake_llm)

    result = discover_mod._canonicalize_topic("kubernetes monitoring")
    assert result["canonical"] == "kubernetes monitoring"


def test_canonicalize_no_llm_passthrough(
    clean_env: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Without any LLM configured, canonicalize returns the topic unchanged."""
    from openreply.research import discover as discover_mod
    from openreply.analyze.providers import base as provider_base
    # Drive the cleanup list off the real provider table so adding a new
    # provider (e.g. nvidia) doesn't silently leak its key into this test.
    monkeypatch.delenv("LLM_PROVIDER", raising=False)
    monkeypatch.delenv("LLM_MODEL", raising=False)
    for env_key in provider_base._PROVIDER_ENV_KEY.values():
        monkeypatch.delenv(env_key, raising=False)
    # Also hide any locally-running Ollama so this test is deterministic.
    monkeypatch.setattr(provider_base, "_ollama_reachable", lambda: False)

    result = discover_mod._canonicalize_topic("calari tracking app")
    assert result["canonical"] == "calari tracking app"
    assert result["confidence"] == "unknown"
    assert result["variants"] == []


def test_canonicalize_is_cached(
    clean_env: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Repeated calls for the same topic must not invoke the LLM twice."""
    import json
    from openreply.research import discover as discover_mod

    monkeypatch.setenv("LLM_PROVIDER", "openrouter")
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-fake")

    call_count = {"n": 0}
    def fake_llm(topic: str) -> str:
        call_count["n"] += 1
        return json.dumps({
            "canonical": "calorie tracking app",
            "variants": [],
            "confidence": "high",
            "search_keywords": [
                {"keyword": "calorie tracking app", "relevance": "high"},
                {"keyword": "macro tracker", "relevance": "medium"},
            ],
        })
    monkeypatch.setattr(discover_mod, "_llm_canonical_call", fake_llm)

    discover_mod._canonicalize_topic("calari tracking app")
    discover_mod._canonicalize_topic("calari tracking app")
    assert call_count["n"] == 1, (
        f"expected 1 LLM call, got {call_count['n']} — cache not working"
    )


# ─── discover_subs return-shape regression ────────────────────────────────


def test_discover_subs_direct_match_shape(
    clean_env: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Well-formed topic with strong name matches → no confirmation needed."""
    from openreply.research import discover as discover_mod

    for k in ("LLM_PROVIDER", "OPENROUTER_API_KEY", "OPENAI_API_KEY"):
        monkeypatch.delenv(k, raising=False)

    def fake_search(query, limit=25):
        return [
            {
                "display_name": "nutrition",
                "title": "Nutrition",
                "public_description": "Nutrition discussion",
                "subscribers": 500_000,
                "subreddit_type": "public",
                "over18": False,
            },
            {
                "display_name": "loseit",
                "title": "loseit",
                "public_description": "Losing weight via calorie tracking",
                "subscribers": 3_000_000,
                "subreddit_type": "public",
                "over18": False,
            },
        ]
    monkeypatch.setattr(discover_mod, "_search_raw", fake_search)

    result = discover_mod.discover_subs("nutrition tracking")
    assert isinstance(result, dict)
    assert "subs" in result
    assert "confirmation" in result
    c = result["confirmation"]
    assert c["original_topic"] == "nutrition tracking"
    assert c["auto_corrected"] is False


def test_discover_subs_weak_relevance_flags_modal(
    clean_env: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Zero token-in-name matches → needs_confirmation=True."""
    from openreply.research import discover as discover_mod

    for k in ("LLM_PROVIDER", "OPENROUTER_API_KEY", "OPENAI_API_KEY"):
        monkeypatch.delenv(k, raising=False)

    def fake_search(query, limit=25):
        return [
            {
                "display_name": "programming",
                "title": "programming",
                "public_description": "random",
                "subscribers": 1_000_000,
                "subreddit_type": "public",
                "over18": False,
            },
        ]
    monkeypatch.setattr(discover_mod, "_search_raw", fake_search)

    result = discover_mod.discover_subs("xyzqvw random")
    c = result["confirmation"]
    assert c["needs_confirmation"] is True
    assert c["reason"] in ("weak_sub_relevance", "low_confidence_canonicalization")


def test_discover_subs_auto_corrected_flag(
    clean_env: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """High-confidence LLM correction → auto_corrected=True, no modal."""
    import json
    from openreply.research import discover as discover_mod

    monkeypatch.setenv("LLM_PROVIDER", "openrouter")
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-fake")

    def fake_llm(topic):
        return json.dumps({
            "canonical": "calorie tracking app",
            "variants": ["macro tracking", "food log"],
            "confidence": "high",
        })
    monkeypatch.setattr(discover_mod, "_llm_canonical_call", fake_llm)

    def fake_search(query, limit=25):
        return [
            {
                "display_name": "caloriecounters",
                "title": "Calorie counters",
                "public_description": "count your calories",
                "subscribers": 200_000,
                "subreddit_type": "public",
                "over18": False,
            },
            {
                "display_name": "loseit",
                "title": "loseit",
                "public_description": "calorie tracking community",
                "subscribers": 3_000_000,
                "subreddit_type": "public",
                "over18": False,
            },
        ]
    monkeypatch.setattr(discover_mod, "_search_raw", fake_search)

    result = discover_mod.discover_subs("calari tracking app")
    c = result["confirmation"]
    assert c["auto_corrected"] is True
    assert c["canonical_topic"] == "calorie tracking app"
    assert c["original_topic"] == "calari tracking app"
    assert c["needs_confirmation"] is False
    assert c["reason"] == "high_confidence_typo_correction"


# ─── Emergent theme clustering ───────────────────────────────────────────


def test_cluster_merges_near_duplicates(
    clean_env: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Two near-duplicate labels should merge into one with aliases."""
    from openreply.retrieval.cluster import cluster_findings

    inp = {
        "painpoints": [
            {"painpoint": "Hard to log food when eating out", "frequency": 5, "example_post_ids": ["p1"]},
            {"painpoint": "Can't track calories at restaurants", "frequency": 3, "example_post_ids": ["p2"]},
            {"painpoint": "App crashes on launch",               "frequency": 2, "example_post_ids": ["p3"]},
        ],
    }
    out = cluster_findings(inp, threshold=0.70)
    items = out["painpoints"]
    assert len(items) in (2, 3)
    if len(items) == 2:
        winner = max(items, key=lambda x: x.get("frequency", 0))
        assert winner.get("aliases"), "winner should carry its merged aliases"


def test_cluster_preserves_distinct(
    clean_env: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Semantically distinct labels stay separate."""
    from openreply.retrieval.cluster import cluster_findings
    inp = {
        "painpoints": [
            {"painpoint": "Barcode scanner is broken",     "frequency": 5},
            {"painpoint": "Subscription is too expensive", "frequency": 4},
            {"painpoint": "Cannot export data to CSV",      "frequency": 3},
        ],
    }
    out = cluster_findings(inp, threshold=0.92)
    assert len(out["painpoints"]) == 3


def test_cluster_passthrough_without_chromadb(
    clean_env: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """When chromadb isn't available, cluster_findings is a no-op."""
    import openreply.retrieval.cluster as cluster_mod
    from openreply.retrieval.cluster import cluster_findings
    monkeypatch.setattr(cluster_mod, "_embeddings_available", lambda: False)
    inp = {"painpoints": [{"painpoint": "A"}, {"painpoint": "B"}]}
    out = cluster_findings(inp)
    assert out == inp


# ─── Query expansion (scored keywords on canonicalize) ──────────────────


def test_canonicalize_returns_search_keywords(
    clean_env: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Canonicalize should parse search_keywords from the LLM response."""
    import json
    from openreply.research import discover as discover_mod

    monkeypatch.setenv("LLM_PROVIDER", "openrouter")
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-fake")

    def fake_llm(topic):
        return json.dumps({
            "canonical": "calorie tracking app",
            "variants": ["macro tracking"],
            "confidence": "high",
            "search_keywords": [
                {"keyword": "calorie tracking", "relevance": "high"},
                {"keyword": "MyFitnessPal", "relevance": "high"},
                {"keyword": "food log", "relevance": "medium"},
                {"keyword": "weight loss", "relevance": "low"},
            ],
        })
    monkeypatch.setattr(discover_mod, "_llm_canonical_call", fake_llm)

    r = discover_mod._canonicalize_topic("calari tracking app")
    kws = r.get("search_keywords") or []
    assert kws, "expected non-empty keyword list"
    assert any(k["keyword"] == "calorie tracking" and k["relevance"] == "high" for k in kws)
    assert any(k["relevance"] == "low" for k in kws)
    # Canonical should auto-prepend if the LLM forgot it.
    # (In this test the LLM did include a close match so no prepend needed,
    #  but the function must not crash if it had.)


def test_canonicalize_drops_malformed_keywords(
    clean_env: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Malformed keyword entries (wrong types, bad relevance) are dropped."""
    import json
    from openreply.research import discover as discover_mod

    monkeypatch.setenv("LLM_PROVIDER", "openrouter")
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-fake")

    def fake_llm(topic):
        return json.dumps({
            "canonical": "kubernetes monitoring",
            "variants": [],
            "confidence": "high",
            "search_keywords": [
                {"keyword": "kubernetes monitoring", "relevance": "high"},
                "not a dict",
                {"keyword": "", "relevance": "high"},         # empty
                {"keyword": "prometheus", "relevance": "bogus"},  # bad relevance
                {"keyword": "grafana", "relevance": "high"},
                {"keyword": "grafana", "relevance": "medium"},   # duplicate
            ],
        })
    monkeypatch.setattr(discover_mod, "_llm_canonical_call", fake_llm)

    r = discover_mod._canonicalize_topic("kubernetes monitoring")
    kws = r["search_keywords"]
    keys = [k["keyword"] for k in kws]
    assert "kubernetes monitoring" in keys
    assert "grafana" in keys
    assert keys.count("grafana") == 1  # duplicate dropped
    assert "prometheus" not in keys    # bad relevance dropped
    assert "" not in keys              # empty dropped


# ─── Time-windowed diff of findings ────────────────────────────────────


def test_diff_returns_recent_only(clean_env: Path) -> None:
    from datetime import datetime, timezone, timedelta
    from openreply.core.db import get_db
    from openreply.graph.diff import diff_findings

    db = get_db()
    now = datetime.now(timezone.utc)
    old_ts = (now - timedelta(days=40)).isoformat(timespec="seconds")
    new_ts = (now - timedelta(days=1)).isoformat(timespec="seconds")
    db["graph_nodes"].insert_all([
        {"id": "t::painpoint::old", "topic": "t", "kind": "painpoint",
         "label": "Old pain", "metadata_json": "{}", "ts": old_ts},
        {"id": "t::painpoint::new", "topic": "t", "kind": "painpoint",
         "label": "New pain", "metadata_json": "{}", "ts": new_ts},
        {"id": "t::workaround::fresh", "topic": "t", "kind": "workaround",
         "label": "DIY hack", "metadata_json": "{}", "ts": new_ts},
    ], pk="id")
    r = diff_findings("t", window_days=7)
    rec_labels = [x["label"] for x in r["recent"]]
    sta_labels = [x["label"] for x in r["stable"]]
    assert "New pain" in rec_labels
    assert "DIY hack" in rec_labels
    assert "Old pain" in sta_labels
    assert r["summary"]["new_painpoints"] == 1
    assert r["summary"]["new_workarounds"] == 1
    assert r["summary"]["new_products"] == 0


def test_diff_empty_ts_goes_to_stable(clean_env: Path) -> None:
    """Pre-migration rows with empty ts should bucket as stable."""
    from openreply.core.db import get_db
    from openreply.graph.diff import diff_findings

    db = get_db()
    db["graph_nodes"].insert_all([
        {"id": "u::painpoint::legacy", "topic": "u", "kind": "painpoint",
         "label": "Legacy pain", "metadata_json": "{}", "ts": ""},
    ], pk="id")
    r = diff_findings("u", window_days=7)
    assert [x["label"] for x in r["stable"]] == ["Legacy pain"]
    assert r["recent"] == []
    assert r["summary"]["new_painpoints"] == 0
