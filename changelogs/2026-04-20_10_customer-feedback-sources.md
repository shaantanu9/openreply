# Customer-feedback source bundle — Trustpilot, Product Hunt, AlternativeTo

**Date:** 2026-04-20
**Type:** Feature

## Summary

User asked "have we linked Trustpilot and other customer-feedback sources
for product insight?" — answer was "files exist for some, nothing is
wired into the dispatch." This commit closes the gap:

- Adds **Trustpilot** adapter (new file). Parses Trustpilot review pages
  via embedded JSON-LD — no DOM scraping. Honest about limitations.
- Wires **Product Hunt** (`producthunt.py` already existed) into SOURCES
  dispatch. Uses PH's free GraphQL API. Needs `PH_TOKEN` env for real data.
- Wires **AlternativeTo** (`alternativeto.py` already existed) into
  SOURCES dispatch. Used for competitor-discovery signals in the
  Insight Engine.

## Honest reality check on Trustpilot

Trustpilot blocks automated access at the Cloudflare/TLS layer, not just
UA-based. Even with a Chrome-like User-Agent, all requests return empty.
The adapter is **correct code** but currently produces 0 rows for every
query. Real production use requires:

- Trustpilot Business API (paid partnership), OR
- A headless browser integration (Playwright/Selenium — adds ~200 MB to
  PyInstaller bundle, not shipped)

Therefore: **Trustpilot is NOT in aggressive-mode defaults.** It's still
in SOURCES dispatch so users can explicitly opt in via `--sources
trustpilot` once they have an API contract OR workaround. Documentation
is clear about this.

## Changes

New source adapter:
- `src/reddit_research/sources/trustpilot.py` — search → resolve domain
  → paginate reviews, parse JSON-LD. Browser UA by default; set
  `TRUSTPILOT_HONEST_UA=1` to opt into a research-identifying UA (blocks
  requests entirely — useful for strict-compliance environments).

Wiring:
- `sources/collect_adapter.py` — new `run_trustpilot`, `run_producthunt`,
  `run_alternativeto` functions; registered in `SOURCES` dispatch.
- `research/collect.py` — aggressive defaults gain `producthunt`.
  Trustpilot + AlternativeTo held OUT with a comment block documenting
  why (Cloudflare blocks / flaky).
- `research/insights.py` — added per-provider corpus caps for the 3
  new sources (trustpilot 40, producthunt 25, alternativeto 15).

UI:
- `app-tauri/src/screens/collect.js` — `SOURCE_LABELS` + `AGGRESSIVE_SOURCES`
  updated; producthunt is now an expected chip during collect.
- `app-tauri/src/screens/topic.js` — `SRC_BADGE` gains colors for the 3
  new sources so finding cards render cleanly.

Changelog:
- `changelogs/2026-04-20_10_customer-feedback-sources.md` — this file.

## What users get

- Every aggressive collect now fetches Product Hunt launches/posts
  (~25 rows/topic with PH_TOKEN configured; 0 without — hint row only).
- Insight Engine's per-finding `source_breakdown` can now include
  producthunt, trustpilot, alternativeto as distinct signals.
- Triangulation badge goes up when a finding has both Reddit + Product
  Hunt coverage (multi-source strength).

## What users still need to configure

- `PH_TOKEN` env for Product Hunt data (free from
  https://api.producthunt.com/v2/oauth/applications). Without it,
  Product Hunt adapter returns an empty-with-hint row.
- Trustpilot will not produce data without an API partnership + custom
  auth integration.

## Honest map of what's NOT shipped + why

| Source | Status | Why |
|---|---|---|
| **G2** | Not built | ToS prohibits automated access; public API gated by partnership |
| **Capterra** | Not built | Same as G2 |
| **Gartner Peer Insights / TrustRadius** | Not built | Enterprise, hostile to scraping |
| **Intercom / Zendesk (private tickets)** | Not built | Gated on the cloud-pivot decision in `docs/DUAL_MODE_PIVOT.md` + OAuth infra that Gap Map doesn't have yet |
| **Stripe (churn events)** | Not built | Same as above |
| **Amazon reviews** | Not built | ToS + ASIN-discovery complexity |

See `docs/PROJECT_STATUS.md` §"What we explicitly did NOT build" for
the permanent-reject list and `docs/VALIDATION_PLAN.md` for the
pathway to connected private sources (gated on 3-founder validation).
