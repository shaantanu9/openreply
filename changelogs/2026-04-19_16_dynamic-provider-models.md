# Dynamic model list per provider (replaces static curated chips)

**Date:** 2026-04-19
**Type:** Feature Enhancement

## Summary

The BYOK modal used a hardcoded `PROVIDER_CURATED_MODELS` map (3–4 picks per provider) to populate the click-to-activate chips. Users who actually wanted `claude-haiku-4-7` or `mistral-codestral-2501` or any of OpenRouter's 342 live models had to type them into the "Default provider" free-text field. This change hits each provider's `/models` REST endpoint server-side, returns the full live list, and feeds it into the chip grid — with a search filter once the list exceeds 15 models. Static curated picks remain as a fallback for providers where no key is saved yet and for transient fetch failures.

## Why server-side

Cloud LLM APIs (Anthropic, OpenAI, Groq, DeepSeek, Mistral) don't set CORS headers for arbitrary webview origins, so a direct `fetch()` from the Tauri window gets blocked. Routing through a Rust command via `reqwest` bypasses CORS entirely and keeps the API key on the Rust side rather than passing it as a JS argument.

OpenRouter and Google Gemini do allow browser fetch, but keeping one code path for all providers is simpler than branching per-provider in JS.

## Changes

### `app-tauri/src-tauri/Cargo.toml`

- Added `reqwest = { version = "0.12", default-features = false, features = ["json", "rustls-tls"] }` as a direct dep. `rustls-tls` avoids pulling in the system OpenSSL.

### `app-tauri/src-tauri/src/commands.rs`

- New `list_provider_models(provider: String) -> Result<Value, String>` command:
  - Reads the provider's API key from the shared BYOK env file (`~/.config/reddit-myind/.env`) via a new `read_byok_value(key)` helper.
  - Branches by provider for the per-vendor URL + auth header layout:
    - **Anthropic**: `GET /v1/models` with `x-api-key` + `anthropic-version: 2023-06-01`
    - **OpenAI / OpenRouter / Groq / DeepSeek / Mistral**: `GET /models` with `Authorization: Bearer <key>` (shared `fetch_openai_compat` helper)
    - **Google**: `GET /v1beta/models?key=<key>` (API key in query string)
    - **Ollama**: local `GET /api/tags` (no auth)
  - 15-second timeout per request; surfaces provider HTTP errors with their body text so the frontend can show a useful message.
- New `normalize_models(provider, raw)` function flattens each vendor's idiosyncratic response shape into a uniform `[{id, context_length?, description?}]` list. Filters out embedding-only / Whisper / DALL-E / TTS / moderation models from OpenAI-compat responses (blocklist heuristic on the id substring). For Google, filters to models with `supportedGenerationMethods` containing `generateContent`. For Ollama, filters out `bert` / `nomic-bert` families and anything with `embed` in the name — same rule the BYOK-test code already used.

### `app-tauri/src-tauri/src/main.rs`

- Registered `commands::list_provider_models` in the `generate_handler!` macro.

### `app-tauri/src/api.js`

- New binding: `listProviderModels(provider) => cachedInvoke('list_provider_models', { provider }, 5 * 60 * 1000)`. Cached for 5 min — clicking "Keys" repeatedly doesn't hammer the provider's rate limit.
- `byokSet` now invalidates both `byok_status` and `list_provider_models` caches so a freshly saved key is picked up on the next modal open without a page reload.

### `app-tauri/src/screens/byok.js`

- `renderCuratedChipsHtml(providerKey)` now renders a placeholder shell: a "Loading models…" header, an initially-hidden filter input, and an empty grid. Live chips are swapped in async.
- New internal helper `_renderChipHtml(providerKey, models, activeProvider, activeModel)` — accepts a uniform `[{id, label?, note?}]` array, used by both live-fetch and static paths. Keeps chip styling consistent.
- `renderCuratedChips` rewritten as async:
  - If the provider has no API key saved → paints static `PROVIDER_CURATED_MODELS` picks with a hint _"Save an API key to see every available model"_.
  - If a key is saved → awaits `api.listProviderModels(providerKey)`, sorts the list (active model floated to the top), paints chips. Surfaces a filter input when the list has > 15 entries (live-filters by `id` or `description` substring).
  - On fetch error → still paints the static picks, with a short error reason in the header (e.g. _"Live fetch failed: 429 rate_limit"_). UI stays usable.
- `paintAllChips(prov, model)` is now async: re-reads BYOK status first (so newly-saved keys unlock live fetch immediately), then calls `renderCuratedChips` for every non-Ollama provider in parallel. All existing call sites keep working because none of them awaited the old version — the repaint is fire-and-forget.

## Verification

- `cargo check` → clean, dev profile finished in 13.58s (transitive reqwest deps compile once).
- `node --check byok.js` and `node --check api.js` → clean.
- `npm run build` → 1733 modules transformed, 1.18s.
- Live test: `curl https://openrouter.ai/api/v1/models` with the user's saved key returned **342 models**. Grocery list confirmed — frontend will paginate/filter as expected.

## UX delta

Before:
- OpenRouter card: 4 curated chips (`claude-sonnet-4-6`, `gpt-4o`, `llama-3.3-70b`, `deepseek-chat`)
- User types anything else into the free-text box

After:
- OpenRouter card: **342 live chips** with their live names; search box to narrow the list
- Active model always at the top (green checkmark preserved)
- Graceful fallback to the 4 curated chips if OpenRouter returns an error
- Same pattern across Anthropic / OpenAI / Groq / DeepSeek / Mistral / Google

## Files Modified

- `app-tauri/src-tauri/Cargo.toml`
- `app-tauri/src-tauri/src/commands.rs`
- `app-tauri/src-tauri/src/main.rs`
- `app-tauri/src/api.js`
- `app-tauri/src/screens/byok.js`
