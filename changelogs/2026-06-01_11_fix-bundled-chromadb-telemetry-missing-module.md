# Fix: bundled chat/RAG dead — PyInstaller missed chromadb.telemetry.product.posthog

**Date:** 2026-06-01
**Type:** Fix

## Summary

The app's topic chat showed "✗ Timed out after 5 min with no response. Provider may be unreachable — check the LLM provider in Settings." Investigation found **two** independent causes, both in the bundled `openreply-cli` (the venv binary works fully):

1. **Disk-full / onefile `_MEI` hang** (covered in `2026-06-01_10`): while the disk was 100% full, the bundled binary hung in PyInstaller extraction → the chat sidecar emitted no events → the UI's 5-min `hardTimer` fired with the "Provider may be unreachable" message. Fixed by disk reclaim + the new `_MEI` startup sweep.

2. **THIS fix — missing chromadb submodule.** With the disk healthy, the bundled chat cold-starts (~46 s extraction), emits `start`, then dies with:
   ```
   {"event": "error", "error": "No module named 'chromadb.telemetry.product.posthog'"}
   ```
   ChromaDB 1.5.x initializes its product-telemetry client by **dynamically importing** `chromadb.telemetry.product.posthog` via importlib. PyInstaller's static analysis (`collect_all('openreply')`) reaches chromadb's top level but not this dynamically-referenced submodule, so it was absent from the bundle. The moment any palace-grounded operation ran (chat RAG, semantic search, graph build), the bundled binary raised `ModuleNotFoundError`. The dev venv has the module, so it never reproduced in `tauri:dev`.

   Note: `palace.py:313` already sets `Settings(anonymized_telemetry=False)`. That only suppresses *sending* events — ChromaDB still *imports* the telemetry impl at system init, so disabling telemetry does NOT avoid the import. Bundling the module is the necessary fix.

## Root cause (evidence)

- venv `openreply research chat ... --json` → streamed full token response (provider `nvidia`, llama-3.3-70b), 18 s.
- bundled `openreply-cli research chat ... --json` → `start` event at ~46 s, then `{"event":"error","error":"No module named 'chromadb.telemetry.product.posthog'"}`.
- `collect_submodules('chromadb')` / `collect_all('chromadb')` both include `chromadb.telemetry.product.posthog` (128 submodules) → adding chromadb to the spec resolves the dynamic import.

## Changes

- `openreply-cli.spec`: added `'chromadb'` to the explicit `collect_all(...)` loop so all 128 chromadb submodules (incl. the dynamically-imported telemetry backends) are bundled. Verified `collect_all('chromadb')` returns 239 datas + 128 hiddenimports including the missing module.

## Files Modified

- `openreply-cli.spec`

## Impact / scope

- Fixes bundled chat RAG grounding **and** any other bundled feature that performs a ChromaDB `query()`/`add()` (semantic search, graph densify, mempalace) — all of which would have hit the same `ModuleNotFoundError`.

## Verification

- Spec parses; `collect_all('chromadb')` confirmed to include `chromadb.telemetry.product.posthog`.
- ⚠️ **Requires a rebuild of `openreply-cli` to take effect** — the installed app stays broken for palace-grounded chat until rebuilt/reinstalled. Cannot be verified at runtime without building the PyInstaller binary.

## Recommendation

This is more severe than the disk issue: chat/RAG is dead in the *current* bundled app even with a healthy disk. A rebuild is needed for chat to work. Pairs naturally with the onefile→onedir change in `docs/manual-todo/onefile-to-onedir-and-mcp-verify.md` (do both in the next build).
