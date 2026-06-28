import os, tempfile
os.environ.setdefault("OPENREPLY_DATA_DIR", tempfile.mkdtemp())


def test_goal_fields_persist_and_compose():
    from openreply.reply import agent as A
    a = A.create_agent(name="GoalCo", make_active=True)
    A.update_agent(a["id"], objective="drive signups",
                   audience="students", win_signal="reply + click",
                   guardrails="never spam")
    got = A.get_agent(a["id"])
    assert got["objective"] == "drive signups"
    assert got["audience"] == "students"
    assert got["win_signal"] == "reply + click"
    assert got["guardrails"] == "never spam"
    # composed goal threads objective + audience + win
    assert "drive signups" in got["goal"]
    assert "students" in got["goal"]
