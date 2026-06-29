# OpenReply — Project status

> **Scope:** the full arc of decisions in this session (2026-04-19 → 2026-04-20). What was built, what was deliberately skipped, what's queued for later, and the rationale for each bucket. Meant to be read linearly top-to-bottom.

**Last updated:** 2026-04-20
**Current branch:** `multi-source` (private: `shaantanu9/openreply`)
**Latest commit:** Phase 2 — Minto + hypothesis cards + counter-evidence + Ulwick scoring

---

## 1. What we built

### 1.1 Insight Engine (the core product surface)

Built as two Phases of the same spec (`docs/specs/2026-04-20-insight-engine.md`):

| Phase | Description | Status |
|---|---|---|
| Phase 1 | One-shot Claude-native synthesis replacing 4 isolated extractors. Produces structured JSON (findings, competitors, quadrant) persisted to `topic_insights` table. Provider-agnostic via per-provider corpus caps (Claude 2000 posts → Ollama 100). | ✅ shipped |
| Phase 2 | Methodology-grade rigor layer: Minto pyramid header, Popper-validated hypothesis cards, counter-evidence modal, Ulwick Opportunity Score (0–20), triangulation badges, Bayesian credible intervals. All extend the same single synthesis call. | ✅ shipped |

**Files:** `src/reddit_research/research/insights.py`, `prompts/insights_synthesis.yaml`, `app-tauri/src/screens/insights.js`, `app-tauri/src-tauri/src/commands.rs` (`synthesize_insights`), topic.js tab wiring.

**Why this is the product's spine:** turns OpenReply from exploration tool ("here's what people complain about") into decision tool ("here's what to build, why, and how you'd test it").

### 1.2 Multi-source collection pipeline (already existed, hardened this session)

| Capability | Sources | Status |
|---|---|---|
| Reddit (posts + comments + historical) | via PRAW + Pullpush | ✅ |
| External sources | HN, App Store, Play Store, arXiv, OpenAlex, PubMed, Dev.to, Stack Overflow, GitHub, Google News, Google Trends | ✅ 11 sources, parallel (6-worker ThreadPoolExecutor) concurrent with Reddit |
| Non-aggressive baseline | HN + arXiv + Dev.to + SO + GitHub even in quick mode | ✅ shipped this session |
| Multi-keyword sub discovery | Unions subs from canonical + LLM-expanded keywords | ✅ shipped this session |
| LLM topic canonicalization | Typo correction + 5–8 scored keywords cached per topic | ✅ |

### 1.3 Cross-source graph model

- `graph_nodes` + `graph_edges` in SQLite; topics link to posts/subs/users/era/source.
- **New in this session:** every semantic finding (painpoint / feature_wish / workaround / product) creates **weighted `source_evidence` edges** to each contributing source type. `source_breakdown` + `source_diversity` + `evidence_count` stamped into node metadata for instant UI access.
- Export HTML viewer renders source_evidence edges with distance 90 + orange stroke scaled by log(weight).
- Fallback: when 0 findings exist, skeleton export still includes top 120 posts by engagement so the graph isn't empty.

### 1.4 Tab UX + race fixes

- Every tab loader (Map, Report, Evidence, Sources, Research, Chat, Trends, Posts, Solutions, Insights) uses a gated `set(html)` helper. Stale renders silently drop when the user clicks another tab.
- Immediate synchronous "Loading…" placeholder on tab click (no perceived hang).
- Cross-tab drill: source badges on findings → Posts tab filtered to that source.
- Source-rows in Sources tab clickable → Posts tab with source filter applied.

### 1.5 Stability / dev-ops

| Fix | File | Why |
|---|---|---|
| Exit handler kills Python children on app quit (prod + dev) | `main.rs` | Was leaking zombie `reddit-cli` processes to Activity Monitor |
| Streaming guards check both `ActiveJob` AND `ActiveJobPid` | `cli.rs` | Dev-python PID path previously ignored; let two collects stack |
| `init_schema` auto-sweeps fetch rows with `ended_at IS NULL > 10 min` | `db.py` | Stale "Collecting…" chips persisted after crash recovery |
| Modal shows spinner + 20 s timeout on `discoverSubs` | `main.js` | Reddit API calls made the modal feel hung |
| `.spinner-inline` CSS | `style.css` | Inline feedback on button clicks |

### 1.6 Infrastructure

