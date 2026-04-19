# Topic canonicalization & intent-validation — design

**Date:** 2026-04-19
**Status:** Approved, ready for implementation planning
**Scope:** `discover_subs` pipeline — typo correction + weak-discovery detection

## Goal

Prevent the "wrong-corpus" failure mode where a typo or ambiguous topic silently routes through to unrelated subreddits. Concrete trigger: user typed "calari tracking app" (meant "calorie"), pipeline fetched aviation subreddits (flight tracking), enrichment produced painpoints about airplane diversions instead of nutrition tracking.

Ship **A + B (hybrid confidence routing)** as agreed during brainstorming:

- **A — Typo correction**: LLM-backed canonicalization of the topic string before search runs.
- **B — Intent validation**: when canonicalization confidence is low OR discovered subs are weakly relevant, surface a "did you mean X?" confirmation modal before the user commits to a collect.

## Non-goals (explicitly out of scope)

- Multi-language typo correction.
- Persistent per-user canonicalization preferences.
- Offline dictionary or spell-checker fallback.
- Domain-specific term libraries.
- Automatic re-run of discovery on undo — undo just navigates the user back to the topic input.

---

## 1. Flow

```
User types "calari tracking app"
  ↓ discover_subs(topic)  (Python)
  ↓ _canonicalize_topic(topic)
      → check sqlite cache
      → if miss, LLM call (cheap model, ~100 tok each way)
      → result: {canonical, variants[], confidence}
      → write cache
  ↓ search uses canonical string (or raw if confidence="unknown" / no LLM)
  ↓ weakness check:
      needs_confirmation = (canonical_confidence == "low")
                        OR (no discovered sub has a token from canonical in its name
                            AND top-3 subs all have relevance_bonus < 0.5)
  ↓ return payload carries:
      { subs, confirmation: { auto_corrected, needs_confirmation,
                              original_topic, canonical_topic, variants,
                              reason } }
  ↓ Rust commands.rs::discover_subs propagates payload unchanged.
  ↓ Frontend (new-topic flow) branches:
      • auto_corrected AND NOT needs_confirmation
          → toast banner at top: "Corrected 'X' → 'Y'. Undo"
          → clicking Undo navigates back to topic input with original text.
      • needs_confirmation
          → blocking modal: "Did you mean?" lists canonical + variants +
            a "Keep 'X' as-is" option. User picks one.
          → re-runs discover with the chosen option (skipping
            canonicalization for "as-is").
```

---

## 2. Components

### 2.1 Python — `src/reddit_research/research/discover.py`

**New function:** `_canonicalize_topic(topic: str, provider: str | None = None) -> dict`

Returns:
```python
{
  "canonical": str,      # best-guess canonical form of the topic
  "variants": list[str], # 2-3 plausible alternatives (may include the canonical)
  "confidence": "high" | "low" | "unknown",
}
```

Behavior:
- If no LLM is resolvable (same `resolve_provider()` path as elsewhere), return `{"canonical": topic, "variants": [], "confidence": "unknown"}` — passes through unchanged. The pipeline still works, just without typo correction.
- LLM call uses the prompt below. Small temperature (0.1), max_tokens 200.
- JSON-parse the response defensively. On parse failure, return `{"canonical": topic, "variants": [], "confidence": "unknown"}`.
- After a successful call, persist in cache via `_cache_canonical(original, result)`.

**New helpers:**
- `_load_canonical(topic: str) -> dict | None` — reads the `topic_canonicalizations` table.
- `_cache_canonical(topic: str, result: dict) -> None` — writes/upserts into it.

**Schema (created lazily in `core/db.py::init_schema`):**
```sql
CREATE TABLE IF NOT EXISTS topic_canonicalizations (
  original TEXT PRIMARY KEY,
  canonical TEXT NOT NULL,
  variants_json TEXT NOT NULL,     -- json.dumps of list[str]
  confidence TEXT NOT NULL,        -- 'high' | 'low' | 'unknown'
  ts TEXT NOT NULL                 -- ISO UTC when written
);
```

