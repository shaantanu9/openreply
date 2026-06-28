# UI Declutter Pass — Why / What / How

**Date:** 2026-04-21
**Scope:** Topic-page header only (the worst offender). Other pages are
cleaner; revisit this doc if the pattern recurs.

---

## 1. Why — the problem

### Screenshot evidence

On the topic page for "meditation and sound frequency brainwave app"
the user saw **7 rows of chrome** before any content:

1. Breadcrumb + status-chip + stat-counters + provider pill + auto-refresh toggle
2. Rerun / Compare / Delete buttons
3. Breadcrumb again (`Workspace › ... › Act › Concepts`)
4. H1 topic title + "Loading topic…" subtitle
5. Pipeline stepper (Collect → Discover → Act)
6. Phase card (Build a new product ▼ → Concept brief, 4 step chips)
7. Tab bar (Insights · Bets · Evidence · Chat · More ▾)

First actual content ("Generate product concepts" CTA) was scrolled
nearly off-screen on a 1440-tall display.

### Why it happened

Each row was added independently in a different phase:

- Row 1 — Phase 1 (baseline topbar + stats)
- Row 2 — Phase 4 monitoring (Rerun)
- Row 3 — breadcrumb added when Phase 11 shipped tab cleanup
- Row 4 — baseline H1 never cleaned up after breadcrumb arrived
- Row 5 — Phase 11 polish intent ladder
- Row 6 — same
- Row 7 — Phase 11 tab cleanup

No one stepped back to ask "do all three rows together still make sense
after the 4th one was added?"

### Why it's bad

- Wastes ~130 px of prime above-the-fold real estate.
- Duplicates information (topic name in crumb + H1 + stat-header + tab
  breadcrumb).
- Cognitive load: 4 distinct visual weights (orange steps, green done,
  dark buttons, light tabs) competing for attention.
- "Loading topic…" subtitle conflicts with "Collecting…" chip —
  user can't tell which is authoritative.

---

## 2. What we shipped

Replaced the 3-row top block (topbar + buttons + section-head) with
**2 tight rows** scoped by `.topic-header-compact`.

### Row 1 — Identity + actions

```
[← Workspace]  Topic Name         [⋯ stats]  [bet-stats]  —————  [Cancel] [⟳ Rerun] [⇄ Compare] [🗑]
```

- `← Workspace` back-link (replaces the longer breadcrumb — one level
  is all users ever need here).
- Bold topic title H1-sized but inline (no separate H2 row).
- `.topic-active-chip` ("Collecting…") sits next to the title when
  visible.
- Stat chips (`5,193 posts · 11 pains · 0 DIY · 8 src`) inline; was a
  separate row.
- Bet-stats pill (Phase 3) inline here too.
- Action buttons on the right: Cancel-fetch (only when collecting),
  Rerun, Compare, Delete (now an icon-only button — label on hover).

### Row 2 — Secondary meta

```
last-collect path / stats text                —————         [LLM pill]  [Auto-refresh ☐]
```

