# Gap Map viewer — MVP design

**Date:** 2026-04-19
**Status:** Approved, ready for implementation planning
**Scope:** Single MVP slice — the Topic → Map tab

## Goal

Make the Map tab — the product's core output — ship-ready for MVP. Three tightly-coupled problems live in this one slice:

1. The embedded gap-map viewer renders in a dark theme that clashes with the app's light/cream theme.
2. The viewer leaks its implementation — file path and `.html` filename are shown to users.
3. Enrichment fails with `OPENAI_API_KEY not set` even when the user has configured OpenRouter + `openai/gpt-4o`. Result: 1,212 collected posts produce 0 findings.

All three are fixed together because they live in the same user flow and the same commit batch — splitting would double the plan overhead with no real benefit.

## Non-goals (explicitly out of scope)

- Any other screen (Welcome, Home, Collect, Activity, Reports, Database, Settings, Science, Ingest, BYOK modal).
- Adding new Tauri commands or capabilities.
- Schema changes.
- Distribution / signing / bundling changes beyond the routine sidecar rebuild required after Python edits.
- Redesigning the viewer's information architecture — only the visual theme and what the frontend shows around it change.

---

## 1. Files touched

| Change | File | Notes |
|---|---|---|
| Theme the exported viewer HTML | `src/reddit_research/graph/export.py::export_graph_html` | Self-contained HTML; all styles inline. Palette declared as `--v-*` CSS vars at top of `<style>`. |
| Fix enrichment provider resolution | `src/reddit_research/graph/semantic.py::enrich_from_llm` | Call `resolve_provider(provider)`. Treat `openai/gpt-4o` as a single opaque model string when provider is `openrouter`. |
| Verify `find_gaps` resolution path | `src/reddit_research/research/gaps.py` | Confirm `resolve_provider(provider)` result flows into extractor construction without re-defaulting. |
| Guard OpenAI provider construction | `src/reddit_research/analyze/providers/openai.py` | Only constructed when resolved `provider == "openai"`; never from a slashed model string. |
| Hide file path + `.html` chip | `app-tauri/src/screens/topic.js` | `#topic-sub` shows node/edge/updated summary. Filename chip replaced with counter chips. Relabel "Open externally" → "Open in browser". |
| Add integration test | `tests/test_integration.py` | `test_enrich_uses_openrouter_when_configured`. |
| Update skill gotchas | `~/.claude/skills/tauri-python-sidecar-app/SKILL.md` | Append openrouter slashed-model bug to Gotchas table per CLAUDE.md skill-evolution rule. |
| Sidecar rebuild | `src-tauri/binaries/reddit-cli-aarch64-apple-darwin` | Required before DMG export. Not required for `tauri dev` verification (dev-python bypass reads source directly). |

**No new capabilities.** `capabilities/default.json` stays as-is.
**No CSS changes in `app-tauri/src/style.css`.** `.th-chip` and `.viewer-frame` are already styled.
**No Rust changes** — iframe + `convertFileSrc` path already works; screenshot confirms the viewer renders.

---

## 2. Viewer theme (exported HTML)

Self-contained HTML. Theming is done by a single CSS-variable block at the top of the `<style>` tag so future reskins are a one-file edit.

### Color mapping

| Role | From (dark) | To (app-matched) | App token equivalent |
|---|---|---|---|
| Page bg | near-black | `#F6F3EE` | `--bg` |
| Panel bg | `#12121A`-ish | `#FFFFFF` | `--surface` |
| Text primary | white | `#1A1614` | `--ink` |
| Text secondary | grey-400 | `#4A4339` / `#8A8278` | `--ink-2` / `--ink-3` |
| Lines / borders | dim grey | `#ECE6DC` | `--line` |
| Center (topic) node | magenta | `#FF8C42` | `--orange` |
| Subreddit nodes | purple | `#C9B6F2` | `--lavender` |
| Era nodes | grey | `#B5D4F0` | `--sky` |
| Painpoint | red-ish | `#E26A6A` | `--chronic` |
| Feature wish | — | `#F0D78A` | `--gold` |
| DIY workaround | — | `#A8DCC4` | `--mint` |
| Product | — | `#E69447` | `--emerging` |
| Edges | bright lines | `rgba(26,22,20,.15)` | derived |
| Font stack | default | `"Plus Jakarta Sans", "Inter", system-ui, sans-serif` | matches app |
| Corner radius | varied | `18px` panels / `12px` chips | `--radius` / `--radius-sm` |

### Finding-section treatment

Each of the 4 finding categories (Painpoints / Feature wishes / DIY workarounds / Products) gets:
- Colored left-border accent (2–3px) matching its role color.
- Soft-tinted pill badge in the section header using the `--*-soft` variants (e.g. `--orange-soft`, `--mint-soft`).
- Emoji retained (🔥 💡 🔧 😡) — they already read well.

Rationale: the 4 categories are the product's value prop and deserve visual weight. Monochrome was considered and rejected — too undifferentiated for the core screen.

---

## 3. Enrichment provider resolution

### Root cause

The error `OPENAI_API_KEY not set in environment` is raised in `analyze/providers/openai.py:20`. It should never be reached when the user has configured OpenRouter. Two likely mechanisms (both addressed):

1. **`enrich_from_llm` skips `resolve_provider`.** It either hardcodes `provider="openai"` or passes a raw `provider` that wasn't normalized.
2. **Slashed-model misparse.** `openai/gpt-4o` is the openrouter convention for "route this OpenAI model through openrouter." Somewhere in the chain the slash prefix is being read as `provider=openai` — forcing OpenAI construction even though the real auth should be `OPENROUTER_API_KEY`.

### Fix

