from gapmap.core import runctx


def test_run_id_lifecycle():
    assert runctx.current_run_id() == ""
    rid = runctx.new_run_id(); assert len(rid) >= 8
    runctx.set_run_id(rid); assert runctx.current_run_id() == rid
    runctx.set_run_id(""); assert runctx.current_run_id() == ""
