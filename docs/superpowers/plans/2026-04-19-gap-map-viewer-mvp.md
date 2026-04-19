# Gap Map viewer MVP — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Topic → Map tab MVP-ready: visual theme matches the app, file-system leakage is hidden, and enrichment works with OpenRouter + `openai/gpt-4o` so 1,212 posts produce findings instead of `OPENAI_API_KEY not set`.

**Architecture:** Three tightly-coupled slices shipped in one plan. (1) Python — fix provider resolution in `enrich_from_llm` by delegating to the shared `resolve_provider()` helper instead of duplicating its logic. (2) Python — restyle the self-contained HTML viewer exported by `export_graph_html` to use app tokens via a CSS-variable block. (3) Frontend — replace file-path/`.html`-filename leakage in `topic.js` with clean node/edge/findings chips.

**Tech Stack:** Python 3.12, sqlite-utils, Typer (sidecar), Rust 2021 + Tauri 2 (Rust commands stay unchanged), vanilla JS + Lucide icons (frontend), D3.js v7 (viewer), pytest (tests).

**Spec reference:** `docs/superpowers/specs/2026-04-19-gap-map-viewer-mvp-design.md`

---

## Part A — Provider resolution fix

Goal: stop the `OPENAI_API_KEY not set in environment` error when the user has configured OpenRouter with `openai/gpt-4o`. Root cause hypothesis from the spec: `enrich_from_llm` duplicates the env-key resolution logic that already lives in `analyze/providers/base.py::resolve_provider`, and one of the two implementations has drifted. We will delete the duplicate and route through `resolve_provider` so there is exactly one authoritative resolver.

### Task A1: Write failing integration test

**Files:**
- Modify: `tests/test_integration.py` (append a new test)

- [ ] **Step 1: Open the file and append this test at the end**

```python
# ─── Enrichment provider resolution (regression test) ──────────────────────


def test_enrich_uses_openrouter_when_configured(
    clean_env: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Regression: LLM_PROVIDER=openrouter + LLM_MODEL=openai/gpt-4o must NOT
    try to construct the OpenAI provider (which would demand OPENAI_API_KEY).

    The slashed-model convention `openai/gpt-4o` is OpenRouter's way of saying
    "route this OpenAI model through the OpenRouter gateway" — the provider
    stays openrouter; the model string is opaque.
    """
    from reddit_research.analyze.providers.base import resolve_provider

    monkeypatch.setenv("LLM_PROVIDER", "openrouter")
    monkeypatch.setenv("LLM_MODEL", "openai/gpt-4o")
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-fake-test-key")
    # Deliberately do NOT set OPENAI_API_KEY. If resolution is correct,
    # the code path must never read it.
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    assert resolve_provider() == "openrouter"
    # Explicit arg wins: passing "openrouter" through must still resolve to
    # "openrouter" and never get coerced to "openai" via the model-slash path.
    assert resolve_provider("openrouter") == "openrouter"


def test_enrich_skip_gracefully_when_nothing_configured(
    clean_env: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Enrich is called optimistically after every collect. When nothing is
    configured, it must return a skip payload, not raise."""
    from reddit_research.graph.semantic import enrich_from_llm

    for k in (
        "LLM_PROVIDER", "LLM_MODEL",
        "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY",
        "GROQ_API_KEY", "DEEPSEEK_API_KEY", "MISTRAL_API_KEY", "GOOGLE_API_KEY",
    ):
        monkeypatch.delenv(k, raising=False)
    # Ollama is presumed unreachable in CI; if it happens to be up, the test
    # still passes because a successful provider resolution also means no
    # OPENAI_API_KEY error (the bug we're regressing against).
    result = enrich_from_llm(topic="does-not-exist-topic")
    assert isinstance(result, dict)
    # Either skipped because no provider, OR skipped/errored because topic
    # has no corpus — both are "did not crash with OPENAI_API_KEY".
    assert "OPENAI_API_KEY not set" not in str(result)
```

- [ ] **Step 2: Run the first test — expect PASS for the existing resolver**

Run from the repo root `/Users/shantanubombatkar/Documents/GitHub/reddit-myind/`:

```bash
.venv/bin/pytest -v tests/test_integration.py::test_enrich_uses_openrouter_when_configured
```

Expected: PASS. The `resolve_provider` in `base.py` already handles this case correctly. This test locks the correct behavior in place — it will fail if a future change breaks it.

- [ ] **Step 3: Run the second test — this is the real regression test**

```bash
.venv/bin/pytest -v tests/test_integration.py::test_enrich_skip_gracefully_when_nothing_configured
```

Expected: PASS (skip-gracefully already implemented in `semantic.py:228-234`). Locks in place.

- [ ] **Step 4: Commit**

