# Topic Detail v2 — minimize without removing anything

**Prototype:** [`docs/design/topic-detail-proto-v2.html`](./topic-detail-proto-v2.html)
**Supersedes:** v1 proto (user: "doesn't look good")
**Status:** 2026-04-21 design proposal
**Rule followed:** zero features removed, zero buttons deleted.
Progressive disclosure into icon buttons + overflow menu instead.

---

## The single UX principle driving this design

Every feature from the live app is present. The question is:
**how much screen weight does each affordance deserve?**

Three tiers:

| Tier | Who uses it | Weight | Placement |
|---|---|---|---|
| **T1 — always visible** | Everyone, every visit | Large, primary color | Next-action hero card + primary tabs |
| **T2 — common tools** | Most users, several times per session | Icon-only buttons with tooltip | Header action cluster (right edge) |
| **T3 — power / rare / destructive** | Advanced users or one-off actions | Hidden until summoned | ⋯ overflow menu |

Nothing moves below the fold. Nothing is removed. Everything scales by
usage frequency.

---

## What you'll see in the prototype

### Line 1 — Context (tiny, 20 px)

Just `← Workspace › meditation and sound frequency brainwave app`. One
row. Unobtrusive breadcrumb in `--ink-3` color.

### Line 2 — Header (40 px + stats strip)

Left:
- **Topic title** — 26 px bold, tight letter-spacing, one line ellipsis.
- **Live chip** — compact "Collecting" pill next to the title. Pulses
  when active. Clickable to view the log.

Right (action cluster, all icon buttons with tooltips):
- `Auto-refresh` (checkbox toggle — was a full bordered box, now slim)
- `LLM pill` (openrouter · model) — click to change provider
- Vertical divider
- `✕ Cancel fetch` (icon, shown only when collecting, rose tint)
- `⟳ Rerun`
- `⇄ Compare`
- `⤓ Export`
- `⋯ More` → drops down to:
  - Schedule runs
  - Open database
  - Import CSV into topic
  - Pin to favorites (⌘D)
  - Advanced: prompt override
  - Clean corpus (relevance gate)
  - **Delete topic** (rose, ⌫ shortcut)

Stats strip spans below: `5,193 posts · 11 painpoints · 0 DIY · 8 sources · 3 bets` in
tabular numerals. Clickable to drill into breakdown.

### Line 3 — Next-action hero (the biggest element)

A soft orange-tinted card with a 3 px left accent stripe:

```
┌─────────────────────────────────────────────────────────────┐
│ NEXT                                                         │
│ Generate product concepts from your 11 painpoints            │
│ The Concept Agent reads your painpoints, sentiment, and     │
│ workarounds and proposes 3-5 specific products ...          │
│ → Or skip to step 4 · Export concept brief                  │
│                                    [✨ Ideate concepts →]   │
└─────────────────────────────────────────────────────────────┘
```

Why this works:
- The user's eye lands here first. It literally tells them what to do next.
- One big CTA button with the brand color.
- A secondary "or skip to" link lets power users jump ahead.
- The card itself is elegant — gradient background, no harsh border,
  soft shadow, generous radius.

### Line 4 — Pipeline legend (slim, 36 px)

A single horizontal row of 4 step pills with arrows between:
`🚀 Build a new product › ✓ Collect › ✓ Solutions › 3 Generate concepts › 🔒 Export`

Each step is clickable to jump to that phase. Current step is the
only one with the orange-soft background. Done steps are mint text.
Locked is muted.

### Line 5 — Tabs (quiet, text-only)

Insights · Bets [3] · Evidence · Chat ... More ▾

No pill buttons. No background fills. Just underline-on-active.
Count chip on Bets when > 0.

### Content — cleaner and wider

- **Minto header** is now free-floating typography, not another card.
  Bigger and more confident (22 px, 600 weight, -0.01em letter-spacing).
  Three supporting arguments below as `border-left` quotes.
- **Findings grid** — cards with no static borders (appear on hover
  only). Each card has:
  - Kind emoji in a soft circle
  - Title
  - Opportunity score as plain typography (18 px bold, tabular, rose
    for high / orange for mid / muted for low)
  - 3–5 minimal chips (stripped from the 8+ in the live app)
  - 2-line narrative
  - Source badges + 👎 button (fades in on hover)

### Responsive

Breakpoint at 1024 px: action cluster wraps, stats strip wraps, Minto
args stack vertically. Title shrinks to 22 px.

### Dark mode

Full dark palette. Toggle via `☾ Dark mode` button top-right. Soft
orange tint on the hero card still reads correctly against the dark
surface.

---

## What's different vs. the live app — feature-by-feature

