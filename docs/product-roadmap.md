# reddit-myind → gap-intelligence product roadmap

**Context:** We validated the tool on two real topics. The ATS artifact is sharp ([report-pro.md](../data-validate-ats-resume-and-job-search-apps/report-pro.md), 755 lines, multi-source citations). This doc converts that into a concrete product plan, with honest reality-check on where the validation fell short.

---

## What the validation actually proved

| Test | Result |
|---|---|
| Multi-source triangulation works | ✅ 8,682 ATS posts across 9 sources |
| Semantic extraction yields real citations | ✅ 15 painpoints × 10 posts each = 117 evidence edges |
| Viewer scales to 15k+ nodes | ✅ (after skeleton fix) — renders 203-node overview |
| Report reads like premium research | ✅ — named competitors, quoted users, DM-ready authors |
| Meta-research validates product-market fit | ⚠ — query too broad, mostly off-target |

**The ATS artifact is the proof.** Meta-research fell short because the query was too broad, but that's not a blocker — the tool itself works. For the product roadmap below, I'm using my own knowledge of the competitive landscape rather than the noisy meta corpus. A narrower re-run (`"Dovetail Condens product research tools"`) would confirm.

---

## Competitive landscape — what we're up against

### Tier 1: Enterprise research platforms ($200-2000/mo)

| Tool | Strengths | Gaps we can exploit |
|---|---|---|
| **Dovetail** ($$$) | Polished repo for interviews | Expensive, closed, only stores what YOU input |
| **Condens** ($$$) | Video highlight reels | Same as above — no scraping, you feed data manually |
| **Notably** ($$) | AI synthesis | Beta-ish UX, limited source support |
| **Aurelius** ($$) | Tagging systems | Manual input only |
| **UserTesting / UserZoom** ($$$$) | Runs tests | Doesn't scrape existing signal |
| **Qualtrics / Medallia** ($$$$$) | Enterprise VoC | Expensive, complex, survey-focused |

**Gap:** None of them ingest public data (Reddit, HN, store reviews) at scale. They assume you already have user interviews — they don't help you *find* what to research.

### Tier 2: Trend / market intel ($39-500/mo)

| Tool | Strengths | Gaps |
|---|---|---|
| **Sparktoro** | Audience discovery | No gap analysis, no painpoint extraction |
| **Exploding Topics** | Trending keywords | No temporal classification, no corpus depth |
| **Trends.vc / Trends.co** | Curated reports | Human-written, narrow coverage |
| **Crayon / Klue** | Competitive intel | Tracks competitor updates only, no user voice |
| **Sensor Tower / Apptopia** | App-store intelligence | App-only, no Reddit/HN triangulation |

**Gap:** No one combines temporal classification + multi-source triangulation + shareable OpenReply maps.

### Tier 3: Indie / manual workflows

- Reddit manually + ChatGPT summarization
- Twitter searches
- Notion databases of quotes
- Google Sheets tracking

**Gap:** High effort, zero automation, results aren't shareable.

---

## Where reddit-myind uniquely fits

**The thesis:**
> "Qualtrics meets Sparktoro, but $19 instead of $15,000, and local-first."

| Pillar | How we're different |
|---|---|
| **Source breadth** | 20 sources (vs most competitors: 1-3) |
| **Temporal signal** | CHRONIC / EMERGING / FADING via pre-May-2025 pullpush + live |
| **Triangulation** | Evidence edges cross-reference sources automatically |
| **Shareable output** | Self-contained HTML OpenReply map as marketing vector |
| **Local-first** | Users bring own IP + LLM key, data never leaves their machine |
| **Open source + commercial** | CLI free, desktop app paid (Raycast / Obsidian model) |
| **Graph-native** | Only one that exposes the structural topology |
| **Academic + practical** | Academic sources (arXiv, Scholar) alongside Reddit/stores |

---

## Product tiers

### Free — open-source CLI (what we have)