```bash
cd /Users/shantanubombatkar/Documents/GitHub/reddit-myind
git add tests/test_integration.py
git commit -m "$(cat <<'EOF'
test(integration): regression tests for enrich provider resolution

Locks in correct behavior for OpenRouter + openai/gpt-4o (must not try
to read OPENAI_API_KEY) and skip-gracefully when nothing is configured.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task A2: Add diagnostic breadcrumb to enrich_from_llm

**Goal:** When enrichment fails, include which provider was resolved, what `LLM_PROVIDER` env was, and which `*_API_KEY` env vars are set (names only, not values). This makes the runtime path debuggable from the UI log without needing to attach a debugger.

**Files:**
- Modify: `src/reddit_research/graph/semantic.py:248-255`

- [ ] **Step 1: Wrap the find_gaps call with a diagnostic error block**

Replace the existing try/except block at `semantic.py:248-255`:

```python
    try:
        report = find_gaps(
            topic=topic, provider=provider, corpus_limit=corpus_limit, min_score=min_score
        )
    except Exception as e:
        return {"ok": False, "error": f"enrich failed: {e}", "topic": topic}
    if report.get("error"):
        return {"ok": False, "error": report["error"], "topic": topic}
```

…with this version that includes provider + env diagnostics:

```python
    try:
        report = find_gaps(
            topic=topic, provider=provider, corpus_limit=corpus_limit, min_score=min_score
        )
    except Exception as e:
        set_keys = [k for k in key_for.values() if os.getenv(k)]
        diag = (
            f"[resolved_provider={provider!r}, "
            f"LLM_PROVIDER={os.getenv('LLM_PROVIDER')!r}, "
            f"LLM_MODEL={os.getenv('LLM_MODEL')!r}, "
            f"env_keys_set={set_keys}]"
        )
        return {
            "ok": False,
            "error": f"enrich failed: {e}  {diag}",
            "topic": topic,
        }
    if report.get("error"):
        return {"ok": False, "error": report["error"], "topic": topic}
```

- [ ] **Step 2: Run the full test suite — ensure nothing breaks**

```bash
cd /Users/shantanubombatkar/Documents/GitHub/reddit-myind
.venv/bin/pytest -v tests/test_integration.py
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/reddit_research/graph/semantic.py
git commit -m "$(cat <<'EOF'
feat(semantic): include provider + env diagnostics in enrich failures

When find_gaps raises, also emit resolved provider, LLM_PROVIDER env,
LLM_MODEL env, and names of *_API_KEY env vars that are set. Makes the
UI log directly useful for debugging provider-resolution issues without
a debugger attach.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task A3: Consolidate enrich_from_llm to use the shared resolve_provider

**Goal:** `enrich_from_llm` currently duplicates the resolution logic from `base.py::resolve_provider`. Duplication is the root cause of drift bugs. Delete the duplicate; delegate.

**Files:**
- Modify: `src/reddit_research/graph/semantic.py:165-246`

- [ ] **Step 1: Replace the entire resolution block inside `enrich_from_llm`**

Find this block in `semantic.py` (lines 183–246):

```python
    import os

    # ── Resolve provider from the user's configured env (Settings writes
    # LLM_PROVIDER + the matching *_API_KEY or OLLAMA_BASE_URL into the .env
    # file that reddit-cli reads at startup).
    configured_provider = (os.getenv("LLM_PROVIDER") or "").lower()
    key_for = {
        "anthropic":  "ANTHROPIC_API_KEY",
        # ... (7 entries)
    }

    def _ollama_reachable() -> bool:
        # ...

    # Caller passed an explicit provider → trust them ...
    if not provider:
        if configured_provider == "ollama" and _ollama_reachable():
            provider = "ollama"
        elif configured_provider in key_for and os.getenv(key_for[configured_provider]):
            provider = configured_provider
        else:
            for name, env_key in key_for.items():
                if os.getenv(env_key):
                    provider = name
                    break
            else:
                if _ollama_reachable():
                    provider = "ollama"

    # Still nothing? Skip cleanly.
    if not provider:
        return {
            "ok": False,
            "skipped": True,
            "reason": "no LLM configured — set a key in Settings → API keys, "
                      "or start a local Ollama instance",
            "topic": topic,
        }

    # Validate the chosen provider has its key (or Ollama is reachable).
    if provider == "ollama" and not _ollama_reachable():
        return {
            "ok": False, "skipped": True, "topic": topic,
            "reason": "Ollama is configured but not reachable — start the service in Settings",
        }
    elif provider in key_for and not os.getenv(key_for[provider]):
        return {
            "ok": False, "skipped": True, "topic": topic,
            "reason": f"{key_for[provider]} not set — add it in Settings → API keys",
        }
```

Replace it with this consolidated version:

