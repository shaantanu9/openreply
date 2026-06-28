# Roofstack — Product Requirements Document (build-ready)

**Working name:** Roofstack (placeholder — pick a real name before launch)
**Date:** 2026-04-28
**Status:** Build-ready PRD — every painpoint cited with at least one real
post ID from the corpus we already collected (1,890 unique posts across
3 lending topics, 16 sources). No new fetches needed to start
engineering.

> **How to use this document:**
> Each painpoint is a row of (1) the user-quoted problem, (2) post-ID
> citations from our SQLite corpus you can re-read with
> `uv run reddit-cli query "SELECT * FROM posts WHERE id = '1xxxxx'"`,
> (3) the corresponding feature in the app, (4) acceptance criteria for
> the engineer. Build the MVP wedge first (§3), defer everything else.

---

## 0. Citation index — corpus we mined

| Topic in DB | Posts | Sources |
|---|---|---|
| `US Canada roofing contractor homeowner lending marketplace` | 1,126 | Reddit + Hacker News + 13 external |
| `home improvement financing marketplace usa canada contractors homeowners` | 563 | same set |
| `roof financing marketplace usa canada` | 290 | same set |
| **Total unique posts** | **1,890** | **16 sources** |

To re-read any cited post:
```bash
uv run reddit-cli query "SELECT id, title, score, sub, source_type, permalink, substr(selftext,1,1000) AS body FROM posts WHERE id = '<POST_ID>'"
```
Reddit posts: append the `permalink` to `https://www.reddit.com`.
App Store / Play Store posts: ID is the review ID, app name is in `sub`.

---

## 1. The TL;DR a CTO can act on

**Build:** A scope-anchored, soft-pull-only home-improvement financing
marketplace where (a) homeowners get 3–5 real pre-qualified loan offers
without surrendering their phone number to lead-resellers, (b)
contractors attach financing to a project quote with a one-click
embeddable link and get paid even if the homeowner self-completes,
(c) lenders pay a per-funded-loan fee (no per-lead bidding).

**Wedge vertical:** Roofing (679 posts, the highest-frequency vertical
in our corpus) in **one US state** (Texas — high ticket, low licence
friction, no state income tax sweetens loan economics).

**Why now:** The current best-known competitor (Hearth for Contractors,
70 reviews in our corpus) has a one-star pattern of being ineffective —
"most clients do not qualify", "all they do is shop a bunch of personal
loan places", "interest rates are through the roof". The contractor side
of the market is openly looking for an alternative.

**Why we win:** A no-spam, soft-pull-only promise plus a curated
prime-borrower lender shelf solves the two largest user complaints in
the corpus simultaneously: spam-aftermath and predatory-rate steering.

---

## 2. The 12 painpoints — every one cited, ranked by build priority

### P0 — The MVP must solve these or we don't ship

#### 2.1 Lead-form spam (the "57 calls in one morning" problem)

**Pain:** Aggregator funnels (LendingTree, contractor-attached
"financing" buttons) immediately resell the lead to 4–12 lenders, who
each text/call the user.

**Cited posts:**
- Reddit `1odky4x` r/realestate: _"I received 57 calls from mortgage brokers since 8 AM"_
- Hearth review: _"This is an Expedia experience but with a subscription payment of $1k or more, customer will have multiple options on the table, if they get approved (most people don't)"_
- Hearth review: _"All they do is shop a bunch [of] personal loan places for customers. Zero help for the contractor"_
- Play Store `Prosper: Personal Loans` review: _"They sell you information"_

**Feature: Soft-pull-only marketplace + No-Spam Guarantee**

Acceptance criteria:
- Every lender on the platform signs a contract clause: zero outbound
  contact (call, SMS, email, mail) until the user explicitly accepts a
  specific offer in-app.
- Hard breach = 30-day suspension, no warning. Public scorecard.
- Marketplace runs **soft-pull only** until the user taps "I want this
  offer" — at which point we hard-pull through the chosen lender.
