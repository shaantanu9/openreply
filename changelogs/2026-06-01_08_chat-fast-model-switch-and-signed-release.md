# Chat reliability: fast-model switch + signed v0.1.7 release with chat fixes

**Date:** 2026-06-01
**Type:** Fix / Infrastructure

## Summary

Resolved the user-reported "chat not working / spins forever" by switching the configured NVIDIA model from the rate-limited `meta/llama-3.3-70b-instruct` (returning HTTP 429 on the free tier) to the fast, available `meta/llama-3.1-8b-instruct` (HTTP 200 in ~0.4s). Then cut a signed + notarized v0.1.7 release carrying the two source fixes (chat timestamp + LLM stream timeout) and swapped it into `/Applications/Gap Map.app`.

## Investigation highlights

- Reproduced `research chat --json` against the live corpus: backend, Rust dev-streaming, and frontend wiring all functionally correct.
- Probed NVIDIA endpoints directly: `llama-3.3-70b` → HTTP 429 (rate-limited), `llama-3.1-8b` → HTTP 200 in 0.4s. The 70B free-tier rate-limiting + the (old) no-timeout client = multi-minute stalls → the frontend's 5-minute "✗ Timed out" message.
- Confirmed the user was running the production `/Applications/Gap Map.app` (Developer ID signed + notarized), so source edits required a full signed release to take effect there.
- The persisted "✗ Timed out" message on the "Amla mouth freshener" thread was a saved DB row from an earlier stalled attempt, not a live failure.

## Changes

- `~/.config/gapmap/.env` and `~/.config/reddit-myind/.env`: set `LLM_MODEL=meta/llama-3.1-8b-instruct` (was empty → defaulted to the 70B). Backups saved as `.env.bak.<ts>`. Takes effect on the next chat send (each chat sidecar reloads `.env`).
- Built signed + notarized v0.1.7 via `scripts/publish-mac.sh --sign`:
  - Apple notarization Accepted (id `8e53904e-5b3a-415a-9b5a-2d098ce66c54`), stapled.
  - Verified bundled sidecar streams chat end-to-end on the 8B model (136 token events).
  - `spctl` → accepted, source=Notarized Developer ID; `stapler validate` → OK.
- Swapped the new build into `/Applications/Gap Map.app`; backed up the prior app to `/Applications/Gap Map.app.bak-20260601-152704`; relaunched.

## Notes

- The release bundled the current working tree, which included unrelated in-progress changes beyond the two chat fixes (`api.js`, `collect.js`, `cli.rs`, `gapmap-cli.spec`, `pyinstaller-entrypoint.py`, `install.py`, `mcp_bootstrap.js`, `settings.js`).
- `publish-mac.sh` Step 5a (a redundant post-notarization re-sign) errored with "A timestamp was expected but was not found" and aborted the script under `set -e`, so no standalone DMG/ZIP was emitted — irrelevant for the in-place `/Applications` swap, but worth fixing in the script later (the Tauri bundler already signs+notarizes+staples; Step 5a should be skipped when `--sign` already notarized).
- Source fixes (`topic.js`, `chat.py`) remain uncommitted in the working tree alongside the user's other WIP; left for the user to commit/stage explicitly.

## Files

- Modified config: `~/.config/gapmap/.env`, `~/.config/reddit-myind/.env`
- Installed: `/Applications/Gap Map.app` (new v0.1.7); backup `/Applications/Gap Map.app.bak-20260601-152704`
