# OpenReply App Analysis — 2026-06-28

## Environment
- Project root: `/Users/shantanubombatkar/Documents/GitHub/reddit-myind`
- Python venv: `.venv/`
- Tauri dev app: `app-tauri/`
- Sidecar: `target/debug/openreply` + `.venv/bin/python -m openreply.cli.main daemon`
- Vite dev server: `http://localhost:1420`
- Tauri app window: `OpenReply`, bounds `{X:165, Y:83, W:1380, H:880}`

## Launch status
- `npm run tauri dev` compiles and launches in ~18 seconds.
- Sidecar daemon pre-warms successfully.
- Debug builds open Web Inspector automatically, which covers the lower half of the window and makes lower-sidebar navigation hard during manual GUI testing.
- `localStorage` flag `or-onboarded` is persisted across restarts, so the Welcome screen is skipped after first run. A fresh install still requires name + AI provider key.

## Verified flows

### X / Twitter
- Watch-accounts page tracks accounts and pulls posts (e.g. `@athcanft` — 25 posts pulled).
- X Account page renders real `@elonmusk` posts with likes / retweets / replies.
- CLI works: `x-account fetch-posts elonmusk --count 3`.

### Reddit
- `creds preview --source reddit` returns RSS posts.
- GUI renders `reddit_free` opportunity cards.
- Analytics shows sources such as `hn`, `x`, `notion`, `obsidianmd`, etc.

### Reply / Opportunities
- Opportunities page renders scored cards from X and `reddit_free`.
- `reply platforms` lists all supported platforms.

### Connections
- Reddit — connected as `u/acme_dev`, verified 2d ago.
- X / Twitter — not connected, requires cookie login (`auth_token`, `ct0`).
- LinkedIn — not connected, requires cookie login (`li_at`).
- Hacker News — public, ready.
- Bluesky — API key.
- Mastodon — optional instance URL.

## LinkedIn gap
LinkedIn is currently only a **public URL reader**. It reads a public LinkedIn URL via Jina and forwards a stored `li_at` cookie if present, but has no keyword/topic search or feed discovery.

Files involved:
- `src/openreply/sources/linkedin.py` — `fetch_linkedin` returns `[]` unless a LinkedIn URL is supplied.
- `src/openreply/research/reach_connections.py` — `_fetch_rows("linkedin")` returns `[]`.

To make LinkedIn a first-class source:
1. Add authenticated scraping using the `li_at` cookie.
2. Implement a LinkedIn search/feed fetcher in `src/openreply/sources/linkedin.py`.
3. Wire it into `_fetch_rows("linkedin")` in `src/openreply/research/reach_connections.py`.

## Browser / DevTools issues (cosmetic)
- Tailwind CSS CDN production warning.
- Lucide icon name `twitter` not found; should use `x` / `x-twitter`.
- `favicon.ico` 404.
- DOM warning: password field not inside a `<form>`.

These do not block core flows.

## UI/UX concern: sidebar redundancy
The current sidebar contains multiple overlapping controls that create confusion:
- **Settings** link in the sidebar.
- **User icon / profile** area at the bottom of the sidebar.
- **Theme toggle** at the bottom of the sidebar.
- Account-level items (X Account, Connections, Settings, Plans) mixed with product navigation.

Plan: consolidate these into a single account/profile menu (bottom-left user icon / avatar) that opens a popover containing:
- Profile / account settings
- Theme toggle
- Settings shortcut
- Log out / reset (if applicable)

Remove the standalone Settings link, standalone Theme toggle, and redundant user icon from the sidebar to reduce clutter.
