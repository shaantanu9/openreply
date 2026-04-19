# Research Loop MVP — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 4-stage Problem → Why → Science → Solution pipeline that turns each painpoint into evidence-backed interventions, surfaced via a new "Solutions" tab in the Tauri app.

**Architecture:** Three new Python modules (`research/why.py`, `research/science.py`, `research/solutions.py`) chained by a single `solutions_pipeline()` orchestrator. Reuses existing PubMed/Scholar/OpenAlex fetchers — no new sources. Persists 3 new graph node kinds (`mechanism`, `intervention`, `evidence_paper`) via the existing `graph_nodes`/`graph_edges` tables (loose schema, no migration). Frontend adds one tab to `screens/topic.js` that calls a new Tauri command `run_solutions_pipeline`.

**Tech Stack:** Python 3.11+ (typer CLI, sqlite-utils, httpx), Rust (Tauri commands), vanilla JS (frontend), pytest for tests, existing LLM provider abstraction (`reddit_research.analyze.providers`).

**Spec:** `docs/superpowers/specs/2026-04-19-research-loop-design.md`

---

## File Structure

**New Python files:**
- `src/reddit_research/research/why.py` — `extract_why_for_painpoint(...)` + `extract_why_for_topic(...)`
- `src/reddit_research/research/science.py` — `fetch_science_for_painpoint(...)` + `fetch_science_for_topic(...)`
- `src/reddit_research/research/solutions.py` — `synthesize_solutions_for_painpoint(...)` + `solutions_pipeline(topic)`
- `src/reddit_research/research/persist_solutions.py` — graph upserts for the 3 new node kinds (kept separate from `graph/semantic.py` so existing enrich code stays small)

**New prompt files:**
- `prompts/why.yaml`
- `prompts/solutions.yaml`

**New test files:**
- `tests/test_why.py`
- `tests/test_science.py`
- `tests/test_solutions.py`
- `tests/test_solutions_persist.py`
- `tests/test_solutions_pipeline.py`

**New frontend files:**
- `app-tauri/src/screens/solutions.js` — Solutions tab content + render logic

**Modified Python files:**
- `src/reddit_research/cli/main.py` — register new `research solutions run` subcommand
- `src/reddit_research/research/__init__.py` — re-export new functions

**Modified Rust files:**
- `app-tauri/src-tauri/src/commands.rs` — new `run_solutions_pipeline` command
- `app-tauri/src-tauri/src/main.rs` — register the command

**Modified JS files:**
- `app-tauri/src/api.js` — `runSolutionsPipeline(topic)` wrapper
- `app-tauri/src/screens/topic.js` — add 7th tab "🧪 Solutions" + wire `loadSolutions`

**Why this split:**
- Each new module has one job (extraction / fetching / synthesis / persistence). Files stay <250 lines.
- `persist_solutions.py` keeps graph mutations isolated from LLM logic so they can be tested without a provider.
- One end-to-end CLI command (`research solutions run`) keeps the Tauri surface tiny — frontend only needs one new IPC call.

---

## Test Strategy

- **Unit tests** mock the LLM provider and HTTP fetchers — no network, no keys needed. Same pattern as existing `tests/test_smoke.py`.
- **One integration test** runs the full pipeline against an in-memory DB with mocked LLM + fetchers, asserts node/edge counts.
- **Manual smoke test** at the end (Task 13) hits the real Tauri app on a real topic. No automated browser test for MVP.

---

## Task 1: Add `why.yaml` prompt

**Files:**
- Create: `prompts/why.yaml`

- [ ] **Step 1: Create the prompt file**

```yaml
name: why
description: Extract emotion vector + JTBD context for a single painpoint, grounded in evidence posts.

system: |
  You are a behavioral researcher. For ONE painpoint and 3-5 evidence posts,
  return a JSON object with:
    - emotions: list of Plutchik primary emotions present in the posts
      (anger, anticipation, joy, trust, fear, surprise, sadness, disgust).
      Pick at most 3, ordered by salience.
    - jtbd: object with three string fields:
        struggling_moment: when does the user hit this painpoint? (one sentence)
        anxiety: what are they afraid of? (one sentence)
        desired_outcome: what would success feel like? (one sentence)

  Quote sparingly from the posts. Be specific and concrete — generic answers
  ("users are frustrated") are wrong. Reply with JSON only, no markdown fences.

  Schema:
  {
    "emotions": ["fear", "sadness"],
    "jtbd": {
      "struggling_moment": "...",
      "anxiety": "...",
      "desired_outcome": "..."
    }
  }

user_template: |
  Painpoint: {painpoint_label}

  Evidence posts:

  {evidence}
```

- [ ] **Step 2: Verify the prompt loads**

Run: `.venv/bin/python -c "from reddit_research.research.prompts import load_extractor; print(load_extractor('why')['system'][:80])"`
Expected: prints first 80 chars of the system prompt without error.

- [ ] **Step 3: Commit**

```bash
git add prompts/why.yaml
git commit -m "feat(research-loop): add why.yaml prompt for emotion + JTBD extraction"
```

---

## Task 2: Implement `extract_why_for_painpoint`

**Files:**
- Create: `src/reddit_research/research/why.py`
- Test: `tests/test_why.py`

- [ ] **Step 1: Write failing test**

Create `tests/test_why.py`:

```python
"""Unit tests for research.why — emotion + JTBD extraction per painpoint."""
from __future__ import annotations

import json

import pytest

from reddit_research.research import why as why_mod


class FakeProvider:
    def __init__(self, payload: dict) -> None:
        self.payload = payload
        self.last_prompt: str | None = None
        self.last_system: str | None = None

    def complete(self, prompt: str, system: str, **kwargs) -> str:
        self.last_prompt = prompt
        self.last_system = system
        return json.dumps(self.payload)


def test_extract_why_returns_emotions_and_jtbd(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = FakeProvider({
        "emotions": ["fear", "sadness"],
        "jtbd": {
            "struggling_moment": "trying to start hard tasks",
            "anxiety": "I'll never finish",
            "desired_outcome": "two-hour focused block",
        },
    })
    monkeypatch.setattr(why_mod, "get_provider", lambda _name=None: fake)

    result = why_mod.extract_why_for_painpoint(
        painpoint_label="can't focus more than 10 minutes",
        evidence_posts=[
            {"id": "p1", "title": "I keep getting distracted", "selftext": "every time I open my laptop..."},
            {"id": "p2", "title": "Focus is impossible", "selftext": "tried pomodoro, failed..."},
        ],
        provider="fake",
    )

    assert result["emotions"] == ["fear", "sadness"]
    assert result["jtbd"]["struggling_moment"] == "trying to start hard tasks"
    assert "can't focus" in fake.last_prompt
    assert "I keep getting distracted" in fake.last_prompt


def test_extract_why_handles_bad_json(monkeypatch: pytest.MonkeyPatch) -> None:
    class BadProvider:
        def complete(self, prompt: str, system: str, **kwargs) -> str:
            return "not valid json {"
    monkeypatch.setattr(why_mod, "get_provider", lambda _name=None: BadProvider())

    result = why_mod.extract_why_for_painpoint(
        painpoint_label="x",
        evidence_posts=[{"id": "p1", "title": "y", "selftext": "z"}],
        provider="fake",
    )

    assert result.get("_parse_error") is True
    assert "_raw" in result


def test_extract_why_empty_evidence_returns_skip() -> None:
    result = why_mod.extract_why_for_painpoint(
        painpoint_label="x",
        evidence_posts=[],
        provider="fake",
    )
    assert result == {"_skipped": True, "reason": "no_evidence"}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_why.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'reddit_research.research.why'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/reddit_research/research/why.py`:

```python
"""Per-painpoint emotion + JTBD extraction.

One LLM call per painpoint, grounded in the evidence posts already linked
to that painpoint by the gap-mining stage. Returns structured JSON that
is stored as metadata on the painpoint graph node.
"""
from __future__ import annotations

import json
from typing import Any

from ..analyze.providers.base import get_provider
from .prompts import load_extractor


def _format_evidence(posts: list[dict[str, Any]]) -> str:
    parts = []
    for p in posts[:5]:
        body = (p.get("selftext") or "")[:400]
        parts.append(f"[{p.get('id', '?')}] {p.get('title', '')}\n{body}")
    return "\n\n".join(parts)


def _parse_json(raw: str) -> dict[str, Any]:
    cleaned = raw.strip()
    for fence in ("```json", "```"):
        if cleaned.startswith(fence):
            cleaned = cleaned[len(fence):].lstrip()
    if cleaned.endswith("```"):
        cleaned = cleaned[:-3].rstrip()
    try:
        parsed = json.loads(cleaned)
        if isinstance(parsed, dict):
            return parsed
        return {"_parse_error": True, "_raw": raw}
    except json.JSONDecodeError:
        return {"_parse_error": True, "_raw": raw}