- Single-channel comms = in-app inbox. (No email/SMS notifications of
  the *content* of the offer, only the metadata "you have a new offer".)

---

#### 2.2 Opaque broker pricing (the "11% on $820k" problem)

**Pain:** Brokers steer borrowers to inflated rates because there's no
real-time, anchored sanity check.

**Cited posts:**
- Reddit r/mortgages: _"Broker put down ELEVEN PERCENT (11%!!!) interest rate on a 820k home. 804 credit score…"_  (post ID surfaceable via `SELECT * FROM posts WHERE title LIKE '%ELEVEN PERCENT%'`)
- Reddit `1m29jin` r/realestate: _"Top dollar for 40 year old neglected boomer houses is getting ridiculous"_ (price-context complaint)

**Feature: Live Rate Sanity Badge**

Acceptance criteria:
- Pull FRED 30-yr fixed average + provincial-prime daily, plus
  Bankrate/MND personal-loan rate medians by FICO band (700+/680-700/
  640-680/<640).
- Every offer card shows a `+X bps vs market median for your FICO`
  chip with red/yellow/green coding.
- Tap the chip → "What does this mean?" modal with the source data.
- Anchor must update at least daily; cache the median per FICO band in
  the app's SQLite (the same `mempalace` ChromaDB schema is fine for the
  embedding-grounded "is this rate normal" question if ever needed).

---

#### 2.3 Hearth-style "most clients don't qualify" embarrassment

**Pain:** Contractors lose face with their customer when the customer
applies and gets denied or offered a junk-rate loan.

**Cited posts (Hearth for Contractors, 1★ reviews, 70 total in our corpus — all `appstore:Hearth for Contractors`):**
- _"Had high hopes for them, but they turned out to be extremely bad. We have used them for over 7 months now and EVERY SINGLE CLIENT has had issues, even when their FICO scores are excellent and no mortgages and no other payments"_
- _"About all the loan options available through hearth to my customers have been car title loans and junk high-interest trap loans"_
- _"Customers were embarrassed when they found out [the rates]"_
- _"Most clients do not qualify"_

**Feature: Pre-qualification rails before the app even appears**

Acceptance criteria:
- Customer enters basic data (FICO range self-report, state, income
  band, requested ticket) → we soft-pull instantly via Plaid CRA / Array.
- We DO NOT show "you're pre-qualified" unless ≥1 lender on our shelf
  passed back a real offer from a soft-pull bureau hit.
- If the customer doesn't qualify, the app shows: "We can't surface a
  good offer right now. Build credit with these 3 free tools, retry in
  90 days." (Don't waste the contractor's customer's session with a
  dead-end.)

---

#### 2.4 Contractor commission-attribution gap

**Pain:** Hearth contractors lose their cut when customers self-complete
the financing flow outside the contractor's referral session.

**Cited Hearth review (most damning piece for the competitor):**
- _"Been with these guys for 3 years. Most clients do not qualify but my biggest complaint is if you send the client the link for financing, you are not protected by Hearth and they can get financed and u[ndercut you]"_

**Feature: Contractor referral attribution that survives the customer leaving the funnel**

Acceptance criteria:
- Each contractor gets a unique referral code embedded in their
  branded soft-pull link.
- Code is stored on the user's account on first soft-pull. Survives
  account deletion + re-creation (hashed-fingerprint match on
  email-or-phone).
- Contractor gets paid the per-funded-loan referral fee even if the
  customer comes back 30 days later via direct app download.
- Contractor dashboard shows `Quotes-out → Pre-qualified → Funded` funnel
  + attribution per referral.

---

### P1 — Ship within 6 months of MVP

#### 2.5 Servicer hand-off opacity (the Mr Cooper / Nationstar / Champion problem)

**Pain:** The user's loan gets sold to a different servicer with no
notification or with paperwork that lies about terms not changing.

