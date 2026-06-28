# Launch/GTM: deterministic persona + sequence fallbacks and honest LLM-error surfacing

**Date:** 2026-05-31
**Type:** Fix

## Summary

The Launch & GTM brief looked broken whenever the LLM augmentation didn't run.
End-to-end runtime tracing showed that the **Audience (ICP personas)** and
**Launch sequence** sections were populated *only* by the optional LLM pass —
so an offline build (`Build offline`) or any LLM failure (rate limit, bad/missing
key, network) produced a `ok:true` brief with `personas=0` and `launch_sequence=0`,
i.e. blank cards that read as a bug. Worse, LLM failures were swallowed silently
(`_llm_augment` returned `None`), so the user got an empty brief with no
explanation and no retry path.

This change makes the Launch brief never render those sections empty, and makes
AI failures explicit and recoverable. The Persona feature was also traced
end-to-end in the same pass and confirmed fully working (list + grounded chat with
memory citations) — no code changes needed there.

## Changes

- **Deterministic persona fallback** (`_personas_fallback`): when no
  audience/empathy/interview personas exist, derive up to 3 ICP personas from
  corpus occupation signals + the top engaged channels (with a friendly
  occupation-label map so `pm` → "Product Managers", not "Pms"). Each persona is
  anchored to real channel/author data.
- **Deterministic launch-sequence fallback** (`_launch_sequence_fallback`): a
  templated 3-step plan anchored on the topic's real top channels and best
  post-time window (owned → adjacent + Product Hunt → feedback/iterate + Show HN).
- **Safety net in `build_launch_brief`**: after the (optional) LLM pass, if
  personas or the sequence are still empty, fill them from the fallbacks and tag
  `personas_fallback` / `sequence_fallback` so the UI can label them.
- **LLM error surfacing**: `_llm_augment` now returns
  `{error, error_class}` on failure (was silent `None`).
  `build_launch_brief` propagates `llm_error` + `llm_error_class` onto the brief.
  New `_classify_llm_error` tags failures as `rate_limit` / `llm_key` /
  `llm_model` / `network` / `llm`.
- **Frontend**: new `llmErrorBanner()` shows an amber warning card with
  class-specific copy + a **Retry with AI** button when `llm_error` is present;
  the LLM status pill now reads `LLM ✓` / `AI failed` / `deterministic`;
  personas card and launch-sequence header show a "build with AI to refine" note
  when they're deterministic fallbacks.

## Verification

- Offline build on `calari tracking app`: was `personas=0, sequence=0` → now
  `personas=3, sequence=3` (both flagged `*_fallback:true`), anchored on real subs.
- Forced LLM failure (`--provider nonexistent`): `llm_error` surfaced,
  fallbacks still populate the sections.
- LLM success (nvidia): unchanged — `llm_augmented:true`, rich personas + JTBD,
  no fallback flags.
- `node --check src/screens/launch.js` passes; `npm test` → 50/50 pass.

## Files Modified

- `src/openreply/research/launch.py` — added `_channel_label`, `_personas_fallback`,
  `_launch_sequence_fallback`, `_classify_llm_error`; rewrote `_llm_augment` to
  return error info; added the deterministic safety net to `build_launch_brief`.
- `app-tauri/src/screens/launch.js` — `LLM_ERROR_COPY`, `llmErrorBanner()`,
  retry wiring in `wireActions`, fallback notes in `personasCard` and
  `launchSequence`, updated LLM status pill.

## Follow-up

- The bundled PyInstaller sidecar (`app-tauri/src-tauri/bin/openreply-cli-*`) must be
  rebuilt before the next DMG for the Python-side changes to ship; in
  `npm run tauri:dev` the dev venv picks them up immediately.
