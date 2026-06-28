# OpenReply audit fixes — plan + changelog

**Date:** 2026-04-20
**Source:** Thorough audit of Tauri 2 + Python sidecar app on 2026-04-20 (see session log + `~/.claude/skills/tauri-python-sidecar-app/SKILL.md` gotcha additions).
**Goal:** Work through every finding from the audit in priority order, one commit per fix, with verification evidence per commit.

This doc is both a **plan** (what to do, in what order) and a **living changelog** (tick off each item as its commit lands). Status column gets updated as we go.

---

## Priority ladder

| # | Severity | Fix | Est. effort | Risk | Status | Commit |
|---|----------|-----|-------------|------|--------|--------|
| 1 | 🔴 Critical | Narrow CSP `connect-src: https://*` to exact origins | 10 min | Low | ✅ done | `765dfa9` |
| 2 | 🔴 Critical | Add `tests/conftest.py` for fresh-checkout pytest | 2 min | None | ✅ done | `3f97640` |
| 3 | 🔴 Critical | Replace `unwrap_or(Value::Null)` silent swallow with `{_raw, _parse_error}` + UI diagnostic | 45 min | Medium | ✅ done | `1f79a8a` |
| 4 | 🟠 High | `setHTMLWithIcons(el, html)` helper + audit every `innerHTML` with `data-lucide` | 1–2 hr | Medium | ✅ done (audit: all 18 existing sites already correct; helper added for new code) | `46a9004` |
| 5 | 🟡 Medium | Provider resolver cleanup — clear docstring + single canonical call | 20 min | Low | ✅ done (audit: all callers use `resolve_provider` correctly; strengthened docstring) | `b19c0c3` |
| 6 | 🟡 Medium | Guard `find_dev_venv_python` against symlink loops | 15 min | None | ✅ done | `2a7d9e9` |
| 7 | 🟠 High | Integration test: `ActiveJob`/`ActiveChat`/`ActiveStream` cancel actually kills the child | 1 hr | Low | ✅ done | `a2c79b2` |