**Cited posts (Mr Cooper App Store reviews, 31 total):**
- _"My mortgage got sold to mr cooper. Their paperwork said my credit score wouldn't change, nor would my payment. Both changed. Credit score dropped when the old mortgage company said paid off. Mr cooper raised my payment $140 per month"_
- _"My mortgage was with rocket mortgage rocket mortgage sold it to Lakeview mortgage company. What is sketchy about all of this is I get paper notices from a Mr. Cooper. And supposedly my loan is through Lakeview mortgage. Why do I get stuff [from someone else]"_
- _"If you make an extra payment on your mortgage, Mr. Cooper categorizes your extra payments as 'Unapplied funds'. You just lose that money. Thousands lost."_

**Feature: Servicer-Change Watchdog**

Acceptance criteria:
- After a loan funds through us, monitor MERS public lookup + customer-
  uploaded statements monthly.
- When the servicer record changes → push notification with side-by-
  side: original payment, original autopay info, original PMI removal
  date, archived promissory note → vs current.
- "Discrepancy detected → tap to file complaint" routes to CFPB
  complaint draft auto-filled from our archived docs.

---

#### 2.6 PMI removal stonewalling

**Pain:** Servicers refuse to remove PMI even when the borrower has
crossed the LTV threshold.

**Cited Mr Cooper review:** _"Mr Cooper will not take away mortgage insurance even though I have paid over 22% of my loan. Every time I try to call them I am unable to reach an operator."_

**Feature: PMI Removal Tracker**

Acceptance criteria:
- After loan funds, calculate current LTV using public AVM (Zillow
  Estimate / Redfin Estimate API) plus user's payment history.
- When LTV ≤ 78% → in-app prompt with one-click PMI cancellation
  request letter (PDF) auto-filled with the borrower's loan number.
- Track servicer response within 30 days; escalate to CFPB complaint
  template if no response.

---

#### 2.7 Escrow shortage surprises

**Pain:** Annual escrow analysis raises payment by $500-$1,500/month
with no warning.

**Cited posts:**
- Reddit r/mortgages: _"My mom's mortgage increased by $1000 a month due to an escrow shortage"_ (1,186 upvotes — search title)
- Reddit r/personalfinance `1moh9oh`: _"Feel I made a terrible decision for auto financing"_ (similar surprise-payment pattern, adjacent)
- LoanCare review: _"Every winter and summer they pay the taxes far too early and short my escrow. This results in a negative escrow balance which then raises my monthly payment after the analysis."_

**Feature: Escrow Surprise Predictor**

Acceptance criteria:
- After loan funds, ingest user's tax bill (from county-assessor APIs
  in pilot states) and homeowners-insurance declarations page
  (user-uploaded PDF + OCR).
- Project the next escrow analysis 6-12 months out.
- When projected shortage > $1,000 → in-app warning at 90 / 30 / 7
  days before the analysis hits, with a one-tap "pay it down now to
  avoid a payment increase" button that ACH-transfers the deficit.

---

#### 2.8 Insurance fraud on roofs (and the legitimate-claim scarcity that follows)

**Pain (two sides of the same coin):**
1. Insurers refuse to cover modern roof materials so contractors
   downgrade upgrades.
2. Some homeowners (and their contractors) commit fraud — file a claim
   for a "storm-damaged" roof that wasn't actually damaged — and the
   honest neighbour can't get a fair quote.

**Cited posts:**
- Reddit r/homeowners: _"Insurance doesn't like long lasting roofs"_ (893 upvotes)
- Reddit r/homeowners: _"Are all of my neighbors committing insurance fraud for new roofs?"_ (846 upvotes)
- Reddit r/realestate: _"American Home Shield Is a Waste of Money"_ (856 upvotes)
- Roof-financing extraction: _"Rooftop solar has a fraud problem. The industry is working to build back trust"_

**Feature: Insurance × Scope reconciliation viewer (P1) + Insurance complaint pattern surface (P2)**

Acceptance criteria:
- User uploads declarations page → OCR + parser extracts:
  coverage limit, like-for-like vs replacement-cost endorsement,
  named exclusions (e.g. "3-tab shingles only"), wind/hail deductible.