| Live app | v2 prototype | Feature kept? |
|---|---|---|
| Full breadcrumb "Workspace › Topic › Act › Concepts" | "← Workspace" + inline title | ✅ same info, cheaper |
| "Loading topic…" subtitle | removed (redundant with live chip) | ✅ info was duplicative |
| "Rerun collect" text button | Icon button ⟳ with tooltip | ✅ |
| "Compare" text button | Icon button ⇄ with tooltip | ✅ |
| "Delete" red text button | In ⋯ menu (rare + destructive) | ✅ |
| "Auto-refresh" bordered-box toggle | Slim pill toggle | ✅ |
| "LLM pill" with long text | Same pill, tighter | ✅ |
| Pipeline stepper (big horizontal) | Slim inline legend | ✅ |
| Phase card (full-width) | Next-action hero (more useful) | ✅ + improved |
| 4 stat chips top-right | 5 stats strip below header | ✅ |
| Bet-stats pill (conditional) | Part of stats strip | ✅ |
| 4 pill-button tabs + More | Quiet underline tabs + More | ✅ |
| Schedule toggle (buried) | In ⋯ menu | ✅ |
| No visible CTA | **Hero card tells you what to do** | ★ new |
| No "skip to next" | Secondary "or skip to step 4" link | ★ new |
| No favorites | "Pin to favorites" in ⋯ menu | ★ new (schema ready) |
| Buttons for Clean-corpus, Advanced prompts | In ⋯ menu | ✅ (were hidden in Settings) |

**Zero features lost. A few features surfaced from deep in Settings
into the topic page's ⋯ menu where they're more discoverable.**

---

## Why this feels slicker than v1

v1 feedback: "design not look good."

v2 changes to fix the slickness:

1. **Fewer borders** — the live app / v1 has a border on almost every
   container. v2 uses whitespace + background tints to delimit sections.
   Borders only where there's a real boundary (tabs underline, divider
   between action groups).

2. **One bright spot per viewport** — v1 had orange phase card + orange
   stepper + orange current-step chip all on-screen. v2 has ONE bright
   spot (the Next-action CTA) and everything else is muted. Eye doesn't
   wander.

3. **Bigger type, tighter spacing** — v1 typography was cramped at
   small sizes. v2: 26 px title, 22 px Minto answer. Confident.

4. **Subtle shadows on hover only** — v1 static drop-shadows on every
   card. v2 shadow appears when you engage.

5. **Gradient on the hero card** — `linear-gradient(135deg, orange-soft, surface-1)`
   gives depth without a harsh fill. Modern look (2024–25 SaaS
   convention).

6. **Radii bumped** — 10 px → 14 px → 18 px for the hero. Rounder
   corners read as "friendly" and "current."

7. **Tabular numerals** — all stats use `font-variant-numeric: tabular-nums`
   so columns line up when numbers change.

8. **Action buttons collapse to icons** — removed label text reduces
   visual noise by ~40% without losing function (tooltips provide the
   labels on hover).

9. **Generous content padding** — content area starts with 28 px top
   padding, 32 px between sections. Breathes.

10. **Zero pulsing elements at rest** — only the `Collecting` chip
    pulses, and only when actually collecting. v1 had 3 animated
    elements.

---

## "What to do next" — the UX promise

Every screen of this prototype answers one question at each level:

| Level | Question | Answer in the UI |
|---|---|---|
| Macro | "Where am I?" | ← Workspace › Topic name (tiny breadcrumb) |
| Context | "What is this topic?" | Bold 26 px title · status chip · stats strip |
| **Action** | **"What should I do now?"** | **Next-action hero card with CTA button** |
| Pipeline | "Where am I in the bigger flow?" | Slim legend below the hero |
| Surface | "What data am I looking at?" | 4 tabs — currently on Insights |
| Content | "What did the system find?" | Minto answer + findings grid |

The user never has to ask "now what?" — the hero card always
answers it for the current step.

---

## Port plan (same 4 steps as v1, same estimate)

1. **CSS** (0.5 day) — copy the `.ctx`, `.header`, `.next-action`,
   `.pipeline`, `.tabs`, `.finding` blocks from the proto into
   `style.css`. Scope under `.topic-v2` or replace the old styles
   wholesale.

2. **Header markup** (0.25 day) — rewrite the root.innerHTML header
   block in `topic.js`. All IDs preserved.

3. **Next-action hero** (0.5 day) — `renderIntentLadder()` already
   knows the current step; wrap its output in the hero-card layout.

4. **Finding card polish** (0.25 day) — default to 4–5 key chips; put
   the remainder behind "show all chips" hover.

**Total: ~1.5 days.** Unchanged from v1 because the structural work
is the same; only the visual treatment changed.

---

## Open the prototype

```
open docs/design/topic-detail-proto-v2.html
```

Toggle dark mode via the top-right pill. Resize the window to 1024 px
and 640 px to see responsive behavior. Inspect the `.action-cluster`
elements to see every button from the live app present.

Give feedback in terms of specific elements:

- "The X is too big / small"
- "The Y should be primary instead of Z"
- "Move W into the ⋯ menu"
- "Add this affordance I forgot"

…and v3 iterates. No need to commit to a rewrite yet.
