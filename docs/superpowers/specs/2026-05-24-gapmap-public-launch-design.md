# Gap Map — Public Launch + End-to-End Flow Design

**Date:** 2026-05-24
**Status:** Approved — implementing
**Surface:** Desktop app (`app-tauri/`) + Python sidecar + release pipeline.
Companion to the in-flight 2026-05-18 GUI consistency spec (visual tokens +
primitives), which runs in parallel and is NOT duplicated here.

---

## Problem

Gap Map already implements the four headline functions — search (discover),
gather (collect), relate (graph + insights), and conclude (launch brief) —
across 23+ sources, 90+ MCP tools, and 44 frontend screens. But:

1. The shipped DMG's bundled sidecar binary is **from Apr 21**, before
   `audience` / `iterate` / `launch` / `deliberate` / paper-pipeline features
   landed. Those tools fail at runtime in the current DMG.
2. The frontend tab surface is exhaustive but **uncurated** — a first-time
   user picks a topic, runs collect, and has no clear "what now". The
   "conclusion" (launch brief) is buried inside one of 44 tabs.
3. A **license-activation gate** is baked into `build.rs` and `main.js`. In
   release mode the build itself panics if `JWT_DESKTOP_SECRET` isn't set,
   blocking anyone from cloning and building the repo.
4. There is **no chat surface** that lets a user converse with the corpus
   directly — the only way to extract insight today is to browse the tabs.
5. The macOS release pipeline (`release.yml`) is wired but blocked on a
   Developer ID Application cert and several GitHub Secrets; Linux + Windows
   targets are matrix-built but never smoke-tested.
6. There is no auto-update mechanism — every release requires the user to
   manually re-download.

The user wants to share the app freely with others. Today they can't, without
either handing over their build secret or shipping a DMG that may reject
itself on a stranger's Mac.

## Goal

Ship a v0.1.0 public GitHub release of Gap Map where:

- Every advertised function (search / gather / relate / conclude / chat)
  works end-to-end on one topic, in the shipped DMG.
- The repo can be cloned, built, and run from source with **no secret
  ceremony**.
- The DMG can be shared with strangers — ad-hoc signed for first cut, then
  notarized once the Apple Developer ID cert is created.
- Subsequent versions auto-deliver via in-app update.
- The existing license-activation infrastructure is **preserved** behind a
  feature flag (default OFF) so a future paid build path stays one
  `npm run tauri:build:gated` away.

Sequenced into 5 phases, each independently shippable:

| Phase | Ships | Independently usable? |
|---|---|---|
| **P0 — Foundation** | Sidecar rebuilt; license gate feature-flagged (default OFF); LICENSE/README/CONTRIBUTING cleaned; repo public-ready | Yes — repo is buildable + cloneable today, no secrets needed |
| **P1 — Flow** | Topic Dashboard (Brief on top, Workspace strip below, pipeline status). All 44 existing screens kept; Brief is **additive** | Yes — ad-hoc DMG works, all features reachable |
| **P2 — Chat** | Chat-with-corpus surface that calls the existing analysis tools as functions. History persists. Cost guardrails (max tokens + provider switch) | Yes — chat is a new tab; doesn't disturb other surfaces |
| **P3 — Sign + release** | Notarized macOS DMG. Linux AppImage + Windows MSI built by the existing `release.yml` matrix. Tagged v0.1.0 GitHub Release | Yes — public installable artifact |
| **P4 — Auto-update** | `tauri-plugin-updater` wired. Subsequent releases auto-deliver | Yes — closes the loop for ongoing maintenance |

## What is preserved (explicit non-removals)

- All 44 frontend screens stay reachable from the Workspace strip.
- All 90+ MCP tools stay registered.
- All CLI commands and `--json` outputs unchanged.
- The license-activation Rust + JS code stays in the tree — gated by a
  Cargo feature `license-gate` + a build-time JS flag, both default OFF.
- The in-flight 2026-05-18 visual-consistency spec keeps running in
  parallel — this spec consumes its primitives (`PageShell`, `EmptyState`,
  `ErrorCard`, `LoadingSkeleton`), it does not collide with its batches.

## What is explicitly out of scope