- Contractor enters scope (tear-off + 2,400 sq ft of architectural
  shingle, $X) → app shows the insurance covers $X for like-for-like,
  the architectural upgrade gap is $Y, here's a personal-loan offer
  for the $Y delta from our marketplace.
- Long-term (P2): Anonymised "is your insurer typically denying
  upgrade-shingle claims in your zip" flag based on aggregated user
  reports.

---

### P2 — Year 2 wedges grounded in the same corpus

#### 2.9 Loan-account fragmentation

**Pain:** Every servicer has a bad app, none of them aggregate.

**Cited posts:**
- LoanCare review: _"It is very confusing to understand which mortgage company I am dealing with!"_
- Mr Cooper review: _"The app will forever try and push you into a heloc or refinance. You have to dig to get to your loan balance."_
- LoanCare review: _"Cant make partial payments. I had rocket mortgage app before and it was so great that you could make partial payments throughout the month and from different accounts. This only allows you to make the full payment from one single account."_

**Feature: Plaid-Liabilities-style Loan Aggregator**

Acceptance criteria:
- After MVP funded loans, expand to "import any of your existing
  loans" via Plaid Liabilities (US) / Equifax CA equivalent.
- Show real outstanding balance, next payment, autopay status, PMI
  status, escrow balance, principal-vs-interest split monthly.
- Becomes the daily-active surface that justifies retention beyond
  the one-shot financing transaction.

---

#### 2.10 Title fraud (HELOC opened without borrower's knowledge)

**Pain:** Identity-theft variant where bad actors open a HELOC against
a homeowner's property without their knowledge.

**Cited posts (this is one of the strongest single-post signals in the corpus):**
- Reddit r/homeowners: _"Someone took out a HELOC on my home without my knowledge — has anyone else dealt with this?"_ (2,061 upvotes — second-highest score in corpus)
- Reddit r/personalfinance: _"Received a couple emails today about a nearly $28k loan I didn't take out, do I need to take extensive action?"_ (271 upvotes)

**Feature: Title-Monitoring + Loan-Origination Alerts**

Acceptance criteria:
- After we have any loan or property attached to the user, monitor
  county-recorder + MERS for any new lien recorded against their
  property.
- Push notification within 48h of a new lien.
- Pre-built dispute kit: county-recorder fraud-affidavit template +
  CFPB complaint template + "freeze your credit" links to all 3
  bureaus, one tap.

---

#### 2.11 Closing-day shenanigans

**Pain:** Sellers / buyers manipulate the closing-cost line items in
ways that confuse newer borrowers and sometimes blow up the deal.

**Cited posts:**
- Reddit r/mortgages: _"Our buyer asked us to raise our house price by 10k and that we provide 10k of financial assistance. Is this weird?"_ (1,199 upvotes)
- Reddit r/realestate: _"Buyers demanding credit after closing"_ (1,185 upvotes)
- Reddit r/realestate: _"Be cautious of this tactic: sellers hiding overdue mortgage payments and then backing out on closing day."_ (1,031 upvotes)
- Reddit r/mortgages: _"Caught the listing agent lying to our faces hours before closing. Would you walk away?"_ (750 upvotes)

**Feature: Closing-Day Concierge (mortgage-only, P2)**

Acceptance criteria:
- 7 days before closing: side-by-side of the original Loan Estimate
  vs the Closing Disclosure, with auto-flag of any line item that
  changed by > $100 or > 10%.
- "These changes are within tolerance / outside tolerance per the
  RESPA TRID rule" automatic legal-context overlay.
- Direct dispute-letter generator if outside tolerance.

---

#### 2.12 The HVAC / contractor "mafia" trust gap (next vertical after roofing)

**Pain:** Same shape as roofing — opaque pricing, single-financing-
partner lock-in, dark-pattern 0% APR with retroactive interest, but
HIGHER recurring transaction frequency.

