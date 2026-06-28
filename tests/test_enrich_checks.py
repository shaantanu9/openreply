"""Task 7 — record_check instrumentation in _drain_batch.

_drain_batch calls _sem.enrich_from_llm_for_posts per topic group.
We mock that call so no LLM/network is needed, seed a queued row,
then assert a checks_ledger row with gate='llm_call' was written.
"""
from __future__ import annotations

import importlib
import tempfile


def test_drain_batch_records_check(monkeypatch, tmp_path):
    monkeypatch.setenv("OPENREPLY_DATA_DIR", str(tmp_path))

    # Fresh DB in isolated dir — clear the per-thread cache first.
    import openreply.core.db as db_mod
    importlib.reload(db_mod)
    db_mod.get_db.cache_clear()
    db = db_mod.get_db()

    # Seed a minimal extraction_queue row so _drain_batch has work to do.
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    db.conn.execute(
        "INSERT OR IGNORE INTO extraction_queue (topic, post_id, kind, queued_at, attempts) "
        "VALUES (?, ?, ?, ?, ?)",
        ("t", "p1", "post", now, 0),
    )
    db.conn.commit()

    # Reload enrich_worker so it picks up the env-patched data dir.
    import openreply.research.enrich_worker as ew_mod
    importlib.reload(ew_mod)

    # Mock _sem.enrich_from_llm_for_posts on the module's already-imported
    # reference so no real LLM or network call is made.
    from openreply.graph import semantic as _sem_real
    monkeypatch.setattr(_sem_real, "enrich_from_llm_for_posts",
                        lambda topic, post_ids: {"ok": True, "painpoints_added": 1})

    # Call the private drain function with the live DB handle.
    processed = ew_mod._drain_batch(db)

    # At least 1 row should have been processed.
    assert processed >= 1, f"expected processed>=1, got {processed}"

    # A checks_ledger row with gate='llm_call' must have been written.
    rows = list(db.query("SELECT * FROM checks_ledger"))
    assert any(r["gate"] == "llm_call" for r in rows), (
        f"No 'llm_call' gate row in checks_ledger. Rows: {rows}"
    )
