# Markdown preview for drafts (Compose + Queue) — no more raw ** and #

**Date:** 2026-06-28
**Type:** UI Enhancement

## Summary

Content drafts (especially articles + YouTube scripts) contain Markdown that was
showing raw (`**bold**`, `# heading`, `- list`, `[VISUAL: …]`) in the textarea and
Queue preview. Added a small, dependency-free Markdown renderer and used it so
every content type displays properly: Compose draft cards get a **Preview ⇄ Edit**
toggle (rendered by default, textarea for editing), and the Queue body preview now
renders Markdown too.

## Changes

- `or/dynamic.js` `_md(src)` (new): safe Markdown → HTML — escapes HTML first,
  then renders headings, **bold**/*italic*, `code`, http links, bullet/numbered
  lists, blockquotes, rules, paragraphs, and styles `[VISUAL: …]` cues as chips.
- `_mdStrip(src)` (new): strips Markdown markers to clean text for compact previews.
- `contentCard`: **Preview / Edit** toggle — preview renders `_md(body)` (height-
  capped, scrollable), edit shows the textarea; save reads the textarea. Toggling
  to preview re-renders from the current edit value.
- Delegated `data-cm-mode` handler in `renderCompose` for the toggle.
- `renderQueue`: body preview now renders `_md(body)` (height-capped) instead of
  truncated raw text.

## Files Modified

- `app-tauri/src/or/dynamic.js` — `_md` / `_mdStrip`, contentCard preview toggle,
  Queue markdown preview.

## Verification

- `_md` unit sanity: bold → `<strong>`, headings, lists, `[VISUAL]` → chip, and
  **no raw `**` remains**. `node --check` clean.
- Pure JS — hot-reloads in the running app; no Rust/daemon rebuild.

## Notes

- Each content type renders cleanly: article (headings/bold/paras), YouTube
  (segment labels + `[VISUAL]` chips), thread (numbered parts), short script
  (HOOK/BEAT/CTA lines), post (plain).
