// OpenReply frontend API — thin wrappers over the Rust commands (command triangle:
// here → commands.rs → openreply CLI → reply/agent/content engine → reply_* SQLite).
// In a plain browser (no Tauri) calls return null so the static prototype still renders.
import { invoke } from "@tauri-apps/api/core";

const TAURI = typeof window !== "undefined" &&
  !!(window.__TAURI_INTERNALS__ || window.__TAURI__);

// ── Stale-while-revalidate read cache ───────────────────────────────────────
// SQLite itself is sub-millisecond, but every command shells out to the Python
// sidecar (cold spawn ≈ seconds). To make navigation feel instant we return the
// last-known result from localStorage immediately and refresh in the background.
// Writes invalidate the affected read families so the next read is authoritative.
// First-ever (cold-cache) load still awaits the backend — the screen skeleton
// covers that one-time gap.
const SWR_READS = new Set([
  "agent_list", "agent_get", "agent_knowledge", "agent_personas", "agent_brain", "agent_graph",
  "reply_platforms", "reply_list", "reply_drafts", "content_list",
  "persona_agent_list", "sub_list", "geo_list", "geo_history", "analytics_summary",
  "alerts_list", "feeds_list",
  "byok_status",
  "reddit_account_status", "app_data_dir", "agent_learn_status",
]);
const SWR_PREFIX = "or-swr:";
const _mem = new Map();

const _key = (cmd, args) => SWR_PREFIX + cmd + ":" + JSON.stringify(args || {});
function _readCache(k) {
  if (_mem.has(k)) return _mem.get(k);
  try { const r = localStorage.getItem(k); if (r != null) { const v = JSON.parse(r); _mem.set(k, v); return v; } } catch (e) {}
  return undefined;
}
function _writeCache(k, v) {
  _mem.set(k, v);
  try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {}
}
function _clearAll() {
  _mem.clear();
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(SWR_PREFIX)) localStorage.removeItem(k);
    }
  } catch (e) {}
}
function _invalidate(fams) {
  const hit = (k) => fams.has(k.slice(SWR_PREFIX.length).split("_")[0]);
  for (const k of [..._mem.keys()]) if (hit(k)) _mem.delete(k);
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(SWR_PREFIX) && hit(k)) localStorage.removeItem(k);
    }
  } catch (e) {}
}
// A write to `cmd` dirties its own family plus any whose results derive from it.
function _invalidateForWrite(cmd) {
  if (cmd.includes("reset")) return _clearAll();
  const fam = cmd.split("_")[0];
  const fams = new Set([fam]);
  // reply/content lifecycle changes opportunities, drafts AND agent knowledge counts.
  if (fam === "reply" || fam === "content") { fams.add("reply"); fams.add("content"); fams.add("agent"); }
  // agent/persona writes (create/use/update/link) re-scope reply + content too.
  if (fam === "agent" || fam === "persona") { fams.add("agent"); fams.add("persona"); fams.add("reply"); fams.add("content"); }
  // Analytics aggregates opportunities + content + geo citation rate, so any of
  // those writes (incl. geo checks) must bust the analytics roll-up.
  if (fam === "reply" || fam === "content" || fam === "geo") { fams.add("analytics"); }
  _invalidate(fams);
}

// ── Hard timeout + tolerant-JSON guard ──────────────────────────────────────
// Tauri's `invoke` has no built-in timeout, so a cold/stuck sidecar (macOS
// Gatekeeper can stall the first spawn for minutes) would otherwise leave the
// UI spinning forever. We race every call against a ceiling: snappy reads/writes
// get 120 s, while genuinely long LLM / collect / learn ops get 6 min so real
// work is never cut short. On timeout the promise rejects and the caller's catch
// path renders an error instead of an infinite "Loading…".
const DEFAULT_TIMEOUT_MS = 120_000;
const LONG_TIMEOUT_MS = 360_000;
const LONG_COMMANDS = new Set([
  "agent_learn", "agent_refresh", "agent_build_graph", "agent_brain_relink",
  "agent_evolve", "agent_teach_video", "agent_ideas", "agent_idea_draft",
  "agent_digest", "agent_digest_search", "agent_corpus_check", "agent_autopilot_run",
  "content_generate", "reply_find", "reply_post_due", "reply_growth_plan",
  "sub_intel", "sub_discover", "account_fetch",
  "x_account_fetch_posts", "x_account_fetch_thread", "x_account_save_to_library",
  "geo_check", "geo_check_all", "palace_reindex",
]);

