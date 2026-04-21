# Topic Detail page — redesign proto

**Prototype:** [`docs/design/topic-detail-proto.html`](./topic-detail-proto.html)
**Live file being replaced:** `app-tauri/src/screens/topic.js` (the
`root.innerHTML = ` block, ~lines 364–450)
**Status:** 2026-04-21 — **design proto only**, not yet ported to the
live JS.
**Open the HTML file in a browser to preview.** Dark-mode toggle in
the top-right corner.

---

## 1. The redesigned layout — three horizontal bands

The live page had 7 rows of chrome (documented in
`docs/ops/ui-declutter-2026-04-21.md`). The redesign collapses that
to **three bands** with a clear purpose for each:

### Band 1 — Context (≤ 52 px tall)

**One row.** Answers *"where am I and what do I have?"*

```
[← Workspace]  meditation and sound frequency …  [• Collecting]  5,193 posts  11 pains  0 DIY  8 sources     [Cancel] [⟳ Rerun] [⇄ Compare] [🗑]
```

Contents (left → right):
1. Back-link — single-level, collapses the old breadcrumb
2. Topic title (bold, 22 px, ellipsised at 52ch)
3. Status chip — `Collecting` when in-flight, hidden otherwise
4. Inline stat counts with tabular-numerals
5. Spacer
6. Action group: Cancel (only when collecting), Rerun, Compare,
   Delete-as-icon

**Why it works:** everything in the user's current mental context lives
on one line, left-to-right in priority order. Actions clustered on the
right follow platform convention.

### Band 2 — Action (the pipeline state + primary CTA)

**One card.** Answers *"what am I doing right now?"*

```
┌─────────────────────────────────────────────────────────────┐
│ 🚀 Build a new product ▾     [1 ✓ Collect] [2 ✓ Solutions] │
│    Turn user pain into       [3 • Generate concepts]       │
│    concepts                  [4 🔒 Export brief]            │
│                                    → Ideate concepts         │
└─────────────────────────────────────────────────────────────┘
```

Three columns:
- **Phase selector** (left, orange pill): which goal this topic is working
  toward. Clickable dropdown to change phase (Build new / Position /
  Monitor / etc.)
- **Step chips** (middle): 4 equal-width chips showing pipeline state.
  Done = mint, active = orange+shadow, locked = faded. Chip labels
  ellipsised on narrow screens.
- **Primary CTA** (right): one button for the active step. Current
  screenshot shows "Ideate concepts"; button changes based on which
  step is active.

**Why a card, not free-floating elements:** the card gives the phase
its own visual weight so the user knows *this is the thing to decide
about right now*. When no phase is selected (fresh topic), the card
collapses to a single "Pick a phase" prompt.

### Band 3 — Tabs + content

**Standard tabs, but cleaner.** Answers *"what surface am I looking
at?"*

```
[★ Insights]  [◉ Bets 3]  [🔎 Evidence]  [💬 Chat]                    [More ▾]
─────────────────────────────────────────────────────────────
```

- 4 primary tabs, bottom-bordered-active state (not the chunky pill
  buttons the live app uses).
- Bet count as an inline chip on the Bets tab when > 0.
- `More ▾` pushed to the right — Map / Sources / Posts / Sentiment /
  Trends / Research / Solutions live there.

Content area begins immediately below the tab border. The Insights tab
content renders as:

1. **Minto header card** (bigger, more confident)
2. **Top opportunities** grid (responsive auto-fill, min 300 px cards)

Finding cards simplified:
- Kind emoji, title, opportunity score on one head row
- 3–5 key chips on a meta row (imp / sat / triangulation /
  counter-evidence / research link)
- Narrative (2 lines, truncated)
- Optional pull-quote
- Source badges + 👎 feedback button on the footer

---

## 2. Why this is better than the current page

### Density vs. clarity

| Metric | Current live | Prototype |
|---|---|---|
| Rows of chrome before content | 7 | 3 (bands) |
| Distinct visual weights | 6+ | 3 (back-link, title, action-card) |
| Above-the-fold content at 1440×900 | ~20% | ~55% |
| Breadcrumb length | `Workspace › Topic › Act › Concepts` | `← Workspace` |
| Subtitle status conflict | "Loading topic…" vs. "Collecting…" | single chip |
| Primary CTA discoverability | scroll required | row 2, always visible |

### One visual weight per band

The live app stacks orange stepper + green check marks + dark action
buttons + light-gray tabs + bright-orange phase card all visible
simultaneously. Too many things compete for the eye.

The redesign: **Band 1 is neutral** (text + subtle chips). **Band 2 is
the only place orange appears prominently** — the phase card owns the
brand color because it's where the user takes action. **Band 3 is
quiet** (thin underline on active tab).

