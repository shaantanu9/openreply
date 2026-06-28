# Tab Strip Chrome-Style Sticky Shell Scroll

Date: 2026-04-22
Scope: App shell layout and tab-strip behavior

Why:
- Tab strip should behave like Chrome tabs: always visible at the top while page content scrolls independently.

Changes:
- Locked window-level scrolling by setting `body` to `overflow: hidden`.
- Locked app-shell scrolling by setting `.app` to fixed viewport layout (`height: 100vh`, `overflow: hidden`).
- Kept the tab strip sticky at the top so it remains pinned while `main` content scrolls.

Files touched:
- `app-tauri/src/style.css`

Validation:
- Manual verification recommended:
  - Open long screen content.
  - Scroll content area.
  - Confirm tab strip remains pinned at top and does not scroll away.

Risks / follow-ups:
- On very small viewports, verify no clipping in routes with custom full-height panels.
