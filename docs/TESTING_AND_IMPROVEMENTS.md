# Testing & Improvements — what's still shaky + how to validate everything works

**Version:** 2026-04-21 (post-Tier-1..6 build)
**Audience:** someone who wants to ship this to real users and not have egg on their face.
**Philosophy:** a feature isn't real until (a) a human can use it end-to-end in under 60 seconds, (b) an automated test guards it against regression, (c) a failure mode produces a useful error not a silent empty state.

---

## 1. Known gaps after the build (ranked by impact)

### 1.1 Tier-1..6 that shipped but wasn't battle-tested

| Capability | Shipped | Battle-tested? | Risk |
|---|---|---|---|
| Soft-delete + undo toast | ✅ | Unit test: yes. E2E: no. | Medium — toast dismiss timing on very fast delete+re-click |
| Dashboard right-click menu | ✅ | No real-device test | Low — trackpad users without right-click are stuck |
| Relevance gate (3 layers) | ✅ | Unit: no. Smoke: passed once on 77 posts | High — threshold picks are opinionated, may false-drop valid content |
| 👎 finding feedback → prompt injection | ✅ | Unit: yes (record+readback). E2E prompt verify: no | High — we don't verify the LLM actually *uses* the negative block |
| Multilingual embedder | ✅ | Unit: no. Requires `sentence-transformers` install | High — untested on real non-English corpora |
| Strict-mode quality gate | ✅ | Unit: 5 parametrized cases | Low |
| Global competitor dedup | ✅ | No | Medium — threshold 0.80 may over-merge "Slack" and "Slack Connect" |
| Saved views filter | ✅ | Unit: yes. UI-wired: minimal (17-line DOM hook) | Medium — filter-bar DOM might get stale on re-render |
| Custom prompt overrides | ✅ | Unit: roundtrip | Medium — YAML-parsed override can corrupt downstream if malformed |
| Topic comparison view | ✅ | No | Low — pure render |
| CSV bulk ingest | ✅ | No | High — error handling on malformed CSV not tested |
| Dense graph relations | ✅ | Smoke | Medium — hairball cap may under-show on dense corpora |
| GitHub Actions CI | ✅ | Not run yet | Medium — macos-arm64 runner availability varies |

### 1.2 What could fail silently that we haven't caught

- **Relevance gate with cold embedder**: if ChromaDB's ONNX model hasn't downloaded yet (first-ever run), the gate silently passes everything. Users see "relevance gate fired" in the log but 0 drops.
- **Empty-topic collect**: starting a collect on a topic that never yields posts → empty `topic_posts` → `synthesize` returns `{error: "no posts"}` not a friendly "nothing collected yet, try a broader query".
- **Multilingual mode without `sentence-transformers`**: the env switch accepts `multilingual` but falls back silently when the lib is missing. User thinks they're embedding Hindi text but the default MiniLM just returns low-quality English vectors.
- **Clipboard export on Linux headless environments**: `navigator.clipboard.writeText` throws without a user gesture; we catch-all but don't tell the user *why* it silently failed.
- **Soft-delete of a topic mid-collect**: if a collect is in-flight and `_tag_posts` hasn't checked the deleted_at column, new posts can land under a deleted topic.

### 1.3 What hasn't been cross-surface tested

Every feature must work identically via UI, CLI, and MCP. Current state:

| Feature | UI | CLI | MCP | Tested cross-surface? |
|---|---|---|---|---|
| Topic soft-delete | ✅ | ✅ | ✅ | No |
| Clean corpus (relevance gate) | ❌ UI | ✅ | ✅ | Partial (CLI only) |
| Feedback 👎 | ✅ | ✅ | ✅ | No |
| Global competitors | ✅ | ✅ | ✅ | No |
| Saved views | ✅ | ✅ | ✅ | No |
| Custom prompts | ✅ | ✅ | ✅ | No |
| CSV ingest | ✅ | ✅ | ✅ | No |
| Product Mode | ✅ | ✅ | ✅ | No |