**Modified:** `discover_subs(topic: str, limit: int = 10) -> dict`

Breaking change: the return type changes from `list[dict]` to a wrapper dict. Shape:
```python
{
  "subs": [ ... existing list items ... ],
  "confirmation": {
    "original_topic": str,
    "canonical_topic": str,
    "auto_corrected": bool,       # True iff canonical != original AND confidence != "unknown"
    "needs_confirmation": bool,
    "suggested_variants": list[str],
    "reason": str,                # "high_confidence_typo_correction"
                                  #  | "low_confidence_canonicalization"
                                  #  | "weak_sub_relevance"
                                  #  | "canonicalization_unavailable"
                                  #  | "direct_match" (nothing to confirm)
  },
}
```

Internal changes:
- Canonicalize first.
- Use `canonical_topic` as the search string.
- After ranking, compute `needs_confirmation` per the flow above.
- `auto_corrected = (canonical != original) and (confidence != "unknown")`.

### 2.2 Rust — `src-tauri/src/commands.rs::discover_subs`

Propagate the new dict shape unchanged. The existing signature is `async fn discover_subs(app, topic, limit) -> Result<Value, String>` — it already returns `serde_json::Value`, so no code change is required beyond confirming the payload flows through intact.

### 2.3 Frontend — the new-topic flow

Location depends on current code — either `app-tauri/src/screens/home.js` or a "new topic" button handler.

Changes:
- After `api.discoverSubs(topic)`, unwrap the new shape: pull both `subs` and `confirmation`.
- Decision tree:
  ```
  if confirmation.needs_confirmation:
    openTopicConfirmModal({
      original, canonical, variants,
      onPick: (chosen) => rerunWith(chosen),
      onKeepAsIs: () => rerunWith(original, forceNoCanonical=true),
    })
  elif confirmation.auto_corrected:
    showToastBanner(`Corrected "${original}" → "${canonical}". Undo`)
    proceed with `canonical` through to collect.
  else:
    proceed silently.
  ```
- The confirm modal is a new UI component, visually consistent with the BYOK modal (same container, same buttons, same animation).
- The toast banner is new: small top-of-content pill with the corrected text and an "Undo" link. Auto-dismisses after 10s OR on user click.

### 2.4 Caching

Cache is the single `topic_canonicalizations` SQLite table. Primary key is the raw lowercased topic. No TTL — a typo correction is stable; revisiting the same topic hits cache.

Cache invalidation: explicit only. If the user wants to force re-canonicalization (e.g., LLM improved), they can delete the row via the Database tab. We do NOT auto-invalidate.

---

## 3. Data contract — full example

Input (user types "calari tracking app"):

```json
{
  "subs": [ /* 8-10 sub dicts, same shape as today */ ],
  "confirmation": {
    "original_topic": "calari tracking app",
    "canonical_topic": "calorie tracking app",
    "auto_corrected": true,
    "needs_confirmation": false,
    "suggested_variants": ["calorie tracking app", "macro tracking app", "food log"],
    "reason": "high_confidence_typo_correction"
  }
}
```

Input (user types "something vague"):

```json
{
  "subs": [ /* weak matches */ ],
  "confirmation": {
    "original_topic": "something vague",
    "canonical_topic": "something vague",
    "auto_corrected": false,
    "needs_confirmation": true,
    "suggested_variants": ["meditation app", "habit tracker", "personal journal"],
    "reason": "weak_sub_relevance"
  }
}
```

Input (LLM not configured):

```json
{
  "subs": [ /* same as before the change */ ],
  "confirmation": {
    "original_topic": "kubernetes monitoring",
    "canonical_topic": "kubernetes monitoring",
    "auto_corrected": false,
    "needs_confirmation": false,
    "suggested_variants": [],
    "reason": "canonicalization_unavailable"
  }
}
```

---

## 4. LLM prompt

Kept small. Runs against whichever provider `resolve_provider()` returns.

