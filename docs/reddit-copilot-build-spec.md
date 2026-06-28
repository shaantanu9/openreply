# Reddit Marketing Co-Pilot — Open-Source Build Spec

> **For:** AI IDE (Cursor / Claude Code / Windsurf)
> **Goal:** Build an open-source Reddit marketing co-pilot in the spirit of ReplyDaddy / Reppit AI / Redreach.
> **Stack:** Flutter (client) + Supabase (Postgres, Edge Functions, Realtime, Vault, pg_cron).
> **Core philosophy (non-negotiable):** **Discover → Score → Draft → human posts manually.** No auto-posting, no account linking, no auto-DMs. This is the single most important product decision — it is what keeps users' Reddit accounts safe and is the category's main moat.

---

## 0. One-paragraph product definition

A tool where a founder enters their website URL, the app builds a brand + persona profile, auto-discovers relevant subreddits and keywords, then runs scheduled scans of Reddit to surface high-intent conversations scored 0–100. For each scored opportunity it drafts a context-aware, rule-compliant reply that the user reviews, edits, and **posts manually from their own account**. The user tracks each opportunity as replied / pending / rejected so they never engage the same thread twice.

---

## 1. Competitive teardown — features, logic, and winning point of each platform

Each entry lists: **what it does**, **how the logic works**, **its winning point**, and **what to steal**.

### 1.1 ReplyDaddy (the primary reference)
- **Features:** website→brand-knowledge discovery; auto subreddit discovery; auto keyword targeting via trend analysis; multi-factor opportunity scoring; persona-aware reply drafts; "ban-proof" post creator that reads subreddit rules; project-based org; daily scan limits + rate limiting; bulk subreddit/keyword management; custom response prompts; usage tracking; real-time dashboard; local data control. Sold lifetime-deal + **BYOK** (you bring your own OpenAI/Anthropic key, defaults to Claude Sonnet).
- **Logic:** scan Reddit hot/rising/new for keyword matches → multi-factor relevance scoring → generate reply that follows subreddit rules → user posts manually.
- **Winning point:** account safety positioning + BYOK keeps their infra cost near zero. Project-based org for agencies.
- **Steal:** the whole pipeline shape, the brand-from-URL onboarding, BYOK as the default cost model, subreddit-rule compliance step.
- **Avoid:** BYOK with no budget cap is the #1 user complaint (unpredictable API bill). Add a cost meter + caps.

### 1.2 Reppit AI (the strongest competitor)
- **Features:** URL→auto keyword + subreddit discovery (no keyword caps); **0–100 buying-intent scoring** (not just relevance); context-aware per-thread reply drafts; daily prospect feed; replied/pending/rejected tracking; all-AI-cost-included pricing (no BYOK).
- **Logic:** "Enter URL → AI analyzes niche → auto-discovers subreddits + keywords → daily scan → every post scored 0–100 by *buying intent* (is this person ready to act, vs. just discussing the topic) → high-intent posts float to top → AI drafts contextual comment → user personalizes and posts." ~20 min/day workflow.
- **Winning point:** **intent scoring, not relevance scoring.** A post can be 100% on-topic with zero purchase intent (e.g. an educational discussion). Scoring specifically for buying signals is the headline differentiator. Flat pricing (no surprise API bill) is the second.
- **Steal:** make the score *intent*, not topical match. Numerical 0–100, sortable. Bundled-cost option alongside BYOK.