- **Private GitHub repo** created: `shaantanu9/openreply`.
- **Git LFS** set up for `app-tauri/src-tauri/binaries/reddit-cli-*` (219 MB PyInstaller sidecar). History migrated across 126 commits.
- **`.gitignore` extended:** `app-tauri/.claude/`, `scripts/onnx-model-cache/`.
- **App icon:** full Tauri icon set generated from `openreply_logo.jpg` (macOS `.icns`, Windows `.ico`, Linux PNGs, iOS `AppIcon*`, Android mipmaps).

### 1.7 Skills created for future reuse

| Skill | What it covers |
|---|---|
| `~/.claude/skills/tauri-app-icon/SKILL.md` | End-to-end Tauri icon setup, including the "dev mode shows orange square because no `.app` bundle" gotcha — bake a debug .app via `tauri build --debug --bundles app` |

---

## 2. What we explicitly did NOT build — and why

These were evaluated during this session (many from `docs/RESEARCH_METHODOLOGY.md`) and rejected as **noise, scope creep, or premature**. Keeping a record so we don't re-litigate each one.

| Feature / idea | Rejected because | When it might matter |
|---|---|---|
| **Issue trees + SCQA** as a user-facing Phase 1 step | Founders don't want to build MECE hypothesis trees before collecting data. It's a consulting *deliverable*, not a product workflow. Adds complexity for users who want fast answers. | If we pivot to serving consulting firms (not early-stage founders) |
| **Dual-model Claude+GPT adjudication** with Cohen's κ dashboard | Doubles LLM cost for a <5% precision gain. Heavy operational complexity. For a solo/small-team app this is research-firm territory. | Only if we get regulated-industry customers demanding audit trails |
| **30-source expansion** (patents, complaints DBs, Whisper-transcribed podcasts, Trustpilot, LinkedIn, YouTube comments at scale, AlternativeTo, ProductHunt, etc.) | Each adapter is 1–3 days. We have 13, which covers 80% of signal for most consumer topics. Adding 17 more = ~quarter of engineering for diminishing marginal signal. | If a specific high-value customer segment needs a specific source |
| **Neo4j / ArangoDB migration** | Our SQLite `graph_nodes`/`graph_edges` tables work fine at current user count. Premature optimization. | Only when a single user's graph exceeds ~1M edges |
| **Weekly human-QA dashboard with Krippendorff's α** | Academic research-firm apparatus. Overkill for founder-facing product. Instead: add a "flag this as wrong" button on findings — one button > one dashboard. | Post-PMF, when we have budget for researcher salary |
| **Reproducibility snapshots + BibTeX export** | Academic-use-only; zero value for founders deciding what to build. The feature that matters is "shareable link to brief," not "cite this as run #47A2." | If we market to university labs or policy shops |
| **Adversarial testing harness** (seeded bots, astroturf, spam) | Right idea, wrong priority. Reddit PRAW already filters bots; source-level quality is adequate. Building a full harness is 2+ weeks. | Post-PMF, when we see adversarial data in the wild |
| **CrewAI or multi-agent orchestration** | Our current chat tool-use agent (5 tools) delivers the same value at 10% the complexity. Multi-agent systems increase LLM calls 5–20× and lose determinism (same input → different output across runs). | Only if we find a problem where agents genuinely need to negotiate |
| **Strategy Canvas as radar/parallel-coordinate viz** | Methodology-correct but often illegible in practice. A simple competitor × feature → ✓/✗/partial table captures 80% of the value at 10% of the build effort. Will ship the table in Phase 3, skip the heavy viz. | Never — the simpler table replaces it |
| **Prompt versioning directories with `/v2.3/` + CHANGELOG.md** | Git history + `prompts/*.yaml` already gives us this for free. Directory ceremony is modest hygiene with no user-facing value. | Never as spec'd; we may add prompt eval sweeps later |

---

## 3. What we deferred — not now, worth revisiting

These ARE valuable but not in the current critical path. Queued for post-Phase-2 work.