---

## 2. The 15-minute fresh-install smoke test

Copy-paste this into a terminal to validate the full stack from scratch.

### 2.1 Setup

```bash
cd /Users/shantanubombatkar/Documents/GitHub/reddit-myind
.venv/bin/python -c "from reddit_research.core.db import get_db, init_schema; init_schema(get_db()); print('schema OK')"
```

### 2.2 CLI smoke test — every new surface

```bash
# Topic lifecycle
.venv/bin/python -m reddit_research.cli.main research topic-trash-list --json
.venv/bin/python -m reddit_research.cli.main research find-existing-topic --input "ai agents"

# Corpus quality (dry-run, no mutation)
.venv/bin/python -m reddit_research.cli.main research clean-corpus --topic "ai" --threshold 0.30
.venv/bin/python -m reddit_research.cli.main research collect-quality-check --topic "ai" --json

# Intelligence
.venv/bin/python -m reddit_research.cli.main research feedback-record \
    --topic "ai" --title "test finding" --kind painpoint --verdict ok
.venv/bin/python -m reddit_research.cli.main research global-competitors --min-topics 2 --json
.venv/bin/python -m reddit_research.cli.main research prompt-list --json

# Custom prompt roundtrip
.venv/bin/python -m reddit_research.cli.main research prompt-set \
    --key painpoints --file /tmp/empty_override.txt 2>/dev/null || \
    echo "override input is empty — expected"
.venv/bin/python -m reddit_research.cli.main research prompt-clear --key painpoints

# Saved views
.venv/bin/python -m reddit_research.cli.main research saved-view-create \
    --scope "topic:ai" --name "High opp" --filter-json '{"min_opportunity_score":15}'
.venv/bin/python -m reddit_research.cli.main research saved-view-list --json

# Product Mode (full lifecycle)
.venv/bin/python -m reddit_research.cli.main research product-create \
    --name "SmokeProduct" --one-liner "smoke test" --category "ai" \
    --competitors '[{"name":"TestRival"}]'
.venv/bin/python -m reddit_research.cli.main research product-list --json
.venv/bin/python -m reddit_research.cli.main research product-get --id smokeproduct --json
.venv/bin/python -m reddit_research.cli.main research product-digest --id smokeproduct

# Cleanup
.venv/bin/python -m reddit_research.cli.main research product-delete --id smokeproduct
```

### 2.3 MCP smoke test

Connect to the MCP server (`.venv/bin/python -m reddit_research.mcp.server` or via the in-app "Connect to Claude Code" button) and from any MCP client:

```
Call reddit_topic_trash_list()             → {ok: true, trash: [...]}
Call reddit_find_existing_topic(user_input="x")  → {ok: true, match: null}
Call reddit_clean_corpus(topic="ai", threshold=0.30, apply=false)
    → {ok, scored, dropped, sample_dropped: [...]}
Call reddit_collect_quality_check(topic="ai")
    → {ok, total, lenient_fail, strict_fail, sample_*: [...]}
Call reddit_global_competitors(min_topics=2, threshold=0.80)
    → [{canonical_name, aliases, topics, total_mentions}, ...]
Call reddit_prompt_list()
    → {painpoints: {has_override, bundled_preview, override_preview}, ...}
Call reddit_product_list(active_only=true) → [...]
Call reddit_graph_build_relations(topic="ai")
    → {ok, relates_to_edges, co_evidenced_edges, ...}
```

### 2.4 UI smoke test (desktop app)

Fresh launch of the Tauri app:

1. **Welcome flow** — complete 4-step wizard OR click "I have a product" → lands at product setup.
2. **Type a topic** → modal checks `findExistingTopic` → either opens existing or creates new.
3. **Open any existing topic** → Insights tab shows Minto header + findings + (if any) "dropped findings" fold.
4. **Click 👎 on a finding** → verdict prompt → confirm saves to `finding_feedback`.
5. **Top of Findings section** → saved-views bar (if any saved); apply one → list filters client-side.
6. **Compare button** in topic header → pick second topic → side-by-side view renders.
7. **Dashboard** → right-click a topic tile → Open / Re-collect / Delete menu appears.
8. **Delete** → type-to-confirm modal → undo toast on success.
9. **Settings → Trash** → lists deleted topics → Restore button → topic reappears.
10. **Sidebar → Competitors** → global grid renders (empty if fewer than 2 topics have competitors).
11. **Sidebar → Ingest** → Bulk CSV ingest card present.
12. **Sidebar → Products** → empty state if first time; "Register a product" works.

Every surface should render without a console error. Errors that do appear should be diagnostic (real text) not `{_parse_error: true}` sentinels.

### 2.5 Regression suite (automated)

```bash
pytest tests/test_tier_quality_pass.py -v
```

12 tests, <1s runtime. Must stay green. Add the new integration test (see §4 below) and require both pass before merging.

---

## 3. Acceptance criteria — when is each feature "done"?

Shipped ≠ done. "Done" means a non-technical user can run through the capability and get value.

### 3.1 Soft-delete (T1.3)
**Done when:**
- [ ] A user can delete a topic, close the app, reopen 6 days later, find the topic in Settings → Trash, click Restore, and see all their data back.
- [ ] A launchd cron (not yet shipped) runs `topic-trash-purge --min-age-days 7` nightly without breaking anything.
- [ ] Deleting a topic that's currently mid-collect produces a clear error, not a race.

### 3.2 Relevance gate
**Done when:**
- [ ] A fresh collect on a known over-match topic (e.g. "meditation sound frequency") shows > 50% of posts dropped at the collect gate.
- [ ] Users with a cold embedder see a one-time "warming up relevance model, ~10 s" toast.
- [ ] Config UI in Settings to adjust thresholds without editing env files (current: CLI only).

### 3.3 Finding feedback 👎
**Done when:**
- [ ] User flags 3+ findings as wrong/off-topic on one topic.
- [ ] Next synthesize shows measurably different findings (either fewer of the flagged cluster or a note in the report).
- [ ] Automated test asserts the `feedback_for_prompt()` output lands in the actual LLM prompt (not just in memory).

### 3.4 Multilingual embeddings
**Done when:**
- [ ] Set `GAPMAP_EMBEDDING_MODEL=multilingual`, collect a topic in a non-English language, and the relevance gate correctly keeps >= 70% of on-topic posts.
- [ ] Fallback warning surfaces when `sentence-transformers` isn't installed.
- [ ] Performance benchmark: multilingual model adds <500 ms per synthesize.

### 3.5 Global competitor dedup
**Done when:**
- [ ] Running on a DB with 5+ topics that all mention "Calm" produces a single canonical entry.
- [ ] Clicking a competitor card shows the list of topics that mention it with context.
- [ ] Threshold slider in the UI (currently: env / arg only).

### 3.6 Saved views
**Done when:**
- [ ] User creates a view, closes app, reopens, view is still there.
- [ ] Clicking the view filters the Insights findings immediately (no reload).
- [ ] A built-in "High opportunity only" / "Chronic only" / "Triangulated only" starter set pre-populates on first run.

### 3.7 Custom prompt overrides
**Done when:**
- [ ] User edits a prompt in Settings → Save → next synthesize uses the override.
- [ ] Invalid YAML shows a clear error ("expected dict, got str") instead of silent fallback.
- [ ] A "reset to default" button per key.

### 3.8 Topic comparison
**Done when:**
- [ ] Compares two real topics with their full Minto + quadrant + shared/unique sets.
- [ ] PDF/markdown export of the comparison view.
- [ ] Works on mobile layout (currently desktop-only).

