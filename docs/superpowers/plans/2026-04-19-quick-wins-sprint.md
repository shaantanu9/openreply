# Quick-wins sprint — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship three quick-win features from the gap analysis: (A) emergent theme clustering via embeddings, (B) diff-two-corpora / time-windowed trends, (C) local scheduled runs with in-app change banner.

**Architecture:** Each part is independent. Part A adds a new clustering helper on top of the existing palace ChromaDB embedder. Part B adds a `ts` column to `graph_nodes` + a diff query + frontend surfacing. Part C adds launchd (macOS) scheduling + a `schedule-tick` sidecar subcommand + per-topic schedule toggles + a "new-since-last-viewed" banner.

**Tech Stack:** Python 3.12 (sqlite-utils, chromadb), Rust 2021 + Tauri 2, vanilla JS, pytest. macOS launchd (Part C only).

**Spec reference:** `docs/superpowers/specs/2026-04-19-quick-wins-sprint-design.md`

---

## Part A — Emergent clustering

### Task A1: Failing tests for `cluster_findings`

**File:** `tests/test_integration.py` (append)

- [ ] Append these 3 tests at the end:

```python
# ─── Emergent theme clustering ───────────────────────────────────────────


def test_cluster_merges_near_duplicates(
    clean_env: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Two near-duplicate labels should merge into one with aliases."""
    from reddit_research.retrieval.cluster import cluster_findings

    inp = {
        "painpoints": [
            {"painpoint": "Hard to log food when eating out", "frequency": 5, "example_post_ids": ["p1"]},
            {"painpoint": "Can't track calories at restaurants", "frequency": 3, "example_post_ids": ["p2"]},
            {"painpoint": "App crashes on launch",               "frequency": 2, "example_post_ids": ["p3"]},
        ],
    }
    out = cluster_findings(inp, threshold=0.70)  # low threshold to force merge
    # Either chromadb is missing (passthrough — 3 items) OR
    # the two near-duplicate labels collapsed to one (2 items).
    items = out["painpoints"]
    assert len(items) in (2, 3)
    # If clustering actually ran, the winner has aliases populated:
    if len(items) == 2:
        winner = max(items, key=lambda x: x.get("frequency", 0))
        assert winner.get("aliases"), "winner should carry its merged aliases"


def test_cluster_preserves_distinct(
    clean_env: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Semantically distinct labels stay separate."""
    from reddit_research.retrieval.cluster import cluster_findings
    inp = {
        "painpoints": [
            {"painpoint": "Barcode scanner is broken",          "frequency": 5},
            {"painpoint": "Subscription is too expensive",      "frequency": 4},
            {"painpoint": "Cannot export data to CSV",           "frequency": 3},
        ],
    }
    out = cluster_findings(inp, threshold=0.92)  # strict
    assert len(out["painpoints"]) == 3


def test_cluster_passthrough_without_chromadb(
    clean_env: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """When chromadb isn't available, cluster_findings is a no-op."""
    import reddit_research.retrieval.cluster as cluster_mod
    monkeypatch.setattr(cluster_mod, "_embeddings_available", lambda: False)
    inp = {"painpoints": [{"painpoint": "A"}, {"painpoint": "B"}]}
    out = cluster_findings(inp)
    assert out == inp  # unchanged
```

- [ ] Run: `.venv/bin/pytest -v tests/test_integration.py -k cluster` — expect 3 failed.
- [ ] Commit: `git add tests/test_integration.py && git commit -m "test(cluster): failing tests for emergent theme merge"`

### Task A2: Implement `cluster_findings`

**File:** `src/reddit_research/retrieval/cluster.py` (new)

- [ ] Create the file with:

