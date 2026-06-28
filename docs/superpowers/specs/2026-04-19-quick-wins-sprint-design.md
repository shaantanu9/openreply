# Quick-wins sprint — design

**Date:** 2026-04-19
**Status:** Approved, ready for implementation planning
**Scope:** Three independent features that leverage existing infrastructure; each ships as its own Part in a single combined plan for session efficiency.

## Goal

Close three of the eight honest-gap items from `docs/self-gap-analysis.md` that can ship without new infrastructure:
- **A: Emergent theme clustering via embeddings** — merge near-duplicate painpoints/workarounds so the findings sidebar doesn't show `"Hard to track calories while eating out"` three times with trivial wording differences.
- **B: Diff-two-corpora mode** — show "what changed in the last 7 days vs the prior 30" for a topic, surfacing genuinely new painpoints rather than repeat-showing the same ones after every re-collect.
- **C: Scheduled weekly runs** — local cron/launchd entry that re-runs collect automatically, with an in-app "N changes since your last visit" banner. No email in MVP.

## Non-goals (explicitly out of scope)

- Cross-topic comparisons (diff is within a single topic over time, not across topics).
- Cloud scheduling / cross-device sync.
- Email / push notifications (banner only).
- Renaming the existing static-split CHRONIC/EMERGING/FADING — diff mode sits alongside, not replaces it.

---

## Part A — Emergent theme clustering

### Problem
`upsert_semantic` deduplicates on exact slug match (`_slug(label)`). Near-duplicates like "Can't log food when eating out" and "Hard to track calories at restaurants" land as two separate painpoint nodes. Users see repetitive cards.

### Approach
After the LLM extractor returns findings and BEFORE `upsert_semantic` persists them, run an embedding-cluster pass that collapses near-duplicates within each finding kind. Keep the best representative (highest frequency/evidence) and attach the others as aliases.

### Files
| File | Change |
|---|---|
| `src/reddit_research/retrieval/cluster.py` | **New.** `cluster_findings(findings_by_kind: dict, threshold=0.82) -> dict` — embeds each label, groups by cosine similarity ≥ threshold, returns merged list. Uses the existing palace ChromaDB embedder (or skip-gracefully passthrough if not installed). |
| `src/reddit_research/graph/semantic.py` | `upsert_semantic` calls `cluster_findings` on inputs before persisting. Merged entries get `aliases: [<other labels>]` in their metadata. |
| `src/reddit_research/graph/export.py` | Viewer rendering shows `"N variants"` chip on a finding if `metadata.aliases` is non-empty. Hover/click shows the alias list. |
| `tests/test_integration.py` | 3 tests: `test_cluster_merges_near_duplicates`, `test_cluster_preserves_distinct`, `test_cluster_passthrough_without_chromadb`. |

### Data contract
```python
# Input: {"painpoints": [{"painpoint": "...", "severity": "high", ...}, ...], ...}
# Output: same shape, with optionally added "aliases": ["Other label 1", "Other label 2"]
# Alias winner: highest `frequency` (int), tie-break by evidence count.
```

### Risks
- Threshold 0.82 is a guess — may need tuning. Expose as env var `OPENREPLY_CLUSTER_THRESHOLD` for power users.
- Chroma cold-start is ~2-5s; acceptable since this runs inside enrich (already slow).
- If chromadb isn't installed, `cluster_findings` passes findings through unchanged — no UX regression.

---

## Part B — Diff-two-corpora (time-windowed trends)

### Problem
The existing CHRONIC/EMERGING/FADING split is anchored to a hardcoded May-2025 cutoff. It tells you "this has been around since before May 2025" but not "this appeared in the last week." Users running weekly collects want to see *what's new since last time*.

### Approach
Add a `ts` column to `graph_nodes` (ISO UTC timestamp), set by `_upsert_node` on first insert (NOT on re-insert). Update `_upsert_node` to keep existing `ts` if the node already exists. Add a new CLI command + Rust command + frontend view that queries "painpoints with ts in last 7 days" vs "painpoints with ts in prior 23 days (days 8-30)."

### Files
| File | Change |
|---|---|
| `src/reddit_research/core/db.py::init_schema` | Add `ts` column to `graph_nodes` creation. For migration of existing installs: if `ts` column missing, `ALTER TABLE graph_nodes ADD COLUMN ts TEXT DEFAULT ''`. |
| `src/reddit_research/graph/build.py::_upsert_node` | Set `ts` to `datetime.utcnow().isoformat()` on insert; preserve existing `ts` on update (SQL `COALESCE(ts, :new_ts)`). |
| `src/reddit_research/graph/diff.py` | **New.** `diff_findings(topic, window_days=7) -> dict` — returns `{recent: [nodes added in last N days], prior: [nodes added before that], stable: [pre-existing]}`. |
| `src/reddit_research/cli/main.py` | New command `research diff --topic <t> --window 7`. |
| `src-tauri/src/commands.rs` | New command `diff_findings(topic, window_days)` wrapping the CLI. |
| `app-tauri/src/screens/topic.js` | New "Changes" sub-section OR augment existing Trends tab — show "N new this week" chip next to findings, highlight new rows with a "NEW" badge. |
| `tests/test_integration.py` | 2 tests: `test_diff_returns_recent_only`, `test_diff_migration_backfills_empty_ts`. |

