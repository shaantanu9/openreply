# New user journey — analysis & recommendations

**Date:** 2026-05-28  
**Scope:** OpenReply desktop app (`app-tauri`) — onboarding wizard through first collect, topic map, and dashboard.  
**Audience:** Product, design, and engineering planning first-run UX.

---

## Executive summary

OpenReply has a **solid structural journey** (welcome wizard → collect with Phase A/B progress → topic map / Insights). The main gap for new users is **time-to-aha**: the default path favors a long aggressive collect and a busy empty dashboard before data exists. This document maps the current flow, what works, where users stall, and a prioritized plan to make the first session feel successful in under five minutes.

---

## Current journey map

OpenReply has two entry paths and a gated shell. Most DMG builds use the **gate-off** path (5 wizard steps; device activation optional).

```mermaid
flowchart TD
  A[App launch] --> B{Onboarding complete?}
  B -->|No| C["#/welcome — 5–6 step wizard"]
  B -->|Yes| D["#/ Home dashboard"]
  C --> S1[1 Value prop — Explore vs Product Mode]
  S1 --> S2[2 Profile — name, role]
  S2 --> S3[3 Connect — LLM, Reddit, health check]
  S3 --> S4[4 Whisper — optional]
  S4 --> S5[5 First topic + aggressive toggle]
  S5 -->|Topic chosen| E["#/collect/topic"]
  S5 -->|Skip topic| D
  S5 -->|License gate ON| S6[6 Activate device]
  S6 --> E
  E --> F[Collect auto-starts — Phase A 0→100 posts]
  F --> G[Phase B — extraction after 100 posts]
  G --> H["Open gap map → #/topic/topic"]
  H --> I[Topic tabs: Insights, Map, Posts, …]
  D --> J{Has topics?}
  J -->|No| K[Quick-start chips → #/collect]
  J -->|Yes| L[Topic tiles + stats]
```

### Boot and routing constraints

| Mechanism | Behavior |
|-----------|----------|
| `openreply.onboarding.completed` | Until set, router forces `#/welcome`; tab strip hidden. |
| `mustStayInOnboarding()` | Also checks licence activation when `OPENREPLY_LICENSE_GATE_ENABLED` is on. |
| First launch warmup | Home may show 10–30s banner while macOS verifies the PyInstaller sidecar. |
| Collect on mount | `renderCollect` auto-calls `startCollect`; onboarding only needs `#/collect/<topic>`. |
| State keys | `openreply.onboarding.step`, `openreply.onboarding.pending_topic`, `openreply.collect.last_aggressive`, profile in `openreply.profile.*`. |

**Primary source files**

- `app-tauri/src/screens/welcome.js` — 6-step wizard (step 6 conditional on licence gate)
- `app-tauri/src/main.js` — routing, onboarding gate, `openreplyOpenNewTopic`
- `app-tauri/src/screens/home.js` — dashboard, empty state, quick-start chips, warmup banner
- `app-tauri/src/screens/collect.js` — Phase A/B UI, auto-start collect, post-run CTA

---

## Wizard steps (detail)

| Step | Label | Purpose |
|------|--------|---------|
| 1 | What is OpenReply | Value prop; branch to **Product Mode** (`#/product/new/setup`) or continue exploring |
| 2 | Your profile | Display name, optional email, role — local only |
| 3 | Connect sources | BYOK LLM providers, Reddit OAuth, system health card — all optional |
| 4 | Video transcription | Optional Whisper model download |
| 5 | Your first topic | Topic input, example tiles, **aggressive mode** toggle |
| 6 | Activate device | Only when licence gate enabled; otherwise skipped |

**Post step 5 (gate off)**

- `markOnboardingComplete()`
- MCP bootstrap (fire-and-forget)
- Route: `pending_route` → else `#/collect/<topic>` → else `#/`

**Post step 6 (gate on)**

- Licence activation via API; then same routing with pending topic.

---

## Collect → topic payoff loop

1. User lands on `#/collect/<topic>`.
2. `aggressive` read from `openreply.collect.last_aggressive` (then cleared one-shot); default is **true** when key unset (`!== 'false'`).
3. **Phase A:** progress toward 100 posts; ETA copy on collect screen.
4. **Phase B:** “Extracting insights…” after threshold; live findings counter.
5. On success: **Open gap map →** navigates to `#/topic/<slug>`.
6. Insights tab shows Minto-structured brief when synthesis has run (requires LLM for full experience).