Apply the tauri-python-sidecar-app skill's Phase 4 pattern end-to-end:

- `enrich_from_llm(topic, provider=None, …)`: first line is `provider = resolve_provider(provider)` — never hardcode.
- Provider is selected from the normalized name (`anthropic` / `openai` / `openrouter` / …), never from the model string.
- Model string (`LLM_MODEL` env or arg) is passed opaque to the provider — no splitting on `/`.
- On provider instantiation failure, return skip-gracefully payload, not a raise:
  ```python
  {"ok": False, "skipped": True, "reason": "<human-readable>"}
  ```
  The UI already handles this shape (`topic.js` line 150 checks `e?.skipped`).

### Verification

- Integration test: `test_enrich_uses_openrouter_when_configured`. Env: `LLM_PROVIDER=openrouter`, `LLM_MODEL=openai/gpt-4o`, `OPENROUTER_API_KEY=test`. Assert: openrouter provider is instantiated; OpenAI provider is not; `OPENAI_API_KEY` is never read.
- Manual: on the existing topic "calari tracking app" with 1,212 posts + openrouter configured, clicking **Enrich** should produce a non-zero findings count.

---

## 4. Hide-html UI changes (topic.js)

### Before (topic.js lines 177, 185–197)

- `#topic-sub` gets the absolute `outPath` as text — leaks `/Users/<name>/Library/Application Support/…/gap-map-<topic>.html`.
- First toolbar chip shows `outPath.split('/').pop()` — i.e. the `.html` filename.

### After

- `#topic-sub` shows a clean summary: `"{nodes} nodes · {edges} edges · updated {relative-time}"`.
  - Node/edge counts: one parameterized `api.runQuery` against `graph_nodes` / `graph_edges` filtered by `topic=:topic`.
  - Relative time: `timeAgo(Date.now())` at export time — no Rust helper needed (the viewer is freshly regenerated on each Map load).
- Toolbar chips: replace the filename chip with three counter chips — `<b>N</b> nodes`, `<b>N</b> edges`, and the existing findings chip.
- Buttons: keep **Reveal** and rename **Open externally** → **Open in browser**. These remain as escape hatches for power users.

### Out of scope for this change

- We do NOT delete the exported HTML file or change where it's saved. Paths remain available via the Reveal button and are still useful for debugging; they just aren't surfaced as primary UI.

---

## 5. Build sequence

1. **Python — provider fix.** Edit `enrich_from_llm` to call `resolve_provider(provider)` and stop any slashed-model misparse. Confirm `research/gaps.py` resolution path is clean. Confirm `analyze/providers/openai.py` is only constructed when resolved provider is literally `"openai"`.
2. **Python — integration test.** Add `test_enrich_uses_openrouter_when_configured` to `tests/test_integration.py`. Run the suite.
3. **Python — viewer theme.** Refactor the embedded `<style>` block in `export_graph_html` to declare `--v-*` CSS variables and swap the palette to the app tokens mapped in §2. Add colored-accent treatment to finding sections. Visual diff: export → open `gap-map-<topic>.html` → compare to screenshot reference.
4. **Sidecar rebuild (optional for dev verification — required before DMG).** `pyinstaller reddit-cli.spec` → `cp dist/reddit-cli app-tauri/src-tauri/binaries/reddit-cli-aarch64-apple-darwin` → `codesign --force --deep --sign -`. Per skill Phase 2, `npm run tauri dev` uses `.venv/bin/python` and reads the Python source directly — the bundled binary is NOT required to verify the fix in dev. Rebuild before any production build or DMG export.
5. **Frontend — topic.js.** Replace `#topic-sub` path with summary line. Replace filename chip with counter chips. Relabel "Open externally" → "Open in browser".
6. **Skill update.** Append the openrouter slashed-model bug to the Gotchas table in `~/.claude/skills/tauri-python-sidecar-app/SKILL.md` (per CLAUDE.md skill-evolution rule).
7. **Verify end-to-end.** `npm run tauri dev` → Topic: calari tracking app → Map tab. Expect: cream viewer matches app; no path visible; clicking **Enrich** with OpenRouter configured produces a non-zero findings count.

---

## 6. Risks & unknowns

- **Enrichment may have a second bug.** If the provider fix lands and 1,212 posts still produce 0 findings, the issue is downstream (extractor prompt, graph-building rules, or LLM response parsing). In that case, split: ship the 3 visible fixes (theme, hide-html, provider resolution) and open a separate investigation.
- **Sidecar rebuild time on first launch.** After re-signing, Gatekeeper will re-verify the new binary — first launch may be slow. This is expected (per skill Phase 9).
- **Exact root cause of slashed-model parsing.** Will be confirmed during step 1 by reading `enrich_from_llm` + `gaps.py` + `openai.py` together. If the bug isn't where we hypothesize, the design still stands (the fix is "use `resolve_provider` everywhere and treat model strings as opaque") — we just update the exact lines during planning.

---

## 7. Acceptance criteria

- [ ] Map tab viewer renders in cream/ink palette matching the app (no dark panels).
- [ ] No file path visible anywhere in the Topic header or Map toolbar.
- [ ] Filename `.html` chip is gone; replaced by node/edge/findings counter chips.
- [ ] With OpenRouter configured + `openai/gpt-4o`, clicking **Enrich** on a 1,212-post topic produces at least one painpoint OR feature wish OR workaround OR product finding. `OPENAI_API_KEY not set` error is gone.
- [ ] `tests/test_integration.py::test_enrich_uses_openrouter_when_configured` passes.
- [ ] `tauri-python-sidecar-app` SKILL.md Gotchas table includes the slashed-model row.
- [ ] Sidecar binary rebuilt, re-signed, dev run clean.