### 3.9 CSV bulk ingest
**Done when:**
- [ ] Ingests a 10k-row CSV in < 30 s.
- [ ] Malformed rows show a per-row error report, not a single cryptic exception.
- [ ] Imported posts pass through the relevance gate and dedup by `post_id`.

### 3.10 Product Mode daily use
**Done when:**
- [ ] A PM registers their product, runs an initial sweep, gets ≥ 1 real typed signal on a real product.
- [ ] Daily sweep scheduled via launchd (not yet shipped).
- [ ] Native OS notification on any `your_product_regression` signal at severity ≥ 0.8.
- [ ] Weekly digest email delivery (deferred — needs cloud relay).

---

## 4. The missing integration test

`tests/test_tier_quality_pass.py` covers unit contracts. We also need one end-to-end test that runs the full pipeline on synthetic data. Here's the spec:

**Scenario:** seed 5 fake posts → tag into a topic → soft-delete → restore → clean-corpus dry-run → save a view → flag feedback → verify all persist.

**File:** `tests/test_integration_tier_e2e.py` (shipped below).

**Success:** all 5 steps return sensible output, DB state is consistent at end.

---

## 5. Two-week improvement sprint (priority-ordered)

Every item is a 0.25 – 1 day ship. If two weeks isn't enough for all, top-to-bottom by priority.

### Day 1–2 — reliability
- [ ] **Warm the embedder eagerly on sidecar boot** when `GAPMAP_EMBEDDING_MODEL != default`. Prevents silent cold-first-call behavior.
- [ ] **Relevance threshold slider** in Settings (currently env-only).
- [ ] **Malformed-CSV per-row error report** in `ingest_csv`.
- [ ] **Mid-collect-delete guard** in `_tag_posts` — check topic isn't in trash before inserting.

### Day 3–4 — UX polish
- [ ] **Per-source collect status chips** in the collect log (T6.2).
- [ ] **"Bet due today" reminder** on dashboard when `time_box_days` elapses on a `running` bet (T6.4).
- [ ] **⌘K command palette** replacing the bare global-search screen (T6.5).
- [ ] **Pinned / favorite topics** via `topic_favorites` table (schema already exists).

### Day 5–6 — intelligence polish
- [ ] **Built-in saved views** (High opp / Chronic / Triangulated) pre-seeded on first run.
- [ ] **Invalid-override error** for custom prompts — parse YAML and report structured errors.
- [ ] **Feedback effectiveness metric** — compare two synths before/after feedback and report delta.
- [ ] **Global competitors threshold slider** in the `/competitors` UI.

### Day 7–8 — Product Mode
- [ ] **Launchd scheduler for daily product sweeps** (T4.1).
- [ ] **Native OS notifications** (T4.2) — add `tauri-plugin-notification`.
- [ ] **"Re-sweep now" button** on Product Dashboard.
- [ ] **Signal history timeline** with mini sparkline.

### Day 9–10 — data layer
- [ ] **Compound index on `topic_posts(topic, added_at)`** for dashboard queries.
- [ ] **WAL autocheckpoint** tuned for the app's write pattern.
- [ ] **Perf trace** integration — populate `perf_traces` from key sidecar calls.

### Day 11–12 — developer experience
- [ ] **E2E pytest on CI** — not just unit tests.
- [ ] **Frontend lint** (ESLint) in CI, not just syntax check.
- [ ] **Rust clippy + fmt check** in CI.
- [ ] **Dependabot** for Python + Rust + JS.

### Day 13–14 — documentation & onboarding
- [ ] **Screencast walkthrough** (5 min) for the README.
- [ ] **"First 5 minutes" guide** — get-to-first-insight in under 5 min.
- [ ] **Known-issues page** in docs.
- [ ] **Upgrade guide** for existing users.

---

## 6. How to measure "useful"

Proxies for real usefulness (not vanity metrics):

### 6.1 Weekly active topic ratio