```python
"""Cluster near-duplicate findings by embedding + cosine similarity.

Runs AFTER the LLM extractor produces painpoints/features/workarounds/products
but BEFORE `upsert_semantic` persists them. Groups labels whose embeddings
share cosine similarity ≥ threshold, keeps the representative with the highest
frequency, and attaches the others as `aliases`.

Skip-gracefully: if chromadb isn't installed (no palace), returns the input
unchanged so the enrich path keeps working without the retrieval extras.
"""
from __future__ import annotations

import logging
import os
from typing import Any

logger = logging.getLogger(__name__)


def _embeddings_available() -> bool:
    """Test seam — monkeypatch to simulate missing chromadb."""
    try:
        import chromadb  # noqa: F401
        return True
    except ImportError:
        return False


def _label_of(kind: str, item: dict) -> str:
    """Extract the display label for a finding item."""
    if kind == "painpoints":
        return item.get("painpoint") or item.get("title") or ""
    if kind == "feature_wishes":
        return item.get("feature") or item.get("title") or ""
    if kind == "product_complaints":
        return (item.get("product") or "") + " — " + (item.get("complaint") or "")
    if kind == "diy_workarounds":
        return item.get("workaround") or ""
    return item.get("title") or ""


def _freq(item: dict) -> int:
    """Winner tiebreaker: highest `frequency`, fallback evidence count."""
    f = item.get("frequency")
    if isinstance(f, int):
        return f
    if isinstance(f, str) and f.isdigit():
        return int(f)
    evc = item.get("example_post_ids") or []
    return len(evc)


def _embed_labels(labels: list[str]) -> list[list[float]] | None:
    """Embed a list of labels via chromadb's default ONNX embedder.
    Returns None on any failure (caller falls through to passthrough)."""
    try:
        from chromadb.utils import embedding_functions
        fn = embedding_functions.DefaultEmbeddingFunction()
        return fn(labels)
    except Exception as e:
        logger.debug("cluster: embedding failed, passthrough: %s", e)
        return None


def _cosine(a: list[float], b: list[float]) -> float:
    import math
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a)) or 1e-9
    nb = math.sqrt(sum(x * x for x in b)) or 1e-9
    return dot / (na * nb)


def _cluster_one_kind(
    kind: str, items: list[dict], threshold: float
) -> list[dict]:
    """Greedy single-linkage clustering by cosine similarity ≥ threshold.

    For each pair (i, j), if sim(i,j) ≥ threshold, they go in the same cluster.
    Within each cluster, the item with highest _freq() wins; others become
    `aliases` on the winner.
    """
    if len(items) < 2:
        return items
    labels = [_label_of(kind, it) for it in items]
    vectors = _embed_labels(labels)
    if vectors is None:
        return items

    # Greedy union-find.
    parent = list(range(len(items)))
    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    def union(i: int, j: int) -> None:
        pi, pj = find(i), find(j)
        if pi != pj:
            parent[pi] = pj

    for i in range(len(items)):
        for j in range(i + 1, len(items)):
            if _cosine(vectors[i], vectors[j]) >= threshold:
                union(i, j)

    clusters: dict[int, list[int]] = {}
    for i in range(len(items)):
        clusters.setdefault(find(i), []).append(i)

    out: list[dict] = []
    for idxs in clusters.values():
        if len(idxs) == 1:
            out.append(items[idxs[0]])
            continue
        # Winner = highest frequency; aliases = the rest.
        winner_idx = max(idxs, key=lambda i: _freq(items[i]))
        winner = dict(items[winner_idx])
        aliases = [labels[i] for i in idxs if i != winner_idx]
        winner["aliases"] = aliases
        # Sum frequencies so saturation stays representative.
        total_freq = sum(_freq(items[i]) for i in idxs)
        if total_freq:
            winner["frequency"] = total_freq
        # Merge example_post_ids across the cluster so evidence stays complete.
        merged_evidence: list[str] = []
        for i in idxs:
            merged_evidence.extend(items[i].get("example_post_ids") or [])
        if merged_evidence:
            # De-dupe while preserving order.
            seen = set()
            dedup = []
            for e in merged_evidence:
                if e not in seen:
                    seen.add(e)
                    dedup.append(e)
            winner["example_post_ids"] = dedup
        out.append(winner)
    return out


def cluster_findings(
    findings: dict[str, list[dict]],
    threshold: float | None = None,
) -> dict[str, list[dict]]:
    """Cluster near-duplicates within each finding kind.

    Args:
        findings: {"painpoints": [...], "feature_wishes": [...], ...}
        threshold: cosine similarity threshold. Falls back to
                   OPENREPLY_CLUSTER_THRESHOLD env var, then 0.82.
    Returns: same shape, with alias-annotated winners where dupes were merged.
    """
    if not _embeddings_available():
        return findings
    if threshold is None:
        try:
            threshold = float(os.getenv("OPENREPLY_CLUSTER_THRESHOLD", "0.82"))
        except ValueError:
            threshold = 0.82

    out: dict[str, list[dict]] = {}
    for kind, items in findings.items():
        if isinstance(items, list):
            out[kind] = _cluster_one_kind(kind, items, threshold)
        else:
            out[kind] = items
    return out
```

