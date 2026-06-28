import os, tempfile, time
os.environ.setdefault("GAPMAP_DATA_DIR", tempfile.mkdtemp())


def test_suggest_ideas_fail_soft():
    from gapmap.reply import agent as A, ideas as I
    a = A.create_agent(name="IdeaCo", make_active=True)
    r = I.suggest_ideas(a["id"])  # no memories/clusters yet
    assert r["ok"] is True and isinstance(r["ideas"], list)


def test_idea_status_roundtrip():
    from gapmap.reply import agent as A, ideas as I
    from gapmap.reply.schema import init_reply_schema
    a = A.create_agent(name="IdeaCo2", make_active=True)
    db = init_reply_schema()
    db["reply_ideas"].insert(
        {"id": "x1", "agent_id": a["id"], "title": "T", "thesis": "th",
         "kind": "article", "combines_json": "[]", "source_mix": "mixed",
         "goal_fit": 0.7, "status": "suggested", "created_at": int(time.time())},
        pk="id")
    I.set_idea_status("x1", "dismissed")
    got = [i for i in I.list_ideas(a["id"]) if i["id"] == "x1"][0]
    assert got["status"] == "dismissed"
