# Enterprise Daily Sync Plan (Site + App)

**Date:** 2026-04-27  
**Status:** Execution-ready plan  
**Owner:** shantanubombatkar2@gmail.com

---

## 1) Objective

Build a production-ready enterprise workflow where:

1. The **site** (activation-suite) and **desktop app** stay in sync on workspace/data state.
2. **Free users** can use real ingestion and real insights, but all their data is **public**.
3. **Paid users** (Pro/Live Pass/Team/Enterprise) can keep workspaces **private**.
4. Enterprise teams get **daily data injection + daily insight activity loops**.

---

## 2) Product Rules (Single Source of Truth)

### Visibility/Tiering

- Free: workspace visibility is always `is_public = true`.
- Paid: can toggle `is_public` true/false.
- Publish action:
  - If workspace private and user clicks Publish, backend sets it public and publishes snapshot.
- Unpublish action:
  - Allowed only for paid users.

### Sync Rules

- Site and app must read/write from the same backend contracts.
- Any visibility update must be enforced in backend API first, then reflected in UI.
- UI should never imply permission that backend denies.

### Daily Enterprise Loop

- Nightly/scheduled ingestion from configured sources.
- Morning synthesis with top gap changes and evidence-linked summaries.
- Team activity routing (owner, priority, due date, status).

---

## 3) Target Architecture

1. **Ingestion adapters** write normalized records into `posts`.
2. **Sweep/insight engine** writes `insights`, `sweeps`, workspace counters.
3. **Publish pipeline** creates `published_research` snapshots from insights only (no raw private text leakage).
4. **Tier gate** enforced in API routes (`workspaces`, `unpublish`, `publish`) using authenticated plan info.
5. **Site + app clients** consume same API semantics.

---

## 4) Data Model / Schema Requirements

Use existing schema as baseline and ensure these columns/tables remain canonical:

- `workspaces.is_public`
- `published_research` (+ `pro_publish`, `insights_snapshot`, `source_types`)
- `licenses.plan_id`, `licenses.live_pass_active`, `licenses.is_trial`, `licenses.trial_ends_at`
- `sweeps` for daily-run history
- Optional enterprise activity table:
  - `enterprise_actions` (`workspace_id`, `insight_id`, `owner`, `status`, `due_at`, `notes`, `created_at`, `updated_at`)

---

## 5) Implementation Plan (Phased)

## Phase A — Tier Enforcement and Visibility Consistency

**Goal:** Free=public is guaranteed everywhere.

Tasks:
- API-level gate for `is_public=false` in workspace create/update.
- API-level gate for unpublish endpoint.
- Publish endpoint sets `poweredBy` based on plan.
- Auth/session helper resolves plan and exposes `isPaidPlan`.
- Keep existing behavior: free users can still ingest real data and publish.

Success criteria:
- Free user cannot create/update private workspace.
- Free user cannot unpublish.
- Paid user can toggle private/public successfully.

---

## Phase B — Site/App Sync Contracts

**Goal:** same behavior in web UI and app UX.

Tasks:
- Site workspace pages:
  - Disable private controls for free users.
  - Show clear upgrade copy.
- Desktop app:
  - Read plan features from shared licence endpoint.
  - Mirror same visibility controls and error handling as site.
- Normalize error payloads (`402` for plan restriction, clear message body).

Success criteria:
- UI controls match backend capabilities for each tier.
- No contradictory state (toggle shown but action denied unexpectedly).

---

## Phase C — Daily Enterprise Data Injection

**Goal:** automated daily data refresh.

Tasks:
- Add scheduler runner (cron/launchd/server cron) calling ingest/sweep.
- Configurable source bundles per workspace (support, reviews, social, docs, etc.).
- Idempotent ingest keys per source event/document.
- Retry/backoff and dead-letter logging for failed adapters.

Success criteria:
- At least one enterprise workspace receives automatic daily updates.
- Re-runs do not duplicate records.

---

## Phase D — Daily Activity Layer

**Goal:** convert insights into daily team actions.

Tasks:
- Generate daily brief (`top_new_gaps`, `rising_gaps`, `competitor_shifts`).
- Add lightweight assignment workflow per insight.
- Expose daily digest endpoint for Slack/Email.

Success criteria:
- Daily brief available via UI and API.
- Actions can be tracked from open -> in_progress -> done.

---

## Phase E — Verification, Hardening, Rollout

Tasks:
- E2E tests for free/paid visibility rules.
- Build + typecheck + smoke tests.
- Migration checks in staging + production.
- Rollout with feature flags if needed.

Success criteria:
- Green build.
- Policy behavior validated in test and staging.
- No regressions in publish/explore flows.

---

## 6) Detailed Prompts Per Section (Copy/Paste)

