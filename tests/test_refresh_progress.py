"""Test structured progress event parsing for `agent refresh --stream`."""
from openreply.cli._progress import to_structured_event


def test_source_done_line():
    assert to_structured_event("[19/23] [hn] ✓ 125 posts (60.3s)") == {
        "event": "source", "name": "hn", "status": "done",
        "count": 125, "index": 19, "total": 23,
    }


def test_source_error_line():
    ev = to_structured_event("  ! [youtube] ✗ timed out after 240s — skipped")
    assert ev == {"event": "source", "name": "youtube", "status": "error"}


def test_learn_phase():
    assert to_structured_event("learning · Logiciel — niche brain: reading new posts…") == {
        "event": "phase", "name": "learn"}


def test_canonicalize_phase():
    assert to_structured_event("canonicalizing topic via LLM (first run may take ~30-60s)…") == {
        "event": "phase", "name": "canonicalize"}


def test_unrecognized_is_log():
    assert to_structured_event("embedder warmed in 0.2s") == {
        "event": "log", "msg": "embedder warmed in 0.2s"}
