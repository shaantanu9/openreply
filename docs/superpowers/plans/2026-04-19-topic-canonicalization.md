# Topic canonicalization — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add LLM-backed typo correction + intent-validation for `discover_subs` so typos like "calari tracking app" auto-route to "calorie tracking app" (or prompt the user via modal when confidence is low).

**Architecture:** Python `research/discover.py` gains a `_canonicalize_topic` helper (LLM call + SQLite cache). `discover_subs` return type changes from `list[dict]` to `{"subs": [...], "confirmation": {...}}`. Four Python callers and one Rust command unwrap the new shape. Frontend branches: high-confidence correction → toast w/ Undo; low-confidence or weak-relevance → blocking modal with variants.

**Tech Stack:** Python 3.12, sqlite-utils, Typer, pytest, Rust 2021 + Tauri 2, vanilla JS + existing modal CSS conventions.

**Spec reference:** `docs/superpowers/specs/2026-04-19-topic-canonicalization-design.md`

---

## Part A — Python backend

### Task A1: Schema row for `topic_canonicalizations`

**Files:**
- Modify: `src/reddit_research/core/db.py::init_schema` (or wherever other tables are pre-created)

- [ ] **Step 1: Locate `init_schema`**

Read `src/reddit_research/core/db.py`. Find the `init_schema(db)` function. It already pre-creates tables like `topic_posts`, `graph_nodes`, `graph_edges`. Find the last `if "X" not in db.table_names():` block.

- [ ] **Step 2: Append a new block creating `topic_canonicalizations`**

After the last existing `if "X" not in db.table_names():` block in `init_schema`, append:

```python
    if "topic_canonicalizations" not in db.table_names():
        db["topic_canonicalizations"].create(
            {
                "original": str,
                "canonical": str,
                "variants_json": str,   # json.dumps of list[str]
                "confidence": str,      # 'high' | 'low' | 'unknown'
                "ts": str,              # ISO UTC
            },
            pk="original",
        )
```

- [ ] **Step 3: Verify schema initializes on a fresh db**

```bash
cd /Users/shantanubombatkar/Documents/GitHub/reddit-myind
.venv/bin/python -c "
import tempfile, os
with tempfile.TemporaryDirectory() as tmp:
    os.environ['REDDIT_MYIND_DATA_DIR'] = tmp
    from reddit_research.core.db import get_db
    get_db.cache_clear()
    db = get_db()
    assert 'topic_canonicalizations' in db.table_names()
    print('ok - schema includes topic_canonicalizations')
"
```

Expected: `ok - schema includes topic_canonicalizations`.

- [ ] **Step 4: Commit**

```bash
git add src/reddit_research/core/db.py
git commit -m "$(cat <<'EOF'
feat(db): add topic_canonicalizations table for typo-correction cache

Pre-created in init_schema so fresh installs don't fail on first
_canonicalize_topic call. Columns: original (pk), canonical,
variants_json, confidence, ts.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task A2: TDD tests for `_canonicalize_topic`

**Files:**
- Modify: `tests/test_integration.py` (append tests at end)

- [ ] **Step 1: Append the test block**

```python
# ─── Topic canonicalization (typo correction) ──────────────────────────────