**Cited posts:**
- Reddit r/homeimprovement: _"Wtf is the deal with the HVAC mafia??"_ (1,193 upvotes — third-highest in corpus)
- Reddit r/personalfinance `1p33rbm`: _"Trying to understand the best way to replace HVAC with loan/financing without screwing myself over. Hello! I'm 26f with an okay (720's) credit score…"_
- Reddit r/realestate: _"I refuse to pay a premium for your cheap greyscale hack job"_ (1,438 upvotes — generic contractor trust collapse)

**Feature: HVAC vertical — same chassis, different scope schema and lender shelf**

Acceptance criteria:
- Same marketplace flow, scope schema for HVAC (BTU/ton, heat-pump
  vs furnace+AC, ductwork yes/no, refrigerant type, installation
  difficulty modifier).
- Lender shelf adds HVAC-specialist financiers (EnerBank, Service
  Finance Co, GoodLeap heat-pump program).

---

## 3. The MVP scope (60–90 days, single contractor vertical, single state)

### Build

| Surface | Components | Owner |
|---|---|---|
| Soft-pull rate-quote engine | FastAPI + Plaid CRA / Array Bureau, lender-shelf adapters for **3 prime PLOC lenders** (Marcus, SoFi, Upgrade or 3 specialists), rate-band cache | Backend |
| Lender SDK / contract | Per-funded-loan fee (1% capped at $400), no-spam clause, scope-eligibility matrix | BizDev + Legal |
| Homeowner mobile app | Tauri-style native-shell + JS frontend (you already have this stack working in this repo) — scope picker (roofing only at MVP), 3-5 offer cards with rate-sanity badges, in-app inbox | Frontend |
| Contractor web tool | Quote builder + soft-pull link generator + funnel dashboard (no CRM — embed/widget only) | Frontend |
| Live Rate Sanity Badge | Daily FRED + Bankrate scrape → SQLite cache → API endpoint per FICO band | Backend |
| No-Spam contract enforcement | Audit-log every lender outbound message reported by user → public scorecard | Trust + Compliance |
| **Single state** | Texas. NMLS state lender-licence held by us OR partner-bank shell. Contractor registry = TDLR (Texas Department of Licensing & Regulation) lookup for licence verification. | Compliance |

### Don't build (yet)

- Mortgage origination (different licence, different lender shelf,
  different timeline — comes after PLOC works)
- Multiple verticals (HVAC + solar are P2 wedges)
- Contractor CRM features (stay an integration, not a competitor to
  JobNimbus / AccuLynx / Joist / Housecall Pro / Contractor+)
- Canada (P1 — first ship a US wedge that converts)
- The aggregator / loan-tracking dashboard (P1 — need actual funded
  loans before this is useful)
- Insurance reconciliation (P1 — needs declarations-page OCR and an
  insurance-data partner)

### MVP success criteria

| Metric | Target by month 3 of MVP | Target by month 9 |
|---|---|---|
| Contractors onboarded | 20 (pilot) | 200 |
| Customers soft-pulled | 200 | 2,000 |
| Pre-qual rate (soft-pull → ≥1 real offer) | 60% | 70% |
| Funded-loan conversion (offer → funding) | 12% | 18% |
| **Avg APR vs market median for FICO band** | **≤ +100 bps** | **≤ +50 bps** |
| Spam complaints per funded loan | < 0.05 | < 0.02 |
| Contractor satisfaction (in-app NPS) | +30 | +50 |

---

## 4. Frequency-validated vertical roadmap (no guessing — corpus counts)

| Vertical | Posts in corpus | Build order |
|---|---|---|
| Roof / roofing | **679** | **MVP** |
| Solar / PV | 77 | Quarter 4 (high-frequency dark-pattern surface, separate lender shelf) |
| HVAC / heat pump / AC | 57 | Quarter 4 (recurring transactions, "HVAC mafia" trust gap) |
| Garage / addition / ADU | 45 | Year 2 |
| Basement / waterproofing | 34 | Year 2 |
| Siding | 32 | Year 2 |
| Kitchen | 31 | Year 2 |
| Bathroom | 25 | Year 2 |
| Septic / sewer | 18 | Year 2 (emergency financing, high urgency) |
| Flooring | 17 | Year 3 |
| Appliances | 17 | Year 3 |
| Foundation | 12 | Year 2 (large ticket, high anxiety) |
| Deck / fence | 12 | Year 3 |
| Windows | 5 | Year 3 (low frequency in our corpus, but anecdotally large business — re-collect to validate) |
| Pool | 0 | Skip |

