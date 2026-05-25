# Discovery-screens redesign + MCP diagnostics & timeout safety net

**Date:** 2026-05-02
**Type:** Refactor + Fix

## Summary

Two passes:

**A. UI redesign** — OST, Empathy Maps, Interviews, PMF Survey, and
Pricing Surveys were rewritten to use the same primitives Home/Topics
use: slash-style crumbs, `topbar-spacer`, `card-head`/`card-body`,
`stat-grid` headlines, `section-head` transitions, `pill .active`
tabs, and proper `btn btn-primary btn-sm` / `btn btn-ghost btn-sm
btn-bordered icon-btn` button classes. The screens now look and feel
like the rest of the app — consistent topbars, consistent cards,
consistent action footers.

**B. MCP resilience round 2** — adds a single-call diagnostics tool, a
hard timeout safety net for synchronous LLM tools, and an automatic
post-heal reindex job kickoff for `gapmap_semantic_search`. Combined
with the round-1 fixes (changelog 02), the failure modes the user hit
should now self-recover or surface a clear "call X next" hint.

## Changes

### A. UI redesign

- **`screens/pmf.js`** — replaced `.pmf-q card` quote panel with
  `.card` + `.card-head/body`; replaced custom score panel with
  `.stat-grid` (4 stat-cards: very-disappointed %, total responses,
  somewhat-disappointed count, not-disappointed count); replaced
  list+form pair with `.two-col` layout; replaced `class="btn primary"`
  with `class="btn btn-primary btn-sm"` everywhere.
- **`screens/empathy.js`** — quadrants now use `.card` with
  `.card-head` containing a colour-coded `.stat-icon` badge per
  quadrant; topbar uses slash crumbs + `topbar-spacer`; persona input
  styled to match `.search` chip; gap-note is its own `.card`.
- **`screens/interviews.js`** — added `summaryStats()` 4-stat grid
  (count, Mom Test rigour avg, top current-solution, top WTP signal);
  `.section-head` separates list from intro panels; intro Mom Test
  + "Why interviews" sit in a `.two-col` block; modal uses real
  `btn btn-primary btn-sm` / `btn btn-ghost btn-sm btn-bordered`.
- **`screens/pricing.js`** — tab strip is now `.filter-bar` of
  `.pill .active` (matching Home's filter bars) inside a
  `.section-head`; each instrument's headline is a `.stat-grid`
  (VW: OPP/IPP/PMC/PME; NPS: score/promoters/passives/detractors);
  forms wrapped in proper `.card` + `.card-head/body`.
- **`screens/ost.js`** — outcome panel is a `.card` with `.card-head`
  containing the inline edit button (replaces the old absolute-
  positioned override); each opportunity is now a real `.card` with
  `.card-head` (h3 label + mention count); topbar uses
  `btn-ghost btn-sm btn-bordered icon-btn` for the three Re-run
  buttons; `.section-head` separates outcome from opportunities and
  opportunities from the legend.
- **`style.css`** — dropped redundant outer padding/`max-width` from
  `.ost-wrap`, `.empathy-wrap`, `.iv-wrap`, `.pmf-wrap`, `.pricing-wrap`
  (the standard `.main` wrapper already pads them); removed the
  no-longer-needed absolute-positioned `#ost-outcome-edit-btn`
  override; kept `.ost-outcome` left-accent border.

### B. MCP resilience round 2

- **`gapmap_diagnostics`** (new tool) — single call probes DB, palace,
  LLM provider, and corpus; returns `{ok, db, palace, llm, corpus,
  suggestions: [str, ...]}`. Suggestions name the exact next tool to
  call ("Call gapmap_palace_repair(also_reindex=True)" / "Call
  gapmap_palace_warmup" / etc.) so a stuck agent can self-recover in
  one round-trip.
- **`gapmap_semantic_search`** auto-submits a `gapmap_palace_reindex`
  job when its in-line heal triggers. The first response after a heal
  carries `healed=True` + `reindex_job_id` so callers see the empty
  result-set and the recovery path in the same dict.
- **`_run_with_timeout()`** helper (new) — runs any callable on a
  worker thread with a hard deadline; on timeout returns a structured
  `{ok:False, timed_out:True, timeout_seconds, error, async_alternative}`
  dict instead of letting the MCP transport idle out. The `error`
  string names the async tool to use (`gapmap_jobs_submit("name", …)`)
  so the recovery path is obvious.
- **`gapmap_synthesize_insights`** wrapped in `_run_with_timeout` at
  the default 90s ceiling.

## Files Modified

- `app-tauri/src/screens/pmf.js`        — full rewrite
- `app-tauri/src/screens/empathy.js`    — full rewrite
- `app-tauri/src/screens/interviews.js` — full rewrite
- `app-tauri/src/screens/pricing.js`    — full rewrite
- `app-tauri/src/screens/ost.js`        — full rewrite
- `app-tauri/src/style.css`             — dropped redundant wrapper
                                          padding/max-width;
                                          removed `#ost-outcome-edit-btn`
                                          override
- `src/reddit_research/mcp/server.py`   — `_run_with_timeout` helper,
                                          `gapmap_diagnostics` tool,
                                          `gapmap_semantic_search`
                                          auto-reindex on heal,
                                          `gapmap_synthesize_insights`
                                          wrapped in timeout
