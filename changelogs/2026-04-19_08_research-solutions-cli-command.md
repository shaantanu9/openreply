# Research Solutions CLI Command

**Date:** 2026-04-19
**Type:** Feature

## Summary

Wired up the `solutions_pipeline()` orchestrator (Task 8) to the CLI and re-exported all new research-loop symbols from `research/__init__.py`. Users can now run `reddit-cli research solutions --topic <name>` to execute the full Problem -> Why -> Science -> Solution loop from the command line.

## Changes

- Added re-exports for `solutions_pipeline`, `synthesize_solutions_for_painpoint`, `extract_why_for_painpoint`, `extract_why_for_topic`, and `fetch_science_for_painpoint` to `research/__init__.py`
- Added `cmd_research_solutions` as `@research_app.command("solutions")` in `cli/main.py` with `--topic`, `--provider`, `--papers`, and `--json` options
- Provider resolution happens upfront with a clean error/skip path if no LLM is configured

## Files Modified

- `src/reddit_research/research/__init__.py` — appended 3 import lines + updated `__all__`
- `src/reddit_research/cli/main.py` — inserted `solutions` subcommand after `gaps` command