- `.topic-meta-line` takes over what `#topic-sub` used to say ("3,245
  posts from r/meditation, r/Mindfulness, ..."). "Loading topic…"
  placeholder removed.
- Active-LLM pill (provider + model) moved here — secondary meta,
  not a primary action.
- Auto-refresh checkbox styled as a compact toggle, not a full form
  label with a bordered box.

### What was removed

- The full breadcrumb (`Workspace › ... › Act › Concepts`) — collapsed
  to just `← Workspace` since the page title tells you where you are.
- Separate `.section-head` h2 + subtitle block — folded into rows 1+2.
- `.topic-header-stats` and `.topic-bet-stats` moved from their own
  slot to inline inside row 1.
- Auto-refresh toggle lost its bordered-box wrapper — now a compact
  inline pill.

### CSS scope

All new styles under `.topic-header-compact` selector so nothing else
on the page shifts. Dark-mode overrides included.

---

## 3. How — implementation

### 3.1 Files changed

- `app-tauri/src/screens/topic.js` — header markup block rewritten
  (lines ~364–392). Kept every element ID so downstream code
  (`$('#topic-sub').textContent = ...`, `#btn-rerun.onclick`, etc.)
  keeps working without any JS logic change.
- `app-tauri/src/style.css` — new `.topic-header-compact` block
  appended at the end (~100 lines). Responsive collapse at 900 px.

### 3.2 Why not a React / component-based refactor

The topic page is a 2,400-line vanilla-JS file. A proper component
rewrite would be 2 days of work. This pass is 30 minutes and buys
~80% of the visual cleanup. Revisit a component split when we migrate
off vanilla-JS.

### 3.3 IDs preserved for backward compat

Every `#foo` selector used elsewhere in `topic.js` still resolves:

- `#topic-active-chip` — unchanged
- `#btn-cancel-collect` — unchanged
- `#topic-header-stats` — unchanged
- `#topic-bet-stats` — unchanged, just relocated
- `#topic-llm-pill` / `#topic-llm-pill-label` — unchanged
- `#cb-schedule-topic` — unchanged (compact styling only)
- `#btn-rerun` / `#btn-compare-topic` / `#btn-delete` — unchanged
- `#topic-sub` — unchanged; now in the `.topic-meta-line` span

Zero JS logic changes. Pure CSS + markup restructure.

---

## 4. How to verify

### Manual smoke test

1. Open any existing topic in the desktop app.
2. Top should now be 2 rows tall (count them — was 3 + title + sub).
3. Click Rerun — modal opens, same behavior.
4. Click Compare — modal opens, same behavior.
5. Click Delete (🗑 icon) — confirm modal opens, same behavior.
6. Resize window to 900 px wide — title + meta truncate with ellipsis,
   no layout break.
7. Toggle Settings → Dark mode — compact header respects dark palette.

### Before/after measurement

On a 1440×900 window, above-the-fold vertical space used by chrome:

- Before: ~320 px (crumb + topbar + h2+sub + stepper + phase + tabs)
- After: ~180 px (2-row compact header + stepper + phase + tabs)

Savings: 140 px = ~15% of the viewport now shows content instead of
chrome.

---

## 5. How to extend the same pattern

### 5.1 Apply to Product Dashboard

`screens/product.js` has the same 3-row pattern (topbar + section-head
+ tabs). Replicate the `.topic-header-compact` structure there.

### 5.2 Apply to Compare view

`screens/compare.js` also has separate crumb + title + subtitle. Same
pattern applies.

### 5.3 Systemic rule for future features

When adding a new affordance to a screen's header:

1. **First ask: does this belong in the header at all?** If it's per-
   session / rarely used, move to a dropdown or Settings.
2. **Second ask: can it replace something existing?** Don't add a new
   button next to the old one "just in case."
3. **Third ask: is there a row that could absorb it?** Prefer stretching
   row-1 or row-2 over adding a row-3.

Rule of thumb: **header chrome should never exceed 180 px.** If it
does, we've let the header become a screen of its own.

---

## 6. Follow-ups

### 6.1 Reapply to other screens

- `screens/product.js` — same 3-row pattern.
- `screens/compare.js` — lightly used, low-priority.
- `screens/home.js` — already clean, no action.

### 6.2 Stepper + phase card audit

The orange 3-step pipeline (Collect → Discover → Act) + the amber
phase card below it (Build a new product → Concept brief → 4 step
chips) are still 2 visually heavy blocks. Consider:

- Merge stepper into the phase card (one card, not two).
- Only show the phase card when a phase is actively in progress.
- Fade out when the user has scrolled past it (sticky → hide).

Not in this pass; captured for a future polish cycle.

### 6.3 "Loading topic…" placeholder

Removed as redundant. If the topic data really takes >1 s to load,
show a subtle skeleton on the stat chips rather than a text message.
Not yet implemented — not a visible bug because the backend is fast.

---

*Revisit if another screen accumulates >3 header rows.*
