# Follow-ups — 2026-05-28 session

Items deferred from the multi-agent ship session of 2026-05-28
(versions v0.1.2 → v0.1.3 → in flight toward v0.1.4). Each
references the changelog or commit where the deferral was first
noted, so the rationale is one click away.

Last updated: 2026-05-28.

---

## P1 — correctness / data flow gaps

### 1. Source-family normalization across 14 remaining `source_type` consumers

**Why:** YouTube transcripts + descriptions now flow into sentiment,
audience, sources tab, posts display, and LLM extraction (shipped in
`2026-05-28_12_youtube-subtypes-flow-into-corpus.md`). But 14 other
files still group/filter on RAW `source_type` — so the same fragmentation
bug will reappear if any future source adopts subtype tagging
(e.g. `github_issues` + `github_pulls` as planned, `arxiv` + `arxiv_fulltext`).

**Files to migrate to `normalizedSource` (JS) / `NORMALIZED_SOURCE_SQL`
(Python):**

- `app-tauri/src/screens/database.js`
- `app-tauri/src/screens/papers.js`
- `app-tauri/src/screens/ingest.js`
- `app-tauri/src/screens/intent_ladder.js`
- `app-tauri/src/screens/sentiment.js` (display side; aggregation
  already migrated)
- `app-tauri/src/screens/insights.js`
- `app-tauri/src/screens/find.js`
- `app-tauri/src/screens/topic.js` (the subsSql `subsSql` only —
  srcSql already migrated)
- `app-tauri/src/screens/science.js`
- `app-tauri/src/lib/tabPipelines.js`
- `app-tauri/src/api.js`
- `src/openreply/research/search_all.py`
- `src/openreply/research/collect.py`
- `src/openreply/research/ingest.py`
- `src/openreply/research/paper_fulltext.py`
- `src/openreply/research/gap_discovery.py`
- `src/openreply/research/empathy.py`

**Approach:** import the existing helper at each site. JS:
`import { normalizedSource, YT_FAMILY } from '../lib/postLink.js'`.
Python: `from ..sources.source_families import normalize_source_type,
NORMALIZED_SOURCE_SQL`. One-line swap per call site.

**Estimated effort:** ~1 hour for all 14. Mechanical refactor.

### 2. `_06_top-subreddits-overflow-and-mislabel.md` — topic.js portion never landed

**Why:** The parallel-agent changelog at
`changelogs/2026-05-28_06_top-subreddits-overflow-and-mislabel.md`
claims `topic.js` was updated so `subsSql` scopes the "Top subreddits"
card to the reddit family only. The `find.js` portion shipped (now uses
`REDDIT_FAMILY`), but `topic.js` was never actually edited — the
SQL still pulls `p.sub` from every source, so non-Reddit buckets
(GNews feed names, GitHub repo paths, arXiv venues, RSS slugs)
still render as `r/<long-url>` in the "Top subreddits" tile.

**Fix:** apply the scope filter in `topic.js`'s two `subsSql`
definitions (lines ~1581 + ~2923 — both gain a `WHERE p.source_type
IN (...REDDIT_FAMILY)` clause). Update the changelog with the actual
edits once shipped, OR delete the topic.js portion of the changelog
if the fix is being deferred indefinitely.

### 3. Chat listener module-scope hoist (chat tokens lost on tab switch)

**Why:** Flagged in `changelogs/2026-05-28_09_provider-timeouts-and-
chat-throttle-save.md` as out of scope for that fix. Current state:
chat `token` / `text` events save to `chatHistory` on a 2s throttle,
which prevents data loss on reload. But the listeners themselves are
registered per-screen, so navigating away from a chat tab mid-stream
unmounts them — tokens after the navigation aren't appended to the
buffer at all. They'd appear "missing" when the user returns even
though they hit the LLM.

