# Lending marketplace — Pass-3 SQL deep-dive + build-ready PRD

**Date:** 2026-04-28
**Type:** Documentation / Research / PRD

## Summary

Third research pass on the US/Canada home-lending marketplace. **No new
data fetched** — instead, mined the existing 1,890-post corpus directly
via SQL across 4 probe matrices (financing-process, contractor-side,
verticals, emotion/persona), then surfaced the 30 highest-upvote Reddit
posts and the worst 1★ App Store / Play Store reviews from the named
competitors.

Net result: a fresh, build-ready PRD at
`docs/research/2026-04-28_PRD-build-ready.md` that gives engineering
12 cited painpoints (each with real post IDs the team can pull back via
`reddit-cli query`), 12 corresponding features with acceptance criteria,
a frequency-validated vertical roadmap (roof 679 → solar 77 → HVAC 57 →
…), an MVP-vs-defer cut, a competitor teardown grounded in their own 1★
reviews, and an architecture sketch that matches the existing Tauri 2 +
Python sidecar conventions in this repo.

The PRD also surfaces the most-damning competitor signal yet: Hearth
for Contractors' 1★ reviews ("most clients do not qualify", "all they
do is shop a bunch of personal loan places", "if you send the client
the link for financing, you are not protected by Hearth and they can
get financed and undercut you", "interest rates are through the roof").
Every one of these is a feature requirement for our MVP.

## Changes

- 4 SQL probe matrices over 1,890 posts:
  - **Probe 1 (financing-process):** 25 dimensions — refinance 68,
    FHA/VA/USDA 45, appraisal 42, scam 40, 0% APR/deferred 39,
    closing-costs 29, underwriting 27, escrow 25, pre-approval 18,
    discount-points 18, denied 18, PMI 12, predator 11, Mr Cooper 11,
    cash-out refi 9, DTI 8, co-signer 8, FTHB 8, servicer 7, hard-pull
    4, spam/harass 4, ARM 4, loan-estimate 3, balloon 3, soft-pull 1.
  - **Probe 2 (contractor-side):** 15 dimensions — lawsuit/sue 242,
    deposit 48, estimate 48, insurance-claim 21, warranty 18, change
    order 8, license/bond 7, ghosted 6, inflated 6, lien 5, fake
    reviews 9, BBB 2.
  - **Probe 3 (verticals):** 15 verticals — roof 679, solar 77, HVAC
    57, garage 45, basement 34, siding 32, kitchen 31, bath 25, septic
    18, flooring 17, appliance 17, foundation 12, deck/fence 12,
    windows 5, pool 0.
  - **Probe 4 (emotion/persona):** 13 signals — help/advice 39, stress
    33, first-home 22, regret 19, scared 15, screwed 12, lied 10.
- **Probe 5:** top 30 Reddit posts by score (≥100 upvotes) — surfaced 5
  net-new high-signal painpoints (HELOC title-fraud 2,061 upvotes;
  insurance fraud for new roofs 846; sellers hiding overdue mortgage
  payments 1,031; American Home Shield is a waste 856; investor First
  Right of Refusal 954).
- **Probe 6:** worst 1★ reviews per app, by app — produced devastating
  Hearth-for-Contractors complaint pattern (the strongest competitor
  signal yet collected) and the Mr Cooper PMI / escrow / unapplied-
  funds pattern.
- New PRD at `docs/research/2026-04-28_PRD-build-ready.md` with:
  - 12 cited painpoints (post IDs included for engineering re-read).
  - 12 corresponding features with acceptance criteria.
  - MVP scope (60-90 days, roofing only, Texas only, 3 PLOC lenders).
  - Don't-build list (mortgage origination, multi-vertical, contractor
    CRM, Canada, aggregator, insurance reconciliation — all P1+).
  - Frequency-validated vertical roadmap.
  - Pain matrix → feature priority mapping.
  - Competitor teardown with their own 1★ reviews quoted.
  - Architecture sketch reusing Tauri 2 + Python sidecar + mempalace +
    BYOK LLM (all already shipping in this repo).
  - 6 open engineering questions for sprint 1.
  - 30-second pitch for fundraising / hiring conversations.

## Files Created

- `docs/research/2026-04-28_PRD-build-ready.md`
- `changelogs/2026-04-28_03_PRD-build-ready.md`

## Files NOT Created

- No re-collection. Instructed by the user explicitly: "dont use or
  fetch new data". All signal in this pass came from re-mining the
  1,890-post corpus already in SQLite.
