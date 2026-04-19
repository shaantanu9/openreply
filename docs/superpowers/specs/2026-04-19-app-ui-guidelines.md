# Gap Map — UI guidelines

**Date:** 2026-04-19
**Status:** Living doc. Update whenever a new pattern ships.
**Audience:** Anyone (human or AI) adding new screens, modals, components.

The desktop app has a distinct visual language. New work MUST match it. This doc lists the design tokens, component patterns, and spacing rules so additions feel native instead of bolted-on.

---

## 1. Design tokens (defined in `style.css :root`)

### Surfaces
| Token | Value | When to use |
|---|---|---|
| `--surface` | `#FFFFFF` | Primary card background, "open" accordion body, modal dialog |
| `--surface-2` | `#FBF8F2` | App body background (cream/parchment), collapsed accordion, secondary surfaces, hover bg, subtle differentiation inside cards |

### Text (3-level hierarchy)
| Token | Value | When to use |
|---|---|---|
| `--ink` | `#1A1614` | Headlines, primary labels, active state |
| `--ink-2` | `#4A4339` | Body copy, secondary labels |
| `--ink-3` | `#8A8278` | Hints, metadata, placeholders, disabled state |

### Borders
| Token | Value | When to use |
|---|---|---|
| `--line` | `#ECE6DC` | Default border, dividers |
| `--line-2` | `#E2DBCF` | Hover/focus border, active accordion border |

### Brand accent (orange)
| Token | Value | When to use |
|---|---|---|
| `--orange` | `#FF8C42` | Primary buttons, active chips, brand badges, focus ring |
| `--orange-2` | `#FFB37A` | Hover variant, lighter accents |
| `--orange-soft` | `#FFE9D6` | Subtle highlights, badge backgrounds, pre-checked rows |

### Geometry
| Token | Value | When to use |
|---|---|---|
| `--radius` | `18px` | Cards, modal dialogs |
| `--radius-sm` | `12px` | Inner panels, accordions, smaller containers |
| Pills | `999px` | Chips, badges, all rounded-full elements |
| Buttons | `8px` | Standard button radius |
| Inputs | `6-8px` | Form fields |

### Shadow
- `--shadow: 0 1px 2px rgba(26,22,20,.04), 0 8px 28px rgba(26,22,20,.04)` — subtle two-layer; use on modal dialogs and floating cards. Don't stack shadows.

### Status colors (not in tokens but consistent)
| Color | Hex | Use |
|---|---|---|
| Success green | `#2E7D5B` | Active chip, OK toast border, success badges |
| Warning amber | `#E69447` | Warn toasts |
| Danger red | `#B84747` | Destructive button, error toast/card, danger zone heading |
| Cool blue | `#2E5B8C` | Markdown badge, info |
| Purple | `#6b21a8` | Meta-analysis tier badge |

---

## 2. Spacing & rhythm

### Card padding
- **Standard cards** (`.settings-card`, dialog content): `20px`
- **Compact cards** (inside grids, inline panels): `14px`
- **Inner panels** (accordion body, sub-cards): `12px 14px`

### Section/grid gap
- Top-level grids: `14px`
- Inline element clusters (chips, button groups): `6-10px`
- Stacked form fields: `14px` between rows, `6px` between label and field

### Vertical rhythm
- Header → body inside a card: `12-14px`
- Card → next card in a stack: `12-16px`
- Section divider above/below: `padding-top/bottom: 12-14px` on a `border-top: 1px solid var(--line)`

---

## 3. Typography

| Style | Size | Weight | Color | Use |
|---|---|---|---|---|
| Page H2 | 18-20px | 700 | `--ink` | Section heads (`.section-head h2`) |
| Card H4 | 14px | 700 | `--ink` | Inside `.settings-card` |
| Body | 13px | 400 | `--ink` / `--ink-2` | Primary content |
| Compact body | 12-12.5px | 400 | `--ink-2` | Card descriptions |
| Hint / metadata | 11-11.5px | 400 | `--ink-3` | Help text, timestamps, status |
| Uppercase label | 11px | 700 | `--ink-3` | Form-field label, accordion summary, group header. `text-transform: uppercase; letter-spacing: 0.05em` |

