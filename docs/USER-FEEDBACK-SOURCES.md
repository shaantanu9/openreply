# OpenReply — User-Feedback Sources (detailed analysis)

> What every source gives you, how it authenticates, its limits, what it's best
> for, and the gaps. "User feedback" = real people saying what they need, hate,
> or wish existed. OpenReply triangulates it across **four signal tiers** so no
> single platform's blind spots (or outages) skew the picture.
> **Updated:** 2026-06-06.

---

## The four signal tiers

| Tier | What it captures | Why it matters |
|---|---|---|
| **1 · Direct product reviews** | Star ratings + written reviews of *specific products* | Highest intent — users describe exactly what's broken/missing in a thing they paid for |
| **2 · Community discussion** | Threads, questions, rants, "is there a tool that…" | Earliest signal — pain shows up here *before* a product exists to review |
| **3 · Developer feedback** | Bug reports + feature requests on the actual code | Most specific + actionable — verbatim asks, often with repro + upvotes |
| **4 · Demand / context** | News, search-trend curves | Validates whether a pain is *growing* and how big the audience is |

The collect pipeline runs every selected source in its own isolated worker, so
one source 403'ing or timing out **never** breaks a run — the rest keep going.

---

## Tier 1 — Direct product reviews (highest signal)

| Source | Feedback type | Auth | Rate / limit | Reliability | Default |
|---|---|---|---|---|---|
| **App Store** | iOS app reviews (star + text) | none (token auto-scraped from the App Store web app) | per-app, paginated ×20 | High | ✅ on |
| **Google Play** | Android app reviews | none (`google-play-scraper`, pure-Python) | per-app | High | ✅ on |
| **Trustpilot** | Consumer-brand reviews — e-commerce, fintech, services, D2C (**non-app products**) | none | per-brand | Medium-High | ✅ on |
| **Product Hunt** | Launch comments / maker feedback | **needs `PH_TOKEN`** (free dev tier) | GraphQL v2 | Medium (needs token) | ✅ on |
| **Steam** | Game + creative-software reviews (👍/👎 + text) | none | 2-step: storesearch→appreviews | High *(only for Steam titles)* | ◻️ opt-in |

**Use Tier 1 when:** the topic is an existing product category. These reviews
are the most quotable evidence ("the export is broken", "no dark mode") and
carry an explicit sentiment (rating / recommend flag).

**Gotchas:** App Store relies on a scraped bearer token (can break if Apple
changes the web app); Play Store needs the `[sources]` extra installed;
Product Hunt silently returns nothing without `PH_TOKEN`; Steam only matches
games/creative tools, returns `[]` for everything else (harmless).

---

## Tier 2 — Community discussion (earliest, broadest signal)

| Source | Feedback type | Auth | Rate / limit | Reliability | Default |
|---|---|---|---|---|---|
| **Reddit** | The #1 pain-point firehose | **RSS = none** · full JSON = read-only OAuth (`REDDIT_CLIENT_ID`+`SECRET`, 100/min) | RSS ~25/feed; OAuth 100/min | Medium (RSS) / High (OAuth) | ✅ on (RSS) |
| **Hacker News** | "Show HN" feedback, Ask HN, critical comment threads | none (Algolia API) | generous | Very High | ✅ on |
| **Stack Overflow** | Technical pain (how-do-I, why-broken) | none (optional key) | 300/day → 10k with key | Very High | ✅ on |
| **Stack Exchange ×8** | superuser, serverfault, softwareengineering, ux, webmasters, softwarerecs, devops, security | none | shared SE quota | Very High | ✅ on |
| **Lemmy** | Federated Reddit alt — communities by topic | none (per-instance JSON, default lemmy.world) | generous | High | ✅ on |
| **Dev.to** | Developer articles + reactions | none | no full-text search (client-side match) | Medium | ✅ on |
| **Mastodon** | Public posts (per-instance) | none for public read | per-instance | Medium | ◻️ opt-in |
| **Bluesky** | Public posts | **app password** (`BSKY_HANDLE`+`BSKY_APP_PASSWORD`, free/instant) | authed search | High *(with creds)* | ◻️ opt-in |

**Use Tier 2 when:** validating a *new* idea (no product to review yet), or
finding the language users actually use. Reddit + HN + Stack Exchange are the
backbone — all free and reliable.

**Gotchas:** Reddit's `.json` is 403-blocked anonymously (2026) → RSS is the
free path (no scores, ~25/feed); for full JSON create a free Reddit *script*
app and paste the id+secret into Settings → BYOK. Bluesky's anon search is
403'd → an app password restores it. Dev.to has no real search, so broad
non-dev queries return little.

---

