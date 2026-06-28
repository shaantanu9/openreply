# Folder ingest + learning-material source types

**Date:** 2026-04-25
**Type:** Feature

## Summary

Single-file ingest worked but was tedious for the obvious "drop a folder of design docs / test notes / specs into a topic" workflow — each file required a manual pick + topic + source-type cycle. This adds a folder mode that walks a directory recursively, ingests every supported file (md/pdf/csv/json/txt/vtt/srt) into one topic, and skips junk (`.git`, `node_modules`, hidden subtrees, build artifacts). Each ingested doc lands in the same `posts` table as Reddit content, queues for the existing extraction worker, and surfaces in the same Map / Insights / Solutions tabs without any extra wiring — the cross-source `co_evidenced` / `relates_to` graph relations already weave doc-derived findings together with Reddit/HN/arXiv evidence.

Also adds two named source-type tiles — **Learning material** and **Test docs** — so attribution shows up cleanly on the Map source-coverage chip instead of dumping into a generic `custom` bucket.

## Changes

- **`src/reddit_research/cli/main.py`** — new `ingest folder` Typer command. Walks `path.rglob('*')`, filters by extension allowlist (overridable via `--ext md,txt`), enforces `--max-files` cap (default 500), skips `.git` / `node_modules` / hidden subtrees, calls `local_file.ingest_and_persist` per file, returns a per-file summary in `--json` mode.
- **`app-tauri/src-tauri/src/commands.rs`** — `ingest_folder` Tauri command that forwards to the CLI. Mirrors `ingest_file`'s shape but adds optional `extensions` and `max_files`.
- **`app-tauri/src-tauri/src/main.rs`** — registers `commands::ingest_folder` in `invoke_handler`.
- **`app-tauri/src/api.js`** — `ingestFolder({ path, topic, sourceType, extensions, maxFiles })` wrapper, broadcasts `mutated('ingest', { topic })` so home/sidebar counts refresh.
- **`app-tauri/src/screens/ingest.js`** — second drop zone next to the file picker for "Pick a folder", mutually-exclusive selection (picking one clears the other), submit handler branches on file vs folder, status copy reports `ingested N/M files · K rows · failed F`. Added `learning_material` and `test_doc` source-type tiles.

## Files Created

- `changelogs/2026-04-25_02_ingest-folder-and-learning-source-types.md`

## Files Modified

- `src/reddit_research/cli/main.py` — `ingest folder` Typer command + `Any` import.
- `app-tauri/src-tauri/src/commands.rs` — `ingest_folder` Tauri command.
- `app-tauri/src-tauri/src/main.rs` — registers `commands::ingest_folder`.
- `app-tauri/src/api.js` — `ingestFolder` wrapper.
- `app-tauri/src/screens/ingest.js` — folder-pick UI, dual-mode submit, new source-type tiles.

## How it lands in the existing pipeline

1. Drop folder → each file parsed by `local_file.py` → row inserted in `posts` with the chosen `source_type`.
2. Enrich worker (already running, batch=5) reads from `extraction_queue` and runs the painpoint/feature/workaround LLM extractor against each new post — same code path as Reddit posts.
3. Findings land in `graph_nodes` keyed to the topic.
4. The graph relate pass adds `co_evidenced` / `relates_to` / `potentially_solves` edges between doc-derived findings and Reddit/HN/arXiv findings via ChromaDB MiniLM embeddings + shared evidence — so a painpoint that appears in both a Slack export and a Reddit thread gets a cross-source edge automatically.
5. Map / Insights / Chat / Solutions read graph_nodes filtered by topic — they don't differentiate between Reddit and ingested docs, which is the design goal.

## Out of scope (follow-ups)

- Provenance badge on findings ("from your file: design-doc.md") — useful for trust, but the current Evidence chip already exposes `source_type` so it's reachable today.
- "Knowledge" chip on the topic header showing N user-ingested docs.
- Folder-watch + auto-reingest on file change.
