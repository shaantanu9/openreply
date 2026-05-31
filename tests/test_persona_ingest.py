"""Unit tests for batched persona ingest (learn-from-all).

Verifies that ingest distills multiple posts in ONE LLM call (batching) and
still maps each distilled lesson back to its own source post.
"""
from __future__ import annotations

import json


class _FakeProvider:
    """Stub LLM provider that returns a fixed batch payload + counts calls."""

    def __init__(self, payload: str):
        self._payload = payload
        self.calls = 0

    def complete(self, prompt, system, max_tokens=400, temperature=0.2):  # noqa: ANN001
        self.calls += 1
        return self._payload


def test_ingest_persona_batches_posts_into_one_call(tmp_path, monkeypatch):
    monkeypatch.setenv("GAPMAP_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("PERSONA_INGEST_BATCH_SIZE", "8")

    from gapmap.core.db import get_db

    get_db.cache_clear()
    db = get_db()

    from gapmap.persona.store import create_persona

    res = create_persona("Tester", "learn things", "stress")
    assert res.get("ok"), res
    pid = res["id"]

    # Two un-ingested posts in the corpus.
    db["posts"].insert_all(
        [
            {"id": "p1", "title": "Burnout at work",
             "selftext": "I feel exhausted constantly and can't recover on weekends.",
             "source_type": "reddit", "score": 10, "fetched_at": "2026-01-01T00:00:00"},
            {"id": "p2", "title": "Coping with deadlines",
             "selftext": "Breaking tasks into small steps keeps the panic down.",
             "source_type": "reddit", "score": 5, "fetched_at": "2026-01-01T00:00:01"},
        ],
        pk="id",
        alter=True,
    )

    # One batched response covering BOTH posts, keyed by 1-based index.
    payload = json.dumps([
        {"i": 1, "link_type": "direct", "lesson": "Chronic exhaustion that survives rest signals burnout.",
         "excerpt": "exhausted constantly", "importance": 0.8, "tags": ["burnout"], "evolves_from": []},
        {"i": 2, "link_type": "indirect", "lesson": "Task decomposition lowers deadline stress.",
         "excerpt": "Breaking tasks into small steps", "importance": 0.6, "tags": ["coping"], "evolves_from": []},
    ])
    fake = _FakeProvider(payload)

    import gapmap.analyze.providers.base as base
    monkeypatch.setattr(base, "get_provider", lambda *_a, **_k: fake)
    # Skip the chromadb edge-build step in the unit test.
    import gapmap.persona.graph as pgraph
    monkeypatch.setattr(pgraph, "embed_and_link", lambda *a, **k: 0, raising=False)

    from gapmap.persona.ingest import ingest_persona

    events = list(ingest_persona(pid, limit=1000))
    memories = [e for e in events if e["event"] == "memory"]
    done = [e for e in events if e["event"] == "done"][0]

    # The whole point of batching: 2 posts == 1 LLM call.
    assert fake.calls == 1, f"2 posts should be ONE batched LLM call, got {fake.calls}"
    assert len(memories) == 2, f"expected 2 memories, got {len(memories)}"
    assert {m["post_id"] for m in memories} == {"p1", "p2"}
    assert done["kept"] == 2
    stored = db.execute(
        "SELECT count(*) FROM persona_memories WHERE persona_id = ?", [pid]
    ).fetchone()[0]
    assert stored == 2, f"expected 2 stored memories, got {stored}"


def test_ingest_persona_skips_irrelevant_in_batch(tmp_path, monkeypatch):
    """A post the model omits from the array is skipped, not stored."""
    monkeypatch.setenv("GAPMAP_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("PERSONA_INGEST_BATCH_SIZE", "8")

    from gapmap.core.db import get_db

    get_db.cache_clear()
    db = get_db()

    from gapmap.persona.store import create_persona

    pid = create_persona("Tester2", "learn", "stress")["id"]
    db["posts"].insert_all(
        [
            # Candidates are ordered fetched_at DESC, so the NEWER post is
            # presented to the model as "POST 1". Make the relevant one newest.
            {"id": "a", "title": "Relevant", "selftext": "stress and burnout discussion",
             "source_type": "reddit", "score": 1, "fetched_at": "2026-01-01T00:00:02"},
            {"id": "b", "title": "Unrelated", "selftext": "best pizza recipe ever",
             "source_type": "reddit", "score": 1, "fetched_at": "2026-01-01T00:00:00"},
        ],
        pk="id",
        alter=True,
    )
    # Only post #1 comes back relevant; #2 is omitted.
    payload = json.dumps([
        {"i": 1, "link_type": "direct", "lesson": "Stress shows up in how people talk.",
         "importance": 0.5, "tags": [], "evolves_from": []},
    ])
    fake = _FakeProvider(payload)
    import gapmap.analyze.providers.base as base
    monkeypatch.setattr(base, "get_provider", lambda *_a, **_k: fake)
    import gapmap.persona.graph as pgraph
    monkeypatch.setattr(pgraph, "embed_and_link", lambda *a, **k: 0, raising=False)

    from gapmap.persona.ingest import ingest_persona

    events = list(ingest_persona(pid, limit=1000))
    memories = [e for e in events if e["event"] == "memory"]
    skips = [e for e in events if e["event"] == "skip" and e.get("reason") == "not_relevant"]
    assert len(memories) == 1 and memories[0]["post_id"] == "a"
    assert any(s["post_id"] == "b" for s in skips)