## Tier 3 — Developer feedback (most actionable)

| Source | Feedback type | Auth | Rate / limit | Reliability | Default |
|---|---|---|---|---|---|
| **GitHub Issues + Discussions** | Verbatim bug reports + feature requests on real products, often upvoted (👍) | `GITHUB_TOKEN` recommended | 60/h unauth → **5000/h** with token | Very High | ✅ on |
| **GitHub trending** | What devs are adopting/building | optional token | — | High | ✅ on |

**Use Tier 3 when:** the product is open-source or developer-facing. Issues are
the single most specific feedback source — each is a literal "this is broken" /
"please add X" with a reproduction and a vote count. Add a scope-less
`GITHUB_TOKEN` in BYOK to lift the quota.

---

## Tier 4 — Demand / context (validation overlay)

| Source | Feedback type | Auth | Notes | Default |
|---|---|---|---|---|
| **Google News** | Coverage / launches / incidents | none (RSS) | context, not pain | ✅ on |
| **Google Trends** | Search-demand curves over time | none (pytrends) | stored separately (`trend_series`) — answers "is this pain growing?" | ✅ on |
| **RSS bundles + custom feeds** | Blogs, software listings (G2 feed), founder/marketing/design/etc. | none | 15 curated bundles + your own URLs | mixed |

---

## Academic (research-backed gaps, not "feedback" but evidence)

arXiv · PubMed · OpenAlex · Google Scholar · Semantic Scholar · Crossref ·
**Europe PMC** (bio + preprints) · **DBLP** (CS). Used to back a gap with
literature (and the paper full-text pipeline pulls intro+conclusions for chat).

---

## Reliability & gate matrix (at a glance)

| Tier | Free + no-auth + reliable | Free but needs a key/creds | Gated — needs paid scraping |
|---|---|---|---|
| 1 | App Store, Play Store, Trustpilot, Steam | Product Hunt (`PH_TOKEN`) | — |
| 2 | HN, Stack Overflow, Stack Exchange, Lemmy, Reddit-RSS, Mastodon | Reddit full-JSON, Bluesky | — |
| 3 | — | GitHub (token for quota) | — |
| 4 | Google News, Trends, RSS | — | — |

---

## The real gap: B2B SaaS + marketplace reviews (no free API in 2026)

These are *high-value* feedback but have **no free API** — they're behind
Cloudflare/anti-bot and require a **paid scraping provider** (Apify,
WebScrapingAPI, ScrapingBee, Bright Data):

| Source | Feedback type | Why not free |
|---|---|---|
| **G2 · Capterra · GetApp · TrustRadius** | B2B SaaS reviews (the gold standard for software gaps) | Cloudflare-gated; no public API |
| **Amazon reviews** | Consumer-product complaints | Aggressive anti-bot |
| **Glassdoor** | Employer/tooling pain (internal tools) | Login-gated |
| **Twitter/X** | Real-time complaints | API now $100+/mo |
| **AlternativeTo** | "what's the alternative to X" | Cloudflare (built, currently degraded) |

**To add any of these:** wire one scraping provider (one HTTP adapter +
an API key) and they slot into the existing source pipeline. This is the only
way to get G2/Capterra/Amazon reliably — budget required.

---

## Free sources we *could* still add (no budget needed)

- **Lobsters** (lobste.rs) — tech community, JSON listings (search is finicky).
- **Firefox Add-ons (AMO)** — extension reviews via the public addons API.
- **Yelp Fusion** — local-business reviews (free key) — niche.
- **Discourse forums** — many product communities; wired (`run_discourse`), needs a per-forum URL like the custom-RSS pattern.
- **Hacker News "Ask/Show HN"** — already covered via HN.

---

## Usage guide — pick sources by research goal

| Your goal | Turn on |
|---|---|
| **Validate a brand-new idea** (no product yet) | Reddit, HN, Stack Exchange, Lemmy, Google Trends |
| **Find gaps in an existing app** | App Store, Play Store, GitHub Issues, Reddit |
| **B2B SaaS gaps** | GitHub Issues, Stack Exchange, Product Hunt, Trustpilot (+ paid G2/Capterra) |
| **Consumer/D2C product** | Trustpilot, App/Play Store, Reddit (+ paid Amazon) |
| **Games / creative software** | Steam, Reddit, Product Hunt |
| **Research-backed report** | + arXiv, PubMed, OpenAlex, Europe PMC |

---

## Bottom line

**~20 free, reliable user-feedback sources are live today**, spanning all four
signal tiers — Reddit being gated barely matters. The only thing money buys you
is the B2B-review tier (G2/Capterra/Amazon), which has no free path in 2026.