### 1.3 Redreach
- **Features:** relevance-filtered opportunity feed; AI reply suggestions (manual post); **brand + competitor mention tracking** with sentiment; reply tracking/management (mark replied/rejected); **Google-rank tracking** of your posted replies (SEO double-dip); DM outreach (browser extension).
- **Logic:** discover threads (esp. ones that rank on Google's first page) → suggest replies → track which of your replies later rank in Google so you double-dip acquisition + SEO.
- **Winning point:** **SEO/GEO angle** — surfaces and prioritizes threads that rank in Google, then tracks your replies' rankings. Reddit content is heavily indexed by Google and ingested by LLMs.
- **Steal:** competitor-mention tracking + sentiment; rank-tracking of your own replies. **Skip the DM automation** — it's the ban-risk feature.

### 1.4 ReplyGuy
- **Features:** AI reply suggestions for Reddit **and Twitter/X**; cheapest entry; some tiers auto-post.
- **Logic:** keyword scan across Reddit + X → draft → (cheap tiers) auto-post.
- **Winning point:** lowest price, multi-platform, high volume.
- **Steal:** multi-platform adapter idea + cheap entry tier. **Avoid:** auto-posting (gets flagged/deleted/banned).

### 1.5 ReplyAgent / Engain / CrowdReply / Replymer (managed-account services)
- **Features:** post comments through *their* pool of managed accounts; per-comment credits or flat monthly; Reddit + X.
- **Logic:** their accounts post on your behalf → you pay per successful comment.
- **Winning point:** fully hands-off; your own account never at risk.
- **Steal:** essentially nothing for an open-source self-host tool. **Avoid:** managed accounts don't build *your* karma/credibility; profiles look generic; cost scales badly. This is the anti-pattern your product positions against.

### 1.6 Popsy AI / Leadverse (cold-DM lead-gen)
- **Features:** lead discovery; **cold DM generation + autopilot outreach**; writing-style training; competitor activity tracking; analytics (which subreddits/keywords convert, DM reply rate); email/Slack alerts. Leadverse covers Reddit + X + LinkedIn.
- **Logic:** find lead → generate personalized DM → send (autopilot optional).
- **Winning point:** competitor-activity tracking (Leadverse) is genuinely useful; multi-platform.
- **Steal:** competitor-tracking + analytics dashboard; multi-platform later. **Avoid:** cold DMs are the single riskiest Reddit action (mass-messaging detection → suspension). Public comments reach the whole thread; DMs reach one person and build nothing visible.

### 1.7 F5Bot (free baseline)
- **Features:** free keyword email alerts for Reddit + Hacker News. Monitoring only.
- **Winning point:** free, simple, open. The floor every paid tool must beat.
- **Steal:** the dead-simple keyword→alert loop as a free tier hook.

### 1.8 Syften / Brand24 / Mention (monitoring)
- **Features:** keyword monitoring across 20+ platforms; sub-minute alerts; sentiment; multi-platform social listening.
- **Winning point:** breadth + speed of alerts.
- **Steal:** sub-minute alerting and multi-platform monitoring as a later expansion.

### 1.9 OGTool (the "Swiss-army" GEO play)
- **Features:** **AI-visibility tracking** (is your brand cited/ranked in ChatGPT answers?); Reddit monitoring + posting via AI personas; LinkedIn content gen; blog hosting; SEO tracking; "smart tasks" that recommend content with an impact score; multi-persona reply generation; competitor AI-visibility comparison.
- **Winning point:** **GEO** — tracking and influencing whether your brand shows up in AI/LLM answers, which Reddit content strongly feeds.
- **Steal:** GEO framing — "we help you show up in AI answers, not just Google." Strong for indie/SaaS positioning. **Note:** they auto-post via personas (ban risk) — don't copy that part.

---

## 2. Consolidated feature matrix (what to build)

| # | Feature | Source(s) | MVP? | Notes / logic |
|---|---------|-----------|------|---------------|
| F1 | Brand profile from URL | ReplyDaddy, Reppit | ✅ | Scrape site → LLM summarizes product, voice, value props, ICP |
| F2 | Persona builder | ReplyDaddy | ✅ | User adds background/expertise → injected into reply prompt |
| F3 | Auto subreddit discovery | ReplyDaddy, Reppit | ✅ | LLM from brand profile → candidate subs → validate they exist + are active |
| F4 | Auto keyword discovery (no caps) | Reppit | ✅ | LLM generates many phrasings of the buyer's problem |
| F5 | Scheduled scan (hot/rising/new + search) | ReplyDaddy | ✅ | pg_cron → Edge Function → Reddit read API |
| F6 | **0–100 buying-intent scoring** | Reppit | ✅ | LLM classifies intent, not just topic match. THE differentiator |
| F7 | Context-aware reply draft | all | ✅ | LLM uses thread + brand + persona; value-first, 1 product mention max |
| F8 | Subreddit-rule compliance check | ReplyDaddy | ✅ | Fetch rules; flag risky drafts before showing |
| F9 | Opportunity tracking (replied/pending/rejected) | Reppit, Redreach | ✅ | Never engage same thread twice |
| F10 | BYOK + cost meter + budget cap | ReplyDaddy (+fix) | ✅ | Encrypt key in Vault; show running token cost; hard cap |
| F11 | Project-based org | ReplyDaddy | ✅ | Multi-project for agencies / multiple products |
| F12 | Daily scan limits + rate limiting | ReplyDaddy | ✅ | Respect Reddit rate limits; configurable cadence |
| F13 | Realtime dashboard feed | ReplyDaddy | ✅ | Supabase Realtime → live feed in Flutter |
| F14 | Brand + competitor mention tracking + sentiment | Redreach, Leadverse | 🔜 | Same scan loop, different keyword set + sentiment label |
| F15 | Google-rank tracking of posted replies | Redreach | 🔜 | Track which of your replies rank; needs SERP source |
| F16 | GEO / AI-visibility tracking | OGTool | 🔜 | Query LLMs for your brand; track citation share |
| F17 | Multi-platform adapters (X, LinkedIn, HN) | ReplyGuy, Leadverse, Syften | 🔜 | Engine is platform-agnostic; Reddit is adapter #1 |
| F18 | Analytics (best subs/keywords, conversion) | Leadverse | 🔜 | Aggregate from tracking data |
| F19 | Free keyword-alert tier | F5Bot | 🔜 | Acquisition hook: email/Slack alerts only |

---

## 3. The winning points to actually win on (positioning)

1. **Intent over relevance.** Score buying intent 0–100, not topical match. This is Reppit's headline edge — replicate it.
2. **Account safety by design.** Manual posting only. No auto-post, no auto-DM, no managed accounts. Market this loudly; it's why GummySearch-era users trust manual tools.
3. **Predictable cost.** BYOK *with* a live cost meter and hard budget cap — fixes ReplyDaddy's biggest complaint while keeping your hosting cost near zero.
4. **Own your reputation.** User posts from their own account → builds real karma/CQS that compounds. Position against managed-account services.
5. **SEO + GEO.** Reddit threads rank on Google and feed LLM answers. Prioritize threads that already rank, and (later) track AI-citation share.
6. **Open-source + self-host.** Your actual moat vs. all of them: full self-host, own your data, swap the LLM, no lock-in.

---

## 4. Architecture (Flutter + Supabase)

```
┌─────────────────────────────────────────────────────────────┐
│ Flutter app (mobile + web)                                    │
│  • Onboarding wizard (URL → brand → persona)                  │
│  • Daily opportunity feed (sorted by intent score)            │
│  • Draft review/edit + copy-to-clipboard ("Open in Reddit")   │
│  • Track replied/pending/rejected   • Cost meter & caps        │
│  • Supabase Realtime subscription on `opportunities`          │
└───────────────┬───────────────────────────────────────────────┘
                │ supabase-flutter (auth, db, realtime, RPC)
┌───────────────▼───────────────────────────────────────────────┐
│ Supabase                                                       │
│  Postgres + RLS  │  Vault (encrypted BYOK keys)                │
│  pg_cron + pg_net → triggers Edge Functions on schedule        │
│  Edge Functions (Deno/TS):                                     │
│    • analyze-site        (F1/F2)                               │
│    • discover-targets    (F3/F4)                               │
│    • scan-reddit         (F5)  ← cron-driven                   │
│    • score-opportunity   (F6)                                  │
│    • generate-draft      (F7/F8)                               │
└───────────────┬───────────────────────────────────────────────┘
                │ external calls
        ┌───────▼────────┐   ┌──────────────────┐
        │ Reddit read API │   │ LLM (BYOK:        │
        │ (OAuth read-only│   │ Anthropic/OpenAI) │
        │  public data)   │   └──────────────────┘
        └─────────────────┘
```

### Pipeline (one scan cycle)
1. `pg_cron` fires per project on its cadence → `pg_net` POSTs to `scan-reddit`.
2. `scan-reddit`: for each tracked subreddit, pull new/hot/rising + keyword search; dedupe against existing `opportunities`; insert new rows with `status='new'`.
3. For each new opportunity → `score-opportunity`: LLM returns `intent_score` (0–100) + reason. Cheap model for scoring.
4. For opportunities above threshold → `generate-draft`: LLM writes value-first reply using brand + persona + thread + subreddit rules; run F8 compliance check; store in `drafts`.
5. Realtime pushes new scored opportunities to the Flutter feed.
6. User reviews, edits, copies, posts on Reddit themselves, marks `replied`.

---

## 5. Database schema (Postgres / Supabase)

```sql
-- All tables RLS-protected by auth.uid() via projects.owner_id

create table projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users not null,
  name text not null,
  website_url text,
  scan_cadence interval default '24 hours',
  daily_scan_cap int default 10,
  monthly_token_budget_usd numeric default 20,   -- F10 cost cap
  tokens_spent_usd numeric default 0,
  created_at timestamptz default now()
);

create table brand_profiles (             -- F1
  project_id uuid primary key references projects on delete cascade,
  summary text, value_props text, target_customer text,
  tone text, raw_site_text text, updated_at timestamptz default now()
);

create table personas (                   -- F2
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects on delete cascade,
  name text, background text, expertise text, voice_notes text
);

create table subreddits (                 -- F3
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects on delete cascade,
  name text not null,            -- e.g. "r/SaaS"
  is_banned_for_promo boolean default false,
  rules_json jsonb,              -- F8 cached subreddit rules
  active boolean default true
);

create table keywords (                   -- F4
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects on delete cascade,
  phrase text not null, active boolean default true
);

create table opportunities (              -- F5/F6/F9
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects on delete cascade,
  reddit_post_id text not null,
  subreddit text, title text, body text, url text,
  author text, posted_at timestamptz, fetched_at timestamptz default now(),
  intent_score int,             -- 0-100  F6
  intent_reason text,
  matched_keyword text,
  status text default 'new'     -- new | drafted | replied | rejected
    check (status in ('new','drafted','replied','rejected')),
  unique (project_id, reddit_post_id)   -- F9 dedupe
);

create table drafts (                     -- F7/F8
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid references opportunities on delete cascade,
  persona_id uuid references personas,
  body text, compliance_flags jsonb, model text,
  token_cost_usd numeric, created_at timestamptz default now()
);

create table mentions (                   -- F14 (phase 2)
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects on delete cascade,
  kind text check (kind in ('brand','competitor')),
  term text, reddit_post_id text, sentiment text, found_at timestamptz default now()
);

create table scans (                      -- F12 audit / rate limiting
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects on delete cascade,
  started_at timestamptz default now(), finished_at timestamptz,
  posts_found int, opportunities_created int, status text
);

-- BYOK keys go in Supabase Vault, NOT a plain table:
-- vault.create_secret(<api_key>, 'llm_key_'||project_id)
```

Add RLS policies so every table is filtered by the owning user via `projects.owner_id = auth.uid()`.

---

## 6. Edge Functions (signatures + responsibilities)

```ts
// analyze-site (F1/F2): {projectId, url} -> fetch+strip HTML -> LLM ->
//   upsert brand_profiles. Keep raw_site_text for re-prompting.

// discover-targets (F3/F4): {projectId} -> LLM from brand_profile ->
//   candidate subreddits + keywords -> validate subs exist via Reddit API ->
//   insert subreddits + keywords (dedup).

// scan-reddit (F5/F12): {projectId} (cron-invoked) ->
//   check daily_scan_cap & budget -> for each subreddit: GET new/hot/rising +
//   keyword search -> dedupe on reddit_post_id -> insert opportunities(status='new') ->
//   enqueue scoring. Respect Reddit rate limits (see §7).

// score-opportunity (F6): {opportunityId} -> LLM intent classifier ->
//   intent_score 0-100 + reason. Use a cheap model. Increment tokens_spent_usd.

// generate-draft (F7/F8): {opportunityId, personaId} ->
//   build prompt(brand + persona + thread + subreddit rules) -> LLM draft ->
//   compliance check vs rules_json -> insert drafts -> set opportunity.status='drafted'.
```

### Intent-scoring prompt (the core IP — F6)
```
You score how ready a Reddit poster is to ADOPT/BUY a solution like the product below.
Distinguish BUYING INTENT from mere topical relevance.
- 90-100: explicitly asking for a tool/recommendation/alternative right now
- 70-89: describing a pain our product solves, open to solutions
- 40-69: discussing the topic, no clear need
- 0-39: off-topic, educational, or just venting
Return JSON: {"intent_score": <int>, "reason": "<one sentence>"}
Product: {{brand_summary}}
Thread title: {{title}}
Thread body: {{body}}
```

### Reply-draft prompt (F7) — guardrails matter
```
Write a Reddit comment that is VALUE-FIRST and human.
Rules: address the specific question; give genuine help before any mention of the
product; mention the product at most ONCE, only if truly relevant; no marketing
voice; no AI-tell formatting (no bullet lists, no bold); match this subreddit's tone;
obey these subreddit rules: {{rules_json}}.
Persona to write as: {{persona.background}} / {{persona.expertise}}
Brand context: {{brand_summary}}
Thread: {{title}} — {{body}}
If the subreddit forbids self-promotion, write a purely helpful reply with NO mention.
```

---

## 7. ⚠️ Reddit API & compliance (read this before building)

- **Biggest risk in the whole project.** GummySearch (140k+ users) shut down Nov 2025 after Reddit denied commercial API access. Plan for Reddit API policy risk: use **OAuth read-only**, register a proper app, set a descriptive User-Agent, stay within rate limits, and cache aggressively to minimize calls.
- **Never** store users' Reddit credentials or post on their behalf. Read public data only. This is both the safety promise and the compliance posture.
- Respect each subreddit's self-promotion rules — that's what F8 enforces.
- Bake in the human-posting etiquette the category teaches: warm up accounts, ~9 helpful interactions per 1 promotional one, value-first. Surface this as in-app guidance, not automation.

---

## 8. Flutter client — screens

1. **Onboarding wizard:** URL input → show generated brand profile (editable) → add persona → review auto-discovered subreddits + keywords (toggle/add) → set cadence + budget cap.
2. **Opportunity feed (home):** list sorted by `intent_score` desc; each card shows score badge, subreddit, title, snippet, matched keyword; filter by status; Realtime updates.
3. **Opportunity detail:** full thread context, intent reason, the AI draft, compliance flags; edit draft; **"Copy & open in Reddit"** button; buttons to mark replied / rejected.
4. **Settings:** BYOK key entry (write to Vault via RPC), live cost meter vs. budget cap, scan cadence, projects switcher.
5. **(Phase 2)** Mentions & competitor tracker; analytics; GEO/AI-visibility panel.

State: Riverpod or Bloc. Data: `supabase-flutter` with a Realtime subscription on `opportunities` filtered by active project.

---

## 9. Build order for the AI IDE

**Phase 0 — skeleton**
1. Supabase project: run the §5 schema + RLS policies.
2. Flutter app scaffold + Supabase auth (email/OAuth).

**Phase 1 — MVP (F1–F13)**
3. `analyze-site` Edge Function + onboarding wizard screen 1.
4. `discover-targets` + review screen for subs/keywords.
5. `scan-reddit` + Reddit OAuth read-only client + `scans` logging + rate limiting.
6. `score-opportunity` with the intent prompt.
7. `generate-draft` with rule-compliance check.
8. pg_cron + pg_net wiring to schedule `scan-reddit` per project.
9. Flutter feed + detail + manual-post flow + status tracking.
10. BYOK via Vault + cost meter + hard budget cap.

**Phase 2 — differentiators (F14–F19)**
11. Brand/competitor mention tracking + sentiment.
12. Google-rank tracking of posted replies (needs a SERP data source).
13. GEO / AI-visibility tracking.
14. Free keyword-alert tier (email/Slack).
15. Multi-platform adapters (X, HN, LinkedIn) behind the same engine.

---

## 10. Guardrails to encode (so the clone stays on the right side)

- **No auto-posting. No auto-DM. No credential capture.** Ever. (Both ethics and ban-safety.)
- Always show the user the draft and require an explicit human action to post.
- Enforce per-project budget caps before any LLM/Reddit call.
- Default reply prompts to value-first, single-mention, no-AI-tell formatting.
- Respect robots/ToS for site analysis; respect Reddit API terms and rate limits.

---

*Notes compiled from public product pages, launch listings, and competitor comparison pages (ReplyDaddy, Reppit AI, Redreach, ReplyGuy, ReplyAgent, Engain, CrowdReply, Replymer, Popsy AI, Leadverse, F5Bot, Syften, OGTool). Features and product logic aren't copyrightable; this spec is an original synthesis for an independent open-source implementation. Don't copy any competitor's source code or proprietary text.*