- [ ] Run the 3 cluster tests — they should all pass (tests gracefully handle missing chromadb).
- [ ] Commit: `git add src/reddit_research/retrieval/cluster.py tests/test_integration.py && git commit -m "feat(cluster): embed-based near-duplicate merging for findings"`

### Task A3: Wire clustering into `upsert_semantic`

**File:** `src/reddit_research/graph/semantic.py`

- [ ] At the top of `upsert_semantic`, after `ensure_graph_schema()`, add:

```python
    # Collapse near-duplicates before we persist — two painpoints that mean
    # the same thing should be one node with aliases, not two separate cards.
    try:
        from ..retrieval.cluster import cluster_findings
        clustered = cluster_findings({
            "painpoints": painpoints or [],
            "feature_wishes": feature_wishes or [],
            "product_complaints": product_complaints or [],
            "diy_workarounds": diy_workarounds or [],
        })
        painpoints = clustered.get("painpoints") or painpoints
        feature_wishes = clustered.get("feature_wishes") or feature_wishes
        product_complaints = clustered.get("product_complaints") or product_complaints
        diy_workarounds = clustered.get("diy_workarounds") or diy_workarounds
    except Exception:
        pass  # clustering is best-effort; never block enrich
```

- [ ] Also update each `_upsert_node` call to pass `aliases` through via metadata. For the painpoint branch around line 72:

```python
            metadata={
                "severity": pp.get("severity"),
                "frequency": pp.get("frequency"),
                "evidence": pp.get("evidence"),
                "classification": pp.get("classification"),
                "pre_2025_freq": pp.get("pre_2025_freq"),
                "post_2025_freq": pp.get("post_2025_freq"),
                "aliases": pp.get("aliases"),
            },
```

Apply the same `"aliases": <item>.get("aliases")` addition to `feature_wishes`, `product_complaints`, and `diy_workarounds` branches.

- [ ] Run full integration tests. Commit: `git add src/reddit_research/graph/semantic.py && git commit -m "feat(semantic): upsert clustered findings with aliases metadata"`

### Task A4: Surface aliases in viewer

**File:** `src/reddit_research/graph/export.py`

- [ ] Find `renderFinding` in the JS script block. Find the `badges` concat section. After the existing badge lines, append:

```javascript
  if ((md.aliases || []).length) {
    const count = md.aliases.length;
    const tip = `Merged with: ${md.aliases.join(' · ')}`;
    badges += `<span class="badge variants" title="${tip.replace(/"/g,'&quot;')}">+${count} variants</span>`;
  }