```sql
SELECT count(DISTINCT topic) AS weekly_active
FROM topic_runs
WHERE run_at >= date('now', '-7 days');
```

If a user has 10 topics and only 2 get synthesized weekly, the other 8 are abandoned. Target: ≥ 60% weekly active.

### 6.2 Bets-per-topic ratio

```sql
SELECT
  (SELECT count(*) FROM hypothesis_tests WHERE topic = t.topic AND status IN ('running','validated','invalidated')) * 1.0 /
  (SELECT count(DISTINCT topic) FROM topic_posts WHERE topic = t.topic) AS engagement
FROM topic_prefs t
WHERE deleted_at IS NULL;
```

Target: ≥ 1 bet per active topic. Means the user is moving from research to action.

### 6.3 Feedback rate

```sql
SELECT
  (SELECT count(*) FROM finding_feedback) * 1.0 /
  (SELECT count(*) FROM graph_nodes WHERE kind IN ('painpoint','feature_wish','workaround')) AS feedback_rate;
```

Target: ≥ 5% within a week of using the app. Low = users don't trust or don't engage.

### 6.4 Time-to-first-insight

From app first launch → first Minto brief rendered. Target: < 5 minutes.

### 6.5 Export rate

Number of exports (markdown / hypothesis cards / Slack summary / digest) per active topic per week. Target: ≥ 1. Means the brief is actually leaving the app.

---

## 7. Failure mode playbook

What the user sees vs. what it means vs. how to fix:

| Symptom | Likely cause | Fix |
|---|---|---|
| "0 findings after synthesize" | Empty corpus OR all findings dropped by gate | Check `report._relevance_dropped_findings`; lower `GAPMAP_FINDING_RELEVANCE_THRESHOLD` |
| Graph has 15k edges but UI looks sparse | Dense-relations post-pass didn't run (chromadb missing) | `pip install chromadb` or check embedder.py for shared-function errors |
| Product sweep returns 0 signals | Linked topic has no synthesis; synth diff is empty | Run `research synthesize --topic <linked>` first |
| Delete button does nothing | Tauri IPC `delete_topic` now soft-deletes via CLI; check sidecar logs | Run `reddit-cli research topic-soft-delete --topic T` directly to verify backend |
| Feedback 👎 doesn't affect next synth | Prompt injection point mis-wired | Check `insights.py` for negative-examples block; assert via E2E test |
| Multilingual mode shows English-only results | `sentence-transformers` not installed | `pip install sentence-transformers` |

---

## 8. The 5-feature ship list for "real usefulness"

If you only ship 5 more things, ship these — in order:

1. **Launchd scheduler for product sweeps** (T4.1, 1 day). Without it, Product Mode is manual.
2. **Native OS notifications** (T4.2, 0.5 day). The retention lever.
3. **Command palette ⌘K** (T6.5, 0.5 day). Replaces 80% of mouse navigation for power users.
4. **Built-in saved views** (0.25 day). First-run delight.
5. **E2E integration test in CI** (1 day). Everything else is theater without this.

After these 5, we're at a defensible beta.

---

## 9. Open questions the team should answer

- Do we want a **hosted tier** long-term (enables Phase D/E/G)? This decides if we invest in cloud infra now or stay purely local.
- What's the **pricing signal** to validate? Current thinking: local-first $0, hosted $49/mo. But we haven't validated that with 3 founders yet (Dual-Mode Pivot §10).
- How do we handle **existing users with garbage corpora**? Ship a one-click "Clean & re-synthesize all topics" in Settings?
- What's our policy when **MiniLM hallucinates** (wrong embedding for a valid post)? Do we surface the raw cosine score on finding cards?
- **Prompt versioning:** do we want a history of override changes? (Today: overwrite in place.)

---

*This doc is a working backlog + test plan + acceptance matrix rolled into one. Treat it like a PM dashboard: revisit weekly, strike through items as they ship, move new discoveries into §1.*