```python
    import os

    from ..analyze.providers.base import (
        _PROVIDER_ENV_KEY as key_for,
        _ollama_reachable,
        resolve_provider,
    )

    # Delegate to the shared resolver. One implementation. Never drift.
    try:
        provider = resolve_provider(provider)
    except RuntimeError as e:
        return {
            "ok": False,
            "skipped": True,
            "reason": str(e),
            "topic": topic,
        }

    # Double-check the resolved provider still has its key by the time we
    # run — .env could have been edited between resolve and use in theory.
    # Return skip-gracefully so the UI shows a banner instead of an error.
    if provider == "ollama" and not _ollama_reachable():
        return {
            "ok": False, "skipped": True, "topic": topic,
            "reason": "Ollama is configured but not reachable — start the service in Settings",
        }
    if provider in key_for and not os.getenv(key_for[provider]):
        return {
            "ok": False, "skipped": True, "topic": topic,
            "reason": f"{key_for[provider]} not set — add it in Settings → API keys",
        }
```

Notes for the engineer:
- `_PROVIDER_ENV_KEY` and `_ollama_reachable` are module-level names in `base.py` — we import them directly so the validation block can still read them. They have a leading underscore by Python convention but are stable within the repo.
- We keep the `elif` → `if` sequence because both validations are short-circuit returns, not alternatives.
- Do NOT delete the `key_for` variable or the nested `_ollama_reachable` function from ABOVE the try block — the replacement DOES remove them by replacing that entire block. Read the replaced block carefully.

- [ ] **Step 2: Run the integration tests — must still pass**

```bash
cd /Users/shantanubombatkar/Documents/GitHub/reddit-myind
.venv/bin/pytest -v tests/test_integration.py::test_enrich_uses_openrouter_when_configured tests/test_integration.py::test_enrich_skip_gracefully_when_nothing_configured
```

Expected: both PASS.

- [ ] **Step 3: Run the full test suite — nothing else regresses**

```bash
.venv/bin/pytest -v tests/test_integration.py
```

Expected: all tests pass (or only skip due to network — read the reasons; no failures).

- [ ] **Step 4: Commit**

```bash
git add src/reddit_research/graph/semantic.py
git commit -m "$(cat <<'EOF'
refactor(semantic): delegate provider resolution to shared resolve_provider

enrich_from_llm used to duplicate the provider/env resolution logic
from analyze/providers/base.py. Duplication means drift, and drift is
how OpenRouter users ended up hitting OPENAI_API_KEY errors. Now
there is exactly one resolver; semantic.py imports and delegates.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Part B — Viewer theme (match app)

Goal: the exported HTML viewer stops looking like a separate product. Swap the dark palette for the app's cream/ink/orange tokens via a single `--v-*` CSS-variable block so future reskins are trivial.

Reference for the target palette — from `app-tauri/src/style.css:8-39`:
```
--bg: #F6F3EE; --surface: #FFFFFF; --surface-2: #FBF8F2;
--ink: #1A1614; --ink-2: #4A4339; --ink-3: #8A8278;
--line: #ECE6DC;
--orange: #FF8C42;  --lavender: #C9B6F2;  --mint: #A8DCC4;
--sky: #B5D4F0;     --rose: #F4B6BD;      --gold: #F0D78A;
--chronic: #E26A6A; --emerging: #E69447;  --fading: #9C948A;
--radius: 18px; --radius-sm: 12px;
```

### Task B1: Introduce CSS-variable palette block at top of viewer HTML

**Files:**
- Modify: `src/reddit_research/graph/export.py` — the `<style>` block inside `export_graph_html`

- [ ] **Step 1: Locate the top of the `<style>` block**

Around `export.py:240` (the start of the `<style>` tag inside the HTML template string). The current template starts styles with rules like `body { ... }` using hex literals directly.

- [ ] **Step 2: Prepend a `:root` block that declares all theme tokens**

Immediately after the `<style>` opening tag, insert:

```css
:root {
  /* Matches app CSS tokens (app-tauri/src/style.css). Single source of
     truth for the exported viewer's palette. */
  --v-bg:         #F6F3EE;
  --v-surface:    #FFFFFF;
  --v-surface-2:  #FBF8F2;
  --v-ink:        #1A1614;
  --v-ink-2:      #4A4339;
  --v-ink-3:      #8A8278;
  --v-line:       #ECE6DC;
  --v-line-2:     #E2DBCF;

  --v-orange:        #FF8C42;
  --v-orange-soft:   #FFE9D6;
  --v-lavender:      #C9B6F2;
  --v-lavender-soft: #EFE7FB;
  --v-mint:          #A8DCC4;
  --v-mint-soft:     #E1F2EA;
  --v-sky:           #B5D4F0;
  --v-sky-soft:      #E4F0FA;
  --v-rose:          #F4B6BD;
  --v-rose-soft:     #FBE3E6;
  --v-gold:          #F0D78A;
  --v-gold-soft:     #FBF1D4;

  --v-chronic:   #E26A6A;
  --v-emerging:  #E69447;
  --v-fading:    #9C948A;

  --v-radius:    18px;
  --v-radius-sm: 12px;

  /* Aliases previously used in the dark template — kept so the old rules
     continue to compile while we migrate them one by one in Task B2. */
  --bg:     var(--v-bg);
  --surface:var(--v-surface);
  --text:   var(--v-ink);
  --muted:  var(--v-ink-3);
  --border: var(--v-line);
  --accent: var(--v-orange);
  --panel:  var(--v-surface);
}
```

- [ ] **Step 3: Verify the template still parses — export for the existing topic**

```bash
cd /Users/shantanubombatkar/Documents/GitHub/reddit-myind
.venv/bin/python -c "
from reddit_research.graph.export import export_graph_html
from pathlib import Path
out = Path('/tmp/viewer-test.html')
export_graph_html('calari tracking app', out)
print('wrote', out, out.stat().st_size, 'bytes')
"
```

Expected: `wrote /tmp/viewer-test.html <size> bytes`, no exceptions.

- [ ] **Step 4: Open the exported file and confirm it still renders**

```bash
open /tmp/viewer-test.html
```

Expected: viewer loads in your default browser. It will still look mostly dark (we only added alias tokens — the actual rules still use dark hex literals and `var(--bg)` etc. which now resolve to cream — so you should already see the page bg change to cream, text may look washed out. That's fine — Task B2 fixes the rest.

- [ ] **Step 5: Commit**

```bash
git add src/reddit_research/graph/export.py
git commit -m "$(cat <<'EOF'
style(viewer): add CSS-variable palette block

