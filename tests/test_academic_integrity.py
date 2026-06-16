"""Tests for the academic-integrity gate.

All provider access is mocked — NO network/LLM is hit. The module does a
late import of ``resolve_provider`` / ``get_provider`` from
``gapmap.analyze.providers.base``, so we monkeypatch those names on that
module and feed a fake provider whose ``complete`` returns canned JSON.
"""
from __future__ import annotations

import json

import pytest

from gapmap.research import academic_integrity as ai


class _FakeProvider:
    """Returns a fixed JSON string regardless of prompt."""

    def __init__(self, payload):
        self._payload = payload

    def complete(self, prompt, system=None, max_tokens=2048, temperature=0.2):
        return self._payload


def _patch_provider(monkeypatch, payload=None, raise_on_resolve=False,
                    raise_on_complete=False):
    import gapmap.analyze.providers.base as base

    if raise_on_resolve:
        def _resolve(p=None):
            raise RuntimeError("no provider configured")
        monkeypatch.setattr(base, "resolve_provider", _resolve)
        return

    monkeypatch.setattr(base, "resolve_provider", lambda p=None: "fake")

    if raise_on_complete:
        class _Boom:
            def complete(self, *a, **k):
                raise RuntimeError("llm exploded")
        monkeypatch.setattr(base, "get_provider", lambda name=None: _Boom())
        return

    monkeypatch.setattr(base, "get_provider",
                        lambda name=None: _FakeProvider(payload))


# ── 1. Blocking-mode suspected finding → FAIL + blocking True ─────────

def test_blocking_mode_suspected_fails(monkeypatch):
    claims = ["We implemented X and ran it.", "The method is sound."]
    payload = json.dumps([
        {"claim_index": 0, "mode": "M1", "verdict": "suspected",
         "note": "no artifact"},
        {"claim_index": 1, "mode": "none", "verdict": "clean", "note": "ok"},
    ])
    _patch_provider(monkeypatch, payload=payload)

    res = ai.run_integrity_check("topic", "brief", claims, final=True)

    assert res["ok"] is True
    assert res["verdict"] == "FAIL"
    assert res["blocking"] is True
    assert len(res["blocking_findings"]) == 1
    assert res["blocking_findings"][0]["mode"] == "M1"


# ── 2. Non-blocking mode (M2) suspected → PASS + blocking False ───────

def test_nonblocking_mode_suspected_passes(monkeypatch):
    claims = ["Smith et al. show Y.", "Another claim."]
    payload = json.dumps([
        {"claim_index": 0, "mode": "M2", "verdict": "suspected",
         "note": "citation not in corpus"},
        {"claim_index": 1, "mode": "none", "verdict": "clean", "note": "ok"},
    ])
    _patch_provider(monkeypatch, payload=payload)

    res = ai.run_integrity_check("topic", "brief", claims, final=True)

    assert res["ok"] is True
    assert res["verdict"] == "PASS"
    assert res["blocking"] is False
    assert res["blocking_findings"] == []
    # The M2 finding is still recorded.
    assert any(f["mode"] == "M2" for f in res["findings"])


# ── 3. Empty claims → PASS, ok False, blocking False ──────────────────

def test_empty_claims(monkeypatch):
    # Provider should never even be consulted; patch it to blow up if used.
    _patch_provider(monkeypatch, raise_on_complete=True)

    res = ai.run_integrity_check("topic", "brief", [])

    assert res["ok"] is False
    assert res["verdict"] == "PASS"
    assert res["blocking"] is False
    assert res["total"] == 0
    assert res["sampled"] == 0
    assert any("no claims" in f["note"] for f in res["findings"])


# ── 4. Provider raises → ok False, blocking False (skip, not block) ───

def test_provider_raises_skips(monkeypatch):
    claims = ["A claim.", "Another claim."]
    _patch_provider(monkeypatch, raise_on_complete=True)

    res = ai.run_integrity_check("topic", "brief", claims, final=True)

    assert res["ok"] is False
    assert res["verdict"] == "PASS"
    assert res["blocking"] is False
    assert res["blocking_findings"] == []
    assert any("skipped" in f["note"] for f in res["findings"])


def test_resolve_raises_skips(monkeypatch):
    claims = ["A claim."]
    _patch_provider(monkeypatch, raise_on_resolve=True)

    res = ai.run_integrity_check("topic", "brief", claims)

    assert res["ok"] is False
    assert res["verdict"] == "PASS"
    assert res["blocking"] is False


# ── 5. final=True audits all claims (sampled == total) ────────────────

def test_final_audits_all_claims(monkeypatch):
    claims = [f"Claim number {i}." for i in range(10)]
    payload = json.dumps([
        {"claim_index": i, "mode": "none", "verdict": "clean", "note": "ok"}
        for i in range(10)
    ])
    _patch_provider(monkeypatch, payload=payload)

    res = ai.run_integrity_check("topic", "brief", claims, final=True)

    assert res["ok"] is True
    assert res["sampled"] == res["total"] == 10
    assert res["verdict"] == "PASS"


def test_sample_ratio_subsets_when_not_final(monkeypatch):
    claims = [f"Claim {i}." for i in range(10)]
    payload = json.dumps([])  # findings empty is fine; we only check sampling
    _patch_provider(monkeypatch, payload=payload)

    res = ai.run_integrity_check("topic", "brief", claims,
                                 sample_ratio=0.3, final=False)

    # round(10 * 0.3) == 3
    assert res["sampled"] == 3
    assert res["total"] == 10
    assert res["final"] is False
