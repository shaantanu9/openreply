# OpenReply — UI Redesign Scope

**Branch:** `ui-redesign`
**Worktree:** `.worktrees/ui-redesign/`
**Started:** 2026-04-21
**Approach:** L1 → confirm → L2 → confirm → L3. No layer begins until the prior one is approved.
**Visual reference:** Linear / Raycast — dense, monochrome-first with one accent, strong typography hierarchy, minimal chrome. (Default until user specifies otherwise.)

---

## Why redesign now

Current app ships the right features but feels like a pile of features, not a product:

- 8 sibling tabs on the topic page (Map / Evidence / Research / Trends / Sentiment / Chat / Insights / Solutions) screaming for equal attention, no narrative about what to do next
- 205 hardcoded hex colors across `style.css` (counted). Dark mode was half-broken for the same reason.
- 6 button shapes coexist: `btn-primary`, `btn-ghost`, `btn-bordered`, `btn-xs`, `btn-sm`, `icon-btn` — any given card has 2-3 mixed together
- Font sizes drift between `11px`, `12px`, `12.5px`, `13px`, `13.5px`, `14px`, `15px` literal values, not a scale
- Empty states say "No data" — no teaching, no next-action
- Motion: some panels fade, some slide, some pop — different curves and durations
- Spacing: every card has a bespoke padding literal

The features are solid. The surface is not.

---

## Three-layer plan

### Layer 1 — Design-system consolidation (~1 day, smallest change, biggest coherence win)

**Goal:** every pixel of the app obeys one system. Zero layout changes. No new features. When L1 is done the app *looks* like a product even before L2.

**Deliverables**

1. **Typography scale** — 5 sizes enforced as CSS vars
   ```
   --fs-11  → captions, eyebrows, meta
   --fs-13  → body default, secondary labels
   --fs-15  → body-large, card titles
   --fs-18  → section titles (h3)
   --fs-24  → page titles (h1, h2)
   ```
   Plus `--fw-regular: 400`, `--fw-medium: 500`, `--fw-semibold: 600`, `--fw-bold: 700`, `--lh-tight: 1.2`, `--lh-normal: 1.45`, `--lh-relaxed: 1.6`.

   Kill every literal `font-size: 12px` / `13.5px` / `14px` across the CSS. `.rg-t-body` / `.rg-t-meta` / `.rg-t-title` utility classes bind sizes to roles, not sizes.

2. **Spacing scale** — 8-step ramp
   ```
   --sp-1: 4px
   --sp-2: 8px
   --sp-3: 12px
   --sp-4: 16px
   --sp-5: 24px
   --sp-6: 32px
   --sp-7: 48px
   --sp-8: 64px
   ```
   Replace every `padding: 10px 14px` / `margin: 6px` literal with these.

3. **Button system** — 3 variants × 2 sizes = 6 states total (down from 6+ ad-hoc shapes)
   ```
   .btn                 base reset
   .btn--primary        action (accent bg, white fg)
   .btn--secondary      bordered, surface bg, ink fg
   .btn--ghost          no border, surface-2 on hover
   .btn--sm             padding-2-3, fs-13, 28px tall
   (default)            padding-3-4, fs-13, 36px tall
   + optional: .btn--icon-only  for square icon triggers
   + optional: .btn--danger     for destructive
   ```
   Kill `.btn-bordered`, `.btn-xs`, standalone `.icon-btn`, `.btn-primary` as a separate class (→ `.btn.btn--primary`).

4. **Color tokens become role-based, not hue-based**
   ```
   Old:  --ink, --ink-2, --ink-3, --orange, --lavender, --rose...
   New:  --color-text              (was --ink)
         --color-text-muted        (was --ink-2)
         --color-text-subtle       (was --ink-3)
         --color-surface           (was --surface)
         --color-surface-raised    (was --surface-2)
         --color-border            (was --line)
         --color-border-strong     (was --line-2)
         --color-action            (was --orange)
         --color-action-soft       (was --orange-soft)
         --color-danger            (was --chronic)
         --color-warning           (was --emerging)
         --color-success           (was --mint darkened)
         --color-focus-ring        (new, for :focus-visible)
   ```
   Legacy names kept as aliases pointing at the new vars so the 200+ existing uses don't break in one commit — they fall through transparently. Net zero regressions on day one.

