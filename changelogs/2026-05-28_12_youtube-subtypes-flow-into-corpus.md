# YouTube transcripts + descriptions now flow into the corpus + LLM analysis

**Date:** 2026-05-28
**Type:** Fix (data correctness)

## Summary

YouTube ingestion was already collecting three distinct content kinds
to the `posts` table:

| Content | `source_type` tag |
|---|---|
| Top-voted comments + video metadata | `youtube` |
| Video description (speaker-authored copy) | `youtube_description` |
| Caption / subtitle chunks (~1400 chars each) | `youtube_transcript` |

But the rest of the app only knew about the `youtube` tag. The
descriptions + transcript chunks were silently invisible:

- **Sources tab tiles** grouped by raw `source_type`, fragmenting
  YouTube content into three thin tiles ("youtube", "youtube_description",
  "youtube_transcript") instead of one rich tile.
- **Sentiment-by-source** ran the LLM THREE times for YouTube — once
  per subtype — and treated transcripts as user sentiment (transcripts
  are the speaker's words, not viewer reactions).
- **Audience clustering** put YouTube voices into three separate
  persona buckets per subtype.
- **LLM finding extraction** (`corpus_format._SOURCE_FORMATTERS`) had
  no entry for any youtube subtype, so the default Reddit fallback
  tagged every YouTube row as `r/<channel> (0↑ 0c)` — the LLM was
  reading transcript chunks thinking they were low-engagement
  Reddit posts.
- **Posts tab display** showed `source: youtube_transcript` as raw
  text with no indication that the row was speaker words vs a
  comment.

Net effect: a user collected a topic, got 200 YouTube comments + 50
descriptions + 800 transcript chunks (1050 high-quality rows), then
saw the topic as if YouTube had contributed only a handful of poorly-
labeled fragments. Sentiment + findings + personas drew from the
fragments instead of the rich whole.

## Fix

New module **`src/openreply/sources/source_families.py`** — single source
of truth for source-family normalization on the Python side:

- `YT_FAMILY` — the set of raw `source_type` values that are
  "really YouTube".
- `normalize_source_type(st)` — Python helper that collapses
  `youtube_*` → `youtube`. Idempotent.
- `expand_family(family)` — inverse, returns the set of raw subtypes
  for a family (used for `WHERE source_type IN (...)` filters).
- `NORMALIZED_SOURCE_SQL` — a SQLite `CASE` expression that performs
  the same collapse inside a SELECT, so aggregations can do the
  normalization in the database. Used in 3 hot research queries.
- `subtype_label(st)` — friendly display labels for the subtypes
  (`youtube` → "comment", `youtube_transcript` → "transcript", etc.).

Mirror module on the JS side: **`app-tauri/src/lib/postLink.js`**
gained `YT_FAMILY`, `youtubeSubtypeLabel`, `normalizedSource`
exports with the same semantics. Test suite extended (37 → 40 tests).

Then wired into the 4 hot consumers:

1. **`research/sentiment_by_source.py`** — both `_sources_for_topic`
   (the per-source row count for the sentiment-card grid) and
   `_sample_posts_for_source` (the per-source content sample sent
   to the LLM) now use `NORMALIZED_SOURCE_SQL`. One YouTube card
   instead of three; the prompt sees comments + descriptions +
   transcripts as one coherent YouTube voice.

2. **`research/corpus_format.py`** — added three explicit entries to
   `_SOURCE_FORMATTERS` so the LLM prompt header tells it WHAT
   kind of YouTube content each row is:
   - `youtube`             → `[yt:ID] YouTube comment on "<channel>" (123↑)`
   - `youtube_description` → `[yt-desc:ID] YouTube video description — channel "<channel>"`
   - `youtube_transcript`  → `[yt-tx:ID] YouTube transcript chunk — channel "<channel>" (speaker's words)`
   The "speaker's words" hint prevents the LLM from attributing
   transcript content to viewers (a major prior failure mode in
   sentiment + painpoint extraction).

3. **`research/audience.py`** — the persona-clustering query now
   selects `NORMALIZED_SOURCE_SQL AS source_type` so YouTube voices
   roll up into one persona bucket instead of fragmenting.

4. **`app-tauri/src/screens/topic.js`** — `srcSql` (the Sources tab
   tile aggregation) uses an inline `NORMALIZED_SOURCE` CASE
   expression with the same shape as the Python SQL helper. Keep
   the two in sync when adding future subtypes.

5. **`app-tauri/src/screens/posts.js`** — `subOrChannel` and
   `authorLine` updated so all 3 YouTube subtypes render with the
   channel name + a per-subtype suffix:
   - `youtube`             → `channel: <author>`
   - `youtube_description` → `channel: <author> · video description`
   - `youtube_transcript`  → `channel: <author> · transcript chunk`

## Files Created

- `src/openreply/sources/source_families.py`
- `changelogs/2026-05-28_12_youtube-subtypes-flow-into-corpus.md`

## Files Modified

- `src/openreply/research/sentiment_by_source.py` — 2 queries normalized.
- `src/openreply/research/corpus_format.py` — 3 new `_SOURCE_FORMATTERS` entries.
- `src/openreply/research/audience.py` — 1 query normalized.
- `app-tauri/src/lib/postLink.js` — exports `YT_FAMILY`,
  `youtubeSubtypeLabel`, `normalizedSource`.
- `app-tauri/src/lib/postLink.test.mjs` — +3 test cases (37 → 40
  tests pass).
- `app-tauri/src/screens/topic.js` — `srcSql` uses inline normalized CASE.
- `app-tauri/src/screens/posts.js` — `subOrChannel` + `authorLine`
  handle all 3 YT subtypes.

## Verification

- `npm test` → 40/40 passed (was 37 before, +3 new YT tests).
- `python3 -m py_compile` on all touched Python files → clean.
- Direct-import of `source_families.py` runs all 8 in-file assertions
  cleanly.
- `node --check` on `posts.js`, `postLink.js`, `postLink.test.mjs`,
  `topic.js` → clean.
- **GUI runtime verification deferred** — user will test on a separate
  device after the v0.1.4 release ships. See manual test notes below.

## Manual Test Notes (other device, v0.1.4+)

1. Open a topic that has YouTube data collected. (If none, run
   collect on a topic where YouTube is a relevant source — e.g.
   any consumer-product topic.)
2. Sources tab → expect ONE "YouTube" tile, not three. Tile post
   count should equal `youtube + youtube_description +
   youtube_transcript` row counts summed.
3. Sentiment tab → expect ONE "YouTube" sentiment card (not three).
   The LLM-written summary should reference both viewer reactions
   (from comments) AND speaker themes (from transcripts) — a sign
   the prompt is seeing the full picture.
4. Posts tab → filter by source=YouTube → expect rows showing as:
   - `channel: <name>` (plain comment)
   - `channel: <name> · video description`
   - `channel: <name> · transcript chunk`
5. Enrichment (Map tab → run Enrich): expect painpoint/feature
   findings cited to `[yt-tx:...]` and `[yt-desc:...]` IDs as well
   as `[yt:...]` comments. Before this fix, transcripts were
   citation-attributed as `r/<channel>` Reddit posts.

## Follow-ups (out of scope for this changeset)

- The remaining 14 files referencing `source_type` (database.js,
  papers.js, ingest.js, intent_ladder.js, insights.js, find.js,
  science.js, etc.) still group/filter on raw `source_type`. They
  weren't on the critical "YouTube content not flowing into
  analysis" path so deferred. Future pass: import
  `normalizedSource` from `postLink.js` and `NORMALIZED_SOURCE_SQL`
  from `source_families.py` at those sites too.
- Future subtype families (e.g. `github_issues` + `github_pulls`,
  `arxiv` + `arxiv_abstract` + `arxiv_fulltext`) can follow the
  same pattern by adding entries to `YT_FAMILY`-style sets in both
  `source_families.py` and `postLink.js` and extending the CASE
  expressions.
