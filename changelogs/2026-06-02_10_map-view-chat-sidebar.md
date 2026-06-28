# Map view — "Ask this map" chat sidebar with citation accordion

**Date:** 2026-06-02
**Type:** Feature

## Summary

Added a second, independent AI chat instance that lives as a **right-docked
full-height sidebar overlaying the Map tab's graph iframe** (the approved
`docs/design/chat-variants/v2-focus-canvas.html` prototype). It reuses the SAME
streaming backend as the existing Chat tab (`api.startChat` +
`chat:progress`/`chat:done` events) but keeps its own ephemeral in-topic history
and stream state, so the existing Chat tab is left completely untouched and
fully working. Citations/sources in each answer render as a collapsible
accordion.

## Changes

- **New toolbar button** `#btn-map-chat` ("Ask this map") in the Map tab toolbar.
- **New drawer markup** wrapping the graph iframe in a `.mapchat-host`
  (position:relative) with a `.mapchat-scrim` + `.mapchat-drawer` that slides in
  from the right and docks full-height over the iframe.
- **Self-contained map chat logic** in `renderTopic` closure:
  - `_mapChatLog` / `_mapChatStream` state (independent of the Chat tab maps).
  - `_mapChatSend()` — appends user + assistant bubbles, calls
    `api.startChat(topic, q, 'ask', false)`, subscribes to
    `api.onChatProgress`/`api.onChatDone`, appends `token`/`text` events,
    handles `error` + non-zero exit code, tears listeners down on finish.
  - `_mapChatBotHtml()` — renders the answer via `renderMarkdown`, splits a
    trailing "Sources"/citations block into a collapsible `.cite-acc` accordion.
  - `_renderMapChatLog()` / `_setMapChatBusy()` — render + busy/status helpers.
  - `wireMapChat()` — idempotent (`.onclick`) wiring for open/close/scrim, send,
    Enter-to-send + textarea autogrow, and delegated citation-accordion toggle.
- `wireMapChat()` is invoked from `_wireMapToolbarButtons()`, which runs on BOTH
  the fresh-render and cache-restore Map paths, so the sidebar works on every
  Map open (history persists across in-topic tab switches via the closure).
- **CSS** for `.mapchat-host/-scrim/-drawer/-head/-log/-msg/-typing/-status/
  -composer/-send` + `.cite-acc-head/.cite-acc-body` accordion, themed with the
  app tokens (`--orange`, `--surface`, `--line`, `--radius`).

## Verification

- `npm run build` succeeds (only pre-existing dynamic/static import warnings).
- `esbuild` parses `topic.js` with no syntax errors.
- `npm test` — all 50 tests pass.
- Drawer + citation accordion rendered headlessly against the built app CSS to
  confirm layout/theme.
- NOT yet exercised against a live LLM/sidecar in-session — the streaming path
  is a faithful reuse of the working Chat-tab calls (`api.startChat` +
  `onChatProgress`/`onChatDone`).

## Files Modified

- `app-tauri/src/screens/topic.js` — map-chat state, logic, drawer markup,
  toolbar button, `wireMapChat()` wiring.
- `app-tauri/src/style.css` — map-chat drawer + citation-accordion styles.
