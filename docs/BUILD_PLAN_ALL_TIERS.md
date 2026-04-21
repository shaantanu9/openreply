# All-Tiers Build Plan — shipping the MISSING_AND_NEXT backlog

**Version:** 2026-04-21
**Scope:** Complete implementation of Tiers 1–6 from `docs/MISSING_AND_NEXT.md`,
minus items architecturally blocked on a cloud backend (clearly marked).

## Execution strategy

### Parallelism
Work dispatched across 5 subagents + foreground (main session):

| Lane | Owner | Cluster | Independent? |
|---|---|---|---|
| **FG**  | Main session    | Soft-delete backbone (T1.3) + Dashboard right-click delete (T1.1) + Relevance UI surfaces (T1.5/T1.6) | — |
| **AG-B**| subagent        | Multi-language embeddings (T2.3) + strict-mode post-quality filter (T2.2) | Yes — touches `retrieval/`, `research/relevance.py` |
| **AG-C**| subagent        | Global competitor dedup view (T2.5) + Finding feedback 👎 (T2.4) | Yes — touches new `competitors.py` fn + new `finding_feedback` table |
| **AG-D**| subagent        | Topic comparison view (T3.2) + CSV bulk ingest (T3.6) | Yes — new screens, extends `ingest.py` |
| **AG-E**| subagent        | Custom extractor prompts (T3.7) + Saved views (T3.1) | Yes — new prefs storage |
| **AG-F**| subagent        | GitHub Actions CI (T5.6) + LFS prune docs (T5.5) | Yes — `.github/workflows/` |

### Conflict avoidance rules
- Any append to shared files (`commands.rs`, `main.rs`, `api.js`, `style.css`,
  `cli/main.py`) goes at the **bottom** of each logical section, after a
  `// ── <LANE-ID>: <feature> ──` header comment.
- No subagent may modify `core/db.py` — the main session owns schema changes
  and publishes migrations to subagents as pre-conditions.
- No subagent may modify `research/insights.py`'s synthesis flow — FG owns it.

### Item-by-tier coverage

Mapping each item from `docs/MISSING_AND_NEXT.md` to lane or deferral.

#### Tier 1 — Retention blockers

| # | Item | Lane | Status |
|---|---|---|---|
| T1.1 | Delete on Dashboard tiles | FG | ship |
| T1.2 | "Re-collect" button on topic page | FG | ship |
| T1.3 | Soft-delete + 7-day undo | FG | ship |
| T1.4 | Synthesis progress + cancel (chunked) | FG | ship (chunked path) |
| T1.5 | Relevance gate UI (dropped posts chip) | FG | ship |
| T1.6 | Insights "dropped findings" fold | FG | ship |

#### Tier 2 — Quality ceilings

| # | Item | Lane | Status |
|---|---|---|---|
| T2.1 | Trustpilot API / YouTube / TikTok sources | — | **deferred** (requires API partnerships / closed auth) |
| T2.2 | Post-quality filter (strict mode) | AG-B | ship |
| T2.3 | Multi-language embeddings | AG-B | ship (config knob + model swap) |
| T2.4 | Finding feedback (👎 button) | AG-C | ship |
| T2.5 | Global competitor dedup view | AG-C | ship |
| T2.6 | Citation modal polish | FG | ship (small) |

#### Tier 3 — Power-user features

| # | Item | Lane | Status |
|---|---|---|---|
| T3.1 | Saved views / smart filters | AG-E | ship |
| T3.2 | Topic comparison view | AG-D | ship |
| T3.3 | Progressive insights during collect | — | **deferred** (requires synth restructure; not worth AG allocation vs. user value) |
| T3.4 | PDF / DOCX / PPTX export | — | **partial** (markdown ships; PDF deferred per existing `docs/manual-todo/phase7-pdf-export.md`) |
| T3.5 | Shared link / read-only topic page | — | **deferred** (requires cloud backend) |
| T3.6 | CSV bulk ingest | AG-D | ship |
| T3.7 | Custom extractor prompts | AG-E | ship |

