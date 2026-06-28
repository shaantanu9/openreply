# Tab Sticky Fix and Skill Update

Date: 2026-04-22
Scope: App shell scrolling behavior + internal troubleshooting skill

Why:
- Tab strip still did not behave like Chrome in all cases; users reported it moved during scroll.

Changes:
- Strengthened shell-level scroll ownership so window/body do not scroll:
  - Added `html { overflow: hidden; }`.
  - Kept `body { overflow: hidden; }`.
- Made right-side app shell explicit full-height:
  - `.app .main-col { height: 100vh; }`.
  - `.app .main-col > main.main { height: 100%; overflow-y: auto; min-height: 0; overscroll-behavior: contain; }`.
- Updated project skill docs with a dedicated "Chrome-style sticky tab strip" checklist.

Files touched:
- `app-tauri/src/style.css`
- `docs/skills/topic-tab-stability/SKILL.md`

Validation:
- Manual:
  - Open a long page in app.
  - Scroll repeatedly with trackpad/mouse wheel.
  - Confirm only content area scrolls and top tab strip stays pinned.

Risks / follow-ups:
- At narrow breakpoints, re-check interactions with mobile/stacked sidebar rules to ensure no clipping.
