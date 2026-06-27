# OpenReply — Build Status (Features · Functions · API · DB)

> Living status of the OpenReply build on branch `open-reply`. Lists every feature/screen,
> the engine functions, the API surface (Rust commands + JS wrappers), DB changes/tables,
> and a prioritized worklist. Update after each change. Companion to `OPENREPLY_MASTER.md`.
>
> **Updated:** 2026-06-27 · Legend: ✅ live/wired · 🟡 partial · 🟦 static prototype · ❌ missing

---

## 1. Screens — status

| Screen | Route | Status | Backed by |
|---|---|---|---|
| Agents dashboard | `#/agents` | ✅ live | `agent_list/create/use` |
| Agent overview | `#/agent` | ✅ live | `agent_get` + `agent_knowledge` + `agent_refresh` |
| Opportunities | `#/opportunities` | ✅ live | `reply_find` (RRF) / `reply_list` / `reply_draft` |
| Compose | `#/compose` | ✅ live | `content_generate` / `content_list` |
| Connections | `#/connections` | ✅ live | `creds_list/import_browser/save_manual/verify/delete` |
| Settings | `#/settings` | ✅ live | `byok_status/set`, `test_llm`, `feeds_*`, `app_*` |
| Inbox (mentions) | `#/inbox` | ✅ live | reuse `reply_list` (planned) |
| Keywords | `#/keywords` | 🟦 static | `agent_get` + new `agent_update` (planned) |
| Subreddit Intel | `#/subreddit` | 🟦 static | new `reply_rules` cmd (planned) |
| Knowledge | `#/knowledge` | ✅ live | `agent_knowledge` (+ graph) (planned) |
| Analytics | `#/analytics` | ✅ live | derive from `reply_list`+`content_list` (planned) |
| AI Visibility (GEO) | `#/geo` | 🟦 static | new backend (later) |
| Queue | `#/queue` | ✅ live | `content_list` by status (planned) |
| Alerts | `#/alerts` | 🟦 static | new alert-rules store (later) |
| Onboarding wizard | `#/onboarding` | 🟦 static | `agent_create` on finish (planned) |

---

## 2. Features — status

- ✅ **Agent (persona) model** — create / list / switch / update / delete; active-agent pointer.
- ✅ **Knowledge refresh** — `agent refresh` reuses `research.collect` (Reddit no-API + sources).
- ✅ **Opportunity finding + engagement-weighted RRF ranking** (`reply/rank.py`):
  `final = 0.55·base + 0.20·rrf + 0.15·engagement + 0.10·freshness`.
- ✅ **Reply drafting** — value-first, persona voice + **subreddit-rule compliance** check.
- ✅ **Content generation** — post / thread / script / article from agent knowledge.
- ✅ **Connections (Reach)** — per-platform cookie/key credentials, verify.
- ✅ **BYOK settings** — provider key set/status, test LLM, model lists, custom RSS feeds.
- ✅ **Dark/light theme, Lucide icons, Reddit palette, toast/modal helpers.**
- 🟡 **Onboarding** — UI exists (static wizard); not yet wired to `agent_create`.
- 🟦 **Inbox / Keywords / Subreddit Intel / Knowledge / Analytics / GEO / Queue / Alerts** — UI built, not wired.
- ❌ **Outbound publishing** (auto-post) — by design manual now; `publish/` layer later.
- ❌ **Scheduler** (auto knowledge-refresh / scheduled content) — later.

---

## 3. Engine functions (Python `src/gapmap/reply/`)

| Module | Key functions |
|---|---|
| `agent.py` | `create_agent, get_agent, get_active_agent, list_agents, update_agent, delete_agent, set_active, active_id, knowledge_summary, refresh_agent` |
| `brand.py` | `get_brand, set_brand` (active-agent → brand shim for the engine) |
| `opportunity.py` | `find_opportunities, list_opportunities, _candidates, _score` |
| `rank.py` | `engagement_score, freshness, platform_weight, fuse_and_rank` (RRF) |
| `generate.py` | `generate_reply` (+ compliance) |
| `content.py` | `generate_content, list_content` |
| `rules.py` | `fetch_sub_rules, check_compliance` |
| `platforms.py` | `PLATFORMS, get_platform, reply_platforms, all_keys` |
| `schema.py` | `init_reply_schema` (creates/migrates reply_* tables) |
| `util.py` | `loads_json` |

**CLI groups** (`gapmap …`): `reply` (platforms, brand-set, brand-get, find, list, draft, rules) ·
`agent` (create, list, get, use, update, delete, knowledge, refresh) · `content` (generate, list).

---

## 4. API changes — Rust commands & JS wrappers

### New OpenReply Rust commands (`commands.rs` + registered in `main.rs`)
`reply_platforms` · `agent_list` · `agent_get` · `agent_create` · `agent_use` ·
`agent_knowledge` · `agent_refresh` · `reply_find` · `reply_list` · `reply_draft` ·
`content_generate` · `content_list`  (+ `cli_info`).

