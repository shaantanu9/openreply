// Shared LLM-readiness helper.
//
// Single source of truth for "does the user have any LLM provider set up?"
// Accepts either:
//   - a cloud key (anthropic / openai / openrouter / groq / deepseek / mistral / google)
//   - local Ollama (detected via ollama_base_url, or the `ollama` boolean flag)
//
// Reads through api.byokStatus, which is cache-invalidated by api.byokSet on
// every key change — so a call here right after Settings-save returns fresh
// state, not the 30s-cached previous value.

import { api } from '../api.js';

const CLOUD_PROVIDERS = [
  'anthropic', 'openai', 'openrouter',
  'groq', 'deepseek', 'mistral', 'google',
];

export async function hasLlmConfigured() {
  try {
    const s = await api.byokStatus();
    if (!s) return false;
    if (s.ollama || s.ollama_base_url) return true;
    return CLOUD_PROVIDERS.some(p => s?.[p]?.set);
  } catch {
    return false;
  }
}

// Richer variant — returns the same boolean plus which providers are ready,
// for screens that want to say "using Anthropic" or "using local Ollama".
export async function llmStatus() {
  try {
    const s = await api.byokStatus();
    if (!s) return { ready: false, providers: [], ollama: false };
    const providers = CLOUD_PROVIDERS.filter(p => s?.[p]?.set);
    const ollama = !!(s.ollama || s.ollama_base_url);
    return { ready: providers.length > 0 || ollama, providers, ollama };
  } catch {
    return { ready: false, providers: [], ollama: false };
  }
}