**Rule:** always use a system-derived font stack — never load custom webfonts. The app inherits the OS font.

---

## 4. Component patterns

### Cards (`.settings-card`)
```css
background: var(--surface);
border: 1px solid var(--line);
border-radius: var(--radius);
padding: 20px;
min-width: 0;          /* lets grid items shrink */
```
Use for any logically grouped content — a panel, a setting group, a results section. NEVER nest cards inside cards. Use accordions or sub-sections instead.

### Accordions (native `<details>`)
The canonical pattern — see `.byok-models-accordion` in `style.css`:
```css
.accordion {
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--surface-2);   /* collapsed = secondary surface */
  overflow: hidden;
  transition: border-color .15s, background .15s;
}
.accordion[open] {
  background: var(--surface);     /* open = primary surface */
  border-color: var(--line-2);
}
.accordion summary {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 14px;
  font-size: 12px; font-weight: 600; color: var(--ink-2);
  cursor: pointer; list-style: none; user-select: none;
}
.accordion summary::-webkit-details-marker { display: none; }
.accordion .body {
  padding: 4px 14px 14px;
  border-top: 1px solid var(--line);
  background: var(--surface);
}
```

**Required summary anatomy:**
- Uppercase mini-label on the left (the "what is this" tag)
- Optional `--ink-2` body text in the middle (count or status)
- Right-aligned `chevron-down` lucide icon that rotates 180° when `[open]`
- Use `flex: 1` on the middle text so the chevron docks to the right

**Long lists inside an accordion** must be capped: `max-height: 240px; overflow-y: auto` with the themed scrollbar (see §6).

### Chips & pills
Use for categorical tags, filter selectors, model picks, evidence-tier badges:
```css
.pill, .chip {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 10px;            /* or 2px 8px for tight density */
  border-radius: 999px;
  font-size: 11-12px; font-weight: 600;
  background: var(--surface-2);
  border: 1px solid var(--line);
  cursor: pointer;
  white-space: nowrap;
}
.pill.active { background: var(--orange); color: white; border-color: var(--orange); }
```
**Don't** use chips for navigation (use tabs) or for primary CTAs (use buttons).

### Buttons
Three primary variants — never invent a fourth without adding it to this guide:
| Class | Style | When |
|---|---|---|
| `.btn.btn-primary` | Orange fill, white text | Primary action — Save, Run, Submit |
| `.btn.btn-ghost.btn-bordered` | Transparent, `--line` border, `--ink-2` text | Secondary action — Cancel, Refresh |
| `.btn.btn-danger` | Red fill, white text | Destructive — Delete, Clear |

Sizes: `.btn-sm` (default), `.btn-xs` (compact for tables/dense areas).

**Icon buttons** must use `.icon-btn` for `display: inline-flex; gap: 6px`:
```html
<button class="btn btn-primary btn-sm icon-btn">
  <i data-lucide="play"></i> Run
</button>
```

### Tabs (`.tabs` / `.tab`)
- Inline-flex with lucide icons (`<i data-lucide>` 14×14 + text)
- Active tab: `--surface` background, `--ink` text, no underline
- Inactive: transparent, `--ink-3` text
- Hover (inactive): `--ink` text
- Always pair with `window.refreshIcons?.()` after rendering

### Form inputs
```css
input[type="text"], input[type="email"], ..., select {
  width: 100%;            /* but ONLY when scoped to text-like types */
  padding: 8-10px 12px;
  border: 1px solid var(--line); border-radius: 6-8px;
  background: var(--surface); color: var(--ink);
  font-family: inherit; font-size: 12-13px;
}
input:focus, select:focus { outline: none; border-color: var(--orange); }
```
**Critical:** never apply `width: 100%` to ALL `input` selectors — checkboxes get squashed. Always scope to text-like types.

