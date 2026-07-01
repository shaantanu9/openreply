from openreply.research.competitor_intel import signals as S


def test_write_and_list_findings():
    sid = S.write_signal("p1", "Notion", signal_type="complaint",
                         title="slow sync", severity=0.8,
                         evidence_post_ids=["a", "b"])
    assert sid
    found = S.list_findings("p1", "Notion", kinds=["complaint"])
    assert any(f["id"] == sid for f in found)
    f = next(f for f in found if f["id"] == sid)
    assert f["evidence_post_ids"] == ["a", "b"]
    assert f["related_competitor"] == "Notion"


def test_list_opportunities_filters_kind():
    S.write_signal("p2", "Obsidian", signal_type="competitor_vulnerability",
                   title="no mobile sync", suggested_action="ship sync")
    S.write_signal("p2", "Obsidian", signal_type="complaint", title="x")
    opps = S.list_opportunities("p2")
    assert all(o["signal_type"] == "competitor_vulnerability" for o in opps)
    assert any(o["title"] == "no mobile sync" for o in opps)


def test_set_signal_action():
    sid = S.write_signal("p3", "A", signal_type="complaint", title="t")
    out = S.set_signal_action(sid, "dismissed")
    assert out["user_action"] == "dismissed"