- Chat with cross-topic / multi-corpus search (single-topic only in v1).
- Mobile distribution.
- Visual-consistency migration of the 44 existing screens (that is the
  2026-05-18 spec's job, running in parallel).
- Re-architecting `topic.js`. The dashboard is added in a new file
  (`screens/topic_dashboard.js`) that `topic.js` mounts at the top — no
  rewrites of existing screen code.

---

## 1. Topic Dashboard (P1)

**Host:** the existing `app-tauri/src/screens/topic.js` is the per-topic page
today. The dashboard is added as a new file `topic_dashboard.js` that
`topic.js` mounts above its current content. Existing tab content is
preserved verbatim below the dashboard region.

**Layout (top → bottom, single screen, scrolls):**

```
┌───────────────────────────────────────────────────────────────┐
│  PageShell header — "Topic: meditation apps"  ⓘ  ⋯           │
├───────────────────────────────────────────────────────────────┤
│  ▰ Pipeline Status Strip ───────────────────────────────────  │
│   discover ✓  collect ⟳ 234/612  synth ◌  audience ◌  launch ◌ │
│   [Re-run] [Cancel]                                            │
├───────────────────────────────────────────────────────────────┤
│  ▰ The Brief ──────────────────────────────────────────────── │
│   Headline gap (1 sentence)                                    │
│   3 evidence quotes (with source link)                         │
│   MVP scope (3 bullets)                                        │
│   Audience snapshot (top persona)                              │
│   Day-1 GTM hook                                               │
│   [Export DOCX] [Export PPTX] [Copy Markdown]                  │
├───────────────────────────────────────────────────────────────┤
│  ▰ Explore the evidence ──────────────────────────────────── │
│   ┌─Insights─┐ ┌─Gap list─┐ ┌─Personas─┐ ┌─Papers─┐ ┌─Graph─┐  │
│   │ 12 themes│ │ 47 gaps  │ │ 5 ICPs   │ │ 23 ppr │ │ 142 nd│  │
│   └──────────┘ └──────────┘ └──────────┘ └────────┘ └───────┘  │
│   ┌─Compare ┐ ┌─Launch  ┐ ┌─Reports ┐ ┌─Chat   ┐ ┌─More ▾┐    │
└───────────────────────────────────────────────────────────────┘
```

**Components (new, in `app-tauri/src/components/`):**

- **`PipelineStatus.js`** — `pipelineStatus({stages, onReRun, onCancel})`
  takes a list of `{key, label, status, detail?}` objects. Status values:
  `pending | running | done | skipped | failed`. Polls
  `pipeline_status(topic)` (already exists per `api.js:956`) every 2s while
  any stage is `running`. Each stage pill is clickable → expands a detail
  card showing the underlying tool output or error.
- **`BriefCard.js`** — `briefCard({brief, onExport, onCopy, onRegenerate})`.
  Renders the 5-section brief from `launch_brief_get(topic)` output. Empty
  state shows "Generate brief" CTA which calls the new `generate_brief`
  orchestrator command.
- **`WorkspaceStripCard.js`** — `workspaceCard({label, count, href, icon})`.
  One-click deep-link card with a one-number summary. Cards live in a
  responsive `minmax(0, 1fr)` auto-fit grid per `tauri-python-sidecar-app`
  skill guidance.

Each component ships with a `*.test.mjs` node:test file matching the
existing pattern (`settings.avatar.test.mjs`,
`welcome.onboarding.test.mjs`).

**Routing:** Hash-based, unchanged. Dashboard is mounted whenever
`topic.js` is the active screen and a topic is selected.

---

## 2. Brief orchestration (P1)

The Brief is **not new analysis** — it is orchestration over five existing
tools, in the order already documented in `api.js:954`:

```
generate_brief(topic, provider) =
  ensure_corpus(topic)                  # collect if empty
  → audience_personas(topic)            # api.js:945 (existing)
  → synthesize_insights(topic)          # api.js:707 (existing)
  → deliberate(topic, rounds=2)         # api.js:965 (existing)
  → launch_brief(topic, llm, provider)  # api.js:984 (existing)
  → persist + emit pipeline_status events at each stage
```

**Python:** `src/reddit_research/research/brief_orchestrator.py`

- Idempotent per stage: each stage checks for fresh output (configurable
  `freshness_window`, default 24h) and skips if present.
- Partial failure tolerance: a failed stage emits a `failed` event and
  downstream stages either skip with `needs: [prereq]` or run with what's
  available (e.g., `launch_brief` runs with available insights even if
  audience failed; renders a smaller brief).
- Emits structured events: `{stage, status, started_at, ended_at,
  error_class?, detail?}`. Event classes match the existing `collect:done`
  schema (rate_limit / network / llm_key / llm_model / db).

**Rust:** `app-tauri/src-tauri/src/commands.rs::generate_brief`

- Thin invoker. Spawns the Python sidecar with the orchestrator command.
- Streams events to the frontend via the existing Tauri event channel,
  emitting on event name `pipeline_status:{topic_slug}`. The dashboard
  subscribes per topic and unsubscribes on navigation away.
- Long stages (>30s) hand off to the existing async job queue rather than
  blocking the IPC channel.

**Brief persistence:** A new table `topic_briefs` keyed on `(topic_id,
generated_at)` storing the full brief JSON. Latest row per topic is the
canonical "current brief". History is preserved so users can compare a
brief before vs. after a re-collect.

---

## 3. Chat layer (P2)

A new tab `app-tauri/src/screens/chat.js` + Rust command `chat(topic,
message, history, provider?)`.

**LLM scoping:**

- System prompt is scoped to one topic — includes the topic name, the
  current brief headline, and a count of available evidence (posts,
  papers, gaps, personas).
- Conversation history persists in a new SQLite table `chat_threads` keyed
  on `(topic_id, thread_id)`. Each thread is a list of
  `{role, content, tool_calls?, ts}` records.

**Tool set exposed to the LLM (subset of MCP tools):**

| Tool | Wraps existing | Purpose |
|---|---|---|
| `search_corpus(query, k=10)` | `reddit_semantic_search` | Find evidence quotes for a question |
| `find_gaps_excerpt(filter)` | `reddit_find_gaps` | Pull specific unmet-needs |
| `top_personas(k=3)` | `reddit_audience_personas_get` | Surface ICPs |
| `cited_quotes(claim)` | `reddit_research_link` | Back a claim with sourced quotes |
| `paper_snippet(query, k=3)` | `reddit_paper_chunk_search` | Pull academic backing |

**Cost guardrails:**

- `max_input_tokens` config (default 30k). Older history truncated first.
- Per-thread budget shown in Settings (and reset-on-overrun behavior).
- Hard cap on tool-call rounds per turn (default 4) — prevents runaway
  multi-step chains.

**UI:**

- Standard chat layout: scrollable history pane + composer at bottom.
- Each assistant turn shows `(used N tools, M tokens, $X est)` footer.
- Tool calls render inline as collapsible "Looked up: <tool> → <one-line
  summary>" rows so the user sees the work.

**Failure modes:**

- No LLM key → in-pane CTA: "Add a key in Settings → BYOK".
- Provider rate-limited → automatic switch to next configured provider per
  existing BYOK fallback chain.
- Tool call timeout → assistant turn includes a "Skipped <tool>: timed
  out" note and continues with what it has.

---

## 4. License gate as feature flag (P0)

The activation infrastructure stays in tree — code is preserved, behavior
is gated.

**Rust side (`app-tauri/src-tauri/`):**

- `Cargo.toml`: add
  ```toml
  [features]
  license-gate = []
  ```
  Default features empty. The license-checking code in `commands.rs` and
  `main.rs` gets `#[cfg(feature = "license-gate")]` guards. When the
  feature is OFF (default), the guarded functions become no-ops that
  return "activated" / "skip onboarding gate".
- `build.rs`: drop the unconditional release panic. New logic:
  ```rust
  let license_gate_enabled = std::env::var("CARGO_FEATURE_LICENSE_GATE").is_ok();
  let secret = match std::env::var("JWT_DESKTOP_SECRET") {
      Ok(s) => s,
      Err(_) if !license_gate_enabled => {
          // Public OSS build path — deterministic placeholder, never used at runtime
          "gapmap-oss-no-gate-placeholder-secret-32-chars-min".to_string()
      }
      Err(_) if profile == "debug" => debug_fallback,
      Err(_) => panic!("JWT_DESKTOP_SECRET required when license-gate feature is enabled in release"),
  };
  ```

**Frontend side (`app-tauri/`):**

- `vite.config.js`: inject a build-time constant:
  ```js
  define: {
    __GAPMAP_LICENSE_GATE_ENABLED__: JSON.stringify(process.env.GAPMAP_LICENSE_GATE === 'true'),
  }
  ```
- `src/main.js:272-276`:
  - `isLicenseActivatedLocally()` returns `true` when `!__GAPMAP_LICENSE_GATE_ENABLED__`.
  - `mustStayInOnboarding()` checks `welcomed_at` only when gate is off.
- `src/screens/welcome.js`: license-key input hidden behind the same flag.
  Onboarding still asks for LLM key (BYOK) and a topic — those are
  separate from the activation gate.

**Build commands:**

- `package.json`:
  ```json
  "scripts": {
    "tauri:build": "tauri build",
    "tauri:build:gated": "GAPMAP_LICENSE_GATE=true tauri build -- --features license-gate"
  }
  ```
- `scripts/publish-mac.sh` accepts `--gated` flag that exports the env
  and passes the cargo feature through.

**Net effect:**

- Default build = no secret needed, no license-key prompt, shareable DMG.
- Gated build = same behavior as today's release builds.
- Zero deletion of activation code. The gate's machinery is one feature
  flag away from being the default again, in any future commercial cut.

---

## 5. OSS readiness (P0)

Concrete repo changes beyond the feature flag in §4:

| Change | File | What |
|---|---|---|
| README rewrite | `README.md` | Top section recast for OSS posture: badges (license, release, CI), three install paths (DMG / MCP server / CLI), "Build from source" with the ungated default + the `--features license-gate` opt-in. Keep existing depth in lower sections. |
| CONTRIBUTING audit | `CONTRIBUTING.md` | Already exists. Sanity-check it documents: dev setup, how to add a source, how to add an MCP tool, how to run tests, code-of-conduct pointer. Patch only if gaps. |
| SPDX headers | `pyproject.toml`, root JS entry points | Add `# SPDX-License-Identifier: MIT` as good hygiene. Non-blocking. |
| `docs/manual-todo/oss-launch.md` | new | Manual steps the user must do: flip GitHub repo to public, create v0.1.0 release draft, optionally Apple Dev cert (P3), upload icon/banner assets. |
| `.github/ISSUE_TEMPLATE/` | verify | Bug report + feature request templates per `ea47003`. Confirm present. |

After P0: anyone can `git clone && uv sync --all-extras && cd app-tauri &&
npm install && npm run tauri build` and get a working app. No secret
ceremony.

---

## 6. Sidecar + DMG hardening (P0 → P1)

**P0 — sidecar rebuild:**

The Apr 21 binary in `app-tauri/src-tauri/binaries/` predates
`audience` / `iterate` / `launch` / `deliberate` / paper-pipeline. The
PyInstaller spec (`reddit-cli.spec`) is correct; the binary is just stale.

- Run `scripts/publish-mac.sh --arch arm64` (and `--arch x86_64`).
- Re-codesign each: `codesign --force --deep --sign - <path>`.
- Verify with `scripts/smoke_test_dmg.sh` (added below) that every
  pipeline stage reaches `done` on a fixed topic.

**P1 — ad-hoc-signed DMG for sharing:**

- `scripts/publish-mac.sh` gains an `--adhoc` mode that builds the DMG
  with `--codesign-identity "-"` (ad-hoc).
- Recipients open via right-click → Open the first time, then it's in
  Gatekeeper's local approved list.
- `docs/manual-todo/oss-launch.md` documents the recipient instructions.

This is the path that unblocks "I want to share the app with others"
without waiting on the Apple cert (P3).

**Other sidecar gotchas already documented in CLAUDE.md
`tauri-python-sidecar-app` skill — verify they still hold:**

- `PYTHONUNBUFFERED=1` on the sidecar spawn.
- Tolerant JSON parsing on `run_cli` output.
- LLM provider auto-resolution (never default to "anthropic").
- Asset-protocol scope already covers `paper_pdf_cache` per
  `tauri.conf.json:53`.

---

## 7. Sign + release (P3)

Depends on user-side manual setup (Apple Dev cert).

- Create Developer ID Application cert in developer.apple.com →
  Certificates → New → "Developer ID Application". Export as `.p12`.
- GitHub Secrets per `LAUNCH.md`:
  `APPLE_CERTIFICATE` (base64 p12), `APPLE_CERTIFICATE_PASSWORD`,
  `APPLE_ID`, `APPLE_PASSWORD` (app-specific), `APPLE_TEAM_ID`,
  `TAURI_SIGNING_PRIVATE_KEY` (P4 prereq, added here for completeness),
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. **`JWT_DESKTOP_SECRET` is NOT
  required for the default ungated build path** — only for gated builds.
- Before adding secrets, run an unsigned CI pass on the existing
  `release.yml` to catch matrix drift.
- Linux AppImage + Windows MSI are already in the matrix; the only new
  smoke-test work is verifying they install and launch on clean targets.
- Tag `v0.1.0` → CI builds → review draft release → publish.

---

## 8. Auto-update (P4)

- Add `@tauri-apps/plugin-updater` to `app-tauri/package.json` and
  `tauri-plugin-updater` to `app-tauri/src-tauri/Cargo.toml`.
- Generate signing keypair:
  `npm run tauri signer generate -- -w ~/.tauri/gapmap.key`. Public key
  goes into `tauri.conf.json` `plugins.updater.pubkey`. Private key
  becomes `TAURI_SIGNING_PRIVATE_KEY` GitHub Secret.
- Add an updater endpoint that reads from the GitHub Releases JSON for
  `shaantanu9/gap-map-pro` (or whatever the public repo name is).
- Frontend: small "Update available — v0.1.1" toast at app start →
  "Install + restart" button → `update.downloadAndInstall()`.
- Cut a `v0.1.1` patch release after P4 to prove the loop end-to-end.

---

## 9. Error handling

Every Brief stage must degrade legibly. The pipeline status strip is the
single place a user looks to understand "why hasn't the brief generated
yet?".

| Failure | Status strip behavior | User-actionable resolution |
|---|---|---|
| No LLM key | `synthesize` / `deliberate` / `launch` show "needs LLM key" pill | Button opens BYOK modal |
| Sidecar dead | All stages show "sidecar not running" | "Restart Gap Map" toast |
| Provider rate-limited | Current provider pill turns yellow with countdown | Auto-switches to next BYOK provider after backoff |
| Stage failed (other) | That pill turns red + "Why?" link | Click expands to error card with error class + detail |
| Partial success | Later stages show `running with limited input` | Brief renders with what's available; "Re-run failed stages" CTA |

The orchestrator never aborts the whole pipeline on one stage failure.
Stages downstream of a failure either skip with a `needs: [prereq]` note
or run degraded.

---

## 10. Testing strategy

- **Node `*.test.mjs` for new primitives:** `PipelineStatus.test.mjs`,
  `BriefCard.test.mjs`, `WorkspaceStripCard.test.mjs`. Pattern matches
  existing `welcome.onboarding.test.mjs`.
- **Python `pytest` for `brief_orchestrator.py`:** idempotency
  (re-runs skip fresh stages), stage-skip-on-prereq-failure, partial
  failure tolerance, event emission ordering. Add fixtures with mocked
  LLM provider that returns canned responses.
- **Rust integration:** unit-test the `#[cfg(feature = "license-gate")]`
  conditional with both feature flags ON and OFF in CI.
- **Smoke test script:** `scripts/smoke_test_dmg.sh`. Picks a fixed
  topic ("noise-cancelling headphones"), runs the full pipeline, asserts
  every pipeline-status stage reaches `done` or `skipped: <reason>`.
  Used pre-tag and on PRs that touch the orchestrator.
- **Manual end-to-end** on a built DMG before each tag — `docs/manual-todo/`
  checklist appended.
- **Chat eval (P2):** `tests/chat/test_tool_selection.py`. 3 fixed
  prompts, asserts the right tools fire and total token count stays
  under the budget.

---

## 11. Build order

Each row is one commit batch + one changelog entry per the global
changelog rule.

| # | Phase | Output |
|---|---|---|
| 1 | P0 | Rebuild sidecar (arm64 + x86_64). Verify with smoke test. |
| 2 | P0 | Feature-flag license gate (Cargo + vite + main.js). Default OFF. Manual verify both flag states build + run. |
| 3 | P0 | README rewrite + SPDX + OSS hygiene + `docs/manual-todo/oss-launch.md`. |
| 4 | P1 | `components/PipelineStatus.js` + tests. |
| 5 | P1 | `components/BriefCard.js` + `components/WorkspaceStripCard.js` + tests. |
| 6 | P1 | `brief_orchestrator.py` + pytest. |
| 7 | P1 | `generate_brief` Rust command + event streaming + `topic_briefs` table migration. |
| 8 | P1 | Wire `topic_dashboard.js` into `topic.js`. Existing tabs preserved below. |
| 9 | P1 | Ad-hoc-signed DMG end-to-end smoke test (happy path + 3 error states). |
| 10 | P2 | `chat_threads` migration; `chat` Rust command; tool wrappers; `screens/chat.js`. |
| 11 | P2 | Cost guardrails + chat eval. |
| 12 | P3 | Apple cert flow + GitHub Secrets + signed release CI pass. |
| 13 | P3 | Tag `v0.1.0` → public GitHub Release. |
| 14 | P4 | `tauri-plugin-updater` wired + signing key. |
| 15 | P4 | `v0.1.1` patch release proves the update path end-to-end. |

After row 9, the user has a shippable DMG they can hand to anyone (P1).
After row 13, the DMG is publicly downloadable, signed, and notarized
(P3). The build order is structured so each ROW is independently
mergeable.

---

## 12. Risks & mitigations

- **`topic.js` is 247 KB** — hard to refactor safely. Mitigation: the
  dashboard lives in a NEW file (`screens/topic_dashboard.js`) that
  `topic.js` mounts. No edits to existing screen code beyond the mount
  point.
- **Brief orchestrator can be slow** (5 sequential LLM calls).
  Mitigation: idempotent stage cache (24h freshness); long stages route
  to the existing async job queue; live pipeline-status events so the
  user sees progress.
- **Apple Dev cert is a manual blocker for P3.** Mitigation: P1 ships
  ad-hoc-signed so sharing isn't bottlenecked on the cert. P3 lands
  whenever the cert is created.
- **Chat tool selection can over-call the LLM.** Mitigation:
  per-thread token budget + hard cap on tool-call rounds (default 4).
- **License-gate feature flag drift.** Mitigation: CI matrix tests both
  feature states (gate ON and OFF). Failing builds in either state block
  merges.
- **Sidecar binary size** (231 MB today). Mitigation: out of scope for
  this spec, but `tauri-binary-size` skill applies for follow-up.

---

## 13. Manual TODO (user actions outside Claude's reach)

To be written into `docs/manual-todo/oss-launch.md` as part of P0 row 3:

- [ ] Flip GitHub repo `shaantanu9/gap-map-pro` to public (or current
      name — confirm in `release.yml` target).
- [ ] Upload `gapmap_logo.jpg` as the repo's social preview image.
- [ ] Decide on a public name: README says "Gap Map", repo is
      `reddit-myind`. Recommended: rename to `gap-map` for OSS launch.
- [ ] (P3) Create Developer ID Application cert; add the 7 GitHub
      Secrets per `LAUNCH.md` step 3.
- [ ] (P3) Generate updater signing key per §8; add
      `TAURI_SIGNING_PRIVATE_KEY` GitHub Secret.
- [ ] Verify the existing `release.yml` runs green on a no-cert,
      unsigned CI pass before adding secrets (catches matrix drift).

---

## Maintenance protocol

When to update this spec:

- A phase's build-order rows are all merged → mark phase ✅ in the
  header table.
- A scope item moves between in/out of scope → update §0 and the
  affected design section.
- A risk turns into a real blocker → call it out at the top of §12 with
  the date and what's known.

When all 5 phases are merged, this spec is closed and FEATURES.md picks
up as the durable record of what shipped.
