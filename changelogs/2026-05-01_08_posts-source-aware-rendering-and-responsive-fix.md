# Posts tab — source-aware rendering, proper bucket labels, real source filter, responsive overflow fix

**Date:** 2026-05-01
**Type:** Fix · UI Enhancement

## Summary

Fixes three production bugs the user reported on the Posts tab:
1. GNews rows displayed as **`r/gnews`** with a broken `https://www.reddit.com/r/gnews` link.
2. Article links rendered raw (no titles, no per-source detail) for non-Reddit sources.
3. Long titles / URLs / IDs overflowed off-screen because the flexbox row had no `min-width: 0` overflow-wrap.

Also adds a proper **Source filter dropdown** on the Posts toolbar — previously the only way to filter by source was via a chip set externally; now any source present in the topic appears in a dropdown with row counts.

## Changes

### Frontend — `screens/posts.js` + `style.css`

- **`subBucketLabel(source, sub)`** — per-source human label for the `sub` field. Reddit + Lemmy keep `r/...` linked to reddit.com. Everything else (HN, Stack Overflow, GitHub, Dev.to, GNews, RSS, Bluesky, Mastodon, YouTube, App/Play Store, arXiv, etc.) gets a non-Reddit format and is rendered as a plain inline `<span class="posts-bucket">` — no broken cross-domain link.
- **`postLink(p, source)`** — uses `https://www.reddit.com${permalink}` only for Reddit-family sources. All other sources fall through to `p.url`. A non-empty permalink on a non-Reddit row no longer produces a 404 reddit URL.
- **`authorLine(p, source)`** — per-source author prefix: `u/...` for Reddit, `@...` for Bluesky/Mastodon/GitHub, `channel: ...` for YouTube, plain name otherwise.
- **Empty-zero suppression** — score and comments chips render only when `> 0`. Stops every GNews/arXiv/RSS row from showing `▲ 0  💬 0`.
- **Source filter dropdown** — new `<select id="posts-source">` in the toolbar. Options come from a live `SELECT source_type, count(*) GROUP BY` against the topic so only present sources appear, each with its row count. Bucket-input placeholder rewrites per source (`filter by sub` / `filter by repo` / `filter by tag` / `filter by feed` / `filter by channel`).
- **Responsive overflow** — added `min-width: 0`, `word-break: break-word`, `overflow-wrap: anywhere` on `.posts-row`, `.posts-title`, `.posts-list`. `.posts-row-head` now wraps the source chip below the title on narrow viewports. Excerpts are clamped to 3 lines (2 below 640px) so a wall-of-text post doesn't push everything off-screen. New `@media (max-width: 640px)` block tightens toolbar gaps and font sizes.
- **`.posts-bucket`** style — subdued mono-font chip for non-Reddit buckets so the eye still finds Reddit `r/...` links first when scanning a mixed-source feed.

### Backend — source adapter data hygiene

- **`sources/gnews.py`** — was storing `sub: "gnews"` (the source name itself) and `permalink: entry.link` (a `https://news.bbc.co.uk/...` URL). Now `sub` is the publisher slug (`bbc`, `reuters`, `techcrunch`) extracted from `entry.source.title`, and `permalink: None` (article URL stays in `url`).
- **`sources/rss.py`** — was storing the article URL in `permalink`. Now `permalink: None`; the article URL is already in `url`.
- **`sources/stackoverflow.py`** — was storing `sub: "stackoverflow"` (redundant with `source_type`) and the question URL in `permalink`. Now `sub` is the primary tag (e.g. `python`) so the UI shows `[python]`, and `permalink: None`.

The frontend defense (`postLink` only honors permalink when source ∈ REDDIT_FAMILY) makes the app robust against any other adapter that has the same anti-pattern, but the three above fix it at the source so the data is clean from the next collect on.

## Files Modified

- `app-tauri/src/screens/posts.js` — `renderRow` rewritten with per-source helpers, `renderToolbar` gets a Source dropdown, `wireToolbar` wires the dropdown, `paintFromData` + `rerender` fetch source counts in parallel.
- `app-tauri/src/style.css` — `.posts-row`, `.posts-title`, `.posts-meta`, `.posts-row-head`, `.posts-excerpt` get responsive overflow handling. New `.posts-input-source`, `.posts-bucket`. New `@media (max-width: 640px)` block.
- `src/reddit_research/sources/gnews.py` — `sub` = publisher slug, `permalink: None`.
- `src/reddit_research/sources/rss.py` — `permalink: None`.
- `src/reddit_research/sources/stackoverflow.py` — `sub` = primary tag, `permalink: None`.
