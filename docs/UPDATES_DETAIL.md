# Updates Detail — What, Why, How to Use

**Last pass:** 2026-04-21
**Scope:** Every feature shipped in the quality-pass + Tier-1..6 build. Organized by user-visible capability, not by file. For each one: **What** it does, **Why** it was needed, **Where** to find it (UI / CLI / MCP), and **How** to use it end-to-end.

---

## Contents

1. [Retention safety](#1-retention-safety)
2. [Corpus quality](#2-corpus-quality)
3. [Research intelligence](#3-research-intelligence)
4. [Knowledge-graph depth](#4-knowledge-graph-depth)
5. [Workflow productivity](#5-workflow-productivity)
6. [Product Mode (daily-use PM surface)](#6-product-mode-daily-use-pm-surface)
7. [Developer experience & CI](#7-developer-experience--ci)
8. [Complete MCP tool surface (28 new tools)](#8-complete-mcp-tool-surface-28-new-tools)
9. [Complete CLI command reference](#9-complete-cli-command-reference)
10. [Environment variables — all tunable knobs](#10-environment-variables--all-tunable-knobs)
11. [Explicit deferrals](#11-explicit-deferrals)

---

## 1. Retention safety

### 1.1 Soft-delete + 7-day undo (T1.3)

**What:** Delete Topic no longer blasts the corpus + graph + bets. It stamps `topic_prefs.deleted_at` with an ISO timestamp. The topic vanishes from the dashboard but the data stays recoverable for 7 days.

**Why:** Users mis-typed the type-to-confirm string by luck and lost the entire corpus + graph + bets. Irreversible destructive actions are a retention-killer.

**Where:**
- UI: Topic page header → Delete → type-to-confirm modal → undo toast (10 s). Or Dashboard tile → right-click → Delete. Settings → Trash card lists everything soft-deleted with Restore buttons.
- CLI: `reddit-cli research topic-soft-delete --topic T` · `topic-restore --topic T` · `topic-trash-list` · `topic-trash-purge --min-age-days 7`
- MCP: `openreply_topic_soft_delete` / `openreply_topic_restore` / `openreply_topic_trash_list` / `openreply_topic_trash_purge`

**How:**
```bash
# Delete + undo window from CLI
reddit-cli research topic-soft-delete --topic "meditation apps"
reddit-cli research topic-trash-list                 # shows age + expires_in_days
reddit-cli research topic-restore --topic "meditation apps"

# Nightly purge (put in launchd plist):
reddit-cli research topic-trash-purge --min-age-days 7 --json
```

**From an MCP client** (Claude Code):
```
> Use openreply_topic_soft_delete to remove "stale-topic", then list the trash.
```

### 1.2 Type-to-confirm destructive modal

**What:** Reusable `confirmDestructiveAction({ title, body, matchText, ... })` modal in `app-tauri/src/lib/deleteConfirm.js`. User must type the exact match string (topic name) to unlock the Delete button.

**Why:** One-click confirm() dialogs get autopiloted. Friction is good for irreversible actions.

**Where:** Both Delete Topic sites use it. Reusable for Delete Product, Reset DB, Clear Data, etc.

**How:**
```js
import { confirmDestructiveAction } from '../lib/deleteConfirm.js';
const ok = await confirmDestructiveAction({
  title: `Delete "${topic}"?`,
  body: 'Recoverable for 7 days.',
  matchText: topic,
  confirmLabel: 'Delete topic',
  confirmDanger: true,
});
if (ok) await api.deleteTopic(topic);
```

---

## 2. Corpus quality

### 2.1 Three-layer relevance gate

**What:** Three embedding-based filters stop off-topic posts from landing in `topic_posts` and stop off-topic findings from hitting the graph.

| Layer | When it runs | Threshold env | Default | Semantics |
|---|---|---|---|---|
| Collect-time | `_tag_posts` before insert | `OPENREPLY_RELEVANCE_GATE_THRESHOLD` | 0.28 | Recall-leaning |
| LLM output | `synthesize_insights` after LLM returns | `OPENREPLY_FINDING_RELEVANCE_THRESHOLD` | 0.40 | Precision-leaning |
| Retroactive | On demand via `clean-corpus` | `--threshold` CLI | 0.30 | User-decided |

**Why:** Reddit search on "meditation sound frequency brainwave" over-matches r/politics threads about ICE, Epstein, Disney+. Without a gate the LLM extractor dutifully surfaces "Lack of transparency in law enforcement" as a meditation-app painpoint.

**Where:**
- Every new collect is automatically gated. Look for "dropped for relevance" in the collect log.
- UI: Insights tab shows a "⚖ N off-topic findings dropped" fold under the Top Opportunities section, listing which findings were dropped and why.
- CLI: `reddit-cli research clean-corpus --topic T [--threshold 0.30] [--apply]`
- MCP: `openreply_clean_corpus(topic, threshold, apply, min_keep)`

**How to clean an existing garbage topic:**
```bash
# Dry-run — see what WOULD be dropped
reddit-cli research clean-corpus --topic "meditation apps" --threshold 0.30

# Inspect sample_dropped in the JSON; if the drops look right:
reddit-cli research clean-corpus --topic "meditation apps" --apply

# Then re-synthesize against the clean corpus:
reddit-cli research synthesize --topic "meditation apps" --json
```

### 2.2 Strict-mode post-quality filter (T2.2)

**What:** A second gate after relevance that blocks low-quality posts.

| Rule | Lenient | Strict |
|---|---|---|
| Min score (upvotes) | ≥ 1 | ≥ 3 |
| Min content length | ≥ 40 chars | ≥ 100 chars |
| Known bot author block | ✓ (14 bots) | ✓ |

Blocked bot list: `AutoModerator, RemindMeBot, GoodBot_BadBot, stabbot, Mentioned_Videos, havoc_bot, sneakpeekbot, WikiTextBot, SmallSubBot, B0tRank, imguralbumbot, nice-scores, GifReversingBot, RepostSleuthBot`.

**Why:** Even on-topic posts can be garbage (joke comments, repost farms, bot-generated fluff). The gate complements relevance.

**Where:**
- `OPENREPLY_STRICT_QUALITY=1` env → collect-time gating escalates to strict.
- CLI diagnostic: `reddit-cli research collect-quality-check --topic T` (non-mutating; reports lenient/strict fail counts).
- MCP: `openreply_collect_quality_check(topic)`

**How:**
```bash
# See how many posts in your topic fail each level
reddit-cli research collect-quality-check --topic "ai agents" --json

# Enable strict mode for the next collect
OPENREPLY_STRICT_QUALITY=1 reddit-cli research collect --topic "ai agents"
```

### 2.3 Multilingual embeddings (T2.3)

**What:** Env switch to swap the English-leaning MiniLM-L6-v2 default for the multilingual `paraphrase-multilingual-MiniLM-L12-v2`. Shared via `retrieval/embedder.py::get_embedding_function()`. All four embedding consumers route through it: `relevance.py`, `cluster.py`, `graph/relations.py`, `retrieval/palace.py`.

**Why:** A user researching a Hindi / Japanese / Portuguese market today gets garbage because the English MiniLM returns near-zero cosine to non-English content.

**Where:** Set `OPENREPLY_EMBEDDING_MODEL=multilingual` in your `.env`. Requires `pip install sentence-transformers`.

**How:**
```bash
# Install the multilingual model host
pip install sentence-transformers

# Enable
export OPENREPLY_EMBEDDING_MODEL=multilingual
reddit-cli research synthesize --topic "app for Japanese students"
```

Graceful fallback: if `sentence-transformers` isn't installed the embedder warns and reverts to the default MiniLM. Nothing breaks.

### 2.4 Topic resolver (case/slug dedup) — user-respecting contract

**What:** When the LLM canonicalizes `"Indian student exam stress"` → `"indian student exam stress"`, both variants map to the ONE canonical row via `topic_aliases`. `resolve_topic(user_input, register=False)` is **read-only** — never auto-normalizes user input. Aliases are populated only by the LLM canonicalize path or explicit merges.

**Why:** Three rows for one typed search confused the UI, split the corpus, and made findings and bets unreachable.

**Where:**
- Auto — every collect runs through it.
- `find-existing-topic` pre-check on the New Topic modal asks: *"A topic 'X' with N posts already exists. Open it, or create separate?"*
- `merge-duplicate-topics` retroactively merges LLM-caused dupes. User re-searches are never merged.
- MCP: `openreply_find_existing_topic`, `openreply_merge_duplicate_topics`.

**How (retroactive cleanup):**
```bash
# Dry-run — shows LLM-caused merge buckets only
reddit-cli research merge-duplicate-topics
# If winner/losers look right:
reddit-cli research merge-duplicate-topics --apply
```

---

## 3. Research intelligence

### 3.1 Finding feedback 👎 (T2.4)

**What:** Each finding card has a 👎 button. Clicking prompts for a verdict (wrong / off_topic / spam / ok) + optional note. Persisted to `finding_feedback` table. **Next synthesize call injects this into the prompt** as a *"these were wrong last time — don't repeat"* block, so the LLM stops hallucinating the same mistakes.

**Why:** LLMs don't learn between sessions. User feedback was being thrown away.

**Where:**
- UI: every finding card in the Insights tab.
- CLI: `reddit-cli research feedback-record --topic T --title "..." --kind painpoint --verdict wrong [--note "..."]`
- MCP: `openreply_feedback_record(topic, finding_title, finding_kind, verdict, note)` + `openreply_feedback_list(topic)`

**How:**
```bash
# Flag a finding as off-topic
reddit-cli research feedback-record \
  --topic "meditation apps" \
  --title "ICE accountability gap" \
  --kind painpoint \
  --verdict off_topic \
  --note "This is from a r/politics thread"

# Next synthesize will see it and skip similar findings
reddit-cli research synthesize --topic "meditation apps"
```

### 3.2 Global competitor dedup (T2.5)

**What:** New `/competitors` screen clusters competitors across ALL topics. `Calm`, `Calm.com`, `Calm App` unify into one canonical with topic + mention counts.

**Why:** The same competitor would show up with 5 different labels across 5 topics. No cross-topic intelligence.

**Where:**
- UI: Sidebar → **Competitors**.
- CLI: `reddit-cli research global-competitors --min-topics 2 --threshold 0.80 --json`
- MCP: `openreply_global_competitors(min_topics, threshold)`

**How:**
```bash
# List competitors mentioned in 2+ topics
reddit-cli research global-competitors --min-topics 2 --json

# Tighter clustering (require higher similarity)
reddit-cli research global-competitors --threshold 0.90
```

### 3.3 Saved views / smart filters (T3.1)

**What:** Save a filter like "painpoints with opportunity_score ≥ 15 AND triangulation = strong" as a pinned view. Click to apply client-side filter on the Insights tab.

**Why:** Users iterate on the same filters every open. No reason to retype.

**Where:**
- UI: Insights tab → saved-views bar mounted at the top of the Findings section.
- CLI: `reddit-cli research saved-view-create --scope "topic:<slug>" --name "..." --filter-json '{"min_opportunity_score":15}' --pinned`
- MCP: `openreply_saved_view_create(scope, name, filter_json, pinned)` + `openreply_saved_view_list(scope)`

**Filter schema** (all optional, combined with AND):
```json
{
  "min_opportunity_score": 15,
  "kinds": ["painpoint", "feature_wish"],
  "triangulation_strength_in": ["strong", "moderate"],
  "classification_in": ["CHRONIC"]
}
```

### 3.4 Custom extractor prompts (T3.7)

**What:** Override any bundled `prompts/*.yaml` at runtime via a `prompt_overrides` table.

**Why:** Power users want to tune the extractor's behaviour — "emphasize consumer-product painpoints over B2B" — without editing Python.

**Where:**
- UI: Settings → **Advanced: extractor prompts** (gated behind a "I know what I'm doing" checkbox). Lists every known prompt key, shows current text, lets you save or reset.
- CLI: `prompt-list`, `prompt-get --key K`, `prompt-set --key K --file newprompt.txt`, `prompt-clear --key K`
- MCP: `openreply_prompt_list`, `openreply_prompt_get(key)`, `openreply_prompt_set(key, override_text)`

**How:**
```bash
# See what keys exist
reddit-cli research prompt-list --json

# Read current extractor prompt
reddit-cli research prompt-get --key painpoints

# Override
reddit-cli research prompt-set --key painpoints --file my_painpoint_prompt.txt

# Revert to bundled
reddit-cli research prompt-clear --key painpoints
```

### 3.5 Topic comparison view (T3.2)

**What:** `#/compare/topicA/topicB` renders both topics side-by-side: Minto headers, top-5 findings each, shared-findings set, unique-to-A / unique-to-B sets (all computed client-side via loose title match).

**Why:** "Is meditation-app research meaningfully different from brain-training research?" takes 2 minutes without this; now it's 1 click.

**Where:**
- UI: Topic page toolbar → **Compare** button → picks the second topic from a modal.

---

## 4. Knowledge-graph depth

### 4.1 Dense cross-finding relations

**What:** After `upsert_semantic` persists findings, a post-pass uses the ChromaDB MiniLM embedder to create four new edge kinds:

- `relates_to` — any finding pair cosine ≥ 0.55
- `potentially_solves` — workaround ↔ painpoint ≥ 0.50
- `could_address` — feature_wish ↔ painpoint ≥ 0.50
- `co_evidenced` — two findings sharing ≥ 2 evidence posts (structural signal, label-independent)

Per-node neighbor cap (default 8) prevents hairballs.

**Why:** The old graph was a tree: `topic → finding → post`. Two findings about the same concept stayed disconnected. 15k edges, zero insight.

**Where:**
- Auto — runs at the tail of both `upsert_semantic` (every enrich) AND `build_structural` (every "Build graph" button click).
- MCP: `openreply_graph_build_relations(topic)`.

**How to densify an old graph** (no LLM cost):
```bash
# Any topic with ≥2 findings gets densified automatically on "Build graph".
# Or trigger directly:
python -c "from reddit_research.graph.relations import build_semantic_relations; \
  print(build_semantic_relations('meditation apps'))"
```

Env knobs: `OPENREPLY_REL_THRESHOLD` (0.55), `OPENREPLY_SOLVE_THRESHOLD` (0.50), `OPENREPLY_REL_MAX_NEIGHBORS` (8).

### 4.2 Research-to-finding linker

**What:** `reddit_research_link(topic, k)` matches each finding to the top-K academically-similar papers in the corpus via the palace. Persists to `finding_research_links`. UI renders as a clickable "📚 N research" chip on finding cards.

**Why:** Users asked "is there any academic backing for this painpoint?" — now one click answers it.

**Where:**
- Auto — fires after every synthesize via `runSynth`.
- CLI: `reddit-cli research link-research --topic T --k 3` and `research-links --topic T [--finding "..."]`.
- MCP: `reddit_research_link`, `reddit_research_links`.

---

## 5. Workflow productivity

### 5.1 Dashboard tile context menu (T1.1)

**What:** Right-click any topic tile on the Dashboard → menu with **Open**, **Re-collect fresh data**, **Delete**.

**Why:** Users couldn't delete a topic without opening it first.

### 5.2 Re-collect button on topic page (T1.2)

Already existed (`btn-rerun`) — verified reachable.

### 5.3 CSV bulk ingest (T3.6)

**What:** Ingest a CSV of posts collected from tools we don't support. Canonical headers: `post_id, title, body, author, url, created_utc, source_type`. Only `title` required. Re-imports dedupe on `post_id`.

**Why:** Users have research data from DataGrep / custom scrapers / spreadsheets. OpenReply was a walled garden.

**Where:**
- UI: Ingest screen → **Bulk CSV ingest** card.
- CLI: `reddit-cli research ingest-csv --path /path/to/data.csv --topic T --source "csv"`
- MCP: `openreply_ingest_csv(path, topic, source_type)`

All ingested posts go through `_tag_posts` → the relevance gate still runs, so garbage CSVs don't poison the graph.

### 5.4 `find-existing-topic` pre-check (from Topic Resolver)

**What:** When typing a new topic in the modal, OpenReply checks for a semantically-identical topic first and asks "open existing or create separate?" instead of silently creating a duplicate.

**Where:** Wired into the New Topic modal in `main.js`. Also available via MCP `openreply_find_existing_topic`.

---

## 6. Product Mode (daily-use PM surface)

All shipped in the Dual-Mode Pivot (Phases A/B/C/F); MCP surface added this pass.

**Why MCP:** PMs and CEOs use Cursor / Claude Code / Claude Desktop daily. They want to run a sweep, read signals, or copy the weekly digest without opening the desktop app.

### 6.1 New MCP tools for Product Mode

| Tool | What it does |
|---|---|
| `openreply_product_create(name, one_liner, category, topic, competitors)` | Register a Product |
| `openreply_product_list(active_only)` | List registered products |
| `openreply_product_sweep(product_id, trigger, skip_collect)` | Run the daily sweep + generate signals |
| `openreply_product_signals(product_id, since_days, include_resolved, limit)` | List open signals ranked by severity × confidence |
| `openreply_product_signal_action(signal_id, action, notes, snooze_days)` | dismissed / acted / snoozed / hypothesis |
| `openreply_product_dashboard(product_id, days)` | One-call fetch of Mirror / Lens / Field / Signals |
| `openreply_product_digest(product_id, days)` | Plain markdown for Slack / Notion |
| `openreply_product_convert_topic(topic, name, one_liner)` | Seed a Product from an existing Topic's graph |

**Example from Cursor / Claude Code:**
```
> Using the OpenReply MCP: run a sweep for product_id "mindwave-pro",
  then show me the top 3 signals and their suggested actions.
```

---

## 7. Developer experience & CI

### 7.1 GitHub Actions CI (T5.6)

**What:** `.github/workflows/ci.yml` with three jobs running on PR + push:

| Job | Platform | Does |
|---|---|---|
| `python-check` | ubuntu | `pip install -e ".[dev]"`, AST-parse every `src/**/*.py`, `pytest -m "not slow"` |
| `rust-check` | macos-arm64 | `cargo check` inside `app-tauri/src-tauri` with `Swatinem/rust-cache@v2` |
| `js-check` | ubuntu | `npm ci`, `node --check` every JS file |

All jobs skip LFS on checkout (the 220MB sidecar isn't needed for checks). Concurrency group `${{ github.workflow }}-${{ github.ref }}` with `cancel-in-progress: true` — stacked PR pushes don't pile up.

### 7.2 Regression test suite (T5.1)

`tests/test_tier_quality_pass.py` — 12 tests covering every new module. Guarded imports so the suite degrades gracefully if a module is absent.

- Topic resolver alias contract
- Soft-delete / restore
- Purge-older-than
- Quality-gate heuristics (parametrized)
- Feedback record + prompt injection
- Saved-views filter evaluator
- Prompt override roundtrip

Run:
```bash
pytest tests/test_tier_quality_pass.py -v
```

### 7.3 LFS maintenance runbook (T5.5)

`docs/ops/lfs-maintenance.md` — explains the LFS budget, quarterly prune schedule, and exact commands for `git lfs prune --dry-run` + `--verify-remote`. Linked from `docs/FEATURES.md` §14.6.

---

## 8. Complete MCP tool surface (28 new tools)

All callable from Claude Code, Cursor, Claude Desktop, Windsurf, Cline. Installed via the in-app MCP connector.

### Topic lifecycle

| Tool | Signature | Purpose |
|---|---|---|
| `openreply_topic_soft_delete` | `(topic)` | Soft-delete, 7-day undo |
| `openreply_topic_restore` | `(topic)` | Restore soft-deleted |
| `openreply_topic_trash_list` | `()` | List trash + age |
| `openreply_topic_trash_purge` | `(min_age_days=7)` | Hard-delete old trash |
| `openreply_find_existing_topic` | `(user_input)` | Pre-check for dupes |
| `openreply_merge_duplicate_topics` | `(apply=False)` | Merge LLM-caused dupes |

### Corpus quality

| Tool | Signature | Purpose |
|---|---|---|
| `openreply_clean_corpus` | `(topic, threshold=0.30, apply=False, min_keep=20)` | Retroactive relevance filter |
| `openreply_collect_quality_check` | `(topic)` | Quality-gate diagnostic |

### Intelligence layer

| Tool | Signature | Purpose |
|---|---|---|
| `openreply_feedback_record` | `(topic, finding_title, finding_kind, verdict, note)` | 👎 a finding |
| `openreply_feedback_list` | `(topic=None)` | Read feedback back |
| `openreply_global_competitors` | `(min_topics=2, threshold=0.80)` | Cross-topic competitor dedup |
| `openreply_saved_view_create` | `(scope, name, filter_json, pinned)` | Save a filter |
| `openreply_saved_view_list` | `(scope=None)` | List saved views |
| `openreply_prompt_list` | `()` | List extractor prompts + overrides |
| `openreply_prompt_get` | `(key)` | Read effective prompt |
| `openreply_prompt_set` | `(key, override_text)` | Override a prompt |
| `openreply_ingest_csv` | `(path, topic, source_type="csv")` | Bulk CSV ingest |
| `openreply_graph_build_relations` | `(topic)` | Densify graph edges |
| `reddit_research_link` | `(topic, k=3)` | Link findings to papers |
| `reddit_research_links` | `(topic, finding=None)` | Read paper links back |

### Product Mode

| Tool | Signature | Purpose |
|---|---|---|
| `openreply_product_create` | `(name, one_liner, category, topic, competitors)` | Register Product |
| `openreply_product_list` | `(active_only=True)` | List Products |
| `openreply_product_sweep` | `(product_id, trigger, skip_collect)` | Run sweep |
| `openreply_product_signals` | `(product_id, since_days, include_resolved, limit)` | Read open signals |
| `openreply_product_signal_action` | `(signal_id, action, notes, snooze_days)` | Dismiss/act/snooze/→hypothesis |
| `openreply_product_dashboard` | `(product_id, days=7)` | Full dashboard data |
| `openreply_product_digest` | `(product_id, days=7)` | Weekly markdown digest |
| `openreply_product_convert_topic` | `(topic, name, one_liner)` | Topic → Product |

Total MCP tools: **73** (was 45).

---

## 9. Complete CLI command reference

Every new command added in the pass, grouped by purpose:

### Topic lifecycle

```bash
reddit-cli research topic-soft-delete --topic T
reddit-cli research topic-restore --topic T
reddit-cli research topic-trash-list --json
reddit-cli research topic-trash-purge --min-age-days 7 --json

reddit-cli research find-existing-topic --input "user typed this"
reddit-cli research merge-duplicate-topics [--apply]
```

### Corpus quality

```bash
reddit-cli research clean-corpus --topic T [--threshold 0.30] [--apply] [--min-keep 20]
reddit-cli research collect-quality-check --topic T --json
```

### Intelligence

```bash
# Feedback
reddit-cli research feedback-record --topic T --title "..." --kind painpoint \
  --verdict wrong [--note "..."]

# Global competitors
reddit-cli research global-competitors [--min-topics 2] [--threshold 0.80]

# Saved views
reddit-cli research saved-view-create --scope "topic:T" --name "..." \
  --filter-json '{"min_opportunity_score":15}' [--pinned]
reddit-cli research saved-view-list [--scope "topic:T"]

# Custom prompts
reddit-cli research prompt-list --json
reddit-cli research prompt-get --key painpoints
reddit-cli research prompt-set --key painpoints --file /path/to/prompt.txt
reddit-cli research prompt-clear --key painpoints

# CSV ingest
reddit-cli research ingest-csv --path data.csv --topic T [--source-type csv] [--dry-run]
```

### Product Mode

```bash
reddit-cli research product-create --name "MindWave" --one-liner "..." \
  --category "meditation" --topic "meditation" --competitors '[{"name":"Calm"}]'
reddit-cli research product-list
reddit-cli research product-sweep --id mindwave --trigger manual --skip-collect
reddit-cli research product-signals --id mindwave --since-days 7
reddit-cli research product-signal-action --id <signal-uuid> --action acted
reddit-cli research product-digest --id mindwave --days 7
reddit-cli research product-dashboard --id mindwave --days 7 --json
reddit-cli research product-convert-topic --topic "meditation" --name "MindWave"
```

---

## 10. Environment variables — all tunable knobs

| Var | Default | Controls |
|---|---|---|
| `OPENREPLY_RELEVANCE_GATE_THRESHOLD` | `0.28` | Collect-time post cosine gate |
| `OPENREPLY_FINDING_RELEVANCE_THRESHOLD` | `0.40` | Post-LLM finding relevance gate |
| `OPENREPLY_STRICT_QUALITY` | `0` | 1 = enable strict post-quality filter |
| `OPENREPLY_EMBEDDING_MODEL` | `default` | `multilingual` for non-English corpora |
| `OPENREPLY_REL_THRESHOLD` | `0.55` | `relates_to` cosine cutoff |
| `OPENREPLY_SOLVE_THRESHOLD` | `0.50` | Cross-kind `potentially_solves` / `could_address` cutoff |
| `OPENREPLY_REL_MAX_NEIGHBORS` | `8` | Hairball-prevention cap per node |
| `OPENREPLY_CLUSTER_THRESHOLD` | `0.82` | Dedup clustering threshold (`retrieval/cluster.py`) |
| `OPENREPLY_MAX_KEYWORDS` | `1` | Query-expansion fanout |
| `INSIGHTS_HARD_CAP` | `2000` | Synthesis corpus hard cap |
| `INSIGHTS_CAP_*` | per-source | Per-source caps (see `insights.py`) |
| `LLM_PROVIDER` | (auto-resolve) | Force a provider |
| `LLM_MODEL` | (auto-pick) | Force a model within provider |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama endpoint |
| `REDDIT_MYIND_DATA_DIR` | platform default | Override data dir |
| `REDDIT_MYIND_PALACE_EAGER` | `0` | 1 = eager ONNX warm on sidecar boot |

Set any threshold to `0` to disable that gate entirely.

---

## 11. Explicit deferrals

With reasons — revisit when the trigger condition lands.

| Item | Why deferred | Revisit when |
|---|---|---|
| **Trustpilot API / YouTube / TikTok sources** | Partnership / closed auth | Business dev unlocks the API |
| **PDF / DOCX / PPTX export** | weasyprint adds 30 MB to the bundle; markdown covers 90% | ≥3 users request PDF specifically |
| **Progressive insights during collect** | Requires synth restructure (accept partial corpora) | Latency complaints surface |
| **Shared read-only link** | Needs cloud backend (bucket + nonce) | We commit to a hosted tier |
| **OAuth Intercom / Zendesk / Stripe** | Needs credential vault + server | Product Mode Phase D starts |
| **Stripe billing + accounts** | Needs auth layer | Product Mode Phase E starts |
| **Email / Slack digest delivery** | Needs relay | Product Mode Phase G starts |
| **Prompt versioning + A/B** | Only meaningful at multi-user scale | 100+ active users |
| **Opt-in telemetry** | Needs privacy review + relay | External launch |
| **Launchd daily sweep scheduler** | 1-day follow-up (extend existing `schedule.rs`) | Next polish cycle |
| **Native OS notifications** | Requires adding `tauri-plugin-notification` | Next polish cycle |

---

## Appendix A — How every surface lines up

Three front doors, one engine:

```
┌───────────────┐     ┌──────────────┐     ┌──────────────┐
│  Desktop UI   │     │   CLI        │     │  MCP client  │
│  (Tauri)      │     │  (Typer)     │     │  (Claude Code│
│               │     │              │     │   / Cursor)  │
└──────┬────────┘     └──────┬───────┘     └──────┬───────┘
       │                     │                    │
       └──────────────┬──────┴────────────────────┘
                      │
        ┌─────────────▼──────────────┐
        │  src/reddit_research/      │
        │  — topic_resolver          │
        │  — trash                   │
        │  — relevance (gate)        │
        │  — quality_gate            │
        │  — feedback                │
        │  — saved_views             │
        │  — prompt_store            │
        │  — product / product_sweep │
        │  — research_linker         │
        │  — graph/relations         │
        └────────────────────────────┘
                      │
              ┌───────▼───────┐
              │  SQLite       │
              │  + ChromaDB   │
              │  (MiniLM ONNX)│
              └───────────────┘
```

Every capability is reachable from all three surfaces — UI for human use, CLI for scripting, MCP for LLM agents.

---

## Appendix B — Regression-test guarantees

The 12 tests in `tests/test_tier_quality_pass.py` are contract tests — they don't just exercise code, they assert the observable contract:

1. **`resolve_topic` read-only by default** — guards against accidental auto-normalization regressing.
2. **LLM-bound alias redirects case variants** — guards Tier-1 dedup story.
3. **Soft-delete + restore cycle** — guards T1.3 contract (graph + bets recoverable).
4. **Purge older-than runs cleanly** — guards the cron target.
5. **Quality gate parametrized across 5 cases** — bot list, score floor, length floor, strict escalation.
6. **Feedback record + prompt injection** — guards T2.4 round-trip.
7. **Saved-views filter evaluator** — guards T3.1 client-side filter.
8. **Prompt override roundtrip** — guards T3.7 with the default-loader contract.

Run before every commit touching `research/` or `retrieval/`.

---

*End. Re-generate this doc when another Tier pass ships or when a deferral moves to "shipping".*
