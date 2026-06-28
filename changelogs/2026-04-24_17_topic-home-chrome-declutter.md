# Move topic-level chrome panels into the Home tab

**Date:** 2026-04-24
**Type:** UI Enhancement

## Summary

On a topic page, three info-dense panels sat above the tab strip and
were visible on every tab (Map, Report, Trends, Sentiment, Sources, …):
intent action-ladder ("Build a new product → Concept brief" with its 4
steps), extraction prefs override row ("This topic uses: Auto · 100
posts · batch 5 · Override"), and the coverage-gaps strip ("User
reviews · 0 posts · 0% · + Add appstore · + Add playstore · Competitor
mentions …"). Collectively they pushed the Map / Report / Trends
content ~280 px down the viewport and made every tab feel noisy.

Nothing was removed. All three panels now live inside the Home tab
within the topic (the existing `data-tab="home"` tab), so they are one
click away but don't compete with the Map canvas, Report cards, Trends
charts, etc.

## Changes

### HTML (in `renderTopic` template, `app-tauri/src/screens/topic.js`)

- Wrapped `#intent-ladder-host`, `#extract-override-row`, and
  `#coverage-gaps` in a new `<div id="topic-home-chrome">`.
- Moved the coverage-gaps strip up so all three panels are siblings in
  one container (previously coverage-gaps lived below the tab strip).
- Ids, data-roles, and inline styles are preserved — the existing
  painters (`mountIntentLadder`, `_renderExtractionOverrideRow`, the
  saturation + coverage-gaps repaint in `_renderCoverageGaps`) don't
  need to change.

### Visibility toggle (`renderTopic` body)

- New local helper `syncHomeChromeVisibility(tabName)` sets
  `chrome.style.display` to `''` when the active tab is `home`, else
  `none`. Chosen over `hidden` attribute so the painters' own
  display-mode inline styles inside the wrapper aren't stomped.
- Called once at mount (initial paint reflects the stored tab) and
  from `switchTab()` right after `activeTab = name` so every tab
  change re-syncs.

### Result

- Map / Report / Trends / Sentiment / Sources / Posts / Research /
  Solutions / Concepts / Papers / Bets / Evidence / Chat / Search /
  Actions / AI Analyses tabs: no intent-ladder, no override row, no
  coverage-gaps strip. Their own content starts right under the tab
  strip.
- Home tab: everything that used to be global now sits at the top of
  the Home content, giving Home a proper "topic overview" identity.

## Files Modified

- `app-tauri/src/screens/topic.js`
  - `renderTopic` template — new `#topic-home-chrome` wrapper; old
    coverage-gaps slot below tabs removed.
  - `renderTopic` body — `syncHomeChromeVisibility` helper + initial
    call.
  - `switchTab` body — call `syncHomeChromeVisibility(name)` after
    `activeTab = name`.

## Verification

- `node --input-type=module -e "import('./src/screens/topic.js')"` — OK.
- No Rust changes; no `cargo check` needed.

## Notes

- One subtle detail: template-literal backticks cannot appear inside an
  HTML comment in a JS template-string render (the parser closes the
  outer template early). The wrapper's doc comment uses plain prose
  instead of wrapping `activeTab === 'home'` in backticks.
- Painters inside the wrapper continue running even while the wrapper
  is `display: none` — so the moment a user clicks Home the chrome is
  fully populated without a flash of loading state.
- If we later want a lightweight breadcrumb-style summary of the
  intent-ladder progress on non-Home tabs (say, a single pill showing
  "Step 2 of 4: Run Solutions pipeline"), that can hang off the topic
  header without reintroducing the full card. Not done here to keep
  this change scoped to moving, not redesigning.