### Reused Rust commands (kept from gapmap, wired to Connections/Settings)
`creds_list/creds_import_browser/creds_save_manual/creds_verify/creds_delete` ·
`byok_status/byok_set` · `test_llm` · `list_provider_models` · `list_ollama_models` ·
`feeds_list/feeds_validate/feeds_add/feeds_remove/feeds_enable` ·
`app_data_dir/reveal_in_finder/open_url/app_reset_preview/app_hard_reset/app_relaunch`.

### JS wrappers (`app-tauri/src/or/api.js`)
`agentList, agentGet, agentCreate, agentUse, agentRefresh, agentKnowledge, replyPlatforms,
replyFind, replyList, replyDraft, contentGenerate, contentList` + `credsList, credsImportBrowser,
credsSaveManual, credsVerify, credsDelete, byokStatus, byokSet, testLlm, listProviderModels,
listOllamaModels, feedsList, feedsValidate, feedsAdd, feedsRemove, feedsEnable, appDataDir,
revealInFinder, openUrl, appResetPreview, appHardReset, appRelaunch` (+ `isTauri`, `esc`).

### Pending API additions (for the static screens)
- `agent_update` (Keywords screen — edit keywords/platforms/voice).
- `reply_rules` (Subreddit Intel — fetch/cache `about/rules.json`).
- `content_schedule` / `content_update_status` (Queue).
- mentions/alerts endpoints (Inbox/Alerts) — or reuse `reply_list`.

---

## 5. DB changes — tables & columns

### New tables (OpenReply, created by `reply/schema.py` + `reply/agent.py`)
| Table | Purpose | Key columns |
|---|---|---|
| `agents` | brand/niche personas | id, name, brand, niche, persona, tone, audience, topic, keywords_json, platforms_json, accounts_json, refresh_cadence, last_refresh_at, created_at, updated_at |
| `reply_state` | kv (active agent) | key, value |
| `reply_opportunities` | scored opportunities | id, brand_id, platform, post_id, title, body, url, author, sub, relevance, intent, fit, **engagement, freshness, rrf**, score(final), reason, status, found_at |
| `reply_drafts` | reply drafts | id, opportunity_id, brand_id, platform, text, compliant, compliance_notes, created_at |
| `content_items` | posts/threads/scripts/articles | id, agent_id, kind, platform, opportunity_id, title, body, compliant, status, scheduled_at, posted_at, remote_url, angle, created_at, updated_at |
| `reply_sub_rules` | subreddit rules cache | sub, rules_json, summary, fetched_at |
| `reply_brands` | legacy (superseded by agents) | (unused) |

**Columns added:** `reply_opportunities.{engagement, freshness, rrf}` (idempotent migration in `schema.py`).

### Kept gapmap tables (used by the OpenReply path)
`posts, comments, topic_posts, subreddits, fetches, source_credentials, graph_nodes,
graph_edges, findings, topic_prefs, topic_canonicalizations, chat_conversations`.

### Removed (backend cleanup)
96 research Python modules (papers/academic/product/consultancy). Their tables
(`paper_*`, `products*`, etc.) are now orphaned — a `migrate --drop-research` (with backup)
is deferred (see `OPENREPLY_RESHAPE.md`).

---

## 6. Prioritized worklist (work top-down)

1. **Verify Connections + Settings live** (just wired) — confirm `creds_list`/`byok_status`
   shapes render correctly; fix any mismatch.
2. **Wire Knowledge** (`#/knowledge`) — `agent_knowledge` KPIs + angles (no new backend).
3. **Wire Inbox** (`#/inbox`) — reuse `reply_list` as the mentions feed (no new backend).
4. **Wire Analytics** (`#/analytics`) — derive counts from `reply_list` + `content_list`.
5. **Wire Queue** (`#/queue`) — `content_list` grouped by status.
6. **Add `agent_update`** Rust cmd + wire **Keywords** (`#/keywords`).
7. **Add `reply_rules`** Rust cmd + wire **Subreddit Intel** (`#/subreddit`).
8. **Wire Onboarding** wizard → `agent_create` on finish.
9. GEO / Alerts / Scheduler / outbound publish — later milestones.
10. Drop orphaned research tables (`migrate --drop-research`, with backup).

---

## 7. Verification log
- ✅ Engine imports clean (`gapmap.cli.main`, `gapmap.mcp.server`), `reply/agent/content` run.
- ✅ RRF ranking: deterministic unit test + live `reply find`.
- ✅ Agents screen renders real agents from the app DB (screenshot-confirmed).
- ✅ Sidebar agent switcher = live (`agent_list` → `agent_use`).
- ⏳ Connections/Settings dynamic: wired, pending visual confirmation.