- All 20 sources
- Claude Code MCP integration  
- Full semantic enrichment via any LLM provider (or Claude-in-MCP)
- Local HTML viewer
- Citation-rich markdown reports
- No IP rate-limit issues (user's own IP)

**Goal:** Get devs to adopt. Cheap marketing, validates demand. Github stars = organic growth loop.

### Desktop Pro — $49 one-time (the monetization MVP)

Everything in Free, plus:

- **Polished Flutter Desktop UI** (macOS + Windows + Linux, your existing skill)
- **Scheduled re-runs** (weekly) — see how OpenReply maps evolve  
- **Public openreply-map hosting** at `openreply.io/u/<user>/<slug>` (SEO-indexed, shareable)
- **Export formats**: PDF, Notion, Linear, JSON
- **Multi-topic dashboard** — side-by-side graphs
- **Auto-updates** via Sparkle/WinSparkle
- **License + priority support**

**Reasoning on $49**: 
- One-time removes sub friction
- Matches Setapp-tier pricing ($9.99/mo = ~$50 LTV at 5 months avg)
- Gumroad takes 10% = $44 net/sale
- Breakeven at 5 sales/month for our $10-20/mo infra

### Team / Hosted — $99/mo/workspace (future)

- Hosted LLM calls (we pay for Claude)
- Shared workspaces  
- Slack/Discord integrations
- Webhooks for "new trend detected"
- API access

**Reasoning**: Add when Desktop Pro hits 100+ users. Serves teams/agencies who don't want the BYO-key friction.

---

## Go-to-market

### Launch order

1. **Day 0-14**: Ship Flutter Desktop MVP + Gumroad checkout + landing page at `openreply.io`
2. **Day 14**: Public openreply-maps for 3 trendy markets (AI coding, note-taking apps, habit trackers) — each tweet-driven
3. **Day 21**: Product Hunt launch  
4. **Day 30**: HN "Show HN" post with the ATS OpenReply map as proof artifact
5. **Day 45**: Indie Hackers weekly thread (interview request)
6. **Day 60**: First $1k MRR check (20 lifetime sales = $980)

### Content / distribution

- **Weekly "OpenReply of X" tweet thread** — uses our tool, drives brand
- **Public gallery** at `openreply.io/explore` — SEO moat, each published map a landing page
- **Free report generator** (email-gated) — drives list
- **Open-source CLI on Github with live demo** — dev credibility

### Risks & mitigations

| Risk | Mitigation |
|---|---|
| Reddit IP-blocks our scraping | Local-first → user's IP, no shared ceiling |
| LLM cost explodes | BYO key default, hosted tier only for Pro+ |
| "Just another Reddit scraper" | Differentiation = graph + temporal + multi-source citations |
| Slow growth (desktop app, no SEO loop initially) | Public openreply-map gallery *is* the SEO loop |
| Legal: scraping Reddit/App Store at scale | All done on user's machine per their ToS obligations, not ours |

---

## Build plan — what to add next to the tool itself

Derived from the product research map tier-2 competitors expose:

### Missing features (ordered by pain → effort)

1. **Semantic near-duplicate clustering** — `sentence-transformers` merges "paywalled features" variants into one painpoint. **30 LOC, huge UX win.**
2. **Diff-two-corpora mode** — run collect today + last month → show new/fading painpoints. Temporal classification *across runs*.
3. **Embedding-based topic discovery** — auto-find painpoint themes instead of hardcoding 4 YAML prompts.
4. **Citation extraction for specific products** — "show me ALL complaints about Streaks across all sources."
5. **"Why is this CHRONIC?" tooltip** — expose the temporal math explicitly in the viewer.
6. **Email/Notion/PDF export** — premium feature gating.
7. **Scheduled runs with email digest** — weekly "here's what changed in your markets."
8. **Team shared workspace** — collaborate on annotations.
9. **Hosted public gallery at openreply.io** — each user's published maps are SEO + social proof.

### Missing sources (ordered by value)

1. **Podcast transcripts** (Listennotes API / Podcast Index) — richer pain-quote source than Reddit for B2B
2. **YouTube comments** (already stubbed, needs YOUTUBE_API_KEY integration)
3. **Substack / Beehiiv** — creator-economy pain
4. **Amazon reviews** (via RainforestAPI paid tier) — physical product pain
5. **ProductHunt launch-day comments** (already stubbed)
6. **LinkedIn posts** — gated but available via Playwright (fragile)

---

## The honest TL;DR for you

**You can sell this at $49 tomorrow.** The ATS artifact is the demonstration. But:

1. The viewer still needs ~1 week of UX polish (currently functional, not *beautiful*)
2. Flutter Desktop scaffolding: 2 weeks
3. Gumroad + landing page + domain: 3 days
4. First-launch content (3 public OpenReply maps) — done in this repo already on habit-tracker + ATS, needs a third

**Total to revenue: 3-4 weeks of focused work.**

The biggest risk isn't technical — it's marketing. You have the Flutter chops; what's missing is audience (Twitter / IndieHackers / HN presence). Start building *that* in parallel with the desktop app.

---

## Recommended next 3 moves

1. **Confirm the ATS artifact is good enough** (open `data-validate-ats-resume-and-job-search-apps/openreply-map.html` and `report-pro.md`). If yes, you have a demo asset.
2. **Rerun the meta-research** with query `"product research tools Dovetail Condens Notably"` for a narrower corpus that actually validates this roadmap.
3. **Start Flutter Desktop scaffolding** — the shape is:
   - `app/lib/main.dart` — Flutter Desktop entry
   - `app/lib/services/cli_process.dart` — spawn PyInstaller-bundled reddit-cli as subprocess, talk via stdin/stdout JSON
   - `app/lib/screens/topic_list.dart` — topic dashboard
   - `app/lib/screens/openreply_map.dart` — embed the existing HTML viewer via `webview_flutter`
   - Gumroad-style license validation in settings

If you want me to scaffold that Flutter app, say so and I'll build the skeleton. Otherwise my read is: the CLI is ready to monetize as-is, the desktop app is the wrapper that unlocks non-technical buyers.