**Fix:** match the collect-listener pattern from
`changelogs/2026-05-28_04_collect-log-survives-navigation.md` —
hoist the `chat:progress` / `chat:done` listeners to module scope
in `screens/topic.js`, keep a global per-topic chat buffer, route
DOM updates through a screen-aware handler.

### 4. Long-running LLM jobs still pin the daemon mutex

**Why:** Flagged in `changelogs/2026-05-28_06_daemon-lock-timeout-
fallback.md` as out of scope. The daemon lock now has a 3s/6s timeout
fallback to one-shot Python spawns, so quick UI queries no longer
freeze when sentiment is running. But two concurrent LLM jobs
(e.g. user clicks Audience while sentiment is running) still serialize
— the second one falls back to one-shot, which is a fresh Python
process per call (~200ms dev / ~2-5s prod boot).

**Real fix:** route long LLM jobs (sentiment-by-source,
audience-build, concepts, run_monitor) through `run_cli_streaming`
so they spawn their own short-lived process and never touch the
daemon. The daemon becomes purely a "warm cache for quick queries"
rather than a single-flight serializer for everything.

---

## P2 — display / UX polish

### 5. Per-screen incremental DOM updates instead of full remounts

**Why:** Flagged in `changelogs/2026-05-28_08_app-stops-refreshing.md`
as out of scope. The `openreply:db-changed` listener currently full-remounts
list-of-everything screens (topics list, posts list, findings list)
when SQL data changes. A debounce + skip-list combo dramatically
reduced user-visible churn, but the remount on Activity / Find /
Search / Database tabs still feels heavy.

**Fix:** opt-in `openreply:data-update` handler per screen that appends
new rows / cards and updates counts in place. Out of scope until
someone takes the full pass through all list screens.

### 6. Sentiment per-source: explicit subtype breakdown

**Why:** Shipped in
`changelogs/2026-05-28_12_youtube-subtypes-flow-into-corpus.md` — all
3 YouTube subtypes roll up under one "YouTube" sentiment card. But
some users might want to see a per-subtype breakdown ("YouTube
viewer sentiment vs YouTube speaker themes" — these are very
different signals).

**Fix:** add a "Show by subtype" toggle on the YouTube sentiment
card that re-queries with the raw `source_type` group. Optional —
only worth doing if users ask.

### 7. Find tab: show YouTube subtype label

**Why:** `find.js` got `REDDIT_FAMILY`-gated `r/<sub>` labels in
`changelogs/2026-05-28_05_fix-source-link-builder-non-reddit.md`. But
the equivalent YouTube-subtype label (`channel: X · transcript chunk`)
that `posts.js` got in
`changelogs/2026-05-28_12_youtube-subtypes-flow-into-corpus.md` was
NOT added to `find.js`. Search results for a topic with YouTube
content will show `youtube_transcript` and `youtube_description`
as raw source labels.

**Fix:** import `youtubeSubtypeLabel` from `lib/postLink.js` and
apply in the find.js result row renderer.

---

## P3 — pipeline / infrastructure

### 8. Reusable workflow refactor for the 3 per-platform release files

**Why:** Flagged in
`changelogs/2026-05-28_11_release-pipeline-per-platform-split.md`. The
3 new per-platform release workflows (`release-mac.yml`,
`release-windows.yml`, `release-linux.yml`) duplicate ~80% of their
shared "build sidecar + npm ci + tauri-action + upload to public"
steps. Deliberately kept inline for first-pass simplicity but if any
maintenance burden grows (e.g. updating uv version across all 3),
factor into a `_release-build.yml` reusable workflow called via
`workflow_call`.

**Decision criterion:** if we touch all 3 files for the same change
more than twice in 2 weeks, refactor.

### 9. Legacy `release.yml` removal

**Why:** The old monolithic workflow is now `workflow_dispatch`-only
(escape hatch). Once the 3 per-platform workflows have shipped 2-3
successful releases, delete `release.yml` entirely. The cross-repo
publish logic + friendly asset labels live in each per-platform
file already, so nothing is lost.

### 10. Mac runner upgrade for sccache amplification