---

## What already works for new users

| Stage | Why it helps |
|-------|----------------|
| Step 1 | Clear 4-step pipeline story (topic → fetch → synthesise → map). |
| Step 2 | Low-friction profile; no account required. |
| Step 3 | “All optional” framing + live health check; BYOK modal without leaving wizard. |
| Step 5 | Example tiles + aggressive mode explained (~15 min first run). |
| Collect screen | Phase A/B card, recon source list, “Open gap map” CTA — strong progress narrative. |
| Empty home | Quick-start chips route to collect with copy about Minto brief. |
| Gate-off default | Skip activation → collect → value without licence wall. |
| Activation heal | `healActivationFlagsFromBackend()` avoids bouncing licensed users back to welcome. |

---

## Friction points (where new users get stuck)

### 1. Time-to-aha is long and opaque upfront

- Aggressive collect defaults **on** when `openreply.pref.aggressive` / `last_aggressive` are unset.
- Phase B (meaningful extraction narrative) needs **100 posts**; aggressive first run can take **15+ minutes**.
- Step 5 button text says “Continue to activation →” even when licence gate is off.

**Impact:** Users abandon before seeing Insights or assume the app is broken during long collect.

### 2. Onboarding does not close the loop to the payoff screen

After collect, users must discover **“Open gap map →”**. The wizard does not say: wait here, then open Insights.

**Impact:** Users return to empty home or wander tabs without seeing the Minto brief.

### 3. Empty home is busy but not guided

Before the first topic, the dashboard shows skeletons, momentum chart, activity feed, BYOK nudge, palace nudge, products card — mostly empty. Users who **skip step 5** lack a single dominant CTA beyond quick-start chips.

**Impact:** Cognitive overload; unclear “what do I do now?”

### 4. “LLM optional” in copy vs experience

Collect works without keys; Insights, Sentiment, Trends, Audience often show “add a key in Settings” after a long collect.

**Impact:** Feels like a failed run despite successful ingest.

### 5. Two mental models too early (Explore vs Product)

Step 1 branches to Product Mode setup. Mis-clicks send users down a different path before first collect.

**Impact:** Delayed or confused first research win.

### 6. First-launch technical anxiety

Warmup banner on home helps, but step 3 health check can show failing rows while the user is still internalizing step 1.

**Impact:** Trust drop before first action.

### 7. Copy and implementation inconsistencies

| Issue | Location |
|-------|----------|
| “Activation is required” in step 1 bullets while gate is often off | `welcome.js` step 1 |
| `loadTopicGrid` called from delete handler when not on home (fixed: null guard on `#topics-subtitle`) | `home.js` |
| `openreply:start-collect` fired from re-collect context menu but not required for onboarding path | `home.js` / `main.js` |

---

## Recommended “new user OS” (prioritized)

### P0 — Ship feel in under 5 minutes

1. **Default first collect to quick mode** (Reddit-only, shorter run). Offer “Deep collect (all sources, ~15 min)” as explicit opt-in after first success or from topic page.
2. **First collect completion → auto-route to Insights** (or blocking modal: “Your brief is ready — View insights”).
3. **Empty home = one hero CTA**; hide or collapse secondary widgets until `topics.length >= 1`.

### P1 — Set expectations

4. **Step 5:** side-by-side quick vs aggressive (time, sources, when brief appears).
5. **Step 3:** if `readyCount === 0`, soft warning before starting first topic — collect works; synthesis needs one provider (Ollama is free). Allow skip with clear expectation.
6. **Fix labels** for gate-off: step 5 button, step 1 activation bullet.

### P2 — Retention after first session

7. **Home checklist** after first topic: Collect done → Open Insights → Build audience → Run Improve (3 linked items).
8. **Audience nudge** on topic page only after collect has posts (existing pattern; verify timing).
9. **Resume wizard** via `openreply.onboarding.step` if user quits mid-flow.

### P3 — Power users

10. Defer **Product Mode** branch until after first successful explore collect.
11. Persona auto-ingest off by default; explain after first brief.

---

## Success metrics

