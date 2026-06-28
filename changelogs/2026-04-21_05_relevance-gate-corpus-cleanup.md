# Relevance gate — stop garbage posts from entering corpus + retroactive cleanup

**Date:** 2026-04-21
**Type:** Feature + Fix — critical quality

## Summary

Root cause for "15k edges but findings are irrelevant" reports: Reddit / HN
search on multi-word topics (e.g. "meditation and sound frequency brainwave
app") token-matches wildly unrelated posts (r/politics, r/news threads about
ICE / Epstein / Disney+) and drops them into `topic_posts`. The LLM extractor
faithfully produces painpoints from whatever it's given → "Lack of transparency
in law enforcement" surfaced as a meditation-app painpoint.

Ship a **relevance gate** at three points in the pipeline:

1. **Collect-time:** `_tag_posts` scores each candidate post via ChromaDB
   MiniLM cosine-to-topic and only inserts into `topic_posts` above
   `OPENREPLY_RELEVANCE_GATE_THRESHOLD` (default 0.28, recall-leaning).
2. **LLM-time:** `synthesize_insights` (single + chunked paths) runs every
   extracted finding through `filter_findings` before persisting — drops
   findings whose label is off-topic above
   `OPENREPLY_FINDING_RELEVANCE_THRESHOLD` (default 0.40, precision-leaning).
3. **Retroactive:** new `research clean-corpus` CLI + Tauri command cleans
   existing corpora where the gate didn't exist yet. Dry-run by default;
   user inspects `sample_dropped`, then re-runs with `--apply`.

Smoke-tested on the local `ai` topic: gate correctly identifies 46/77 posts
as off-topic (RSS feeds about autoimmune conditions, Swiss municipal email
providers, Nothing earbuds) with cosines ≤ 0.05.

## Why three gates and not one

- Without the collect gate, a bad search pattern ingests 10k garbage posts
  that bloat DB + slow every downstream pass.
- Without the LLM gate, the LLM hallucinates findings when the corpus is
  borderline or when the LLM itself drifts.
- Without retroactive cleanup, existing users are stuck with poisoned topics
  they must delete and re-collect from scratch.

Each gate is best-effort (gracefully skips when chromadb isn't installed)
and env-tunable (set threshold to 0 to disable).

## Changes

### New files
- `src/reddit_research/research/relevance.py` — `score_posts`,
  `filter_topic_posts`, `filter_findings`. Pure embedding math on top of the
  ChromaDB MiniLM ONNX model the app already ships. Min-keep safety floor
  (default 20) prevents nuking a nascent topic from a cold embedder.

### Modified files
- `src/reddit_research/research/collect.py` — `_tag_posts` runs the relevance
  gate before `topic_posts.insert_all`. Threshold via
  `OPENREPLY_RELEVANCE_GATE_THRESHOLD` env (default 0.28).
- `src/reddit_research/research/insights.py` — both single-shot AND chunked
  `synthesize_insights` paths call `filter_findings` after the LLM returns,
  stamping `_relevance_dropped_findings` / `_relevance_dropped_count` on the
  report so the UI can show "dropped N off-topic findings" pill.
- `src/reddit_research/cli/main.py` — new `research clean-corpus` command
  with `--topic`, `--threshold`, `--apply`/dry-run, `--min-keep`.
- `app-tauri/src-tauri/src/commands.rs` — new `clean_corpus` Tauri command.
- `app-tauri/src-tauri/src/main.rs` — registered in invoke_handler.
- `app-tauri/src/api.js` — `api.cleanCorpus(topic, threshold, apply, minKeep)`.

## How to use retroactively

```bash
# Dry-run first — see what WOULD be dropped
reddit-cli research clean-corpus --topic "meditation and sound frequency brainwave app"

# Inspect sample_dropped in the JSON output. If it looks right:
reddit-cli research clean-corpus --topic "meditation and sound frequency brainwave app" --apply

# Then re-enrich to rebuild findings on the cleaned corpus:
reddit-cli research insights --topic "meditation and sound frequency brainwave app"
```

## Tuning

| Env var | Default | Notes |
|---|---|---|
| `OPENREPLY_RELEVANCE_GATE_THRESHOLD` | 0.28 | Collect-time post filter. Lower = more permissive. Set to 0 to disable. |
| `OPENREPLY_FINDING_RELEVANCE_THRESHOLD` | 0.40 | LLM-output finding filter. Precision-leaning. Set to 0 to disable. |
| min_keep (CLI / API param) | 20 | Retroactive safety floor — never drop below this many posts. |

## Files Created

- `src/reddit_research/research/relevance.py`
- `changelogs/2026-04-21_05_relevance-gate-corpus-cleanup.md`

## Files Modified

- `src/reddit_research/research/collect.py`
- `src/reddit_research/research/insights.py`
- `src/reddit_research/cli/main.py`
- `app-tauri/src-tauri/src/commands.rs`
- `app-tauri/src-tauri/src/main.rs`
- `app-tauri/src/api.js`