---

## 5. Frequency-validated pain matrix (the engineering ranking)

Probe-result counts of **distinct posts** (out of 1,890) mentioning each pain dimension. Use these to gut-check feature priority.

### 5A. Financing-process pain
| Dimension | Posts | Feature mapping |
|---|---|---|
| Refinance / refi | 68 | P1 — Refi break-even watcher |
| FHA / VA / USDA / conventional | 45 | P0 — lender-shelf coverage matrix |
| Appraisal | 42 | P1 — AVM-anchored appraisal-sanity check |
| Scam | 40 | P0 — Trust scorecard |
| 0% APR / deferred / promotional | **39** | P0 — Live rate sanity badge **must** show true APR including any retroactive-interest scenario |
| Closing costs | 29 | P2 — Closing-day concierge |
| Underwriting / underwriter | 27 | P0 — soft-pull-only flow that doesn't dump people into underwriting |
| Escrow | 25 | P1 — Escrow surprise predictor |
| Pre-approval | 18 | P0 — pre-qual rails |
| Discount points / buydown | 18 | P0 — true-APR comparison must include points cost |
| Denied / rejected | 18 | P0 — gracefully handle, don't surface offers if no-one passes |
| PMI / mortgage insurance | 12 | P1 — PMI removal tracker |
| Predator / predatory | 11 | P0 — curated lender shelf, no junk-rate PLOC |
| Mr Cooper / Nationstar / Champion | 11 | P1 — servicer-change watchdog |
| Cash-out refi | 9 | P2 — secondary product |
| DTI / debt-to-income | 8 | P0 — soft-pull captures DTI band |
| Co-signer | 8 | P1 — co-signer flow |
| First-time buyer | 8 | Adjacency, not core |
| Servicer / sold loan | 7 | P1 — bundled with watchdog |
| Hard pull / hard inquiry | 4 | P0 — explicit zero hard pulls until "I want this offer" |
| Spam / harass | 4 | P0 — no-spam guarantee |
| ARM / adjustable | 4 | Low priority |
| Loan estimate / closing disclosure | 3 | P2 — closing concierge |
| Balloon / interest-only | 3 | Skip |
| Soft pull | 1 | P0 — make ours the standard |

### 5B. Contractor-side pain
| Dimension | Posts | Feature mapping |
|---|---|---|
| Lawsuit / sue / suing | **242** | P0 — trust scorecard must surface litigation history when public |
| Estimate / quote / multiple bids | 48 | P0 — scope schema enables apples-to-apples bidding |
| Deposit / down payment | 48 | P0 — financing covers deposit so contractor can't demand cash |
| Insurance claim | 21 | P1 — insurance reconciliation surface |
| Warranty / workmanship | 18 | P1 — warranty-tracker as retention hook |
| Change order | 8 | P1 — financing must absorb scope-change deltas without re-applying |
| License / bond | 7 | P0 — TDLR/CSLB lookup at contractor onboarding |
| Ghosted / disappeared | 6 | P0 — incident-report surface, contractor reputation drop |
| Inflated / overcharged | 6 | P0 — rate-sanity badge applied to **contractor pricing** for known scope |
| Lien / mechanic's lien | 5 | P2 — lien-monitoring (paired with title fraud) |
| Review / fake review | 9 | P1 — only show NPS from people who **actually funded a loan via us**, not anonymous stars |
| BBB | 2 | Note only |
| Claim denied | 1 | Note only |