| Feature | Why not now | Trigger to revisit |
|---|---|---|
| **Phase 3 — Competitor matrix** (simple feature-vs-product table) | Users need hypothesis cards first (which Phase 2 just delivered). Matrix is nice-to-have once users validate ≥1 hypothesis. | After 5 real users finish their first hypothesis test |
| **Phase 4 — Research-to-finding linking via semantic palace** | Palace exists (ChromaDB + BM25 hybrid). Linking painpoints to academic papers via embedding similarity is a 2-day job. Deferred because Ulwick's `academic_backing` field in Phase 2 already covers the light case (Claude pulls cited papers from the corpus). | When users consistently ask "what does the research actually say about X?" |
| **Phase 5 — Monitoring / weekly delta view** | Requires cron infra (already have launchd on macOS), refresh logic, delta computation, dashboard UI. Meaningful only after users have 2–3 weeks of history. Cold-start useless. | When we have a returning-user cohort with ≥3 weeks of data |
| **Phase 6 — Export formats** (pitch deck, battlecard, investor memo, Notion, PDF) | This is the distribution/virality layer. High-ROI AFTER we're confident the insight quality is good (which Phase 2 just tested). Premature to polish export of mediocre output. | After Phase 2 gets real user feedback confirming quality |
| **Three-pass open→axial→selective coding** (methodology doc Phase 3) | Academically correct, but 3× LLM calls per topic. Current one-shot synthesis produces usable output. Worth an A/B pilot, not a rewrite. | Run an A/B on 5 topics; if selective coding measurably outperforms on user "this is useful" rating, ship |
| **Saturation curves over time** (methodology doc Phase 4) | We have saturation *labels* (saturated / adequate / tentative / thin). Adding the curve over N batches is polish — not load-bearing. | When users ask "why did you stop collecting?" |
| **"Flag as wrong" button on findings** | Easy to ship (~1 day). Valuable feedback channel. But not the single-biggest user-value per engineering hour right now. | Next small-polish sprint |
| **Post-ID filter on Posts tab** (drill from hypothesis citation → exact post) | Requires new `runQuery` path or new API. Works today via source filter; post-ID filter is a UX upgrade. | With Phase 3 competitor matrix |

---

## 4. Why this sequence — the philosophy

Three principles guided what made the cut vs. what didn't:

### 4.1 User value per engineering hour

Every item asked: **"how many of our users will notice this in their first session?"** Minto header, hypothesis cards, counter-evidence → visible in every session, high value. BibTeX export, adversarial harness, Neo4j → visible to zero users in Q1.

### 4.2 Epistemic honesty over methodology theater

The methodology doc recommended many features that signal rigor (dual-model adjudication, weekly κ dashboard, issue trees). We rejected the theatrical ones and kept the epistemically-honest ones. **Credible intervals + counter-evidence + Popper falsifiers are load-bearing.** κ dashboards are decoration.

### 4.3 Ship coherent commits

Everything in Phase 2 shares the same LLM call and output schema. Phase 1 ships standalone. Each phase passes the test: **"could we ship and stop here and still deliver something useful?"** If not, it's the wrong scope.

---

## 5. Current state snapshot

| Dimension | Status |
|---|---|
| Git | `multi-source` branch, 1 commit ahead of Phase 1 push |
| Pushed to GitHub? | Phase 1 yes; **Phase 2 local only, awaiting push** |
| Running app | Debug `.app` exists at `app-tauri/src-tauri/target/debug/bundle/macos/OpenReply.app` with the correct icon |
| LLM provider | Claude Opus 4.7 (user's default), provider-agnostic fallback to 7 others |
| Test corpus | 2 topics: "calari tracking app" (7837 posts, 4 sources), "meditation and sound frequency brainwave app" (5182 posts, 8 sources) |
| Semantic palace | ChromaDB + BM25 hybrid ready; ONNX model cache 80 MB (gitignored, regenerated) |
| DMG shipping readiness | Not yet — awaits user testing + icon verification + (optional) code-signing setup |

---

## 6. Immediate next moves (user's call)

1. **Push Phase 2** — `git push origin multi-source`. Clean additive commit over the private repo.
2. **Test Phase 2 in the app** — open any collected topic, hit the Insights tab, verify:
    - Minto header renders with 1 governing thought + 3 arguments
    - Hypothesis cards appear with falsifiers and cheapest_test blocks
    - Counter-evidence chips are clickable and show disconfirming quotes
    - Credible interval chips read like "📊 X%–Y% of corpus"
    - Triangulation badges show colored icons
3. **Pick the next phase** — my recommendation: Phase 3 (competitor matrix) is the smallest, most self-contained next win. Phase 6 (export formats) is higher-ROI once Phase 2 quality is validated.

---

## 7. Related docs

- `docs/specs/2026-04-20-insight-engine.md` — the implementation spec (what and how)
- `docs/RESEARCH_METHODOLOGY.md` — external methodology reference (theoretical basis; not a build list)
- `changelogs/2026-04-19_*` through `2026-04-20_07_*` — per-change log entries
- `~/.claude/skills/tauri-python-sidecar-app/SKILL.md` — battle-tested Tauri+Python patterns
- `~/.claude/skills/tauri-app-icon/SKILL.md` — icon generation + dev-mode gotcha

---

*This doc is a decision log, not a manual. When you're confused about "why isn't X in the app?" — check §2 and §3 first.*
