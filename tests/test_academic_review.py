"""Tests for the multi-reviewer peer-review panel (academic_review.py).

All LLM calls are mocked — no network / no real provider is hit. We patch
the symbols inside `gapmap.analyze.providers.base` (which the module imports
lazily) so `resolve_provider` / `get_provider` are deterministic.
"""
from __future__ import annotations

import json

import pytest

from gapmap.research import academic_review as ar


# ── Fakes ─────────────────────────────────────────────────────────────

class _FakeProvider:
    """Returns a scripted JSON review per call, cycling through a queue."""

    def __init__(self, reviews_by_call):
        # reviews_by_call: list of dicts (one per reviewer call, in order)
        self._queue = list(reviews_by_call)
        self._i = 0

    def complete(self, prompt, system=None, max_tokens=2048, temperature=0.2):
        if self._i < len(self._queue):
            payload = self._queue[self._i]
        else:
            payload = self._queue[-1]
        self._i += 1
        return json.dumps(payload)


class _RaisingProvider:
    def complete(self, *a, **k):
        raise RuntimeError("provider boom")


def _patch_provider(monkeypatch, provider_obj, *, resolves=True):
    import gapmap.analyze.providers.base as base
    if resolves:
        monkeypatch.setattr(base, "resolve_provider", lambda p=None: "fakeprov")
        monkeypatch.setattr(base, "get_provider", lambda name=None: provider_obj)
    else:
        def _boom(*a, **k):
            raise RuntimeError("no provider")
        monkeypatch.setattr(base, "resolve_provider", _boom)
        monkeypatch.setattr(base, "get_provider", _boom)


def _items(n=2):
    return [
        {"key": f"gap:{i}", "title": f"Gap {i}", "detail": f"detail {i}",
         "supporting_post_ids": [f"p{i}"]}
        for i in range(n)
    ]


def _review(score, rec, *, concerns=None, strengths=None, weaknesses=None):
    return {
        "score": score,
        "recommendation": rec,
        "strengths": strengths or ["clear"],
        "weaknesses": weaknesses or ["thin"],
        "critical_concerns": concerns or [],
    }


# ── (1) Decision threshold mapping ────────────────────────────────────

@pytest.mark.parametrize("scores,expected", [
    ([90, 88, 85, 82, 80], "accept"),          # mean 85 → accept (no concerns)
    ([70, 70, 70, 70, 70], "minor_revision"),  # mean 70
    ([55, 55, 55, 55, 55], "major_revision"),  # mean 55
    ([40, 40, 40, 40, 40], "reject"),          # mean 40
])
def test_decision_threshold_mapping(monkeypatch, scores, expected):
    # 5 reviewers; devil's advocate is last role — give it no concern here
    # by using "minor" rec, but it auto-gets a concern, so for the pure
    # threshold test we keep the panel non-devils by passing custom roles.
    roles = [{"key": f"r{i}", "name": f"R{i}"} for i in range(len(scores))]
    reviews = [_review(s, "minor") for s in scores]
    _patch_provider(monkeypatch, _FakeProvider(reviews))

    out = ar.run_review_panel("topic x", _items(), roles=roles)

    assert out["ok"] is True
    assert out["mean_score"] == pytest.approx(sum(scores) / len(scores))
    assert out["editorial_decision"] == expected
    assert out["critical_blocks"] is False


# ── (2) Devil's advocate critical concern downgrades accept ───────────

def test_devils_advocate_concern_downgrades_accept(monkeypatch):
    # High scores → would be "accept", but devil's advocate raises a concern.
    # Default roles include devils_advocate as the 5th reviewer.
    reviews = [
        _review(90, "accept"),  # editor_in_chief
        _review(88, "accept"),  # methodology_reviewer
        _review(86, "accept"),  # domain_reviewer
        _review(84, "accept"),  # perspective_reviewer
        _review(82, "accept", concerns=["fatal sampling bias"]),  # devils_advocate
    ]
    _patch_provider(monkeypatch, _FakeProvider(reviews))

    out = ar.run_review_panel("topic y", _items())

    assert out["ok"] is True
    assert out["mean_score"] >= 80              # would be accept on score alone
    assert out["editorial_decision"] == "minor_revision"
    assert out["critical_blocks"] is True