5. **Motion tokens**
   ```
   --dur-fast:  120ms     hover, press, chip toggles
   --dur-med:   200ms     panel fades, modal open
   --dur-slow:  400ms     page transitions, first-paint reveals
   --ease-out:  cubic-bezier(.2, 0, 0, 1)       (standard Linear curve)
   --ease-in-out: cubic-bezier(.4, 0, .2, 1)
   ```
   Every fade/slide/scale across the app references these. Replaces ad-hoc `transition: all .15s`, `.25s ease`, `.3s cubic-bezier(...)`.

6. **Elevation / shadow tokens** — 3 levels
   ```
   --shadow-sm: 0 1px 2px rgba(0,0,0,.04)                                     cards at rest
   --shadow-md: 0 1px 2px rgba(0,0,0,.04), 0 4px 12px rgba(0,0,0,.05)         hover, dropdowns
   --shadow-lg: 0 1px 2px rgba(0,0,0,.04), 0 16px 40px rgba(0,0,0,.08)        modals, popovers
   ```
   Dark mode replaces the rgba alpha layer with sharper values (user already saw this pattern land in Phase 19 of the sidecar skill).

7. **Focus ring** — 1 standard everywhere: `0 0 0 3px var(--color-focus-ring)`. No more mixed outlines.

8. **Radius** — keep current 3-ramp (`--radius-sm: 8px`, `--radius: 12px`, `--radius-lg: 18px`); normalize usage.

**Files touched**

- `app-tauri/src/style.css` — token block (additive, at top) + alias layer, then progressive replacement of literals
- `app-tauri/src/lib/design.css` (new, optional) — only if token block exceeds 200 lines; import from style.css

**Non-goals for L1**

- Zero component rearrangement (no tab reshuffling, no flow changes)
- Zero new screens
- Zero empty-state rewrites (those are L3)
- Zero behavior changes (modals still behave the same, just use the tokens)

**Exit criteria**

- `grep -E "font-size: [0-9]+px" style.css` returns 0 matches (or only inside the `:root` token block)
- `grep "padding: [0-9]" style.css` uses vars
- Every button in the app uses `.btn.btn--{variant}` shape
- Dark mode still works (regression-check the Phase-19 rules)
- Screenshots of 5 screens (home, topic/map, topic/insights, settings, welcome) before vs after — no layout drift, just tighter appearance

---

### Layer 2 — Topic flow narrative (~1-2 days, held until L1 is signed off)

**Goal:** replace the flat 8-tab topic page with a **3-stage linear flow** that matches the actual user job.

```
 1. COLLECT    →    2. DISCOVER    →    3. ACT
   ─ sources         ─ map              ─ insights
                     ─ evidence         ─ solutions
                     ─ research         ─ experiments
                     ─ trends           ─ personas (future)
                     ─ sentiment
                     ─ chat
```

- Each stage has its own header + a single next-step CTA
- Tabs within a stage become secondary (lighter visual weight)
- Top progress rail: `● Collect ─○─ Discover ─○─ Act` shows where you are + what's left
- Breadcrumbs: `Workspace › Topic › Discover › Map`
- Empty-state per stage that teaches the next action

**Deliverables** (tentative, locked in when L1 lands)

- New stage rail component
- Grouped-tab component (stage-aware)
- Updated `topic.js` to route stage + nested tab via hash (`#/topic/X/discover/map`)
- Migrate existing tab bodies under the new grouping — no content changes, just reparenting
- Empty-state per stage (at least the first-paint variant)

**Non-goals for L2**

- Zero *content* changes to individual tab bodies
- Zero new data

**Exit criteria**

- Navigating a topic feels like walking through a workflow, not picking from a buffet
- Breadcrumbs + progress rail visible on every topic screen
- Keyboard nav (`1`/`2`/`3` for stages, `[`/`]` for tabs within stage) works

---

