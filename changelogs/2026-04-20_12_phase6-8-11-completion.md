# Phase 6/8/11 completion — onboarding, chat sidebar, dark mode, shortcuts

**Date:** 2026-04-20
**Type:** Feature + UI Enhancement

## Summary

Ships the three remaining ROADMAP phases that round out the OpenReply UX:

- **Phase 6 — Onboarding & empty-state polish:** Dashboard 0-topic empty state
  replaced with 5 quick-start chips (AI coding assistants / sleep tracking /
  no-code builders / meditation / resume builders) plus a "custom topic" button.
  Clicking a chip jumps straight to `#/collect/<topic>` — fresh install → first
  Minto brief in ≤30 s of user action. Insights empty state now surfaces
  contextual CTAs (Settings button when LLM key missing, "Collect posts first"
  when corpus empty).
- **Phase 8 — In-product chat sidebar on Insights:** Collapsible right-hand
  `<aside>` on the Insights tab with 4 pre-seeded prompt chips (top risks /
  main incumbent / cheapest test / US vs EU). Reuses the existing `startChat`
  streaming API with `agent=true` so tool-use is available. History persists
  per-topic in localStorage. Opens/closes with `⌘/` keyboard shortcut.
- **Phase 11 — UI polish cluster:** Dark mode toggle in Settings (applied at
  boot, before first render, to prevent flash). Dense finding cards toggle
  (Tier-1 chips only: Ulwick / triangulation / counter-evidence / research-link;
  hover to expand). New keyboard shortcuts: `⌘K` (global search), `⌘,` (settings),
  `⌘/` (toggle chat sidebar), `J`/`K` (navigate hypothesis cards).

## What's deferred

- **Phase 7 PDF export** — See `docs/manual-todo/phase7-pdf-export.md`. The
  clipboard markdown / hypotheses / Slack exports from yesterday's bundle cover
  90% of the "shareable brief" use case. PDF blocked on bundle-size cost
  (weasyprint = +30MB) and unclear user demand. Revisit with playwright-based
  approach when ≥3 users request it.
- **Phase 11 topic comparison view** (1 day) and **progressive insights during
  collect** (1 day) — deferred to a separate UX-focused cycle. The core
  retention loop (Minto brief + bets + monitoring + chat + export) is complete.

## Changes

### Frontend JS
- `app-tauri/src/main.js`
  - New early-prefs IIFE applies dark-mode/dense-cards classes to `<html>`
    before DOMContentLoaded → no flash on boot
  - `wireKeyboard`: added `⌘K` / `⌘,` / `J`/`K` shortcuts; `J`/`K` skips when
    user is typing in an input/textarea
  - Shortcuts help modal lists all new bindings
- `app-tauri/src/screens/home.js`
  - Dashboard 0-topic empty state: quick-start chips + custom-topic button
- `app-tauri/src/screens/insights.js`
  - New two-column layout: `.insights-main` + `.insights-chat-aside`
  - New `wireChatSidebar(contentEl, topic)` with per-topic history persistence,
    streaming subscription, `⌘/` toggle, prompt-chip one-click send
  - `renderEmpty` now detects key/post issues in the error reason and surfaces
    targeted CTAs (Open Settings / Collect posts first)
  - New "Ask" button in the Insights toolbar toggles the sidebar
- `app-tauri/src/screens/settings.js`
  - Preferences card: "Dark mode" and "Dense finding cards" toggles
  - Change handlers write to localStorage and toggle `<html>` classes live

### CSS
- `app-tauri/src/style.css`
  - `.quick-start-chips` + `.quick-start-chip` (Phase 6)
  - `.insights-with-sidebar` grid layout + `.insights-chat-aside` with ica-*
    sub-elements, chips, message styling, sticky positioning (Phase 8)
  - `html.dense-cards` tier-1 chip filtering + hover expand (Phase 11)
  - `html.dark` CSS variable overrides covering cards, inputs, modals, matrix
    table, chat sidebar, dropdown menus (Phase 11)

### Docs
- `docs/manual-todo/phase7-pdf-export.md` — deferral reasoning + when to
  revisit + playwright-based implementation sketch

## Files Created

- `docs/manual-todo/phase7-pdf-export.md`
- `changelogs/2026-04-20_12_phase6-8-11-completion.md`

## Files Modified

- `app-tauri/src/main.js` — early prefs + new shortcuts + updated help panel
- `app-tauri/src/screens/home.js` — quick-start chips empty state
- `app-tauri/src/screens/insights.js` — chat sidebar, better empty state
- `app-tauri/src/screens/settings.js` — dark-mode + dense-cards toggles
- `app-tauri/src/style.css` — CSS for all Phase 6/8/11 surfaces
