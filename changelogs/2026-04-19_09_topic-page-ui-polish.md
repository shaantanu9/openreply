# Topic page UI polish bundle

**Date:** 2026-04-19
**Type:** UI Enhancement

## Summary

The topic detail page was functionally complete but had several rough edges: `alert()` dialogs for errors, generic "Error: …" empty states with no retry path, silent truncation of findings and subreddits, chat history lost on reload, a generic "Loading…" text on every tab, and no at-a-glance indicator of which LLM was actually wired up. This bundle upgrades all of those into polished, recoverable experiences without touching any feature logic — the chat / enrich / map / evidence / sources flows are unchanged.

## Changes

- **Toast system.** Added a bottom-right non-blocking toast stack (`.toast-stack` / `.toast`) with ok/warn/err variants. All `alert()` calls in `topic.js` replaced with `showToast(title, detail, kind)`.
- **Error cards with retry.** Replaced `<div class="empty-state">Error: X</div>` on Report / Evidence / Sources tabs with a styled `.error-card` that includes contextual actions: "↻ Retry", "Build gap map", "Add LLM key". Each error now gives the user a one-click recovery path instead of a dead message.
- **Skeleton loaders.** Report / Evidence / Sources tabs now show animated shimmer skeletons (`.skeleton-card`) matching the final card shape while loading, instead of a centered "Loading…" string.
- **Pagination.**
  - Evidence: findings cap in Rust raised from `LIMIT 20` to `LIMIT 100`. Frontend shows 20 per kind and renders a "Show N more" button that expands in pages of 20.
  - Sources: subreddit SQL raised from `LIMIT 12` to `LIMIT 60`. Frontend shows 12 and "Show more" reveals 12 at a time.
- **Chat history persistence.** `chatHistory` Map now hydrates from `localStorage` per topic (`openreply.chat.<topic>`, last 50 messages) and persists on every push. Reloading the app no longer wipes the conversation. Clear button also clears the stored copy.
- **Chat empty state upgraded.** When no LLM is configured, the empty state now lists which providers DO have keys saved (if any) and shifts the CTA from "Add a key" to "Pick default" when the user already has keys but no default picked.
- **Active LLM pill in header.** Small rounded pill next to the stats in the topic topbar shows `<provider> · <model>` (or "No LLM" when nothing is wired up). Click opens the BYOK modal; on close the pill repaints and the current tab refreshes if it was LLM-gated.

## Files Modified

- `app-tauri/src/style.css` — added `.toast-stack` / `.toast` / `.toast-err|warn|ok` / `.skeleton` / `.skeleton-card` / `.error-card` / `.active-llm-pill` / `.show-more-btn` primitives (~85 lines)
- `app-tauri/src-tauri/src/commands.rs` — `get_findings` SQL `LIMIT 20` → `LIMIT 100` to support client-side pagination without silent truncation
- `app-tauri/src/screens/topic.js` —
  - Added `CHAT_HISTORY_KEY`, `loadChatHistory`, `saveChatHistory` helpers for localStorage-backed chat history
  - Added `ensureToastStack`, `showToast`, `skeletonCards`, `errorCard`, `wireErrorCard` helpers
  - Added `paintLlmPill` in header, wired pill click to open BYOK modal
  - Replaced `alert(Build failed …)` and `alert(Delete failed …)` with toasts
  - Replaced `alert(errMsg)` in `runEnrichFromMap` with a `showToast('Enrichment issue', …, 'warn')`
  - `loadReport`, `loadEvidence`, `loadSources` all now use skeleton cards on mount + error cards with retry actions on failure
  - Evidence pagination via per-kind `evidenceVisible` counter + per-card "Show more" buttons
  - Sources subreddit pagination via `subsVisible` counter + "Show more" button
  - Chat empty state now enumerates configured providers and tailors copy accordingly