#### Tier 4 — Product Mode second wave

| # | Item | Lane | Status |
|---|---|---|---|
| T4.1 | Daily sweep scheduler (launchd) | FG | ship (extends existing `schedule.rs`) |
| T4.2 | Native OS notifications | FG | ship (via `notification` Tauri plugin if present, otherwise deferred) |
| T4.3 | Convert-topic CTA in Product wizard | FG | ship (small) |
| T4.4 | Signal dashboard polish | FG | ship (small) |
| T4.5 | OAuth Intercom / Zendesk / Stripe | — | **deferred** (cloud / vault) |
| T4.6 | Stripe billing | — | **deferred** (account system) |
| T4.7 | Email / Slack digest delivery | — | **deferred** (relay) |

#### Tier 5 — Infrastructure debt

| # | Item | Lane | Status |
|---|---|---|---|
| T5.1 | Unit + integration tests | FG | ship (insight-engine core + relevance-gate + resolver) |
| T5.2 | Prompt versioning + A/B | — | **deferred** (nice-to-have; skip for now) |
| T5.3 | Opt-in telemetry (local log) | — | **deferred** (requires relay / privacy review) |
| T5.4 | Perf budgets | FG | ship (timing instrumentation + Settings chip) |
| T5.5 | LFS prune cadence doc | AG-F | ship |
| T5.6 | GitHub Actions CI | AG-F | ship |

#### Tier 6 — UX polish

All small. Batched in FG:

| # | Item | Lane | Status |
|---|---|---|---|
| T6.1 | Onboarding step 3 key-detect (.env already-exists) | FG | ship |
| T6.2 | Per-source collect status chips | FG | ship |
| T6.3 | Finding severity manual override | FG | ship |
| T6.4 | "Bet due today" native notification | FG | ship (bundles with T4.2) |
| T6.5 | ⌘K command palette | FG | ship |
| T6.6 | Pinned / favorite topics | FG | ship |
| T6.7 | Print-friendly Minto header | FG | ship (CSS @media print) |
| T6.8 | Dark mode audit pass | FG | ship |

### Deferral justifications

- **T2.1 third-party API sources** — all require credentials / partnerships
  out of engineering scope. Revisit when business dev unlocks each one.
- **T3.3 progressive insights** — requires restructuring synth to accept
  partial corpora + streaming LLM responses. 2-3 day rework. Skip this pass.
- **T3.4 PDF/DOCX/PPTX** — existing docs/manual-todo/phase7-pdf-export.md
  has full deferral reasoning. Keep that reasoning.
- **T3.5 shared link** — needs a bucket + auth. Not a local-first feature.
- **T4.5/T4.6/T4.7 Product Mode cloud deps** — all need account system
  + cloud relay. Stay deferred per original Dual-Mode Pivot plan.
- **T5.2 prompt versioning** — the prompt is already a YAML file; a
  version column with A/B is meaningful only at scale (multi-user A/B).
- **T5.3 telemetry** — needs relay + privacy review. Out of scope local-first.

### Commit strategy
One commit per tier / cluster for reviewability:

1. `feat: T1 — retention blockers (soft-delete, recollect, relevance UI, synth cancel)`
2. `feat: T2 — quality (multilingual embed + strict mode + feedback + competitor dedup)`
3. `feat: T3 — power features (comparison view + saved filters + custom prompts + CSV ingest)`
4. `feat: T4 — product-mode polish (launchd sweep + notifications + convert CTA + signal polish)`
5. `feat: T5 — infra (tests + perf budgets + CI + LFS docs)`
6. `feat: T6 — UX polish (command palette + favorites + print + chips)`
7. `docs: update FEATURES + MISSING with shipped status`

### Pre-flight pre-conditions for subagents
The main session will complete these before agents start, to remove shared-file risk:

- Apply any schema additions to `core/db.py` needed by agents (the
  `finding_feedback` table used by AG-C, the `saved_views` table used
  by AG-E, the `topic_prefs.deleted_at` column used by FG)
- Confirm agents only write to their designated new-files list
