# Goal-Directed, Self-Evolving Agents — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each agent a structured goal and a self-evolving "Goal Playbook" + brain-like associative knowledge, so it promotes the product better with every reply/post/article.

**Architecture:** New `reply/playbook.py` (strategy engine), `reply/ideas.py` (idea synthesis), and a widened `persona/graph.py` (cross-source `associates` links) sit ON TOP of the existing personas/memories/conclusions + ChromaDB-ONNX palace + `persona_edges` graph. Generation injects the playbook; evolution re-distills it from memory+graph+feedback. Each new SQLite table uses the idempotent `init_reply_schema` add-column/create pattern.

**Tech Stack:** Python 3.11 (sqlite-utils `Database`), BYOK LLM via `analyze/providers/base.get_provider`, ChromaDB+MiniLM-ONNX palace, Rust/Tauri command bridge, vanilla-JS frontend (`app-tauri/src/or/`).

## Global Constraints

- Every new backend function is **fail-soft** — return a status dict, never raise (matches `learn.py`/`feedback.py`). No-LLM → `{ok:False, skipped:True, reason:...}`.
- LLM access ONLY via `from ..analyze.providers.base import get_provider` → `get_provider(provider).complete(prompt, system=..., max_tokens=..., temperature=...)`. Parse JSON with `from .util import loads_json`.
- SQLite via `from .schema import init_reply_schema` (reply tables) or `from ..core.db import get_db` (persona tables). Migrations idempotent (`add_column` guarded by `existing = {c.name for c in db[t].columns}`).
- Command triangle stays in sync: `commands.rs` `#[tauri::command]` + `main.rs` `generate_handler!` + `or/api.js` wrapper. JS invoke payload keys are camelCase (Tauri auto → snake_case).
- Tests: `pytest`, files under `tests/`, run from repo root with `.venv/bin/python -m pytest`. A `tests/conftest.py` adds `src` to path.
- Commit messages: conventional prefix, NO Claude attribution.
- Verify after JS edits: `cd app-tauri && node --check src/or/<file>.js && npm run build`.

---

## File structure

| File | Responsibility |
|---|---|
| `src/gapmap/reply/schema.py` (modify) | add `reply_playbook` + `reply_ideas` tables; goal columns on `agents` |
| `src/gapmap/reply/agent.py` (modify) | goal allow-list + composed `goal` string + `feedback_since_evolve`/`last_evolve_at` |
| `src/gapmap/reply/playbook.py` (create) | `current_playbook`, `evolve_playbook` |
| `src/gapmap/reply/ideas.py` (create) | `suggest_ideas`, `list_ideas`, `draft_from_idea`, `set_idea_status` |
| `src/gapmap/persona/graph.py` (modify) | `link_associations`, `associates` edges, `neighbors(... include_associates=)` |
| `src/gapmap/reply/generate.py` (modify) | inject playbook block + optional self-critique |
| `src/gapmap/reply/content.py` (modify) | inject playbook block |
| `src/gapmap/reply/learn.py` (modify) | tail-call `link_associations` + `evolve_playbook` |
| `src/gapmap/reply/feedback.py` (modify) | increment `feedback_since_evolve`, threshold → evolve |
| `src/gapmap/cli/reply_cmds.py` (modify) | `evolve`, `playbook`, `ideas`, `idea-draft`, `idea-status`, `goal-set` |
| `app-tauri/src-tauri/src/commands.rs` (modify) | new `#[tauri::command]`s |
| `app-tauri/src-tauri/src/main.rs` (modify) | register handlers |
| `app-tauri/src/or/api.js` (modify) | JS wrappers |
| `app-tauri/src/or/dynamic.js` (modify) | goal fields, strategy panel, idea board |
| `tests/test_playbook.py`, `tests/test_ideas.py`, `tests/test_associations.py`, `tests/test_agent_goal.py` (create) | unit tests |

---

## Task 1: Structured goal columns + composed goal string

**Files:**
- Modify: `src/gapmap/reply/schema.py` (the `agents` create + a forward-compat migration block)
- Modify: `src/gapmap/reply/agent.py:160` (allow-list), and the agent-hydration return
- Test: `tests/test_agent_goal.py`

**Interfaces:**
- Produces: `agents` gains nullable cols `objective`, `audience`, `win_signal`, `guardrails`, `last_evolve_at` (int), `feedback_since_evolve` (int default 0). `update_agent(aid, objective=..., audience=..., win_signal=..., guardrails=...)` persists them. `get_agent()` return dict gains a composed `goal` when structured fields set.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_agent_goal.py
import os, tempfile, pathlib
os.environ.setdefault("GAPMAP_DATA_DIR", tempfile.mkdtemp())