class TimeoutError extends Error {}

// The Rust bridge returns `{_parse_error:true, _parse_error_message, _raw}` when
// the sidecar emitted non-JSON on a command we expected JSON from. Surface it as
// a real rejection so the caller shows a diagnostic, not a silently-blank screen.
function _checkParseError(v) {
  if (v && typeof v === "object" && (v._parse_error || v._parse_error_message)) {
    const e = new Error(v._parse_error_message || "the engine returned malformed output");
    e.parseError = true;
    e.raw = v._raw;
    throw e;
  }
  return v;
}

function _invoke(cmd, args) {
  const ms = LONG_COMMANDS.has(cmd) ? LONG_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(
      `“${cmd}” timed out after ${Math.round(ms / 1000)}s — the engine may be busy or unreachable. Try again.`)), ms);
  });
  const run = Promise.resolve(invoke(cmd, args || {})).then(_checkParseError);
  return Promise.race([run, timeout]).finally(() => clearTimeout(timer));
}

async function call(cmd, args) {
  if (!TAURI) return null;
  if (SWR_READS.has(cmd)) {
    const k = _key(cmd, args);
    const cached = _readCache(k);
    const fresh = _invoke(cmd, args)
      .then((v) => { _writeCache(k, v); return v; })
      .catch((e) => { if (cached === undefined) throw e; return cached; });
    if (cached !== undefined) { fresh.catch(() => {}); return cached; } // instant + bg refresh
    return await fresh;                                                  // cold cache: await real data
  }
  const res = await _invoke(cmd, args);
  _invalidateForWrite(cmd);
  return res;
}