**Why:** Tier 1 caches (sccache + PyInstaller cache) added in v0.1.4
should cut Windows Tauri build from 9m 45s to ~5-6m. If real-world
data shows >7m still, evaluate `macos-latest-large` (or
`windows-2025-large`) — costs $0.016/min for private repos but free
for public ones.

---

## P4 — verification gaps

### 11. Manual GUI verification queue (for the next other-device test)

All recent changes have GUI runtime verification deferred because no
Playwright/xvfb harness exists in the repo. Drive each one through
the actual app window on the test device:

- [ ] **Sidebar full ↔ rail ↔ hidden cycle + ⌘B + hover-reveal strip**
  (`_04_sidebar-minimize.md`, `_08_sidebar-expand-blank-screen.md` —
  this commit). Specifically: minimise → expand should never blank
  the main column.
- [ ] **Sentiment "Analyzing…" loader** (`_05_sentiment-analyzing-loader.md`,
  `_05_sentiment-live-progressive-cards.md`). Hero + skeleton cards
  + cycling stages + asymptotic progress bar + live per-source card
  fill from SQLite polling.
- [ ] **Manual-click enrich preempt** (`_02_enrich-manual-preempt.md`).
  Toolbar Enrich button while auto-enrich is in flight should kill
  the auto pass and start the user's request fresh.
- [ ] **YouTube content in corpus + analysis**
  (`_12_youtube-subtypes-flow-into-corpus.md`). Collect a topic with
  YouTube. Expect ONE YouTube tile, ONE YouTube sentiment card whose
  summary references both viewer reactions AND speaker themes,
  posts tab showing `channel: X · transcript chunk` / `· video
  description` labels.
- [ ] **Hard-reset Danger Zone**
  (`_10_app-hard-reset-danger-zone.md`). Typed-DELETE flow wipes
  data_dir + `.config/openreply/.env` + localStorage and relaunches into
  fresh welcome wizard.
- [ ] **Daemon lock timeout** (`_06_daemon-lock-timeout-fallback.md`).
  Run a long LLM job, switch to Settings — cards should refresh
  within ~6s instead of hanging.
- [ ] **Topic tabs reorder** (`_10_topic-tabs-journey-order.md`).
  Verify the new left-to-right tab order matches the documented
  journey.

### 12. CI lint for the YAML workflows

**Why:** All 4 release YAML files were validated locally via
`yaml.safe_load`, but GitHub Actions can still reject them at trigger
time for schema issues `yaml.safe_load` doesn't catch (e.g. unknown
`uses:` reference, secrets used without `permissions:`, matrix
combinations exceeding limits).

**Fix:** add `actionlint` or the `rhysd/actionlint` GitHub Action as
a CI step in `ci.yml` that runs on every PR touching `.github/workflows/`.
30-second job; catches the v0.1.X-1 class of CI tag-push panic.

---

## Done in the same session

For completeness — not follow-ups, but recap of what shipped:

- v0.1.3 release (Danger Zone hard reset + sidebar minimize +
  sentiment Analyzing loader + manual-click enrich preempt +
  daemon-mutex timeout + LLM provider HTTP timeouts + chat
  throttle-save + parallel-agent batch of 4 fixes).
- Release pipeline split into 3 per-platform workflows + Tier 1
  caches (sccache + PyInstaller + ONNX).
- YouTube subtypes flow into corpus + LLM analysis.
- Sidebar hidden → full grid-track auto-placement bug fix (this commit).
- Three new global skills published: `loader-progress-ux`,
  `git-safety-parallel-agents`, plus 3 new phases (24, 25, 25.5, 26)
  on `tauri-python-sidecar-app`.

## How to use this file

When picking up follow-up work in a future session:
1. Read this file first.
2. Pick a single item — don't batch across P-levels.
3. Move the item to a `done-2026-MM-DD.md` companion file when shipped.
4. Add new follow-ups discovered during the work back to this file.
