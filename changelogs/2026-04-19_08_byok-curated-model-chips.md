# BYOK: click-to-activate model chips for every provider

**Date:** 2026-04-19
**Type:** UI Enhancement

## Summary

Previously the BYOK modal only gave Ollama a click-to-activate model chip UX — all other cloud providers required a trip to a separate "Default provider" tab and manual typing of the model name. Extended Ollama's chip pattern to every provider so picking a default LLM is always one click, and added a global "active provider · model" banner at the top of the modal.

## Changes

- Added `PROVIDER_CURATED_MODELS` map with 3–4 recommended models per cloud provider (Anthropic, OpenAI, OpenRouter, Groq, DeepSeek, Mistral, Google Gemini)
- Each provider card now renders its curated models as clickable chips below the Save/Test/Clear row
- Clicking a chip writes `LLM_PROVIDER` and `LLM_MODEL` in one shot, shows a green checkmark on the active model, and updates the "Active →" banner
- Added `#byok-active-banner` at the top of the modal showing `Active → <provider pill> <model>` (or a hint to pick one when no default is set yet)
- Banner + all chip grids re-paint when the default is changed from any surface: the chip, the existing "Default provider" tab, or the Ollama chip grid
- Guard: clicking a cloud chip when that provider has no API key saved shows a toast ("Save an Anthropic API key first") instead of silently writing a broken default
- The "Default provider" tab is preserved for power users who want to type custom model strings (e.g. OpenRouter `provider/model` combos or exotic Ollama tags)

## Files Modified

- `app-tauri/src/screens/byok.js` — added `PROVIDER_CURATED_MODELS`, `renderCuratedChipsHtml`, `renderCuratedChips`, active-banner painter (`paintBanner`), chip grid painter (`paintAllChips`), delegated chip-click handler, banner repaints inside the existing Ollama-chip and Save-default handlers
