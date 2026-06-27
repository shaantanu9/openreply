# Tauri app — OpenReply UI port (research UI removed)

**Date:** 2026-06-27
**Type:** Feature | Refactor

## Summary

Ported the OpenReply prototype UI into the real Tauri app, using it as boilerplate.
The app now opens to the OpenReply Agents dashboard with the full Tailwind + Lucide UI,
grouped sidebar, dark/light theme, and hash-routed navigation across all 16 views —
matching the prototype. The old research/academic/product frontend was removed.
UI only; backend functions are wired later (the reply/agent/content Rust commands exist).

## Changes

- `index.html` rebuilt as the OpenReply shell (Tailwind Play CDN + config, Lucide CDN,
  theme pre-init, sidebar mount + `#main-content` view container).
- `src/main.js` replaced with a small hash router (`#/agents`, `#/inbox`, …) that renders
  views into `#main-content` and mounts the shell.
- `src/or/views.js` — auto-generated from `prototype/*.html` (16 views: agents, agent,
  inbox, opportunities, compose, queue, keywords, subreddit, knowledge, analytics, geo,
  connections, settings, pricing, alerts, onboarding); internal links rewritten to hash routes.
- `src/or/shell.js` — sidebar (hash nav + Lucide), theme toggle, agent switcher,
  toast/modal helpers, global button feedback.
- `src-tauri/tauri.conf.json` — CSP `script-src`/`style-src` extended to allow the
  Tailwind + Lucide CDNs (`'unsafe-eval'` for Tailwind Play).
- Removed old frontend: `src/screens/`, `src/lib/`, `src/components/`, `src/style.css`,
  `src/openreply.css`, `src/icons.js`, `src/labels.js`. `package.json` test script reset.

## Verification
Rebuilt + relaunched `tauri dev` (incremental, no errors); app renders the OpenReply
Agents UI with sidebar/Lucide/theme; no CSP/console errors in the dev log.