```
SYSTEM:
You validate whether a user's topic string represents a recognizable product
category or domain. If the string contains typos, abbreviations, or
ambiguity, return the most likely canonical form plus 2-3 plausible
alternatives. Return JSON only — no prose.

USER:
Topic: "{topic}"

Return JSON matching:
{"canonical": "<best guess>", "variants": ["<alt1>", "<alt2>"], "confidence": "high" | "low"}

Rules:
- If the topic looks correct and clear, return it unchanged with confidence "high"
  and 2 related variants.
- If you're confident about a typo fix (e.g., "calari" is almost certainly
  "calorie"), return the fix with confidence "high".
- If ambiguous (could be interpreted multiple ways), set confidence "low" and
  put multiple plausible readings in variants.
- Variants should be distinct product-category phrases, not synonyms of the
  same thing.
```

Parameters: `temperature=0.1`, `max_tokens=200`.

---

## 5. Testing

All tests live in `tests/test_integration.py`, appended to the existing file.

1. `test_canonicalize_typo_correction` — mock LLM to return `{canonical: "calorie tracking app", confidence: "high"}` for input `"calari tracking app"`. Assert `_canonicalize_topic()` returns that shape.
2. `test_canonicalize_preserves_real_topic` — mock LLM to return `{canonical: "kubernetes monitoring", confidence: "high"}` unchanged. Assert passthrough.
3. `test_canonicalize_no_llm_passthrough` — clear all LLM env vars. Assert `_canonicalize_topic()` returns `{canonical: <original>, variants: [], confidence: "unknown"}` without raising.
4. `test_canonicalize_is_cached` — first call invokes mock LLM; second call (same topic) does NOT. Verify via a call-counter on the mock.
5. `test_discover_subs_marks_weak_relevance` — feed `discover_subs` a topic where the mocked search returns subs with zero name matches. Assert `confirmation.needs_confirmation == True` and `reason == "weak_sub_relevance"`.
6. `test_discover_subs_marks_auto_corrected` — mock LLM to correct "calari" → "calorie" AND mocked search to return strong name matches. Assert `auto_corrected == True` and `needs_confirmation == False` and `reason == "high_confidence_typo_correction"`.

Mocking: use `monkeypatch.setattr` on `_canonicalize_topic` helpers and on `_search_raw`. No network.

---

## 6. Risks & unknowns

- **LLM response drift.** A bad JSON response could break the pipeline. Mitigated by the "on parse failure, passthrough" rule in §2.1.
- **Latency.** Adding an LLM call adds ~1s to first-discover for a new topic. Cache eliminates it on repeat. Acceptable for MVP.
- **Cost.** ~300 tokens per first-ever discovery, ~$0.0001 with a cheap model. Negligible.
- **Schema migration.** The new `topic_canonicalizations` table must be created in `init_schema()` — same pattern as the existing tables. Existing databases get it on next startup without user action.
- **Modal UI discovery.** The frontend change depends on finding the current new-topic flow. If it's embedded in multiple places, the scope grows. Plan step-1 will audit.
- **Breaking change to `discover_subs` callers.** Four callers depend on the current `list[dict]` return shape: `cli/main.py:508-510`, `mcp/server.py:143` (`reddit_discover_subs`), `research/collect.py:147`, `src-tauri/src/commands.rs::discover_subs`. Each must be updated to unwrap `result["subs"]` (or handle the new dict). The plan must include a task that updates all four callers in lockstep with the `discover_subs` signature change. Failing to do so silently breaks the CLI and MCP integration paths.

---

## 7. Acceptance criteria

- [ ] Typing a known typo ("calari tracking app") transparently corrects to "calorie tracking app" with a dismissible toast. The collect that follows gathers calorie/nutrition-related subs.
- [ ] Typing a vague or unknown string triggers a blocking modal with 2-3 suggested variants plus "Keep as-is" option before collect runs.
- [ ] When no LLM is configured, the pipeline works exactly as it does today — no regression.
- [ ] Second lookup of the same typo hits the SQLite cache instead of re-calling the LLM.
- [ ] All 6 new tests pass.
- [ ] No breaking change to the Rust command signature or the Tauri capabilities.