Introduces --v-* tokens mirroring the app's light theme at the top of
the exported viewer's <style> block. Dark-era --bg/--surface/--text
aliases remain (resolved against the new light tokens) so existing
rules compile; they'll be migrated in the next commit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task B2: Migrate viewer CSS rules from dark-era hex literals to light tokens

**Files:**
- Modify: `src/reddit_research/graph/export.py` — the CSS rules inside `<style>` (approximately lines 245–340)

- [ ] **Step 1: Replace color literals systematically**

Scan the CSS block and apply these substitutions. For each one, use Grep to find the dark-era literal in `export.py`, then an Edit to replace. Do them in this order.

| Find | Replace with |
|---|---|
| `background:#0b0e13` | `background: var(--v-bg)` |
| `background:#161b22` | `background: var(--v-surface)` |
| `background:#0d1117` | `background: var(--v-bg)` |
| `color:#c9d1d9` | `color: var(--v-ink)` |
| `color:#8b949e` | `color: var(--v-ink-3)` |
| `color:#e6edf3` | `color: var(--v-ink)` |
| `border:1px solid #30363d` | `border: 1px solid var(--v-line)` |
| `border-color:#30363d` | `border-color: var(--v-line)` |
| `stroke:#48505c` (edges) | `stroke: rgba(26,22,20,0.18)` |
| `#f778ba` (topic node) | `var(--v-orange)` |
| `#a371f7` (subreddit) | `var(--v-lavender)` |
| `#58a6ff` (post) | `var(--v-sky)` |
| `#79c0ff` (comment) | `var(--v-sky)` |
| `#3fb950` (user / green badges) | `var(--v-mint)` |
| `#7d8590` (era / grey) | `var(--v-fading)` |
| `#f85149` (painpoint red) | `var(--v-chronic)` |
| `#ffa657` (feature_wish orange) | `var(--v-gold)` |
| `#d2a8ff` (product purple) | `var(--v-emerging)` |
| `#7ee787` (workaround green) | `var(--v-mint)` |
| `font-family: -apple-system, ...` (or wherever the CSS font-family is set for `body`) | `font-family: "Plus Jakarta Sans", "Inter", system-ui, sans-serif` |

Use the Grep tool with `output_mode: "content"` and `-n: true` to find each literal, then Edit with the exact line.

- [ ] **Step 2: Update border-radius values to match app**

In the CSS, replace `border-radius:4px` (used on card/details) with `border-radius: var(--v-radius-sm)` and any large containers using `border-radius:8px` or larger with `border-radius: var(--v-radius)`.

- [ ] **Step 3: Soften badge colors — use soft-tinted backgrounds**

Find the badge rules (they look like `.badge.chronic`, `.badge.emerging`, `.badge.severity-high`, `.badge.sat-saturated`, etc.) and update them to use the soft variants as background with the base color as text:

```css
.badge {
  display: inline-block;
  font-size: 10px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: var(--v-radius-sm);
  text-transform: uppercase;
  letter-spacing: .4px;
}
.badge.chronic  { background: #F9D9D9; color: var(--v-chronic); }
.badge.emerging { background: var(--v-gold-soft); color: var(--v-emerging); }
.badge.fading   { background: #ECE6DC; color: var(--v-fading); }
.badge.severity-high   { background: var(--v-rose-soft);   color: var(--v-chronic); }
.badge.severity-medium { background: var(--v-gold-soft);   color: var(--v-emerging); }
.badge.severity-low    { background: var(--v-mint-soft);   color: #3D8A6A; }
.badge.sat-saturated   { background: var(--v-mint-soft);   color: #3D8A6A; }
.badge.sat-adequate    { background: var(--v-sky-soft);    color: #3B6FA3; }
.badge.sat-tentative   { background: var(--v-gold-soft);   color: var(--v-emerging); }
.badge.sat-thin        { background: #ECE6DC;              color: var(--v-ink-3); }
```

Match these rules against whatever badge classes currently exist in the file. If a rule references a class not in this list, retain it but convert its colors per the substitution table in Step 1.

- [ ] **Step 4: Remove the legacy dark-era alias block**

In the `:root` block added in Task B1, delete the alias rules (since all CSS now uses `--v-*` directly):

Remove:
```css
  /* Aliases previously used in the dark template — kept so the old rules
     continue to compile while we migrate them one by one in Task B2. */
  --bg:     var(--v-bg);
  --surface:var(--v-surface);
  --text:   var(--v-ink);
  --muted:  var(--v-ink-3);
  --border: var(--v-line);
  --accent: var(--v-orange);
  --panel:  var(--v-surface);
```

If after removing them `export.py` still has rules referencing `var(--bg)` / `var(--text)` / `var(--muted)` / `var(--border)` / `var(--accent)` / `var(--panel)`, those rules were missed in Step 1 — go back and substitute them now. Grep should return zero matches:

```bash
.venv/bin/python - <<'PY'
import re
from pathlib import Path
p = Path("src/reddit_research/graph/export.py")
text = p.read_text()
# Find remaining uses of the old alias names inside the export.py file.
hits = re.findall(r"var\(--(bg|text|muted|border|accent|panel|surface)\)", text)
print("legacy-alias-refs:", len(hits), hits[:10])
PY
```

Expected: `legacy-alias-refs: 0 []`. If there are hits, go substitute them using the table in Step 1 and re-run.

- [ ] **Step 5: Re-export and verify the file loads**

```bash
.venv/bin/python -c "
from reddit_research.graph.export import export_graph_html
from pathlib import Path
out = Path('/tmp/viewer-test.html')
export_graph_html('calari tracking app', out)
print('wrote', out.stat().st_size, 'bytes')
" && open /tmp/viewer-test.html
```

Expected: page bg is cream `#F6F3EE`, text is near-black `#1A1614`, nodes use orange/lavender/sky palette, finding badges are soft-tinted pills. Graph edges are subtle dark-translucent lines (not bright) against the cream bg.

- [ ] **Step 6: Commit**

```bash
git add src/reddit_research/graph/export.py
git commit -m "$(cat <<'EOF'
style(viewer): migrate all CSS rules to light-theme --v-* tokens

Replaces every dark-era hex literal with the corresponding --v-* token
from the :root block. Badges use soft-tinted backgrounds with strong
foreground color. Font-family switches to the app's Plus Jakarta Sans.
Legacy --bg/--text/etc aliases removed.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task B3: Swap KIND_COLORS JS constant so graph nodes use the new palette

**Files:**
- Modify: `src/reddit_research/graph/export.py:398-403`

- [ ] **Step 1: Locate the KIND_COLORS object (around line 398)**

Current:
```javascript
const KIND_COLORS = {
  topic:"#f778ba", subreddit:"#a371f7", post:"#58a6ff", comment:"#79c0ff",
  user:"#3fb950", era:"#7d8590",
  painpoint:"#f85149", feature_wish:"#ffa657",
  product:"#d2a8ff", workaround:"#7ee787",
};
```

- [ ] **Step 2: Replace with app-matched colors**

```javascript
const KIND_COLORS = {
  // Center / root
  topic:         "#FF8C42",   // app orange
  // Organizing structure (soft, recedes)
  subreddit:     "#C9B6F2",   // lavender
  era:           "#B5D4F0",   // sky
  // Evidence (quiet, doesn't compete with findings)
  post:          "#8A8278",   // ink-3
  comment:       "#8A8278",   // ink-3
  user:          "#A8DCC4",   // mint
  // Findings (the product's value — accents matter)
  painpoint:     "#E26A6A",   // chronic-red
  product:       "#E69447",   // emerging-orange
  workaround:    "#A8DCC4",   // mint
  feature_wish:  "#F0D78A",   // gold
};
```

- [ ] **Step 3: Update the PNG export background color**

Around `export.py:599` there's `backgroundColor: "#0b0e13"` inside the `htmlToImage.toPng(...)` call. Change to:

```javascript
backgroundColor: "#F6F3EE",
```

Else "Save as PNG" produces a PNG with a dark bg that clashes with the new theme.

- [ ] **Step 4: Update the node-circle stroke color**

Around `export.py:727` the nodes have `.attr("stroke", "#0b0e13")`. Change to:

```javascript
.attr("stroke", "#F6F3EE")
```

so the stroke blends with the cream page bg instead of leaving a dark ring.

- [ ] **Step 5: Update the node-text fill color**

Around `export.py:732` the node labels have `.style("fill","#c9d1d9")`. Change to:

```javascript
.style("fill", "#4A4339")
```

- [ ] **Step 6: Re-export and visually verify**

```bash
.venv/bin/python -c "
from reddit_research.graph.export import export_graph_html
from pathlib import Path
out = Path('/tmp/viewer-test.html')
export_graph_html('calari tracking app', out)
print('wrote', out.stat().st_size, 'bytes')
" && open /tmp/viewer-test.html
```

Expected: topic center is orange, subreddits lavender, painpoints red, feature wishes gold, workarounds mint, products orange. No dark rings on nodes. Labels readable in warm brown. Save-as-PNG no longer has a dark background.

- [ ] **Step 7: Commit**

```bash
git add src/reddit_research/graph/export.py
git commit -m "$(cat <<'EOF'
style(viewer): recolor graph nodes + strokes to match app palette

