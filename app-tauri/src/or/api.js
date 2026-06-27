// OpenReply frontend API — thin wrappers over the Rust commands (command triangle:
// here → commands.rs → gapmap CLI → reply/agent/content engine → reply_* SQLite).
// In a plain browser (no Tauri) calls return null so the static prototype still renders.
import { invoke } from "@tauri-apps/api/core";

const TAURI = typeof window !== "undefined" &&
  !!(window.__TAURI_INTERNALS__ || window.__TAURI__);

async function call(cmd, args) {
  if (!TAURI) return null;
  return await invoke(cmd, args || {});
}

export const api = {
  isTauri: () => TAURI,
  // agents
  agentList: () => call("agent_list"),
  agentGet: (id) => call("agent_get", { id: id || null }),
  agentCreate: (p) => call("agent_create", p),
  agentUse: (id) => call("agent_use", { id }),
  agentRefresh: (id, deep) => call("agent_refresh", { id: id || null, deep: !!deep }),
  agentKnowledge: (id) => call("agent_knowledge", { id: id || null }),
  // reply / opportunities
  replyPlatforms: () => call("reply_platforms"),
  replyFind: (platforms, limit, noScore) =>
    call("reply_find", { platforms: platforms || null, limit: limit || 15, noScore: !!noScore }),
  replyList: (status, minScore, limit) =>
    call("reply_list", { status: status || null, minScore: minScore || 0, limit: limit || 30 }),
  replyDraft: (opportunity) => call("reply_draft", { opportunity }),
  // content
  contentGenerate: (kind, platform, angle) =>
    call("content_generate", { kind, platform: platform || null, angle: angle || "" }),
  contentList: (kind, status, limit) =>
    call("content_list", { kind: kind || null, status: status || null, limit: limit || 30 }),
  // ── Connections (Reach credentials) — creds_* return a JSON array; the
  // single-result ops return a 1-element array, so callers take [0]. ──
  credsList: () => call("creds_list"),
  credsImportBrowser: (source, browser) =>
    call("creds_import_browser", { source, browser: browser || null }),
  credsSaveManual: (source, value) => call("creds_save_manual", { source, value }),
  credsVerify: (source) => call("creds_verify", { source }),
  credsDelete: (source) => call("creds_delete", { source }),
  // ── Settings: BYOK / LLM provider ──
  byokStatus: () => call("byok_status"),
  byokSet: (name, value) => call("byok_set", { name, value }),
  testLlm: (provider, model) => call("test_llm", { provider: provider || null, model: model || null }),
  listProviderModels: (provider) => call("list_provider_models", { provider }),
  listOllamaModels: () => call("list_ollama_models"),
  // ── Settings: custom RSS feeds ──
  feedsList: () => call("feeds_list"),
  feedsValidate: (url) => call("feeds_validate", { url }),
  feedsAdd: (url, name) => call("feeds_add", { url, name: name || "" }),
  feedsRemove: (url) => call("feeds_remove", { url }),
  feedsEnable: (url, enabled) => call("feeds_enable", { url, enabled: !!enabled }),
  // ── Settings: data & account ──
  appDataDir: () => call("app_data_dir"),
  revealInFinder: (path) => call("reveal_in_finder", { path }),
  openUrl: (url) => call("open_url", { url }),
  appResetPreview: () => call("app_reset_preview"),
  appHardReset: () => call("app_hard_reset"),
  appRelaunch: () => call("app_relaunch"),
};

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