### Data contract
```python
{
  "topic": "calorie tracking",
  "window_days": 7,
  "recent": [<node dicts with ts in last 7d>],
  "prior":  [<node dicts with ts in days 8-30>],
  "stable": [<node dicts older than 30d or without ts>],
  "summary": {"new_painpoints": 4, "new_workarounds": 1, "new_products": 0, "new_feature_wishes": 2},
}
```

### Risks
- Existing `graph_nodes` rows will have empty `ts` after the ALTER TABLE. They fall into `stable`. That's correct — treat "pre-timestamp" data as baseline.
- Users who re-run collect at slightly different times: we use node creation ts, not run ts. If a node is re-extracted by the LLM, its original ts sticks (good — avoids false "new" flags for re-extractions).

---

## Part C — Scheduled runs + in-app changes banner

### Problem
Users have to manually click Rerun collect. Research ops teams want weekly re-runs without opening the app. The "here's what's new since you last looked" loop isn't closed.

### Approach
macOS-first (launchd), fall back to skeleton Linux/Windows. Tauri command writes a `.plist` to `~/Library/LaunchAgents/` with the user's chosen interval; `launchctl load` enables it. The plist calls a new subcommand `reddit-cli schedule-tick` that walks all topics marked as "scheduled" and re-runs collect on each. On app open, a banner shows the diff summary from Part B for each topic that ran since the last visit.

### Files
| File | Change |
|---|---|
| `src/reddit_research/cli/main.py` | New subcommand `schedule-tick` — iterates topics with `scheduled=1`, runs collect for each. Also `schedule-enable --topic <t>` / `schedule-disable --topic <t>`. |
| `src/reddit_research/core/db.py::init_schema` | Add column `scheduled INTEGER DEFAULT 0` to a new `topic_prefs` table, plus `last_run_seen` (ISO UTC, updated when user opens topic page). |
| `src-tauri/src/commands.rs` | New commands: `schedule_install(interval_hours)`, `schedule_uninstall()`, `schedule_status() -> {installed, next_run, interval_hours}`, `schedule_enable_topic(topic, enabled)`, `schedule_since_last_seen(topic) -> {summary}`. |
| `src-tauri/src/schedule.rs` | **New.** Platform-specific helpers — generates launchd plist on macOS, registers/unregisters it. Windows/Linux return `{installed: false, reason: "not supported on this platform"}`. |
| `app-tauri/src/screens/settings.js` | New "Scheduled runs" section: interval picker (Every 6h / Daily / Weekly / Off), status display. |
| `app-tauri/src/screens/topic.js` | Toggle: "Include in scheduled runs" per-topic. Banner at top of Map tab: "3 new painpoints since you last viewed. [View changes]". |
| `tests/test_integration.py` | 2 tests: `test_schedule_tick_runs_only_flagged_topics`, `test_schedule_since_last_seen_marks_visit`. |

### Data contract (commands)
```
schedule_install(interval_hours: u32) -> {installed: bool, path: string}
schedule_uninstall() -> {uninstalled: bool}
schedule_status() -> {installed: bool, path: string?, next_run: string?, interval_hours: u32?}
schedule_enable_topic(topic: string, enabled: bool) -> {ok: bool}
schedule_since_last_seen(topic: string) -> {summary: {new_painpoints, new_workarounds, ...}, since_ts: string}
```

### Platform support
- **macOS:** full support via launchd. Plist path: `~/Library/LaunchAgents/com.shantanu.openreply.schedule.plist`.
- **Linux:** return `{installed: false, reason: "use cron manually; see docs/manual-todo/schedule-linux.md"}`. Write a simple stub doc.
- **Windows:** return same-shape "not supported" response.

### Risks
- launchd requires the sidecar binary's absolute path. Must resolve dynamically at install time — can't hardcode.
- Scheduled runs compete with user-initiated runs for the collect lock. We respect the existing `ActiveJob` mutex; `schedule-tick` bails out fast if one is already running.
- Missing API keys mid-schedule: respect the existing Phase-4 skip-gracefully pattern — run collect without enrich, log to fetches table.

---

## Testing & acceptance

- [ ] A: Two painpoints with labels differing by 1-2 words merge into one node with `aliases` populated. A distinct painpoint stays separate.
- [ ] B: Running collect twice a day apart produces `recent` with ~0 items on the second call (everything is pre-existing), but after a week a new re-extracted finding shows up in `recent`.
- [ ] C: Installing a schedule creates the plist; `launchctl list | grep openreply` shows the agent loaded; disabling removes it.
- [ ] C: After a scheduled run completes and user reopens the app, the topic's Map tab shows the "N new since last viewed" banner.
- [ ] All 7 existing canonicalization + viewer-MVP tests still pass.
