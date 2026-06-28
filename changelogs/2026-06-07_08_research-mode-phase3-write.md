# Research Mode — Phase 3 (Write: outline → draft → citations)

**Date:** 2026-06-07
**Type:** Feature

## Summary

The paper-writing surface (`#/write/<topic>`) ties together the existing
generation + export backend into one flow: generate a grounded outline, generate
a draft (IMRaD / review / thesis), and export the bibliography in BibTeX / RIS /
APA / Markdown. UI-only — reuses paperOutlineGenerate, paperDraftGenerate, and
papersExport. Discoverable from the Papers tab via new "Lit matrix" + "Write"
toolbar links.

## Changes

- **`screens/write.js`** + route `#/write/<topic>`: Outline (defensive renderer
  for string/list/object shapes), Draft (style select + copy), Citations export
  (4 formats → textarea + copy).
- **Papers tab**: "Lit matrix" and "Write" buttons in the toolbar.

## Verification

- `node --check` clean on write.js / main.js / papers.js.
- Reuses backend verified earlier (outline→r.outline, draft→r.markdown,
  export→r.text).

## Files Created
- `app-tauri/src/screens/write.js`, `changelogs/2026-06-07_08_research-mode-phase3-write.md`

## Files Modified
- `app-tauri/src/main.js` (route+import), `app-tauri/src/screens/papers.js` (toolbar links)