Use these prompts with an implementation agent to execute each section cleanly.

### Prompt A — Tier Gate Backend

```text
Implement strict tier gating in activation-suite API so free users always stay public:

1) In auth/session helper, resolve current plan and expose:
   - planId
   - isPaidPlan (true for pro/live_pass/team)
2) In POST /api/v1/workspaces:
   - if request asks is_public=false and !isPaidPlan, return 402 with clear upgrade message
   - force is_public=true for free users
3) In PATCH /api/v1/workspaces/:id:
   - deny is_public=false for free users with 402
4) In POST /api/v1/unpublish:
   - deny for free users with 402
5) Keep free users fully able to ingest and publish public research.
6) Add/adjust tests to confirm behavior.
```

### Prompt B — Publish Metadata and Explore Consistency

```text
Update publish behavior so metadata reflects tier:

1) In publish route, set poweredBy:
   - "OpenReply Community" for free
   - "OpenReply Pro" for paid
2) Ensure publish can auto-flip private->public when user explicitly publishes.
3) Ensure explore feed only includes published/public snapshots.
4) Add tests for both free and paid publish paths.
```

### Prompt C — Site UX Parity

```text
Make workspace UI accurately represent tier limits:

1) On workspaces create page, fetch current licence/features.
2) If free:
   - private toggle disabled
   - helper copy says all workspaces are public on free
3) On workspace detail/settings:
   - disable private visibility controls for free
   - show upgrade hint inline
4) Preserve paid behavior unchanged.
5) Ensure no TypeScript/lint warnings.
```

### Prompt D — Desktop App Sync

```text
Bring desktop app policy parity with activation-suite:

1) Fetch plan/features from shared licence endpoint before visibility actions.
2) If free, do not allow private/unpublish actions in desktop UI.
3) Surface same error messages as web (402 => upgrade required).
4) Ensure workspace state refreshes after publish/unpublish.
5) Add smoke test for free and paid visibility actions.
```

### Prompt E — Daily Ingestion Scheduler

```text
Implement daily automated data injection:

1) Add scheduler job that runs sweep for enabled enterprise workspaces once daily.
2) Add per-workspace source config support and idempotency keys.
3) Add retry with backoff and failure logs.
4) Expose job status endpoint with last run, next run, and error summary.
5) Add basic tests for scheduler orchestration and duplicate prevention.
```

### Prompt F — Daily Brief + Team Activity

```text
Build a daily activity layer on top of insights:

1) Generate a daily brief per workspace:
   - new gaps
   - rising gaps
   - competitor shifts
2) Add an enterprise_actions table and CRUD APIs:
   - owner, priority, status, due_at, notes
3) Add UI panel for "Today’s actions" tied to insights.
4) Add Slack/email digest formatter endpoint.
5) Add tests for daily brief computation and action lifecycle.
```

### Prompt G — Release Hardening

```text
Run release hardening for site+app sync changes:

1) Run full build/typecheck/lint/tests.
2) Verify free vs paid behavior in e2e:
   - create workspace private
   - update visibility private
   - unpublish
   - publish
3) Confirm explore/public output has no private data leakage.
4) Produce a rollout checklist and rollback plan.
5) Update changelog and docs.
```

---

## 7) Build and Verification Checklist

Run from `act_suit/activation-suite`:

```bash
npm run build
npm run lint
```

Run app-side build/test commands (project-specific):

```bash
# Example placeholders; replace with actual app-tauri verification commands
cd app-tauri
npm run build
```

API verification matrix:

- Free user:
  - create `is_public=false` -> `402`
  - patch `is_public=false` -> `402`
  - unpublish -> `402`
  - publish -> `200`, visible in explore
- Paid user:
  - create/patch private -> `200`
  - unpublish -> `200`
  - publish -> `200`

---

## 8) Rollout Strategy

1. Deploy backend gates first.
2. Deploy site UI parity second.
3. Deploy desktop parity third.
4. Enable enterprise daily scheduler for pilot tenants.
5. Expand to all enterprise customers after 1-week monitoring.

---

## 9) Risks and Mitigations

- **Risk:** UI and API drift again.  
  **Mitigation:** single policy in auth helper + policy e2e tests.

- **Risk:** accidental private data exposure in public snapshots.  
  **Mitigation:** snapshot only structured insights; block raw post text in publish serializer.

- **Risk:** scheduler duplicates data.  
  **Mitigation:** idempotency keys and unique constraints on source ingestion IDs.

---

## 10) Definition of Done

- Free/public policy enforced backend + reflected in both site and app.
- Paid/private workflow functional end-to-end.
- Enterprise daily ingest and daily brief operational for pilot workspace(s).
- Build green, tests green, docs updated.