### Native checkboxes (no custom toggle widgets)
```css
input[type="checkbox"] {
  width: 16px; height: 16px;
  accent-color: var(--orange);     /* fills the check with brand orange */
  cursor: pointer;
}
```
The browser's native checkbox + `accent-color` is enough — don't reinvent this with custom CSS. Save a slider toggle for genuine on/off scenarios where the checkbox metaphor doesn't fit.

### Modals (centered overlay)
- Backdrop: `position: fixed; inset: 0; background: rgba(20,20,20,0.45); z-index: 9999`
- Dialog: `background: var(--surface); border: 1px solid var(--line); border-radius: 14px; box-shadow: var(--shadow); max-width: 720px; max-height: 90vh; overflow-y: auto; padding: 20px 24px`
- Close: lucide `x` icon, top-right, ghost style
- Click outside backdrop → close (`if (e.target === host) close()`)
- Footer with action buttons: `border-top: 1px solid var(--line); padding-top: 14px; display: flex; justify-content: space-between`

Reference implementations: `.src-pick-backdrop`/`.src-pick-dialog` (source picker), `.byok-backdrop`/`.byok-dialog` (BYOK).

### Toast notifications
- Stack at `position: fixed; bottom: 24px; right: 24px; z-index: 10000`
- Each toast: `border-left: 3px solid <status-color>`, lucide icon (`x-circle` / `alert-triangle` / `check-circle-2`), title + optional detail, dismissible `×` button
- Auto-dismiss after 5s by default

### Empty states
```html
<div class="empty-state">
  <p>Short description of what's missing.</p>
  <p class="muted">Optional hint pointing to next action.</p>
  <button class="btn btn-primary icon-btn">
    <i data-lucide="play"></i> Do the thing
  </button>
</div>
```
Always pair the empty-state copy with a primary CTA.

---

## 5. Lucide icons

- Use the `<i data-lucide="name">` placeholder pattern. SVG is injected by `refreshIcons()`.
- **Always call `window.refreshIcons?.()` after every `innerHTML` mutation that adds new icon placeholders.** Forgetting causes blank `<i>` tags instead of SVGs.
- Default size 16×16 (set in `icons.js` defaults). Override with `width` / `height` attrs or `svg { width: ... }` CSS.
- Inside text contexts (tabs, pills, h4, buttons), parent must be `display: inline-flex; align-items: center; gap: 6px` and the SVG should have `flex-shrink: 0`.

### Standard icon vocabulary
| Concept | Lucide name |
|---|---|
| Run / play / start | `play` |
| Stop / cancel | `circle-stop` or `square` |
| Re-run / refresh / reload | `refresh-cw` |
| Settings / config | `settings` |
| Search / find | `search` |
| Filter | `filter` |
| Database / SQL | `database` |
| Graph / network | `network` |
| Solutions / science | `flask-conical` |
| Map | `network` (also for graph view) |
| File / document | `file-text` |
| Upload / drop | `file-up` |
| Download / pull | `download` |
| Copy | `copy` |
| Open external | `external-link` |
| Chevron (collapsible) | `chevron-down` (rotates 180° when open) |
| Status — error | `x-circle` |
| Status — warn | `alert-triangle` |
| Status — ok | `check-circle-2` |
| Status — info | `info` |
| Trends — up/down | `trending-up` / `trending-down` |
| Live / radio | `radio` |
| Tags / boxes | `boxes` |
| Chat / message | `message-square` |
| Action / spark | `zap` |
| Sparkles / new | `sparkles` |
| Time / temporal | `clock` |
| Key | `key-round` |
| Trash | `trash-2` |
| Hamburger | `menu` |
| Arrow nav | `chevron-left` / `chevron-right` |

Stick to this vocabulary. New icon → add it here.

---

## 6. Custom scrollbars (themed for cream palette)

