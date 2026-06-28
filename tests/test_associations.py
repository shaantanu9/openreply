import os, tempfile
os.environ.setdefault("OPENREPLY_DATA_DIR", tempfile.mkdtemp())


def test_link_associations_fail_soft_no_personas():
    """No linked personas (or a single one) → 0 edges, never raises."""
    from openreply.reply import agent as A
    from openreply.persona import graph as G
    a = A.create_agent(name="AssocCo", make_active=True)
    n = G.link_associations(a["id"])
    assert isinstance(n, int) and n >= 0


def test_list_associations_empty_ok():
    from openreply.reply import agent as A
    from openreply.persona import graph as G
    a = A.create_agent(name="AssocCo2", make_active=True)
    rows = G.list_associations(a["id"])
    assert isinstance(rows, list)


def test_neighbors_excludes_associates_by_default():
    """An `associates` edge must not surface in the default reply-blend neighbors,
    but should when include_associates=True."""
    from openreply.core.db import get_db
    from openreply.persona import graph as G
    db = get_db()
    # two memories under persona 9991 + an associates edge between them
    for mid, lesson in ((90001, "students hate manual tagging"),
                        (90002, "competitor lacks auto-linking")):
        db["persona_memories"].insert(
            {"id": mid, "persona_id": 9991, "source_post_id": f"p{mid}",
             "topic": "t", "lesson": lesson, "excerpt": "", "tags": "[]",
             "importance": 0.5, "created_at": "2026-01-01T00:00:00"},
            pk="id", alter=True, replace=True)
    db["persona_edges"].insert(
        {"persona_id": 9991, "from_memory_id": 90001, "to_memory_id": 90002,
         "kind": "associates", "weight": 0.8, "meta": "both about linking",
         "created_at": "2026-01-01T00:00:00"}, alter=True)
    assert G.neighbors(9991, [90001]) == []  # associates hidden by default
    inc = G.neighbors(9991, [90001], include_associates=True)
    assert any(r["id"] == 90002 for r in inc)