| Metric | Target signal |
|--------|----------------|
| **Activation** | % completing step 5 with a topic (not skip) |
| **Time to first post** | &lt; 3 min from wizard end on quick mode |
| **Time to first Insights view** | &lt; 10 min quick / &lt; 20 min aggressive |
| **D1 return** | Same topic re-opened or second topic started |
| **BYOK** | LLM key added within 24h if Insights was empty |

---

## Implementation notes (for engineering)

### Changing default collect mode

- Onboarding step 5: default `#ob-aggressive` unchecked; set `openreply.pref.aggressive` to `'false'` for new profiles unless user opts in.
- `collect.js`: consider default `aggressive = false` when `last_aggressive` unset (breaking change for power users — gate with `openreply.onboarding.completed` timestamp or `openreply.first_collect.done`).

### Post-collect redirect

- In `collect.js` on `collect:done` with `code === 0`, if `!localStorage.getItem('openreply.first_collect.done')`:
  - Set flag
  - `location.hash = '#/topic/<slug>?tab=insights'` (if topic router supports tab query)

### Empty home simplification

- `loadTopicGrid` / `renderHome`: when `topics.length === 0`, add class `home--first-run` on root and hide `#top-opportunities-slot`, BYOK card, etc. via CSS or conditional render.

### Copy fixes (low effort)

- `welcome.js` step 1: conditional bullet for activation requirement based on `_licenseGateEnabled`.
- Step 5 `start-5` label: “Continue →” when gate off; “Continue to activation →” when gate on.

---

## How to implement the changes (phased checklist)

Work in this order so you can test each slice on a “fresh” machine (see next section).

### Phase A — Copy & defaults (1–2 hours, no risky behavior change)

| # | File | Change |
|---|------|--------|
| A1 | `app-tauri/src/screens/welcome.js` | Step 1: only show “activation is required” when `_licenseGateEnabled`. |
| A2 | `welcome.js` step 5 | Button label: gate off → `Continue →`; gate on → `Continue to activation →`. |
| A3 | `welcome.js` step 5 | Default `#ob-aggressive` **unchecked**; `openreply.pref.aggressive` = `'false'` on first save unless user checks it. |
| A4 | `welcome.js` step 5 | Add small table: Quick (~3–5 min, Reddit) vs Aggressive (~15 min, all sources). |
| A5 | `welcome.js` step 3 | If `readyCount === 0`, show yellow callout: “Collect works without AI; Insights need one provider.” |

### Phase B — First-run collect behavior (half day)

| # | File | Change |
|---|------|--------|
| B1 | `app-tauri/src/screens/collect.js` | On first successful `collect:done`, set `openreply.first_collect.done` and navigate to `#/topic/<slug>` (Insights tab if supported). |
| B2 | `collect.js` | Optional modal before redirect: “Brief ready — Open insights”. |
| B3 | `collect.js` | First collect only: if `!openreply.first_collect.done` and no `last_aggressive` in localStorage, default `aggressive = false`. |

### Phase C — Empty home (half day)

| # | File | Change |
|---|------|--------|
| C1 | `app-tauri/src/screens/home.js` | When `topics.length === 0`, render single hero + quick-start; hide BYOK / products / top-opportunities slots. |
| C2 | `home.js` | After first topic exists, restore full dashboard layout. |

### Phase D — Post-first-session (later)

| # | File | Change |
|---|------|--------|
| D1 | `home.js` | 3-step checklist card until user dismisses or completes items. |
| D2 | `welcome.js` step 1 | Defer “Product Mode” branch until `openreply.first_collect.done` is set. |

### Build & ship to the other PC

```bash
# From repo root — production DMG (macOS)
cd app-tauri
npm run tauri build

# Or dev build for faster iteration
npm run tauri dev
```

Copy the `.dmg` from `app-tauri/src-tauri/target/release/bundle/dmg/` (path may vary by version) to the test machine, install, then reset state using the guide below.

---

## Fresh install testing (other PC or same Mac)

Three levels: **soft** (onboarding only), **medium** (UI state), **hard** (true first install).

### Level 1 — Soft reset (wizard only, keeps DB & keys)

In the running app:

1. **Settings** → scroll to onboarding → **Reset onboarding**
2. Quit the app fully (Cmd+Q), reopen
3. You should land on `#/welcome` step 1

Or in DevTools console (right-click → Inspect if dev build; production may need `tauri dev` or enable devtools):

