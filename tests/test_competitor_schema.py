from openreply.core.db import get_db


def test_product_competitors_has_new_columns():
    db = get_db()
    cols = {c.name for c in db["product_competitors"].columns}
    for c in ("slug", "topic", "aliases_json", "subreddits_json",
              "source_config_json", "status", "daily_fetch", "in_opp_scan",
              "notes", "updated_at"):
        assert c in cols, f"missing column {c}"


def test_competitor_snapshots_table_exists():
    db = get_db()
    assert "competitor_snapshots" in db.table_names()
    cols = {c.name for c in db["competitor_snapshots"].columns}
    for c in ("id", "product_id", "competitor_name", "sweep_id",
              "created_at", "metrics_json", "summary", "delta_json"):
        assert c in cols