Result: eye lands on the phase card first (correct — it's the CTA),
then on tabs / content.

### Platform-native conventions

- Back-link icon + "Workspace" label — matches iOS / Android /
  GitHub / Linear.
- Tabs with bottom-border active state — web standard.
- Action buttons clustered top-right — Apple HIG / Material.
- Status chip with pulse dot — familiar from every status-monitoring
  tool.

The live app had Phase-11-era pill-buttons for tabs and a custom
topbar that doesn't match common patterns. The redesign looks
"normal" — which means users don't burn cognitive cycles learning the
UI.

---

## 3. What the prototype keeps from the live app

Not a wholesale rewrite — preserves:

- **Phase-based action ladder** (keep — best part of the live design).
- **Minto pyramid header** on Insights (keep — methodology-grade).
- **Ulwick opportunity score** on finding cards (keep).
- **Triangulation / counter-evidence / research-link chips** (keep —
  these are the trust signals).
- **Tab structure** — 4 primary + More dropdown (keep).
- **Status chip** for in-flight collects (keep; restyled).

The prototype reorganizes; it doesn't reinvent.

---

## 4. How to port it to the live app

Low-risk, staged port in 4 steps:

### Step 1 — CSS first (already partially done)

`app-tauri/src/style.css` already has a `.topic-header-compact`
block from the 2026-04-21 declutter pass. Extend that with the
`.action-band` + `.minto-header` + `.finding-card` rules from the
prototype. Scope everything under `.topic-v2 ...` so existing styles
don't conflict.

Estimate: 0.5 day.

### Step 2 — Markup — header section only

Replace the `.topic-header-compact` block in `topic.js::root.innerHTML`
with the prototype's Band 1 markup. All element IDs preserved
(`#topic-active-chip`, `#btn-rerun`, etc.) so downstream JS
doesn't break.

Estimate: 0.25 day.

### Step 3 — Markup — action-band replaces intent-ladder

The live page renders `renderIntentLadder()` into
`#intent-ladder-host`. Rewrite that function to emit the prototype's
`.action-band` markup. The existing phase/steps data structure maps
directly.

Estimate: 0.5 day.

### Step 4 — Finding card polish

Current finding cards have 8+ chips; the prototype keeps only 3–5.
Apply the dense-cards toggle (already shipped — see
`html.dense-cards` rules in style.css) as the DEFAULT, with an "expand
all" toggle for power users who want the full chip set.

Estimate: 0.25 day.

**Total: ~1.5 days to ship the full redesign.**

---

## 5. Open questions

### Q1 — Should the action-band always show?

Pro: always-visible CTA → higher conversion to next step.
Con: takes vertical space even when the user is in browse mode.

**Proposal:** show it when the current phase has an active step.
Collapse to a single "Pick a phase" bar when no phase is selected or
all steps are done.

### Q2 — How do we handle "no phase selected yet" state?

Today the page just shows the tabs. Prototype shows a "Build a new
product" default phase. Better default:

- **First visit after collect:** show a "Pick your goal" inline
  selector (grid of 4 phase cards) where the action band would be.
- **After phase picked:** proto layout.

### Q3 — Mobile / narrow-window behavior?

At 640 px: stack Band 1 vertically (title on its own line, actions
below). Band 2 collapses phase-selector + CTA + steps vertically. Tabs
become a horizontal scroll.

Prototype handles this via `@media (max-width: 1024px)` and
`(max-width: 640px)`. Test on an actual narrow window before shipping.

### Q4 — Dark-mode contrast

Prototype has dark-mode overrides. Toggle via DevTools
`document.documentElement.classList.toggle('dark')`. A few tune-ups
likely needed on real hardware — the orange-soft color was designed
for light backgrounds and needs a separate dark swatch.

---

## 6. How to review the prototype

1. Open `docs/design/topic-detail-proto.html` in a browser.
2. Click the top-right "Dark mode" toggle — verify both palettes.
3. Resize window 1440 → 1024 → 640 px — check responsive behavior.
4. Tab through (Tab key) — check focus order is sensible.
5. Inspect the structure — every band has an `aria-label`; tabs have
   proper `role="tablist"` / `role="tab"`.
6. Mentally map to the live page — would a current user understand
   this without re-learning?

Once the prototype is approved, follow the 4-step port plan in §4.

---

## 7. What's NOT in this prototype

- **Map / Graph tab content** — lives in its own iframe; untouched.
- **Product Mode dashboard** — separate screen
  (`screens/product.js`); has the same 3-band pattern to apply but
  out of scope here.
- **Welcome / onboarding** — separate flow.
- **Settings / Ingest / other screens** — not part of Topic Detail.

---

*When this ships to the live app, update this doc's Status line +
move the HTML proto to `docs/design/archive/` so it's preserved for
historical reference.*
