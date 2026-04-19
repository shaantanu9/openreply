# Future scope — bundled local LLM (llama.cpp + Gemma 3)

**Status:** design-only, not implemented. Filed 2026-04-19.

## Goal

Ship one DMG. User clicks "Enable local mode" → app downloads a Gemma 3 GGUF
and runs inference **inside the app**, no Ollama install, no Python, no
external dependencies.

## Why not AirLLM

Investigated 2026-04-19. AirLLM is a disk-streaming trick for fitting huge
models in tiny VRAM — Python-only, no CLI/HTTP server, <1 tok/s on
70B through SSD I/O. Not usable for interactive chat on Mac.

## Architecture

| Piece | What it is |
|---|---|
| `llama-server` binary (~30–50 MB, MIT) | Single self-contained Mac-arm64 binary. OpenAI-compatible HTTP on localhost. Metal GPU acceleration. |
| Gemma 3 GGUF weights | Downloaded on first "Enable local" click from HuggingFace into `~/Library/Application Support/com.shantanu.gapmap/models/`. Not bundled — keeps DMG under 100 MB. |
| Frontend | Adds a "Local (Gemma)" provider in `byok.js` that sets `baseURL=http://localhost:<port>` and skips API-key check. |

## Why llama.cpp over MLX-LM / Ollama

- Single static binary, no Python → clean codesign + notarize
- Runs Gemma 3 (1B / 4B / 12B / 27B all have official GGUFs on HF)
- ~40–80 tok/s for Gemma 3 4B Q4 on 16 GB M1/M2/M3
- Drop-in OpenAI-compatible API — no backend rewrite
- MIT-licensed, safe to redistribute

## Recommended model matrix (surface in GUI)

| Model | Quantized size | RAM needed | Download URL |
|---|---|---|---|
| Gemma 3 1B Q4 | ~0.8 GB | 4 GB | huggingface.co/google/gemma-3-1b-it-GGUF |
| Gemma 3 4B Q4 | ~2.5 GB | 8 GB | huggingface.co/google/gemma-3-4b-it-GGUF |
| Gemma 3 12B Q4 | ~7 GB | 16 GB | huggingface.co/google/gemma-3-12b-it-GGUF |
| Gemma 3 27B Q4 | ~16 GB | 32 GB | huggingface.co/google/gemma-3-27b-it-GGUF |

## Licensing caveat

Gemma uses **Google's Gemma Terms of Use** (not pure OSS). Commercial use is
allowed but we must pass through the use restrictions / prohibited-use policy.
llama.cpp itself is MIT. Ship: include Gemma terms in the About screen.

## Implementation sketch (~1 day once prioritised)

1. Add `llama-server-aarch64-apple-darwin` to `app-tauri/src-tauri/binaries/` and
   register alongside `reddit-cli` in `tauri.conf.json` `externalBin` list.
2. Add Rust command `start_local_llm(model_path)` → spawns sidecar, returns port.
3. Add Rust command `download_model(repo, filename)` → streams GGUF into the
   app data dir with progress events (`model:progress`, `model:done`).
4. New tab in `byok.js`: "Local (Gemma)" — model picker with disk
   requirements, download button (progress bar), Start/Stop toggle,
   current-model indicator.
5. OpenAI-compatible calls just point at `http://localhost:<port>/v1`.

## Not doing now because

- Ollama path covers the same user needs (and user already has it installed
  and running with 7 models) — see `docs/superpowers/specs/2026-04-19-ollama-gui-design.md`
- Full bundle-local work is ~1 day of focused work plus codesign/notarize
  debugging — defer until after Ollama GUI ships and gets feedback.
- No user has actually asked for "one DMG no install" yet — it's a future UX
  improvement, not a blocker.

## Reference

Earlier Claude-assisted investigation dated 2026-04-19 in this repo conversation.
Key findings: AirLLM unsuitable, llama.cpp + Gemma 3 is the right path, weights
must download-on-first-launch (can't ship in DMG: 4B=16 GB, 70B=140 GB, Apple
notarization 4 GB/file limit).