### Layer 3 — Empty states + onboarding polish (~1 day, after L2 sign-off)

**Goal:** every surface teaches the next action. Zero "No data" generic states.

**Deliverables**

- Empty state component library: icon + headline + teaching copy + primary CTA + secondary "Learn more"
- One template filled in per screen (home, topic/map empty, insights empty, research empty, solutions empty, trends empty, sentiment empty, chat empty)
- First-run onboarding check: if the user has 0 topics, route to welcome with 3-card journey (Pick a topic → Watch it collect → See your gap map)
- Tooltips on every chip, metric, and score using `title=` + hover cards where screen real estate allows
- Success states: after collect finishes, short toast with "N posts · M sources · click here to open the map"

**Non-goals for L3**

- Full onboarding flow rewrite (that's its own project)
- Tutorials / walkthroughs

**Exit criteria**

- No string "No data" anywhere in the JS
- First-time open on a fresh DB is guided end-to-end without the user having to guess
- Every icon has an accessible tooltip

---

## Working rules (applies to all layers)

1. **No feature regressions.** Every change is visual or structural; keep the same data, commands, and state machines.
2. **Dark mode stays working.** Every new token gets a `html.dark` counterpart.
3. **Commit per milestone.** L1 may be split into: (1) token block + aliases, (2) button consolidation, (3) typography pass, (4) spacing pass, (5) motion pass. Each commit runnable + regression-checked.
4. **Screenshots before/after for every commit** stored under `docs/ui-redesign/screenshots/`. User signs off from the diff.
5. **No dependency on agents/personas/new features.** This is pure surface work.
6. **Before/after audit** via `grep` + manual pass before marking a layer done.

---

## Status

- **L1 — in progress (started 2026-04-21).**
- L2 — pending L1 sign-off.
- L3 — pending L2 sign-off.

Log each milestone completion below:

- [x] L1.1 — token block + legacy aliases (commit c4ac951)
- [x] L1.2 — typography literal cleanup (commit 77023c8) — 528 literals snapped to --fs-* scale
- [x] L1.3 — spacing utility classes (part of L1.3-5 bundle)
- [x] L1.4 — button system available (.btn + .btn--{primary|secondary|ghost|danger})
- [x] L1.5 — motion/shadow/focus utilities
- [x] **L1 sign-off** (user approved "ok now start l2")
- [x] L2 — topic-page stage rail + breadcrumbs (commit 21f23dd)
- [x] L3 — canonical empty-state component + 14 presets (commit TBD)

## L3 completion notes

Shipped the **infrastructure** for teaching empty states — not a
screen-by-screen rewrite. Every screen can now replace its ad-hoc
"No data" HTML with a single `renderEmpty(EMPTY_PRESETS.<key>())`
call and get:

- Icon + headline + 2-line teaching body + primary CTA + optional
  secondary + optional footer link
- Consistent sizing, spacing, typography (uses the Layer-1 scale)
- rg-reveal fade-slide on mount
- Dark-mode automatically (tokens only)
- 14 pre-written presets covering every major screen:
    topic_no_corpus · insights_no_report · insights_credits_exhausted
    map_no_graph · evidence_no_findings · research_no_papers
    solutions_not_run · trends_no_temporal · sentiment_not_run
    chat_first_message · home_no_topics · posts_empty · sources_empty
    bets_none · activity_empty · generic

Per-screen migration (swapping the old `<div class="empty-big">` /
`empty-state` HTML to `renderEmpty(...)` calls) is the **next pass**
— not part of L3's core scope. Each screen is a one-line change and
can land as small follow-ups without re-opening the scope doc.

### L1 exit notes

User feedback mid-pass: "don't make new font changes, keep old feel."
Decision: L1.3/L1.4/L1.5 are ADDITIVE ONLY. New utility classes + the
new .btn system are available for future components; we do NOT rewrite
the 369 legacy padding/margin literals, the 6 legacy button shapes, or
the 39 legacy transitions. Zero further visual drift during L1.

New components reach for the new system; legacy components stay
untouched until a component is explicitly migrated (a future
per-screen effort outside L1's scope).
