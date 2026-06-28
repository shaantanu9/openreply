# OpenReply — Inbox + Opportunities full user flow

**Date:** 2026-06-27
**Status:** Approved — implementing
**Decisions:** Opportunities = discovery, Inbox = workspace · Posting = both (queue + manual-assisted) · Scope = all 8 gaps

## Conceptual model

- **Opportunities (discovery):** run a `Find` scan → scored cards → triage each
  with **Save / Skip / Snooze**. Plus text search, sort, score filter, bulk
  actions, pagination, and loading/empty/error states.
- **Inbox (workspace):** tabs **Saved · Drafting · Ready · Posted**. Per card:
  generate draft → edit → **Save** (persisted, versioned) → **Approve** →
  **Queue** (scheduled) or **Mark posted** (manual-assisted: Copy + Open
  permalink). Draft history (versions), compliance display, search/sort/paginate.

## Status lifecycle

```
new ─Save→ saved ─Draft→ drafted ─Approve→ ready ─Queue→ queued ─(post)→ posted
 │                  ▲                                   └─Mark posted────────┘
 ├─Skip→ skipped    └── edit / redraft (new version)
 └─Snooze→ snoozed ─(snooze_until ≤ now)→ new
```

Inbox tabs: Saved=`saved`, Drafting=`drafted`, Ready=`ready`+`queued`, Posted=`posted`.

## Units

### 1. Schema (`reply/schema.py`) — additive, forward-compat `add_column`
- `reply_opportunities` += `snooze_until` int, `updated_at` int, `scheduled_at`
  int, `posted_at` int.
- `reply_drafts` += `updated_at` int, `version` int, `source` str
  (`generated`|`edited`). Keep all versions; current = max(version).

### 2. Backend (`reply/opportunity.py`, `reply/generate.py`)
- `OPPORTUNITY_STATUSES` += `snoozed`, `ready`, `queued`.
- `set_status` writes `updated_at`; sets `posted_at` on `posted`.
- New: `snooze(id, until_ts)`, `approve(id)`→ready, `queue(id, scheduled_at)`→queued,
  `mark_posted(id)`→posted.
- `_resurface_snoozed(db, brand_id, now)` flips expired snoozes → `new`; called at
  top of `find_opportunities` + `list_opportunities`.
- `list_opportunities(status, limit, min_score, query, sort, offset)` — `query`
  LIKEs title/body/author/sub; `sort` ∈ score|recent|engagement; `offset` paginates.
  Returns `{items, total}` (total for pagination). Snoozed excluded from default lists.
- `generate.py`: `save_draft(id, text, platform?)` writes a new version row
  (`version=max+1`, `source='edited'`), runs platform-aware compliance, sets opp
  `drafted` + `updated_at`. `list_drafts(id)` → all versions desc. `current_draft(id)`
  → latest. `generate_reply` sets `version`/`source='generated'`.
- Compliance (gap #8): `_platform_compliance(platform, text)` — length ceilings
  (`_LIMITS`), link/hashtag flags for non-Reddit; Reddit keeps `rules.check_compliance`.

### 3. CLI (`cli/reply_cmds.py`) — all `--json`
`save-draft -o ID --text T` · `drafts -o ID` · `approve -o ID` ·
`queue -o ID [--at ISO]` · `snooze -o ID --hours N` ·
`list` += `--query --sort --offset` · `set-status` inherits expanded statuses.

### 4. Tauri (`commands.rs` + `main.rs` register)
`reply_save_draft(opportunity,text)` · `reply_drafts(opportunity)` ·
`reply_approve(opportunity)` · `reply_queue(opportunity, scheduledAt?)` ·
`reply_snooze(opportunity, hours)` · `reply_list` += `query,sort,offset`.

### 5. API (`or/api.js`)
`replySaveDraft(id,text)` · `replyDrafts(id)` · `replyApprove(id)` ·
`replyQueue(id,scheduledAt)` · `replySnooze(id,hours)` ·
`replyList(status,minScore,limit,{query,sort,offset})`.

### 6. Opportunities screen (`or/dynamic.js renderOpportunities`)
Scan controls (platforms/limit/Find) · search box · sort dropdown · min-score
filter · per-card Save/Skip/Snooze (snooze = N-hour menu) · bulk select + bulk
Save/Skip · Load-more pagination · loading skeleton / empty / error states.

### 7. Inbox screen (`or/dynamic.js renderInbox`)
Tabs Saved/Drafting/Ready/Posted · per-card draft editor (Generate → textarea →
Save → Approve → Queue[schedule]/Mark posted) · Copy + Open-permalink · compliance
badge + notes · draft-history (versions) disclosure · search/sort · Load-more · states.

### 8. Docs
Spec (this) · changelog · FEATURES.md Inbox/Opportunities sections · graphify update.

## Testing
Python: unit tests for save_draft versioning, snooze resurface, list query/sort/offset.
Frontend: `vite build` clean. Manual: scan → Save → Inbox draft → edit → Save →
reload (persists) → Approve → Queue/Mark posted; Snooze → resurfaces; bulk skip.

## Build order / commits
One commit per unit (1→8), each self-contained. Backend (1–3) before bridge (4–5)
before screens (6–7) before docs (8).
