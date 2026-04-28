# Home-Improvement Lending Marketplace — Deep-Dive Per-Topic Research

**Date:** 2026-04-28
**Status:** Companion to `2026-04-28_us-canada-home-lending-marketplace copy.md` and `2026-04-28_PRD-build-ready.md`. This document drills into **each painpoint, concept, evidence cluster, competitor, and feature** with **direct citations** (Reddit IDs, App Store / Play Store review IDs, GNews IDs, OpenAlex IDs) you can re-pull from the corpus with one query.

**Corpus mined for this document (deduplicated):** 1,890 posts across 16 sources, spanning 6 lending-related topics in the SQLite DB:

| Topic in DB | Posts |
|---|---|
| `US Canada roofing contractor homeowner lending marketplace` | 1,126 |
| `home improvement financing marketplace usa canada contractors homeowners` | 563 |
| `roof financing marketplace usa canada` | 290 |
| `contractor financing GreenSky Hearth Wisetack Synchrony BNPL home improvement` | 110 |
| `Canada HELOC mortgage broker home renovation financing Ontario Quebec BC` | 48 |
| `HELOC home equity line of credit cash out refinance roof renovation` | 15 |

**Top sources by post count (deduplicated, lending-marketplace topic):** GNews 567 · OpenAlex 160 · App Store: Hearth-for-Contractors 110 · r/realestate 106 · r/mortgages 91 · r/homeowners 80 · HN 75 · r/realestateinvesting 56 · App Store: JobNimbus 46 · r/personalfinance 46 · r/homeimprovement 44 · Play Store: Prosper 42 · App Store: ContractorTools 41 · arXiv 37 · GitHub 37 · Scholar 35 · App Store: Contractor+ 32 · Play Store: ContractorForeman 32 · App Store: Mr. Cooper 31 · App Store: Prosper 29 · App Store: My LoanCare Go 28 · App Store: EagleView 27 · App Store: Upstart 27 · App Store: QuoteIQ 24 · Play Store: LoanCashUSA 24 · App Store: Pitch Gauge 21 · App Store: AccuLynx Field 20 · Play Store: Solofunds 19 · Play Store: Canadian Homes 19 · App Store: Ava 14 · App Store: Rocket Mortgage 14 · pubmed 13 · Play Store: EnerBank 12 · App Store: Regions Contractor SalesPro 11 · App Store: Roof Pitch Factor 11.

**To re-read any cited Reddit post:** prepend `https://www.reddit.com/r/<sub>/comments/<id>/` (the `permalink` is in the `posts` table).
**To re-read any App Store or Play Store review:** the ID format is `appstore_<app_id>_<review_id>` or `playstore_<uuid>` — the `sub` column carries the app name.
**Re-query template:**
```sql
SELECT id, title, score, sub, source_type, permalink, substr(selftext,1,1500) AS body
FROM posts WHERE id = '<POST_ID>';
```

---

## Table of contents