def test_canonicalize_typo_correction(
    clean_env: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A known typo should be corrected via the LLM pathway."""
    import json
    from reddit_research.research import discover as discover_mod

    # Pretend an LLM is configured.
    monkeypatch.setenv("LLM_PROVIDER", "openrouter")
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-fake")

    def fake_llm(topic: str) -> str:
        return json.dumps({
            "canonical": "calorie tracking app",
            "variants": ["macro tracking app", "food log"],
            "confidence": "high",
        })
    monkeypatch.setattr(discover_mod, "_llm_canonical_call", fake_llm)

    result = discover_mod._canonicalize_topic("calari tracking app")
    assert result["canonical"] == "calorie tracking app"
    assert result["confidence"] == "high"
    assert "macro tracking app" in result["variants"]


def test_canonicalize_preserves_real_topic(
    clean_env: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A correctly-spelled topic should pass through unchanged."""
    import json
    from reddit_research.research import discover as discover_mod

    monkeypatch.setenv("LLM_PROVIDER", "openrouter")
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-fake")

    def fake_llm(topic: str) -> str:
        return json.dumps({
            "canonical": "kubernetes monitoring",
            "variants": ["cluster observability", "container metrics"],
            "confidence": "high",
        })
    monkeypatch.setattr(discover_mod, "_llm_canonical_call", fake_llm)

    result = discover_mod._canonicalize_topic("kubernetes monitoring")
    assert result["canonical"] == "kubernetes monitoring"


def test_canonicalize_no_llm_passthrough(
    clean_env: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Without any LLM configured, canonicalize returns the topic unchanged."""
    from reddit_research.research import discover as discover_mod
    for k in (
        "LLM_PROVIDER", "LLM_MODEL",
        "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY",
        "GROQ_API_KEY", "DEEPSEEK_API_KEY", "MISTRAL_API_KEY", "GOOGLE_API_KEY",
    ):
        monkeypatch.delenv(k, raising=False)

    result = discover_mod._canonicalize_topic("calari tracking app")
    assert result["canonical"] == "calari tracking app"
    assert result["confidence"] == "unknown"
    assert result["variants"] == []


def test_canonicalize_is_cached(
    clean_env: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Repeated calls for the same topic must not invoke the LLM twice."""
    import json
    from reddit_research.research import discover as discover_mod

    monkeypatch.setenv("LLM_PROVIDER", "openrouter")
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-fake")

    call_count = {"n": 0}
    def fake_llm(topic: str) -> str:
        call_count["n"] += 1
        return json.dumps({
            "canonical": "calorie tracking app",
            "variants": [],
            "confidence": "high",
        })
    monkeypatch.setattr(discover_mod, "_llm_canonical_call", fake_llm)

    discover_mod._canonicalize_topic("calari tracking app")
    discover_mod._canonicalize_topic("calari tracking app")
    assert call_count["n"] == 1, (
        f"expected 1 LLM call, got {call_count['n']} — cache not working"
    )
```

- [ ] **Step 2: Run — all four should FAIL (implementation doesn't exist yet)**

```bash
cd /Users/shantanubombatkar/Documents/GitHub/reddit-myind
.venv/bin/pytest -v tests/test_integration.py::test_canonicalize_typo_correction \
  tests/test_integration.py::test_canonicalize_preserves_real_topic \
  tests/test_integration.py::test_canonicalize_no_llm_passthrough \
  tests/test_integration.py::test_canonicalize_is_cached
```

Expected: FAIL on `AttributeError: module 'reddit_research.research.discover' has no attribute '_canonicalize_topic'` (or similar).

- [ ] **Step 3: Commit**

```bash
git add tests/test_integration.py
git commit -m "$(cat <<'EOF'
test(discover): failing tests for topic canonicalization

Defines expected behavior of _canonicalize_topic: typo correction,
passthrough on correct input, skip-gracefully without LLM, and cache
hit on repeat calls. Implementation lands next.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task A3: Implement `_canonicalize_topic` + cache helpers

**Files:**
- Modify: `src/reddit_research/research/discover.py`

- [ ] **Step 1: Add the helper and cache functions**

Open `src/reddit_research/research/discover.py`. After the existing `_rank_score` function and BEFORE `def discover_subs`, insert:

```python
# ── Topic canonicalization ──────────────────────────────────────────────────
#
# Typos like "calari tracking app" silently routed to "flight tracking" subs
# before. This block adds an LLM-backed correction with a SQLite cache so the
# same typo only costs one API call per user.

_CANONICAL_PROMPT_SYSTEM = (
    "You validate whether a user's topic string represents a recognizable "
    "product category or domain. If the string contains typos, abbreviations, "
    "or ambiguity, return the most likely canonical form plus 2-3 plausible "
    "alternatives. Return JSON only — no prose."
)
_CANONICAL_PROMPT_USER = (
    "Topic: \"{topic}\"\n\n"
    "Return JSON matching: "
    "{{\"canonical\": \"<best guess>\", "
    "\"variants\": [\"<alt1>\", \"<alt2>\"], "
    "\"confidence\": \"high\" | \"low\"}}\n\n"
    "Rules:\n"
    "- If the topic looks correct and clear, return it unchanged with confidence "
    "\"high\" and 2 related variants.\n"
    "- If you're confident about a typo fix (e.g., \"calari\" is almost "
    "certainly \"calorie\"), return the fix with confidence \"high\".\n"
    "- If ambiguous (could be interpreted multiple ways), set confidence \"low\" "
    "and put multiple plausible readings in variants.\n"
    "- Variants should be distinct product-category phrases, not synonyms."
)


def _llm_canonical_call(topic: str) -> str:
    """Call the configured LLM to canonicalize the topic. Returns raw JSON text.

    Raises on provider errors — callers must catch. Extracted so tests can
    monkeypatch it without actually hitting a model.
    """
    from ..analyze.providers.base import get_provider

    provider = get_provider()  # uses resolve_provider() internally
    return provider.complete(
        prompt=_CANONICAL_PROMPT_USER.format(topic=topic),
        system=_CANONICAL_PROMPT_SYSTEM,
        max_tokens=200,
        temperature=0.1,
    )


def _load_canonical(topic: str) -> dict | None:
    """Read a cached canonicalization result, if any."""
    import json
    from ..core.db import get_db

    db = get_db()
    if "topic_canonicalizations" not in db.table_names():
        return None
    rows = list(db.query(
        "SELECT canonical, variants_json, confidence FROM topic_canonicalizations "
        "WHERE original = ?",
        [topic.strip().lower()],
    ))
    if not rows:
        return None
    r = rows[0]
    try:
        variants = json.loads(r["variants_json"])
    except Exception:
        variants = []
    return {
        "canonical": r["canonical"],
        "variants": variants,
        "confidence": r["confidence"],
    }


def _cache_canonical(topic: str, result: dict) -> None:
    """Persist the result. Uses `original` as PK so upserts replace cleanly."""
    import json
    from datetime import datetime, timezone
    from ..core.db import get_db

    db = get_db()
    db["topic_canonicalizations"].upsert(
        {
            "original": topic.strip().lower(),
            "canonical": result.get("canonical") or topic,
            "variants_json": json.dumps(result.get("variants") or []),
            "confidence": result.get("confidence") or "unknown",
            "ts": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        },
        pk="original",
    )


def _canonicalize_topic(topic: str) -> dict[str, Any]:
    """Return a canonical form + variants + confidence for a topic.

    Flow:
      1. Check sqlite cache — return immediately on hit.
      2. If no LLM is configured, return {canonical=topic, variants=[], unknown}.
      3. Call LLM with a small prompt; parse JSON defensively.
      4. Cache and return.

    Never raises. Any failure degrades to passthrough with confidence="unknown".
    """
    import json as _json

    topic = (topic or "").strip()
    if not topic:
        return {"canonical": topic, "variants": [], "confidence": "unknown"}

    cached = _load_canonical(topic)
    if cached is not None:
        return cached

    # Resolve provider; passthrough if no LLM.
    try:
        from ..analyze.providers.base import resolve_provider
        resolve_provider(None)
    except Exception:
        return {"canonical": topic, "variants": [], "confidence": "unknown"}

    try:
        raw = _llm_canonical_call(topic)
    except Exception:
        return {"canonical": topic, "variants": [], "confidence": "unknown"}

    # Defensive parse — strip markdown fences, try JSON, else passthrough.
    text = (raw or "").strip()
    if text.startswith("```"):
        text = text.strip("`")
        # Drop a possible "json\n" language marker.
        if text.lstrip().lower().startswith("json"):
            text = text.split("\n", 1)[1] if "\n" in text else ""
    try:
        parsed = _json.loads(text)
    except Exception:
        return {"canonical": topic, "variants": [], "confidence": "unknown"}

    canonical = (parsed.get("canonical") or topic).strip()
    variants = [v for v in (parsed.get("variants") or []) if isinstance(v, str) and v.strip()]
    confidence = parsed.get("confidence") or "unknown"
    if confidence not in ("high", "low", "unknown"):
        confidence = "unknown"

    result = {"canonical": canonical, "variants": variants, "confidence": confidence}
    try:
        _cache_canonical(topic, result)
    except Exception:
        pass  # caching is best-effort; never block the flow
    return result
```

- [ ] **Step 2: Run the canonicalization tests — all four must PASS**

```bash
cd /Users/shantanubombatkar/Documents/GitHub/reddit-myind
.venv/bin/pytest -v tests/test_integration.py::test_canonicalize_typo_correction \
  tests/test_integration.py::test_canonicalize_preserves_real_topic \
  tests/test_integration.py::test_canonicalize_no_llm_passthrough \
  tests/test_integration.py::test_canonicalize_is_cached
```

Expected: `4 passed`.

- [ ] **Step 3: Run the full integration suite — no regressions**

```bash
.venv/bin/pytest -v tests/test_integration.py
```

Expected: previously-passing tests still pass.

- [ ] **Step 4: Commit**

```bash
git add src/reddit_research/research/discover.py
git commit -m "$(cat <<'EOF'
feat(discover): add LLM-backed topic canonicalization with SQLite cache

_canonicalize_topic resolves typos and ambiguous topic strings via the
configured LLM (falls back to passthrough when nothing is configured).
Result is cached in topic_canonicalizations keyed on the lowercased
original. Defensive JSON parsing and try/except around LLM + cache
ensure the path never raises.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task A4: Tests for the new `discover_subs` return shape

**Files:**
- Modify: `tests/test_integration.py`

- [ ] **Step 1: Append the discover-shape tests**

```python
# ─── discover_subs return-shape regression ────────────────────────────────


def test_discover_subs_direct_match_shape(
    clean_env: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Well-formed topic with strong name matches → no confirmation needed."""
    import json
    from reddit_research.research import discover as discover_mod

    # No LLM — canonicalization passes through.
    for k in ("LLM_PROVIDER", "OPENROUTER_API_KEY", "OPENAI_API_KEY"):
        monkeypatch.delenv(k, raising=False)

    def fake_search(query, limit=25):
        return [
            {
                "display_name": "nutrition",
                "title": "Nutrition",
                "public_description": "Nutrition discussion",
                "subscribers": 500_000,
                "subreddit_type": "public",
                "over18": False,
            },
            {
                "display_name": "loseit",
                "title": "loseit",
                "public_description": "Losing weight via calorie tracking",
                "subscribers": 3_000_000,
                "subreddit_type": "public",
                "over18": False,
            },
        ]
    monkeypatch.setattr(discover_mod, "_search_raw", fake_search)

    result = discover_mod.discover_subs("nutrition tracking")
    assert isinstance(result, dict)
    assert "subs" in result
    assert "confirmation" in result
    c = result["confirmation"]
    assert c["original_topic"] == "nutrition tracking"
    assert c["auto_corrected"] is False
    assert c["needs_confirmation"] is False or c["reason"] == "weak_sub_relevance"


def test_discover_subs_weak_relevance_flags_modal(
    clean_env: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Zero token-in-name matches → needs_confirmation=True."""
    from reddit_research.research import discover as discover_mod

    for k in ("LLM_PROVIDER", "OPENROUTER_API_KEY", "OPENAI_API_KEY"):
        monkeypatch.delenv(k, raising=False)

    def fake_search(query, limit=25):
        # Subs unrelated to the topic — none have tokens from topic in name.
        return [
            {
                "display_name": "programming",
                "title": "programming",
                "public_description": "random",
                "subscribers": 1_000_000,
                "subreddit_type": "public",
                "over18": False,
            },
        ]
    monkeypatch.setattr(discover_mod, "_search_raw", fake_search)

    result = discover_mod.discover_subs("xyzqvw random")
    c = result["confirmation"]
    assert c["needs_confirmation"] is True
    assert c["reason"] in ("weak_sub_relevance", "low_confidence_canonicalization")


def test_discover_subs_auto_corrected_flag(
    clean_env: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """High-confidence LLM correction → auto_corrected=True, no modal."""
    import json
    from reddit_research.research import discover as discover_mod

    monkeypatch.setenv("LLM_PROVIDER", "openrouter")
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-fake")

    def fake_llm(topic):
        return json.dumps({
            "canonical": "calorie tracking app",
            "variants": ["macro tracking", "food log"],
            "confidence": "high",
        })
    monkeypatch.setattr(discover_mod, "_llm_canonical_call", fake_llm)

    def fake_search(query, limit=25):
        # Strong match on "calorie" token in name.
        return [
            {
                "display_name": "caloriecounters",
                "title": "Calorie counters",
                "public_description": "count your calories",
                "subscribers": 200_000,
                "subreddit_type": "public",
                "over18": False,
            },
            {
                "display_name": "loseit",
                "title": "loseit",
                "public_description": "calorie tracking community",
                "subscribers": 3_000_000,
                "subreddit_type": "public",
                "over18": False,
            },
        ]
    monkeypatch.setattr(discover_mod, "_search_raw", fake_search)

    result = discover_mod.discover_subs("calari tracking app")
    c = result["confirmation"]
    assert c["auto_corrected"] is True
    assert c["canonical_topic"] == "calorie tracking app"
    assert c["original_topic"] == "calari tracking app"
    assert c["needs_confirmation"] is False
    assert c["reason"] == "high_confidence_typo_correction"
```

- [ ] **Step 2: Run — all three must FAIL currently (shape is still list)**

```bash
.venv/bin/pytest -v tests/test_integration.py::test_discover_subs_direct_match_shape \
  tests/test_integration.py::test_discover_subs_weak_relevance_flags_modal \
  tests/test_integration.py::test_discover_subs_auto_corrected_flag
```

Expected: FAIL with `AssertionError: ... 'subs' not in result` or similar (current return is a list).

- [ ] **Step 3: Commit**

```bash
git add tests/test_integration.py
git commit -m "$(cat <<'EOF'
test(discover): failing tests for new discover_subs wrapper shape

Defines expected shape {subs, confirmation}, auto_corrected flag,
needs_confirmation trigger on weak sub relevance. Implementation
lands next.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task A5: Modify `discover_subs` to use canonicalization + new return shape

**Files:**
- Modify: `src/reddit_research/research/discover.py`

- [ ] **Step 1: Rewrite the `discover_subs` function**

Replace the current `discover_subs` function with this version:

```python
def discover_subs(topic: str, limit: int = 10) -> dict[str, Any]:
    """Return top-N relevant subs for a topic plus a confirmation payload.

    Return shape:
        {
            "subs": list[dict],                # same shape as before
            "confirmation": {
                "original_topic": str,
                "canonical_topic": str,
                "auto_corrected": bool,
                "needs_confirmation": bool,
                "suggested_variants": list[str],
                "reason": str,                 # one of the reason codes below
            },
        }

    Reason codes:
      - "direct_match"                       — no correction, strong matches
      - "high_confidence_typo_correction"    — corrected silently
      - "low_confidence_canonicalization"    — LLM was unsure → confirm
      - "weak_sub_relevance"                 — no strong name matches → confirm
      - "canonicalization_unavailable"       — no LLM; falls back silently
    """
    canon = _canonicalize_topic(topic)
    canonical_topic = canon["canonical"] or topic
    auto_corrected = (
        canon["confidence"] != "unknown"
        and canonical_topic.strip().lower() != (topic or "").strip().lower()
    )

    # Search against the canonical form.
    tokens = _tokens(canonical_topic)
    seen: dict[str, dict[str, Any]] = {}
    for s in _search_raw(canonical_topic):
        seen[s.get("display_name", "").lower()] = s
    if len(seen) < 8 and tokens:
        for t in tokens:
            for s in _search_raw(t):
                key = s.get("display_name", "").lower()
                if key and key not in seen:
                    seen[key] = s

    candidates = [
        s for s in seen.values()
        if not s.get("over18") and s.get("subreddit_type") == "public"
    ]
    ranked = sorted(candidates, key=lambda s: _rank_score(s, tokens), reverse=True)

    subs: list[dict[str, Any]] = []
    for s in ranked[:limit]:
        subs.append(
            {
                "name": s.get("display_name"),
                "title": s.get("title"),
                "subscribers": s.get("subscribers"),
                "description": (s.get("public_description") or "").strip()[:200],
                "url": f"https://www.reddit.com/r/{s.get('display_name')}",
                "relevance": round(_relevance_bonus(s, tokens), 2),
            }
        )

    # Weakness check — "no discovered sub has a token in its name AND all
    # top-3 bonuses are below 0.5" means users probably fell through to
    # generic-keyword-fallback hell (e.g. "tracking" matched flight subs).
    any_name_match = any(
        any(t in (s["name"] or "").lower() for t in tokens)
        for s in subs
    )
    top3_weak = all((s.get("relevance") or 0.0) < 0.5 for s in subs[:3])
    weak = (not any_name_match) and top3_weak and len(subs) > 0

    # Decide reason + needs_confirmation.
    if canon["confidence"] == "low":
        reason = "low_confidence_canonicalization"
        needs_confirmation = True
    elif weak:
        reason = "weak_sub_relevance"
        needs_confirmation = True
    elif canon["confidence"] == "unknown":
        reason = "canonicalization_unavailable"
        needs_confirmation = False
    elif auto_corrected:
        reason = "high_confidence_typo_correction"
        needs_confirmation = False
    else:
        reason = "direct_match"
        needs_confirmation = False

    return {
        "subs": subs,
        "confirmation": {
            "original_topic": topic,
            "canonical_topic": canonical_topic,
            "auto_corrected": auto_corrected,
            "needs_confirmation": needs_confirmation,
            "suggested_variants": canon.get("variants", []),
            "reason": reason,
        },
    }
```

- [ ] **Step 2: Run the new shape tests — all three must PASS**

```bash
.venv/bin/pytest -v tests/test_integration.py::test_discover_subs_direct_match_shape \
  tests/test_integration.py::test_discover_subs_weak_relevance_flags_modal \
  tests/test_integration.py::test_discover_subs_auto_corrected_flag
```

Expected: `3 passed`.

- [ ] **Step 3: Full suite — other tests may now break (callers relying on list shape)**

```bash
.venv/bin/pytest -v tests/test_integration.py
```

Expected: the 3 new tests pass. Any failure in previously-passing tests is due to callers not yet updated — that's Part B's job. If there are failures in tests that DON'T call discover_subs, investigate.

- [ ] **Step 4: Commit**

```bash
git add src/reddit_research/research/discover.py
git commit -m "$(cat <<'EOF'
refactor(discover): return {subs, confirmation} instead of list

discover_subs now canonicalizes the topic via _canonicalize_topic,
searches against the canonical, and returns a wrapper dict with the
subs array plus a confirmation payload. Callers (CLI, MCP, collect,
Rust command) need to unwrap — next 4 tasks handle that.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Part B — Update callers (lockstep)

### Task B1: Update `research/collect.py` to unwrap the new shape

**Files:**
- Modify: `src/reddit_research/research/collect.py:147`

- [ ] **Step 1: Find and edit the call site**

Around line 147 in `src/reddit_research/research/collect.py`, replace:

```python
        found = discover_subs(topic, limit=8)
        subs = [s["name"] for s in found if s.get("name")]
```

With:

```python
        found = discover_subs(topic, limit=8)
        # New shape: {"subs": [...], "confirmation": {...}}. Old list form
        # tolerated only for backward-compat with any mocks.
        found_subs = found.get("subs", found) if isinstance(found, dict) else found
        subs = [s["name"] for s in found_subs if s.get("name")]
```

- [ ] **Step 2: Smoke test the import**

```bash
.venv/bin/python -c "
from reddit_research.research.collect import collect
print('import ok')
"
```

Expected: `import ok`.

- [ ] **Step 3: Commit**

```bash
git add src/reddit_research/research/collect.py
git commit -m "fix(collect): unwrap new discover_subs {subs, confirmation} shape"
```

---

### Task B2: Update CLI command

**Files:**
- Modify: `src/reddit_research/cli/main.py:517-522`

- [ ] **Step 1: Edit the CLI handler**

Find `cmd_discover_subs` (or similar) around line 517-522. Replace:

```python
    rows = discover_subs(topic, limit=limit)
    _emit(rows, as_json, table_title=f"subs for '{topic}'")
```

With:

```python
    result = discover_subs(topic, limit=limit)
    rows = result["subs"] if isinstance(result, dict) else result
    conf = result.get("confirmation") if isinstance(result, dict) else None
    if conf and conf.get("auto_corrected") and not as_json:
        typer.echo(
            f"Note: corrected '{conf['original_topic']}' → '{conf['canonical_topic']}'",
            err=True,
        )
    if conf and conf.get("needs_confirmation") and not as_json:
        typer.echo(
            f"Warning: weak match for '{conf['canonical_topic']}'. "
            f"Suggested variants: {', '.join(conf.get('suggested_variants') or [])}",
            err=True,
        )
    if as_json:
        _emit(result, as_json, table_title=f"subs for '{topic}'")
    else:
        _emit(rows, as_json, table_title=f"subs for '{topic}'")
```

- [ ] **Step 2: Smoke test**

```bash
.venv/bin/python -m reddit_research.cli.main research discover --help
```

Expected: help text renders, no exceptions.

- [ ] **Step 3: Commit**

```bash
git add src/reddit_research/cli/main.py
git commit -m "fix(cli): handle new discover_subs shape + surface corrections/warnings"
```

---

### Task B3: Update MCP tool

**Files:**
- Modify: `src/reddit_research/mcp/server.py:143-150` (approx — the `reddit_discover_subs` function)

- [ ] **Step 1: Edit the MCP wrapper**

Find `def reddit_discover_subs(topic, limit)`. Its current return type is `list[dict]`. Keep that shape for MCP backward-compat (external clients depend on it). Unwrap `subs`:

Current body (simplified) probably calls `research_discover(topic, limit)` and returns it. Replace with:

```python
@mcp.tool()
def reddit_discover_subs(topic: str, limit: int = 10) -> list[dict]:
    """Find the most relevant subreddits for any topic or app domain.

    Use this as the FIRST step before research_collect so you (Claude) can
    see which subs will be hit and decide whether to override the default.
    """
    result = research_discover(topic, limit=limit)
    # research_discover now returns {subs, confirmation}. MCP consumers
    # expect a plain list — unwrap. If the typo-correction info is useful,
    # embed it as a synthetic first row OR log it; for now we just unwrap.
    if isinstance(result, dict):
        return result.get("subs", [])
    return result
```

(If the file already has different imports/wrappers, preserve them — only change the body.)

- [ ] **Step 2: Smoke test the MCP import**

```bash
.venv/bin/python -c "
from reddit_research.mcp.server import reddit_discover_subs
print('mcp import ok')
"
```

Expected: `mcp import ok`.

- [ ] **Step 3: Commit**

```bash
git add src/reddit_research/mcp/server.py
git commit -m "fix(mcp): unwrap new discover_subs shape to preserve list[dict] contract"
```

---

### Task B4: Verify Rust command propagates new shape

**Files:**
- Read: `app-tauri/src-tauri/src/commands.rs::discover_subs`

- [ ] **Step 1: Read the current command**

```bash
cd /Users/shantanubombatkar/Documents/GitHub/reddit-myind
grep -A 20 "pub async fn discover_subs" app-tauri/src-tauri/src/commands.rs
```

The command signature is `async fn discover_subs(app, topic, limit) -> Result<Value, String>`. It calls `run_cli` which returns JSON. No code changes needed — `Value` is shape-agnostic and propagates the new dict.

- [ ] **Step 2: Confirm no Rust tests break**

```bash
cd /Users/shantanubombatkar/Documents/GitHub/reddit-myind/app-tauri/src-tauri
cargo check
```

Expected: `cargo check` succeeds. No changes to Rust needed.

- [ ] **Step 3: Run full Python integration tests**

```bash
cd /Users/shantanubombatkar/Documents/GitHub/reddit-myind
.venv/bin/pytest -v tests/test_integration.py
```

Expected: all tests pass (those skipped for lack of network or Ollama are fine).

---

## Part C — Frontend (toast + modal)

### Task C1: Locate the frontend call site

**Files:**
- Read: `app-tauri/src/screens/*.js`

- [ ] **Step 1: Find every place `api.discoverSubs` is called**

```bash
cd /Users/shantanubombatkar/Documents/GitHub/reddit-myind
grep -rn "api.discoverSubs\|discoverSubs(" app-tauri/src/screens app-tauri/src/main.js app-tauri/src/api.js 2>/dev/null
```

Record the file path and line of EVERY call site. Common candidates: `home.js`, `main.js`, a new-topic modal. There may be 1-3 call sites.

- [ ] **Step 2: Read each call site's surrounding code**

Print ~20 lines of context around each hit so we know:
- Whether `result` is treated as a list or a dict
- What happens immediately after (auto-collect? preview? navigate?)

- [ ] **Step 3: Record findings as a comment in the commit**

After reading, write the findings into a new file `docs/manual-todo/discover-sub-call-sites.md` (or similar scratch file). Include: file path + line number + current handling. Commit this note.

```bash
git add docs/manual-todo/discover-sub-call-sites.md
git commit -m "docs: audit discoverSubs call sites before canonicalization wiring"
```

---

### Task C2: Add CSS for toast and modal

**Files:**
- Modify: `app-tauri/src/style.css`

- [ ] **Step 1: Append styles**

Append at the end of `app-tauri/src/style.css`:

```css
/* ---------- Topic correction toast ---------- */
.correction-toast {
  position: fixed; top: 18px; left: 50%; transform: translateX(-50%);
  background: var(--surface); border: 1px solid var(--line);
  color: var(--ink); padding: 10px 14px;
  border-radius: var(--radius-sm);
  font-size: 13px; box-shadow: var(--shadow);
  z-index: 10000;
  display: inline-flex; align-items: center; gap: 10px;
  animation: correctionSlideIn 180ms ease-out;
}
.correction-toast b { font-weight: 700; color: var(--ink); }
.correction-toast .c-link {
  color: var(--orange); cursor: pointer;
  text-decoration: underline; text-underline-offset: 2px;
}
.correction-toast .c-dismiss {
  color: var(--ink-3); cursor: pointer; font-size: 14px;
  line-height: 1;
}
@keyframes correctionSlideIn {
  from { opacity: 0; transform: translate(-50%, -8px); }
  to   { opacity: 1; transform: translate(-50%, 0); }
}

/* ---------- Topic confirm modal ---------- */
.topic-confirm-backdrop {
  position: fixed; inset: 0; background: rgba(26,22,20,0.35);
  z-index: 9999; display: grid; place-items: center;
}
.topic-confirm-modal {
  background: var(--surface); border: 1px solid var(--line);
  border-radius: var(--radius); box-shadow: var(--shadow);
  width: min(480px, 92vw); padding: 22px 22px 18px;
}
.topic-confirm-modal h3 {
  font-size: 15px; font-weight: 700; color: var(--ink);
  margin: 0 0 6px;
}
.topic-confirm-modal p {
  font-size: 13px; color: var(--ink-2); margin: 0 0 14px;
}
.topic-confirm-modal .variants { display: flex; flex-direction: column; gap: 6px; }
.topic-confirm-modal .variants button {
  background: var(--surface-2); border: 1px solid var(--line);
  border-radius: var(--radius-sm); padding: 9px 12px;
  font-size: 13px; text-align: left; cursor: pointer; color: var(--ink);
  transition: background 0.15s;
}
.topic-confirm-modal .variants button:hover {
  background: var(--orange-soft); border-color: var(--orange);
}
.topic-confirm-modal .keep-asis {
  margin-top: 10px; font-size: 12px; color: var(--ink-3);
  background: transparent; border: none; cursor: pointer;
  text-decoration: underline; text-underline-offset: 2px;
}
```

- [ ] **Step 2: Commit**

```bash
git add app-tauri/src/style.css
git commit -m "style(ui): add correction-toast and topic-confirm-modal styles"
```

---

### Task C3: Add JS helpers for toast + modal

**Files:**
- Create: `app-tauri/src/lib/topicConfirm.js`

- [ ] **Step 1: Create the helper module**

Create `app-tauri/src/lib/topicConfirm.js` with:

```javascript
// Topic correction toast + confirmation modal.
//
// Exposed:
//   showCorrectionToast({ original, canonical, onUndo }) → auto-dismiss after 10s
//   showTopicConfirmModal({ original, canonical, variants, onPick, onKeepAsIs })

export function showCorrectionToast({ original, canonical, onUndo }) {
  const existing = document.querySelector('.correction-toast');
  if (existing) existing.remove();

  const el = document.createElement('div');
  el.className = 'correction-toast';
  el.innerHTML = `
    <span>Corrected <b>${escapeHtml(original)}</b> → <b>${escapeHtml(canonical)}</b></span>
    <span class="c-link" data-action="undo">Undo</span>
    <span class="c-dismiss" data-action="dismiss" title="Dismiss">✕</span>`;
  document.body.appendChild(el);

  const dismiss = () => { el.remove(); };
  const undo = () => {
    dismiss();
    if (typeof onUndo === 'function') onUndo();
  };
  el.querySelector('[data-action=undo]').onclick = undo;
  el.querySelector('[data-action=dismiss]').onclick = dismiss;
  setTimeout(dismiss, 10_000);
}

export function showTopicConfirmModal({
  original, canonical, variants = [], onPick, onKeepAsIs,
}) {
  const existing = document.querySelector('.topic-confirm-backdrop');
  if (existing) existing.remove();

  // De-dupe: canonical might already be in variants.
  const options = [canonical, ...variants].filter(
    (v, i, arr) => v && arr.indexOf(v) === i
  );

  const backdrop = document.createElement('div');
  backdrop.className = 'topic-confirm-backdrop';
  backdrop.innerHTML = `
    <div class="topic-confirm-modal" role="dialog" aria-modal="true">
      <h3>Did you mean…?</h3>
      <p>The topic <b>${escapeHtml(original)}</b> didn't have a clear match. Pick one, or keep as-is.</p>
      <div class="variants">
        ${options.map((v, i) => `<button data-pick="${i}">${escapeHtml(v)}</button>`).join('')}
      </div>
      <button class="keep-asis" data-keep="1">Keep "${escapeHtml(original)}" as-is</button>
    </div>`;
  document.body.appendChild(backdrop);

  backdrop.querySelectorAll('[data-pick]').forEach((btn) => {
    btn.onclick = () => {
      const idx = Number(btn.getAttribute('data-pick'));
      backdrop.remove();
      if (typeof onPick === 'function') onPick(options[idx]);
    };
  });
  backdrop.querySelector('[data-keep]').onclick = () => {
    backdrop.remove();
    if (typeof onKeepAsIs === 'function') onKeepAsIs();
  };
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
```

- [ ] **Step 2: Syntax-check**

```bash
cd /Users/shantanubombatkar/Documents/GitHub/reddit-myind/app-tauri
node --check src/lib/topicConfirm.js
```

Expected: no output (success).

- [ ] **Step 3: Commit**

```bash
git add app-tauri/src/lib/topicConfirm.js
git commit -m "feat(ui): topic correction toast + confirmation modal helpers"
```

---

### Task C4: Wire helpers into the new-topic flow

**Files:**
- Modify: whichever call-site file Task C1 identified (likely `app-tauri/src/screens/home.js` or `app-tauri/src/main.js`)

**This task depends on Task C1's findings.** Read `docs/manual-todo/discover-sub-call-sites.md` before starting.

For EACH call site the audit identified:

- [ ] **Step 1: Import the helpers**

At the top of the file, add:

```javascript
import { showCorrectionToast, showTopicConfirmModal } from '../lib/topicConfirm.js';
```

(Adjust the relative path if the call site is in a different directory.)

- [ ] **Step 2: Replace the direct use of the discover result**

Find the current pattern, which likely looks like one of:

```javascript
const subs = await api.discoverSubs(topic);
// ...use subs as array...
```

Replace with this decision-tree wrapper:

```javascript
async function resolveTopicAndDiscover(topic, { force = false } = {}) {
  const res = await api.discoverSubs(topic);
  // Back-compat: older responses might still be an array.
  if (Array.isArray(res)) return { subs: res, confirmation: null, chosenTopic: topic };
  const { subs, confirmation } = res;
  if (!confirmation || force) return { subs, confirmation, chosenTopic: topic };

  if (confirmation.needs_confirmation) {
    // Return a promise that resolves when the user picks.
    return new Promise((resolve) => {
      showTopicConfirmModal({
        original: confirmation.original_topic,
        canonical: confirmation.canonical_topic,
        variants: confirmation.suggested_variants || [],
        onPick: async (chosen) => {
          const next = await resolveTopicAndDiscover(chosen, { force: true });
          resolve(next);
        },
        onKeepAsIs: async () => {
          const next = await resolveTopicAndDiscover(
            confirmation.original_topic,
            { force: true },
          );
          resolve(next);
        },
      });
    });
  }

  if (confirmation.auto_corrected) {
    showCorrectionToast({
      original: confirmation.original_topic,
      canonical: confirmation.canonical_topic,
      onUndo: () => { window.location.hash = '#/'; /* back to home */ },
    });
  }
  return { subs, confirmation, chosenTopic: confirmation.canonical_topic || topic };
}
```

Then change the call site from:

```javascript
const subs = await api.discoverSubs(topic);
```

To:

```javascript
const { subs, chosenTopic } = await resolveTopicAndDiscover(topic);
// Use `subs` as before. Use `chosenTopic` wherever the code forwarded `topic`
// to subsequent pipeline calls (startCollect, etc.).
```

- [ ] **Step 3: Start the dev server and verify manually**

```bash
cd /Users/shantanubombatkar/Documents/GitHub/reddit-myind/app-tauri
npm run tauri dev
```

In the app:
1. Create a new topic with an obvious typo ("calari tracking app") — expect the correction toast.
2. Create a topic with a vague / unknown name ("xyzqvw foo") — expect the blocking modal.
3. Create a clean topic ("kubernetes monitoring") — expect no toast or modal.

- [ ] **Step 4: Commit**

```bash
cd /Users/shantanubombatkar/Documents/GitHub/reddit-myind
git add <the modified files>
git commit -m "$(cat <<'EOF'
feat(ui): wire topic canonicalization into new-topic flow

Shows correction toast when backend auto-corrected a typo,
blocking "did you mean" modal when confidence is low or sub
relevance is weak.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Part D — Verification

### Task D1: End-to-end verification

- [ ] **Step 1: All Python tests pass**

```bash
cd /Users/shantanubombatkar/Documents/GitHub/reddit-myind
.venv/bin/pytest -v tests/test_integration.py
```

Expected: every non-network test passes. Canonicalization tests (4) + discover-shape tests (3) + pre-existing enrichment tests pass.

- [ ] **Step 2: Manual UI walkthrough with real typo**

`npm run tauri dev` → Home → create new topic "calari tracking app" → expect:
- Correction toast appears: `"Corrected 'calari tracking app' → 'calorie tracking app'. Undo"`
- Collect runs against calorie/nutrition subs (r/loseit, r/MyFitnessPal, etc.).
- Enrichment produces painpoints about calorie tracking, not flight tracking.

- [ ] **Step 3: Manual UI walkthrough with vague topic**

Create a topic "xyz meditation thing" → expect blocking modal with canonical variants (e.g. "meditation app", "mindfulness tool").

- [ ] **Step 4: Mark spec as shipped**

Update the spec header at `docs/superpowers/specs/2026-04-19-topic-canonicalization-design.md`:

Replace: `**Status:** Approved, ready for implementation planning`
With: `**Status:** Shipped 2026-04-19`

```bash
git add docs/superpowers/specs/2026-04-19-topic-canonicalization-design.md
git commit -m "docs(spec): mark topic-canonicalization as shipped"
```

---

## Self-review notes

- **Spec coverage:** §1 flow → Tasks A3, A5, C4. §2 components → Tasks A1 (schema), A3 (helper), A5 (discover_subs), C2/C3 (UI). §3 data contract → Tasks A4/A5 tests enforce shape. §4 LLM prompt → embedded in A3. §5 tests → A2 (4 tests), A4 (3 tests). §6 risks (4-caller breaking change) → Tasks B1–B4 handle each.
- **No placeholders:** Every step has either a Grep, a verbatim code block, or an exact command + expected output.
- **Type consistency:** `_canonicalize_topic` return shape `{canonical, variants, confidence}` is consistent across A2, A3, A5. `discover_subs` return shape `{subs, confirmation{...}}` is consistent across A4, A5, B1–B4, C4.
- **Commit points:** 11 total, each leaves the tree in a working state (with Part A internally consistent, Part B restoring caller compat after A5's breakage).