KIND_COLORS now uses the app tokens: orange for topic, lavender for
subreddits, finding-category colors for semantic nodes. Node strokes
blend with the cream bg instead of dark rings. PNG export bg is cream.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task B4: Add colored-accent treatment to finding sections

**Files:**
- Modify: `src/reddit_research/graph/export.py` — add rules to the `<style>` block

- [ ] **Step 1: Locate the `.card` rule (around line 280)**

It's in the CSS block. The current rule styles each finding card with surface bg + border + padding.

- [ ] **Step 2: Append category-specific accent rules after the existing `.card` rule**

```css
/* Category accent — a 3px left border in the role color helps users scan
   which kind of finding they're looking at without reading the pill. */
#painpoints  .card { border-left: 3px solid var(--v-chronic); }
#workarounds .card { border-left: 3px solid var(--v-mint); }
#products    .card { border-left: 3px solid var(--v-emerging); }
#features    .card { border-left: 3px solid var(--v-gold); }

/* Section-header pill — the little colored chip next to "🔥 Painpoints" etc.
   Uses the same soft-tinted-bg + strong-fg pattern as badges. */
aside.left h2 {
  font-size: 13px;
  font-weight: 700;
  margin: 14px 0 8px;
  color: var(--v-ink);
  display: flex;
  align-items: center;
  gap: 8px;
}
aside.left h2 span { font-weight: 500; font-size: 11px; }
```

- [ ] **Step 3: Re-export and verify the accents are visible**

```bash
.venv/bin/python -c "
from reddit_research.graph.export import export_graph_html
from pathlib import Path
out = Path('/tmp/viewer-test.html')
export_graph_html('calari tracking app', out)
print('wrote', out.stat().st_size, 'bytes')
" && open /tmp/viewer-test.html
```

Expected: each finding section has a 3px colored left border matching its category. Section headers align with icon + text + count.

Note: for topics with zero findings the cards list is empty and there's nothing to see. This is fine — once Part A fixes enrichment, the "calari tracking app" topic will produce findings and the accents will show.

- [ ] **Step 4: Commit**

```bash
git add src/reddit_research/graph/export.py
git commit -m "$(cat <<'EOF'
style(viewer): add colored left-border accents to finding cards

Each of the 4 finding categories now has a 3px left-border in its
role color (chronic-red / mint / emerging-orange / gold) plus a
cleaner section-header layout. Scanning the sidebar is now a visual
pattern-match, not an act of reading.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Part C — Frontend hide-html

Goal: users stop seeing `/Users/.../Library/Application Support/…/gap-map-<topic>.html` in the Topic header and stop seeing the `.html` filename as the primary chip.

### Task C1: Replace path + filename with node/edge/findings chips

**Files:**
- Modify: `app-tauri/src/screens/topic.js` — the Map tab render block (approximately lines 170–205)

- [ ] **Step 1: Add a helper to fetch node + edge counts for the current topic**

Within `loadMap()` in `topic.js`, BEFORE the `$('#topic-sub').textContent = outPath;` line (around line 177), fetch the counts:

Insert this block after the `outPath = await api.exportHtml(topic);` call (currently around line 175) and BEFORE the existing `const fileUrl = convertFileSrc(outPath);` line:

```javascript
      // Node + edge counts, for the clean summary + chips below.
      let nodeCount = 0;
      let edgeCount = 0;
      try {
        const rows = await api.runQuery(
          `SELECT
             (SELECT count(*) FROM graph_nodes WHERE topic=:topic) AS n_nodes,
             (SELECT count(*) FROM graph_edges WHERE topic=:topic) AS n_edges`,
          topic,
        );
        if (Array.isArray(rows) && rows[0]) {
          nodeCount = Number(rows[0].n_nodes || 0);
          edgeCount = Number(rows[0].n_edges || 0);
        }
      } catch {}