def test_goal_fields_persist_and_compose():
    from gapmap.reply import agent as A
    a = A.create_agent("GoalCo", make_active=True)
    A.update_agent(a["id"], objective="drive signups",
                   audience="students", win_signal="reply + click",
                   guardrails="never spam")
    got = A.get_agent(a["id"])
    assert got["objective"] == "drive signups"
    assert got["audience"] == "students"
    assert "drive signups" in got["goal"] and "students" in got["goal"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_agent_goal.py -v`
Expected: FAIL (KeyError 'objective' or composed goal empty).

- [ ] **Step 3: Add columns in schema.py**

In `src/gapmap/reply/schema.py`, find the `agents` table block. Add to the `create({...})` dict (fresh tables): `"objective": str, "audience": str, "win_signal": str, "guardrails": str, "last_evolve_at": int, "feedback_since_evolve": int,`. Then in the existing-table forward-compat section (mirror the `reply_opportunities` pattern), add:

```python
    existing_a = {c.name for c in db["agents"].columns}
    for col, typ in (("objective", str), ("audience", str), ("win_signal", str),
                     ("guardrails", str), ("last_evolve_at", int),
                     ("feedback_since_evolve", int)):
        if col not in existing_a:
            db["agents"].add_column(col, typ)
```

- [ ] **Step 4: Extend update_agent allow-list + compose goal**

In `src/gapmap/reply/agent.py:160` change the tuple to include the new text fields:

```python
    for k in ("name", "brand", "niche", "website", "goal", "product", "persona",
              "tone", "audience", "refresh_cadence",
              "objective", "win_signal", "guardrails"):
```
(`audience` already listed — keep one copy.) Then in `get_agent` (or the hydrate helper it calls), after building the row dict `a`, add:

```python
    if not (a.get("goal") or "").strip():
        parts = []
        if a.get("objective"):   parts.append(a["objective"])
        if a.get("audience"):    parts.append(f"for {a['audience']}")
        if a.get("win_signal"):  parts.append(f"win = {a['win_signal']}")
        if parts:
            a["goal"] = " · ".join(parts)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_agent_goal.py -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/gapmap/reply/schema.py src/gapmap/reply/agent.py tests/test_agent_goal.py
git commit -m "feat(agent): structured goal fields (objective/audience/win_signal/guardrails) + composed goal"
```

---

## Task 2: `reply_playbook` + `reply_ideas` tables

**Files:**
- Modify: `src/gapmap/reply/schema.py` (before `return db` at line 98)
- Test: covered by Tasks 3 & 6 (schema asserted there)

**Interfaces:**
- Produces tables: `reply_playbook(id TEXT PK, agent_id TEXT, version INT, playbook_json TEXT, sources_json TEXT, summary TEXT, created_at INT)` index `(agent_id, version)`; `reply_ideas(id TEXT PK, agent_id TEXT, title TEXT, thesis TEXT, kind TEXT, combines_json TEXT, source_mix TEXT, goal_fit REAL, status TEXT, created_at INT)` index `(agent_id, status)`.

- [ ] **Step 1: Add the create blocks**

In `src/gapmap/reply/schema.py`, immediately before `return db`:

```python
    if "reply_playbook" not in names:
        db["reply_playbook"].create({
            "id": str, "agent_id": str, "version": int,
            "playbook_json": str, "sources_json": str, "summary": str,
            "created_at": int,
        }, pk="id")
        db["reply_playbook"].create_index(["agent_id", "version"])
    if "reply_ideas" not in names:
        db["reply_ideas"].create({
            "id": str, "agent_id": str, "title": str, "thesis": str,
            "kind": str, "combines_json": str, "source_mix": str,
            "goal_fit": float, "status": str, "created_at": int,
        }, pk="id")
        db["reply_ideas"].create_index(["agent_id", "status"])
```

- [ ] **Step 2: Verify schema builds**

Run: `.venv/bin/python -c "from gapmap.reply.schema import init_reply_schema; d=init_reply_schema(); print('reply_playbook' in d.table_names(), 'reply_ideas' in d.table_names())"`
Expected: `True True`

- [ ] **Step 3: Commit**

```bash
git add src/gapmap/reply/schema.py
git commit -m "feat(reply): reply_playbook + reply_ideas tables"
```

---

## Task 3: Playbook engine (`reply/playbook.py`)

**Files:**
- Create: `src/gapmap/reply/playbook.py`
- Test: `tests/test_playbook.py`

**Interfaces:**
- Consumes: `agent.get_agent`, `agent.list_linked_personas`, `persona.conclude.list_conclusions`, `persona.retrieve.retrieve` (semantic/keyword over a persona's memories), `feedback.feedback_counts`, `get_provider`, `loads_json`, `init_reply_schema`.
- Produces: `current_playbook(agent_id) -> dict | None` (parsed `playbook` + `version` + meta); `evolve_playbook(agent_id, provider=None, reason="manual") -> dict` (`{ok, version, summary}` or `{ok:False, skipped, reason}`).

- [ ] **Step 1: Write the failing test**

```python
# tests/test_playbook.py
import os, tempfile
os.environ.setdefault("GAPMAP_DATA_DIR", tempfile.mkdtemp())

def test_evolve_skips_without_goal(monkeypatch):
    from gapmap.reply import agent as A, playbook as P
    a = A.create_agent("NoGoalCo", make_active=True)
    r = P.evolve_playbook(a["id"])
    assert r["ok"] is False and r["skipped"] is True

def test_evolve_persists_version(monkeypatch):
    from gapmap.reply import agent as A, playbook as P
    a = A.create_agent("PBCo", make_active=True)
    A.update_agent(a["id"], objective="promote X", audience="devs", win_signal="signup")
    # stub the LLM so no network/key needed
    import gapmap.reply.playbook as PB
    monkeypatch.setattr(PB, "_llm_distill", lambda *args, **kw: {
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_playbook.py -v`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `reply/playbook.py`**

```python
"""Goal Playbook — the agent's self-evolving promotion strategy.

Distills the agent's goal + its memory (semantic retrieval over the persona
ChromaDB collections), beliefs (conclusions), and feedback (engaged/dismissed +
human edit-diffs) into a structured, versioned strategy that generation writes
from. Fail-soft: never raises; skips with a reason when no goal / no LLM.
"""
from __future__ import annotations

import hashlib
import json
import time

from ..analyze.providers.base import get_provider
from .agent import get_agent, list_linked_personas
from .schema import init_reply_schema
from .util import loads_json

_SYS = "You distill a brand's outreach strategy into STRICT JSON. Output ONLY JSON."


def current_playbook(agent_id: str | None = None) -> dict | None:
    db = init_reply_schema()
    a = get_agent(agent_id)
    if not a:
        return None
    rows = list(db["reply_playbook"].rows_where(
        "agent_id = ?", [a["id"]], order_by="version desc", limit=1))
    if not rows:
        return None
    r = rows[0]
    try:
        pb = json.loads(r.get("playbook_json") or "{}")
    except Exception:
        pb = {}
    return {"version": r["version"], "playbook": pb,
            "summary": r.get("summary", ""), "created_at": r.get("created_at")}


def _gather_memories(agent_id: str, goal: str, k: int = 8) -> list[dict]:
    """Goal-relevant memories across the agent's linked personas via the palace
    embeddings (semantic), falling back to keyword retrieval."""
    from ..persona.retrieve import retrieve
    out: list[dict] = []
    for ln in list_linked_personas(agent_id):
        try:
            out += retrieve(int(ln["persona_id"]), goal or "", n=k) or []
        except Exception:
            pass
    return out


def _gather_beliefs(agent_id: str) -> list[dict]:
    from ..persona.conclude import list_conclusions
    out: list[dict] = []
    for ln in list_linked_personas(agent_id):
        try:
            out += list_conclusions(int(ln["persona_id"]), limit=20) or []
        except Exception:
            pass
    return out


def _edit_diffs(db, agent_id: str, limit: int = 8) -> list[dict]:
    """Pairs of (generated, final-edited) draft text — 'what the human changed'."""
    rows = list(db["reply_drafts"].rows_where(
        "brand_id = ?", [agent_id], order_by="created_at desc", limit=200))
    by_opp: dict[str, list[dict]] = {}
    for r in rows:
        by_opp.setdefault(r["opportunity_id"], []).append(r)
    diffs: list[dict] = []
    for opp, drs in by_opp.items():
        gen = next((d for d in drs if d.get("source") == "generated"), None)
        edited = next((d for d in drs if d.get("source") == "edited"), None)
        if gen and edited and gen.get("text") != edited.get("text"):
            diffs.append({"before": (gen["text"] or "")[:500],
                          "after": (edited["text"] or "")[:500]})
        if len(diffs) >= limit:
            break
    return diffs


def _llm_distill(goal_block: str, mem_txt: str, belief_txt: str,
                 fb_txt: str, diff_txt: str, provider: str | None) -> dict:
    prompt = (
        f"{goal_block}\n"
        f"What the agent has learned (memories):\n{mem_txt or '(none yet)'}\n\n"
        f"Its beliefs (conclusions):\n{belief_txt or '(none yet)'}\n\n"
        f"Feedback so far:\n{fb_txt}\n\n"
        f"How the human edited recent drafts (before → after):\n{diff_txt or '(none)'}\n\n"
        "Distill a promotion playbook that advances the GOAL while staying genuinely "
        "helpful and non-spammy. Return ONLY this JSON:\n"
        '{"winning_angles":[{"angle":"","why":"","for":""}],'
        '"phrasings":[""],"avoid":[""],'
        '"per_platform":{"reddit":""},"next_experiments":[""]}'
    )
    raw = get_provider(provider).complete(prompt, system=_SYS, max_tokens=900, temperature=0.3)
    data = loads_json(raw)
    if not isinstance(data, dict) or not data:
        raise ValueError("empty playbook")
    return data


def evolve_playbook(agent_id: str | None = None, provider: str | None = None,
                    reason: str = "manual") -> dict:
    db = init_reply_schema()
    a = get_agent(agent_id)
    if not a:
        return {"ok": False, "skipped": True, "reason": "no such agent"}
    goal = (a.get("goal") or "").strip()
    if not goal and not (a.get("objective") or "").strip():
        return {"ok": False, "skipped": True, "reason": "no goal set — add an objective on the agent"}

    goal_block = (
        f"GOAL\nObjective: {a.get('objective') or goal}\n"
        f"Audience: {a.get('audience') or '—'}\n"
        f"Win signal: {a.get('win_signal') or '—'}\n"
        f"Guardrails: {a.get('guardrails') or 'be honest; disclose; never spam'}\n"
        f"Product: {a.get('product') or a.get('brand') or a.get('niche') or '—'}"
    )
    mems = _gather_memories(a["id"], goal)
    beliefs = _gather_beliefs(a["id"])
    mem_txt = "\n".join(f"- {(m.get('lesson') or '')[:200]}" for m in mems[:12])
    belief_txt = "\n".join(f"- {(b.get('statement') or '')[:200]}" for b in beliefs[:10])
    try:
        from .feedback import feedback_counts
        fb = feedback_counts(a["id"])
    except Exception:
        fb = {}
    fb_txt = f"engaged={fb.get('engaged', 0)} dismissed={fb.get('dismissed', 0)}"
    diffs = _edit_diffs(db, a["id"])
    diff_txt = "\n".join(f"BEFORE: {d['before']}\nAFTER: {d['after']}" for d in diffs)

    try:
        pb = _llm_distill(goal_block, mem_txt, belief_txt, fb_txt, diff_txt, provider)
    except Exception as e:
        msg = str(e)
        if "No LLM provider" in msg:
            return {"ok": False, "skipped": True, "reason": "no LLM configured", "error_class": "llm_key"}
        return {"ok": False, "skipped": True, "reason": f"distill failed: {msg[:160]}"}

    prev = current_playbook(a["id"])
    version = (prev["version"] + 1) if prev else 1
    now = int(time.time())
    pid = hashlib.sha1(f"{a['id']}|{version}|{now}".encode()).hexdigest()[:16]
    summary = (f"v{version} from {len(mems)} memories, {len(beliefs)} beliefs, "
               f"{len(diffs)} edit(s) · trigger={reason}")
    db["reply_playbook"].upsert({
        "id": pid, "agent_id": a["id"], "version": version,
        "playbook_json": json.dumps(pb),
        "sources_json": json.dumps({"memories": len(mems), "beliefs": len(beliefs),
                                    "edit_diffs": len(diffs), "feedback": fb, "reason": reason}),
        "summary": summary, "created_at": now,
    }, pk="id")
    try:
        db["agents"].update(a["id"], {"last_evolve_at": now, "feedback_since_evolve": 0})
    except Exception:
        pass
    return {"ok": True, "version": version, "summary": summary,
            "memories": len(mems), "beliefs": len(beliefs)}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_playbook.py -v`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add src/gapmap/reply/playbook.py tests/test_playbook.py
git commit -m "feat(reply): Goal Playbook engine — evolve_playbook + current_playbook"
```

---

## Task 4: Playbook-aware generation + self-critique

**Files:**
- Modify: `src/gapmap/reply/generate.py` (`generate_reply`)
- Modify: `src/gapmap/reply/content.py` (`generate_content`)
- Test: `tests/test_playbook.py` (add a generation-prompt test)

**Interfaces:**
- Consumes: `playbook.current_playbook`.
- Produces: a shared helper `playbook_block(agent_id) -> str` (in `playbook.py`) reused by both generators.

- [ ] **Step 1: Add `playbook_block` to playbook.py**

```python
def playbook_block(agent_id: str | None = None) -> str:
    """Compact strategy block for generation prompts (empty if no playbook)."""
    cur = current_playbook(agent_id)
    if not cur or not cur.get("playbook"):
        return ""
    pb = cur["playbook"]
    angles = pb.get("winning_angles") or []
    avoid = pb.get("avoid") or []
    lines = [f"STRATEGY PLAYBOOK v{cur['version']} — write in line with this:"]
    for a in angles[:3]:
        lines.append(f"- angle: {a.get('angle','')} ({a.get('why','')})")
    if avoid:
        lines.append("AVOID: " + "; ".join(str(x) for x in avoid[:4]))
    return "\n".join(lines) + "\n"
```

- [ ] **Step 2: Write the failing test**

```python
# add to tests/test_playbook.py
def test_playbook_block_renders(monkeypatch):
    from gapmap.reply import agent as A, playbook as P
    a = A.create_agent("BlkCo", make_active=True)
    A.update_agent(a["id"], objective="promote X")
    monkeypatch.setattr(P, "_llm_distill", lambda *x, **k: {
        "winning_angles":[{"angle":"lead with pain","why":"works","for":"all"}],
        "avoid":["spam"]})
    P.evolve_playbook(a["id"])
    blk = P.playbook_block(a["id"])
    assert "STRATEGY PLAYBOOK v1" in blk and "lead with pain" in blk
```

- [ ] **Step 3: Run → fail, then wire into generators**

Run: `.venv/bin/python -m pytest tests/test_playbook.py::test_playbook_block_renders -v` → FAIL.

In `generate.py::generate_reply`, after `rules_block = _rules_guidance(...)` add:
```python
    from .playbook import playbook_block
    pb_block = playbook_block(agent_id)
```
and insert `f"{pb_block}"` into the prompt string right after `{goal_block}`.

In `content.py::generate_content`, after `knowledge = build_knowledge_context(...)` add the same two lines (`from .playbook import playbook_block; pb_block = playbook_block(a["id"])`) and inject `pb_block` into the prompt the spec builds (find the `prompt = (` assembly and add `f"{pb_block}"`).

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_playbook.py -v`
Expected: PASS. Also `.venv/bin/python -c "import gapmap.reply.generate, gapmap.reply.content; print('ok')"` → `ok`.

- [ ] **Step 5: Add optional self-critique to generate_reply**

In `generate.py`, after `text = get_provider(provider).complete(prompt, ...).strip()` and before `_persist_draft`, add:
```python
    import os
    if os.getenv("OR_SELF_CRITIQUE", "1") == "1":
        try:
            crit = (
                f"{goal_block}\n{rules_block}\n"
                f'Draft reply:\n"""{text}"""\n\n'
                "If this is salesy, breaks a rule, sounds like a bot, or ignores the "
                "strategy, rewrite it ONCE to fix that while keeping it genuinely helpful. "
                "Return ONLY the final reply text (no preamble)."
            )
            revised = get_provider(provider).complete(crit, system=_SYS, max_tokens=400, temperature=0.4).strip()
            if revised and len(revised) > 20:
                text = revised
        except Exception:
            pass
```

- [ ] **Step 6: Verify import + commit**

Run: `.venv/bin/python -c "import gapmap.reply.generate; print('ok')"` → `ok`
```bash
git add src/gapmap/reply/playbook.py src/gapmap/reply/generate.py src/gapmap/reply/content.py tests/test_playbook.py
git commit -m "feat(reply): playbook-aware generation + optional self-critique pass"
```

---

## Task 5: Cross-source associative links (`persona/graph.py`)

**Files:**
- Modify: `src/gapmap/persona/graph.py` (add `link_associations`, extend `neighbors`)
- Test: `tests/test_associations.py`

**Interfaces:**
- Consumes: existing `embed_memory`/collection access, `persona_edges` writes, `core.db.get_db`.
- Produces: `link_associations(agent_id, min_sim=0.5, cap=8, provider=None) -> dict` (`{ok, edges}`); `neighbors(persona_id, memory_ids, limit=4, include_associates=False)`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_associations.py
import os, tempfile
os.environ.setdefault("GAPMAP_DATA_DIR", tempfile.mkdtemp())

def test_link_associations_fail_soft_no_personas():
    from gapmap.reply import agent as A
    from gapmap.persona import graph as G
    a = A.create_agent("AssocCo", make_active=True)
    r = G.link_associations(a["id"])
    assert r["ok"] is True and r["edges"] >= 0  # no memories yet → 0, never raises
```

- [ ] **Step 2: Run → fail**

Run: `.venv/bin/python -m pytest tests/test_associations.py -v` → FAIL (no attribute `link_associations`).

- [ ] **Step 3: Implement `link_associations` + extend `neighbors`**

Add to `src/gapmap/persona/graph.py` (reuses the module's existing ChromaDB collection accessor — match the existing `build_edges_for_memory` pattern for getting a persona's collection + querying):

```python
def link_associations(agent_id, min_sim: float = 0.5, cap: int = 8, provider=None) -> dict:
    """Brain-like cross-persona/cross-source links: cosine-match memories across
    ALL of the agent's linked personas and record the strongest pairs as
    `associates` edges (with an LLM one-line 'why'). Fail-soft."""
    from ..reply.agent import list_linked_personas
    from ..core.db import get_db
    db = get_db()
    pids = [int(l["persona_id"]) for l in list_linked_personas(agent_id)]
    if len(pids) < 1:
        return {"ok": True, "edges": 0, "reason": "no personas"}
    # Collect (memory_id, lesson, embedding) for every persona's memories.
    items = []  # [(pid, mem_id, lesson, vec)]
    for pid in pids:
        try:
            col = _collection(pid)  # existing helper that opens persona_memories_<pid>
            got = col.get(include=["embeddings", "metadatas", "documents"])
            for emb, meta, doc in zip(got.get("embeddings") or [],
                                      got.get("metadatas") or [],
                                      got.get("documents") or []):
                mid = int((meta or {}).get("memory_id", 0))
                if mid:
                    items.append((pid, mid, doc or "", emb))
        except Exception:
            continue
    if len(items) < 2:
        return {"ok": True, "edges": 0}
    import math
    def cos(u, v):
        dot = sum(x * y for x, y in zip(u, v))
        nu = math.sqrt(sum(x * x for x in u)) or 1.0
        nv = math.sqrt(sum(y * y for y in v)) or 1.0
        return dot / (nu * nv)
    pairs = []
    for i in range(len(items)):
        for j in range(i + 1, len(items)):
            if items[i][0] == items[j][0]:
                continue  # same persona already linked via relates_to
            s = cos(items[i][3], items[j][3])
            if s >= min_sim:
                pairs.append((s, items[i], items[j]))
    pairs.sort(key=lambda p: p[0], reverse=True)
    written = 0
    for s, A_, B_ in pairs[:cap]:
        why = ""
        try:
            from ..analyze.providers.base import get_provider
            why = get_provider(provider).complete(
                f'Idea A: "{A_[2][:160]}"\nIdea B: "{B_[2][:160]}"\n'
                "In ONE short sentence, why do these connect?",
                system="Output one plain sentence.", max_tokens=60, temperature=0.3).strip()[:200]
        except Exception:
            why = "semantically similar"
        try:
            db["persona_edges"].insert({
                "persona_id": A_[0], "from_memory_id": A_[1], "to_memory_id": B_[1],
                "kind": "associates", "weight": round(float(s), 3),
                "created_at": __import__("datetime").datetime.utcnow().isoformat(),
            }, alter=True)
            written += 1
        except Exception:
            pass
    return {"ok": True, "edges": written}
```

Then extend the existing `neighbors(persona_id, memory_ids, limit=4)` signature to `neighbors(persona_id, memory_ids, limit=4, include_associates=False)` and, in its WHERE clause on `persona_edges`, only filter `kind != 'associates'` unless `include_associates` is True. (If the current query has no kind filter, add `AND (kind != 'associates' OR ? = 1)` binding `1 if include_associates else 0`.)

> Note for implementer: confirm the persona-collection accessor's real name in `graph.py` (the infra map calls the embed path `embed_memory`/`build_edges_for_memory`). Use whatever helper those use to obtain the persona's ChromaDB collection; name it `_collection(pid)` here for the plan.

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_associations.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/gapmap/persona/graph.py tests/test_associations.py
git commit -m "feat(persona): cross-source associative links (associates edges) + neighbors flag"
```

---

## Task 6: Idea synthesis (`reply/ideas.py`)

**Files:**
- Create: `src/gapmap/reply/ideas.py`
- Test: `tests/test_ideas.py`

**Interfaces:**
- Consumes: `agent.get_agent`, `agent.list_linked_personas`, `persona.conclude._cluster_memories`+`_fetch_memories` (clustering), `playbook.playbook_block`, `content.generate_content`, `get_provider`, `loads_json`, `init_reply_schema`.
- Produces: `suggest_ideas(agent_id=None, n=5, provider=None) -> dict`; `list_ideas(agent_id=None, status=None) -> list[dict]`; `set_idea_status(idea_id, status) -> dict`; `draft_from_idea(idea_id, kind="article", platform=None, provider=None) -> dict`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_ideas.py
import os, tempfile
os.environ.setdefault("GAPMAP_DATA_DIR", tempfile.mkdtemp())

def test_suggest_ideas_fail_soft(monkeypatch):
    from gapmap.reply import agent as A, ideas as I
    a = A.create_agent("IdeaCo", make_active=True)
    r = I.suggest_ideas(a["id"])  # no memories yet
    assert r["ok"] is True and isinstance(r["ideas"], list)

def test_idea_status_roundtrip():
    from gapmap.reply import agent as A, ideas as I
    from gapmap.reply.schema import init_reply_schema
    import time
    a = A.create_agent("IdeaCo2", make_active=True)
    db = init_reply_schema()
    db["reply_ideas"].insert({"id":"x1","agent_id":a["id"],"title":"T","thesis":"th",
        "kind":"article","combines_json":"[]","source_mix":"mixed","goal_fit":0.7,
        "status":"suggested","created_at":int(time.time())}, pk="id")
    I.set_idea_status("x1","dismissed")
    got = [i for i in I.list_ideas(a["id"]) if i["id"]=="x1"][0]
    assert got["status"] == "dismissed"
```

- [ ] **Step 2: Run → fail**

Run: `.venv/bin/python -m pytest tests/test_ideas.py -v` → FAIL (module not found).

- [ ] **Step 3: Write `reply/ideas.py`**

```python
"""Idea synthesis — combine the agent's knowledge (memories + beliefs, linked
across sources) into suggested articles/posts. Brain-like: it fuses threads,
names what it combined, and scores fit to the goal. Fail-soft."""
from __future__ import annotations

import hashlib
import json
import time

from ..analyze.providers.base import get_provider
from .agent import get_agent, list_linked_personas
from .schema import init_reply_schema
from .util import loads_json

_SYS = "You turn research threads into ONE content idea as STRICT JSON. Output ONLY JSON."


def list_ideas(agent_id: str | None = None, status: str | None = None) -> list[dict]:
    db = init_reply_schema()
    a = get_agent(agent_id)
    if not a:
        return []
    where, args = "agent_id = ?", [a["id"]]
    if status:
        where += " AND status = ?"; args.append(status)
    return list(db["reply_ideas"].rows_where(where, args, order_by="goal_fit desc, created_at desc"))


def set_idea_status(idea_id: str, status: str) -> dict:
    db = init_reply_schema()
    try:
        db["reply_ideas"].update(idea_id, {"status": status})
        return {"ok": True, "id": idea_id, "status": status}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def _clusters_for_agent(agent_id: str) -> list[list[dict]]:
    """Memory clusters across the agent's personas (reuses conclude's union-find)."""
    from ..persona.conclude import _cluster_memories, _fetch_memories
    out: list[list[dict]] = []
    for ln in list_linked_personas(agent_id):
        pid = int(ln["persona_id"])
        try:
            for grp in _cluster_memories(pid):
                mems = _fetch_memories(grp)
                if len(mems) >= 2:
                    out.append(mems)
        except Exception:
            continue
    return out


def suggest_ideas(agent_id: str | None = None, n: int = 5, provider: str | None = None) -> dict:
    db = init_reply_schema()
    a = get_agent(agent_id)
    if not a:
        return {"ok": False, "skipped": True, "reason": "no such agent", "ideas": []}
    goal = (a.get("goal") or a.get("objective") or "").strip()
    clusters = _clusters_for_agent(a["id"])
    if not clusters:
        return {"ok": True, "ideas": [], "reason": "not enough linked knowledge yet"}

    made: list[dict] = []
    now = int(time.time())
    for grp in clusters[:n]:
        threads = "\n".join(f"- {(m.get('lesson') or '')[:180]}" for m in grp[:6])
        prompt = (
            f"GOAL: {goal or '(promote the product helpfully)'}\n"
            f"Product: {a.get('product') or a.get('brand') or '—'}\n\n"
            f"Knowledge threads (combine them into ONE idea):\n{threads}\n\n"
            "Return ONLY JSON: "
            '{"title":"","thesis":"one-paragraph angle that fuses the threads",'
            '"kind":"article|post|thread","goal_fit":0.0,"source_mix":"data-source|conclusion|mixed"}'
        )
        try:
            data = loads_json(get_provider(provider).complete(prompt, system=_SYS, max_tokens=400, temperature=0.5))
        except Exception as e:
            if "No LLM provider" in str(e):
                return {"ok": False, "skipped": True, "reason": "no LLM configured", "ideas": made}
            continue
        if not isinstance(data, dict) or not data.get("title"):
            continue
        iid = hashlib.sha1(f"{a['id']}|{data['title']}|{now}".encode()).hexdigest()[:16]
        rec = {
            "id": iid, "agent_id": a["id"], "title": str(data["title"])[:200],
            "thesis": str(data.get("thesis", ""))[:1200],
            "kind": (data.get("kind") or "article")[:20],
            "combines_json": json.dumps([m.get("id") for m in grp]),
            "source_mix": (data.get("source_mix") or "mixed")[:20],
            "goal_fit": float(data.get("goal_fit", 0) or 0), "status": "suggested",
            "created_at": now,
        }
        db["reply_ideas"].upsert(rec, pk="id")
        made.append(rec)
    return {"ok": True, "ideas": made}


def draft_from_idea(idea_id: str, kind: str | None = None,
                    platform: str | None = None, provider: str | None = None) -> dict:
    db = init_reply_schema()
    try:
        idea = dict(db["reply_ideas"].get(idea_id))
    except Exception as e:
        return {"ok": False, "error": f"no idea '{idea_id}': {e}"}
    from .content import generate_content
    angle = f"{idea.get('title','')} — {idea.get('thesis','')}"
    res = generate_content(kind or idea.get("kind") or "article",
                           agent_id=idea["agent_id"], platform=platform,
                           angle=angle, provider=provider)
    if isinstance(res, dict) and not res.get("error"):
        try:
            db["reply_ideas"].update(idea_id, {"status": "used"})
        except Exception:
            pass
    return res
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_ideas.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/gapmap/reply/ideas.py tests/test_ideas.py
git commit -m "feat(reply): idea synthesis — suggest_ideas/draft_from_idea combining knowledge threads"
```

---

## Task 7: Wire evolution triggers (learn + feedback)

**Files:**
- Modify: `src/gapmap/reply/learn.py` (`learn_for_agent` tail)
- Modify: `src/gapmap/reply/feedback.py` (`record_opportunity_feedback`)
- Test: `tests/test_playbook.py` (trigger test)

**Interfaces:**
- Consumes: `playbook.evolve_playbook`, `graph.link_associations`.
- Produces: `feedback.py` increments `agents.feedback_since_evolve`; threshold (5) → `evolve_playbook(reason="feedback")`.

- [ ] **Step 1: Learn tail-call**

In `learn.py::learn_for_agent`, just before the final `return {...}`, add:
```python
    try:
        if total_learned > 0 and (a.get("objective") or a.get("goal")):
            from ..persona.graph import link_associations
            from .playbook import evolve_playbook
            link_associations(a["id"], provider=provider)
            evolve_playbook(a["id"], provider=provider, reason="learn")
    except Exception:
        pass
```

- [ ] **Step 2: Feedback threshold**

In `feedback.py::record_opportunity_feedback`, after the row is upserted (and `_seed_corpus` on engaged), add:
```python
    try:
        from .agent import get_agent
        from .schema import init_reply_schema
        db = init_reply_schema()
        a = get_agent(None)
        if a:
            n = int(a.get("feedback_since_evolve") or 0) + 1
            db["agents"].update(a["id"], {"feedback_since_evolve": n})
            if n >= 5 and (a.get("objective") or a.get("goal")):
                from .playbook import evolve_playbook
                evolve_playbook(a["id"], reason="feedback")
    except Exception:
        pass
```

- [ ] **Step 3: Write the trigger test**

```python
# add to tests/test_playbook.py
def test_feedback_increments_counter(monkeypatch):
    from gapmap.reply import agent as A
    from gapmap.reply.schema import init_reply_schema
    a = A.create_agent("FbCo", make_active=True)
    A.update_agent(a["id"], objective="promote")
    import gapmap.reply.feedback as F
    monkeypatch.setattr(F, "_seed_corpus", lambda *x, **k: None)
    # stub evolve so no LLM
    import gapmap.reply.playbook as P
    monkeypatch.setattr(P, "evolve_playbook", lambda *x, **k: {"ok": True})
    db = init_reply_schema()
    db["reply_opportunities"].insert({"id":"o1","brand_id":a["id"],"platform":"reddit_free",
        "post_id":"p1","title":"t","status":"new","found_at":0}, pk="id", alter=True)
    F.record_opportunity_feedback("o1","dismissed")
    got = A.get_agent(a["id"])
    assert int(got.get("feedback_since_evolve") or 0) >= 1
```

- [ ] **Step 4: Run + commit**

Run: `.venv/bin/python -m pytest tests/test_playbook.py -v` → PASS
```bash
git add src/gapmap/reply/learn.py src/gapmap/reply/feedback.py tests/test_playbook.py
git commit -m "feat(reply): auto-evolve triggers (after learn + feedback threshold)"
```

---

## Task 8: CLI commands

**Files:**
- Modify: `src/gapmap/cli/reply_cmds.py`
- Test: manual (`.venv/bin/python -m gapmap.cli.main reply <cmd> --json`)

**Interfaces:**
- Produces CLI: `reply evolve`, `reply playbook`, `reply ideas`, `reply idea-draft`, `reply idea-status`, `reply goal-set`.

- [ ] **Step 1: Add commands** (mirror the existing `_out(...)` pattern in `reply_cmds.py`)

```python
@reply_app.command("goal-set")
def goal_set_cmd(objective: str = typer.Option(""), audience: str = typer.Option(""),
                 win_signal: str = typer.Option(""), guardrails: str = typer.Option(""),
                 json_: bool = typer.Option(True, "--json/--no-json")):
    from ..reply.agent import get_active_agent, update_agent
    a = get_active_agent()
    if not a: _out({"error": "no active agent"}, json_); return
    _out(update_agent(a["id"], objective=objective, audience=audience,
                      win_signal=win_signal, guardrails=guardrails), json_)

@reply_app.command("playbook")
def playbook_cmd(json_: bool = typer.Option(True, "--json/--no-json")):
    from ..reply.playbook import current_playbook
    _out(current_playbook() or {"playbook": None}, json_)

@reply_app.command("evolve")
def evolve_cmd(json_: bool = typer.Option(True, "--json/--no-json")):
    from ..reply.playbook import evolve_playbook
    _out(evolve_playbook(reason="manual"), json_)

@reply_app.command("ideas")
def ideas_cmd(n: int = typer.Option(5), suggest: bool = typer.Option(False, "--suggest"),
              json_: bool = typer.Option(True, "--json/--no-json")):
    from ..reply.ideas import suggest_ideas, list_ideas
    if suggest:
        _out(suggest_ideas(n=n), json_)
    else:
        _out({"ideas": list_ideas(status="suggested")}, json_)

@reply_app.command("idea-draft")
def idea_draft_cmd(idea: str = typer.Option(..., "--idea"), kind: str = typer.Option(""),
                   platform: str = typer.Option(""), json_: bool = typer.Option(True, "--json/--no-json")):
    from ..reply.ideas import draft_from_idea
    _out(draft_from_idea(idea, kind=kind or None, platform=platform or None), json_)

@reply_app.command("idea-status")
def idea_status_cmd(idea: str = typer.Option(..., "--idea"), status: str = typer.Option(...),
                    json_: bool = typer.Option(True, "--json/--no-json")):
    from ..reply.ideas import set_idea_status
    _out(set_idea_status(idea, status), json_)
```

- [ ] **Step 2: Smoke test**

Run: `GAPMAP_DATA_DIR=$(mktemp -d) .venv/bin/python -m gapmap.cli.main reply playbook --json`
Expected: JSON `{"playbook": null}` (no agent) or a playbook — no traceback.

- [ ] **Step 3: Commit**

```bash
git add src/gapmap/cli/reply_cmds.py
git commit -m "feat(cli): reply evolve/playbook/ideas/idea-draft/idea-status/goal-set"
```

---

## Task 9: Rust command triangle

**Files:**
- Modify: `app-tauri/src-tauri/src/commands.rs`
- Modify: `app-tauri/src-tauri/src/main.rs` (`generate_handler!`)
- Test: `cd app-tauri/src-tauri && cargo check`

**Interfaces:**
- Produces Tauri commands: `agent_goal_set`, `agent_playbook_get`, `agent_evolve`, `agent_ideas`, `agent_idea_draft`, `agent_idea_status` — each `run_cli(["reply", ...])`.

- [ ] **Step 1: Add commands** (mirror the existing `sub_intel` shape in `commands.rs`)

```rust
#[tauri::command]
pub async fn agent_goal_set(app: AppHandle, objective: String, audience: String,
    win_signal: String, guardrails: String) -> Result<Value, String> {
    run_cli(&app, vec!["reply","goal-set","--objective",&objective,"--audience",&audience,
        "--win-signal",&win_signal,"--guardrails",&guardrails,"--json"]).await.map_err(err_to_string)
}
#[tauri::command]
pub async fn agent_playbook_get(app: AppHandle) -> Result<Value, String> {
    run_cli(&app, vec!["reply","playbook","--json"]).await.map_err(err_to_string)
}
#[tauri::command]
pub async fn agent_evolve(app: AppHandle) -> Result<Value, String> {
    run_cli(&app, vec!["reply","evolve","--json"]).await.map_err(err_to_string)
}
#[tauri::command]
pub async fn agent_ideas(app: AppHandle, suggest: Option<bool>, n: Option<u32>) -> Result<Value, String> {
    let nn = n.unwrap_or(5).to_string();
    let mut args = vec!["reply".to_string(),"ideas".to_string(),"--n".to_string(),nn,"--json".to_string()];
    if suggest.unwrap_or(false) { args.push("--suggest".into()); }
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    run_cli(&app, refs).await.map_err(err_to_string)
}
#[tauri::command]
pub async fn agent_idea_draft(app: AppHandle, idea: String, kind: Option<String>, platform: Option<String>) -> Result<Value, String> {
    let k = kind.unwrap_or_default(); let p = platform.unwrap_or_default();
    run_cli(&app, vec!["reply","idea-draft","--idea",&idea,"--kind",&k,"--platform",&p,"--json"]).await.map_err(err_to_string)
}
#[tauri::command]
pub async fn agent_idea_status(app: AppHandle, idea: String, status: String) -> Result<Value, String> {
    run_cli(&app, vec!["reply","idea-status","--idea",&idea,"--status",&status,"--json"]).await.map_err(err_to_string)
}
```

- [ ] **Step 2: Register in main.rs** — add all six to the `tauri::generate_handler![ ... ]` list (`commands::agent_goal_set, commands::agent_playbook_get, commands::agent_evolve, commands::agent_ideas, commands::agent_idea_draft, commands::agent_idea_status`).

- [ ] **Step 3: cargo check + commit**

Run: `cd app-tauri/src-tauri && cargo check 2>&1 | tail -5` → `Finished` (JWT warning OK).
```bash
git add app-tauri/src-tauri/src/commands.rs app-tauri/src-tauri/src/main.rs
git commit -m "feat(tauri): agent evolve/playbook/ideas/goal command triangle"
```

---

## Task 10: JS API wrappers

**Files:**
- Modify: `app-tauri/src/or/api.js`
- Test: `node --check`

**Interfaces:**
- Produces: `api.agentGoalSet`, `api.agentPlaybook`, `api.agentEvolve`, `api.agentIdeas`, `api.agentIdeaDraft`, `api.agentIdeaStatus`.

- [ ] **Step 1: Add wrappers** (after the agent block in `or/api.js`)

```javascript
  agentGoalSet: (objective, audience, winSignal, guardrails) =>
    call("agent_goal_set", { objective: objective||"", audience: audience||"", winSignal: winSignal||"", guardrails: guardrails||"" }),
  agentPlaybook: () => call("agent_playbook_get"),
  agentEvolve: () => call("agent_evolve"),
  agentIdeas: (suggest, n) => call("agent_ideas", { suggest: !!suggest, n: n||5 }),
  agentIdeaDraft: (idea, kind, platform) => call("agent_idea_draft", { idea, kind: kind||"", platform: platform||"" }),
  agentIdeaStatus: (idea, status) => call("agent_idea_status", { idea, status }),
```
(Add `"agent_list", "agent_get", ... ,"agent_playbook_get","reply_ideas"` families to the `SWR_READS` set if read-caching is desired — optional; `agent_playbook_get` benefits.)

- [ ] **Step 2: Verify + commit**

Run: `cd app-tauri && node --check src/or/api.js && echo OK`
```bash
git add app-tauri/src/or/api.js
git commit -m "feat(api): agent goal/playbook/evolve/ideas wrappers"
```

---

## Task 11: UI — goal fields, strategy panel, idea board

**Files:**
- Modify: `app-tauri/src/or/dynamic.js` (`renderKeywords` goal fields; `renderLearning` strategy panel; idea board in `renderLearning` or `renderCompose`)
- Test: `node --check` + `npm run build`

**Interfaces:**
- Consumes: `api.agentGoalSet`, `api.agentPlaybook`, `api.agentEvolve`, `api.agentIdeas`, `api.agentIdeaDraft`, `api.agentIdeaStatus`.

- [ ] **Step 1: Goal fields in `renderKeywords`** — in the same card that has Product/Voice/Tone, add four inputs (`#kw-objective`, `#kw-audience`, `#kw-winsignal`, `#kw-guardrails`) pre-filled from `a.objective`/`a.audience`/`a.win_signal`/`a.guardrails`, and in the save handler call `await api.agentGoalSet(objective, audience, winSignal, guardrails)` alongside the existing `agentUpdate`.

- [ ] **Step 2: Strategy panel in `renderLearning`** — add a card that calls `api.agentPlaybook()`:
  - render `playbook.winning_angles` (angle · why), `playbook.avoid`, `playbook.next_experiments`, and freshness from `summary`/`created_at`.
  - an **"Evolve now"** button → `api.agentEvolve()` (show spinner; on done `toast(r.summary || 'Evolved')`; reload the panel).
  - empty state: "No strategy yet — set a goal (Agents → Edit) and hit Evolve."
  - use the existing skeleton helpers while loading.

- [ ] **Step 3: Idea board** — add a card (in `renderLearning`) that calls `api.agentIdeas(false)` to list `suggested` ideas; each row shows `title`, `thesis` (truncated), a `source_mix` badge, `goal_fit`, and buttons **"Draft this"** (→ `api.agentIdeaDraft(id)` then `location.hash = "#/compose"`) and **"Dismiss"** (→ `api.agentIdeaStatus(id,"dismissed")`, reload). A **"Suggest ideas"** button → `api.agentIdeas(true)` (spinner; reload).

- [ ] **Step 4: Verify build**

Run: `cd app-tauri && node --check src/or/dynamic.js && npm run build 2>&1 | tail -2`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add app-tauri/src/or/dynamic.js
git commit -m "feat(ui): goal fields + strategy playbook panel + idea board"
```

---

## Task 12: Full verification + restart

- [ ] **Step 1: Run the whole test suite**

Run: `.venv/bin/python -m pytest tests/test_agent_goal.py tests/test_playbook.py tests/test_associations.py tests/test_ideas.py -v`
Expected: all PASS.

- [ ] **Step 2: cargo check + frontend build**

Run: `cd app-tauri/src-tauri && cargo check 2>&1 | tail -3` then `cd app-tauri && npm run build 2>&1 | tail -2` → both succeed.

- [ ] **Step 3: Restart the app** (daemon must reload new Python modules)

Stop the running app, ensure `binaries/gapmap-cli-onedir` exists (dev.sh self-heals), then `cd app-tauri && npm run tauri:dev` in background. Confirm "daemon pre-warmed".

- [ ] **Step 4: Changelog** — add `changelogs/2026-06-28_NN_goal-directed-self-evolving-agents.md` per the repo changelog rule, then commit.

---

## Self-review notes
- Spec §3.1 goal model → Task 1. §3.2 playbook table → Task 2. §4.1 engine → Task 3. §4.2 generation + §4.3 critique → Task 4. §3.3(b)/§4.5 associations → Task 5. §3.3(c)/§4.6 ideas → Task 6. §4.4 triggers → Task 7. §4.8 commands → Tasks 8-10. §4.7 UI → Task 11. §8 tests embedded per task. §7 fail-soft enforced in Global Constraints + every engine fn.
- Phase 2 (engagement metrics) intentionally excluded.
- Implementer caveat flagged in Task 5 (confirm the persona-collection accessor name in `graph.py`).
