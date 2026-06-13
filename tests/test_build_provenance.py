import inspect, gapmap.graph.build as b


def test_structural_callers_pass_provenance():
    src = inspect.getsource(b)
    assert 'provenance="structural"' in src or "provenance='structural'" in src
