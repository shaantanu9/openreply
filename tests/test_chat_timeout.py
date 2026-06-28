"""Unit tests for chat/timeout.py — the palace wall-clock guard, in isolation.

Critical behaviour: a blocking palace read (e.g. ChromaDB lock held by a running
collect) must NOT hang chat — it must return (False, None) within ~timeout_s so
the caller can fall back to SQL retrieval.
"""
import importlib.util
import pathlib
import time

_ROOT = pathlib.Path(__file__).resolve().parents[1]


def _load(rel_path, name):
    spec = importlib.util.spec_from_file_location(name, _ROOT / rel_path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


to = _load("src/openreply/research/chat/timeout.py", "chat_timeout")


def test_returns_result_when_fast():
    ok, val = to.call_with_timeout(lambda: 42, timeout_s=1.0)
    assert ok is True and val == 42


def test_times_out_fast_without_waiting_for_the_blocking_call():
    start = time.time()
    ok, val = to.call_with_timeout(lambda: time.sleep(30), timeout_s=0.2)
    elapsed = time.time() - start
    assert ok is False and val is None
    # Must return ~0.2s, NOT wait for the 30s sleep (the anti-hang guarantee).
    assert elapsed < 2.0, f"call_with_timeout waited too long: {elapsed:.2f}s"


def test_exception_is_treated_as_failure():
    def boom():
        raise ValueError("palace exploded")

    ok, val = to.call_with_timeout(boom, timeout_s=1.0)
    assert ok is False and val is None


def test_default_timeout_constant_is_positive():
    assert to.PALACE_CHAT_TIMEOUT > 0
    assert to._PALACE_CHAT_TIMEOUT == to.PALACE_CHAT_TIMEOUT
    assert to._call_with_timeout is to.call_with_timeout