def extract_why_for_painpoint(
    painpoint_label: str,
    evidence_posts: list[dict[str, Any]],
    provider: str | None = None,
) -> dict[str, Any]:
    """Run the why extractor for one painpoint.

    Returns either {emotions, jtbd} or {_skipped: True, reason: ...} or
    {_parse_error: True, _raw: ...}. Never raises on bad LLM output.
    """
    if not evidence_posts:
        return {"_skipped": True, "reason": "no_evidence"}

    ext = load_extractor("why")
    user = ext["user_template"].format(
        painpoint_label=painpoint_label,
        evidence=_format_evidence(evidence_posts),
    )
    raw = get_provider(provider).complete(
        prompt=user, system=ext["system"], max_tokens=512, temperature=0.2
    )
    return _parse_json(raw)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/pytest tests/test_why.py -v`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/reddit_research/research/why.py tests/test_why.py
git commit -m "feat(research-loop): extract_why_for_painpoint (Plutchik emotions + JTBD)"
```

---

## Task 3: Implement `extract_why_for_topic` (loop over all painpoints)

**Files:**
- Modify: `src/reddit_research/research/why.py` (add new function)
- Test: `tests/test_why.py` (extend)

- [ ] **Step 1: Add failing test**

Append to `tests/test_why.py`:

```python
def test_extract_why_for_topic_iterates_painpoints(
    monkeypatch: pytest.MonkeyPatch, tmp_path,
) -> None:
    """Per-topic loop: read painpoint nodes from DB, fetch their evidence
    posts, call extract_why_for_painpoint per node, return list."""
    monkeypatch.setenv("REDDIT_MYIND_DATA_DIR", str(tmp_path))
    from reddit_research.core import db as db_mod
    db_mod.get_db.cache_clear()  # type: ignore[attr-defined]
    db = db_mod.get_db()

    # Seed: 1 topic, 2 painpoints, 2 posts, evidence edges
    from reddit_research.graph.schema import ensure_graph_schema, make_node_id
    ensure_graph_schema()
    topic = "focus"
    pp1 = make_node_id(topic, "painpoint", "cant-focus")
    pp2 = make_node_id(topic, "painpoint", "too-many-tabs")
    post1 = make_node_id(topic, "post", "p1")
    post2 = make_node_id(topic, "post", "p2")
    db["graph_nodes"].insert_all([
        {"id": pp1, "topic": topic, "kind": "painpoint", "label": "Can't focus", "metadata_json": "{}"},
        {"id": pp2, "topic": topic, "kind": "painpoint", "label": "Too many tabs", "metadata_json": "{}"},
        {"id": post1, "topic": topic, "kind": "post", "label": "p1", "metadata_json": "{}"},
        {"id": post2, "topic": topic, "kind": "post", "label": "p2", "metadata_json": "{}"},
    ], pk="id")
    db["graph_edges"].insert_all([
        {"src": pp1, "dst": post1, "kind": "evidenced_by", "topic": topic, "weight": 1.0, "metadata_json": "{}"},
        {"src": pp2, "dst": post2, "kind": "evidenced_by", "topic": topic, "weight": 1.0, "metadata_json": "{}"},
    ], pk=("src", "dst", "kind"))
    # Seed posts table so evidence lookup finds them
    db["posts"].insert_all([
        {"id": "p1", "sub": "x", "author": "a", "title": "post 1 title", "selftext": "body 1",
         "url": "", "score": 0, "upvote_ratio": None, "num_comments": 0, "created_utc": 0,
         "is_self": 1, "over_18": 0, "flair": None, "permalink": "", "fetched_at": ""},
        {"id": "p2", "sub": "x", "author": "a", "title": "post 2 title", "selftext": "body 2",
         "url": "", "score": 0, "upvote_ratio": None, "num_comments": 0, "created_utc": 0,
         "is_self": 1, "over_18": 0, "flair": None, "permalink": "", "fetched_at": ""},
    ], pk="id", alter=True)

    fake = FakeProvider({"emotions": ["fear"], "jtbd": {"struggling_moment": "x", "anxiety": "y", "desired_outcome": "z"}})
    monkeypatch.setattr(why_mod, "get_provider", lambda _name=None: fake)

    results = why_mod.extract_why_for_topic(topic=topic, provider="fake")
    assert len(results) == 2
    assert {r["painpoint_id"] for r in results} == {pp1, pp2}
    assert all(r["why"]["emotions"] == ["fear"] for r in results)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_why.py::test_extract_why_for_topic_iterates_painpoints -v`
Expected: FAIL with `AttributeError: module ... has no attribute 'extract_why_for_topic'`.

- [ ] **Step 3: Implement `extract_why_for_topic`**

Append to `src/reddit_research/research/why.py`:

```python
def _evidence_posts_for(db, topic: str, painpoint_id: str) -> list[dict[str, Any]]:
    """Return up to 5 evidence posts for one painpoint by walking
    `evidenced_by` edges from painpoint -> post and joining `posts`."""
    rows = list(db.query(
        """
        SELECT p.id, p.title, p.selftext
        FROM graph_edges e
        JOIN graph_nodes n ON n.id = e.dst AND n.kind = 'post'
        JOIN posts p ON p.id = substr(n.id, instr(n.id, '::post::') + 8)
        WHERE e.src = :src AND e.kind = 'evidenced_by'
        LIMIT 5
        """,
        {"src": painpoint_id},
    ))
    return rows


def extract_why_for_topic(
    topic: str,
    provider: str | None = None,
) -> list[dict[str, Any]]:
    """Extract why-data for every painpoint in a topic.

    Returns: [{painpoint_id, painpoint_label, why}, ...]
    Painpoints with no evidence are skipped (why = {_skipped: True}).
    """
    from ..core.db import get_db
    db = get_db()
    pps = list(db.query(
        "SELECT id, label FROM graph_nodes WHERE topic = :t AND kind = 'painpoint'",
        {"t": topic},
    ))
    out = []
    for pp in pps:
        evidence = _evidence_posts_for(db, topic, pp["id"])
        why = extract_why_for_painpoint(
            painpoint_label=pp["label"],
            evidence_posts=evidence,
            provider=provider,
        )
        out.append({"painpoint_id": pp["id"], "painpoint_label": pp["label"], "why": why})
    return out
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/pytest tests/test_why.py -v`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/reddit_research/research/why.py tests/test_why.py
git commit -m "feat(research-loop): extract_why_for_topic loops over all painpoints"
```

---

## Task 4: Implement `fetch_science_for_painpoint`

**Files:**
- Create: `src/reddit_research/research/science.py`
- Test: `tests/test_science.py`

- [ ] **Step 1: Write failing test**

Create `tests/test_science.py`:

```python
"""Unit tests for research.science — paper fetching per painpoint."""
from __future__ import annotations

import pytest

from reddit_research.research import science as sci_mod


def _fixture_paper(pid: str, title: str, source: str = "pubmed") -> dict:
    return {
        "id": f"{source}_{pid}",
        "source_type": source,
        "title": title,
        "selftext": f"abstract for {title}",
        "author": "Smith et al.",
        "score": 10,
        "url": f"https://example.com/{pid}",
        "created_utc": 1700000000.0,
        "sub": source,
    }