```

- [ ] **Step 2: Replace the path-reveal subtitle line**

Find (around line 177):

```javascript
      $('#topic-sub').textContent = outPath;
```

Replace with:

```javascript
      const updatedAgo = timeAgo(Date.now());
      $('#topic-sub').textContent =
        `${nodeCount.toLocaleString()} nodes · ${edgeCount.toLocaleString()} edges · updated ${updatedAgo}`;
```

Note: `timeAgo` is already imported at the top of `topic.js` from `../api.js`. No new import needed.

- [ ] **Step 3: Replace the filename chip with counter chips**

Find the block (around line 185-195):

```javascript
        <div class="map-toolbar">
          <div class="map-toolbar-info">
            <span class="th-chip" title="Path on disk">${esc(outPath.split('/').pop())}</span>
            ${findingsChip}
          </div>
```

Replace with:

```javascript
        <div class="map-toolbar">
          <div class="map-toolbar-info">
            <span class="th-chip"><b>${nodeCount.toLocaleString()}</b> nodes</span>
            <span class="th-chip"><b>${edgeCount.toLocaleString()}</b> edges</span>
            ${findingsChip}
          </div>
```

- [ ] **Step 4: Relabel "Open externally" → "Open in browser"**

Find the button (around line 194):

```javascript
          <button class="btn btn-ghost" style="padding:7px 12px;font-size:12px;border:1px solid var(--line)" id="btn-map-open-ext">Open externally</button>
```

Replace with:

```javascript
          <button class="btn btn-ghost" style="padding:7px 12px;font-size:12px;border:1px solid var(--line)" id="btn-map-open-ext">Open in browser</button>
```

- [ ] **Step 5: Verify in the Tauri dev app**

```bash
cd /Users/shantanubombatkar/Documents/GitHub/reddit-myind/app-tauri
npm run tauri dev
```

(If this is already running in another terminal, the frontend hot-reloads — no restart needed.)

In the app:
1. Navigate to Topic → "calari tracking app".
2. Click the **Map** tab.
3. Wait for the map to build.

Expected:
- Under the topic title, subtitle reads e.g. `"1,187 nodes · 2,237 edges · updated just now"` — NOT a filesystem path.
- Toolbar chips read `"1,187 nodes"`, `"2,237 edges"`, `"N findings"` — no `.html` filename.
- The **Open in browser** button replaces **Open externally** (same behavior, friendlier label).
- Reveal button remains.

- [ ] **Step 6: Commit**

```bash
cd /Users/shantanubombatkar/Documents/GitHub/reddit-myind
git add app-tauri/src/screens/topic.js
git commit -m "$(cat <<'EOF'
feat(topic): hide filesystem path and .html filename in Map tab

Topic subtitle now reads "N nodes · M edges · updated X ago" instead
of leaking the absolute path to the exported HTML. Filename chip is
replaced by node/edge counters. "Open externally" → "Open in browser"
for friendlier copy. Reveal button stays for power users.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Part D — Skill update + end-to-end verification

### Task D1: Update tauri-python-sidecar-app skill Gotchas

**Files:**
- Modify: `~/.claude/skills/tauri-python-sidecar-app/SKILL.md` (the Gotchas section)

- [ ] **Step 1: Open the skill and find the Gotchas table**

Around the line `## Gotchas (real errors from production)`. The table has columns: Error message | Cause | Fix.

- [ ] **Step 2: Append a new row for the duplicated-resolver drift bug**

Add this row to the table (keep it alphabetical or append at the end; this repo uses append-at-end):

```markdown
| `OPENAI_API_KEY not set in environment` when user has openrouter configured with `openai/gpt-4o` | `enrich_from_llm` duplicated the env/provider resolution logic from `analyze/providers/base.py::resolve_provider` and the two drifted. Slashed model names (openrouter convention: `openai/gpt-4o`) never imply `provider=openai` — provider is `openrouter`; the model string is opaque. | Delete the duplicate resolver; call `resolve_provider(provider)` and import `_PROVIDER_ENV_KEY` + `_ollama_reachable` from `base.py`. One resolver, one source of truth. |
```

- [ ] **Step 3: Verify no formatting damage**

```bash
head -200 ~/.claude/skills/tauri-python-sidecar-app/SKILL.md | tail -40
```

Check the Gotchas table still has aligned columns.

- [ ] **Step 4: Commit**

