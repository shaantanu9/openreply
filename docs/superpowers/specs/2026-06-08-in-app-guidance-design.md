# In-App Guidance System — Design

> **Date:** 2026-06-08 · **Status:** Approved (build)
> **Goal:** Make a ~70-screen, 2-mode app learnable for both non-technical users and developers, via an interactive tour, in-context help, a guided next-step flow, and a single help hub. Reuses existing `welcome.js`, `why.js`, `playbook.js`, `empty.js`.

## Problem
~70 screens across Reddit/Research modes, no obvious path. Existing pieces help but are passive: first-run wizard (`welcome.js`), separate-page explainers (`why.js`), a lifecycle map (`playbook.js`). Missing: anything *interactive*, *in-context*, or *actively guiding*.

## Decisions
- **Audience:** Both, layered — non-technical users get the guided happy-path (tour + next-step rail); developers get a deeper `/help` hub (shortcuts, MCP/API notes). One system, two depths.
- **Tour trigger:** Auto-start once after onboarding, always-skippable; never auto-repeats; replayable from the hub.
- **No new dependencies** (vanilla JS, reuse existing modal/overlay CSS).

## Components

### 1. Tour engine — `app-tauri/src/lib/tour.js` (new)
Spotlight/coachmark overlay. API: `startTour(id, steps, {onDone})`, `isTourDone(id)`, `resetTour(id)`.
- `steps[] = { selector, title, body, route?, placement?, beforeStep?() }`.
- Behavior: dim backdrop with a cut-out around the target; tooltip bubble (title, body, Back/Next/Skip, progress dots); a step may set `route` to navigate first, then wait for the selector (with a timeout fallback that skips the step if the element never appears — never traps the user).
- Persistence: `localStorage['openreply.tour.<id>.done']`.
- Accessibility: Esc = skip; focus trap on the bubble; respects `prefers-reduced-motion`.

### 2. First-run "Getting Started" tour — wired from `welcome.js`
On `markOnboardingComplete()`, set `openreply.tour.getting_started.pending=true`. The home/research-home render checks pending + `!isTourDone` → `startTour('getting_started', …)`. ~6 steps: topic/collect entry → sources toggle → results area → stage bar (Gather→Read→Synthesize→Write) → Help icon → done. Mode-aware (Reddit vs Research step copy).

### 3. Inline help popover — upgrade `why.js`
The existing eye-icon gains a popover (instead of only routing to `/why`): page purpose (from the WHY registry), a "Show me around this screen" button (launches that screen's mini-tour if registered), and a link to the full `/why/<slug>`. New helper `lib/helpPopover.js`; `why.js` registry stays the single source of explainer content.

### 4. "Next step" rail — `app-tauri/src/lib/nextStep.js` (new)
A persistent, dismissible banner rendering the single best next action from app state, mapped through `playbook.js` phases:
- no topics → "Research your first topic" → `#/collect`
- topic, no insights → "Run insights" → topic insights tab
- insights, no audience/personas → "Build audience personas"
- … → "Draft your brief / launch plan"
Dismiss per-state in `localStorage`; reappears when state advances. Reuses `empty.js` copy where it overlaps.

### 5. Help / Tutorial hub — `/help` route + `screens/help.js` (new)
One discoverable home: replay any tour, browse all screen explainers (from WHY registry), view the playbook flow (embed/link `playbook.js`), keyboard-shortcuts cheat-sheet, and a short glossary. Linked from the top nav + the inline help popover.

## Data flow
welcome.js → sets `getting_started.pending` → home render → tour.js. Help icon → helpPopover.js → (reads why.js registry) → optional mini-tour via tour.js. App state (topics/insights counts via existing API) → nextStep.js → CTA → route. /help → help.js → reads why.js registry + playbook.js phases + tour ids.

## Reuse map
- `welcome.js` — tour trigger point (no behavior change beyond setting a flag).
- `why.js` — explainer registry = single source of help content; popover + hub both read it.
- `playbook.js` — phase→route mapping for the next-step rail and the hub flow view.
- `empty.js` — empty-state copy reused by next-step CTAs.
- Existing modal/overlay CSS + Lucide icons.

## Error handling / safety
- Tour step whose `selector` never resolves within a timeout → auto-skip that step (never block).
- All localStorage reads guarded; corrupt values → treat as not-done.
- Popover/rail are additive overlays; if a screen lacks a registry entry, the help icon falls back to today's `/why` behavior.

## Testing
- `tour.js`: unit-test step advancement, selector-timeout skip, done-persistence (jsdom `.test.mjs` like existing `welcome.onboarding.test.mjs`).
- `nextStep.js`: unit-test state→CTA mapping for each phase.
- Manual: fresh-profile run shows tour once; skip works; replay from hub works; help popover opens on a representative screen.

## Build order (each ships independently)
1. `lib/tour.js` (+ CSS) + test
2. First-run tour wired from welcome.js → home/research-home
3. Inline help popover (`lib/helpPopover.js`) on the why eye-icon
4. `lib/nextStep.js` rail + mount on home/research-home/topic
5. `screens/help.js` + `/help` route + nav link

## Out of scope (YAGNI)
Video tutorials, server-synced progress, localization of tour copy, analytics on tour drop-off (can add later).