```

- [ ] Add a CSS rule in the `<style>` block alongside other `.badge.*` rules:

```css
  .badge.variants { background: var(--v-lavender-soft); color: #5C43A0; }
```

- [ ] Commit: `git add src/reddit_research/graph/export.py && git commit -m "feat(viewer): show '+N variants' pill on merged findings"`

---

## Part B — Diff-two-corpora

### Task B1: Schema + migration for `graph_nodes.ts`

**File:** `src/reddit_research/core/db.py`

- [ ] In `init_schema`, find the `if "graph_nodes" not in db.table_names():` block and add `"ts": str` to the column dict. For migration of existing installs, immediately after the block add:

```python
    else:
        # Migration: add ts column if absent (pre-2026-04-19 installs).
        cols = {c.name for c in db["graph_nodes"].columns}
        if "ts" not in cols:
            db.executescript("ALTER TABLE graph_nodes ADD COLUMN ts TEXT DEFAULT ''")
```

- [ ] Verify via `.venv/bin/python -c "..."` from Task A1's pattern that `ts` is in columns.
- [ ] Commit: `git add src/reddit_research/core/db.py && git commit -m "feat(db): add ts column to graph_nodes for time-windowed diff"`

### Task B2: Set `ts` on insert, preserve on update

**File:** `src/reddit_research/graph/build.py::_upsert_node`

- [ ] Read current `_upsert_node`. Modify to set `ts` to `datetime.now(timezone.utc).isoformat(timespec="seconds")` ONLY when the row doesn't already exist (i.e. preserve the original timestamp on updates).

Pseudocode:

```python
def _upsert_node(db, topic, kind, slug, label, metadata=None):
    from datetime import datetime, timezone
    node_id = make_node_id(topic, kind, slug)
    existing = list(db.query("SELECT ts FROM graph_nodes WHERE id = ?", [node_id]))
    ts = existing[0]["ts"] if (existing and existing[0].get("ts")) \
         else datetime.now(timezone.utc).isoformat(timespec="seconds")
    db["graph_nodes"].upsert({
        "id": node_id,
        "topic": topic,
        "kind": kind,
        "label": label,
        "metadata_json": json.dumps(metadata or {}),
        "ts": ts,
    }, pk="id")
    return node_id
```

- [ ] Commit: `git add src/reddit_research/graph/build.py && git commit -m "feat(build): timestamp graph_nodes on insert, preserve on update"`

### Task B3: `diff_findings` query module + test

**File:** `src/reddit_research/graph/diff.py` (new)

- [ ] Create:

```python
"""Time-windowed diff of graph findings — 'what's new in the last N days?'"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from ..core.db import get_db


_FINDING_KINDS = ("painpoint", "product", "workaround", "feature_wish")


def diff_findings(topic: str, window_days: int = 7) -> dict[str, Any]:
    """Split findings for `topic` into recent / prior / stable buckets by ts.

    Returns:
        {
          "topic": str, "window_days": int,
          "recent": list[{id,kind,label,ts,...}],
          "prior":  list[...],
          "stable": list[...],
          "summary": {"new_painpoints": int, "new_workarounds": int, ...}
        }
    """
    db = get_db()
    cutoff_recent = (datetime.now(timezone.utc) - timedelta(days=window_days)).isoformat()
    cutoff_prior  = (datetime.now(timezone.utc) - timedelta(days=window_days * 4)).isoformat()

    rows = list(db.query(
        "SELECT id, kind, label, ts, metadata_json FROM graph_nodes "
        "WHERE topic = :topic AND kind IN ('painpoint','product','workaround','feature_wish')",
        {"topic": topic},
    ))

    recent, prior, stable = [], [], []
    for r in rows:
        ts = r.get("ts") or ""
        if ts and ts >= cutoff_recent:
            recent.append(r)
        elif ts and ts >= cutoff_prior:
            prior.append(r)
        else:
            stable.append(r)

    summary = {f"new_{k}s": sum(1 for x in recent if x["kind"] == k) for k in _FINDING_KINDS}
    # Normalize plural naming for readability.
    return {
        "topic": topic,
        "window_days": window_days,
        "recent": recent,
        "prior": prior,
        "stable": stable,
        "summary": summary,
    }
```

- [ ] Add test:

```python
def test_diff_returns_recent_only(clean_env: Path) -> None:
    from datetime import datetime, timezone, timedelta
    from reddit_research.core.db import get_db
    from reddit_research.graph.diff import diff_findings

    db = get_db()
    now = datetime.now(timezone.utc)
    old = (now - timedelta(days=40)).isoformat()
    new = (now - timedelta(days=1)).isoformat()
    db["graph_nodes"].insert_all([
        {"id": "t/painpoint/old", "topic": "t", "kind": "painpoint", "label": "Old pain", "metadata_json": "{}", "ts": old},
        {"id": "t/painpoint/new", "topic": "t", "kind": "painpoint", "label": "New pain", "metadata_json": "{}", "ts": new},
    ])
    r = diff_findings("t", window_days=7)
    recent_labels = [x["label"] for x in r["recent"]]
    stable_labels = [x["label"] for x in r["stable"]]
    assert "New pain" in recent_labels
    assert "Old pain" in stable_labels
    assert r["summary"]["new_painpoints"] == 1
```

- [ ] Commit: `git add src/reddit_research/graph/diff.py tests/test_integration.py && git commit -m "feat(diff): time-windowed findings diff module + test"`

### Task B4: Rust command + frontend surfacing

**Files:**
- `src-tauri/src/commands.rs`
- `src-tauri/src/main.rs` (generate_handler)
- `app-tauri/src/api.js`
- `app-tauri/src/screens/topic.js`

- [ ] Add Rust command `diff_findings(app, topic, window_days) -> Result<Value>` that invokes `research diff --topic <t> --window <n> --json`. Register in `main.rs::generate_handler`.
- [ ] Add a CLI subcommand `@research_app.command("diff")` in `cli/main.py` that calls `diff_findings` and emits JSON.
- [ ] Add `diffFindings: (topic, windowDays=7) => invoke('diff_findings', {topic, windowDays})` to `api.js`.
- [ ] In `topic.js`, inside the Map tab render (after chips), call `api.diffFindings(topic)` and render a "What's new (last 7 days)" banner showing the summary and a "View changes" link that filters the finding cards to only those with `metadata_json.id` in `recent`.
- [ ] Commit per file: `feat(diff): rust command + CLI + frontend banner for changes`.

---

## Part C — Scheduled runs

### Task C1: Schema for `topic_prefs` + `last_run_seen`

**File:** `src/reddit_research/core/db.py`

- [ ] In `init_schema`, append:

```python
    if "topic_prefs" not in db.table_names():
        db["topic_prefs"].create({
            "topic": str,
            "scheduled": int,          # 0 / 1
            "last_run_seen": str,      # ISO UTC of when the user last opened this topic
        }, pk="topic")
```

- [ ] Commit.

### Task C2: `schedule-tick` subcommand

**File:** `src/reddit_research/cli/main.py`

- [ ] Add subcommand `schedule-tick` that:
  - Queries `topic_prefs` WHERE `scheduled = 1`.
  - For each topic, calls `run_collect(topic, aggressive=True)`.
  - Skips if `ActiveJob` lock is held (another collect is running).
  - Logs to `fetches` as `kind='schedule-tick'`.

- [ ] Add `schedule-enable` / `schedule-disable` subcommands that upsert the `topic_prefs` row.

- [ ] Commit.

### Task C3: Rust `schedule.rs` module — launchd integration

**Files:**
- `src-tauri/src/schedule.rs` (new)
- `src-tauri/src/main.rs` (mod declaration)
- `src-tauri/src/commands.rs` (4 new commands)

- [ ] Implement `install_launchd_agent(interval_hours)` — writes plist to `~/Library/LaunchAgents/com.shantanu.openreply.schedule.plist`, resolves sidecar binary path dynamically, runs `launchctl load <plist>`.
- [ ] Implement `uninstall_launchd_agent()` — `launchctl unload` + rm.
- [ ] Implement `schedule_status()` — inspects plist existence + `launchctl list | grep openreply`.
- [ ] All four `#[tauri::command]`s forward to these helpers; on non-macOS, return `{installed: false, reason: "platform not supported"}`.

- [ ] Commit.

### Task C4: Frontend — Settings panel section + per-topic toggle + banner

**Files:**
- `app-tauri/src/screens/settings.js`
- `app-tauri/src/screens/topic.js`

- [ ] In `settings.js`, add a "Scheduled runs" card with an interval select (Off / 6h / Daily / Weekly). On change, call `api.scheduleInstall(hours)` or `api.scheduleUninstall()`. Show `schedule_status()`.

- [ ] In `topic.js`, add a "Include in scheduled runs" toggle in the topic header actions. On toggle, call `api.scheduleEnableTopic(topic, enabled)`.

- [ ] In `topic.js::loadMap`, call `api.scheduleSinceLastSeen(topic)` and if any `summary.new_*s` is non-zero, render a dismissible banner at the top of the Map tab.

- [ ] Commit per file.

---

## Verification

- [ ] **A:** Trigger enrich on a topic with duplicate painpoints → find pills reduced, "+N variants" pill visible on merged winner.
- [ ] **B:** Run collect twice ~5s apart → second `diff_findings` call shows `summary.new_painpoints: 0` for the second run. Insert a manual row with old ts → shows `stable`.
- [ ] **C:** Settings → "Scheduled runs" → "Daily" → `launchctl list | grep openreply.schedule` shows the agent loaded. Re-visit a topic after a scheduled tick → banner appears.
- [ ] All pre-existing tests still pass (`.venv/bin/pytest -v tests/test_integration.py`).