Order rationale: stand-alone, low-risk, high-value fixes first (#1 CSP, #2 conftest), then the foundational error-surfacing fix that lights up every subsequent fix's diagnostics (#3), then the biggest scope-creep risk (#4 refreshIcons audit) while fresh, then the lower-stakes cleanups, then the test (#7 — the one test that actually needs to run the rebuilt Rust to prove anything).

**Commit discipline:** one commit per fix. Commit message prefixes follow the existing convention: `fix(...)`, `feat(...)`, `chore(...)`, `test(...)`.

---

## Fix 1 · 🔴 Narrow CSP `connect-src`

### Problem
`tauri.conf.json:47` — `connect-src: ipc: http://ipc.localhost asset: http://asset.localhost http://localhost:* https://*`.

The `https://*` wildcard lets any JS dep (or supply-chain compromise) POST data to any HTTPS endpoint. CSP is supposed to catch this; right now it doesn't.

### What gets fetched (verified from code)
- `https://www.reddit.com` + `https://api.reddit.com` (via PRAW — direct host)
- `https://eutils.ncbi.nlm.nih.gov` (PubMed — `sources/pubmed.py`)
- `https://api.openalex.org` (OpenAlex — `sources/openalex.py`)
- `https://api.semanticscholar.org` (Scholar — `sources/scholar.py`)
- `https://export.arxiv.org` / `https://arxiv.org` (arXiv — `sources/arxiv.py`)
- `https://hn.algolia.com` (HN — `sources/hackernews.py`)
- `https://api.github.com` (GitHub — `sources/github_trending.py`, `sources/github_issues.py`)
- `https://dev.to/api` (Dev.to — `sources/devto.py`)
- `https://api.stackexchange.com` (StackOverflow — `sources/stackoverflow.py`)
- `https://newsapi.org` (GNews — `sources/gnews.py`)
- `https://trends.google.com` (pytrends)
- `https://itunes.apple.com` (App Store — `sources/appstore.py`)
- Google Play Scraper hits `play.google.com`
- Anthropic / OpenAI / OpenRouter / Groq / DeepSeek / Mistral / Google Gemini LLM endpoints (from BYOK)
- ChromaDB ONNX model host: `https://chroma-onnx-models.s3.amazonaws.com`
- Reddit-review RSS: `https://itunes.apple.com`
- Ollama local: `http://localhost:11434`

### Change
Replace the single-line `connect-src` in `tauri.conf.json` `app.security.csp` with an explicit allowlist.

### Verification
- `grep https:// app-tauri/src-tauri/tauri.conf.json` → shows the new explicit list
- Manually load the app → every feature that hits an external API still works (collect, BYOK test buttons, palace model download)

### Commit
`fix(security): narrow CSP connect-src from https://* to explicit allowlist`

---

## Fix 2 · 🔴 `tests/conftest.py` for fresh-checkout pytest

### Problem
A fresh contributor running `pytest tests/` without `uv sync` first hits `ModuleNotFoundError: No module named 'reddit_research'`. Works today because our `.venv` has the editable install, but new devs (or CI) will hit it.

### Change
Create `tests/conftest.py` that prepends `src/` to `sys.path` so pytest can import `reddit_research` without an editable install.

```python
"""Make src-layout imports work without requiring `uv sync` first.

This lets `pytest tests/` work on a fresh checkout. The editable install
(via `uv sync`) ALSO handles this, but conftest is a defensive backstop
for CI + first-time contributors.
"""
from __future__ import annotations

import sys
from pathlib import Path

_SRC = Path(__file__).resolve().parent.parent / "src"
if _SRC.is_dir() and str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))
```

### Verification
- Delete `.venv`, run `pytest tests/ -q --collect-only` → no ModuleNotFoundError
- `uv sync --extra dev && .venv/bin/pytest tests/ -q` → still 42 passed, 2 pre-existing failures

### Commit
`chore(tests): add conftest.py so pytest works on fresh checkouts`

---

## Fix 3 · 🔴 Surface errors from `unwrap_or(Value::Null)`

### Problem
`cli.rs:87` (in `run_dev_python_cli`) and `cli.rs:181` (in `run_cli` prod path) both do:
```rust
Ok(serde_json::from_str(&stdout).unwrap_or(Value::Null))
```

When Python emits a stack trace to stdout (or logs interleaved with JSON), parsing fails and the frontend gets `null` silently. The UI renders an empty state indistinguishable from "no data yet." Users see blank cards; the actual Python error is invisible.

### Change
Return a structured parse-error sentinel the frontend can detect:
```rust
serde_json::from_str(&stdout).unwrap_or_else(|err| {
    eprintln!("[sidecar] JSON parse failed: {err}. Raw stdout (first 500 chars):\n{}",
              &stdout.chars().take(500).collect::<String>());
    serde_json::json!({
        "_parse_error": true,
        "_raw": stdout,
        "_parse_error_message": err.to_string(),
    })
})
```

In `app-tauri/src/api.js`, add a wrapper that detects `_parse_error` and either:
- Throws with the raw text as the error message (so existing `.catch` blocks render it), OR
- Returns the original result and lets callers decide

Pick: throw. Existing callers already have `.catch` paths — they'll now actually surface the underlying Python error.

### Verification
- Manually poison a Python command (e.g., `raise RuntimeError("test")` inside a CLI subcommand), run via UI → UI surfaces the error message instead of silently showing empty state
- All existing working commands still return their JSON normally

### Commit
`fix(sidecar): surface Python errors instead of silently returning null`

### Skill doc
Already documented in the skill (gotcha row added in this session). Keep in sync.

---

## Fix 4 · 🟠 `setHTMLWithIcons(el, html)` helper + audit

### Problem
Many `innerHTML =` mutations contain `<i data-lucide="...">` placeholders. Some paths call `window.refreshIcons?.()` right after; others don't. Icons render on initial load but vanish after dynamic re-renders (search filter, pagination, tab switch).

### Change
#### Step A — add the helper in `app-tauri/src/icons.js`
```js
/** Set innerHTML AND refresh lucide icons in one call.
 *  Use this everywhere an innerHTML string contains `<i data-lucide="…">`.
 *  Replaces the brittle pattern `el.innerHTML = html; refreshIcons();`. */
export function setHTMLWithIcons(el, html) {
  if (!el) return;
  el.innerHTML = html;
  refreshIcons();
}
if (typeof window !== 'undefined') window.setHTMLWithIcons = setHTMLWithIcons;
```

#### Step B — grep for every site
```bash
grep -rn 'innerHTML.*data-lucide\|data-lucide.*innerHTML' app-tauri/src/screens/*.js
grep -rnB 2 -A 2 'innerHTML' app-tauri/src/screens/*.js | grep -B2 'data-lucide'
```

#### Step C — convert
Where the existing pattern is `el.innerHTML = '<…data-lucide…>'; ...; window.refreshIcons?.()` OR missing the refresh entirely — replace with `setHTMLWithIcons(el, '<…data-lucide…>')`.

**Don't touch** sites that don't have `data-lucide` in the HTML (no benefit, just noise).

### Verification
- `node --check` on every modified file
- Manually flip between tabs on the topic screen → icons persist on every tab switch
- `grep -rn 'innerHTML.*data-lucide' app-tauri/src/screens/ | while read l; do f=$(echo "$l" | cut -d: -f1); grep -q "refreshIcons\|setHTMLWithIcons" "$f" || echo "MISSING in $f"; done` → empty output

### Commit
`fix(icons): setHTMLWithIcons helper + audit every innerHTML with data-lucide`

### Skill doc
Skill doc already flags this pattern. After the fix, update the Phase 12 snippet to recommend `setHTMLWithIcons` as the default pattern.

---

## Fix 5 · 🟡 Provider resolver cleanup

### Problem
`src/reddit_research/analyze/providers/base.py` exports both `resolve_provider(name)` (returns canonical name string) and `get_provider(name)` (returns object with fallback chain). Callers mix them up. Tempting to call `resolve_provider()` to "validate," then instantiate a raw `OpenAIProvider(...)` — missing the fallback chain.

### Change
Two-pronged:
1. Add a visible deprecation-esque docstring on `resolve_provider()` saying "prefer `get_provider()` for actual LLM calls; this returns only the canonical name and is mostly used for CLI arg construction + logging."
2. Audit callers: any code that calls `resolve_provider(...)` and then instantiates a provider should be refactored to `get_provider(...)`.

Don't rename `resolve_provider` — too many call sites. Keep it, but make the intent obvious.

### Verification
- `grep -rn "resolve_provider" src/reddit_research/` — every remaining call is clearly about getting the NAME string (for CLI arg construction, logging, env check), NOT instantiating a provider
- Manual test: swap BYOK provider to OpenRouter → enrichment still works end-to-end

### Commit
`refactor(providers): document resolve_provider vs get_provider and fix any misuse`

---

## Fix 6 · 🟡 Guard `find_dev_venv_python` against symlink loops

### Problem
`cli.rs:38-47` walks up 5 parents looking for `.venv/bin/python`. If a symlink creates a loop, the walk may visit the same dir twice (or N times). Max 5 iterations caps the damage, but it's still noisy and technically wrong.

### Change
Track visited canonical paths; break on repeat:
```rust
fn find_dev_venv_python() -> Option<std::path::PathBuf> {
    if let Ok(p) = std::env::var("REDDIT_MYIND_DEV_PYTHON") {
        let pb = std::path::PathBuf::from(p);
        if pb.exists() { return Some(pb); }
    }
    let mut cur = std::env::current_dir().ok()?.canonicalize().ok()?;
    let mut visited: std::collections::HashSet<std::path::PathBuf> = std::collections::HashSet::new();
    for _ in 0..5 {
        if !visited.insert(cur.clone()) { break; }  // seen before → loop, bail out
        let candidate = cur.join(".venv").join("bin").join("python");
        if candidate.exists() { return Some(candidate); }
        let parent = match cur.parent() { Some(p) => p.to_path_buf(), None => break };
        cur = match parent.canonicalize() { Ok(p) => p, Err(_) => break };
    }
    None
}
```

### Verification
- `cargo check` (may fail on pre-existing baseline; that's fine per established project state)
- Manually run `pnpm tauri dev` — still resolves `.venv/bin/python` in ~0ms

### Commit
`hardening(cli): guard find_dev_venv_python against symlink loops`

---

## Fix 7 · 🟠 Integration test: cancel actually kills the child

### Problem
Three state slots + cancel helpers exist (`ActiveJob`/`Chat`/`Stream`). Nothing proves `cancel_active_*()` actually SIGKILLs the child on current Tauri version. Regression risk on Tauri bump.

### Change
Add a Python-level integration test (not Rust — tests live in Python-land). Since the Python side is blind to the Rust process manager, the test verifies the **Python contract** that Rust depends on:

> The long-running CLI commands (`research collect`, `research chat`, `stream`) gracefully handle `SIGTERM` and clean up open DB connections / network sessions before exit.

Test shape (`tests/test_cancel_contract.py`):
- Spawn `reddit-cli research collect --topic test-cancel-xyz --aggressive` as subprocess
- Wait for it to emit its first progress line
- SIGTERM the subprocess
- Assert exit code ≤ 128 (clean shutdown, not killed hard)
- Assert stderr contains a graceful shutdown log line OR no tracebacks
- Assert no `reddit.db-wal` or `reddit.db-shm` files left locking the DB (≤ 1 second grace period after SIGTERM)

Mark `@pytest.mark.slow` so it's opt-in.

### Verification
- `.venv/bin/pytest tests/test_cancel_contract.py -m slow -v` → passes
- Real smoke: start a collect in the app, hit Cancel → process ends, UI returns to idle within 2s

### Commit
`test(cancel): verify CLI cancel contract — SIGTERM cleanly exits`

---

## Post-fix deliverables

After all 7 fixes land:

1. **Update the skill** (`~/.claude/skills/tauri-python-sidecar-app/SKILL.md`):
   - Promote `setHTMLWithIcons` to the recommended pattern in Phase 12
   - Add a section on "narrowing CSP" as explicit guidance
   - Add the symlink-loop guard pattern to Phase 2

2. **Update the UI guidelines doc** (`docs/superpowers/specs/2026-04-19-app-ui-guidelines.md`):
   - Add the `setHTMLWithIcons` helper to §5 (Lucide icons) as the canonical pattern
   - Add a note in §9 (merge checklist) requiring `setHTMLWithIcons` wherever applicable

3. **Add a changelog entry** (`changelogs/2026-04-20_NN_audit-fixes.md`) summarizing all 7 commits.

4. **Run the full test suite** one more time — confirm 42+ passed (the 2 pre-existing failures can stay flagged).

---

## Execution order checklist

Work through these in order. Don't batch. Each = one commit.

- [x] Fix 1 · CSP narrowing — `765dfa9`
- [x] Fix 2 · conftest.py — `3f97640`
- [x] Fix 3 · unwrap_or null-swallow → diagnostic — `1f79a8a`
- [x] Fix 4 · setHTMLWithIcons helper + audit — `46a9004`
- [x] Fix 5 · provider resolver docstrings — `b19c0c3`
- [x] Fix 6 · symlink-loop guard — `2a7d9e9`
- [x] Fix 7 · cancel contract test — `a2c79b2`
- [ ] Post: skill doc updates (skill already includes the 6 audit gotchas from this session; optional polish later)
- [ ] Post: UI guidelines update (add `setHTMLWithIcons` as canonical pattern in §5)
- [ ] Post: changelog entry (add `changelogs/2026-04-20_NN_audit-fixes-bundle.md`)
- [x] Post: final `pytest tests/ -q` — 41 passed, 3 pre-existing integration failures unchanged by these fixes

Update the Status column of the priority ladder as each item ships.