```javascript
localStorage.removeItem('openreply.onboarding.completed');
localStorage.removeItem('openreply.onboarding.step');
localStorage.removeItem('openreply.onboarding.pending_topic');
localStorage.removeItem('openreply.onboarding.pending_aggressive');
localStorage.removeItem('openreply.onboarding.pending_route');
localStorage.removeItem('openreply.first_collect.done'); // after you add Phase B
location.hash = '#/welcome';
location.reload();
```

**Does not clear:** SQLite topics, API keys (`~/.config/openreply/.env`), licence file.

---

### Level 2 — Medium reset (feels new, keeps corpus)

1. Quit OpenReply completely.
2. Delete **webview / UI state** by clearing app support (see paths below) **or** run in DevTools before quit:

```javascript
Object.keys(localStorage)
  .filter(k => k.startsWith('openreply.'))
  .forEach(k => localStorage.removeItem(k));
```

3. Reopen → welcome wizard, empty tabs, no dashboard cache.

**Optional:** Settings → **Reset every local preference** (keeps onboarding keys unless you removed them in step 2).

**Keeps:** `openreply/openreply.db` (all topics/posts) unless you delete the data folder.

---

### Level 3 — Hard reset (true fresh install)

Quit the app, then delete these locations for bundle id **`com.shantanu.openreply`**:

#### macOS

```bash
# App data (SQLite, licence, exports, chroma, etc.)
rm -rf "$HOME/Library/Application Support/com.shantanu.openreply"

# BYOK / shared env (API keys written by Settings)
rm -rf "$HOME/.config/openreply"

# Optional: legacy path mentioned in HOW_TO_USE.md
rm -rf "$HOME/.config/reddit-myind"
```

Then **uninstall** OpenReply (drag from Applications to Trash) and install your test `.dmg` again.

#### Windows

```powershell
# Typical Tauri app data (adjust if your installer uses a different folder)
Remove-Item -Recurse -Force "$env:APPDATA\com.shantanu.openreply" -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force "$env:USERPROFILE\.config\openreply" -ErrorAction SilentlyContinue
```

Uninstall from Settings → Apps, then reinstall.

#### Linux

```bash
rm -rf "$HOME/.local/share/com.shantanu.openreply"
rm -rf "$HOME/.config/openreply"
```

---

### What each store controls

| Location | What it affects |
|----------|-----------------|
| **WebView `localStorage`** (`openreply.*`) | Onboarding done, wizard step, profile name, prefs, tab strip (`openreply.tabs.v1`), dashboard cache, dismiss flags |
| **`~/Library/Application Support/com.shantanu.openreply/openreply/`** | SQLite DB, graphs, vectors, reports |
| **`~/Library/Application Support/com.shantanu.openreply/license_state.json`** | Device activation (when gate on) |
| **`~/.config/openreply/.env`** | LLM / Reddit API keys |

---

### macOS “first launch slow” (Gatekeeper) — separate from cache

The **10–30s warmup** on first open is macOS verifying the **bundled Python sidecar**, not your SQLite/localStorage. Clearing data **does not** replay that unless you:

- Delete and reinstall the `.app`, or
- Remove quarantine: `xattr -cr "/Applications/OpenReply.app"` (dev/testing only)

On a **second PC**, the first open after installing the DMG will still show the warmup once per machine.

---

### Recommended test script (other PC)

1. **Hard reset** (or never installed before).
2. Install DMG from your build.
3. First launch → note warmup banner timing.
4. Complete wizard with a **quick** topic (after Phase A3: aggressive off).
5. Wait for collect → confirm redirect to Insights (after Phase B).
6. Quit app → **Level 1** reset → confirm wizard returns, topics still in sidebar/list.
7. **Level 3** reset → confirm empty home + wizard + no topics.

---

## Related docs

- `docs/HOW_TO_USE.md` — end-user usage
- `changelogs/2026-04-21_20_whisper-reuse-and-onboarding.md` — onboarding history
- `docs/superpowers/specs/2026-04-19-app-ui-guidelines.md` — UI patterns
- `app-tauri/src/screens/welcome.js` — source of truth for wizard

---

## Changelog

| Date | Change |
|------|--------|
| 2026-05-28 | Initial analysis document |
| 2026-05-28 | Added implementation checklist + fresh-install reset guide |