def test_fetch_science_dedupes_by_title(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(sci_mod, "fetch_pubmed", lambda q, limit=10: [
        _fixture_paper("1", "Implementation intentions improve focus"),
        _fixture_paper("2", "Pomodoro effects on attention"),
    ])
    monkeypatch.setattr(sci_mod, "fetch_scholar", lambda q, limit=10: [
        # Same title as pubmed result — should be deduped
        _fixture_paper("99", "Implementation intentions improve focus", source="scholar"),
        _fixture_paper("3", "Mindfulness training and focus", source="scholar"),
    ])
    monkeypatch.setattr(sci_mod, "fetch_openalex", lambda q, limit=10: [])

    papers = sci_mod.fetch_science_for_painpoint(
        painpoint_label="can't focus more than 10 minutes",
        jtbd_desired_outcome="two-hour focused block",
        limit=5,
    )

    titles = [p["title"] for p in papers]
    assert "Implementation intentions improve focus" in titles
    assert "Pomodoro effects on attention" in titles
    assert "Mindfulness training and focus" in titles
    assert len(papers) == 3  # dedupe removed the duplicate
    # Each paper has a normalized tier
    for p in papers:
        assert p["tier"] in ("anecdote", "expert", "peer-reviewed", "meta-analysis")


def test_fetch_science_handles_fetcher_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(q, limit=10):
        raise RuntimeError("network down")
    monkeypatch.setattr(sci_mod, "fetch_pubmed", boom)
    monkeypatch.setattr(sci_mod, "fetch_scholar", lambda q, limit=10: [_fixture_paper("1", "ok paper")])
    monkeypatch.setattr(sci_mod, "fetch_openalex", lambda q, limit=10: [])

    papers = sci_mod.fetch_science_for_painpoint(
        painpoint_label="x",
        jtbd_desired_outcome="y",
        limit=5,
    )

    assert len(papers) == 1
    assert papers[0]["title"] == "ok paper"


def test_fetch_science_empty_query_returns_empty() -> None:
    papers = sci_mod.fetch_science_for_painpoint(
        painpoint_label="",
        jtbd_desired_outcome="",
        limit=5,
    )
    assert papers == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_science.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'reddit_research.research.science'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/reddit_research/research/science.py`:

```python
"""Paper fetching per painpoint.

For each painpoint we call PubMed + Semantic Scholar + OpenAlex with a
query built from `painpoint_label + jtbd.desired_outcome`. Results are
deduped by normalized title. Each paper is annotated with a coarse
evidence tier (peer-reviewed for journal sources, anecdote otherwise).

No LLM here — this is pure fetch + dedupe.
"""
from __future__ import annotations

import re
from typing import Any

from ..sources.openalex import fetch_openalex
from ..sources.pubmed import fetch_pubmed
from ..sources.scholar import fetch_scholar


def _normalize_title(t: str) -> str:
    return re.sub(r"\W+", "", (t or "").lower())


def _tier_for(source_type: str) -> str:
    # MVP: coarse tiering. Anything from a literature DB is peer-reviewed.
    # Replication-status and meta-analysis detection is post-MVP.
    if source_type in ("pubmed", "scholar", "openalex"):
        return "peer-reviewed"
    return "anecdote"


def _build_query(painpoint_label: str, jtbd_desired_outcome: str) -> str:
    parts = [s.strip() for s in (painpoint_label, jtbd_desired_outcome) if s and s.strip()]
    return " ".join(parts).strip()


def _safe_fetch(fn, query: str, limit: int) -> list[dict]:
    try:
        return fn(query, limit=limit) or []
    except Exception:  # noqa: BLE001 — never let one source kill the loop
        return []


def fetch_science_for_painpoint(
    painpoint_label: str,
    jtbd_desired_outcome: str,
    limit: int = 5,
) -> list[dict[str, Any]]:
    """Return up to `limit` papers, deduped by title, tier-tagged."""
    query = _build_query(painpoint_label, jtbd_desired_outcome)
    if not query:
        return []

    raw: list[dict] = []
    raw += _safe_fetch(fetch_pubmed, query, limit=limit * 2)
    raw += _safe_fetch(fetch_scholar, query, limit=limit * 2)
    raw += _safe_fetch(fetch_openalex, query, limit=limit * 2)

    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for p in raw:
        key = _normalize_title(p.get("title") or "")
        if not key or key in seen:
            continue
        seen.add(key)
        p_copy = dict(p)
        p_copy["tier"] = _tier_for(p.get("source_type") or p.get("sub") or "")
        out.append(p_copy)
        if len(out) >= limit:
            break
    return out
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/pytest tests/test_science.py -v`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/reddit_research/research/science.py tests/test_science.py
git commit -m "feat(research-loop): fetch_science_for_painpoint (PubMed+Scholar+OpenAlex)"
```

---

## Task 5: Add `solutions.yaml` prompt

**Files:**
- Create: `prompts/solutions.yaml`

- [ ] **Step 1: Create the prompt file**

```yaml
name: solutions
description: Synthesize 1-3 evidence-backed interventions for a single painpoint.

system: |
  You are a behavior-change researcher. Given ONE painpoint, its emotion +
  JTBD context, and 3-5 relevant scientific paper abstracts, propose 1-3
  concrete interventions. Each intervention MUST be:
    - Actionable (an imperative the user can do, not a vague principle)
    - Grounded in at least one of the provided papers (cite paper IDs)
    - Tagged with a confidence_tier reflecting the strongest supporting paper:
        meta-analysis > peer-reviewed > expert > anecdote
    - Tagged with effort: low | med | high

  Also describe the underlying mechanism (1 sentence: WHY this works,
  ideally naming the theoretical basis like "implementation intentions"
  or "self-monitoring").

  If the papers don't support any concrete intervention, return an empty
  list. Do not invent evidence.

  Reply with JSON only, no markdown fences. Schema:
  {
    "mechanism": "...",
    "interventions": [
      {
        "label": "Imperative sentence",
        "confidence_tier": "peer-reviewed",
        "effort": "low",
        "supporting_paper_ids": ["pubmed_12345", "scholar_xyz"],
        "rationale": "1-2 sentences citing the papers"
      }
    ]
  }

user_template: |
  Painpoint: {painpoint_label}

  Why people feel this way:
  {why}

  Relevant papers:

  {papers}
```

- [ ] **Step 2: Verify the prompt loads**

Run: `.venv/bin/python -c "from reddit_research.research.prompts import load_extractor; print(load_extractor('solutions')['system'][:80])"`
Expected: prints the first 80 chars without error.

- [ ] **Step 3: Commit**

```bash
git add prompts/solutions.yaml
git commit -m "feat(research-loop): add solutions.yaml prompt for intervention synthesis"
```

---

## Task 6: Implement `synthesize_solutions_for_painpoint`

**Files:**
- Create: `src/reddit_research/research/solutions.py`
- Test: `tests/test_solutions.py`

- [ ] **Step 1: Write failing test**

Create `tests/test_solutions.py`:

```python
"""Unit tests for research.solutions — intervention synthesis."""
from __future__ import annotations

import json

import pytest

from reddit_research.research import solutions as sol_mod


class FakeProvider:
    def __init__(self, payload: dict) -> None:
        self.payload = payload
        self.last_prompt: str | None = None

    def complete(self, prompt: str, system: str, **kwargs) -> str:
        self.last_prompt = prompt
        return json.dumps(self.payload)


def test_synthesize_solutions_returns_mechanism_and_interventions(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake = FakeProvider({
        "mechanism": "implementation intentions reduce attention switching cost",
        "interventions": [
            {
                "label": "Write the next 3 actions on paper before opening laptop",
                "confidence_tier": "peer-reviewed",
                "effort": "low",
                "supporting_paper_ids": ["pubmed_111"],
                "rationale": "Gollwitzer 1999 found if-then plans increase follow-through.",
            },
        ],
    })
    monkeypatch.setattr(sol_mod, "get_provider", lambda _name=None: fake)

    result = sol_mod.synthesize_solutions_for_painpoint(
        painpoint_label="can't focus",
        why={"emotions": ["fear"], "jtbd": {"struggling_moment": "x", "anxiety": "y", "desired_outcome": "z"}},
        papers=[
            {"id": "pubmed_111", "title": "Implementation intentions", "selftext": "abstract...", "tier": "peer-reviewed"},
        ],
        provider="fake",
    )

    assert result["mechanism"].startswith("implementation intentions")
    assert len(result["interventions"]) == 1
    assert result["interventions"][0]["confidence_tier"] == "peer-reviewed"
    assert "pubmed_111" in result["interventions"][0]["supporting_paper_ids"]
    assert "can't focus" in fake.last_prompt
    assert "Implementation intentions" in fake.last_prompt


def test_synthesize_solutions_no_papers_returns_skip() -> None:
    result = sol_mod.synthesize_solutions_for_painpoint(
        painpoint_label="x",
        why={"emotions": [], "jtbd": {}},
        papers=[],
        provider="fake",
    )
    assert result == {"_skipped": True, "reason": "no_papers"}


def test_synthesize_solutions_handles_bad_json(monkeypatch: pytest.MonkeyPatch) -> None:
    class BadProvider:
        def complete(self, prompt: str, system: str, **kwargs) -> str:
            return "definitely not json"
    monkeypatch.setattr(sol_mod, "get_provider", lambda _name=None: BadProvider())

    result = sol_mod.synthesize_solutions_for_painpoint(
        painpoint_label="x",
        why={"emotions": [], "jtbd": {}},
        papers=[{"id": "pubmed_1", "title": "t", "selftext": "abs", "tier": "peer-reviewed"}],
        provider="fake",
    )
    assert result.get("_parse_error") is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_solutions.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'reddit_research.research.solutions'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/reddit_research/research/solutions.py`:

```python
"""Intervention synthesis grounded in fetched papers.

One LLM call per painpoint. Input: painpoint label + why-data + top N
papers. Output: mechanism (1 sentence) + list of 1-3 interventions, each
with a confidence tier and supporting paper IDs.
"""
from __future__ import annotations

import json
from typing import Any

from ..analyze.providers.base import get_provider
from .prompts import load_extractor


def _format_why(why: dict[str, Any]) -> str:
    if not why or why.get("_skipped") or why.get("_parse_error"):
        return "(no why-data available)"
    emotions = ", ".join(why.get("emotions") or []) or "(none)"
    jtbd = why.get("jtbd") or {}
    return (
        f"Emotions: {emotions}\n"
        f"Struggling moment: {jtbd.get('struggling_moment', '?')}\n"
        f"Anxiety: {jtbd.get('anxiety', '?')}\n"
        f"Desired outcome: {jtbd.get('desired_outcome', '?')}"
    )


def _format_papers(papers: list[dict[str, Any]]) -> str:
    parts = []
    for p in papers[:5]:
        abstract = (p.get("selftext") or p.get("abstract") or "")[:600]
        parts.append(
            f"[{p.get('id', '?')}] ({p.get('tier', 'unknown')}) {p.get('title', '')}\n{abstract}"
        )
    return "\n\n".join(parts)


def _parse_json(raw: str) -> dict[str, Any]:
    cleaned = raw.strip()
    for fence in ("```json", "```"):
        if cleaned.startswith(fence):
            cleaned = cleaned[len(fence):].lstrip()
    if cleaned.endswith("```"):
        cleaned = cleaned[:-3].rstrip()
    try:
        parsed = json.loads(cleaned)
        if isinstance(parsed, dict):
            return parsed
        return {"_parse_error": True, "_raw": raw}
    except json.JSONDecodeError:
        return {"_parse_error": True, "_raw": raw}


def synthesize_solutions_for_painpoint(
    painpoint_label: str,
    why: dict[str, Any],
    papers: list[dict[str, Any]],
    provider: str | None = None,
) -> dict[str, Any]:
    """Returns either {mechanism, interventions} or {_skipped|_parse_error}."""
    if not papers:
        return {"_skipped": True, "reason": "no_papers"}

    ext = load_extractor("solutions")
    user = ext["user_template"].format(
        painpoint_label=painpoint_label,
        why=_format_why(why),
        papers=_format_papers(papers),
    )
    raw = get_provider(provider).complete(
        prompt=user, system=ext["system"], max_tokens=1200, temperature=0.3
    )
    return _parse_json(raw)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/pytest tests/test_solutions.py -v`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/reddit_research/research/solutions.py tests/test_solutions.py
git commit -m "feat(research-loop): synthesize_solutions_for_painpoint"
```

---

## Task 7: Implement persistence — graph upserts for the 3 new node kinds

**Files:**
- Create: `src/reddit_research/research/persist_solutions.py`
- Test: `tests/test_solutions_persist.py`

- [ ] **Step 1: Write failing test**

Create `tests/test_solutions_persist.py`:

```python
"""Unit tests for research.persist_solutions — graph upserts for the
new node kinds (mechanism, intervention, evidence_paper) and edges
(explained_by, addressed_by, supported_by, has_evidence)."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from reddit_research.graph.schema import ensure_graph_schema, make_node_id


@pytest.fixture
def db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("REDDIT_MYIND_DATA_DIR", str(tmp_path))
    from reddit_research.core import db as db_mod
    db_mod.get_db.cache_clear()  # type: ignore[attr-defined]
    db = db_mod.get_db()
    ensure_graph_schema()
    # Seed a topic + 1 painpoint
    topic = "focus"
    pp_id = make_node_id(topic, "painpoint", "cant-focus")
    db["graph_nodes"].insert(
        {"id": pp_id, "topic": topic, "kind": "painpoint", "label": "Can't focus", "metadata_json": "{}"},
        pk="id",
    )
    return db


def test_persist_why_merges_into_painpoint_metadata(db) -> None:
    from reddit_research.research.persist_solutions import persist_why_for_painpoint

    persist_why_for_painpoint(
        topic="focus",
        painpoint_id=make_node_id("focus", "painpoint", "cant-focus"),
        why={"emotions": ["fear"], "jtbd": {"struggling_moment": "x", "anxiety": "y", "desired_outcome": "z"}},
    )

    row = db["graph_nodes"].get(make_node_id("focus", "painpoint", "cant-focus"))
    meta = json.loads(row["metadata_json"])
    assert meta["why"]["emotions"] == ["fear"]
    assert meta["why"]["jtbd"]["desired_outcome"] == "z"


def test_persist_papers_creates_evidence_nodes_and_edges(db) -> None:
    from reddit_research.research.persist_solutions import persist_papers_for_painpoint

    pp = make_node_id("focus", "painpoint", "cant-focus")
    n = persist_papers_for_painpoint(
        topic="focus",
        painpoint_id=pp,
        papers=[
            {"id": "pubmed_111", "title": "Paper A", "selftext": "abs A", "url": "http://a", "tier": "peer-reviewed",
             "author": "Smith", "created_utc": 1700000000.0, "source_type": "pubmed"},
            {"id": "scholar_222", "title": "Paper B", "selftext": "abs B", "url": "http://b", "tier": "peer-reviewed",
             "author": "Jones", "created_utc": 1700000000.0, "source_type": "scholar"},
        ],
    )

    assert n == 2
    papers_in_db = list(db["graph_nodes"].rows_where("kind = 'evidence_paper' AND topic = 'focus'"))
    assert len(papers_in_db) == 2
    edges = list(db["graph_edges"].rows_where("kind = 'has_evidence' AND src = ?", [pp]))
    assert len(edges) == 2


def test_persist_solutions_creates_mechanism_intervention_chain(db) -> None:
    from reddit_research.research.persist_solutions import (
        persist_papers_for_painpoint,
        persist_solutions_for_painpoint,
    )

    pp = make_node_id("focus", "painpoint", "cant-focus")
    persist_papers_for_painpoint(
        topic="focus",
        painpoint_id=pp,
        papers=[{"id": "pubmed_111", "title": "Paper A", "selftext": "abs", "url": "", "tier": "peer-reviewed",
                 "author": "Smith", "created_utc": 1700000000.0, "source_type": "pubmed"}],
    )

    summary = persist_solutions_for_painpoint(
        topic="focus",
        painpoint_id=pp,
        solution={
            "mechanism": "implementation intentions reduce switching cost",
            "interventions": [
                {
                    "label": "Write next 3 actions on paper",
                    "confidence_tier": "peer-reviewed",
                    "effort": "low",
                    "supporting_paper_ids": ["pubmed_111"],
                    "rationale": "Gollwitzer 1999",
                },
            ],
        },
    )

    assert summary["mechanisms_added"] == 1
    assert summary["interventions_added"] == 1
    assert summary["supporting_edges"] == 1

    # Mechanism node exists, edge painpoint --explained_by--> mechanism
    mechs = list(db["graph_nodes"].rows_where("kind = 'mechanism' AND topic = 'focus'"))
    assert len(mechs) == 1
    expl = list(db["graph_edges"].rows_where("kind = 'explained_by' AND src = ?", [pp]))
    assert len(expl) == 1
    # Intervention node exists, edge mechanism --addressed_by--> intervention
    intvs = list(db["graph_nodes"].rows_where("kind = 'intervention' AND topic = 'focus'"))
    assert len(intvs) == 1
    addr = list(db["graph_edges"].rows_where("kind = 'addressed_by'"))
    assert len(addr) == 1
    # Edge intervention --supported_by--> evidence_paper
    sup = list(db["graph_edges"].rows_where("kind = 'supported_by'"))
    assert len(sup) == 1


def test_persist_solutions_skipped_input_no_op(db) -> None:
    from reddit_research.research.persist_solutions import persist_solutions_for_painpoint

    pp = make_node_id("focus", "painpoint", "cant-focus")
    summary = persist_solutions_for_painpoint(
        topic="focus",
        painpoint_id=pp,
        solution={"_skipped": True, "reason": "no_papers"},
    )
    assert summary == {"mechanisms_added": 0, "interventions_added": 0, "supporting_edges": 0}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_solutions_persist.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'reddit_research.research.persist_solutions'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/reddit_research/research/persist_solutions.py`:

```python
"""Persist why-data + papers + interventions to the graph.

Schema is loose (graph_nodes.kind is free-text), so we just upsert with
the new kinds: 'mechanism', 'intervention', 'evidence_paper'. Edges:
  painpoint --explained_by--> mechanism
  mechanism --addressed_by--> intervention
  intervention --supported_by--> evidence_paper
  painpoint --has_evidence--> evidence_paper
"""
from __future__ import annotations

import json
import re
from typing import Any

from ..core.db import get_db
from ..graph.build import _upsert_edge, _upsert_node
from ..graph.schema import make_node_id


def _slug(s: str) -> str:
    out = re.sub(r"[^a-z0-9]+", "-", (s or "").lower()).strip("-")
    return out[:60] or "unnamed"


def persist_why_for_painpoint(
    topic: str,
    painpoint_id: str,
    why: dict[str, Any],
) -> None:
    """Merge `why` into the painpoint node's metadata_json under the 'why' key.

    Skips if `why` indicates parse error or no evidence — we don't want
    to overwrite a previous successful run with a failure.
    """
    if why.get("_skipped") or why.get("_parse_error"):
        return
    db = get_db()
    row = db["graph_nodes"].get(painpoint_id)
    if not row:
        return
    meta = {}
    try:
        meta = json.loads(row.get("metadata_json") or "{}") or {}
    except json.JSONDecodeError:
        meta = {}
    meta["why"] = why
    db["graph_nodes"].update(painpoint_id, {"metadata_json": json.dumps(meta)})


def persist_papers_for_painpoint(
    topic: str,
    painpoint_id: str,
    papers: list[dict[str, Any]],
) -> int:
    """Upsert evidence_paper nodes and link painpoint --has_evidence--> paper.
    Returns count of papers persisted."""
    if not papers:
        return 0
    db = get_db()
    n = 0
    for p in papers:
        pid = p.get("id")
        if not pid:
            continue
        node_id = _upsert_node(
            db, topic, "evidence_paper", _slug(pid), p.get("title") or pid,
            metadata={
                "source": p.get("source_type") or p.get("sub"),
                "tier": p.get("tier"),
                "url": p.get("url"),
                "author": p.get("author"),
                "year_ts": p.get("created_utc"),
                "abstract_excerpt": (p.get("selftext") or "")[:500],
                "external_id": pid,
            },
        )
        _upsert_edge(db, topic, painpoint_id, node_id, "has_evidence")
        n += 1
    return n


def persist_solutions_for_painpoint(
    topic: str,
    painpoint_id: str,
    solution: dict[str, Any],
) -> dict[str, int]:
    """Persist mechanism + interventions. Returns counts."""
    summary = {"mechanisms_added": 0, "interventions_added": 0, "supporting_edges": 0}
    if not solution or solution.get("_skipped") or solution.get("_parse_error"):
        return summary

    mechanism_text = (solution.get("mechanism") or "").strip()
    interventions = solution.get("interventions") or []
    if not mechanism_text or not interventions:
        return summary

    db = get_db()
    # The mechanism slug is keyed by painpoint to keep it scoped; same painpoint
    # rerun replaces the same mechanism node rather than spawning duplicates.
    mech_id = _upsert_node(
        db, topic, "mechanism",
        _slug(f"{painpoint_id}-mech"),
        mechanism_text,
        metadata={"painpoint_id": painpoint_id},
    )
    _upsert_edge(db, topic, painpoint_id, mech_id, "explained_by")
    summary["mechanisms_added"] = 1

    for iv in interventions:
        label = (iv.get("label") or "").strip()
        if not label:
            continue
        iv_id = _upsert_node(
            db, topic, "intervention", _slug(f"{painpoint_id}-{label}"), label,
            metadata={
                "confidence_tier": iv.get("confidence_tier"),
                "effort": iv.get("effort"),
                "rationale": iv.get("rationale"),
                "painpoint_id": painpoint_id,
            },
        )
        _upsert_edge(db, topic, mech_id, iv_id, "addressed_by")
        summary["interventions_added"] += 1
        for paper_ext_id in (iv.get("supporting_paper_ids") or []):
            paper_node_id = make_node_id(topic, "evidence_paper", _slug(paper_ext_id))
            if db["graph_nodes"].count_where("id = ?", [paper_node_id]) > 0:
                _upsert_edge(db, topic, iv_id, paper_node_id, "supported_by")
                summary["supporting_edges"] += 1
    return summary
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/pytest tests/test_solutions_persist.py -v`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/reddit_research/research/persist_solutions.py tests/test_solutions_persist.py
git commit -m "feat(research-loop): persist why+papers+solutions to graph"
```

---

## Task 8: Implement `solutions_pipeline` orchestrator

**Files:**
- Modify: `src/reddit_research/research/solutions.py` (add orchestrator at end)
- Test: `tests/test_solutions_pipeline.py`

- [ ] **Step 1: Write failing integration test**

Create `tests/test_solutions_pipeline.py`:

```python
"""End-to-end test for solutions_pipeline: mocks LLM + paper fetchers,
asserts the full graph chain (painpoint -> mechanism -> intervention ->
evidence_paper) is built for every painpoint."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from reddit_research.graph.schema import ensure_graph_schema, make_node_id


@pytest.fixture
def seeded_db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("REDDIT_MYIND_DATA_DIR", str(tmp_path))
    from reddit_research.core import db as db_mod
    db_mod.get_db.cache_clear()  # type: ignore[attr-defined]
    db = db_mod.get_db()
    ensure_graph_schema()
    topic = "focus"
    pp = make_node_id(topic, "painpoint", "cant-focus")
    post = make_node_id(topic, "post", "p1")
    db["graph_nodes"].insert_all([
        {"id": pp, "topic": topic, "kind": "painpoint", "label": "Can't focus", "metadata_json": "{}"},
        {"id": post, "topic": topic, "kind": "post", "label": "p1", "metadata_json": "{}"},
    ], pk="id")
    db["graph_edges"].insert(
        {"src": pp, "dst": post, "kind": "evidenced_by", "topic": topic, "weight": 1.0, "metadata_json": "{}"},
        pk=("src", "dst", "kind"),
    )
    db["posts"].insert({
        "id": "p1", "sub": "x", "author": "a", "title": "Focus is hard", "selftext": "I keep getting distracted",
        "url": "", "score": 0, "upvote_ratio": None, "num_comments": 0, "created_utc": 0,
        "is_self": 1, "over_18": 0, "flair": None, "permalink": "", "fetched_at": "",
    }, pk="id", alter=True)
    return {"db": db, "topic": topic, "painpoint_id": pp}


def test_solutions_pipeline_builds_full_chain(
    monkeypatch: pytest.MonkeyPatch, seeded_db: dict,
) -> None:
    from reddit_research.research import science as sci_mod
    from reddit_research.research import solutions as sol_mod
    from reddit_research.research import why as why_mod

    # Mock LLM provider to return canned why + solution payloads in turn.
    class CannedProvider:
        def __init__(self):
            self.calls = 0
            self.responses = [
                # First call = why
                json.dumps({"emotions": ["fear"], "jtbd": {
                    "struggling_moment": "starting hard tasks", "anxiety": "won't finish", "desired_outcome": "deep work"}}),
                # Second call = solutions
                json.dumps({
                    "mechanism": "implementation intentions reduce switching cost",
                    "interventions": [{
                        "label": "Write next 3 actions on paper",
                        "confidence_tier": "peer-reviewed",
                        "effort": "low",
                        "supporting_paper_ids": ["pubmed_111"],
                        "rationale": "Gollwitzer 1999",
                    }],
                }),
            ]
        def complete(self, prompt, system, **kwargs):
            r = self.responses[self.calls]
            self.calls += 1
            return r

    canned = CannedProvider()
    monkeypatch.setattr(why_mod, "get_provider", lambda _name=None: canned)
    monkeypatch.setattr(sol_mod, "get_provider", lambda _name=None: canned)

    # Mock paper fetchers
    monkeypatch.setattr(sci_mod, "fetch_pubmed", lambda q, limit=10: [
        {"id": "pubmed_111", "source_type": "pubmed", "title": "Implementation intentions",
         "selftext": "abstract...", "author": "Gollwitzer", "score": 100, "url": "http://x",
         "created_utc": 1500000000.0, "sub": "pubmed"},
    ])
    monkeypatch.setattr(sci_mod, "fetch_scholar", lambda q, limit=10: [])
    monkeypatch.setattr(sci_mod, "fetch_openalex", lambda q, limit=10: [])

    summary = sol_mod.solutions_pipeline(topic=seeded_db["topic"], provider="fake")

    assert summary["painpoints_processed"] == 1
    assert summary["why_extracted"] == 1
    assert summary["papers_persisted"] == 1
    assert summary["interventions_added"] == 1

    db = seeded_db["db"]
    pp = seeded_db["painpoint_id"]
    # Verify the full chain
    assert db["graph_nodes"].count_where("kind = 'evidence_paper'") == 1
    assert db["graph_nodes"].count_where("kind = 'mechanism'") == 1
    assert db["graph_nodes"].count_where("kind = 'intervention'") == 1
    assert db["graph_edges"].count_where("kind = 'has_evidence' AND src = ?", [pp]) == 1
    assert db["graph_edges"].count_where("kind = 'explained_by' AND src = ?", [pp]) == 1
    assert db["graph_edges"].count_where("kind = 'addressed_by'") == 1
    assert db["graph_edges"].count_where("kind = 'supported_by'") == 1
    # Why metadata merged into painpoint
    pp_row = db["graph_nodes"].get(pp)
    meta = json.loads(pp_row["metadata_json"])
    assert meta["why"]["emotions"] == ["fear"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_solutions_pipeline.py -v`
Expected: FAIL with `AttributeError: module ... has no attribute 'solutions_pipeline'`.

- [ ] **Step 3: Add the orchestrator**

Append to `src/reddit_research/research/solutions.py`:

```python
def solutions_pipeline(
    topic: str,
    provider: str | None = None,
    papers_per_painpoint: int = 5,
) -> dict[str, Any]:
    """Run the full Problem -> Why -> Science -> Solution loop for a topic.

    For every painpoint node in the topic:
      1. extract_why_for_painpoint
      2. persist why metadata
      3. fetch_science_for_painpoint
      4. persist evidence_paper nodes + has_evidence edges
      5. synthesize_solutions_for_painpoint
      6. persist mechanism + intervention + supported_by edges

    Returns counts. Idempotent: re-running on the same topic upserts
    rather than duplicates (slugs are stable).
    """
    from ..core.db import get_db
    from .persist_solutions import (
        persist_papers_for_painpoint,
        persist_solutions_for_painpoint,
        persist_why_for_painpoint,
    )
    from .science import fetch_science_for_painpoint
    from .why import extract_why_for_painpoint, _evidence_posts_for

    db = get_db()
    pps = list(db.query(
        "SELECT id, label FROM graph_nodes WHERE topic = :t AND kind = 'painpoint'",
        {"t": topic},
    ))

    summary = {
        "topic": topic,
        "painpoints_processed": 0,
        "why_extracted": 0,
        "papers_persisted": 0,
        "interventions_added": 0,
    }

    for pp in pps:
        summary["painpoints_processed"] += 1
        evidence_posts = _evidence_posts_for(db, topic, pp["id"])
        why = extract_why_for_painpoint(
            painpoint_label=pp["label"],
            evidence_posts=evidence_posts,
            provider=provider,
        )
        if not why.get("_skipped") and not why.get("_parse_error"):
            summary["why_extracted"] += 1
        persist_why_for_painpoint(topic=topic, painpoint_id=pp["id"], why=why)

        jtbd_outcome = ((why.get("jtbd") or {}).get("desired_outcome") or "")
        papers = fetch_science_for_painpoint(
            painpoint_label=pp["label"],
            jtbd_desired_outcome=jtbd_outcome,
            limit=papers_per_painpoint,
        )
        n_papers = persist_papers_for_painpoint(
            topic=topic, painpoint_id=pp["id"], papers=papers
        )
        summary["papers_persisted"] += n_papers

        solution = synthesize_solutions_for_painpoint(
            painpoint_label=pp["label"],
            why=why,
            papers=papers,
            provider=provider,
        )
        per_pp = persist_solutions_for_painpoint(
            topic=topic, painpoint_id=pp["id"], solution=solution
        )
        summary["interventions_added"] += per_pp["interventions_added"]

    return summary
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/pytest tests/test_solutions_pipeline.py tests/test_solutions.py -v`
Expected: 4 passed (1 new + 3 from Task 6).

- [ ] **Step 5: Commit**

```bash
git add src/reddit_research/research/solutions.py tests/test_solutions_pipeline.py
git commit -m "feat(research-loop): solutions_pipeline orchestrator"
```

---

## Task 9: Re-export from `research/__init__.py` and add CLI subcommand

**Files:**
- Modify: `src/reddit_research/research/__init__.py`
- Modify: `src/reddit_research/cli/main.py` (after line 812 — sits among `@graph_app.command` group, but this lives under `research_app` like `gaps`)

- [ ] **Step 1: Add imports to research/__init__.py**

Read `src/reddit_research/research/__init__.py` first (it re-exports the existing public API). Add these lines at the bottom of the existing imports (do not remove anything):

```python
from .solutions import solutions_pipeline, synthesize_solutions_for_painpoint
from .why import extract_why_for_painpoint, extract_why_for_topic
from .science import fetch_science_for_painpoint
```

- [ ] **Step 2: Verify the re-exports load**

Run: `.venv/bin/python -c "from reddit_research.research import solutions_pipeline; print(solutions_pipeline.__doc__[:60])"`
Expected: prints the docstring start.

- [ ] **Step 3: Add the CLI subcommand**

In `src/reddit_research/cli/main.py`, find the existing `@research_app.command("gaps")` block and add this new command immediately after it (preserve all existing decorators and code around it):

```python
@research_app.command("solutions")
def cmd_research_solutions(
    topic: str = typer.Option(..., "--topic", "-t", help="Topic name (must already have painpoints in the graph)."),
    provider: str | None = typer.Option(None, "--provider", help="Override LLM provider (anthropic/openai/ollama)."),
    papers_per_painpoint: int = typer.Option(5, "--papers", help="Max papers per painpoint."),
    as_json: bool = typer.Option(False, "--json", help="Emit summary as JSON."),
) -> None:
    """Run the Problem -> Why -> Science -> Solution loop for a topic."""
    from ..analyze.providers.base import resolve_provider
    from ..research import solutions_pipeline

    # Resolve provider once so we get a clear error if no LLM configured,
    # rather than failing inside the per-painpoint loop.
    try:
        resolved = resolve_provider(provider)
    except Exception as e:  # noqa: BLE001 — surface the reason cleanly
        out = {"ok": False, "skipped": True, "reason": f"no_llm_provider: {e}"}
        if as_json:
            typer.echo(json.dumps(out))
        else:
            typer.echo(f"Skipped: {out['reason']}")
        raise typer.Exit(0)

    summary = solutions_pipeline(
        topic=topic, provider=resolved, papers_per_painpoint=papers_per_painpoint
    )
    if as_json:
        typer.echo(json.dumps(summary))
    else:
        for k, v in summary.items():
            typer.echo(f"{k}: {v}")
```

Verify `import json` is already at the top of `main.py` (it is — used elsewhere). Do not duplicate the import.

- [ ] **Step 4: Smoke-test the CLI lists the new command**

Run: `.venv/bin/reddit-cli research --help | grep solutions`
Expected: line shows `solutions` with the docstring.

- [ ] **Step 5: Commit**

```bash
git add src/reddit_research/research/__init__.py src/reddit_research/cli/main.py
git commit -m "feat(research-loop): wire 'reddit-cli research solutions --topic X' CLI"
```

---

## Task 10: Tauri command + JS bridge

**Files:**
- Modify: `app-tauri/src-tauri/src/commands.rs` (add new command after `enrich_graph` at line 117)
- Modify: `app-tauri/src-tauri/src/main.rs` (register the new command in the `invoke_handler!` list — find the existing list of commands and append)
- Modify: `app-tauri/src/api.js` (add wrapper after `enrichGraph`)

- [ ] **Step 1: Add the Rust command**

In `app-tauri/src-tauri/src/commands.rs`, immediately after the closing `}` of `enrich_graph` (line ~117), insert:

```rust
/// Run the Problem -> Why -> Science -> Solution pipeline for a topic.
/// Returns a summary JSON or `{ok: false, skipped: true, reason}` if no
/// LLM provider is configured.
#[tauri::command]
pub async fn run_solutions_pipeline(app: AppHandle, topic: String) -> Result<Value, String> {
    run_cli(
        &app,
        vec!["research", "solutions", "--topic", &topic, "--json"],
    )
    .await
    .map_err(err_to_string)
}
```

- [ ] **Step 2: Register the command in main.rs**

Open `app-tauri/src-tauri/src/main.rs`. Find the `tauri::Builder::default()` chain — there is an `.invoke_handler(tauri::generate_handler![...])` call listing every command. Add `commands::run_solutions_pipeline,` to that list (alphabetical with neighbors, after `commands::run_query`).

If unsure of placement, search for `enrich_graph` in main.rs and add the new command on the next line, matching the surrounding indentation.

- [ ] **Step 3: Verify Rust compiles**

Run: `cd app-tauri/src-tauri && cargo check`
Expected: compiles without errors. (If `cargo` is slow, use `cargo check --message-format=short`.)

- [ ] **Step 4: Add the JS wrapper**

In `app-tauri/src/api.js`, find the line:

```javascript
  enrichGraph:     (topic)   => invoke('enrich_graph', { topic }),
```

Immediately after it, add:

```javascript
  runSolutionsPipeline: (topic) => invoke('run_solutions_pipeline', { topic }),
```

- [ ] **Step 5: Commit**

```bash
git add app-tauri/src-tauri/src/commands.rs app-tauri/src-tauri/src/main.rs app-tauri/src/api.js
git commit -m "feat(research-loop): Tauri command run_solutions_pipeline + JS bridge"
```

---

## Task 11: Solutions tab content (`screens/solutions.js`)

**Files:**
- Create: `app-tauri/src/screens/solutions.js`

- [ ] **Step 1: Create the screen module**

Create `app-tauri/src/screens/solutions.js`:

```javascript
// Solutions tab — shows the Problem -> Why -> Science -> Solution loop
// per painpoint. Reads from graph_nodes/graph_edges via api.runQuery.
import { api } from '../api.js';

const $ = (sel, root = document) => root.querySelector(sel);

function escape(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

function tierBadge(tier) {
  const cls = {
    'meta-analysis': 'tier-meta',
    'peer-reviewed': 'tier-peer',
    'expert': 'tier-expert',
    'anecdote': 'tier-anec',
  }[tier] || 'tier-unknown';
  return `<span class="tier-badge ${cls}">${escape(tier || 'unknown')}</span>`;
}

async function fetchSolutionsData(topic) {
  // One painpoint per row: includes why metadata + counts of linked
  // mechanism/intervention/evidence_paper nodes.
  const sql = `
    SELECT
      n.id AS painpoint_id,
      n.label AS painpoint_label,
      n.metadata_json
    FROM graph_nodes n
    WHERE n.topic = :topic AND n.kind = 'painpoint'
    ORDER BY n.label
  `;
  const painpoints = await api.runQuery(sql, topic);
  return painpoints || [];
}

async function fetchInterventionsForPainpoint(topic, painpointId) {
  // mechanism --addressed_by--> intervention; mechanism is keyed off painpoint
  const sql = `
    SELECT iv.id, iv.label, iv.metadata_json
    FROM graph_edges e1
    JOIN graph_nodes m ON m.id = e1.dst AND m.kind = 'mechanism'
    JOIN graph_edges e2 ON e2.src = m.id AND e2.kind = 'addressed_by'
    JOIN graph_nodes iv ON iv.id = e2.dst AND iv.kind = 'intervention'
    WHERE e1.src = :pid AND e1.kind = 'explained_by'
  `;
  return await api.runQuery(sql, topic, { pid: painpointId }) || [];
}

async function fetchPapersForPainpoint(topic, painpointId) {
  const sql = `
    SELECT p.id, p.label, p.metadata_json
    FROM graph_edges e
    JOIN graph_nodes p ON p.id = e.dst AND p.kind = 'evidence_paper'
    WHERE e.src = :pid AND e.kind = 'has_evidence'
  `;
  return await api.runQuery(sql, topic, { pid: painpointId }) || [];
}

function renderEmpty(topic) {
  return `
    <div class="empty-state">
      <p>No solutions yet for <b>${escape(topic)}</b>.</p>
      <p>Run the pipeline to generate science-backed interventions for each painpoint.</p>
      <button class="btn primary" id="btn-run-solutions">▶ Run solutions pipeline</button>
      <div id="solutions-status" class="muted"></div>
    </div>
  `;
}

function renderPainpointCard(pp, interventions, papers) {
  const meta = (() => { try { return JSON.parse(pp.metadata_json || '{}'); } catch { return {}; } })();
  const why = meta.why || {};
  const emotions = (why.emotions || []).map(e => `<span class="chip">${escape(e)}</span>`).join(' ');
  const jtbd = why.jtbd || {};

  const intvHtml = interventions.length === 0
    ? '<p class="muted">No interventions yet.</p>'
    : interventions.map(iv => {
        const m = (() => { try { return JSON.parse(iv.metadata_json || '{}'); } catch { return {}; } })();
        return `
          <li class="intervention">
            <div class="intervention-label">${escape(iv.label)}</div>
            <div class="intervention-meta">
              ${tierBadge(m.confidence_tier)}
              <span class="effort">effort: ${escape(m.effort || '?')}</span>
            </div>
            ${m.rationale ? `<div class="rationale">${escape(m.rationale)}</div>` : ''}
          </li>
        `;
      }).join('');

  const papersHtml = papers.length === 0
    ? '<p class="muted">No papers linked.</p>'
    : `<ul class="papers">${papers.map(p => {
        const m = (() => { try { return JSON.parse(p.metadata_json || '{}'); } catch { return {}; } })();
        const url = m.url || '#';
        return `<li>${tierBadge(m.tier)} <a href="${escape(url)}" target="_blank" rel="noopener">${escape(p.label)}</a></li>`;
      }).join('')}</ul>`;

  return `
    <details class="solutions-card">
      <summary>
        <span class="painpoint-title">${escape(pp.painpoint_label)}</span>
        <span class="emotions">${emotions}</span>
      </summary>
      <div class="card-body">
        <section>
          <h4>Why people feel this way</h4>
          <p><b>Struggling moment:</b> ${escape(jtbd.struggling_moment || '—')}</p>
          <p><b>Anxiety:</b> ${escape(jtbd.anxiety || '—')}</p>
          <p><b>Desired outcome:</b> ${escape(jtbd.desired_outcome || '—')}</p>
        </section>
        <section>
          <h4>What science says (${papers.length})</h4>
          ${papersHtml}
        </section>
        <section>
          <h4>Try this (${interventions.length})</h4>
          <ol class="interventions">${intvHtml}</ol>
        </section>
      </div>
    </details>
  `;
}

export async function loadSolutions(contentEl, topic) {
  contentEl.innerHTML = '<div class="empty-state">loading…</div>';
  const painpoints = await fetchSolutionsData(topic);

  if (!painpoints.length) {
    contentEl.innerHTML = `<div class="empty-state"><p>No painpoints found for <b>${escape(topic)}</b>. Build the gap map first.</p></div>`;
    return;
  }

  // Check whether any solutions exist — if not, show "run pipeline" CTA.
  const anySolutions = await api.runQuery(
    "SELECT count(*) AS c FROM graph_nodes WHERE topic = :topic AND kind = 'intervention'",
    topic,
  );
  const haveSolutions = (anySolutions?.[0]?.c || 0) > 0;

  if (!haveSolutions) {
    contentEl.innerHTML = renderEmpty(topic);
    $('#btn-run-solutions', contentEl)?.addEventListener('click', async () => {
      const status = $('#solutions-status', contentEl);
      status.textContent = 'Running… this may take 1-3 minutes.';
      try {
        const result = await api.runSolutionsPipeline(topic);
        if (result?.skipped) {
          status.textContent = `Skipped: ${result.reason || 'unknown'}. Add an LLM key in Settings.`;
          return;
        }
        // Re-render with the new data
        await loadSolutions(contentEl, topic);
      } catch (e) {
        status.textContent = `Error: ${e?.message || e}`;
      }
    });
    return;
  }

  // Render painpoint cards
  const cards = await Promise.all(painpoints.map(async pp => {
    const [interventions, papers] = await Promise.all([
      fetchInterventionsForPainpoint(topic, pp.painpoint_id),
      fetchPapersForPainpoint(topic, pp.painpoint_id),
    ]);
    return renderPainpointCard(pp, interventions, papers);
  }));

  contentEl.innerHTML = `
    <div class="solutions-tab">
      <div class="solutions-toolbar">
        <button class="btn" id="btn-rerun-solutions">↻ Re-run pipeline</button>
      </div>
      <div class="solutions-list">${cards.join('')}</div>
    </div>
  `;

  $('#btn-rerun-solutions', contentEl)?.addEventListener('click', async () => {
    contentEl.innerHTML = '<div class="empty-state">Re-running…</div>';
    try {
      await api.runSolutionsPipeline(topic);
    } catch (e) {
      console.error(e);
    }
    await loadSolutions(contentEl, topic);
  });
}
```

- [ ] **Step 2: Verify the file is syntactically valid JS**

Run: `node --check app-tauri/src/screens/solutions.js`
Expected: no output (silent success).

- [ ] **Step 3: Commit**

```bash
git add app-tauri/src/screens/solutions.js
git commit -m "feat(research-loop): Solutions tab UI module"
```

---

## Task 12: Mount Solutions tab in `screens/topic.js`

**Files:**
- Modify: `app-tauri/src/screens/topic.js` (3 spots)

- [ ] **Step 1: Add the import at the top of topic.js**

Find the existing `import` block at the top of `app-tauri/src/screens/topic.js`. Add:

```javascript
import { loadSolutions } from './solutions.js';
```

- [ ] **Step 2: Add the tab button**

Find the line at topic.js:50:

```html
      <button class="tab" data-tab="actions">⚡ Actions</button>
```

Insert immediately before it:

```html
      <button class="tab" data-tab="solutions">🧪 Solutions</button>
```

- [ ] **Step 3: Wire the tab in the loaders map (~line 714)**

Find this line:

```javascript
    map: loadMap, report: loadReport, evidence: loadEvidence,
    sources: loadSources, chat: loadChat, actions: loadActions,
```

Replace with:

```javascript
    map: loadMap, report: loadReport, evidence: loadEvidence,
    sources: loadSources, chat: loadChat, actions: loadActions,
    solutions: (el) => loadSolutions(el, topic),
```

(`topic` is in scope from the enclosing render function — verify by reading lines 700–720 first.)

- [ ] **Step 4: Add minimal CSS for the new card components**

Find the topic-screen CSS in `app-tauri/src/style.css` — look for `.tab` or `.empty-state` rules. Append at the end of that file:

```css
/* Solutions tab */
.solutions-card { border: 1px solid var(--border, #ddd); border-radius: 6px; margin-bottom: 12px; padding: 12px; background: var(--card-bg, #fff); }
.solutions-card summary { cursor: pointer; display: flex; gap: 12px; align-items: center; font-weight: 600; }
.solutions-card .painpoint-title { flex: 1; }
.solutions-card .card-body { margin-top: 12px; display: grid; gap: 16px; }
.solutions-card section h4 { margin: 0 0 6px; font-size: 13px; text-transform: uppercase; color: var(--muted, #666); }
.solutions-card .chip { display: inline-block; padding: 2px 8px; border-radius: 999px; background: var(--orange, #ff5722); color: #fff; font-size: 11px; margin-right: 4px; }
.tier-badge { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 11px; margin-right: 6px; }
.tier-meta { background: #6b21a8; color: #fff; }
.tier-peer { background: #047857; color: #fff; }
.tier-expert { background: #1d4ed8; color: #fff; }
.tier-anec { background: #6b7280; color: #fff; }
.tier-unknown { background: #d1d5db; color: #111; }
.intervention { padding: 8px; border-left: 3px solid var(--orange, #ff5722); margin-bottom: 8px; background: #fafafa; }
.intervention-label { font-weight: 500; }
.intervention-meta { font-size: 12px; color: #666; margin-top: 2px; }
.intervention-meta .effort { margin-left: 8px; }
.rationale { font-size: 12px; color: #555; margin-top: 4px; }
.papers { padding-left: 18px; font-size: 13px; }
.solutions-toolbar { margin-bottom: 12px; text-align: right; }
```

- [ ] **Step 5: Build and run the app to verify the tab appears**

Run: `cd app-tauri && pnpm tauri dev` (or `npm run tauri dev`).
- Wait for the dev window to open.
- Click into any existing topic.
- Verify a "🧪 Solutions" tab appears between "💬 Chat" and "⚡ Actions".
- Click it — should show either "No painpoints" or the "Run solutions pipeline" CTA.

If the tab doesn't appear, check: tab button HTML inserted (Step 2), import added (Step 1), loaders map updated (Step 3). Stop the dev server (Ctrl+C) when done.

- [ ] **Step 6: Commit**

```bash
git add app-tauri/src/screens/topic.js app-tauri/src/style.css
git commit -m "feat(research-loop): mount Solutions tab in topic screen"
```

---

## Task 13: End-to-end manual smoke test

This task has no automated tests — it verifies the pipeline against real data.

- [ ] **Step 1: Pick or create a topic with painpoints**

Use an existing topic that already has painpoint nodes (run `reddit-cli research findings --topic <name>` to verify). If none exist, create one:

```bash
.venv/bin/reddit-cli research collect --topic "habit tracking" --aggressive
.venv/bin/reddit-cli research graph build --topic "habit tracking"
.venv/bin/reddit-cli research graph enrich --topic "habit tracking"
```

Confirm painpoints exist: `.venv/bin/reddit-cli query "SELECT count(*) FROM graph_nodes WHERE kind='painpoint'"`. Expect ≥ 5.

- [ ] **Step 2: Run the pipeline from CLI**

Ensure an LLM provider is configured (Anthropic / OpenAI key set, or Ollama running with a pulled model). Then:

```bash
.venv/bin/reddit-cli research solutions --topic "habit tracking" --json
```

Expected: JSON summary with `painpoints_processed > 0`, `papers_persisted > 0`, `interventions_added > 0`. If all are 0, check provider configuration (`reddit-cli research test-llm`).

- [ ] **Step 3: Verify the graph was populated**

Run:

```bash
.venv/bin/reddit-cli query "SELECT kind, count(*) FROM graph_nodes WHERE topic='habit tracking' GROUP BY kind"
```

Expected output includes rows for `evidence_paper`, `mechanism`, `intervention` with non-zero counts.

- [ ] **Step 4: Verify the Solutions tab in the app**

Run: `cd app-tauri && pnpm tauri dev`
- Open the topic.
- Click the "🧪 Solutions" tab.
- Verify each painpoint shows: emotion chips, JTBD fields, ≥1 paper link, ≥1 intervention card with a tier badge.
- Click an intervention's paper link — should open in browser.

- [ ] **Step 5: Verify re-run is idempotent**

In the app, click "↻ Re-run pipeline". After it finishes, query:

```bash
.venv/bin/reddit-cli query "SELECT kind, count(*) FROM graph_nodes WHERE topic='habit tracking' GROUP BY kind"
```

Expected: same counts as Step 3 (no duplicates).

- [ ] **Step 6: Add a changelog entry**

Create `changelogs/YYYY-MM-DD_NN_research-loop-mvp-shipped.md` (look at existing `changelogs/` to find the correct date and next NN). Follow the global changelog format (see CLAUDE.md). Summarize: 4-stage pipeline, ~6 new files, 1 new tab, manual test passed on which topic.

- [ ] **Step 7: Commit the changelog**

```bash
git add changelogs/
git commit -m "docs(research-loop): changelog for MVP ship"
```

- [ ] **Step 8: Run the full test suite to confirm no regressions**

Run: `.venv/bin/pytest -v tests/`
Expected: all tests pass (existing + 5 new test files).

If any pre-existing test fails because of an unrelated bug, do NOT silence it — flag it and stop.

---

## Self-Review Notes

**Spec coverage check:**
- ✅ Stage 1 (Problem) — uses existing painpoint extractor, no new task needed.
- ✅ Stage 2 (Why) — Tasks 1, 2, 3, 8 (orchestrator).
- ✅ Stage 3 (Science) — Tasks 4, 8, plus persistence in Task 7.
- ✅ Stage 4 (Solution) — Tasks 5, 6, 7, 8.
- ✅ Discovery entry mode — solutions_pipeline takes a topic, the existing entry mode.
- ✅ Three new node kinds (mechanism, intervention, evidence_paper) — Task 7.
- ✅ Edge kinds (explained_by, addressed_by, supported_by, has_evidence) — Task 7.
- ✅ CLI command — Task 9.
- ✅ Tauri command + JS bridge — Task 10.
- ✅ Solutions tab UI — Tasks 11, 12.
- ✅ Cost ceiling met (1 LLM call per painpoint × 2 stages = ~2× enrich_graph) — confirmed by orchestrator structure.
- ✅ Open question (emotion/JTBD as nodes vs metadata) resolved: metadata on the painpoint, per the spec's default.
- ✅ Verification mode explicitly NOT in MVP — confirmed, only Discovery (topic-driven) supported.

**Placeholder scan:** No TBD/TODO/"appropriate error handling" patterns present. Every code step has full code.

**Type consistency:**
- `extract_why_for_painpoint` returns `dict[str, Any]` everywhere it appears.
- `fetch_science_for_painpoint` keyword args (`painpoint_label`, `jtbd_desired_outcome`, `limit`) match between Task 4 implementation and Task 8 caller.
- `synthesize_solutions_for_painpoint` keyword args (`painpoint_label`, `why`, `papers`, `provider`) match between Task 6 implementation and Task 8 caller.
- `persist_*` function signatures consistent across Task 7 and Task 8.
- JS `api.runSolutionsPipeline` matches the Rust command name `run_solutions_pipeline` and the export from `solutions.js`.
- Tab key `'solutions'` matches `data-tab="solutions"` in HTML and the loaders-map key.