Any scrollable container MUST style its scrollbar so it doesn't clash with the parchment surface:
```css
.scroll-container::-webkit-scrollbar { width: 8px; }
.scroll-container::-webkit-scrollbar-track { background: transparent; }
.scroll-container::-webkit-scrollbar-thumb {
  background: var(--line-2);
  border-radius: 999px;
  border: 2px solid var(--surface);   /* match the bg of the parent */
}
.scroll-container::-webkit-scrollbar-thumb:hover { background: var(--ink-3); }
```
The 2px border on the thumb creates the floating-pill look against whatever surface color the parent uses.

---

## 7. Anti-patterns (the "don'ts")

- ❌ **Never** apply `width: 100%` to all `input` selectors. Scope to text-like types or you'll squash checkboxes.
- ❌ **Never** load custom webfonts. Use the OS system stack.
- ❌ **Never** stack box shadows. One `--shadow` per element max.
- ❌ **Never** use emoji as visual icons in templates. Use lucide. (Emojis are fine inside dynamic strings like LLM-generated text or user-typed content.)
- ❌ **Never** hardcode colors. Always use a CSS variable. New brand color? Add it to `:root` first.
- ❌ **Never** invent a 4th button variant. Extend the existing three.
- ❌ **Never** nest `.settings-card` inside `.settings-card`. Use accordions or sub-sections.
- ❌ **Never** forget `window.refreshIcons?.()` after a dynamic `innerHTML` swap.
- ❌ **Never** let a model list, post list, or any unbounded list grow without `max-height` + `overflow-y: auto` + themed scrollbar.
- ❌ **Never** use OS-default scrollbars on cream surfaces. Always theme.
- ❌ **Never** use a custom toggle widget when a native checkbox + `accent-color` will do.

---

## 8. Reference implementations (canonical examples)

When building something new, copy the visual pattern from these:

| Pattern | Reference file |
|---|---|
| Card + form | `screens/settings.js` (every settings card) |
| Accordion + scrollable list | `screens/byok.js` `renderCuratedChipsHtml` |
| Tab loaders + lucide tabs | `screens/topic.js` (`#topic-tabs` + loaders map) |
| Modal with action buttons | `screens/topic.js::openSourcePickerModal` |
| Toast | `screens/topic.js::showToast` |
| Error card with action chips | `screens/topic.js::errorCard` |
| Top-level route with form + results | `screens/search.js` |
| Top-level route with live event stream | `screens/watch.js` |
| Empty-state CTA | `screens/solutions.js::renderEmpty` |
| Paginated list with filter toolbar | `screens/posts.js` |

Read these before designing new screens. Match the pattern; don't reinvent.

---

## 9. Checklist for new components

Before merging a new screen, modal, or component:

- [ ] Uses CSS variables for ALL colors (no hex literals except in this guideline doc)
- [ ] Border-radius uses `var(--radius)` or `var(--radius-sm)` (or `999px` for pills)
- [ ] Spacing matches the rhythm in §2
- [ ] Buttons use one of the 3 canonical variants
- [ ] Icons use lucide via `<i data-lucide>` + a `refreshIcons` call after rendering
- [ ] All text inputs scoped width:100% rule (no checkbox squashing)
- [ ] Long lists capped with max-height + themed scrollbar
- [ ] Modal (if any) uses the standard backdrop + dialog pattern
- [ ] Empty state has copy + primary CTA
- [ ] Hover states include `transition: ... .15s`
- [ ] No emojis as visual icons in templates
- [ ] Reference an existing canonical example from §8

---

## 10. When this doc evolves

Add a new section or expand an existing one whenever:
- A new design pattern ships (e.g. a stepper, a wizard, a drag-drop zone)
- A new color is added to `:root`
- A new button/badge variant is added
- A new lucide icon enters the standard vocabulary
- A new anti-pattern is discovered the hard way

Keep the canonical references list (§8) up to date — they're the visual unit tests for the app's identity.
