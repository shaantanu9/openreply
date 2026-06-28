# Whisper: reuse existing installs + onboarding step

**Date:** 2026-04-21
**Type:** Feature

## Summary

Two user-facing wins on top of the five-pass video-ingest feature shipped earlier today:

1. **Reuse Whisper models already on disk** — scans 4 locations (HuggingFace hub cache, `$OPENREPLY_WHISPER_MODELS_DIR`, common system dirs, app-managed dir) before suggesting any download. A user who already has `small.en` from any other Python project never re-downloads 480 MB. `download_model` short-circuits with a `{skipped:true, source, path}` result when the tier is loadable from anywhere.
2. **Onboarding Step 4 (new)** — "Video transcription (optional)" slots between Connect sources and First topic. Auto-detects existing installs → shows "Use it" for reuse, or prompts to download `small.en` with live progress. Fully skippable; decision persists in localStorage so Settings can pick up where onboarding left off.

## Python changes

- `src/reddit_research/transcribe/models.py` — major rewrite.
  - New `discover_installed_external()` — scans HF hub cache (respecting `HF_HUB_CACHE` / `HF_HOME`), `OPENREPLY_WHISPER_MODELS_DIR`, and `~/.cache/whisper/` / `~/whisper-models/` / `/opt/whisper/`. Returns `[{tier, path, size_mb, rtf, source, installed}]`. `source ∈ {'app','hf_hub','custom','system'}`.
  - New `resolve_model_path(tier)` — returns the absolute path to load for a tier (app-managed preferred), or `None` if nothing found.
  - `list_installed()` now returns the union of app-managed + external, deduped on tier, app-managed wins on conflict.
  - `catalogue()` returns `{installed, source, path}` per tier so UI can render an "Already installed" badge.
  - `default_tier()` honours external installs when resolving the `.default` marker.
  - `download_model(tier)` pre-checks `resolve_model_path` — if found, returns `{ok:true, skipped:true, reason:'already_installed', source, path}` without calling HuggingFace.
  - `delete_model(tier)` restricted to the app-managed dir (doc change — never deletes externals).
- `src/reddit_research/transcribe/whisper.py::transcribe_audio` — now loads from `resolve_model_path(tier)` instead of `models_root()/tier`. Transcription works against any detected install transparently.
- `src/reddit_research/transcribe/__init__.py` — re-exports `discover_installed_external`, `resolve_model_path`.
- `src/reddit_research/cli/main.py::cmd_whisper_download` — emits the new `skipped/source` result fields; prints `✓ reusing existing <tier> at <path>` on the short-circuit path.

## UI changes

- `app-tauri/src/screens/settings.js::fillWhisperCard`
  - Row now renders a source pill (`Installed` / `HuggingFace cache` / `Custom dir` / `System dir`) with the path in the `title` attribute.
  - External-source rows expose only a **Use it** button (sets `.default`); Delete button is hidden — we don't own those files.
  - App-managed rows unchanged (Set default + Delete).
- `app-tauri/src/screens/welcome.js` — onboarding wizard goes from 4 steps to 5.
  - New `renderStep4Whisper(root, body, info)` between Connect sources (Step 3) and First topic (now Step 5).
  - Auto-fetches `api.whisperCatalogue()`. If any `installed:true` row comes back: shows "Found existing install" banner + tier radio list + **Use selected tier** + **Download a different tier** buttons.
  - If nothing installed: shows "No Whisper model detected" + recommended `small.en` prefilled + **Download selected** with live `whisper:download-progress` / `whisper:download-done` event streaming.
  - **Skip — set up later** button stores `localStorage['openreply.onboarding.whisper_skipped']` so the app knows to nudge via Settings later.
  - Legacy First-topic step (now Step 5) renumbered: button IDs `back-5`/`skip-5`/`start-5`.

## Tests

- `tests/transcribe/test_external_discovery.py` — new, 6 cases:
  - Discover HF hub snapshot (`source='hf_hub'`).
  - `OPENREPLY_WHISPER_MODELS_DIR` beats HF cache.
  - Nothing installed → empty.
  - `download_model` short-circuits when external exists (asserts `snapshot_download` NOT called).
  - `resolve_model_path` prefers app dir on conflict.
  - `catalogue()` carries `source` field + marks external as installed.
- `tests/transcribe/test_models_catalogue.py` — updated 2 existing cases to stub `model.bin` + `tokenizer.json` (previously just `mkdir`'d an empty dir; the new validity check requires both files).

## Docs

- `docs/video-ingest.md` — new §21.5 **Reuse already-installed Whisper models** (7 subsections covering resolution priority, return shape, download short-circuit, loader change, Settings UI, onboarding step, power-user env override, test coverage).
- Guarantees list grew from 9 → 11 items.

## Verification

- `pytest -q tests/transcribe/ tests/ --ignore=tests/test_integration.py` — **68 passed, 1 skipped** (was 62 passed; +6 new discovery tests, 2 updated).
- `node --check` on every modified JS file — syntax clean.

## Files Created

- `tests/transcribe/test_external_discovery.py`
- `changelogs/2026-04-21_20_whisper-reuse-and-onboarding.md`

## Files Modified

- `src/reddit_research/transcribe/__init__.py`
- `src/reddit_research/transcribe/models.py`
- `src/reddit_research/transcribe/whisper.py`
- `src/reddit_research/cli/main.py`
- `tests/transcribe/test_models_catalogue.py`
- `app-tauri/src/screens/settings.js`
- `app-tauri/src/screens/welcome.js`
- `docs/video-ingest.md`

## UX summary

| Scenario | Before this change | After this change |
|---|---|---|
| User has `small.en` in `~/.cache/huggingface/hub/` from another project | Settings → Download (re-downloads 480 MB) | Settings → `small.en · HuggingFace cache` → **Use it** (0 MB) |
| Onboarding first-run, nothing installed | (no Whisper step) | Step 4 shows recommendation + Download button with progress |
| Onboarding first-run, already has `large-v3` | (no Whisper step) | Step 4 auto-selects the found tier, user clicks "Use it", continues |
| Shared machine with `OPENREPLY_WHISPER_MODELS_DIR=/shared/…` | Would re-download per user | All users reuse the shared copy |
| Downloaded via the app previously | Works | Works (tagged `source:'app'`, Delete button shown) |
