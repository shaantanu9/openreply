from openreply.core import runctx


def test_run_id_lifecycle():
    # Reset first — contextvars are process-global, so a prior test that set a
    # run id (e.g. the enrich-checks test) would otherwise leak into this one.
    runctx.set_run_id("")
    assert runctx.current_run_id() == ""
    rid = runctx.new_run_id(); assert len(rid) >= 8
    runctx.set_run_id(rid); assert runctx.current_run_id() == rid
    runctx.set_run_id(""); assert runctx.current_run_id() == ""