export const api = {
  isTauri: () => TAURI,
  clearCache: _clearAll,   // drop SWR caches (Settings reset / force refresh)
  // agents
  agentList: () => call("agent_list"),
  agentGet: (id) => call("agent_get", { id: id || null }),
  agentCreate: (p) => call("agent_create", p),
  agentUse: (id) => call("agent_use", { id }),
  agentRefresh: (id, deep) => call("agent_refresh", { id: id || null, deep: !!deep }),
  agentKnowledge: (id) => call("agent_knowledge", { id: id || null }),
  agentLearn: (id, limit) => call("agent_learn", { id: id || null, limit: limit || 30 }),
  agentLearnStatus: (id) => call("agent_learn_status", { id: id || null }),
  accountTrack: (handle, note) => call("account_track", { handle, note: note || null, id: null }),
  accountList: () => call("account_list", { id: null }),
  accountUntrack: (handle) => call("account_untrack", { handle, id: null }),
  accountFetch: (handle, learn) => call("account_fetch", { handle: handle || null, learn: !!learn, id: null }),
  agentCorpus: (source, query, limit, offset, relevance) => call("agent_corpus", { id: null, source: source || null, query: query || null, relevance: relevance || null, limit: limit || 60, offset: offset || 0 }),
  agentCorpusCheck: (limit) => call("agent_corpus_check", { id: null, limit: limit || 60 }),
  agentAutopilot: (id) => call("agent_autopilot", { id: id || null }),
  agentAutopilotSet: (cfg) => call("agent_autopilot_set", {
    id: null,
    content: cfg && cfg.content != null ? cfg.content : null,
    contentKinds: (cfg && cfg.contentKinds) || null,
    contentCount: cfg && cfg.contentCount != null ? cfg.contentCount : null,
    contentCadence: (cfg && cfg.contentCadence) || null,
    opportunity: cfg && cfg.opportunity != null ? cfg.opportunity : null,
    oppCount: cfg && cfg.oppCount != null ? cfg.oppCount : null,
    oppCadence: (cfg && cfg.oppCadence) || null,
  }),
  agentAutopilotRun: (id) => call("agent_autopilot_run", { id: id || null }),
  agentBuildGraph: (deep, id) => call("agent_build_graph", { id: id || null, deep: !!deep }),
  agentGraph: (id) => call("agent_graph", { id: id || null }),
  agentBrain: (id) => call("agent_brain", { id: id || null }),
  agentBrainRelink: (id, semantic) => call("agent_brain_relink", { id: id || null, semantic: semantic !== false }),
  agentTeachVideo: (url, id, comments) => call("agent_teach_video", { url, id: id || null, comments: comments || 100 }),
  agentUpdate: (p) => call("agent_update", p),
  agentDelete: (id) => call("agent_delete", { id }),
  // agent ↔ persona links (blend a persona's knowledge into this agent's replies)
  agentPersonas: (id) => call("agent_personas", { id: id || null }),
  agentLinkPersona: (personaId, agentId, weight) =>
    call("agent_link_persona", { personaId, agentId: agentId || null, weight: weight ?? null }),
  agentUnlinkPersona: (personaId, agentId) =>
    call("agent_unlink_persona", { personaId, agentId: agentId || null }),
  // learning personas (single-lens knowledge agents) — used to populate the link picker
  personaList: () => call("persona_agent_list"),
  replyRules: (sub, refresh) => call("reply_rules", { sub, refresh: !!refresh }),
  // goal + self-evolving playbook + idea synthesis
  agentGoalSet: (objective, audience, winSignal, guardrails) =>
    call("agent_goal_set", { objective: objective || "", audience: audience || "",
      winSignal: winSignal || "", guardrails: guardrails || "" }),
  agentPlaybook: () => call("agent_playbook_get"),
  agentEvolve: () => call("agent_evolve"),
  agentIdeas: (suggest, n) => call("agent_ideas", { suggest: !!suggest, n: n || 5 }),
  agentDigest: (rebuild) => call("agent_digest", { rebuild: !!rebuild }),
  agentDigestSearch: (query) => call("agent_digest_search", { query: query || "" }),
  // tasks (knowledge → action → sections)
  taskList: (status) => call("agent_task_list", { status: status || null }),
  taskCreate: (o) => call("agent_task_create", {
    title: o.title, kind: o.kind || "custom", target: o.target || "",
    payload: o.payload || null, source: o.source || "manual",
    sourceRef: o.source_ref || o.sourceRef || "", note: o.note || "",
  }),
  taskUpdate: (id, fields) => call("agent_task_update", { task: id, ...(fields || {}) }),
  taskDelete: (id) => call("agent_task_delete", { task: id }),
  agentIdeaDraft: (idea, kind, platform) =>
    call("agent_idea_draft", { idea, kind: kind || "", platform: platform || "" }),
  agentIdeaStatus: (idea, status) => call("agent_idea_status", { idea, status }),
  // reply / opportunities
  replyPlatforms: () => call("reply_platforms"),
  replyFind: (platforms, limit, noScore) =>
    call("reply_find", { platforms: platforms || null, limit: limit || 15, noScore: !!noScore }),
  replyList: (status, minScore, limit, opts) =>
    call("reply_list", {
      status: status || null, minScore: minScore || 0, limit: limit || 30,
      query: (opts && opts.query) || null,
      sort: (opts && opts.sort) || "score",
      offset: (opts && opts.offset) || 0,
      platform: (opts && opts.platform) || null,
    }),
  replySourceCounts: () => call("reply_source_counts"),
  replyDraft: (opportunity) => call("reply_draft", { opportunity }),
  // workspace: edit/save (versioned), approve, queue, snooze, draft history
  replySaveDraft: (opportunity, text) => {
    const p = call("reply_save_draft", { opportunity, text });
    p.then(() => { try { window.dispatchEvent(new CustomEvent("or-inbox-changed")); } catch (e) {} }).catch(() => {});
    return p;
  },
  replyDrafts: (opportunity) => call("reply_drafts", { opportunity }),
  replyApprove: (opportunity) => call("reply_approve", { opportunity }),
  replyQueue: (opportunity, scheduledAt) =>
    call("reply_queue", { opportunity, scheduledAt: scheduledAt || null }),
  replySnooze: (opportunity, hours) => call("reply_snooze", { opportunity, hours: hours || 24 }),
  replyPostDue: () => call("reply_post_due"),
  replyGrowthPlan: (id) => call("reply_growth_plan", { id: id || null }),
  replyGrowthGet: (id) => call("reply_growth_get", { id: id || null }),
  // Telegram / Slack notifications
  notifyGet: () => call("notify_get"),
  notifySet: (cfg) => call("notify_set", {
    enabled: cfg.enabled ?? null,
    twoWay: cfg.twoWay ?? null,
    telegramToken: cfg.telegramToken ?? null,
    telegramChat: cfg.telegramChat ?? null,
    slackWebhook: cfg.slackWebhook ?? null,
    minScore: cfg.minScore ?? null,
    evOpportunity: cfg.evOpportunity ?? null,
    evArticle: cfg.evArticle ?? null,
    evReply: cfg.evReply ?? null,
    evDigest: cfg.evDigest ?? null,
    evGeo: cfg.evGeo ?? null,
  }),
  notifyTest: () => call("notify_test"),
  botPollOnce: () => call("bot_poll_once"),
  // subreddit intelligence
  redditAccountStatus: () => call("reddit_account_status"),
  subDiscover: (limit, autoTrackTop) => call("sub_discover", { limit: limit || 8, autoTrackTop: autoTrackTop || 0 }),
  subList: () => call("sub_list"),
  subIntel: (sub, refresh) => call("sub_intel", { sub, refresh: !!refresh }),
  subTrack: (sub, off) => call("sub_track", { sub, off: !!off }),
  subCheck: (sub, text) => call("sub_check", { sub, text }),
  replySetStatus: (opportunity, status) => {
    const p = call("reply_set_status", { opportunity, status });
    p.then(() => { try { window.dispatchEvent(new CustomEvent("or-inbox-changed")); } catch (e) {} }).catch(() => {});
    return p;
  },
  // alerts + AI-visibility (GEO)
  alertsList: () => call("alerts_list"),
  alertsAdd: (rule, channel, intentMin, scoreMin) =>
    call("alerts_add", { rule, channel: channel || "email", intentMin: intentMin || "any", scoreMin: scoreMin || 0 }),
  alertsDelete: (id) => call("alerts_delete", { id }),
  geoList: () => call("geo_list"),
  geoAdd: (query, surface) => call("geo_add", { query, surface: surface || "ChatGPT" }),
  geoSet: (id, status) => call("geo_set", { id, status }),
  geoDelete: (id) => call("geo_delete", { id }),
  geoCheck: (id) => call("geo_check", { id }),
  geoCheckAll: () => call("geo_check_all"),
  geoHistory: (id) => call("geo_history", { id }),
  // analytics
  analyticsSummary: (days) => call("analytics_summary", { days: days || 30 }),
  // content
  contentGenerate: (kind, platform, angle, ctx) =>
    call("content_generate", {
      kind, platform: platform || null, angle: angle || "",
      contextId: (ctx && ctx.contextId) || null,
      contextText: (ctx && ctx.contextText) || "",
    }),
  contentList: (kind, status, limit) =>
    call("content_list", { kind: kind || null, status: status || null, limit: limit || 30 }),
  contentDelete: (id) => call("content_delete", { id }),
  contentUpdate: (id, fields) =>
    call("content_update", {
      id,
      body: fields && fields.body != null ? fields.body : null,
      status: (fields && fields.status) || null,
      scheduledAt: fields && fields.scheduledAt != null ? fields.scheduledAt : null,
    }),
  // ── Publish to social (X/Twitter) — credential-gated; dryRun previews tweets ──
  publishStatus: () => call("publish_status"),
  publishSetXCreds: (apiKey, apiSecret, accessToken, accessSecret) =>
    call("publish_set_x_creds", { apiKey, apiSecret, accessToken, accessSecret }),
  contentPublishX: (id, dryRun) => call("content_publish_x", { contentId: id, dryRun: !!dryRun }),
  contentPublishXReply: (replyToTweetId, text, dryRun) =>
    call("content_publish_x_reply", { replyToTweetId, text, dryRun: !!dryRun }),
  // ── Minimal X-account worktree (MVP) ──
  xAccountAdd: (handle, authToken, ct0) =>
    call("x_account_add", { handle, authToken: authToken || null, ct0: ct0 || null }),
  xAccountImportBrowser: (handle) => call("x_account_import_browser", { handle }),
  xAccountList: () => call("x_account_list"),
  xAccountProfile: (handle) => call("x_account_profile", { handle }),
  xAccountFetchPosts: (handle, count, withThreads) =>
    call("x_account_fetch_posts", { handle, count: count || 10, withThreads: !!withThreads }),
  xAccountFetchThread: (handle, tweetIdOrUrl, limit) =>
    call("x_account_fetch_thread", { handle, tweetIdOrUrl, limit: limit || 50 }),
  xAccountSaveToLibrary: (handle, count, withThreads) =>
    call("x_account_save_to_library", { handle, count: count || 25, withThreads: !!withThreads }),
  // ── Connections (Reach credentials) — creds_* return a JSON array; the
  // single-result ops return a 1-element array, so callers take [0]. ──
  credsList: () => call("creds_list"),
  credsImportBrowser: (source, browser) =>
    call("creds_import_browser", { source, browser: browser || null }),
  credsSaveManual: (source, value) => call("creds_save_manual", { source, value }),
  credsVerify: (source) => call("creds_verify", { source }),
  credsDelete: (source) => call("creds_delete", { source }),
  credsToggle: (source, enabled) => call("creds_toggle", { source, enabled }),
  credsPreview: (source, query, limit) => call("creds_preview", { source, query: query || null, limit: limit || 6 }),
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
  // ── Settings: automation (real launchd auto collect+learn on an interval) ──
  scheduleStatus: () => call("schedule_status"),
  scheduleInstall: (intervalHours) => call("schedule_install", { intervalHours: intervalHours || 24 }),
  scheduleUninstall: () => call("schedule_uninstall"),
  // ── Settings: connect to MCP clients (Claude Code / Cursor / …) ──
  mcpClients: () => call("mcp_clients"),
  mcpStatus: (client) => call("mcp_status", { client: client || null }),
  mcpInstall: (client) => call("mcp_install", { client: client || null }),
  mcpUninstall: (client) => call("mcp_uninstall", { client: client || null }),
  mcpConfigSnippet: (client) => call("mcp_config_snippet", { client: client || null }),
  // ── Settings: usage & limits (token cap, today's spend, cost model) ──
  extractionPrefsGet: (topic) => call("extraction_prefs_get", { topic: topic || null }),
  extractionPrefsSet: (scope, prefs) => call("extraction_prefs_set", { scope: scope || "global", prefs: prefs || {} }),
  todayTokenSpend: () => call("today_token_spend"),
  costModelGet: () => call("cost_model_get"),
  // ── Settings: power tools (CLI symlink, export folder) ──
  installCli: () => call("install_cli_symlink"),
  uninstallCli: () => call("uninstall_cli_symlink"),
  cliSymlinkStatus: () => call("cli_symlink_status"),
  exportPrefsGet: () => call("export_prefs_get"),
  exportPrefsSet: (exportDir) => call("export_prefs_set", { exportDir: exportDir || null }),
  // ── Startup diagnostics (sidecar / DB / LLM provider) ──
  healthCheck: () => call("health_check"),
  // ── Settings: about / version + semantic-memory (palace) engine ──
  cliInfo: () => call("cli_info"),
  checkAppVersion: () => call("check_app_version"),
  palaceModelStatus: () => call("palace_model_status"),
  palaceStats: () => call("palace_stats"),
  palaceReindex: () => call("palace_reindex"),
};

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
