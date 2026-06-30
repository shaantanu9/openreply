# Markdown rendering across the app + Telegram

**Date:** 2026-06-30
**Type:** Fix | UI Enhancement

## Summary

Generated content (post/article drafts, the chat assistant, the Daily Update
digest) was rendering raw markdown — users saw literal `**bold**`, `## heading`,
`- bullet` and `[text](url)` instead of formatted text. A complete, XSS-safe
markdown renderer already existed at `app-tauri/src/or/markdown.js` (its own
header comment says it's "shared by Compose, Inbox, Queue and any other surface
that shows LLM-generated text") but it was **imported and used by nobody** — the
author wrote the tool and never wired it in. Every display surface did a raw
`esc(body)`.

This change enhances that renderer, adds themed `.or-md` styling, and wires it
into the read-only generated-content surfaces in the app. It also adds a
markdown→Telegram-HTML converter so Telegram briefings/previews render properly
instead of showing raw `**`.

Copy is unaffected and still correct: the in-app Copy buttons and the Telegram
tap-to-copy `<code>` blocks return the **raw markdown source**, which is what
should be pasted into Reddit (Reddit renders markdown).

## Changes

- `markdown.js`: enhanced `renderMarkdown`/`inlineMd` — added `[text](url)`
  links with safe-scheme validation, bare-URL autolinking (guarded so it never
  corrupts an existing `href`), ordered lists (`1.`), `__bold__`, `~~strike~~`,
  and a new `inlineMdMultiline()` helper for chat-bubble contexts (inline marks
  + `•` bullets + `<br>` line breaks, no block `<p>`/`<h1>` wrapping).
- `styles.css`: added theme-aware `.or-md` styles (headings, lists, code, pre,
  blockquote, links, hr) so rendered markdown looks right in light + dark, with
  tight spacing tuned for cards. Ships in the bundled stylesheet (offline-safe).
- `dynamic.js`: imported the renderer and wired it into:
  - the article/post draft viewer (was `esc(body)` + `whitespace-pre-wrap`),
  - the Queue draft preview card,
  - `formatChatReply()` — rewritten to format markdown via `inlineMdMultiline`
    **and** preserve the trailing trusted action-button HTML (which the old
    `esc()`-first approach was silently escaping into visible `<div>` text). Now
    handles `[links](url)` and `•` bullets the old formatter dropped.
  - the chat "what's new / daily update" digest builder: switched `_source_`
    underscore-italic to `*source*` so it renders.
  - **Compose draft card** (`contentCard`) and the **Inbox reply editor**
    (`renderEditor`): added a `Write` / `Preview` segmented toggle. Write keeps
    the editable textarea (raw markdown — correct for editing + copy/paste to
    Reddit); Preview renders the live `.or-md` formatted view of the current
    textarea content. Wired through the existing delegated handlers
    (`data-cm-act` for Compose, `data-do` for Inbox).
- `notify.py`: added `_md_to_html()` — converts lightweight markdown to
  Telegram-safe HTML (escapes `&<>` first; each rule needs matched delimiters so
  a truncated `**` is left literal rather than 400-ing Telegram on a malformed
  tag). Applied to the read-only `digest`, `geo`, article-preview and
  content-item-preview formatters. The reply-due draft and the "Copy text"
  output keep their raw `<code>` blocks (tap-to-copy source for Reddit).

## Files Modified

- `app-tauri/src/or/markdown.js` — enhanced renderer + `inlineMdMultiline`
- `app-tauri/src/styles.css` — `.or-md` theme-aware markdown styles
- `app-tauri/src/or/dynamic.js` — wired renderer into draft viewer, Queue
  preview, chat formatter; digest italics fix
- `src/openreply/reply/notify.py` — `_md_to_html()` + applied to read-only
  Telegram surfaces

## Verification

- `vite build` — clean (1718 modules; `.or-md` CSS bundled).
- `python3 -m py_compile notify.py` — OK.
- `_md_to_html` unit-spot-checked: bold/italic/links/bullets/headings render;
  unbalanced `**` left literal; `snake_case`/URLs with `_` not mangled.