1. **The 14 painpoints** — every one with cited evidence, severity, frequency, sources, and the feature it maps to (§1).
2. **Per-competitor teardown** — review distributions (1★ vs 5★), cited 1-star reviews, what they leave on the table (§2).
3. **Industry signal** — actual fintech moves in the last 12 months (Houzz+Figure HELOC, GreenSky+RAFTR, GreenSky+TAMKO, PACE-loan controversy, BNPL late-payment surge), pulled from GNews (§3).
4. **Academic backing** — peer-reviewed work on predatory lending, FinTech discrimination, HELOC adverse-selection, payment-shock at HELOC draw end, neighborhood subprime concentration (§4).
5. **Per-vertical scope schema** — roofing, HVAC, solar — what fields a marketplace must capture for the offer engine to anchor against (§5).
6. **Cross-border Canada surface** — what the corpus says (and doesn't say) about Canadian home-improvement lending (§6).
7. **The build-order matrix** — every feature in §1 + §3 mapped to MVP / P1 / P2 with rationale and dependent integrations (§7).

---

## 1. The 14 painpoints — cited, evidence-grounded, mapped to features

### P0 — Solve in MVP or do not ship

#### 1.1 — Spam aftermath of "lead-form" lenders

**Headline pain:** Aggregator funnels, contractor-attached "financing" buttons, and free loan-shopping apps resell the user's contact details to 4–12 lenders, who all text/call/email simultaneously.

**Severity:** **High** · **Frequency in corpus:** 8+ direct hits across Reddit + Play Store · **Source diversity:** Reddit r/mortgages, Play Store (Prosper, BILS, LoanCashUSA, Solofunds), App Store (Hearth complaints).

**Direct citations:**

| Source | ID | Score | Quote |
|---|---|---|---|
| Reddit r/mortgages | `1odky4x` | 632 ▲ / 175 » | _"I received 57 calls from mortgage brokers since 8 AM. I just locked in at 5.625% yesterday for refinancing a 20 year mortgage (>760 credit score). Paid $299 for closing costs… since 8 AM, I've had 57 calls to my phone from folks trying to swoop in."_ |
| Play Store: Prosper Borrower | `playstore_8349f9d2-…-55bbb0db9150` | 1 ★ | _"this app just does a 2 second loading, says it can't offer anything and then tries to get you to consent to your phone getting blasted with calls by third party loan providers."_ |
| Play Store: Prosper Borrower | `playstore_d6e8b127-…-a51c6caefc84` | 1 ★ | _"The loan I got matched with had an interest rate of 490%! I was going to have to pay them over 2200 for just a 600 loan!"_ |
| Play Store: BILS / Instant Pay Loan | `playstore_305a1f72-…-092d56cdc094` | 1 ★ | _"once you sign up to barrow a loan. immediately phone blows up with over 500 loans saying your approved"_ |
| Play Store: BILS / Instant Pay Loan | `playstore_b6d2795f-…-d65863a4ba81` | 1 ★ | _"Deceiving do not download this app it just sends you to other lenders that send you to other lenders which I'm come to the conclusion that is selling our information"_ |
| Play Store: LoanCashUSA | `playstore_2d29960a-…-dcfa6682d1d9` | 1 ★ | _"I filled out everything and it won't go to next screen to find the lenders. I feel like all my vital info is just out there in limbo."_ |
| App Store: Prosper Personal Loans | `appstore_1506637917_12763541985` | 2 ★ | _"three weeks later I started getting harassed by marketers asking if I was interested in loans. They were calling texting me and also emailing me just spamming all of my inboxes. If you're big I'm protecting your data I would not work with them."_ |

**Concept:** The lead-resale economic model directly creates the spam. Every aggregator that gets paid per-lead-sold has the same incentive structure — Prosper, BILS, LoanCashUSA, LendingTree, HomeAdvisor / Angi all sit here.

**Feature to build (MVP):** **Soft-pull-only marketplace + No-Spam Guarantee**

| Acceptance criterion | Detail |
|---|---|
| Lender contract | Every lender on the platform signs an exclusivity clause: zero outbound contact (call/SMS/email/mail) until the user explicitly accepts a specific offer in-app |
| Single comm channel | All offer-related messaging happens in the in-app inbox; out-of-band notifications carry only "you have a new offer" metadata, never offer content |
| Breach enforcement | Each user-reported breach triggers an automatic 30-day suspension and a public mark on the lender's scorecard (no warning) |
| User trust signal | Marketplace home page carries a counter: "X funded loans, 0 phone numbers sold" |

**Why nobody else does it:** Lead-resale revenue subsidises the consumer side. Killing it requires switching to a per-funded-loan fee model — which means slower revenue ramp but higher retention. This is a **deliberate strategic choice**, not a feature.

---

#### 1.2 — Opaque broker pricing (the "11% on $820k, 804 FICO" problem)

**Headline pain:** Brokers and contractor-financing partners surface rates that are wildly above the market median for the borrower's actual FICO band — borrowers cannot detect this without a comparison anchor.

**Severity:** **High** · **Frequency in corpus:** 4 direct hits + 60 ★1 Hearth complaints calling out "rates through the roof" / "loan shark rates" / "16% with perfect credit" / "APR around 10–12 / loan double" · **Source diversity:** Reddit r/mortgages + Hearth-for-Contractors App Store reviews.

**Direct citations:**

| Source | ID | Score | Quote |
|---|---|---|---|
| Reddit r/mortgages | `1p5pyzt` | 293 ▲ / 167 » | _"Broker put down ELEVEN PERCENT (11%!!!) interest rate on a 820k home. 804 credit score, putting down 25%, 30 year term. Is this a scam of epic portions or am I misinformed?"_ |
| Reddit r/mortgages | `1qw5veu` | 521 ▲ / 66 » | _"My mortgage company just sent me a letter saying because I paid on time good customer etc they will give me a special offer to refinance at 5.99% and get a check for 45k of my current equity… The thing is my current Interest rate is 3%."_ |
| Reddit r/mortgages | `1r8s4st` | 311 ▲ / 48 » | _"Mortgage fraud attempted by mortgage originator. The mortgage originator rep (out of state company) specifically stated the foundation was recently repaired and asked I provide clearance by looking only at a specific repair…"_ |
| App Store: Hearth | `appstore_1383073333_11629102398` | 1 ★ | _"APR crazy high. Around 10-12 costumers apply thru heart financing all costumer Agee that it's too expensive to get a loan with heart for a 7000 loan they have to pay almost double 13000"_ |
| App Store: Hearth | `appstore_1383073333_9809008451` | 2 ★ | _"To date I've had 35 clients apply, only 8 have been qualified. The lowest rate I've seen a client been given is over 16% and the client had perfect credit."_ |
| App Store: Hearth | `appstore_1383073333_6182647950` | 1 ★ | _"Customers basically laugh me out of their home with this app and their 'loan shark' rates. Haven't closed a loan yet."_ |

**Feature to build (MVP):** **Live Rate Sanity Badge (anchored to FRED + per-FICO-band median)**

| Acceptance criterion | Detail |
|---|---|
| Anchor data | Daily pull of FRED 30-yr fixed average + Bankrate / LendingTree-published personal-loan medians by FICO band: 700+, 680–700, 640–680, <640 |
| Per-offer chip | Every offer card shows a `+X bps vs market median for your FICO` chip with red/yellow/green coding (≤+50 green, +50–150 yellow, >+150 red) |
| Source receipts | Tap chip → modal shows the source data, the date the median was computed, and a link to the FRED / Bankrate page |
| Refresh cadence | Anchor must update at least daily; cache median per FICO band in app SQLite |

---

#### 1.3 — Hearth-style "most clients don't qualify" conversion failure

**Headline pain:** A contractor pays for a financing tool, sends customers to it, and most customers either don't qualify at all or only qualify for junk-rate loans the customer would never accept. The contractor loses face with their customer mid-sale.

**Severity:** **High (existential to the contractor)** · **Frequency in corpus:** 60 of 110 Hearth-for-Contractors reviews are 1★, with this exact complaint pattern repeated · **Source diversity:** App Store Hearth-for-Contractors reviews (largest competitor signal in the corpus).

**Direct citations (Hearth for Contractors, all 1★):**

| ID | Quote |
|---|---|
| `appstore_1383073333_12915616345` | _"Total waste of money. Paid a ton of money to have this service so we could offer it to our customers only to find out all they do is shop a bunch personal loan places for customers. Zero help for the contractor that pays them. Every single person we sent an application to went with a cheaper contractor after approved or just took the cash and ran."_ |
| `appstore_1383073333_12793568000` | _"We have used them for over 7 months now and EVERY SINGLE CLIENT has had issues, even when their FICO scores are excellent and no mortgages and no other payments."_ |
| `appstore_1383073333_11370373927` | _"Been with these guys for 3 years. Most clients do not qualify but my biggest complaint is if you send the client the link for financing, you are not protected by Hearth and they can get financed and use another contractor even though they got financing under your company."_ |
| `appstore_1383073333_10997222957` | _"I had this company for 11 months presented the idea of getting financing to every single one of my clients. I did close to $400,000 worth of income every client that applied did not get enough money if they were approved or if they were approved for the amount that they wanted. The APR was ridiculous."_ |
| `appstore_1383073333_11564649017` | _"This is a Expedia experience but with a subscription payment of $1k or more, costumer will have multiple options on the table, if they get approved (most people don't) which someone with no sales experience could tell you : 'costumer with too many options it's a call me back'."_ |
| `appstore_1383073333_9456420552` | _"Please do not get this! Nobody can get qualified and they can only qualify for up to 25% of their annual income. You will never be able to use this to finance a full job"_ |
| `appstore_1383073333_11040020959` | _"About all the loan options available through hearth to my customers have been car title loans and junk high-interest trap loans. This was poorly explained by the person who originated my subscription."_ |

**Feature to build (MVP):** **Pre-qualification rails — never present an offer that doesn't actually exist**

| Acceptance criterion | Detail |
|---|---|
| Soft-pull bureau hit | Customer enters basic data (FICO range self-report, state, income band, requested ticket) → marketplace soft-pulls instantly via Plaid CRA / Array Bureau |
| Real-offer gate | Marketplace does **not** show "you're pre-qualified" until ≥1 lender on the shelf passes back a real offer based on the soft-pull bureau hit |
| Graceful no-offer path | If the customer doesn't qualify: show "We can't surface a good offer right now. Build credit with these 3 free tools, retry in 90 days" — no bait-and-switch to a junk-rate offer |
| Lender shelf curation | Curated prime-borrower lenders only at MVP: Best Egg, Upgrade, SoFi, LightStream — exclude car-title-loan lenders, retroactive-interest BNPL, and any lender with median APR > 18% in our anchor data |

---

#### 1.4 — Contractor commission-attribution gap (Hearth's most-damning weakness)

**Headline pain:** A Hearth contractor sends a client to the financing flow. The client gets approved. The client then **uses a cheaper contractor**, or self-completes the financing. The original contractor — who paid for the Hearth subscription — gets nothing.

**Severity:** **High** · **Frequency in corpus:** Direct quote in `appstore_1383073333_11370373927` + `appstore_1383073333_12915616345` + `appstore_1383073333_11564649017` (3 separate 1★ Hearth reviews) · **Source:** App Store Hearth-for-Contractors.

**Direct citations:**

| ID | Quote |
|---|---|
| `appstore_1383073333_11370373927` | _"if you send the client the link for financing, you are not protected by Hearth and they can get financed and use another contractor even though they got financing under your company"_ |
| `appstore_1383073333_11564649017` | _"You don't have a security to receive the funds: Funds will be send to the client and because is a personal loan they could change their mind at any time or go with another contractor even though they qualify through your company."_ |

**Feature to build (MVP):** **Contractor referral attribution that survives the customer leaving the funnel**

| Acceptance criterion | Detail |
|---|---|
| Unique referral code | Each contractor gets a unique code embedded in their branded soft-pull link (e.g. `roofstack.app/r/austinroofs-tx-7G2`) |
| Persistent attribution | Code is stored on the user's account on first soft-pull; survives account deletion + re-creation via hashed-fingerprint match on email-or-phone |
| Long attribution window | Contractor gets paid the per-funded-loan referral fee even if customer comes back 30 days later via direct app download |
| Funnel transparency | Contractor dashboard shows `Quotes-out → Pre-qualified → Funded` per referral with earned-but-unpaid balance |

---

#### 1.5 — Curated lender shelf (excluding the predators that show up in every aggregator)

**Headline pain:** Every consumer-facing lending aggregator includes Prosper, EnerBank, GreenSky and similar lenders whose own app reviews show predatory APRs and dark patterns. The marketplace's brand can be destroyed by the lenders it lists.

**Severity:** **High** · **Frequency in corpus:** Prosper has 12 of 42 Play Store reviews at 1★ + 4 of 29 App Store reviews at 1★; GreenSky has 6 of 7 Play Store reviews at 1★; EnerBank has 6 of 12 Play Store reviews at 1★.

**Direct citations:**

| Source | ID | Score | Quote |
|---|---|---|---|
| Play Store: Prosper Borrower | `playstore_1d5dc0b0-…-dae90d877d6c` | 1 ★ | _"predator institutions no fall for it. daily charges on interest and even if you make payments monthly of 1,300$ they gorce you pay 60% on interest in each payment, no fail for it no take loans or find a better job this one is predatory be aware."_ |
| App Store: Prosper Personal Loans | `appstore_1506637917_11136915531` | 1 ★ | _"Prosper is a very shady lender! I was looking around for a small loan with best interest rates, they told me the loan would be under 10% which they lied and processed the loan without my permission!… It dinged my credit -13 points!"_ |
| App Store: Prosper Personal Loans | `appstore_1506637917_10520647198` | 1 ★ | _"Rates too high don't take loans from them"_ |
| App Store: Prosper Invest | `appstore_1294834607_12201423609` | 1 ★ | _"This company literally steals money from everyone. The prospectuses are inaccurate copy&paste specials. You'll see charge offs that will after 120 days for AA rated loans and you won't have any tax benefit."_ |
| Play Store: GreenSky | `playstore_acba678b-…-90d4982a5a` | 1 ★ | _"The finance charge is too excessive. Who can pay 25%. Nit a good program for the consumer."_ |
| Play Store: GreenSky | `playstore_e41d3675-…-841c0b50` | 1 ★ | _"Been with Greensky for several years and this app has never worked. The only way I can log in to my account is by clicking the link in my statement emails."_ |
| Play Store: EnerBank | `playstore_aa222655-…-b78ab2729fad` | 1 ★ | _"Useless app, I already have a loan with them, and it wouldn't allow me to go sign in. Only allowed me to get pre qualified and get an estimate"_ |
| App Store: Regions Contractor SalesPro (EnerBank) | `appstore_1146476917_7844102705` | 1 ★ | _"I can't find the balance on our Enerbank loan anywhere. We replaced an HVAC condenser earlier this year and our vendor recommended Enerbank to finance it. I've made regular payments of 1/12 the balance but I receive no statements from them."_ |

**Feature to build (MVP):** **Curated prime-borrower-only lender shelf, with public exclusion list**

| Acceptance criterion | Detail |
|---|---|
| Inclusion criteria | Median APR ≤ 14% for 700+ FICO; full TILA disclosure; no retroactive deferred-interest 0% APR; no daily-compounding consumer products |
| Public exclusion list | Marketplace publishes the lenders it considered and rejected with the reason ("excluded for retroactive interest", "excluded for car-title-loan crossover", etc.) — turns the rejection into a trust signal |
| Continuous re-audit | Quarterly re-audit of every shelf lender's App Store / Play Store reviews; > 30% 1★ rate triggers re-evaluation |

---

### P1 — Ship within 6 months of MVP

#### 1.6 — Servicer hand-off opacity (Mr Cooper / Nationstar / Champion / Lakeview)

**Headline pain:** A borrower's mortgage gets sold to a different servicer with no notification, with paperwork that lies about terms not changing, with the new servicer refusing to honour the original terms.

**Severity:** **High** · **Frequency in corpus:** 31 reviews against `appstore:Mr. Cooper` (5 are 1★), 8 of 28 LoanCare reviews are 1★, plus the Reddit `loan was bought out` post (`1kdy5q8`).

**Direct citations:**

| Source | ID | Score | Quote |
|---|---|---|---|
| Reddit r/mortgages | `1kdy5q8` | 360 ▲ / 163 » | _"My loan was bought out and now they won't honor terms. We bought a house and the loan terms said that we would be able to refinance for free in the first 2 years. However, our loan was immediately sold to another lender and now they say that those terms don't apply."_ |
| App Store: Mr. Cooper | `appstore_1114621467_12642269853` | 1 ★ | _"My mortgage got sold to mr cooper. Their paperwork said my credit score would t change, nor would my payment. Both changed. Credit score dropped when the old mortgage company said paid off. Mr cooper raised my payment $140 per month because of their requirement to hold two months escrow payments"_ |
| App Store: Mr. Cooper | `appstore_1114621467_13572555939` | 1 ★ | _"My mortgage was with rocket mortgage rocket mortgage sold it to Lakeview mortgage company. What is sketchy about all of this is I get paper notices from a Mr. Cooper. And supposedly my loan is through Lakeview mortgage. Why do I get stuff from Mr. Cooper when I hate Mr Cooper."_ |
| App Store: Mr. Cooper | `appstore_1114621467_13209457292` | 1 ★ | _"If you make an extra payment on your mortgage, Mr. Cooper categorizes your extra payments as 'Unapplied funds'. You just lose that money. Thousands lost."_ |
| App Store: My LoanCare Go | `appstore_6467651368_12739283016` | 1 ★ | _"I had switched to LoanCare a few years ago and originally it went thru different names and still to this day it is very confusing to understand which mortgage company I am dealing with!"_ |

**Feature to build (P1):** **Servicer-Change Watchdog**

| Acceptance criterion | Detail |
|---|---|
| Loan attach | After a loan funds through us — or the user imports an existing loan — store the servicer name + paper-statement parser + MERS lookup ID |
| Monthly poll | Cron-based MERS public lookup + monthly statement OCR; trigger on any servicer-name change |
| Side-by-side diff | Push notification with original vs current: payment amount, autopay info, escrow balance, PMI removal date, contact details |
| Archived note | Original promissory note + closing docs are stored encrypted; user can download them as evidence in any dispute |
| CFPB integration | "Discrepancy detected" → tap to file CFPB complaint, auto-filled from archived docs |

---

#### 1.7 — PMI-removal stonewalling

**Headline pain:** The borrower has crossed the 78% LTV automatic-cancellation threshold but the servicer refuses to remove PMI and is unreachable.

**Severity:** **Medium-High** · **Frequency in corpus:** 12 posts mentioning PMI in the lending corpus + the cited Mr Cooper review.

**Direct citation:**

| Source | ID | Score | Quote |
|---|---|---|---|
| App Store: Mr. Cooper | `appstore_1114621467_13678911694` | 1 ★ | _"DO NOT USE! Mr Cooper will not take away mortgage insurance even though I have paid over 22% of my loan. Every time I try to call them I am unable to reach an operator. Use another lender if you can."_ |

**Feature to build (P1):** **PMI Removal Tracker**

| Acceptance criterion | Detail |
|---|---|
| LTV calc | After loan funds, calculate current LTV using public AVM (Zillow / Redfin Estimate API) + user's payment history |
| LTV ≤ 78% trigger | In-app prompt with one-click PMI cancellation request letter (PDF) auto-filled with borrower's loan number + property address + LTV evidence |
| 30-day timer | Track servicer response within 30 days; escalate to CFPB complaint template if no response |

---

#### 1.8 — Escrow shortage payment surprise

**Headline pain:** Annual escrow analysis raises the borrower's monthly payment by $500–$1,500 with no warning, often because the servicer over-paid taxes early.

**Severity:** **High when it happens** · **Frequency in corpus:** Top engagement signal — `1rnj2mi` has 1,186 ▲ / 401 ».

**Direct citations:**

| Source | ID | Score | Quote |
|---|---|---|---|
| Reddit r/mortgages | `1rnj2mi` | 1,186 ▲ / 401 » | _"My mom's mortgage increased by $1000 a month due to an escrow shortage. Is this right? We're in complete shock. There's no way she can afford this. How on earth does a shortage that huge come up? EDIT: Okay, I may have figured it out. Her property tax bill increased nearly five-fold and I believe part of the reason why is that her homestead exemption did not renew."_ |
| App Store: My LoanCare Go | `appstore_6467651368_13511459675` | 1 ★ | _"This company is the worst. Every winter and summer they pay the taxes far too early and short my escrow. This results in a negative escrow balance which then raises my monthly payment after the analysis."_ |

**Feature to build (P1):** **Escrow Surprise Predictor**

| Acceptance criterion | Detail |
|---|---|
| Tax + insurance ingestion | Pull user's tax bill (county-assessor APIs in pilot states) + homeowners-insurance declarations page (user-uploaded PDF + OCR) |
| Forward projection | Project the next escrow analysis 6–12 months out; track homestead-exemption status |
| Tiered alerts | When projected shortage > $1,000 → in-app warning at 90 / 30 / 7 days before the analysis |
| Pay-down button | One-tap "pay it down now to avoid a payment increase" button that ACH-transfers the deficit |

---

#### 1.9 — Insurance dark patterns force roofing scope down

**Headline pain (two sides of the same coin):**
1. Insurers refuse to cover modern roof materials so contractors are forced to downgrade upgrades to like-for-like 3-tab shingles.
2. Some homeowners commit fraud — file claims for "storm-damaged" roofs that weren't damaged — which causes insurance to crack down on all neighbours.

**Severity:** **High** · **Frequency in corpus:** Two of the top 30 Reddit posts in the corpus by score (893 + 846 ▲).

**Direct citations:**

| Source | ID | Score | Quote |
|---|---|---|---|
| Reddit r/homeowners | `1s8mpb1` | 893 ▲ / 498 » | _"Insurance doesn't like long lasting roofs. Why the hell would one buy a roof that could last 50 years when home insurance apparently won't cover your house if your roof is over 20 years old and half the time doesn't like it over 16 years? I only wanted to buy a new roof once, man."_ |
| Reddit r/homeowners | `1o6g2ip` | 846 ▲ / 537 » | _"Are all of my neighbors committing insurance fraud for new roofs? A roofing company has been coming around my neighborhood door to door. Their sales pitch is that they can get you a new roof via insurance by claiming storm damage. We haven't had any significant storms for as long as I've lived here (3 years)."_ |
| Reddit r/realestate | `1nfo8zr` | 856 ▲ / 255 » | _"American Home Shield Is a Waste of Money. I bought the American Home shield platinum home warranty, and after years of paying for it, my air conditioner went out. The cost to replace the unit was $8000… American Home shield charge me $100 to send someone out and then only offered to pay $975"_ |
| Reddit r/homeowners | `1kk7fb6` | 1,093 ▲ / 342 » | _"Using homeowners insurance for it's intended purpose. I have a roof leak from hail damage and am filing a claim. My father is freaking out, telling me I should pay out of pocket"_ |
| Reddit r/homeowners | `1ndefiv` | 312 ▲ / 53 » | _"Should I tell insurance their 'preferred contractor' is banned from local stores? we experienced a house fire recently (in Canada). It was almost a total loss. We found an incredible company… Our insurance is requesting two other companies places bids"_ |

**Feature to build (P1):** **Insurance × Scope reconciliation viewer**

| Acceptance criterion | Detail |
|---|---|
| Declarations OCR | User uploads insurance declarations page → OCR + parser extracts: coverage limit, like-for-like vs replacement-cost endorsement, named exclusions, wind/hail deductible |
| Scope diff | Contractor enters scope (tear-off + 2,400 sq ft of architectural shingle) → app shows insurance pays $X for like-for-like, the upgrade gap is $Y, here's a personal-loan offer for $Y |
| Future P2 — neighbour-fraud signal | Anonymised aggregated user reports: "is your insurer typically denying upgrade-shingle claims in your zip" flag |

---

#### 1.10 — Refinance lies + break-even math

**Headline pain:** Borrowers are sold a refi by the sticker rate, hiding closing costs and points; when they actually run the break-even math, the refi loses money for years.

**Severity:** **High** · **Frequency in corpus:** 68 posts with refi/refinance terminology + the top-engagement r/Mortgages post about "Has anyone else been lied to about refinancing?"

**Direct citations:**

| Source | ID | Score | Quote |
|---|---|---|---|
| Reddit r/mortgages | `1qw5veu` | 521 ▲ / 66 » | _"My mortgage company just sent me a letter saying because I paid on time good customer etc they will give me a special offer to refinance at 5.99% and get a check for 45k of my current equity. And my monthly payment will be the same as it is now. It's a 30 year loan. I'm sure I've paid 3-5 years on this loan already. The thing is my current Interest rate is 3%. Like I'm going to give up 3%"_ |
| Reddit r/mortgages | `1sks2br` | 295 ▲ / 180 » | _"Mortgage Prisoners seem to be back!!! Had 2 clients this week sitting on rates around 5.85% and 5.92% who wanted to refinance to fix 3 years at 6.09%, but both we couldn't help as the last time we got them the loans, the rates were under 5%. Now their loans don't service."_ |
| Reddit r/mortgages | `1so6v60` | 750 ▲ / 366 » | _"Caught the listing agent lying to our faces hours before closing. Would you walk away?"_ |

**Feature to build (P1):** **Refi Break-Even Watchdog**

| Acceptance criterion | Detail |
|---|---|
| Loan attach | Watcher tied to user's existing loan (rate, term remaining, balance, points paid originally) |
| True-APR comparison | Pull live offers daily; compute break-even with **all** closing costs + points; only ping when break-even ≤ 24 months |
| No-call-back format | Notification shows: 3 actual lenders, itemized closing-cost estimates, points cost, true-APR, break-even months — no salesperson contact required |

---

#### 1.11 — 0% APR retroactive-interest dark pattern (BNPL + contractor financing)

**Headline pain:** The user is sold a "0% APR for 24 months" promotion. If the balance is not paid off by the end of the promo period, **all** accrued interest from day one is charged retroactively.

**Severity:** **High** · **Frequency in corpus:** 39 posts mentioning 0% APR / deferred / promotional + GNews `Nearly Half of BNPL Users Have Paid Late in the Past Year`.

**Direct citations:**

| Source | ID | Quote |
|---|---|---|
| GNews | `gnews_6fbdea6a` | _"Nearly Half of BNPL Users Have Paid Late in the Past Year, Up for a Second Straight Year - LendingTree"_ |
| GNews | `gnews_73eca534` | (duplicate) |
| Play Store: Affirm | `playstore_b6a080f5-…-ead103963afd` | 2 ★ — _"be careful with this app it's not credit it's loan and I got more interest than the price of the item I 😅 owe misleading app."_ |

**Feature to build (P0/P1 — must show in MVP):** **True-APR comparison that includes any retroactive-interest scenario**

| Acceptance criterion | Detail |
|---|---|
| True-APR field | Every offer card has two APR fields: `Promo APR` (if any) + `True APR if not paid off by promo end` (the retroactive scenario) |
| Worst-case modal | Tap → shows worst-case total interest if balance not cleared by promo end; default sort is by True-APR worst-case, not promo |
| Lender disclosure | Lender's offer schema must include `retroactive_interest_on_promo_default: bool` — required field, no exceptions |

---

#### 1.12 — Closing-day shenanigans (mortgage origination only)

**Headline pain:** Sellers / buyers manipulate closing-cost line items, hide overdue payments, demand credit after closing, or invent assistance-program work-arounds that look like fraud.

**Severity:** **High when it happens** · **Frequency in corpus:** 4 of the top 50 Reddit posts by score: `1l7r4f2` (1,199 ▲), `1rh9mbw` (1,185 ▲), `1nrg7w1` (1,031 ▲), `1so6v60` (750 ▲), `1o2ipb4` (1,096 ▲).

**Direct citations:**

| Source | ID | Score | Quote |
|---|---|---|---|
| Reddit r/mortgages | `1l7r4f2` | 1,199 ▲ / 563 » | _"Our buyer asked us to raise our house price by 10k and that we provide 10k of financial assistance. Is this weird?"_ |
| Reddit r/realestate | `1rh9mbw` | 1,185 ▲ / 490 » | _"Buyers demanding credit after closing. We sold our home in CO to an offer with no inspection contingency. The contract also had a clause where buyers would get 8k credit from escrow… 2 [months later they're demanding more]"_ |
| Reddit r/realestate | `1nrg7w1` | 1,031 ▲ / 274 » | _"Be cautious of this tactic: sellers hiding overdue mortgage payments and then backing out on closing day."_ |
| Reddit r/realestate | `1o2ipb4` | 1,096 ▲ / 317 » | _"Buyers had contractors in my home before closing"_ |
| Reddit r/realestate | `1muehvg` | 314 ▲ / 280 » | _"Selling agent forgot to tell roofers to add peel and stick. We're 2 days from closing. What is a fair resolution?"_ |
| Reddit r/mortgages | `1qvfeb9` | 50 ▲ / — » | _"(Seller) My Real Estate Agent committed mortgage fraud? Close Friday..."_ |

**Feature to build (P2, mortgage-vertical):** **Closing-Day Concierge**

| Acceptance criterion | Detail |
|---|---|
| LE vs CD diff | 7 days before closing: side-by-side of original Loan Estimate vs Closing Disclosure with auto-flag of any line item that changed by > $100 or > 10% |
| TRID tolerance overlay | Auto-explain: "These changes are within RESPA TRID tolerance / outside tolerance" with regulatory citation |
| Dispute generator | If outside tolerance: one-click letter generator citing 12 CFR 1026.19(f)(2) |

---

#### 1.13 — Title fraud / HELOC opened without borrower's knowledge

**Headline pain:** A bad actor opens a HELOC against a homeowner's property using stolen identity. Borrower discovers it months later, often when refinancing.

**Severity:** **Critical when it happens** · **Frequency in corpus:** Single biggest engagement signal — `1ovg9rh` has 2,061 ▲, the second-highest score in the lending corpus.

**Direct citations:**

| Source | ID | Score | Quote |
|---|---|---|---|
| Reddit r/homeowners | `1ovg9rh` | **2,061 ▲ / 420 »** | _"Someone took out a HELOC on my home without my knowledge — has anyone else dealt with this? I recently discovered that a 50k HELOC was opened against my property without my consent or knowledge. I bought my home in December 2023 and the HELOC was opened January 2024. I was completely unaware of it until I was trying to refinance last week and the title company flagged it. I've already contacted PNC to let them know of this error."_ |

**Feature to build (P2):** **Title-Monitoring + Loan-Origination Alerts**

| Acceptance criterion | Detail |
|---|---|
| County-recorder polling | After any loan or property is attached to the user, monitor county-recorder + MERS for any new lien recorded against their property |
| 48-hour alert | Push notification within 48h of a new lien appearing |
| Pre-built dispute kit | County-recorder fraud-affidavit template + CFPB complaint template + "freeze your credit" links to all 3 bureaus, one tap |

---

#### 1.14 — Loan-account fragmentation

**Headline pain:** Every servicer has a bad app; none of them aggregate; the borrower can't see all their property-related liabilities in one place.

**Severity:** **Medium** · **Frequency in corpus:** LoanCare reviews (8 of 28 are 1★), Mr Cooper push-to-refinance complaint, GreenSky app non-functionality (6 of 7 Play Store reviews are 1★), EnerBank no-existing-loan-view (multiple 1★ reviews).

**Direct citations:**

| Source | ID | Quote |
|---|---|---|
| App Store: Mr. Cooper | `appstore_1114621467_12971534280` | 2 ★ — _"The app will forever try and push you into a heloc or refinance. You have to dig to get to your loan balance. So stupid and shows their greed."_ |
| App Store: My LoanCare Go | `appstore_6467651368_13678513303` | 1 ★ — _"I had rocket mortgage app before and it was so great that you could make partial payments throughout the month and from different accounts. This only allows you to make the full payment from one single account."_ |
| App Store: Rocket Mortgage | `appstore_431156417_13918342445` | 1 ★ — _"All I get when I open the app is an advertisement for a new loan. I already have a loan and I can't see any information about it!"_ |
| Play Store: GreenSky | `playstore_e41d3675-…-841c0b50` | 1 ★ — _"Been with Greensky for several years and this app has never worked. The only way I can log in to my account is by clicking the link in my statement emails."_ |
| Play Store: EnerBank | `playstore_2f2f7231-…-2c08e1dd34` | 1 ★ — _"this app is hot garbage. there is no way to view an existing loan"_ |

**Feature to build (P2):** **Plaid-Liabilities-style Loan Aggregator**

| Acceptance criterion | Detail |
|---|---|
| Plaid Liabilities import | "Import any of your existing loans" via Plaid Liabilities (US) / Equifax CA equivalent |
| Unified dashboard | Real outstanding balance, next payment, autopay status, PMI status, escrow balance, principal-vs-interest split |
| Daily-active surface | Becomes the retention loop justifying daily app open beyond the one-shot financing transaction |

---

## 2. Per-competitor teardown

### Review distribution (the engineering ranking)

Sorted by review count in our corpus. The 1★ rate is the strongest hostility signal — the competitor's own users are telling you what they hate.

| Competitor | Side | Total reviews | Avg ★ | 1★ | 5★ | 1★ rate | Use this for… |
|---|---|---|---|---|---|---|---|
| **Hearth for Contractors** | Contractor financing | 110 | 2.68 | **60** | 45 | **54.5%** | Direct competitor — entire MVP attacks Hearth's failure modes |
| JobNimbus | Roofing CRM | 46 | 4.30 | 2 | 31 | 4.3% | Integration target (not competitor) |
| Prosper Borrower (Play) | Lender | 42 | 3.81 | 12 | 28 | 28.6% | Exclude from shelf |
| ContractorTools | Contractor utility | 41 | 4.71 | 1 | 35 | 2.4% | Pricing-model lever ($50 too expensive) |
| ContractorForeman | Contractor CRM | 32 | 4.81 | 1 | 29 | 3.1% | Integration target |
| Contractor+ | Contractor CRM | 32 | 4.59 | 2 | 27 | 6.3% | Freemium-rug-pull lesson |
| **Mr. Cooper** | Servicer | 31 | 4.23 | **5** | 24 | 16.1% | Servicer-watchdog fuel |
| Prosper Personal Loans (App) | Lender | 29 | 4.10 | 4 | 21 | 13.8% | Exclude from shelf |
| **My LoanCare Go** | Servicer | 28 | 3.43 | **8** | 15 | 28.6% | Servicer-watchdog + escrow-predictor fuel |
| Upstart | Lender | 27 | 3.93 | 7 | 19 | 25.9% | Geographic/processing lever |
| EagleView | Roof measurement | 27 | 4.74 | 1 | 24 | 3.7% | Integration target |
| LoanCashUSA (Play) | Aggregator | 24 | 4.75 | 1 | 22 | 4.2% | Antipattern — lead-resale model |
| QuoteIQ | Contractor CRM | 24 | 5.00 | 0 | 24 | 0% | Integration target (very high satisfaction) |
| Pitch Gauge | Roof tool | 21 | 4.43 | 3 | 18 | 14.3% | Embed (not compete) |
| AccuLynx Field | Contractor CRM | 20 | 4.95 | 0 | 19 | 0% | Integration target |
| **Solofunds** (Play) | P2P lending | 19 | 2.79 | **5** | 5 | 26.3% | Antipattern — gamified visibility hostage |
| Canadian Homes (Play) | CA marketplace | 19 | 3.68 | 5 | 12 | 26.3% | CA white-space — terrible UX |
| Rocket Mortgage | Servicer | 14 | 4.71 | 1 | 13 | 7.1% | Lone "advertise instead of show balance" complaint |
| Ava: Build Credit Fast | Credit-builder | 14 | 4.07 | 3 | 10 | 21.4% | Subscription-without-loan antipattern |
| **EnerBank** (Play) | Contractor PLOC | 12 | 2.50 | **6** | 3 | **50%** | Direct competitor for contractor-financing wedge — atrocious app |
| Roof Pitch Factor | Roof tool | 11 | 4.18 | 1 | 7 | 9.1% | Embed |
| Regions Contractor SalesPro (EnerBank) | Contractor PLOC origination | 11 | 3.55 | 4 | 7 | 36.4% | Direct competitor — same origination, different brand |
| ContractorPlus | Contractor CRM | 9 | 4.56 | 0 | 7 | 0% | Integration target |
| **GreenSky** (Play) | Contractor PLOC | 7 | **1.57** | **6** | 1 | **85.7%** | Most-hostile lender app in corpus — perfect target to displace |
| Loan Calculator – Loan2Me | Utility | 9 | 4.67 | 0 | 7 | 0% | Embed our own |
| BILS / Instant Loan (Play) | Lead-aggregator | 9 | 2.33 | 6 | 3 | 66.7% | Antipattern — phone-blast model |
| Lendbox (India) | P2P lending | 8 | **1.00** | **8** | 0 | **100%** | International antipattern — total trust collapse |

### The two competitors to watch

#### **Hearth for Contractors** — the direct incumbent

- 110 reviews, 60 are 1★, **54.5% 1★ rate** — this is an industry outlier and a strong sign of brand decay.
- Recurring 1★ complaint themes (cited in §1.3, §1.4, §1.2 above):
    1. "Most clients do not qualify" — pre-qual rails are broken (every aggregator-as-lead-shop has this)
    2. "Rates through the roof / loan shark / 16% with perfect credit" — rates are non-prime, not prime
    3. "All they do is shop personal loan places" — they are a glorified comparison front, not a lender
    4. "Auto-renewal $1,000–$2,500/year, no refunds" — pricing antipattern that drives 1★ regardless of product quality
    5. "You're not protected when client uses another contractor" — attribution gap (the strongest single damning quote)
- **Roofstack's wedge against Hearth** is precisely the inverse on each axis: pre-qual rails before the customer sees an offer (§1.3), curated prime-only lender shelf (§1.5), per-funded-loan fee instead of seat fee (no auto-renewal nightmare), and persistent referral-attribution (§1.4).

#### **GreenSky** — the lender Hearth, RAFTR, and TAMKO use

- Only 7 Play Store reviews, but **6 of 7 are 1★** (85.7% hostility rate). Highest 1★ rate of any lender in the corpus.
- Recently (2025–26) signed two distribution deals captured in the corpus:
    - `gnews_25987bf1` — _"RAFTR Roofing + Exteriors Partners with Loan Platform GreenSky"_
    - `gnews_e22311ea` — _"TAMKO Adds New GreenSky Offer for High-Volume Contractors in TAMKO Edge Program"_
- Implication: GreenSky is *expanding* roofing distribution at the same time their consumer reviews are collapsing. Roofstack arrives just as the contractor-side of these partnerships will start hearing the same customer complaints (excessive APR, no app to view loan, dark-pattern 0% promotional periods).

### Integration vs compete decision matrix

| Competitor | Decision | Why |
|---|---|---|
| JobNimbus, AccuLynx, ContractorPlus, ContractorForeman, ContractorTools, Contractor+ | **Integrate** | These are CRMs with high satisfaction (avg ★ 4.3–5.0). The MVP wedge is financing, not contractor CRM. Embed our soft-pull-link generator; don't compete. |
| EagleView, Pitch Gauge, Roof Pitch Factor | **Integrate** (roof-measurement utilities) | EagleView 4.74★, Pitch Gauge 4.43★ — high satisfaction in a narrow utility. Pull measurement → auto-fill scope. |
| Hearth, GreenSky, EnerBank/Regions, Wisetack, Synchrony | **Compete** | All four have predatory APR signal + dark patterns. Direct displacement. |
| Prosper, Best Egg, SoFi, LightStream, Marcus, Upgrade | **Lender shelf** | Curated based on §1.5 inclusion criteria. Prosper specifically excluded from shelf (28.6% 1★ rate, "predator institutions" quote). |
| LendingTree, HomeAdvisor, Angi | **Antipattern** | The lead-resale model the marketplace is fighting. |
| Mr Cooper, Lakeview, Champion, LoanCare, Nationstar | **Watchdog target** | Servicers with high handoff opacity — the watchdog (§1.6) specifically tracks these. |

---

## 3. Industry signal from GNews (the next 12 months will be hot)

Real corporate moves captured in our 567 GNews posts on home-improvement lending. These are the macro tailwinds + competitive moves the marketplace must position against.

| Date / signal | GNews ID | What it means |
|---|---|---|
| **Houzz × Figure HELOC partnership** | `gnews_9df5a02b` | _"Houzz and Figure Partner, Making HELOCs More Accessible for Homeowners"_. Houzz Pro (the GC-matching marketplace) now offers HELOCs via Figure. **This is the closest direct competitor in 2026.** They have the GC-matching side; we have the financing-comparison side. Figure's HELOC is a single-product shelf, not a comparison engine. |
| **GreenSky × RAFTR partnership** | `gnews_25987bf1` | _"RAFTR Roofing + Exteriors Partners with Loan Platform GreenSky"_. New roofing-vertical distribution for a lender with 85.7% 1★ Play Store rate. Customers will start complaining; contractors will start looking for an alternative. **Window of opportunity for Roofstack: 6–12 months.** |
| **GreenSky × TAMKO Edge** | `gnews_e22311ea` | _"TAMKO Adds New GreenSky Offer for High-Volume Contractors in TAMKO Edge Program"_. TAMKO is a major shingle manufacturer — GreenSky is now embedded in their dealer-incentive program. Same 6–12 month opportunity window. |
| **PACE-loan controversy** | `gnews_e5a8d3f4` + `gnews_1d3e2cd6` | _"What to Know Before Signing Up for PACE Loans to Finance Energy-Efficient Home Improvements"_ (NBC 6) + _"Florida PACE home improvement loans raise concerns among tax collectors"_ (WPTV). PACE = Property Assessed Clean Energy — turns into a property-tax lien, has caused major homeowner complaints. **MVP should explicitly exclude PACE from the shelf** and surface this as a trust signal. |
| **BNPL late-payment surge** | `gnews_6fbdea6a` + `gnews_73eca534` | _"Nearly Half of BNPL Users Have Paid Late in the Past Year, Up for a Second Straight Year — LendingTree"_. Validates the §1.11 retroactive-interest dark-pattern feature — this is an industry-wide trust collapse moment. |
| **Senate housing bill — small-dollar mortgages** | Reddit `1rsnpar` (429 ▲) | _"the senate just passed a massive housing bill and there's a part about small dollar mortgages that nobody's talking about"_. Federal regulatory tailwind for the kind of small-balance lending Roofstack does. |
| **QXO refinancing $2.73B** | `gnews_424eb238` | Roofing-industry consolidation indicator — large M&A in roofing distribution. Adjacent context for picking partners. |

---

## 4. Academic backing (the moat narrative)

Pulled from 160 OpenAlex + 35 Scholar + 13 PubMed posts in the corpus. These five papers are the most directly relevant to the marketplace's wedge.

| Citation | Why it matters |
|---|---|
| **An overview of the predatory mortgage lending process** (`openalex_W2153391916`) | Foundational framing of the predatory-lending taxonomy. Cited for the §1.5 lender-shelf curation criteria — match the exclusion criteria to this paper's typology. |
| **Consumer-lending discrimination in the FinTech Era** (`scholar_97a98065c1fec5c36104f586c93ca756caf5caaf`) | Establishes that algorithmic lending platforms can replicate redlining patterns even without protected-class fields. Roofstack must publish per-zip funded-rate distribution as an ECOA / Reg-B compliance moat. |
| **Credit Cycle and Adverse Selection Effects in Consumer Credit Markets — Evidence from the HELOC Market** (`openalex_W2111353212`) | Academic underpinning for §1.13 (HELOC origination fraud risk grows in adverse-selection regimes). |
| **Payment shock in HELOCs at the end of the draw period** (`openalex_W2331284714`) | Academic underpinning for the P2 "loan-aggregator with payment-shock alerts" feature (extension of §1.8 escrow predictor). |
| **The Neighborhood Distribution of Subprime Mortgage Lending** (`openalex_W2032940201`) + **Exploiting Race and Space: Concentrated Subprime Lending as Housing Discrimination** (`scholar_92246030555e82c3fa20a6560b289ca7a51337df`) | Geographic-distribution evidence for the per-zip transparency feature. The marketplace publishing anonymised funded-loan distributions by zip is a direct academic-backed differentiator vs lead-resellers. |
| **Do Homeowners Know Their House Values and Mortgage Terms?** (`openalex_W1531925229` + `openalex_W3123307333`) | Direct evidence that the §1.7 PMI-removal tracker + §1.10 refi break-even calculator solve documented information asymmetries. |
| **An empirical analysis of home equity loan and line performance** (`openalex_W3125216685`) | Risk-modelling backing for our underwriting partnership negotiations. |

---

## 5. Per-vertical scope schemas (what fields lender offers anchor against)

The MVP wedge is **roofing**, but the chassis must support HVAC and solar in P1. Each vertical needs a structured scope schema so a lender's offer can be price-anchored to a real project.

### 5A. Roofing scope schema (MVP)

| Field | Type | Source / why |
|---|---|---|
| `roof_area_sqft` | int | Primary cost driver. Auto-fill from EagleView / Pitch Gauge integration if available. |
| `tear_off_layers` | enum [0, 1, 2, 3+] | Local-code ceiling on overlay layers; layer-tear-off is +$1.50–$3/sqft |
| `material_grade` | enum [3-tab, architectural, premium-architectural, metal-standing-seam, slate, tile] | Material is the dominant cost-tier; insurance-coverage compatibility (§1.9) is a function of this field |
| `pitch_class` | enum [low (≤ 4:12), standard (5:12–8:12), steep (9:12–12:12), extreme (>12:12)] | Pitch > 8:12 is +20–40% labor; extreme requires harness equipment |
| `accessories` | multi-enum [drip-edge, ice-water-shield, peel-stick, ridge-vent, soffit-vent, skylight-flash, chimney-flash, satellite-removal] | Hidden costs that explode the bid (the `1muehvg` peel-and-stick post is exactly this) |
| `decking_replacement_pct` | int (0–100) | Often discovered after tear-off; lender offer must include a contingency line |
| `permit_required` | bool | TX requires permits for full tear-off in most jurisdictions; the `1rfi4ay` post exposes contractors who refuse to permit |
| `insurance_claim` | bool | If true, the §1.9 insurance reconciliation viewer kicks in — financing only the upgrade delta |
| `homestead_zip` | str | Drives the lender shelf state-licence eligibility + per-zip benchmark anchor |

### 5B. HVAC scope schema (P1 — second vertical)

| Field | Type | Why |
|---|---|---|
| `system_type` | enum [central-AC, central-furnace, central-AC+furnace, heat-pump, ductless-mini-split, geothermal] | Heat-pump is rebate-eligible (federal IRA + state utility); changes the financing math materially |
| `tonnage` | float | Primary capacity / cost driver |
| `seer2_rating` | float | IRA tax-credit threshold (≥ 16 SEER2 for heat pumps) |
| `ductwork_status` | enum [existing-good, existing-replace, none-add, none-mini-split-only] | Ductwork is 30–50% of total cost when added |
| `refrigerant_type` | enum [R-410A, R-32, R-454B] | R-410A phase-out (2025) means new R-32 / R-454B equipment is required for new installs |
| `installation_difficulty` | enum [standard, attic-only, crawlspace, rooftop, multi-story-no-elevator] | Labor multiplier |
| `existing_loan_payoff` | money | If user has an existing HVAC loan (the `1m7oy16` post is exactly this scenario) |
| `federal_credit_eligibility` | bool (computed) | Surface in offer as: "Federal credit -$X reduces effective ticket" |

### 5C. Solar scope schema (P1 — third vertical)

| Field | Type | Why |
|---|---|---|
| `system_kw` | float | Primary cost driver |
| `roof_orientation_score` | int (0–100, computed from roof_pitch + facing) | Drives production estimate, drives net-financing economics |
| `mount_type` | enum [roof, ground] | Material-cost difference + permitting differences |
| `battery_storage_kwh` | float | Tesla Powerwall, Enphase, etc. |
| `interconnection_type` | enum [grid-tied, hybrid, off-grid] | Permitting timeline driver |
| `existing_roof_age_years` | int | Most consumer-protection guides say "replace roof if > 10 years old before solar" — adds to ticket |
| `loan_vs_lease_vs_ppa` | enum | Material consumer-protection issue per `gnews_1d3e2cd6` PACE-loan controversy |
| `srec_state` | enum (US-state) | Active SREC market changes the financing math |

---

## 6. Cross-border Canada surface (P1 wedge)

The corpus has **only 48 posts** in the Canada-specific topic — direct evidence the Canadian home-improvement-financing space is **white space**. Three signals:

| Source | ID | Quote |
|---|---|---|
| Reddit r/homeowners (Canada) | `1ndefiv` | _"we experienced a house fire recently (in Canada). It was almost a total loss. We found an incredible company that's been doing an amazing job so far at restoration… Our insurance is requesting two other companies places bids on who is awarded the rebuild."_ |
| Reddit r/homeimprovement | `1sqbaiv` | _"Roofing scam. Beware of Toronto City Roofing and Construction. They lowballed a gutter cleaning job for me then wanted $2500 to fix and replace them."_ |
| Reddit r/realestateinvesting | `1keuxet` | _"There is a housing crisis in Canada… the government is offering low interest loans (4%) with 50 year mortgage to developers… 5% equity… 95% government-financed."_ |
| Play Store: Canadian Homes | `playstore_3e3ed047-…-fefae09e07c2` (5 distinct 1★ reviews) | _"WARNING .. THIS DEVEOPER. WILL ACTUALLY CALL YOUR CELL PHONE. horrible breach of trust… BEWARE of this scamming app. When you install this app you have to provide your email I'd, phone number…"_ |

**Implications for the marketplace:**

1. The Canadian competitor app surface is bad enough that the top results are a 1★-rating scam-warning pile. Same wedge applies (no-spam guarantee, soft-pull-only).
2. Insurance-driven contractor-bid process is more codified in Canada (claim → 3-bid requirement) — financing must integrate with that workflow.
3. The Canadian regulatory surface adds: **Bank Act** (federal lenders), **provincial cost-of-credit disclosure** (Ontario CPSAA, Quebec CPA, BC BPCPA), **FCAC code of conduct**, **PIPEDA** + **Quebec Law 25** (privacy). Build the disclosure-generator engine once → moat.

**Sequencing:** Don't build Canada in MVP. Add it at month 12+ once the US wedge converts. Pick **Ontario** first (largest population, English-default, federal Greener Homes loan program tailwind for HVAC retrofit financing).

---

## 7. The build-order matrix — every feature mapped

| # | Feature | Tier | Solves painpoint | Required integrations | Estimated time |
|---|---|---|---|---|---|
| 1 | Soft-pull marketplace + No-Spam Guarantee | **MVP** | §1.1 | Plaid CRA / Array Bureau + 3 prime lender APIs | 60–90 days |
| 2 | Live Rate Sanity Badge | **MVP** | §1.2 | FRED API + Bankrate / LendingTree median scrape | +30 days |
| 3 | Pre-qual rails (no junk-rate fallback) | **MVP** | §1.3 | Already from #1 | included |
| 4 | Contractor referral attribution | **MVP** | §1.4 | Hashed-fingerprint store + per-contractor dashboard | +30 days |
| 5 | Curated lender shelf + public exclusion list | **MVP** | §1.5 | BizDev contracts + quarterly review process | included |
| 6 | True-APR comparison incl. retroactive-interest | **MVP** | §1.11 | Lender-offer schema must include `retroactive_interest_on_promo_default` | included |
| 7 | Servicer-Change Watchdog | **P1** | §1.6 | MERS public-lookup polling + monthly statement OCR + CFPB complaint draft generator | 60–90 days post-MVP |
| 8 | PMI Removal Tracker | **P1** | §1.7 | Zillow Estimate / Redfin AVM + LTV calculator | 30 days |
| 9 | Escrow Surprise Predictor | **P1** | §1.8 | County-assessor APIs (TX pilot) + insurance declarations OCR | 60 days |
| 10 | Insurance × Scope reconciliation viewer | **P1** | §1.9 | Insurance declarations OCR + per-vertical scope schema | 60 days |
| 11 | Refi Break-Even Watchdog | **P1** | §1.10 | Loan-attach + daily anchor data | 30 days post-#7 |
| 12 | HVAC vertical (same chassis, new schema + lender shelf) | **P1** | §5B | EnerBank or specialist heat-pump lender (GoodLeap) partnership | 90 days |
| 13 | Solar vertical (with PACE exclusion) | **P1/P2** | §5C + §3 PACE controversy | Specialist solar lender partner; SREC state coverage matrix | 90 days |
| 14 | Closing-Day Concierge | **P2** | §1.12 | LE/CD parser + RESPA TRID rule encoder | mortgage-vertical only; year 2 |
| 15 | Title-Monitoring + Origination Alerts | **P2** | §1.13 | County-recorder API in pilot states + MERS lien polling | 90 days |
| 16 | Plaid-Liabilities Loan Aggregator | **P2** | §1.14 | Plaid Liabilities + Equifax CA equivalent | 90 days |
| 17 | Canada wedge (Ontario pilot) | **P2** | §6 | Bilingual disclosure engine + Equitable / EQ Bank partner-bank shell | year 2 |
| 18 | Anonymised funded-loan transparency surface | **P2 moat** | §1.5 + §4 academic | Daily aggregation job; dashboards for per-zip / per-FICO funded-rate distribution | year 2 |

---

## 8. Friend-referral trust transfer at scale (the social-proof feature)

**Headline insight:** The most-quoted DIY workaround in the corpus is _"My friend recommended this personal loan platform to me, which is really reliable"_ — trust transfers through people, not aggregator stars. The contractor-1★-Hearth complaint reinforces it: customers don't trust pre-qual offers from a brand they've never heard of, but they trust offers their neighbours have actually funded.

**Direct citations:**
- The friend-referral workaround quote (cited in `2026-04-28_us-canada-home-lending-marketplace copy.md` §6D)
- App Store: Hearth `appstore_1383073333_13814467740` (5★, the only positive cluster) — _"I had a friend use Hearth and was ecstatic about how easy it was and the fact that they had a dedicated agent. So much so, that I referred Hearth to a friend without even being a customer."_

**Feature to build (P1):** **Per-zip social-proof feed**

| Acceptance criterion | Detail |
|---|---|
| Aggregation | After 100 funded loans in a zip, expose: "X people in your zip funded a similar roof in the last 90 days; their median APR was Y%; lender most-chosen was Z" |
| Privacy | All anonymised; never expose specific borrower data |
| Lender ranking | Same data drives the lender scorecard from §1.5 — turns user-funded-loan data into a transparency moat |

---

## 9. What we are deliberately not building (and why)

| Anti-feature | Why we skip |
|---|---|
| Contractor licence + bond + insurance OCR | JobNimbus, AccuLynx, ContractorPlus, ContractorForeman already collect these. Integrate, don't compete on document-collection. |
| Generic "find a contractor" directory | Houzz, Sweeten, Angi, HomeAdvisor saturate this. Their lead-spam economics are the antipattern (§1.1). Houzz × Figure (§3) tries to bolt financing onto contractor-matching; we bolt contractor-matching onto financing. |
| Full mortgage origination | Different licence, different lender shelf, different timeline. Wait until PLOC works. |
| Crypto / DeFi lending | Zero corpus signal in 1,890 posts. |
| Generic personal-finance content | NerdWallet and Bankrate own this; not the wedge. |
| BNPL with promotional 0% APR retroactive-interest | Anti-feature — explicitly excluded from shelf per §1.11. |
| PACE loans | Anti-feature — explicitly excluded per §3 + GNews `gnews_e5a8d3f4` + `gnews_1d3e2cd6`. Surface this exclusion as a trust signal. |
| Lender call-back forms | Anti-feature — the §1.1 spam-aftermath quote literally describes this antipattern. |

---

## 10. Re-running the research as the product evolves

```bash
# Monthly: re-collect to catch new entrants + new pain patterns
uv run gapmap research collect \
  -t "US Canada roofing contractor homeowner lending marketplace" \
  --aggressive --skip-extraction

# After collect: refresh painpoint extraction
uv run gapmap research gaps \
  -t "US Canada roofing contractor homeowner lending marketplace" \
  -n 300 --json > docs/research/painpoints-$(date +%Y%m%d).json

# Re-pull all 1★ Hearth reviews (the direct competitor)
uv run gapmap query "SELECT id, score, title, substr(selftext,1,500) FROM posts WHERE sub='appstore:Hearth for Contractors' AND score=1 ORDER BY id DESC LIMIT 100"

# What changed in the last 14 days
uv run gapmap research diff \
  -t "US Canada roofing contractor homeowner lending marketplace" --days 14

# Pull all GreenSky/EnerBank/Hearth GNews mentions in the last 30 days (industry move detector)
uv run gapmap query "SELECT id, title FROM posts WHERE source_type='gnews' AND (lower(title) LIKE '%greensky%' OR lower(title) LIKE '%hearth%' OR lower(title) LIKE '%enerbank%' OR lower(title) LIKE '%wisetack%') AND created_utc > strftime('%s','now','-30 days') ORDER BY created_utc DESC"
```

---

## 11. The 60-second pitch (for a CTO)

> **Roofstack** is a soft-pull-only home-improvement-financing marketplace. We solve four user-quoted pains simultaneously: (1) the "57 calls in one morning" lead-spam aftermath (Reddit `1odky4x`), (2) the "11% on 820k with 804 FICO" opaque-broker pricing (Reddit `1p5pyzt`), (3) the "most clients do not qualify" Hearth conversion failure (60 of 110 1★ reviews), and (4) the "loan was bought out, terms changed" servicer-handoff opacity (Reddit `1kdy5q8` + Mr Cooper 1★ reviews). Wedge: **roofing** (679 posts), **Texas** (high ticket, low licence friction), **3 prime lenders** (curated, no Prosper/GreenSky/EnerBank junk-rate). Differentiator: per-funded-loan fee not lead-resale. Moat: TILA / RESPA / Reg-B / FCAC disclosure engine that generates correct disclosures per offer × per state/province. Window of opportunity: GreenSky just signed RAFTR (`gnews_25987bf1`) and TAMKO (`gnews_e22311ea`) — the contractor side of those distribution deals will start hearing customer complaints in 6–12 months.
