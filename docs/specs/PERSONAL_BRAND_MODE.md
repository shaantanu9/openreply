# Personal Brand Mode — Design & Working Spec

> **Status:** Design / pre-MVP working doc. Nothing here is built yet.
> **Date:** 2026-06-30
> **Owner:** Shantanu
> **Goal:** Turn OpenReply (today a *product* social-marketing co-pilot) into a tool
> that can also **manage a person's brand** — show up consistently, join the right
> conversations as *yourself*, track your reputation, and keep one consistent voice.
> **Thesis:** This is ~80% reframing + ~20% net-new features. The engine already does
> the hard parts (multi-source listening, persona agents, opportunity→draft→post,
> content generation, scheduling, delivery). What's missing is a *person-shaped*
> identity model and a few personal-brand-specific surfaces.

---

## 0. TL;DR for future-me

- **Don't fork the app.** Add a **"Personal Brand" mode** that re-skins and re-purposes
  the existing Agent + persona + opportunity + content stack. Same SQLite store, same
  command triangle, same Python core.
- **The one conceptual change that unlocks everything:** today an *Agent* = "a product's
  brand voice that learns from users." For personal brand, an *Agent* = **You** — a person
  with takes, beliefs, expertise, a tone, and a reputation to protect. The persona schema
  (`name, goal, lens, system_prompt`) already supports this; we just add person-shaped
  fields and seed it from *your* writing instead of *users'* posts.
- **Four pillars**, each maps to something that mostly exists:
  1. **Voice/Identity ("You Agent")** → extend `personas` + persona-memory ingest.
  2. **Show up & post consistently** → reuse the §21 content engine + Queue + Automation.
  3. **Join the right conversations** → reuse Opportunities→Inbox, but re-rank for
     *authority-building* not *lead-gen*, and draft in first person.
  4. **Track reputation & mentions** → mostly net-new: a personal listening surface
     (you/your handles/your topics) + sentiment + "what resonated."
- **MVP = pillars 1+2 done well** (a You-Agent that drafts and posts on-voice on a
  schedule). Pillars 3+4 are the "after MVP" layer this doc exists to support.

---

## 1. What already exists (reuse, don't rebuild)

| Capability we need | Already in OpenReply | Where |
|---|---|---|
| Persona/agent that holds a voice & lens | `personas(id,name,goal,lens,system_prompt,color,icon,active)` + memories/conclusions/edges | `src/openreply/persona/store.py:22` (create), `:60` (list), `:92` (update); `persona_tools.py` MCP sub-server mounted at `server.py:3441` |
| Learn a voice from text over time | Persona ingest → distil lessons → cluster into conclusions | `persona/ingest.py:251` (`ingest_persona`), `persona/conclude.py:143` (`synthesize_conclusions`), `persona/chat.py:184` |
| Multi-source listening (20+ platforms) | Reddit/HN/X/Mastodon/Bluesky/Dev.to/SO/PH + 9 international + Connections credential flow | §1.7/§1.8 in `FEATURES.md`; tiered Reddit cascade praw→cookie→proxy→rss |
| Find conversations worth joining | Opportunities discovery: scan → engagement-weighted RRF → ranked cards | `reply/opportunity.py` (`find_opportunities`), `reply/rank.py` (RRF) |
| Draft → edit → approve → post lifecycle | Inbox workspace + versioned drafts + compliance badge | `reply/generate.py` (`save_draft`, `_platform_compliance`), `reply/opportunity.py` lifecycle |
| Publishable content (7 kinds) | post / thread / article / short-script / youtube / follow-up-reply / follow-up-sequence + edit/save/schedule | §21 content engine, Compose + Queue screens, `content_*` command triangle |
| Scheduling + best-effort auto-post + reminder | launchd `schedule-tick` → find/learn/post-due/GEO | `reply/poster.py` (`process_due`, `_autopost`, `_notify`), `cli/main.py schedule-tick` |
| Delivery to the human | Two-way Telegram bot (daily update, opportunities, quick-action buttons) | commits `5111e03`, `b0cea2f`; daemon + bot |
| AI/search visibility tracking | GEO "AI-visibility" checks, throttled daily | `reply/geo.py` (`check_all_if_due`, `due_for_scheduled_check`) |

**Implication:** Pillars 1, 2, and most of 3 are *configuration + reframing* of existing
machinery. Only Pillar 4 (reputation/mention tracking) and the *first-person re-ranking*
of Pillar 3 are materially new.

---

## 2. The core reframing: Brand-as-product → Brand-as-person

