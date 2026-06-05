# Add "Software listings / reviews" RSS source bundle (incl. G2)

**Date:** 2026-06-05
**Type:** Feature

## Summary

Added a new `listings` RSS category so the app can collect from software
listing / review / directory sites — including **G2** — as a first-class
source. G2's *review* pages (and Capterra / GetApp / TrustRadius /
AlternativeTo) are Cloudflare-walled (HTTP 403) and not fetchable without a
paid API or a headless browser; their **public RSS feeds** (software-category
guides, SaaS news, launches, project news) come through fine and were verified
live before wiring in. Also removed two dead feeds from the `products` bundle.

## Verification (before implementing)

Script-tested candidate feeds with both `urllib` and the app's actual parser
(`feedparser`). Confirmed working (HTTP 200 + parsed entries):

| Feed | URL | Entries | Topic-filter ("software") |
|---|---|---|---|
| G2 | `https://learn.g2.com/rss.xml` | 30 | 30 (all software-category) |
| SaaSworthy | `https://www.saasworthy.com/blog/feed` | 15 | 15 |
| Product Hunt | `https://www.producthunt.com/feed` | 30 | topic-dependent |
| Show HN | `https://hnrss.org/show` | 20 | topic-dependent |
| SourceForge | `https://sourceforge.net/blog/feed/` | 15 | 2 |
| Slashdot | `https://rss.slashdot.org/Slashdot/slashdotMain` | 15 | topic-dependent |

Confirmed **blocked (403 Cloudflare)** and intentionally NOT added: G2/Capterra/
GetApp/TrustRadius/AlternativeTo review HTML, AlternativeTo RSS. G2 official API
(`data.g2.com`) returns 401 (needs a paid partner token).

## Changes

- `src/gapmap/sources/rss_catalog.py`
  - New `listings` category with the 6 verified feeds (G2, SaaSworthy, Product
    Hunt, Show HN, SourceForge, Slashdot).
  - Added `CATEGORY_LABELS["listings"] = "Software listings / reviews"`.
  - Added `listings` to `DEFAULT_CATEGORIES` (so the generic `rss` bundle
    includes it).
  - Removed dead feeds from `products`: Indie Hackers (`feed.xml` → 0 entries)
    and BetaList (`/feed` → 404).
- `src/gapmap/sources/collect_adapter.py`
  - Registered `rss_listings` in `SOURCES` (`_rss_category_runner("listings")`)
    so it's selectable as its own source id.
- `src/gapmap/research/collect.py`
  - Added `rss_listings` to the aggressive-collect default source list.

## How it scopes to a topic

The RSS adapter filters entries by case-insensitive substring match on
title+summary, so e.g. G2's "5 Best CRM Software" only surfaces on a CRM-related
topic — these feeds add review/listing signal without flooding unrelated runs.

## Files Modified

- `src/gapmap/sources/rss_catalog.py`
- `src/gapmap/sources/collect_adapter.py`
- `src/gapmap/research/collect.py`