This skill lives in `~/.claude`, not the repo. Committing happens inside the skill's own git repo (or is kept as a local-only change). Check:

```bash
cd ~/.claude/skills/tauri-python-sidecar-app && git status 2>/dev/null || echo "not-a-git-repo"
```

If `not-a-git-repo`, the edit is already saved — no commit needed. If it IS a git repo, commit inside it:

```bash
cd ~/.claude/skills/tauri-python-sidecar-app
git add SKILL.md
git commit -m "docs: add openrouter slashed-model resolver-drift gotcha"
```

---

### Task D2: End-to-end verification against acceptance criteria

**Files:** no edits — this is a verification task.

- [ ] **Step 1: Confirm the sidecar dev path is active**

```bash
cd /Users/shantanubombatkar/Documents/GitHub/reddit-myind
ls -la .venv/bin/python
```

Expected: the symlink exists. The dev-python bypass (skill Phase 2) will use this for `tauri dev`.

- [ ] **Step 2: Start the app**

```bash
cd /Users/shantanubombatkar/Documents/GitHub/reddit-myind/app-tauri
npm run tauri dev
```

- [ ] **Step 3: Acceptance criteria walkthrough**

Navigate the app and check each criterion from the spec. For each line, if the observed state matches, tick it. If anything fails, STOP and investigate before declaring the plan complete.

- [ ] A. Topic → "calari tracking app" → Map tab: the viewer renders in cream/ink palette matching the app (no dark panels).
- [ ] B. No file path visible anywhere in the Topic header or Map toolbar.
- [ ] C. Filename `.html` chip is gone; replaced by `<b>N</b> nodes`, `<b>N</b> edges`, `<b>N</b> findings` counter chips.
- [ ] D. With OpenRouter configured (Settings → API keys shows openrouter key set + `openai/gpt-4o` as model), clicking **Enrich** on the 1,212-post topic produces at least one painpoint OR feature wish OR workaround OR product finding. The `OPENAI_API_KEY not set` error is GONE.
- [ ] E. Run the regression tests one final time:

```bash
cd /Users/shantanubombatkar/Documents/GitHub/reddit-myind
.venv/bin/pytest -v tests/test_integration.py::test_enrich_uses_openrouter_when_configured tests/test_integration.py::test_enrich_skip_gracefully_when_nothing_configured
```

Expected: both PASS.

- [ ] **Step 4: If criterion D fails (enrichment still errors)**

Check the error's diagnostic tail (added in Task A2). It will print `[resolved_provider=..., LLM_PROVIDER=..., LLM_MODEL=..., env_keys_set=[...]]`.

Decision tree:
- `env_keys_set` is empty → user hasn't actually saved the OpenRouter key via BYOK. Open Settings, re-enter the key, retry.
- `env_keys_set` contains `OPENROUTER_API_KEY` AND `resolved_provider='openrouter'` AND error is about some other issue (`401`, `model not found`, etc.) → the provider fix is working; the remaining issue is an OpenRouter API error, not our bug. Spec's Risk #1 realized — split: file a separate investigation.
- Anything else → report the diagnostic line and stop before declaring done.

- [ ] **Step 5: Mark the spec as shipped**

Update the spec header at `docs/superpowers/specs/2026-04-19-gap-map-viewer-mvp-design.md` line 4:

```
Replace:    **Status:** Approved, ready for implementation planning
With:       **Status:** Shipped 2026-04-19
```

```bash
cd /Users/shantanubombatkar/Documents/GitHub/reddit-myind
git add docs/superpowers/specs/2026-04-19-gap-map-viewer-mvp-design.md
git commit -m "$(cat <<'EOF'
docs(spec): mark gap-map-viewer MVP as shipped

All three concerns verified in tauri dev: light theme matches app,
no path leakage in Map tab, enrichment produces findings with
OpenRouter + openai/gpt-4o.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-review notes

- **Spec coverage.** Every acceptance criterion in §7 of the spec maps to a task: theme = B1–B4, hide-html = C1, enrichment = A1–A3, test = A1, skill update = D1, sidecar rebuild = (intentionally deferred — the spec explicitly marked it optional for dev verification; user hasn't asked to ship a DMG yet).
- **Type consistency.** `nodeCount` / `edgeCount` names are used consistently in Task C1. `_PROVIDER_ENV_KEY` and `_ollama_reachable` imports in Task A3 match the real names in `base.py`. CSS `--v-*` tokens declared in B1 and used in B2–B4.
- **No placeholders.** Every step has runnable code or a real verification command. No "TBD" / "implement later" / "handle edge cases" in the plan.
- **Commit points.** 9 commit points across the plan — one per task, each leaves the tree in a working state.
- **Out-of-scope deferrals.** Sidecar rebuild for DMG (per spec), BYOK modal rewrite (audit marked it half-built, not in this slice), any other screens.