### 2.1 Today's mental model (product)
```
Agent ("Acme SaaS")  ── linked personas (niche knowledge) ──▶ finds leads, drafts pitches
        │
        └─ learns from: USERS' posts (what they struggle with / wish for)
        └─ optimizes for: conversions, product fit, lead-gen
        └─ voice: "we / our product solves…"
```

### 2.2 New mental model (person)
```
You-Agent ("Shantanu")  ── facets (topics you're known for) ──▶ finds convos to join, drafts content
        │
        └─ learns from: YOUR writing + saved takes + things you've published
        └─ optimizes for: authority, consistency, reach, reputation
        └─ voice: "I think / in my experience / here's what I've seen…"
```

The schema barely changes. What changes is **what we feed it** and **what we optimize for**.

### 2.3 What "personal brand" actually decomposes into (so we don't hand-wave)
- **Identity** — who you are, what you stand for, the 3–5 topics you want to own, your
  non-negotiables (things you'll never say), your tone.
- **Consistency** — same voice across platforms and across weeks; no "ghost then dump."
- **Authority** — being seen as credible in your topics (right rooms, useful takes).
- **Reputation** — what the world says about you / your name / your work, and sentiment.
- **Reach** — distribution: posting cadence, formats that land, follow-through.

Each pillar below names which of these it serves.

---

## 3. Pillar 1 — Voice / Identity: the "You-Agent"  *(serves Identity, Consistency)*

**Goal:** One agent that *is you* — drafts everything in your voice, knows your takes,
refuses to say things off-brand, and gets more "you" over time.

### 3.1 What exists
- `personas` row with `name/goal/lens/system_prompt` and a learning loop
  (`ingest → memories → conclusions`). Persona chat answers *from its own memories only*
  and cites them (`persona/chat.py:184`). This is exactly the substrate for a voice model.

### 3.2 The gap
- Personas today learn from **other people's** posts filtered by a `lens`. A You-Agent must
  learn from **your** material and hold **person attributes** the schema doesn't have yet
  (tone, audience, pillars/topics, do-not-say list, links/handles, bio).
- No onboarding flow to *seed* a voice from your existing writing.

### 3.3 Design
Add a **person profile** layer on top of the existing persona:

- **New table `brand_profiles`** (one per You-Agent; FK to `personas.id`):
  - `persona_id` (FK), `display_name`, `headline/bio`, `audience` (who you talk to),
  - `pillars` (JSON: 3–5 topics you want to own, each with weight),
  - `tone` (JSON: e.g. {formality, warmth, humor, length-bias, emoji-policy}),
  - `do_say` / `do_not_say` (JSON lists — hard guardrails injected into every prompt),
  - `handles` (JSON: {x, linkedin, github, mastodon, bluesky, site} for self-mention tracking + signature links),
  - `signature_links` (JSON: CTAs to rotate — newsletter, repo, product),
  - `cadence_targets` (JSON: posts/week per platform).
- **Voice seeding (onboarding):** a wizard that ingests *your* corpus —
  paste 5–20 of your best posts/threads/articles, or point at your X/LinkedIn/blog —
  and runs the existing `ingest_persona` path with `source="self"` so the lessons become
  `persona_memories` tagged as *your* style, then `synthesize_conclusions` distils your
  recurring takes into beliefs. Reuse `persona/ingest.py:251` + `persona/conclude.py:143`;
  add a `self`-source ingest variant that extracts **style + stance**, not third-party lessons.
- **Prompt assembly:** every draft prompt = `system_prompt` (persona) + profile tone/pillars
  + top-k voice memories (existing retrieval `reply/knowledge.py retrieve_for_agent`) +
  `do_not_say` guardrail. This guarantees on-voice output everywhere with no per-screen hacks.
- **Voice drift check (post-MVP):** periodically compare new drafts' embeddings against the
  voice-memory centroid; flag "this doesn't sound like you" before it posts.

### 3.4 Files to touch
- `persona/store.py` — add `brand_profiles` CRUD next to persona CRUD.
- `persona/ingest.py` — add `ingest_self(corpus)` (style+stance extraction).
- `reply/knowledge.py` — make `retrieve_for_agent` profile-aware (inject pillars + guardrails).
- New schema in the init path (pre-create `brand_profiles` — see CLAUDE.md "pre-create every table").
- UI: a **Profile / Identity** screen (reuse Agents screen scaffolding in `or/dynamic.js`).

---

## 4. Pillar 2 — Show up & post consistently  *(serves Consistency, Reach)*

**Goal:** Never face the blank page. A steady stream of on-voice posts/threads/articles,
queued and shipped on a schedule, with you approving (or auto-posting where safe).

### 4.1 What exists (almost all of it)
- §21 **content engine**: 7 structured kinds with edit/save/schedule, Compose + Queue screens,
  `content_*` command triangle — already generates publishable content from an Agent's knowledge.
- **Automation**: Settings → Off/Daily/Weekly wires launchd + agent cadence; `schedule-tick`
  does find→learn→post-due→GEO. **Scheduled poster + reminder** already exists
  (`reply/poster.py process_due`); Telegram delivers the nudge.

### 4.2 The gap
- Content is generated from *niche/user* knowledge, not from *your* pillars + a content
  calendar idea-bank.
- No **idea backlog** / **content calendar** concept (today it's reactive: find→draft).
  Personal brand needs a *generative* loop: "given my pillars, propose this week's posts."
- No **repurpose graph** (turn one long-form take into a thread + 3 short posts).

### 4.3 Design
- **Idea backlog table `content_ideas`**: `persona_id`, `pillar`, `hook`, `angle`,
  `status (idea/drafting/queued/posted/parked)`, `source` (manual / mined-from-opportunity /
  LLM-proposed / repurposed-from:content_id). The Automation tick proposes N ideas/week from
  your pillars + trending opportunities, so the Queue is never empty.
- **Content calendar view**: a week/month grid over the existing Queue + `scheduled_at`.
  Per-platform cadence targets (from `brand_profiles.cadence_targets`) drive "you're 2 posts
  behind on LinkedIn this week" nudges via Telegram.
- **Repurpose action**: "expand this into a thread / compress to a short post / make a
  YouTube short script" — these are *already* content kinds; add a one-click fan-out that
  creates linked child content rows.
- **Approval modes** per platform: `manual` (draft → you tap approve) / `auto` (post on
  schedule). Default everything to `manual` for personal brand (reputation risk); auto only
  where you've explicitly opted in and creds exist (`reply/poster.py _autopost` is the hook).

### 4.4 Files to touch
- `reply/generate.py` / content engine — accept `profile` + `pillar` context; add idea-proposal prompt.
- New `content_ideas` table + CRUD; calendar query (group Queue by week/platform).
- `cli/main.py schedule-tick` — add "propose ideas if backlog < target" step.
- UI: **Calendar** screen + "Repurpose" action on content cards (`or/dynamic.js`).

---

## 5. Pillar 3 — Join the right conversations  *(serves Authority, Reach)*

**Goal:** Surface threads where *you* chiming in builds credibility, and draft the reply
in *your* first-person voice — not a product pitch.

### 5.1 What exists
- Full **Opportunities → Inbox** flow: discover → triage (Save/Snooze/Skip) → draft → approve
  → queue/post, with engagement-weighted RRF ranking (`reply/opportunity.py`, `reply/rank.py`).

### 5.2 The gap
- Ranking optimizes for **product fit / lead-gen**, not **authority-building**. For personal
  brand the signal is different: *Is this in one of my pillars? Is the room reputable? Would a
  smart reply here be seen by the right people? Is it a question I can credibly answer?*
- Drafts default to a brand/product register, not first-person personal voice.
- No notion of "rooms I want to be known in" (target subreddits/communities/people to engage).

### 5.3 Design
- **Authority re-rank**: extend RRF with personal-brand signals — pillar-match score,
  community reputation/size, "answerable-by-me" (does it map to a voice belief/conclusion?),
  and freshness. Keep it as an alternate scoring profile, selected by mode, not a fork.
- **First-person draft mode**: drafts use the You-Agent prompt (Pillar 1), insert a
  *credible-experience* framing ("in my experience…"), and **never** hard-pitch. Compliance
  badge extends with a **self-promo guardrail** (don't drop links unless asked / context fits).
- **Target rooms** table `brand_targets`: communities/people/hashtags you want presence in;
  the finder weights opportunities from these higher and tracks your engagement coverage
  ("you haven't shown up in r/X for 3 weeks").
- **Relationship memory (post-MVP)**: remember people you've engaged with (so the agent can
  say "you replied to this person before" — warm, not cold).

### 5.4 Files to touch
- `reply/rank.py` — add `authority` scoring profile (mode-selected).
- `reply/generate.py` — first-person draft template + self-promo compliance rule.
- New `brand_targets` table + coverage query.
- UI: Opportunities screen gains a "Personal" mode toggle + pillar filter chips (reuse existing chip infra).

---

## 6. Pillar 4 — Track reputation & mentions  *(serves Reputation)*  ← most net-new

**Goal:** Know where you / your name / your work get mentioned, the sentiment, and what's
resonating — a personal listening dashboard.

### 6.1 What exists (partial)
- The **fetch/listening layer** across 20+ sources already exists — we can query it for
  *your* handles/name/keywords the same way it queries for a topic.
- **GEO** already tracks AI/search visibility (`reply/geo.py`) — adjacent to "are you
  discoverable."

### 6.2 The gap
- No concept of **"my mentions"** as a first-class, monitored, deduped, sentiment-scored feed.
- No **reputation timeline** (sentiment over time, spikes, who's talking).
- No **alerting** specifically for self-mentions (vs. topic alerts).

### 6.3 Design
- **Mention queries** = saved searches built from `brand_profiles.handles` + display name +
  product/repo names + chosen aliases. Run on the existing fetch cadence.
- **New table `brand_mentions`**: `source`, `url`, `author`, `text`, `matched_handle/term`,
  `sentiment (pos/neu/neg + score)`, `reach_estimate`, `is_self` (you replied), `ts`, dedupe key.
- **Sentiment + classification**: reuse the LLM-analysis path to score sentiment + tag
  (praise / question / criticism / opportunity-to-engage). Criticism/questions can flow
  straight into Pillar 3's Inbox as high-priority opportunities (close the loop).
- **Reputation dashboard**: sentiment-over-time, top mentions, "what resonated" (your posts
  ranked by engagement pulled back from connected platforms), share-of-voice on your pillars.
- **Self-mention alerts** via the existing Telegram delivery + Alerts surface.

### 6.4 Files to touch
- New `brand_mentions` table + ingest job (`reply/mentions.py` — new module mirroring `opportunity.py`).
- Reuse fetch/sources layer for the queries; reuse LLM analyze for sentiment.
- `schedule-tick` — add `mentions_checked` step (throttled like GEO).
- Telegram daemon — add self-mention digest + alert.
- UI: **Reputation** screen (sentiment chart + mention cards + "what resonated").

---

## 7. Data model additions (summary)

All additive; nothing destructive. Pre-create every table in the init path.

| Table | Purpose | Key columns |
|---|---|---|
| `brand_profiles` | Person-shaped identity on top of a persona | `persona_id` (FK), `display_name`, `bio`, `audience`, `pillars` (JSON), `tone` (JSON), `do_say`/`do_not_say` (JSON), `handles` (JSON), `signature_links` (JSON), `cadence_targets` (JSON) |
| `content_ideas` | Generative content backlog / calendar | `persona_id`, `pillar`, `hook`, `angle`, `status`, `source`, `scheduled_at` |
| `brand_targets` | Rooms/people/hashtags to be present in | `persona_id`, `kind` (community/person/hashtag), `ref`, `weight`, `last_engaged_at` |
| `brand_mentions` | Reputation/mention feed | `persona_id`, `source`, `url`, `author`, `text`, `matched_term`, `sentiment`, `reach_estimate`, `is_self`, `ts`, `dedupe_key` |

Reused as-is: `personas`, `persona_memories`, `persona_conclusions`, `persona_edges`,
`reply_opportunities`, `reply_drafts`, content engine tables, GEO tables.

---

## 8. New / changed surfaces (UI)

Re-skin under a **"Personal Brand" mode** (a top-level mode switch or a distinct Agent type),
reusing `or/dynamic.js` screen scaffolding so we don't duplicate state/loaders:

1. **Identity / Profile** — edit pillars, tone, guardrails, handles; run voice seeding. *(new, Pillar 1)*
2. **Calendar** — week/month content grid over Queue + cadence targets. *(new, Pillar 2)*
3. **Compose / Queue** — existing §21 screens, fed by profile + ideas. *(reuse)*
4. **Opportunities (Personal mode)** — authority re-rank + pillar chips. *(reuse + toggle)*
5. **Inbox** — first-person drafts + self-promo compliance. *(reuse)*
6. **Reputation** — sentiment timeline + mentions + "what resonated." *(new, Pillar 4)*
7. **Telegram** — daily update reframed: "your week in brand" (posts shipped, mentions,
   convos to join, what's overdue). *(reuse delivery, new content)*

---

## 9. MVP vs. after-MVP (the line this doc draws)

### MVP (ship first — proves the personal value)
- **Pillar 1 (You-Agent):** `brand_profiles` + voice seeding from your own writing + on-voice
  prompt assembly. *Without this, nothing else feels personal.*
- **Pillar 2 (Show up):** content generation from your pillars + Queue + Daily/Weekly automation
  + Telegram nudge. Manual-approve by default.
- **Minimal Pillar 3:** Opportunities in "Personal mode" with pillar filtering + first-person
  drafts (re-rank can be a simple pillar-match boost at MVP, full authority model later).

**MVP success test:** "I open the app (or Telegram), and every day it hands me 2–3 on-voice
posts to approve and 3 conversations worth joining, and it sounds like me."

### After-MVP (this doc's reason to exist)
- Full **authority re-ranking** + `brand_targets` + coverage nudges (Pillar 3).
- **Reputation/mentions** dashboard + sentiment + self-mention alerts (Pillar 4).
- **Repurpose graph** + content calendar targets + voice-drift detection.
- **Relationship memory**, share-of-voice, "what resonated" analytics.
- **Multi-persona** (e.g., a "founder" you and a "researcher" you) via existing persona edges.

---

## 10. Phased roadmap

| Phase | Scope | Builds on |
|---|---|---|
| **P0 — Profile** | `brand_profiles` table + Identity screen + guardrail injection | `persona/store.py`, `or/dynamic.js` |
| **P1 — Voice** | Self-corpus ingest (`ingest_self`) → voice memories/conclusions | `persona/ingest.py`, `conclude.py` |
| **P2 — Content** | Pillar-driven generation + `content_ideas` backlog + Queue + automation nudge | §21 engine, `schedule-tick` |
| **P3 — Engage** | Personal-mode Opportunities (pillar boost) + first-person drafts + self-promo compliance | `reply/opportunity.py`, `generate.py`, `rank.py` |
| **P4 — Reputation** | `brand_mentions` ingest + sentiment + Reputation screen + Telegram alerts | fetch layer, LLM analyze, Telegram daemon |
| **P5 — Authority+** | Full authority re-rank, `brand_targets`, coverage, repurpose graph, drift check | `rank.py`, analytics |

---

## 11. Risks & guardrails (personal brand is higher-stakes than product)

- **Authenticity / "AI slop" risk.** A personal brand dies if it reads as auto-generated.
  Mitigations: voice seeding from *your real writing*, voice-drift check, **manual-approve by
  default**, and a hard `do_not_say` guardrail. Auto-post is opt-in per platform only.
- **Reputation blast radius.** A bad auto-reply hurts a person more than a product. Keep
  Pillar 3 drafts manual until trust is earned; never hard-pitch; self-promo compliance rule.
- **Platform ToS / spam.** Same rules as product mode — respect rate limits, no astroturfing,
  the existing compliance badge stays. Write APIs remain opt-in (`_autopost` hook).
- **Privacy.** Self-mention tracking pulls your name across the web into local SQLite — keep it
  local-first (it already is), never auto-publish the reputation data.
- **Over-automation.** The point is to *amplify you*, not replace you. Default the loop to
  "propose, you approve."

---

## 12. Open questions (resolve before/during MVP build)

1. **Mode vs. Agent type?** Is "Personal Brand" a global app mode, or just a different *kind*
   of Agent alongside product agents? (Leaning: an Agent type/flag, so you can run both.)
2. **Which platforms first** for personal brand? (X + LinkedIn are the usual personal-brand
   core; Reddit/HN for authority in technical niches.)
3. **Voice seeding input**: paste-corpus only at MVP, or connect-and-pull from your handles?
4. **How many pillars** do you want to commit to? (3–5 is the sweet spot.)
5. **Auto-post appetite**: manual-only forever, or auto for low-risk formats (e.g. scheduled
   evergreen posts) once trust is built?
6. **Single You-Agent or multiple personas** (founder / researcher / engineer)?

---

## 13. Why this is the right call (and what NOT to do)

- **Do** reuse the engine. The reframing is cheap and the payoff is one codebase serving both
  product marketers and individuals — which also matches VISION.md ("personal research
  companion → shared knowledge space").
- **Don't** build a separate "personal" app — you'd re-solve listening, persona learning,
  scheduling, delivery, and compliance from scratch.
- **Don't** let it auto-post personal content by default — the whole value is that it sounds
  like *you* and protects *your* reputation. Amplify, don't impersonate.

---

*Companion docs: `FEATURES.md` (current state), `VISION.md` (north star),
`docs/specs/FLEET_AGENTS_TOPIC_MAP.md` (persona/agent debate layer). Update `FEATURES.md`
as each phase ships.*
