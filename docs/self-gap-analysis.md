# Self-gap analysis — reddit-myind vs the UX-research market we surveyed

**Source:** `data-validate-ux-research-saas/report-pro.md` (762 posts, 8 painpoints, 6 feature wishes, 5 competitors, 5 DIY workarounds).

This doc maps every finding from our own research onto reddit-myind's
current state. ✅ = we cover it · 🟡 = partial · 🔴 = open gap.

---

## 🔥 Painpoints the market has — how we stack up

| # | Painpoint | Evidence | Status | What we need |
|---|---|---|---|---|
| 1 | Customer signal in Slack/tickets never reaches the research repo | CHRONIC · 12 posts | 🟡 | Multi-source ingest exists (20 sources) but not Slack/Intercom directly. **Add local file ingest** for exported Slack/CSV as near-term fix. |
| 2 | Manual tagging interviews is slow + inconsistent | CHRONIC · 10 posts | 🟡 | Our YAML prompts are consistent, but we don't ingest raw interviews. **Local file ingest** unlocks this. |
| 3 | Recruitment/screener friction kills participant velocity | CHRONIC · 7 posts | 🔴 | Out of scope — we don't recruit. Partner integration (Calendly/PeopleDataLabs) is v2. |
| 4 | Stakeholders won't read long reports | CHRONIC · 6 posts | ✅ | Exec summary block at top of viewer. Copy-as-tweet + copy-as-markdown buttons. |
| 5 | AI hallucination in auto-synthesis erodes trust | EMERGING · 5 posts | 🟡 | `docs/methodology.md` + citation integrity in viewer. **Add saturation indicator** to show confidence math explicitly. |
| 6 | No single source of truth across tools | CHRONIC · 8 posts | 🟡 | 20 sources is good. **Add local file ingest** to cover the private-signal gap. |
| 7 | Junior UX research roles disappearing (AI pressure) | EMERGING · 10 posts | — | Market context, not a product bug. We make researchers 10× (argument for the role). |
| 8 | Dovetail expensive + locks you in | CHRONIC · 8 posts | ✅ | Free open-source CLI; $49 Desktop Pro beats Dovetail's $12k/yr. Self-hostable by design. |

## 💡 Feature wishes — how we stack up

| # | Wish | Freq | Status | Gap |
|---|---|---|---|---|
| 1 | Auto-ingest Slack + Intercom + Gong + calls | 15 | 🟡 | Public sources yes; private sources via **local file ingest** now, OAuth integrations in v2. |
| 2 | AI theme clustering across interviews | 12 | 🟡 | LLM extractors clustering painpoints yes, but rigid 4-category YAML. **Embedding-based emergent clustering** is the v2 upgrade. |
| 3 | One-page exec summary auto-generated | 8 | ✅ | Exec block in viewer. `findings --tweet` CLI. `report-pro --exec-only` flag TODO. |
| 4 | Public-signal triangulation (Reddit+HN+App Store+interviews) | 6 | ✅ | 20 sources, source-distribution bars in viewer. |
| 5 | Citation integrity — every insight ↔ source quote | 5 | ✅ | Every finding card has evidence posts with permalinks. Methodology doc grounds the math. |
| 6 | One-time price / self-hostable alternative | 7 | ✅ | Free CLI + $49 Desktop Pro. Fully open-source. |

## 😡 Products we compete with — where we have an angle

| Product | Severity | Their weakness | Our angle |
|---|---|---|---|
| **Dovetail** | high · 12 | Expensive + Slack signal never enters repo | Local-first + local file ingest + $49 lifetime |
| **Notably** | medium · 3 | AI hallucinates | Methodology-grounded + citation integrity + saturation math |
| **UserTesting** | high · 5 | Enterprise pricing + slow panel | We don't do recruiting — partner play |
| **Maze** | low · 3 | Usability-test only, no synthesis | We do synthesis across everything |
| **Grain** | medium · 3 | Call capture only, no cross-source | Triangulation is our whole game |

## 🛠 DIY workarounds the market uses — do we compete?

| # | Workaround | Our equivalent |
|---|---|---|
| 1 | Claude/ChatGPT as ad-hoc synthesizer | ✅ We use Claude via MCP, but with structured graph + citations |
| 2 | Notion database of interview quotes | ✅ SQLite + markdown export + graph viz |
| 3 | Google Sheets quote bank | ✅ `reddit-cli export --format csv` |
| 4 | Built own internal research tool | ✅ We ARE the OSS version of this |
| 5 | Slack channel as research repo | 🔴 — **gap.** Need Slack export parser at minimum |

---

## Gap closure plan — v1 (this commit)

Three closable gaps we can ship now:

### 1. Local file ingest (`reddit-cli ingest file`)
**Closes:** painpoint #1, #2, #6, feature wish #1, DIY #5
**Scope:** parse CSV / JSON / TXT / VTT / SRT into our `posts` table with `source_type='local_<kind>'`. User can drop a Slack export or interview transcript and it flows into the graph identically to Reddit posts.

### 2. Saturation indicator per finding
**Closes:** painpoint #5 (AI hallucination trust)
**Scope:** compute Guest et al.'s saturation math — unique evidence authors + cross-source diversity — and surface as a badge (`saturated ✓` at ≥12 evidence across ≥2 sources, otherwise `tentative`). Makes confidence math explicit.

### 3. Save-as-PNG share button
**Closes:** feature wish #3 partially (stakeholders-won't-read → now there's also a downloadable image)
**Scope:** html2canvas snapshot of the exec-summary block, client-side render → download.

## v2 gaps (next commit batch, possibly desktop-tier features)

- 🔴 Emergent theme clustering via `sentence-transformers` embeddings (replaces YAML 4-category model)
- 🔴 Slack OAuth (real-time ingest, not just exports)
- 🔴 Scheduled weekly runs + diff-mode ("what changed since last week?")
- 🔴 Notion / Airtable direct export
- 🔴 Grain / Gong integration for call transcripts

## v3 / post-launch

- Recruiter panel integration (Calendly, PeopleDataLabs)
- Team workspace + permissions
- Webhook notifications on new trend detection
- Browser extension for in-context annotation