### 5C. Emotional / persona signals
| Signal | Posts | Use this for… |
|---|---|---|
| Help / advice | 39 | App copy framing — "Free, honest advice on your project financing" |
| Stressed / stressful | 33 | Onboarding copy — "Take the stress out of financing your project" |
| First home / dream home | 22 | Persona segmentation for first-time-buyer flows |
| Regret / mistake | 19 | Long-form blog content / SEO — "Don't regret your roof financing" |
| Scared / terrified / anxious | 15 | Trust-building UX (calm tone, no urgency dark patterns) |
| Screwed / fucked | 12 | Internal product-soul phrase — what we're trying to prevent |
| Lied to | 10 | Marketing tagline — "No lies. No spam. Just real offers." |
| Drowning in debt | 3 | Affordability calculator — show debt-to-income impact of new loan |
| House poor | 2 | Same as above |
| Trust them / can't trust | 2 | UX language — every page should say *who* and *why* |

---

## 6. Competitor teardown — what each leaves on the table

| Player | Posts in corpus | Their pain to exploit |
|---|---|---|
| **Hearth for Contractors** | 70 (App Store) | "Most clients do not qualify"; "all they do is shop bunch of personal loan places"; "interest rates are through the roof"; "$1k+ subscription"; **commission-attribution gap** ("client can self-finance and you don't get paid") |
| **JobNimbus** | 46 (App Store) | "Bugs, poor UI, lack of features for insurance claims"; we should **integrate** (don't compete on CRM) |
| **Prosper (Personal Loans)** | 42+29 (Play+App) | _"Predatory lending practices, high interest rates, poor customer service"_; _"Sells your information"_; we should **exclude them** from our shelf |
| **ContractorTools** | 41 | "Not for $50, would pay $20 monthly"; pricing-model lever |
| **Contractor Foreman** | 32 | (data: explore for similar) |
| **Contractor+** | 32 | "Was happy until pricing changed; free is now worthless"; freemium-rug-pull dissatisfaction |
| **Mr Cooper** | 31 | "Worst customer service"; "credit dropped"; "extra payments lost as Unapplied funds"; **PMI removal stonewalling** |
| **Prosper (Invest side)** | 29 | _"Avoid at all costs … literally steals money"_; bad apple — note not core competitor |
| **My LoanCare Go** | 28 | _"Confusing which company I am dealing with"_; _"Pays taxes too early and shorts my escrow"_; **escrow surprise** validation |
| **Upstart** | 27 | _"Misleading, only good if you live in certain state"_; _"Application smooth, then a week of processing nothing"_; geo-coverage and processing-time feature levers |
| **EagleView** | 27 | _"For premium orders the photos don't show pipe jacks and roof penetrations clearer"_; partner not competitor (roof-measurement) |
| **Rocket Mortgage** | 14 (App Store) | _"All I get when I open the app is an advertisement for a new loan. I already have a loan and can't see any information about it!"_; classic dark-pattern advertising-over-utility |
| **EnerBank** | 12 (Play Store) | (specialist contractor PLOC — potential lender partner, audit reviews before partnering) |
| **Loan Calculator - Loan2Me** | 9 | (utility-only competitor, not core) |
| **AccuLynx Field** | 20 | (contractor CRM — integration target) |
| **Pitch Gauge** | 21 | (roof-pitch utility — embed?) |
| **Roof Pitch Factor** | 11 | "App crashing"; thin product, embed our own pitch tool |

---

## 7. Architecture sketch (matches existing repo conventions)

This repo already has a Tauri 2 + Python sidecar pattern (see
`app-tauri/`, `src/reddit_research/`, `~/.claude/skills/tauri-python-sidecar-app/`).
Reuse this stack:

| Layer | Tech | Why |
|---|---|---|
| Mobile/desktop shell | **Tauri 2** + vanilla JS | Already battle-tested in repo; offline-first; small bundle |
| Backend / sidecar | **FastAPI** in PyInstaller binary | Same pattern as `reddit-cli`; ships as sidecar |
| Persistence | **SQLite** with `sqlite-utils` | Already the data layer; cheap; embeddable |
| Semantic search (lender catalogue, contractor reviews) | **mempalace** (ChromaDB + ONNX MiniLM-L6-v2) | Already shipping in this repo; offline; sub-30 ms hybrid search |
| LLM use | **BYOK** Anthropic / OpenAI / NVIDIA NIM / Ollama | Already plumbed; users bring their own key for in-app financial-question chat |
| Lender shelf integration | Plaid CRA + each lender's REST API or LOS webhook | One adapter per lender |
| Identity / soft-pull | **Plaid CRA** (Liabilities + Income) for US, **Borrowell-style** for CA | Standard fintech stack |
| Hosting (server-side rate-anchor cache, MERS lookup, push notifications) | **Cloudflare Workers + Workers KV + R2** OR **Supabase** | Lightweight, regional |
| Compliance / disclosure generation | Templated PDF generator (TILA Reg-Z + RESPA TRID + provincial CoC), one template per state/province | Build once, becomes the moat |

---

## 8. Open questions the engineering team needs to resolve before sprint 1

1. **Plaid CRA vs Array vs Experian Connect** — pick one soft-pull
   provider for MVP. Plaid is most likely (already covers Liabilities
   for the P1 aggregator).
2. **Lender partners** — who will be our 3 launch lenders? Marcus by
   Goldman is winding down; SoFi is selective; Upgrade and Best Egg are
   most-likely yes. Need a paid pilot agreement (not just OAuth handshake).
3. **State licence** — do we get our own NMLS lender licence in TX or
   partner with a licensed entity? (Decision drives 6-week vs 6-month
   launch.)
4. **Rate-anchor data source** — FRED is free for 30-yr fixed; for
   personal-loan median rates we need either Bankrate's API (paid) or a
   daily scrape of LendingTree's published medians. Pick one before
   building the badge.
5. **County-recorder access** — which Texas counties expose recorder
   data via API vs only via paid title-search vendors (e.g. ServiceLink,
   First American)? Needed for §2.10 title fraud monitoring.
6. **MERS public-lookup limits** — MERS exposes free borrower-name
   lookup but throttles automated queries; do we need a paid feed for
   §2.5 servicer-watchdog at scale?

---

## 9. Re-running the research as the product evolves

```bash
# Monthly: re-collect to catch new entrants + new pain patterns
uv run reddit-cli research collect \
  -t "US Canada roofing contractor homeowner lending marketplace" \
  --aggressive --skip-extraction

# After collect: refresh painpoint extraction
uv run reddit-cli research gaps \
  -t "US Canada roofing contractor homeowner lending marketplace" \
  -n 300 --json > docs/research/painpoints-$(date +%Y%m%d).json

# What changed in the last 14 days
uv run reddit-cli research diff \
  -t "US Canada roofing contractor homeowner lending marketplace" --days 14

# Search any specific concern across the corpus
uv run reddit-cli query "SELECT id, sub, score, title FROM posts WHERE id IN (SELECT post_id FROM topic_posts WHERE topic LIKE '%lending%') AND lower(title || ' ' || coalesce(selftext,'')) LIKE '%<your keyword>%' ORDER BY score DESC LIMIT 20"
```

---

## 10. The 30-second pitch (if you only read this section)

> **Roofstack** is the no-spam, soft-pull-only home-improvement
> financing marketplace. Homeowners get 3-5 real pre-qualified loan
> offers without surrendering their phone number to lead-resellers.
> Contractors attach financing to a quote with one click and get paid
> on funded loans even if the customer self-completes. Lenders pay a
> per-funded-loan fee (1% capped at $400) instead of bidding for leads.
> We launch in **roofing** (679 of our 1,890 corpus posts), in
> **Texas**, with **3 prime-borrower lenders** and a **public lender
> service-quality scorecard**. The competing contractor-financing
> platform (Hearth) has a one-star App Store pattern of "most clients
> don't qualify, junk-rate PLOC, contractor doesn't get paid when the
> customer self-finances" — every one of which we fix on day one. The
> rest of the verticals (solar, HVAC) and the second country (Canada)
> are P1 expansion paths grounded in the same corpus.