def test_devils_advocate_auto_concern_when_omitted(monkeypatch):
    # DA returns no concern; module must synthesise one (hard rule).
    reviews = [
        _review(90, "accept"),
        _review(90, "accept"),
        _review(90, "accept"),
        _review(90, "accept"),
        _review(90, "accept", concerns=[]),  # devils_advocate, empty
    ]
    _patch_provider(monkeypatch, _FakeProvider(reviews))

    out = ar.run_review_panel("topic z", _items())

    da = next(r for r in out["reviewers"] if r["role"] == "devils_advocate")
    assert da["critical_concerns"]              # auto-filled
    assert out["critical_blocks"] is True
    assert out["editorial_decision"] == "minor_revision"


# ── (3) Fallback path when provider raises ────────────────────────────

def test_fallback_when_provider_unresolvable(monkeypatch):
    _patch_provider(monkeypatch, None, resolves=False)

    out = ar.run_review_panel("topic f", _items())

    assert out["ok"] is False
    assert out["editorial_decision"] == "major_revision"
    assert out["mean_score"] == 60.0
    assert len(out["reviewers"]) == len(ar.DEFAULT_ROLES)
    assert all(r["provenance"] == "fallback" for r in out["reviewers"])
    assert all(r["score"] == 60 for r in out["reviewers"])
    assert all(r["recommendation"] == "major" for r in out["reviewers"])


def test_fallback_when_every_call_raises(monkeypatch):
    _patch_provider(monkeypatch, _RaisingProvider())

    out = ar.run_review_panel("topic g", _items())

    assert out["ok"] is False
    assert out["editorial_decision"] == "major_revision"
    assert all(r["provenance"] == "fallback" for r in out["reviewers"])


def test_empty_items_short_circuits(monkeypatch):
    _patch_provider(monkeypatch, _FakeProvider([_review(90, "accept")]))

    out = ar.run_review_panel("topic empty", [])

    assert out["ok"] is False
    assert out["n_items"] == 0
    assert out["editorial_decision"] == "major_revision"
    assert all(r["weaknesses"] for r in out["reviewers"])  # carries the note


# ── (4) Dissent collection ────────────────────────────────────────────

def test_dissent_collection(monkeypatch):
    roles = [{"key": f"r{i}", "name": f"R{i}"} for i in range(5)]
    reviews = [
        _review(78, "minor"),                       # not dissent
        _review(40, "reject", concerns=["fatal"]),  # dissent (reject)
        _review(55, "major"),                        # dissent (major)
        _review(82, "accept"),                       # not dissent
        _review(60, "major", weaknesses=["weak method"]),  # dissent (major)
    ]
    _patch_provider(monkeypatch, _FakeProvider(reviews))

    out = ar.run_review_panel("topic d", _items(), roles=roles)

    dissent_roles = {d["role"] for d in out["dissent"]}
    assert dissent_roles == {"r1", "r2", "r4"}
    recs = {d["role"]: d["recommendation"] for d in out["dissent"]}
    assert recs == {"r1": "reject", "r2": "major", "r4": "major"}
    # "why" prefers a critical concern, else a weakness.
    why_r1 = next(d["why"] for d in out["dissent"] if d["role"] == "r1")
    assert why_r1 == "fatal"
    why_r4 = next(d["why"] for d in out["dissent"] if d["role"] == "r4")
    assert why_r4 == "weak method"


def test_tolerant_parse_with_fences(monkeypatch):
    class _FencedProvider:
        def complete(self, prompt, system=None, max_tokens=2048, temperature=0.2):
            return "```json\n" + json.dumps(_review(72, "minor")) + "\n```"

    _patch_provider(monkeypatch, _FencedProvider())
    out = ar.run_review_panel("topic fence", _items())

    assert out["ok"] is True
    assert all(r["provenance"] == "reviewed" for r in out["reviewers"])
    assert out["editorial_decision"] == "minor_revision"
