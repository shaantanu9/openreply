# Repurpose content kind + Watch → Compose one-click rewrite

**Date:** 2026-06-28
**Type:** Feature

## Summary

Added a `repurpose` content kind that rewrites a source post in the agent's own
voice. Paired with a Watch screen "Rewrite →" button per post that stores the
tweet text in sessionStorage and navigates to Compose, pre-filling the context
textarea and selecting the Repurpose pill automatically.

## Changes

- **`reply/content.py`** — added `"repurpose"` to `_KIND_SPECS`, `_CONTEXT_KINDS`,
  and `_KIND_TOKENS` (700 tokens). Prompt instructs the LLM to keep the insight
  and shed the original framing entirely. Context block is labelled `SOURCE POST`.
  Added `elif kind == "repurpose":` branch in `generate_content` so the context
  is validated and passed correctly without touching followup logic.
- **`reply/accounts.py`** — `fetch_account` sample items now include a `text`
  field (`selftext`/`body`/`title`, up to 500 chars) so the Watch screen has
  full post text to pass into the compose context (not just the 120-char title).
- **`app-tauri/src/or/dynamic.js`** — Compose UI:
  - Added `["repurpose", "Repurpose"]` pill to the `KINDS` array.
  - Added `cm-repurpose-div` panel inside `cm-ctx` with a 5-row textarea and
    helper text.
  - Extracted `_applyKind(k)` helper to keep all panel visibility (fmode toggle,
    fmode-reply, fmode-sequence, repurpose-div) in sync on every kind switch.
  - Generate handler: `repurpose` case reads `cm-repurpose-text` and gates on
    non-empty value, passing it as `contextText`.
  - SessionStorage pickup on mount: reads `or-repurpose-ctx`, removes it, then
    pre-selects the repurpose pill, runs `_applyKind("repurpose")`, and fills
    the textarea — so the user lands in the right state immediately.
- **Watch screen** — replaced the old static `<a href="#/compose">` link with:
  - Per-post `Rewrite →` button that stores `{title, text}` to sessionStorage
    and navigates to `#/compose`.
  - General `Open Compose (Repurpose) →` button that stores the combined titles
    of all fetched posts.

## Files Modified

- `src/openreply/reply/content.py`
- `src/openreply/reply/accounts.py`
- `app-tauri/src/or/dynamic.js`

## User flow

1. Watch screen → Fetch posts for @handle
2. Click **Rewrite →** next to any post
3. App navigates to Compose with **Repurpose** pill selected and the post text
   pre-filled in the context textarea
4. Optionally adjust the angle, select platform, click **Generate**
5. Draft lands in Recent drafts for edit/publish
