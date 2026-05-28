# Sentiment "Analyzing…" Loader — Full-Bleed Hero with Live Progress

**Date:** 2026-05-28
**Type:** UI Enhancement

## Summary

The old Sentiment tab loader was a single line of grey text:
`Analyzing sentiment per source… 30-90 seconds.` Sitting on it for the
30-90 seconds of an LLM round-trip felt frozen — users couldn't tell
if the app was working or hung, and the loader didn't take the proper
page real estate.

Rebuilt as a full-bleed status panel that actually feels alive:

- **44px orange spinner** at the top (uses the existing `spin`
  keyframe + accent gradient — matches the in-app design language).
- **Cycling stage messages** that walk through what's happening
  ("Connecting to LLM…" → "Sampling posts from each source…" →
  "Reading what the community actually says…" → 4 more) every ~9 s
  so the page never looks frozen even on slow LLM round-trips.
- **Live elapsed-seconds counter** ticking every 1 s with
  `font-variant-numeric: tabular-nums` so the digit doesn't jiggle.
- **Asymptotic progress bar** filling 0 → 90% on a `1 - e^(-t/45)`
  curve (50% at ~30 s, 75% at ~60 s, 86% at ~90 s, never hits 100%
  until the API resolves) — feels like progress without lying about
  an unknown ETA. Snaps to 100% the moment the real response lands
  so the bar "completes" instead of disappearing mid-fill.
- **Skeleton preview cards** mirroring the eventual `.sent-grid`
  layout (3 cards with shimmer placeholders for title/meta/emotion
  chips/summary/quote) so the page doesn't reflow when real cards
  drop in.
- **Self-cleaning interval**: the `setInterval` has both an explicit
  cleanup function (called by `runAndRender` on success/skip/error)
  and a detached-DOM guard so it can't keep firing if a caller
  forgets the cleanup hook.

Also fixed the secondary loader that ran when an enrich is already
in flight in another tab (`_sentimentRunning.has(topic)` branch) —
previously it showed the same dead text line and the user had no
way to know if the other tab was actually progressing. Now it shows
the same full-bleed hero AND polls every 1.5 s for completion, so
the tab auto-renders the moment the other tab's run lands.

## Changes

- `screens/sentiment.js`:
  - New `SENT_STAGES` constant — 7 messages walked through over the
    expected 30-90 s window.
  - New `renderAnalyzingState(contentEl, opts?)` helper — mounts the
    full loader markup, starts the elapsed/stage/progress interval,
    and returns a cleanup function (with optional
    `snapToComplete:true` flag for the success transition).
  - `runAndRender` now calls `renderAnalyzingState` instead of
    inlining the dead text line, and invokes the returned cleanup
    on every exit path (success / skip / error).
  - `loadSentiment`:
    - Initial DB-read placeholder upgraded from `loading…` to the
      shared `map-building-spinner` pattern used everywhere else.
    - The "already running in another tab" branch now mounts the
      full hero with a `headline: "Analyzing sentiment per source
      (in another tab)"` override, plus a 1.5 s poll for completion
      that re-renders automatically when data lands or the in-flight
      flag clears.

- `style.css` (appended next to the existing `.sent-*` rules):
  - `.sent-analyzing` container.
  - `.sent-analyzing-hero` — 36×28 padded card with centered flex
    column layout.
  - `.sent-spinner-lg` — 44px circular spinner, orange top stroke,
    reuses the existing `spin` keyframe.
  - `.sent-analyzing-title` / `.sent-analyzing-stage` /
    `.sent-analyzing-elapsed` / `.sent-analyzing-eta` / `.sent-analyzing-meta`.
  - `.sent-progress-bar` + `.sent-progress-fill` — orange-to-peach
    linear gradient with a continuously-running 80px shimmer
    overlay (`@keyframes sent-progress-shimmer`) so the bar still
    looks alive when the JS-driven width updates pause briefly.
  - `.sent-grid-skel` / `.sent-card-skel` variant of the existing
    `.sent-card` rule that hosts shimmer placeholders.

## Files Created

- `changelogs/2026-05-28_05_sentiment-analyzing-loader.md`

## Files Modified

- `app-tauri/src/screens/sentiment.js` — added `SENT_STAGES`,
  `renderAnalyzingState`, rewired `runAndRender` and `loadSentiment`.
- `app-tauri/src/style.css` — appended `.sent-analyzing-*`,
  `.sent-spinner-lg`, `.sent-progress-bar/fill`, `.sent-grid-skel`
  rules + the `sent-progress-shimmer` keyframe.

## Verification

- `node --check src/screens/sentiment.js` → clean.
- `node --check src/main.js` → clean.
- Vite dev server (port 1420) serving the updated files — confirmed
  via `curl http://localhost:1420/src/screens/sentiment.js | grep
  renderAnalyzingState` (9 matches) and `… /src/style.css | grep
  sent-analyzing-hero` (1 match).
- **GUI runtime verification: BLOCKED** — no Playwright/xvfb
  plumbing in the repo, can't drive the Tauri window from this
  terminal. User must reload the app + click Sentiment to confirm
  visual behavior. See "Manual Test Notes" below.

## Manual Test Notes

In the running Gap Map app:
1. Open any topic with collected posts.
2. Click the **Sentiment** tab.
3. If sentiment hasn't been run yet for this topic, you should see:
   - 44 px orange spinner at the top of a full-bleed white card.
   - Headline: "Analyzing sentiment per source".
   - Stage line that changes every ~9 s
     ("Connecting to LLM…" → "Sampling posts from each source…" → …).
   - "Ns elapsed · typically 30–90 seconds" below the stage line.
   - Progress bar that fills smoothly from 0% toward 90%, with a
     subtle shimmer sliding left-to-right across it.
   - 3 skeleton cards below the hero, mirroring the layout the real
     cards will use.
4. When the LLM call completes, the bar snaps to 100% for a beat,
   then the real `.sent-card` grid replaces the skeleton with no
   visible page reflow.
5. To see the secondary loader: open the same topic's Sentiment tab
   in two tabs while a run is in flight — the second tab shows
   "(in another tab)" in the headline and auto-renders when the
   first tab's run lands.
