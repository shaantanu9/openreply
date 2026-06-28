import os, tempfile
os.environ.setdefault("GAPMAP_DATA_DIR", tempfile.mkdtemp())


def test_evolve_skips_without_goal():
    from gapmap.reply import agent as A, playbook as P
    a = A.create_agent(name="NoGoalCo", make_active=True)
    r = P.evolve_playbook(a["id"])
    assert r["ok"] is False and r["skipped"] is True


def test_evolve_persists_version(monkeypatch):
    from gapmap.reply import agent as A, playbook as P
    a = A.create_agent(name="PBCo", make_active=True)
    A.update_agent(a["id"], objective="promote X", audience="devs", win_signal="signup")
    monkeypatch.setattr(P, "_llm_distill", lambda *args, **kw: {
        "winning_angles": [{"angle": "lead with the pain", "why": "resonates", "for": "devs"}],
        "phrasings": ["start with a question"], "avoid": ["links in first line"],
        "per_platform": {"reddit": "be helpful"}, "next_experiments": ["try a teardown"]})
    r = P.evolve_playbook(a["id"])
    assert r["ok"] and r["version"] == 1
    cur = P.current_playbook(a["id"])
    assert cur["version"] == 1
    assert cur["playbook"]["winning_angles"][0]["angle"] == "lead with the pain"
    r2 = P.evolve_playbook(a["id"])
    assert r2["version"] == 2  # versions increment


def test_playbook_block_renders(monkeypatch):
    from gapmap.reply import agent as A, playbook as P
    a = A.create_agent(name="BlkCo", make_active=True)
    A.update_agent(a["id"], objective="promote X")
    monkeypatch.setattr(P, "_llm_distill", lambda *x, **k: {
        "winning_angles": [{"angle": "lead with pain", "why": "works", "for": "all"}],
        "avoid": ["spam"]})
    P.evolve_playbook(a["id"])
    blk = P.playbook_block(a["id"])
    assert "STRATEGY PLAYBOOK v1" in blk and "lead with pain" in blk


def test_feedback_increments_counter(monkeypatch):
    from gapmap.reply import agent as A
    from gapmap.reply.schema import init_reply_schema
    a = A.create_agent(name="FbCo", make_active=True)
    A.update_agent(a["id"], objective="promote")
    import gapmap.reply.feedback as F
    monkeypatch.setattr(F, "_seed_corpus", lambda *x, **k: None)
    import gapmap.reply.playbook as P
    monkeypatch.setattr(P, "evolve_playbook", lambda *x, **k: {"ok": True})
    db = init_reply_schema()
    db["reply_opportunities"].insert(
        {"id": "o1", "brand_id": a["id"], "platform": "reddit_free",
         "post_id": "p1", "title": "t", "status": "new", "found_at": 0},
        pk="id", alter=True)
    F.record_opportunity_feedback("o1", "dismissed")
    got = A.get_agent(a["id"])
    assert int(got.get("feedback_since_evolve") or 0) >= 1
