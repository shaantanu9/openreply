//! Tauri commands invoked from the frontend via `invoke(...)`.
//!
//! Each command is a thin bridge to one openreply invocation. Heavy
//! lifting stays in Python.

use crate::cli::{
    data_dir, run_cli, run_cli_chat_streaming,
};
use serde_json::Value;
use tauri::{AppHandle, Manager};
use sha2::{Digest, Sha256};
use uuid::Uuid;

fn err_to_string<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

fn export_prefs_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = data_dir(app).map_err(err_to_string)?;
    Ok(dir.join("export_prefs.json"))
}

fn read_export_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let prefs = export_prefs_path(app)?;
    if !prefs.exists() {
        return data_dir(app).map_err(err_to_string);
    }
    let raw = std::fs::read_to_string(&prefs).map_err(err_to_string)?;
    let v: Value = serde_json::from_str(&raw).map_err(err_to_string)?;
    let configured = v
        .get("export_dir")
        .and_then(|x| x.as_str())
        .map(str::trim)
        .unwrap_or("");
    if configured.is_empty() {
        return data_dir(app).map_err(err_to_string);
    }
    let p = std::path::PathBuf::from(configured);
    if p.exists() && p.is_dir() {
        Ok(p)
    } else {
        data_dir(app).map_err(err_to_string)
    }
}

fn write_export_dir(app: &AppHandle, export_dir: Option<&str>) -> Result<(), String> {
    let dir = data_dir(app).map_err(err_to_string)?;
    let prefs = export_prefs_path(app)?;
    let tmp = dir.join("export_prefs.json.tmp");
    let mut map = serde_json::Map::new();
    if let Some(v) = export_dir {
        map.insert("export_dir".into(), Value::String(v.to_string()));
    } else {
        map.insert("export_dir".into(), Value::String(String::new()));
    }
    let body = Value::Object(map).to_string();
    std::fs::write(&tmp, body).map_err(err_to_string)?;
    std::fs::rename(&tmp, &prefs).map_err(err_to_string)?;
    Ok(())
}

/// `openreply info` — config + table counts.
#[tauri::command]
pub async fn cli_info(app: AppHandle) -> Result<Value, String> {
    run_cli(&app, vec!["info"]).await.map_err(err_to_string)
}

// ─────────────────────────────────────────────────────────────────────────
// OpenReply — Agents (personas), opportunities, and content generation.
// Thin bridges to `openreply agent|reply|content …`. Heavy work stays in Python.
// ─────────────────────────────────────────────────────────────────────────

/// `openreply reply platforms` — the pickable platform catalog.
#[tauri::command]
pub async fn reply_platforms(app: AppHandle) -> Result<Value, String> {
    run_cli(&app, vec!["reply", "platforms", "--json"]).await.map_err(err_to_string)
}

/// `openreply agent list` — all agents (active flagged).
#[tauri::command]
pub async fn agent_list(app: AppHandle) -> Result<Value, String> {
    run_cli(&app, vec!["agent", "list", "--json"]).await.map_err(err_to_string)
}

/// `openreply agent get` — the active agent (or a given id).
#[tauri::command]
pub async fn agent_get(app: AppHandle, id: Option<String>) -> Result<Value, String> {
    let mut args = vec!["agent".to_string(), "get".to_string(), "--json".to_string()];
    if let Some(i) = id {
        if !i.is_empty() { args.push("--id".into()); args.push(i); }
    }
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    run_cli(&app, refs).await.map_err(err_to_string)
}

/// `openreply agent create …`.
#[tauri::command]
pub async fn agent_create(
    app: AppHandle,
    name: String,
    niche: Option<String>,
    website: Option<String>,
    goal: Option<String>,
    product: Option<String>,
    persona: Option<String>,
    tone: Option<String>,
    audience: Option<String>,
    keywords: Option<String>,
    platforms: Option<String>,
) -> Result<Value, String> {
    let mut args = vec!["agent".to_string(), "create".to_string(), "--name".to_string(), name];
    let mut push = |flag: &str, v: Option<String>| {
        if let Some(s) = v { if !s.is_empty() { args.push(flag.to_string()); args.push(s); } }
    };
    push("--niche", niche);
    push("--website", website);
    push("--goal", goal);
    push("--product", product);
    push("--persona", persona);
    push("--tone", tone);
    push("--audience", audience);
    push("--keywords", keywords);
    push("--platforms", platforms);
    args.push("--json".to_string());
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    run_cli(&app, refs).await.map_err(err_to_string)
}

/// `openreply agent use <id>` — switch active agent.
#[tauri::command]
pub async fn agent_use(app: AppHandle, id: String) -> Result<Value, String> {
    run_cli(&app, vec!["agent", "use", &id, "--json"]).await.map_err(err_to_string)
}

/// `openreply agent knowledge` — corpus/graph/findings counts.
#[tauri::command]
pub async fn agent_knowledge(app: AppHandle, id: Option<String>) -> Result<Value, String> {
    let mut args = vec!["agent".to_string(), "knowledge".to_string(), "--json".to_string()];
    if let Some(i) = id { if !i.is_empty() { args.push("--id".into()); args.push(i); } }
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    run_cli(&app, refs).await.map_err(err_to_string)
}

/// `openreply agent refresh` — re-fetch latest niche knowledge (can be slow).
#[tauri::command]
pub async fn agent_refresh(app: AppHandle, id: Option<String>, deep: Option<bool>) -> Result<Value, String> {
    let mut args = vec!["agent".to_string(), "refresh".to_string(), "--json".to_string()];
    if let Some(i) = id { if !i.is_empty() { args.push("--id".into()); args.push(i); } }
    if deep.unwrap_or(false) { args.push("--deep".into()); }
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    run_cli(&app, refs).await.map_err(err_to_string)
}

/// `openreply agent learn` — one autonomous learning pass (ingest + synthesize).
#[tauri::command]
pub async fn agent_learn(app: AppHandle, id: Option<String>, limit: Option<u32>) -> Result<Value, String> {
    let mut args = vec!["agent".to_string(), "learn".to_string(), "--json".to_string()];
    if let Some(i) = id { if !i.is_empty() { args.push("--id".into()); args.push(i); } }
    if let Some(l) = limit { args.push("--limit".into()); args.push(l.to_string()); }
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    run_cli(&app, refs).await.map_err(err_to_string)
}

/// `openreply agent learn-status` — what the agent has learned (counts + recent).
#[tauri::command]
pub async fn agent_learn_status(app: AppHandle, id: Option<String>) -> Result<Value, String> {
    let mut args = vec!["agent".to_string(), "learn-status".to_string(), "--json".to_string()];
    if let Some(i) = id { if !i.is_empty() { args.push("--id".into()); args.push(i); } }
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    run_cli(&app, refs).await.map_err(err_to_string)
}

/// `openreply agent watch-*` — track X accounts and pull their posts into the corpus.
#[tauri::command]
pub async fn account_track(app: AppHandle, handle: String, note: Option<String>, id: Option<String>) -> Result<Value, String> {
    let mut args = vec!["agent".to_string(), "watch-add".to_string(), handle, "--json".to_string()];
    if let Some(n) = note { if !n.is_empty() { args.push("--note".into()); args.push(n); } }
    if let Some(i) = id { if !i.is_empty() { args.push("--id".into()); args.push(i); } }
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    run_cli(&app, refs).await.map_err(err_to_string)
}

#[tauri::command]
pub async fn account_list(app: AppHandle, id: Option<String>) -> Result<Value, String> {
    let mut args = vec!["agent".to_string(), "watch-list".to_string(), "--json".to_string()];
    if let Some(i) = id { if !i.is_empty() { args.push("--id".into()); args.push(i); } }
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    run_cli(&app, refs).await.map_err(err_to_string)
}

#[tauri::command]
pub async fn account_untrack(app: AppHandle, handle: String, id: Option<String>) -> Result<Value, String> {
    let mut args = vec!["agent".to_string(), "watch-remove".to_string(), handle, "--json".to_string()];
    if let Some(i) = id { if !i.is_empty() { args.push("--id".into()); args.push(i); } }
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    run_cli(&app, refs).await.map_err(err_to_string)
}

#[tauri::command]
pub async fn account_fetch(app: AppHandle, handle: Option<String>, learn: Option<bool>, id: Option<String>) -> Result<Value, String> {
    let mut args = vec!["agent".to_string(), "watch-fetch".to_string(), "--json".to_string()];
    if let Some(h) = handle { if !h.is_empty() { args.push("--handle".into()); args.push(h); } }
    if learn.unwrap_or(false) { args.push("--learn".into()); }
    if let Some(i) = id { if !i.is_empty() { args.push("--id".into()); args.push(i); } }
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    run_cli(&app, refs).await.map_err(err_to_string)
}

/// `openreply agent corpus` — browse the agent's collected multi-source corpus.
#[tauri::command]
pub async fn agent_corpus(app: AppHandle, id: Option<String>, source: Option<String>, query: Option<String>, relevance: Option<String>, limit: Option<u32>, offset: Option<u32>) -> Result<Value, String> {
    let mut args = vec!["agent".to_string(), "corpus".to_string(), "--json".to_string()];
    if let Some(i) = id { if !i.is_empty() { args.push("--id".into()); args.push(i); } }
    if let Some(s) = source { if !s.is_empty() { args.push("--source".into()); args.push(s); } }
    if let Some(q) = query { if !q.is_empty() { args.push("--query".into()); args.push(q); } }
    if let Some(rv) = relevance { if !rv.is_empty() { args.push("--relevance".into()); args.push(rv); } }
    if let Some(l) = limit { args.push("--limit".into()); args.push(l.to_string()); }
    if let Some(o) = offset { args.push("--offset".into()); args.push(o.to_string()); }
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    run_cli(&app, refs).await.map_err(err_to_string)
}

/// `openreply agent corpus-check` — LLM relevance check on fetched corpus posts.
#[tauri::command]
pub async fn agent_corpus_check(app: AppHandle, id: Option<String>, limit: Option<u32>) -> Result<Value, String> {
    let mut args = vec!["agent".to_string(), "corpus-check".to_string(), "--json".to_string()];
    if let Some(i) = id { if !i.is_empty() { args.push("--id".into()); args.push(i); } }
    if let Some(l) = limit { args.push("--limit".into()); args.push(l.to_string()); }
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    run_cli(&app, refs).await.map_err(err_to_string)
}

/// `openreply agent autopilot` — get the daily content + opportunity schedule.
#[tauri::command]
pub async fn agent_autopilot(app: AppHandle, id: Option<String>) -> Result<Value, String> {
    let mut args = vec!["agent".to_string(), "autopilot".to_string(), "--json".to_string()];
    if let Some(i) = id { if !i.is_empty() { args.push("--id".into()); args.push(i); } }
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    run_cli(&app, refs).await.map_err(err_to_string)
}

/// `openreply agent autopilot-set` — configure the daily auto-pilot.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn agent_autopilot_set(
    app: AppHandle, id: Option<String>,
    content: Option<bool>, content_kinds: Option<String>, content_count: Option<u32>, content_cadence: Option<String>,
    opportunity: Option<bool>, opp_count: Option<u32>, opp_cadence: Option<String>,
) -> Result<Value, String> {
    let mut args = vec!["agent".to_string(), "autopilot-set".to_string(), "--json".to_string()];
    if let Some(i) = id { if !i.is_empty() { args.push("--id".into()); args.push(i); } }
    if let Some(b) = content { args.push(if b { "--content".into() } else { "--no-content".into() }); }
    if let Some(k) = content_kinds { if !k.is_empty() { args.push("--content-kinds".into()); args.push(k); } }
    if let Some(c) = content_count { args.push("--content-count".into()); args.push(c.to_string()); }
    if let Some(c) = content_cadence { if !c.is_empty() { args.push("--content-cadence".into()); args.push(c); } }
    if let Some(b) = opportunity { args.push(if b { "--opportunity".into() } else { "--no-opportunity".into() }); }
    if let Some(c) = opp_count { args.push("--opp-count".into()); args.push(c.to_string()); }
    if let Some(c) = opp_cadence { if !c.is_empty() { args.push("--opp-cadence".into()); args.push(c); } }
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    run_cli(&app, refs).await.map_err(err_to_string)
}

/// `openreply agent autopilot-run` — run the auto-pilot now if due.
#[tauri::command]
pub async fn agent_autopilot_run(app: AppHandle, id: Option<String>) -> Result<Value, String> {
    let mut args = vec!["agent".to_string(), "autopilot-run".to_string(), "--json".to_string()];
    if let Some(i) = id { if !i.is_empty() { args.push("--id".into()); args.push(i); } }
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    run_cli(&app, refs).await.map_err(err_to_string)
}

/// `openreply agent build-graph` — build the agent's knowledge graph (brain).
#[tauri::command]
pub async fn agent_build_graph(app: AppHandle, id: Option<String>, deep: Option<bool>) -> Result<Value, String> {
    let mut args = vec!["agent".to_string(), "build-graph".to_string(), "--json".to_string()];
    if let Some(i) = id { if !i.is_empty() { args.push("--id".into()); args.push(i); } }
    if deep.unwrap_or(false) { args.push("--deep".into()); }
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    run_cli(&app, refs).await.map_err(err_to_string)
}

/// `openreply agent graph` — knowledge-graph overview (counts, hubs, connections).
#[tauri::command]
pub async fn agent_graph(app: AppHandle, id: Option<String>) -> Result<Value, String> {
    let mut args = vec!["agent".to_string(), "graph".to_string(), "--json".to_string()];
    if let Some(i) = id { if !i.is_empty() { args.push("--id".into()); args.push(i); } }
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    run_cli(&app, refs).await.map_err(err_to_string)
}

/// `openreply agent brain` — unified brain (structural graph + persona memories + beliefs).
#[tauri::command]
pub async fn agent_brain(app: AppHandle, id: Option<String>) -> Result<Value, String> {
    let mut args = vec!["agent".to_string(), "brain".to_string(), "--json".to_string()];
    if let Some(i) = id { if !i.is_empty() { args.push("--id".into()); args.push(i); } }
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    run_cli(&app, refs).await.map_err(err_to_string)
}

/// `openreply agent brain-relink` — (re)build the cross-links that merge persona brains.
#[tauri::command]
pub async fn agent_brain_relink(app: AppHandle, id: Option<String>, semantic: Option<bool>) -> Result<Value, String> {
    let mut args = vec!["agent".to_string(), "brain-relink".to_string(), "--json".to_string()];
    if let Some(i) = id { if !i.is_empty() { args.push("--id".into()); args.push(i); } }
    if semantic == Some(false) { args.push("--no-semantic".into()); }
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    run_cli(&app, refs).await.map_err(err_to_string)
}

/// `openreply agent teach-video` — teach the agent from one video's subtitles/transcript.
#[tauri::command]
pub async fn agent_teach_video(app: AppHandle, url: String, id: Option<String>, comments: Option<u32>) -> Result<Value, String> {
    let mut args = vec!["agent".to_string(), "teach-video".to_string(), url, "--json".to_string()];
    if let Some(i) = id { if !i.is_empty() { args.push("--id".into()); args.push(i); } }
    if let Some(c) = comments { args.push("--comments".into()); args.push(c.to_string()); }
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    run_cli(&app, refs).await.map_err(err_to_string)
}

/// `openreply reply find …` — scan + score opportunities.
#[tauri::command]
pub async fn reply_find(app: AppHandle, platforms: Option<String>, limit: Option<u32>, no_score: Option<bool>) -> Result<Value, String> {
    let lim = limit.unwrap_or(15).to_string();
    let mut args = vec!["reply".to_string(), "find".to_string(), "--limit".to_string(), lim, "--json".to_string()];
    if let Some(p) = platforms { if !p.is_empty() { args.push("--platforms".into()); args.push(p); } }
    if no_score.unwrap_or(false) { args.push("--no-score".into()); }
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    run_cli(&app, refs).await.map_err(err_to_string)
}

/// `openreply reply list …` — stored opportunities with search/sort/pagination.
#[tauri::command]
pub async fn reply_list(
    app: AppHandle,
    status: Option<String>,
    min_score: Option<f64>,
    limit: Option<u32>,
    query: Option<String>,
    sort: Option<String>,
    offset: Option<u32>,
    platform: Option<String>,
) -> Result<Value, String> {
    let lim = limit.unwrap_or(30).to_string();
    let ms = min_score.unwrap_or(0.0).to_string();
    let off = offset.unwrap_or(0).to_string();
    let srt = sort.unwrap_or_else(|| "score".to_string());
    let mut args = vec![
        "reply".to_string(), "list".to_string(),
        "--limit".to_string(), lim, "--min-score".to_string(), ms,
        "--offset".to_string(), off, "--sort".to_string(), srt,
        "--json".to_string(),
    ];
    if let Some(s) = status { if !s.is_empty() { args.push("--status".into()); args.push(s); } }
    if let Some(q) = query { if !q.is_empty() { args.push("--query".into()); args.push(q); } }
    if let Some(pf) = platform { if !pf.is_empty() { args.push("--platform".into()); args.push(pf); } }
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    run_cli(&app, refs).await.map_err(err_to_string)
}

/// `openreply reply source-counts` — per-source opportunity + fetched-post counts.
#[tauri::command]
pub async fn reply_source_counts(app: AppHandle) -> Result<Value, String> {
    run_cli(&app, vec!["reply", "source-counts", "--json"]).await.map_err(err_to_string)
}

/// `openreply reply draft -o <id>` — generate an on-brand reply draft.
#[tauri::command]
pub async fn reply_draft(app: AppHandle, opportunity: String) -> Result<Value, String> {
    run_cli(&app, vec!["reply", "draft", "-o", &opportunity, "--json"]).await.map_err(err_to_string)
}

/// `openreply reply set-status -o <id> --status <s>` — move an opportunity through
/// its lifecycle (save / dismiss / mark replied).
#[tauri::command]
pub async fn reply_set_status(app: AppHandle, opportunity: String, status: String) -> Result<Value, String> {
    run_cli(&app, vec!["reply", "set-status", "-o", &opportunity, "--status", &status, "--json"])
        .await
        .map_err(err_to_string)
}

/// `openreply reply save-draft -o <id> --text <t>` — persist a user-edited reply
/// as a new versioned draft (+ compliance re-check).
#[tauri::command]
pub async fn reply_save_draft(app: AppHandle, opportunity: String, text: String) -> Result<Value, String> {
    run_cli(&app, vec!["reply", "save-draft", "-o", &opportunity, "--text", &text, "--json"])
        .await
        .map_err(err_to_string)
}

/// `openreply reply drafts -o <id>` — all draft versions (history), newest first.
#[tauri::command]
pub async fn reply_drafts(app: AppHandle, opportunity: String) -> Result<Value, String> {
    run_cli(&app, vec!["reply", "drafts", "-o", &opportunity, "--json"]).await.map_err(err_to_string)
}

/// `openreply reply approve -o <id>` — approve the current draft (→ ready).
#[tauri::command]
pub async fn reply_approve(app: AppHandle, opportunity: String) -> Result<Value, String> {
    run_cli(&app, vec!["reply", "approve", "-o", &opportunity, "--json"]).await.map_err(err_to_string)
}

/// `openreply reply queue -o <id> [--at <epoch>]` — queue an approved reply.
#[tauri::command]
pub async fn reply_queue(app: AppHandle, opportunity: String, scheduled_at: Option<i64>) -> Result<Value, String> {
    let at = scheduled_at.unwrap_or(0).to_string();
    run_cli(&app, vec!["reply", "queue", "-o", &opportunity, "--at", &at, "--json"])
        .await
        .map_err(err_to_string)
}

/// `openreply reply snooze -o <id> --hours <n>` — defer; auto-resurfaces.
#[tauri::command]
pub async fn reply_snooze(app: AppHandle, opportunity: String, hours: Option<f64>) -> Result<Value, String> {
    let h = hours.unwrap_or(24.0).to_string();
    run_cli(&app, vec!["reply", "snooze", "-o", &opportunity, "--hours", &h, "--json"])
        .await
        .map_err(err_to_string)
}

/// `openreply reply post-due` — process queued replies whose schedule is due
/// (best-effort auto-post; otherwise the item stays queued for a manual post).
#[tauri::command]
pub async fn reply_post_due(app: AppHandle) -> Result<Value, String> {
    run_cli(&app, vec!["reply", "post-due", "--json"]).await.map_err(err_to_string)
}

/// `openreply reply growth-plan` — generate + save a growth plan from the agent's
/// goal/product/niche.
#[tauri::command]
pub async fn reply_growth_plan(app: AppHandle, id: Option<String>) -> Result<Value, String> {
    let mut args = vec!["reply".to_string(), "growth-plan".to_string(), "--json".to_string()];
    if let Some(i) = id { if !i.is_empty() { args.push("--id".into()); args.push(i); } }
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    run_cli(&app, refs).await.map_err(err_to_string)
}

/// `openreply reply growth-get` — the last-saved growth plan for the agent.
#[tauri::command]
pub async fn reply_growth_get(app: AppHandle, id: Option<String>) -> Result<Value, String> {
    let mut args = vec!["reply".to_string(), "growth-get".to_string(), "--json".to_string()];
    if let Some(i) = id { if !i.is_empty() { args.push("--id".into()); args.push(i); } }
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    run_cli(&app, refs).await.map_err(err_to_string)
}

/// `openreply reply notify-get` — current notification config (tokens masked).
#[tauri::command]
pub async fn notify_get(app: AppHandle) -> Result<Value, String> {
    run_cli(&app, vec!["reply", "notify-get", "--json"]).await.map_err(err_to_string)
}

/// `openreply reply notify-set` — update Telegram/Slack notification config.
/// Every field is optional; only the ones supplied change. Pass an empty string
/// for a token to clear it. Bool fields are tri-state (None = unchanged).
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn notify_set(
    app: AppHandle,
    enabled: Option<bool>,
    two_way: Option<bool>,
    telegram_token: Option<String>,
    telegram_chat: Option<String>,
    slack_webhook: Option<String>,
    min_score: Option<f64>,
    ev_opportunity: Option<bool>,
    ev_article: Option<bool>,
    ev_reply: Option<bool>,
    ev_digest: Option<bool>,
    ev_geo: Option<bool>,
) -> Result<Value, String> {
    let mut args: Vec<String> = vec!["reply".into(), "notify-set".into(), "--json".into()];
    if let Some(b) = enabled { args.push(if b { "--enabled".into() } else { "--disabled".into() }); }
    if let Some(b) = two_way { args.push(if b { "--two-way".into() } else { "--one-way".into() }); }
    if let Some(s) = telegram_token { args.push("--telegram-token".into()); args.push(s); }
    if let Some(s) = telegram_chat { args.push("--telegram-chat".into()); args.push(s); }
    if let Some(s) = slack_webhook { args.push("--slack-webhook".into()); args.push(s); }
    if let Some(n) = min_score { args.push("--min-score".into()); args.push(n.to_string()); }
    if let Some(b) = ev_opportunity { args.push(if b { "--opp".into() } else { "--no-opp".into() }); }
    if let Some(b) = ev_article { args.push(if b { "--article".into() } else { "--no-article".into() }); }
    if let Some(b) = ev_reply { args.push(if b { "--reply".into() } else { "--no-reply".into() }); }
    if let Some(b) = ev_digest { args.push(if b { "--digest".into() } else { "--no-digest".into() }); }
    if let Some(b) = ev_geo { args.push(if b { "--geo".into() } else { "--no-geo".into() }); }
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    run_cli(&app, refs).await.map_err(err_to_string)
}

/// `openreply reply notify-test` — send a test message to every configured channel.
#[tauri::command]
pub async fn notify_test(app: AppHandle) -> Result<Value, String> {
    run_cli(&app, vec!["reply", "notify-test", "--json"]).await.map_err(err_to_string)
}

/// `openreply reply bot-poll --once` — drain pending Telegram button taps and
/// return. The open app calls this on a short interval; when the app closes the
/// interval dies, so the two-way bot runs only while the app is running.
#[tauri::command]
pub async fn bot_poll_once(app: AppHandle) -> Result<Value, String> {
    run_cli(&app, vec!["reply", "bot-poll", "--once", "--json"]).await.map_err(err_to_string)
}

/// `openreply content generate <kind> …`.
/// `context_id` / `context_text` feed the follow-up kinds (the prior draft, or
/// the thread + reply to answer); ignored by the other kinds.
#[tauri::command]
pub async fn content_generate(
    app: AppHandle,
    kind: String,
    platform: Option<String>,
    angle: Option<String>,
    context_id: Option<String>,
    context_text: Option<String>,
) -> Result<Value, String> {
    let mut args = vec!["content".to_string(), "generate".to_string(), kind, "--json".to_string()];
    if let Some(p) = platform { if !p.is_empty() { args.push("--platform".into()); args.push(p); } }
    if let Some(a) = angle { if !a.is_empty() { args.push("--angle".into()); args.push(a); } }
    if let Some(c) = context_id { if !c.is_empty() { args.push("--context-id".into()); args.push(c); } }
    if let Some(t) = context_text { if !t.is_empty() { args.push("--context-text".into()); args.push(t); } }
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    run_cli(&app, refs).await.map_err(err_to_string)
}

/// `openreply content update <id> …` — edit / save / schedule a draft.
#[tauri::command]
pub async fn content_update(
    app: AppHandle,
    id: String,
    body: Option<String>,
    status: Option<String>,
    scheduled_at: Option<i64>,
) -> Result<Value, String> {
    let mut args = vec!["content".to_string(), "update".to_string(), id, "--json".to_string()];
    if let Some(b) = body { args.push("--body".into()); args.push(b); }
    if let Some(s) = status { if !s.is_empty() { args.push("--status".into()); args.push(s); } }
    if let Some(t) = scheduled_at { args.push("--scheduled-at".into()); args.push(t.to_string()); }
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    run_cli(&app, refs).await.map_err(err_to_string)
}

/// `openreply content delete <id>` — remove a content draft.
#[tauri::command]
pub async fn content_delete(app: AppHandle, id: String) -> Result<Value, String> {
    run_cli(&app, vec!["content", "delete", &id, "--json"]).await.map_err(err_to_string)
}

/// `openreply agent delete <id>` — remove an agent.
#[tauri::command]
pub async fn agent_delete(app: AppHandle, id: String) -> Result<Value, String> {
    run_cli(&app, vec!["agent", "delete", &id, "--json"]).await.map_err(err_to_string)
}

/// `openreply content list …` — generated drafts.
#[tauri::command]
pub async fn content_list(app: AppHandle, kind: Option<String>, status: Option<String>, limit: Option<u32>) -> Result<Value, String> {
    let lim = limit.unwrap_or(30).to_string();
    let mut args = vec!["content".to_string(), "list".to_string(), "--limit".to_string(), lim, "--json".to_string()];
    if let Some(k) = kind { if !k.is_empty() { args.push("--kind".into()); args.push(k); } }
    if let Some(s) = status { if !s.is_empty() { args.push("--status".into()); args.push(s); } }
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    run_cli(&app, refs).await.map_err(err_to_string)
}

/// `openreply publish status` — which platforms have publish credentials stored.
#[tauri::command]
pub async fn publish_status(app: AppHandle) -> Result<Value, String> {
    run_cli(&app, vec!["publish", "status", "--json"]).await.map_err(err_to_string)
}

/// `openreply publish set-creds …` — store X (Twitter) OAuth 1.0a write credentials.
#[tauri::command]
pub async fn publish_set_x_creds(
    app: AppHandle,
    api_key: String,
    api_secret: String,
    access_token: String,
    access_secret: String,
) -> Result<Value, String> {
    run_cli(
        &app,
        vec![
            "publish", "set-creds",
            "--api-key", &api_key, "--api-secret", &api_secret,
            "--access-token", &access_token, "--access-secret", &access_secret,
            "--json",
        ],
    )
    .await
    .map_err(err_to_string)
}

/// `openreply publish x --content-id <id> [--dry-run]` — post a draft to X as a
/// tweet/thread. `dry_run` previews the split tweets without posting.
#[tauri::command]
pub async fn content_publish_x(
    app: AppHandle,
    content_id: String,
    dry_run: Option<bool>,
) -> Result<Value, String> {
    let mut args = vec![
        "publish".to_string(), "x".to_string(),
        "--content-id".to_string(), content_id, "--json".to_string(),
    ];
    if dry_run.unwrap_or(false) { args.push("--dry-run".into()); }
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    run_cli(&app, refs).await.map_err(err_to_string)
}

/// `openreply publish x-reply <reply_to_tweet_id> --text <text> [--dry-run]`
/// — post a reply to an existing X tweet.
#[tauri::command]
pub async fn content_publish_x_reply(
    app: AppHandle,
    reply_to_tweet_id: String,
    text: String,
    dry_run: Option<bool>,
) -> Result<Value, String> {
    let mut args = vec![
        "publish".to_string(), "x-reply".to_string(), reply_to_tweet_id,
        "--text".to_string(), text, "--json".to_string(),
    ];
    if dry_run.unwrap_or(false) { args.push("--dry-run".into()); }
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    run_cli(&app, refs).await.map_err(err_to_string)
}

/// `openreply agent update …` — edit the active (or given) agent's voice/keywords/platforms.
#[tauri::command]
pub async fn agent_update(
    app: AppHandle,
    id: Option<String>,
    name: Option<String>,
    niche: Option<String>,
    website: Option<String>,
    goal: Option<String>,
    product: Option<String>,
    persona: Option<String>,
    tone: Option<String>,
    audience: Option<String>,
    keywords: Option<String>,
    platforms: Option<String>,
    cadence: Option<String>,
) -> Result<Value, String> {
    let mut args = vec!["agent".to_string(), "update".to_string(), "--json".to_string()];
    let mut push = |flag: &str, v: Option<String>| {
        if let Some(s) = v { if !s.is_empty() { args.push(flag.to_string()); args.push(s); } }
    };
    push("--id", id);
    push("--name", name);
    push("--niche", niche);
    push("--website", website);
    push("--goal", goal);
    push("--product", product);
    push("--persona", persona);
    push("--tone", tone);
    push("--audience", audience);
    push("--keywords", keywords);
    push("--platforms", platforms);
    push("--cadence", cadence);
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    run_cli(&app, refs).await.map_err(err_to_string)
}

/// `openreply agent personas` — list personas linked to this agent (with blend weights).
#[tauri::command]
pub async fn agent_personas(app: AppHandle, id: Option<String>) -> Result<Value, String> {
    let mut args = vec!["agent".to_string(), "personas".to_string(), "--json".to_string()];
    if let Some(i) = id { if !i.is_empty() { args.push("--agent".into()); args.push(i); } }
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    run_cli(&app, refs).await.map_err(err_to_string)
}

/// `openreply agent link-persona <pid> [--agent id] [--weight w]` — blend a persona's
/// knowledge (memories + graph + beliefs) into this agent's replies/content.
#[tauri::command]
pub async fn agent_link_persona(
    app: AppHandle,
    persona_id: i64,
    agent_id: Option<String>,
    weight: Option<f64>,
) -> Result<Value, String> {
    let pid = persona_id.to_string();
    let mut args = vec![
        "agent".to_string(), "link-persona".to_string(), pid, "--json".to_string(),
    ];
    if let Some(a) = agent_id { if !a.is_empty() { args.push("--agent".into()); args.push(a); } }
    if let Some(w) = weight { args.push("--weight".into()); args.push(w.to_string()); }
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    run_cli(&app, refs).await.map_err(err_to_string)
}

/// `openreply agent unlink-persona <pid> [--agent id]` — remove a persona link.
#[tauri::command]
pub async fn agent_unlink_persona(
    app: AppHandle,
    persona_id: i64,
    agent_id: Option<String>,
) -> Result<Value, String> {
    let pid = persona_id.to_string();
    let mut args = vec![
        "agent".to_string(), "unlink-persona".to_string(), pid, "--json".to_string(),
    ];
    if let Some(a) = agent_id { if !a.is_empty() { args.push("--agent".into()); args.push(a); } }
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    run_cli(&app, refs).await.map_err(err_to_string)
}

/// `openreply reply rules --sub <sub>` — fetch + cache a subreddit's rules (Subreddit Intel).
#[tauri::command]
pub async fn reply_rules(app: AppHandle, sub: String, refresh: Option<bool>) -> Result<Value, String> {
    let mut args = vec!["reply".to_string(), "rules".to_string(), "--sub".to_string(), sub, "--json".to_string()];
    if refresh.unwrap_or(false) { args.push("--refresh".into()); }
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    run_cli(&app, refs).await.map_err(err_to_string)
}

// ── Alerts ────────────────────────────────────────────────────────────────
#[tauri::command]
pub async fn alerts_list(app: AppHandle) -> Result<Value, String> {
    run_cli(&app, vec!["reply", "alert-list", "--json"]).await.map_err(err_to_string)
}

#[tauri::command]
pub async fn alerts_add(app: AppHandle, rule: String, channel: Option<String>, intent_min: Option<String>, score_min: Option<f64>) -> Result<Value, String> {
    let ch = channel.unwrap_or_else(|| "email".into());
    let im = intent_min.unwrap_or_else(|| "any".into());
    let sm = score_min.unwrap_or(0.0).to_string();
    let args = vec!["reply", "alert-add", "--rule", &rule, "--channel", &ch, "--intent-min", &im, "--score-min", &sm, "--json"];
    run_cli(&app, args).await.map_err(err_to_string)
}

#[tauri::command]
pub async fn alerts_delete(app: AppHandle, id: String) -> Result<Value, String> {
    run_cli(&app, vec!["reply", "alert-delete", &id, "--json"]).await.map_err(err_to_string)
}

// ── AI Visibility (GEO) ─────────────────────────────────────────────────────
#[tauri::command]
pub async fn geo_list(app: AppHandle) -> Result<Value, String> {
    run_cli(&app, vec!["reply", "geo-list", "--json"]).await.map_err(err_to_string)
}

#[tauri::command]
pub async fn geo_add(app: AppHandle, query: String, surface: Option<String>) -> Result<Value, String> {
    let sf = surface.unwrap_or_else(|| "ChatGPT".into());
    run_cli(&app, vec!["reply", "geo-add", "--query", &query, "--surface", &sf, "--json"]).await.map_err(err_to_string)
}

#[tauri::command]
pub async fn geo_set(app: AppHandle, id: String, status: String) -> Result<Value, String> {
    run_cli(&app, vec!["reply", "geo-set", &id, "--status", &status, "--json"]).await.map_err(err_to_string)
}

#[tauri::command]
pub async fn geo_delete(app: AppHandle, id: String) -> Result<Value, String> {
    run_cli(&app, vec!["reply", "geo-delete", &id, "--json"]).await.map_err(err_to_string)
}

/// `openreply reply geo-check <id>` — automated visibility check via the BYOK provider.
#[tauri::command]
pub async fn geo_check(app: AppHandle, id: String) -> Result<Value, String> {
    run_cli(&app, vec!["reply", "geo-check", &id, "--json"]).await.map_err(err_to_string)
}

/// `openreply reply geo-check-all` — re-check every tracked query.
#[tauri::command]
pub async fn geo_check_all(app: AppHandle) -> Result<Value, String> {
    run_cli(&app, vec!["reply", "geo-check-all", "--json"]).await.map_err(err_to_string)
}

/// `openreply reply geo-history <id>` — past checks for one query (trend).
#[tauri::command]
pub async fn geo_history(app: AppHandle, id: String) -> Result<Value, String> {
    run_cli(&app, vec!["reply", "geo-history", &id, "--json"]).await.map_err(err_to_string)
}

/// `openreply reply analytics [--days N]` — aggregated analytics for the active agent.
#[tauri::command]
pub async fn analytics_summary(app: AppHandle, days: Option<u32>) -> Result<Value, String> {
    let d = days.unwrap_or(30).to_string();
    run_cli(&app, vec!["reply", "analytics", "--days", &d, "--json"]).await.map_err(err_to_string)
}

// ── Subreddit Intelligence ──────────────────────────────────────────────────
#[tauri::command]
pub async fn reddit_account_status(app: AppHandle) -> Result<Value, String> {
    run_cli(&app, vec!["reply", "account-status", "--json"]).await.map_err(err_to_string)
}

#[tauri::command]
pub async fn sub_discover(
    app: AppHandle,
    limit: Option<u32>,
    auto_track_top: Option<u32>,
) -> Result<Value, String> {
    let lim = limit.unwrap_or(8).to_string();
    let att = auto_track_top.unwrap_or(0).to_string();
    run_cli(
        &app,
        vec!["reply", "sub-discover", "--limit", &lim, "--auto-track-top", &att, "--json"],
    )
    .await
    .map_err(err_to_string)
}

#[tauri::command]
pub async fn sub_list(app: AppHandle) -> Result<Value, String> {
    run_cli(&app, vec!["reply", "sub-list", "--json"]).await.map_err(err_to_string)
}

#[tauri::command]
pub async fn sub_intel(app: AppHandle, sub: String, refresh: Option<bool>) -> Result<Value, String> {
    let mut args = vec!["reply".to_string(), "sub-intel".to_string(), "--sub".to_string(), sub, "--json".to_string()];
    if refresh.unwrap_or(false) { args.push("--refresh".into()); }
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    run_cli(&app, refs).await.map_err(err_to_string)
}

#[tauri::command]
pub async fn sub_track(app: AppHandle, sub: String, off: Option<bool>) -> Result<Value, String> {
    let mut args = vec!["reply".to_string(), "sub-track".to_string(), "--sub".to_string(), sub, "--json".to_string()];
    if off.unwrap_or(false) { args.push("--off".into()); }
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    run_cli(&app, refs).await.map_err(err_to_string)
}

#[tauri::command]
pub async fn sub_check(app: AppHandle, sub: String, text: String) -> Result<Value, String> {
    run_cli(&app, vec!["reply", "sub-check", "--sub", &sub, "--text", &text, "--json"]).await.map_err(err_to_string)
}

/// Per-topic inventory for the home screen.
///
/// Historically this SQL joined `topic_posts` and showed only topics that had
/// at least one post. That made newly-created topics invisible for 30-60 s
/// while the sidecar fetched data. We now UNION in `topic_prefs` — every
/// collect upserts that table as its first action, so the row appears in
/// listing as soon as the user hits "Start", even if no posts have landed.
/// `COALESCE` fills post counts with 0 for brand-new topics.
/// Global overview stats (sum across topics) for the hero banner.
/// Recent fetch events for the activity feed.
/// Per-topic graph coverage — how many of each node + edge kind exist, plus
/// the source_type breakdown for posts. Powers the "OpenReply coverage" card
/// on the topic page so users see the full pipeline output at a glance
/// (posts → painpoints → mechanisms → interventions → evidence_papers →
///  concepts, and every relation type between them).
/// Discover sub candidates for a topic.
/// Canonicalize a topic — returns the corrected canonical form, variants,
/// confidence, and the LLM-scored keyword fan-out that `start_collect`
/// will use. Cached per-topic; uncached takes ~1 LLM call (~400 tokens).
///
/// Drives the Collect screen's "Searching for…" strip so users can see
/// the expanded synonyms (e.g. "public speaking anxiety app" → also
/// searches "confident speaking", "speaking tricks", …) and the
/// "Did you mean…?" modal when confidence is low.
// ── User-added custom RSS feeds (Settings → Custom RSS) ──────────────────────
// Triangle: these + main.rs::generate_handler! + api.js feeds* must stay in sync.

/// List the user's saved custom RSS feeds.
#[tauri::command]
pub async fn feeds_list(app: AppHandle) -> Result<Value, String> {
    run_cli(&app, vec!["feeds", "list", "--json"])
        .await
        .map_err(err_to_string)
}

/// Validate a candidate feed URL (scheme/SSRF guard → fetch → parse) WITHOUT saving.
#[tauri::command]
pub async fn feeds_validate(app: AppHandle, url: String) -> Result<Value, String> {
    run_cli(&app, vec!["feeds", "validate", "--url", &url, "--json"])
        .await
        .map_err(err_to_string)
}

/// Validate then save a custom RSS feed. Rejects non-feed / blocked URLs.
#[tauri::command]
pub async fn feeds_add(app: AppHandle, url: String, name: Option<String>) -> Result<Value, String> {
    let nm = name.unwrap_or_default();
    run_cli(&app, vec!["feeds", "add", "--url", &url, "--name", &nm, "--json"])
        .await
        .map_err(err_to_string)
}

/// Remove a saved custom RSS feed.
#[tauri::command]
pub async fn feeds_remove(app: AppHandle, url: String) -> Result<Value, String> {
    run_cli(&app, vec!["feeds", "remove", "--url", &url, "--json"])
        .await
        .map_err(err_to_string)
}

/// Enable or disable (pause) a saved feed.
#[tauri::command]
pub async fn feeds_enable(app: AppHandle, url: String, enabled: bool) -> Result<Value, String> {
    let flag = if enabled { "--enabled" } else { "--disabled" };
    run_cli(&app, vec!["feeds", "enable", "--url", &url, flag, "--json"])
        .await
        .map_err(err_to_string)
}

// ── Reach Connections (per-source cookie/key credentials) ────────────────────
// Triangle: these + main.rs::generate_handler! + api.js creds* must stay in sync.
// import/save/delete are local-machine credential ops — exposed via IPC + CLI
// but NOT as MCP tools (so remote agents can't write credentials).

/// Status of every cookie/key-gated source (Reddit, Xueqiu, XHS, Exa, …).
#[tauri::command]
pub async fn creds_list(app: AppHandle) -> Result<Value, String> {
    run_cli(&app, vec!["creds", "list", "--json"])
        .await
        .map_err(err_to_string)
}

/// Extract a source's session cookie from the local browser, store + verify.
#[tauri::command]
pub async fn creds_import_browser(
    app: AppHandle,
    source: String,
    browser: Option<String>,
) -> Result<Value, String> {
    let mut args = vec!["creds", "import", "--source", &source];
    let b = browser.unwrap_or_default();
    if !b.is_empty() {
        args.push("--browser");
        args.push(&b);
    }
    args.push("--json");
    run_cli(&app, args).await.map_err(err_to_string)
}

/// Store a manually-pasted cookie string / API key for a source, then verify.
#[tauri::command]
pub async fn creds_save_manual(
    app: AppHandle,
    source: String,
    value: String,
) -> Result<Value, String> {
    run_cli(&app, vec!["creds", "save", "--source", &source, "--value", &value, "--json"])
        .await
        .map_err(err_to_string)
}

/// Live-test a source's stored credential.
#[tauri::command]
pub async fn creds_verify(app: AppHandle, source: String) -> Result<Value, String> {
    run_cli(&app, vec!["creds", "verify", "--source", &source, "--json"])
        .await
        .map_err(err_to_string)
}

/// Disconnect a source (delete its stored credential).
#[tauri::command]
pub async fn creds_delete(app: AppHandle, source: String) -> Result<Value, String> {
    run_cli(&app, vec!["creds", "delete", "--source", &source, "--json"])
        .await
        .map_err(err_to_string)
}

/// Set whether a connected source is used in collection runs.
#[tauri::command]
pub async fn creds_toggle(app: AppHandle, source: String, enabled: bool) -> Result<Value, String> {
    let flag = if enabled { "--enabled" } else { "--disabled" };
    run_cli(&app, vec!["creds", "toggle", "--source", &source, flag, "--json"])
        .await
        .map_err(err_to_string)
}

/// Live-fetch a sample of content from a source (titles + links) to confirm it works.
#[tauri::command]
pub async fn creds_preview(app: AppHandle, source: String, query: Option<String>, limit: Option<u32>) -> Result<Value, String> {
    let lim = limit.unwrap_or(6).to_string();
    let mut args = vec!["creds".to_string(), "preview".to_string(),
                        "--source".to_string(), source, "--limit".to_string(), lim, "--json".to_string()];
    if let Some(q) = query { if !q.is_empty() { args.push("--query".into()); args.push(q); } }
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    run_cli(&app, refs).await.map_err(err_to_string)
}

/// Start a topic collect. Streams progress via `collect:progress` events
/// and emits `collect:done` when complete.
///
/// `sources` (optional) — comma-separated external source names (e.g.
/// "hn,arxiv,pubmed"). Forwarded as `--sources X,Y,Z`.
///
/// `skip_reddit` (default false) — skip the Reddit fetch stages entirely.
/// Useful for topping up an existing topic with only externals.
///
/// `if_busy` (optional) — what to do if another collect is already
/// running. One of:
///   - "error" (default): return `{ ok: false, blocked: true,
///     blocked_by: { topic, started_at, elapsed_secs } }` so the UI can
///     render an actionable modal.
///   - "queue": append to the FIFO queue. When the running collect
///     finishes, we auto-spawn this one. Returns
///     `{ ok: true, queued: true, position }`.
///   - "cancel_and_start": SIGTERM the running collect, then start this
///     one. Returns `{ ok: true, started: true, cancelled: <prior-topic> }`
///     once the new collect's events start flowing.
/// Catalog of external sources the Python `research collect` will sweep.
/// Mirrors the lists in `src/openreply/research/collect.py` so the
/// "topic recon" card on the collect screen can preview the exact set
/// that's about to be queried — without spinning up the sidecar first.
///
/// `aggressive=true` returns the 15-source aggressive sweep; otherwise
/// the 8-source quick default.
///
/// Each entry: { id, label, kind: "external", default_aggressive,
/// default_quick }. The frontend matches `id` against the sidecar's
/// `[src] …` progress lines to flip a chip from "queued" → "fetched".
/// List the pending collect queue (FIFO order).
/// Used by the status bar to render "+ N queued: A, B".
/// Remove a queued collect by topic. Returns true if it was found.
/// Use this to cancel a queued item before it ever starts.
/// Return the set of topics that have an in-flight collect, with their start
/// timestamps. Empty object = nothing running. Used by the home screen to
/// pin a "Collecting now" banner with click-to-view-log.
/// Run a graph operation (build/enrich) with per-(op, topic) dedup.
///
/// If another call is already in flight for the same (op, topic) we return
/// `{ok: false, already_running: true, topic}` instead of spawning another
/// Python sidecar. This prevents the "11 concurrent enrichments starve
/// Ollama + hold the SQLite write-lock" pileup — observed in prod when
/// `loadMap` auto-triggers enrich and the user also clicks the button.
///
/// The key is inserted before the (awaited) run_cli call and always removed
/// afterwards, success or error, via the `_Guard` RAII pattern. Held across
/// the `.await` — safe because `HashSet<String>` insert/remove takes a
/// fresh mutex lock on each side, not across the await.
/// Force-clear in-flight graph-op locks. Escape hatch for when
/// `run_graph_op_deduped`'s staleness check hasn't fired yet but the user
/// is certain nothing is actually running (e.g. they quit the dev server
/// mid-enrich and restarted). Accepts optional `topic` + `op` filter;
/// omit both to clear everything. Returns the list of cleared keys.
/// Preempt an in-flight enrich so the caller can immediately start a fresh
/// one with new params. Does both halves of a clean preempt in a single
/// round-trip: (1) SIGTERM the live sidecar child via `cancel_active_enrich`
/// so it stops burning LLM tokens, (2) remove the `enrich:<topic>` key
/// from `ActiveGraphOps` so `enrich_graph_stream` doesn't return
/// `already_running:true` to the retry call.
///
/// Why this exists vs the existing `clear_graph_inflight` + a manual kill:
/// the FE was calling `clear_graph_inflight` after a stuck enrich and then
/// re-spawning a sidecar, but the *previous* sidecar kept running in the
/// background, double-writing painpoints to SQLite and burning Ollama
/// queue slots until it finished. A single command that kills + clears
/// keeps that bookkeeping atomic from the FE's perspective.
///
/// Returns `{ok, killed, cleared}` so the caller can show "Preempting…"
/// only when something was actually running (killed=true) — a no-op
/// preempt (no in-flight enrich) just falls through to the fresh spawn.
/// Snapshot of current memory + state-slot sizes across the Rust process and
/// any tracked sidecar children. Plumbed for diagnosing the "memory grows
/// exponentially / app hangs" reports — call from DevTools console
/// (`window.__openreplyMemStats()`) to see which layer is bloating.
///
/// Returns:
///   - `rust_pid` / `rust_rss_mb`: this Tauri host process.
///   - `sidecar_*`: rss + pid of the longest-lived sidecar slots if non-empty.
///   - `slots`: live count of each Active* state map (large counts mean a
///     stuck dedup key — typical hang cause).
///
/// Implemented via `ps -o rss=,vsz= -p <pid>` so we don't pull in `libc` or
/// a sysinfo crate just for a debug helper. RSS is reported in MB (rounded).
/// Build the structural graph for a topic. Deduped per-topic.
/// Enrich the graph with LLM-extracted semantic nodes (painpoints, features,
/// workarounds). Safe to call regardless of key state — Python side returns
/// `{ok: false, skipped: true, reason}` when no provider is configured.
/// Deduped per-topic: concurrent callers get `{already_running: true}` back.
/// Streaming counterpart of `enrich_graph`. Fires `enrich:progress` events as
/// each extractor (painpoints → features → complaints → workarounds) starts
/// and finishes, so the UI banner can show findings the moment they're
/// available instead of blocking for the full 2-6 min of 4 sequential LLM
/// calls.
///
/// Payloads (as NDJSON lines on `enrich:progress`):
///   `{"_event":"enrich:start","corpus_size":43,"provider":"ollama","extractors":["painpoints","features",…],"parallel":false}`
///   `{"_event":"extractor:start","kind":"painpoints"}`
///   `{"_event":"extractor:done","kind":"painpoints","count":5,"sample":["…", "…"]}`
///   `{"_event":"extractor:error","kind":"painpoints","error":"…"}`
///   `{"_event":"enrich:done","summary":{ok,painpoints_added,…}}`
///
/// After the Python process exits, Rust emits one final `enrich:stream:done`
/// event with `{code}` so the UI can detect a crash where `enrich:done` never
/// arrived (sidecar killed, python OOM, etc.).
///
/// `only`   → one of `painpoints|features|complaints|workarounds` to run a
///            single extractor (fastest path, finishes in 30-90s).
/// `parallel` → fan the 4 calls out concurrently for cloud providers. No-op
///            for Ollama (its inference queue serializes internally).
///
/// Per-topic dedup is still enforced via ActiveGraphOps `enrich:<topic>`
/// keys — callers get `{already_running: true}` back if one is in flight.
/// A distinct set of flags counts as the same op: we don't want "All" +
/// "Only painpoints" racing each other into a double-insert.
/// Build dense relation edges between semantic findings (relates_to /
/// potentially_solves / could_address / co_evidenced). Safe to call repeatedly;
/// graph_edges upserts keep this idempotent.
/// Phase-1 Insight Engine — one-shot long-context synthesis across all sources.
///
/// Runs `research insights --topic T --json`, returning the full structured
/// market report (opportunity-scored findings, competitors, quadrant).
/// Pass `cached=true` to return the last persisted report without hitting
/// the LLM — cheap for re-renders / tab revisits.
/// Chunked (map-reduce) synthesis — splits the corpus into N small chunks,
/// runs one LLM call per chunk (parallel up to `max_workers`), merges
/// findings deterministically. Use this when the single-call path hits
/// 402/credit errors — each chunk uses `max_tokens_per_chunk` (default 800)
/// so low-budget providers can still produce findings.
///
/// `max_workers=None` picks a provider-adaptive default (Ollama=1, Groq=2,
/// others=4). Set to 1 for strictly sequential execution.
/// Unified end-to-end gap-discovery pipeline: chunked LLM synth + palace
/// cross-source evidence + science fetch + solutions pipeline + experiment
/// proposals. Every step persists to SQLite so Map/Insights/Research pick
/// up the new nodes without needing a separate refresh.
/// Diagnose chat readiness for a topic — corpus, palace index, topic-name match,
/// findings, and provider — returning the structured `chat doctor` report so the
/// UI can show exactly why chat works (or doesn't) for this topic.
/// 2A clarified-brief — get/set/suggest the per-topic research brief
/// (goal/constraints/success/audience) that scopes the synthesis prompt.
// ─── Phase 5-10 bundle — cross-topic, export, matrix, research linking ─

/// Phase-7 export. `format` = "markdown" | "hypotheses" | "slack".
/// Returns the full content string; the UI can copy to clipboard or
/// save-file dialog. No --json flag since the outputs are free-form text.
/// Run the full paper research pipeline for a topic + query.
/// Triggers the Papers tab's "Find papers" button — searches 6 academic
/// sources, dedupes + ranks, fetches fulltext for top-cited papers, runs
/// LLM analysis, stores everything to SQLite. The UI re-reads `papers_list`
/// when this returns to show the freshly-discovered papers.
/// Research-paper pipeline stage 1 — structured outline.
/// Research-paper pipeline stage 2 — markdown draft generation.
/// Research-paper pipeline stage 3 — experiment plan generation.
/// Research-paper pipeline stage 4 — export draft with citations.
/// Paper relationship map for a topic — academic-paper nodes + paper↔paper
/// edges (semantic / cites / shared finding / same author) as D3 JSON. Powers
/// the Paper Map screen. Lazily materializes edges on first call; pass
/// rebuild=true to force a fresh edge build (re-runs the semantic pass).
/// Read persisted research gaps for a topic (understudied intersections /
/// contradictions / temporal / method-replication), evidence titles resolved.
/// Pure read — the gaps are produced by `paper_knowledge_build`'s gaps stage.
/// Semantic + BM25 search over paper full-text chunks (section-aware). Powers
/// the "Search papers" surface. `sections` is an optional comma list
/// (methods,results,limitations,…); `rollup=true` returns one row per paper.
/// Cited Q&A over the papers' full text. Grounds an LLM on section-aware paper
/// chunks and returns {ok, answer, citations:[{n,title,author,year,url,sections}],
/// used_chunks, sources_markdown}. Scope with `topic`, `post_id`, or `sections`.
/// Get or set a paper's reading status (to_read | reading | read).
/// Pass `status` to set; omit to read the current value.
/// All reading statuses (post_id → status) for a topic's papers — for showing
/// read/reading badges in a papers list.
/// The to-read queue for a topic's papers (or globally), or status counts.
/// Highlights + notes on a paper: action ∈ add | list | update | delete.
/// Every highlight + note across a topic's papers — the project notebook.
/// Composite Reader payload for one paper: title, sections (full text),
/// reading status, and highlights — everything the Reader screen needs.
/// Read the cached literature-review matrix for a topic.
/// Build (extract) the literature-review matrix for a topic's papers (LLM).
/// Export the literature-review matrix as CSV text.
/// Read cached 0-100 pain scores per gap for a topic (LLM-free).
/// (Re)compute pain scores for a topic via the painpoint extractor (LLM).
/// Roll up the real people behind each scored gap (needs pain scores first).
/// Read the topic-wide outreach list (or one gap's people via gap_id).
/// Trend velocity per gap (rising/falling/new) for a topic.
/// Overall posting velocity for a topic (recent vs prior window).
/// List saved gap alerts (optionally for one topic).
/// Create a saved gap alert (alert_type: spike|new|score_threshold).
/// Delete a saved gap alert by id.
/// Evaluate all enabled alerts now; records + returns any that fired.
/// List fired alert events (optionally for one topic).
/// Evidence-weighted verdict on a claim (LLM); empty claim lists cached.
/// Assemble a scheduled digest (top gaps, rising, people, alerts) for a topic.
/// Import a GummySearch export (JSON/CSV) of saved subreddits/audiences.
/// List saved audiences.
/// List curated discovery preset bundles.
/// Save a curated preset bundle as an audience.
/// Per-project research-flow progress (gather→read→synthesize→write).
/// Cross-project paper library — papers with reading status + collections.
/// Manage paper collections: list | create | rename | delete | add | remove.
/// Streaming "build the paper knowledge base" workflow. Fires
/// `paper:knowledge:progress` events (NDJSON lifecycle lines:
/// workflow:start, stage:start, stage:progress, stage:done, workflow:done)
/// as each stage (full text → summaries → relations → gaps → insights) runs,
/// so the Papers-tab stepper shows live counts. A final `paper:knowledge:done`
/// fires when the sidecar exits (catches a crash where workflow:done never
/// arrived). Per-topic deduped via ActiveGraphOps so two builds can't race.
///
/// `scope` ∈ all|top50|top25|abstracts (default all). `force` redoes summaries+gaps.
/// Warm the LLM model on app launch so the first collect's topic
/// canonicalization isn't a 30-60s cold start (the #1 "collect feels hung"
/// cause). Fire-and-forget from the frontend warm-up group; fail-soft.
// ─── Phase 4 — Monitoring + Weekly Delta View ─────────────────────────
//
// Runs `research monitor-*` CLI commands. Drives the Dashboard's
// "What's changed this week" card and per-topic delta indicators.
// See src/openreply/research/monitor.py.

/// Topic-scoped run history. Omit `topic` for the dashboard view across
/// all topics (returns top-N by delta magnitude within `since_days`).
// ─── Phase 3 — Hypothesis Tracking / Decision Journal ───────────────────
//
// Promote synthesize_insights hypothesis cards to stateful, trackable bets
// stored in the `hypothesis_tests` SQLite table. The UI's "Save as bet"
// button calls `hypothesis_create`; the Bets tab + state pills call
// `hypothesis_update_status` and `hypothesis_list`. See
// src/openreply/research/hypothesis_tracker.py for the state machine.

/// Pre-check before starting a collect — "does this topic already exist?"
/// UI uses the result to offer Open / Augment / New-fresh choices.
/// Merge LLM-canonicalization-caused duplicate topic rows. Dry-run by default.
/// Does NOT merge rows that differ purely in user casing — those stay separate.
/// Merge one user-chosen topic into another: re-point ALL of `source`'s
/// data into `target` across every topic-keyed table, then remove the
/// source. Dry-run by default (returns a preview); pass `apply=true` to
/// perform the merge. Auto re-enrichment of the merged corpus is driven
/// from the frontend (via the existing enrich-graph stream) so the user
/// sees progress and it reuses the per-topic dedup lock.
/// Relevance-gate cleanup for an existing topic. Dry-run by default.
// ─── Dual-Mode Pivot — Product Mode commands ─────────────────────────────
// Commands for the new product-centric surface. See research/product.py,
// product_sweep.py, product_digest.py. Every command uses run_cli which
// routes dev→venv python, prod→PyInstaller sidecar automatically.

// ─── Page explainer — eye-icon "why this page exists" ───────────────────

// ─── Runtime snapshot — Task Manager backing ────────────────────────────


// ─── Iterate / Autoresearch (2026-05-03 Phase 4) ──────────────────────────
// Persistent in-app autoresearch loop. Each call wraps a CLI subcommand
// that touches new SQLite tables: iterate_runs, iterate_iterations,
// topic_pipeline_config.

// ─── Deliberation (2026-05-03 Phase 3) ────────────────────────────────────
// 5-persona debate over a topic's cached findings.

// ─── Audience personas (2026-05-03) ───────────────────────────────────────
// Cluster real authors in a topic into ICP personas backed by their
// actual posts. Pairs with the Audience screen + Launch Brief.

// ─── Launch & GTM (2026-05-02) ────────────────────────────────────────────
// Per-topic Launch Brief: target audience, demographics, where to launch,
// market requirements. Deterministic + optional LLM augmentation.

// ─── Discovery framework expansion (2026-05-01_04) ────────────────────────
// OST + RICE + MoSCoW + Empathy Maps + Four Risks + Value Curve.

// OST experiment CRUD — distinct namespace from gap_discovery's
// `experiments-list` / `list_experiments` which surface a different
// (LLM-proposed, paper-grounded) experiment concept.
// ── Persistent topic AI chat conversations (2026-05-31) ──────────────────
//
// ChatGPT-style saved threads per topic. Native read-WRITE rusqlite
// (db.rs chat_conv_*) — no Python sidecar spawn on the hot path. The UI
// stores its in-memory message array as a JSON blob per conversation.

/// List conversation metadata. `topic` omitted → every conversation
/// across all topics (the global Chats view).
/// Fetch one conversation with its full message array.
/// Upsert a conversation (create on first save, update thereafter).
// ── Native rusqlite readers for the products-table JSON-blob getters ──────
//
// four_risks / value_curve / tam_sam_som / porter / positioning / cost_model
// all share one Python shape (research/product.py): read a single
// `<column>_json` from `products WHERE id=?`, JSON-decode it (empty/invalid →
// {}), then scaffold a fixed-shape payload with defaults. Porting these to
// native rusqlite turns a ~2s sidecar spawn (30-70s cold DMG) into ~10ms.
// The `py*` helpers below reproduce Python's truthiness defaults EXACTLY —
// notably `float(x or 18.0)` treats a stored 0 as falsy → 18.0, and
// `str(x or "USD")` treats "" as falsy → "USD".

/// `float(v or default)` — Python falsy (None / 0 / 0.0 / "" / missing) → default.
fn py_float(v: Option<&Value>, default: f64) -> f64 {
    match v {
        Some(Value::Number(n)) => {
            let f = n.as_f64().unwrap_or(0.0);
            if f == 0.0 { default } else { f }
        }
        Some(Value::String(s)) => {
            if s.trim().is_empty() { default } else { s.trim().parse().unwrap_or(default) }
        }
        Some(Value::Bool(true)) => 1.0,
        _ => default,
    }
}
/// `str(v or default)` — Python falsy ("" / None / missing) → default.
fn py_str(v: Option<&Value>, default: &str) -> String {
    match v {
        Some(Value::String(s)) if !s.is_empty() => s.clone(),
        Some(Value::Number(n)) => n.to_string(),
        _ => default.to_string(),
    }
}
/// `list(v or [])` — array passes through, anything else → [].
fn py_arr(v: Option<&Value>) -> Value {
    match v {
        Some(x) if x.is_array() => x.clone(),
        _ => Value::Array(vec![]),
    }
}
/// Shared native reader: `SELECT <column> FROM products WHERE id=:id`, decode
/// the JSON blob, hand the decoded object to `shape` to build the payload.
/// Mirrors the missing-table / missing-product error envelopes Python returns.
async fn product_blob_get(
    app: &AppHandle,
    product_id: String,
    column: &'static str,
    shape: impl FnOnce(&str, &serde_json::Map<String, Value>) -> Value + Send + 'static,
) -> Result<Value, String> {
    let dir = crate::cli::data_dir(app).map_err(err_to_string)?;
    let db_path = dir.join("openreply.db");
    if !db_path.exists() {
        return Ok(serde_json::json!({"ok": false, "error": "products table not initialized"}));
    }
    let result = tokio::task::spawn_blocking(move || -> Result<Value, String> {
        let mut params = serde_json::Map::new();
        params.insert("id".into(), Value::String(product_id.clone()));
        let sql = format!("SELECT {column} FROM products WHERE id = :id");
        match crate::db::query_db(&db_path, &sql, Some(&params)) {
            Ok(rows) => {
                let Some(r) = rows.into_iter().next() else {
                    return Ok(serde_json::json!({
                        "ok": false, "error": format!("product '{product_id}' not found")
                    }));
                };
                let blob = r.as_object()
                    .and_then(|o| o.get(column))
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let data: serde_json::Map<String, Value> = if blob.is_empty() {
                    serde_json::Map::new()
                } else {
                    serde_json::from_str::<Value>(blob)
                        .ok()
                        .and_then(|v| v.as_object().cloned())
                        .unwrap_or_default()
                };
                Ok(shape(&product_id, &data))
            }
            Err(e) => {
                let msg = e.to_string();
                if msg.contains("no such table") {
                    Ok(serde_json::json!({"ok": false, "error": "products table not initialized"}))
                } else { Err(msg) }
            }
        }
    })
    .await
    .map_err(|e| format!("product_blob_get failed: {e}"))??;
    Ok(result)
}

// ── TAM / SAM / SOM ────────────────────────────────────────────────
// ── Porter's Five Forces ──────────────────────────────────────────────
// ── 2x2 positioning map ───────────────────────────────────────────────
// ── Cost model + pricing tiers ────────────────────────────────────────
#[tauri::command]
pub async fn cost_model_get(app: AppHandle, product_id: String) -> Result<Value, String> {
    product_blob_get(&app, product_id, "cost_model_json", |pid, data| {
        serde_json::json!({
            "ok": true, "product_id": pid,
            "blended_rate": py_float(data.get("blended_rate"), 0.0),
            "infra_monthly": py_float(data.get("infra_monthly"), 0.0),
            "maintenance_pct": py_float(data.get("maintenance_pct"), 18.0),
            "ltv": py_float(data.get("ltv"), 0.0),
            "cac": py_float(data.get("cac"), 0.0),
            "tiers": py_arr(data.get("tiers")),
            "currency": py_str(data.get("currency"), "USD"),
        })
    }).await
}

// ── PRD Generator ──────────────────────────────────────────────────────
/// Run the Problem -> Why -> Science -> Solution pipeline for a topic.
/// Returns a summary JSON or `{ok: false, skipped: true, reason}` if no
/// LLM provider is configured.
/// Run the temporal-gaps classifier (CHRONIC / EMERGING / FADING).
/// Returns either a list of classified painpoints, an `_error` dict when
/// historical data is missing, or `{ok:false, skipped:true, ...}` on no LLM.
/// Per-source sentiment aggregation for a topic. One LLM call per source
/// with ≥3 posts. Persists results as graph_nodes kind='source_sentiment'
/// so the UI can re-render fast on next open without re-running the LLM.
/// Concept Agent — synthesize 3-5 evidence-backed product concepts from a
/// topic's painpoints. Returns {topic, concepts, persisted, reason?}.
/// Concepts are persisted as graph_nodes kind='concept' with edges back to
/// their source painpoints so the UI can render clickable citations.
// ─── Paper-research (students / UX research / evidence-backed reports) ────────

/// Download a PDF to the app's local data dir and return its absolute path.
///
/// The webview can't load most paper PDFs directly: publishers send
/// `X-Frame-Options: deny` (kills iframes) and CORS doesn't permit binary
/// fetch from origins not in `connect-src`. So we mirror the file once, on
/// the Rust side (no CORS, no frame headers), then the frontend renders it
/// via `convertFileSrc()` → `asset://` URL — which the OS PDF stack handles.
///
/// Cache key: SHA-256 of the URL truncated to 24 hex chars. Means the same
/// URL is downloaded once across topics, regardless of post_id reuse.
// ─── Intent layer (per-topic deliverable routing) ──────────────────────────────

/// Quick-extract — runs `research gaps` for a topic without building the
/// graph. Returns the 4-category JSON for preview only. Use enrich_graph
/// to persist the results into the knowledge graph.
/// Cross-table search — posts, graph nodes, analyses, papers, hypotheses,
/// feedback, + optional palace semantic hits in aggressive mode. Persists
/// a summary row to mcp_analyses so future pipelines can consume it.
/// Run an ad-hoc Reddit search via PRAW. Returns an array of post rows.
/// Start a live Reddit stream. Long-running — use cancel_stream to stop.
/// Emits `stream:hit` event per matching post/comment, `stream:done` when ended.
/// Empty `keywords` = firehose mode (every post/comment).
/// Cancel the active stream (if any). Returns true if a stream was killed.
/// Is a stream currently active? Checks both prod + dev-python slots.
// ─── Scheduled runs ─────────────────────────────────────────────────

#[tauri::command]
pub async fn schedule_install(app: AppHandle, interval_hours: u32) -> Result<Value, String> {
    let data = crate::cli::data_dir(&app).map_err(err_to_string)?;
    let data_str = data.to_string_lossy().to_string();
    crate::schedule::install(&app, interval_hours, &data_str)
}

#[tauri::command]
pub async fn schedule_uninstall() -> Result<Value, String> {
    crate::schedule::uninstall()
}

#[tauri::command]
pub async fn schedule_status() -> Result<Value, String> {
    crate::schedule::status()
}

/// Time-windowed diff of findings — "what's new in the last N days?".
/// Analyze a single paper (summary / relevance / builder takeaway).
/// Bulk-analyze every unanalyzed academic paper for a topic.
/// Cheap background prefetch: download + extract full PDF TEXT (no LLM) for a
/// topic's top-N papers, so chat grounds on real paper content (intro +
/// conclusions) instead of just the abstract. Fired automatically after a
/// collect; the heavier `analyze_papers_bulk` (LLM crux) stays manual.
/// Ranked opportunity list (read-only): interventions by RICE + Kano + MoSCoW
/// tags + the painpoint each addresses. Powers the Prioritize tab.
/// Score every intervention: RICE (deterministic) + Kano + MoSCoW (LLM), each
/// persisting to graph_nodes.metadata_json. Returns the freshly-ranked list.
/// The two LLM scorers are best-effort (a missing LLM key skips them, RICE
/// still ranks).
// ── FSD Fleet — debate on the Topic Map ─────────────────────────────────────

/// Run the 5-persona debate over a topic's cached findings, persist verdicts +
/// lineage + node render-cache, and return the run summary. Falls back to the
/// heuristic debate when no LLM key is configured.
/// Read persisted debate verdicts for a topic (with staleness flag). Cheap,
/// cached on the JS side — drives the trust badges on the Map + finding cards.
/// Phase 3 — replay/audit timeline for a topic's latest debate (run header,
/// per-round per-persona transcript, tier counts, provenance gate counts).
// ── FSD Fleet — orchestrated flow ───────────────────────────────────────────

/// Decision gate + route options (quick/standard/deep) for the confirmation gate.
/// Run the orchestrated fleet flow (clarify → ground → debate → synthesize) and
/// return the per-stage timeline. `route` is quick|standard|deep (None → gate pick).
/// NL Command Center — decompose a strategic directive into per-topic missions
/// (plan-only by default; `execute` runs a flow per topic at `level`).
/// Latest fleet flow run for a topic (cached read for the flow timeline).
/// Streaming variant — runs the fleet flow and forwards NDJSON stage lines as
/// `fleet:progress` events (frontend filters on `__fleet`); `fleet:done` fires
/// on exit. Reuses run_cli_streaming (shares the collect mutual-exclusion guard).
// ── Academic Mode ────────────────────────────────────────────────────────────

/// Run Academic Mode (research → synthesize → peer_review → finalize) and return
/// the final result dict. Hard-blocks finalize when <2 academic papers grounded.
/// `level` is L1|L2|L3; pass `approved=true` to resume an L2 pause.
/// Streaming variant — forwards NDJSON stage lines as `academic:progress`
/// events (frontend filters on `__academic`); `academic:done` fires on exit.
/// Latest stored academic brief for a topic (read for the brief view).
/// Hash-chained Material Passport for a topic's latest academic run (provenance
/// view). Returns {ok, run_id, entries:[{seq, stage, payload, entry_hash}], verified}.
// ── Pre-build strategy frameworks ───────────────────────────────────────────
// Each pair is read-only `_get` (cheap, cached on the JS side) + `_compute`
// (LLM synthesis grounded in the topic's evidence, persisted to
// strategy_artifacts). Compute degrades gracefully when no LLM key is set.

/// TAM/SAM/SOM market sizing (+ market value) — read cached artifact.
/// TAM/SAM/SOM market sizing — run the LLM synthesis and persist.
/// Porter's Five Forces (topic-level, evidence-grounded) — read cached artifact.
/// Named `porter_forces_*` to avoid clashing with the product-level
/// `porter_get`/`porter_set` commands above.
/// Porter's Five Forces — run the LLM synthesis and persist.
/// SWOT — read cached artifact.
/// SWOT — run the LLM synthesis and persist.
/// Lean Canvas — read cached artifact.
/// Lean Canvas — run the LLM synthesis and persist.
/// Value Proposition Canvas — read cached artifact.
/// Value Proposition Canvas — run the LLM synthesis and persist.
/// North-Star metric — read cached artifact.
/// North-Star metric — run the LLM synthesis and persist.
/// 5-Whys root-cause analysis of the topic's top painpoints — read cached artifact.
/// 5-Whys root-cause analysis — run the LLM synthesis and persist.
/// Tactics matched to the topic's painpoints from the tactic library (read-only).
/// Connect the dots — novel cross-paper connections (read cached artifact).
/// Connect the dots — (re)build novel cross-paper connections via the engine.
/// Research conclusions — evidence-grounded synthesis (read cached artifact).
/// Research conclusions — run the LLM synthesis over papers + connections + gaps.
/// Read all paper-analysis rows for a topic (one SELECT, no LLM).
/// Export the openreply-map HTML for a topic. Returns absolute path.
/// Export the graph as raw JSON (D3-compatible). Returns absolute path.
/// Findings (painpoints / feature_wish / product / workaround) for a topic.
/// Uses parameterized SQL so topic/kind strings can't break out of the query.
/// Generate the premium citation-rich markdown report for a topic.
/// Ingest a local file into a topic (CSV/JSON/TXT/VTT/SRT/MD).
/// Walk a folder recursively and ingest every supported file (md/pdf/csv/
/// json/txt/vtt/srt) into a single topic. The Python side enforces a
/// configurable file-count cap and skips the usual junk dirs (.git,
/// node_modules, dist, build, hidden subtrees) so the user can drop a
/// project root without polluting the corpus.
///
/// Returns the per-file ingest summary so the UI can show "ingested 12/14
/// files, 2 failed (… reasons)" without a second round-trip.
/// List exported files (.md, .html) in the app data dir.
/// Read export destination settings.
#[tauri::command]
pub async fn export_prefs_get(app: AppHandle) -> Result<Value, String> {
    let default_dir = data_dir(&app).map_err(err_to_string)?;
    let configured_path = export_prefs_path(&app)?;
    let configured_exists = configured_path.exists();
    let effective = read_export_dir(&app)?;
    let configured = if configured_exists {
        let raw = std::fs::read_to_string(&configured_path).unwrap_or_default();
        let v: Value = serde_json::from_str(&raw).unwrap_or(Value::Null);
        v.get("export_dir")
            .and_then(|x| x.as_str())
            .map(|s| s.to_string())
            .unwrap_or_default()
    } else {
        String::new()
    };
    Ok(serde_json::json!({
        "default_dir": default_dir.to_string_lossy().to_string(),
        "configured_dir": configured,
        "effective_dir": effective.to_string_lossy().to_string(),
        "is_custom": !configured.trim().is_empty(),
    }))
}

/// Persist export destination settings.
#[tauri::command]
pub async fn export_prefs_set(app: AppHandle, export_dir: Option<String>) -> Result<Value, String> {
    let normalized = export_dir
        .as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    if let Some(dir) = normalized.as_ref() {
        let p = std::path::PathBuf::from(dir);
        if !p.exists() {
            return Err(format!("directory does not exist: {dir}"));
        }
        if !p.is_dir() {
            return Err(format!("not a directory: {dir}"));
        }
    }
    write_export_dir(&app, normalized.as_deref())?;
    export_prefs_get(app).await
}

/// Soft-delete a topic (T1.3). Sets topic_prefs.deleted_at and hides the
/// topic from list_topics / the graph. Reversible via restore_topic for 7
/// days; after that purge_deleted moves it to hard-delete during a nightly
/// sweep. If the topic has no topic_prefs row (rare — graph-only topic),
/// we fall back to an immediate hard-delete since there's nowhere to stash
/// a tombstone.
/// Restore a soft-deleted topic by clearing deleted_at.
/// List soft-deleted topics (within the restore window).
/// Hard-purge soft-deleted topics older than `min_age_days` (default 7).
/// Typically called from a launchd nightly sweep; exposed here for a
/// Settings "Empty trash now" button.
/// Reveal a file in Finder / Explorer.
#[tauri::command]
pub async fn reveal_in_finder(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open").arg("-R").arg(&path)
            .spawn().map(|_| ()).map_err(|e| e.to_string())
    }
    #[cfg(target_os = "linux")]
    {
        let parent = std::path::Path::new(&path).parent().ok_or("no parent")?;
        std::process::Command::new("xdg-open").arg(parent)
            .spawn().map(|_| ()).map_err(|e| e.to_string())
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer").args(["/select,", &path])
            .spawn().map(|_| ()).map_err(|e| e.to_string())
    }
}

/// Cancel the active collect job, if any. Returns whether a job was killed.
/// Force-clear an orphaned single-flight collect lock. Use case:
///   - The single-flight slot (`ActiveJob` / `ActiveJobPid`) is held.
///   - But `ActiveCollects` has no matching topic → no live collect we can
///     report on, no `collect:done` listener that will ever fire.
///   - The user is stuck — their "Start collect" calls are blocked by a
///     ghost.
///
/// Returns `{ ok, was_orphan, slot_held, map_empty, killed }` so the UI can
/// distinguish "you weren't actually stuck" (`was_orphan=false`) from "we
/// cleared it" (`was_orphan=true, killed=true`). Safe to call even when
/// nothing is running — it's a no-op in that case.
///
/// We intentionally do NOT kill the slot when the topic map is non-empty —
/// that would clobber a legitimate running collect. The Unstick affordance
/// in the busy modal only surfaces when we've already detected the orphan
/// state, but this guard keeps the IPC contract safe even if the frontend
/// races a real collect into the slot between detection and click.
/// Is a long-running collect currently active? Checks BOTH the prod sidecar
/// slot and the dev-python pid slot so the UI chip is accurate either way.
/// The app's persistent data dir (for "Reveal in Finder" etc.)
#[tauri::command]
pub async fn app_data_dir(app: AppHandle) -> Result<String, String> {
    data_dir(&app)
        .map(|p| p.to_string_lossy().to_string())
        .map_err(err_to_string)
}

/// Onboarding / startup diagnostics. Wraps `openreply health --json` with a
/// sidecar-spawn probe so the frontend can distinguish three failure modes:
///   (a) sidecar binary can't even launch (permissions / notarization / arch)
///   (b) sidecar launches but individual checks fail (data dir, DB, model, LLM)
///   (c) everything passes
#[tauri::command]
pub async fn health_check(app: AppHandle) -> Result<Value, String> {
    let t0 = std::time::Instant::now();
    match run_cli(&app, vec!["health", "--json"]).await {
        Ok(v) => {
            // Python always emits JSON; if we got Null the binary printed
            // something else (e.g. Typer complaint) — treat as broken.
            if v.is_null() {
                return Ok(serde_json::json!({
                    "ok": false,
                    "sidecar_ok": false,
                    "detail": "sidecar ran but returned no JSON — check binary integrity",
                    "elapsed_ms": t0.elapsed().as_millis() as u64,
                }));
            }
            let mut obj = v;
            if let Some(map) = obj.as_object_mut() {
                map.insert("sidecar_ok".into(), Value::Bool(true));
                map.insert("elapsed_ms".into(),
                           Value::from(t0.elapsed().as_millis() as u64));
            }
            Ok(obj)
        }
        Err(e) => Ok(serde_json::json!({
            "ok": false,
            "sidecar_ok": false,
            "detail": format!("sidecar failed to spawn: {e}"),
            "elapsed_ms": t0.elapsed().as_millis() as u64,
        })),
    }
}

/// Local semantic search over the posts corpus — hybrid vector + BM25 via the
/// ChromaDB palace. Offline (no external API). Returns up to `k` hits with
/// score, text, and metadata. Topic / source filters are optional.
/// Find the k posts semantically closest to `post_id`.
/// One-shot reindex of every row in `posts` into the semantic palace. Used
/// after enabling the retrieval extras on an existing corpus.
/// Palace doc count + path (for Settings → Data card).
#[tauri::command]
pub async fn palace_stats(app: AppHandle) -> Result<Value, String> {
    run_cli(&app, vec!["research", "palace-stats"])
        .await
        .map_err(err_to_string)
}

/// Has the ONNX embedding model been downloaded yet? Cheap (one stat), no
/// Python spawn beyond checking the cache dir. Returned shape:
/// `{installed, ready, archive_bytes, expected_bytes, cache_dir}`.
/// `installed` = retrieval extras present; `ready` = ONNX weights cached.
#[tauri::command]
pub async fn palace_model_status(app: AppHandle) -> Result<Value, String> {
    run_cli(&app, vec!["research", "palace-model-status"])
        .await
        .map_err(err_to_string)
}

/// Kick off the one-time ~80 MB ONNX model download. Streams progress via
/// `palace:warmup:progress` events (one JSON object per line) and emits
/// Runtime pre-warm — load chromadb + MiniLM ONNX into the sidecar daemon
/// process by issuing one trivial search query. After this returns, the
/// user's first real semantic search skips the 2-3s cold-start (~36s
/// under contention) and lands in ~50-200 ms instead.
///
/// Idempotent + cheap (~2-3s on a clean system; longer if model not yet
/// downloaded → returns {ok:false, skipped:true} in that case). Returns
/// `{ok, elapsed_seconds, note}`. Never raises.
///
/// The intended caller is the JS post-boot warmer (main.js); fire 3-5s
/// after splash closes so the cost is invisible.
/// `palace:warmup:done` when finished. Safe to call when the model is
/// already cached — emits `{event:"done", ok:true, already:true}` instantly.
/// Re-embed every post into Palace. Streams `palace:reindex:progress`
/// events (one JSON per line) and emits `palace:reindex:done` on exit.
/// Idempotent — `upsert_posts_many` skips unchanged rows. Used by the
/// "Reindex palace" Settings button + by the auto-heal flow when palace
/// has been reset due to a chromadb format mismatch (legacy 0.x segment
/// files in a 1.x runtime → segfault → heal to empty → reindex).
#[tauri::command]
pub async fn palace_reindex(app: AppHandle) -> Result<(), String> {
    run_cli_chat_streaming(
        &app,
        vec!["research", "palace-reindex"],
        "palace:reindex:progress",
        "palace:reindex:done",
    )
    .await
    .map_err(err_to_string)
}

/// Return the SQLite file's last-modified time as a unix millisecond
/// timestamp. Cheap (one stat syscall — no Python spawn), so the frontend can
/// poll on a short interval and invalidate its in-memory cache when the DB
/// changes externally (background collect, MCP server writes, direct CLI use).
/// Returns 0 if the DB hasn't been created yet.
#[tauri::command]
pub async fn db_mtime(app: AppHandle) -> Result<u64, String> {
    let dir = data_dir(&app).map_err(err_to_string)?;
    let db = dir.join("openreply.db");
    match std::fs::metadata(&db) {
        Ok(m) => {
            let mt = m.modified().map_err(|e| e.to_string())?;
            let since = mt
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|e| e.to_string())?;
            Ok(since.as_millis() as u64)
        }
        // DB not yet created — not an error, just signal "no data".
        Err(_) => Ok(0),
    }
}

/// Start a chat stream. Sidecar emits JSON events on `chat:progress`.
/// When `agent=true`, the LLM gets tool-use access (list_topics / run_query /
/// get_findings / source_breakdown / sample_posts).
/// Cancel the active chat job, if any.
/// Is a chat currently streaming? Checks both prod + dev-python slots.
/// Send a "Reply with OK" ping to the chosen LLM — returns {ok, latency_ms, reply}.
#[tauri::command]
pub async fn test_llm(
    app: AppHandle,
    provider: Option<String>,
    model: Option<String>,
) -> Result<Value, String> {
    let mut args: Vec<String> = vec!["research".into(), "test-llm".into(), "--json".into()];
    if let Some(p) = provider { if !p.is_empty() { args.push("--provider".into()); args.push(p); } }
    if let Some(m) = model    { if !m.is_empty() { args.push("--model".into());    args.push(m); } }
    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    run_cli(&app, arg_refs).await.map_err(err_to_string)
}

/// List locally installed Ollama models.
#[tauri::command]
pub async fn list_ollama_models(app: AppHandle) -> Result<Value, String> {
    run_cli(&app, vec!["research", "list-models", "--provider", "ollama", "--json"])
        .await
        .map_err(err_to_string)
}

/// Spawn `ollama serve` in the background if it's not already running.
/// Returns `{ ok, already_running, pid }` on success.
///
/// We don't hold the child handle — once the daemon is up it's self-hosting.
/// The ping probe in the frontend will confirm readiness.
#[tauri::command]
pub async fn ollama_start_service() -> Result<Value, String> {
    use std::process::{Command, Stdio};

    // Fast path: if already listening on the default port, do nothing.
    if tokio::net::TcpStream::connect("127.0.0.1:11434").await.is_ok() {
        return Ok(serde_json::json!({ "ok": true, "already_running": true }));
    }

    // Find the ollama binary. Prefer $PATH; fall back to the Homebrew default.
    let which = Command::new("which").arg("ollama").output();
    let ollama_path: String = match which {
        Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout).trim().to_string(),
        _ => "/usr/local/bin/ollama".into(),
    };
    if !std::path::Path::new(&ollama_path).exists() {
        return Err(format!(
            "ollama not found at {ollama_path}. Install from https://ollama.com/download"
        ));
    }

    let child = Command::new(&ollama_path)
        .arg("serve")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("failed to spawn ollama serve: {e}"))?;
    let pid = child.id();

    // Wait up to 5s for the port to open so the UI can immediately hit /api/tags.
    for _ in 0..25 {
        if tokio::net::TcpStream::connect("127.0.0.1:11434").await.is_ok() {
            return Ok(serde_json::json!({
                "ok": true, "already_running": false, "pid": pid
            }));
        }
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }
    Err("ollama serve started but didn't open :11434 within 5s".into())
}

/// Terminate the running `ollama serve` daemon (SIGTERM).
#[tauri::command]
pub async fn ollama_stop_service() -> Result<Value, String> {
    use std::process::Command;
    // Graceful kill first — Ollama handles SIGTERM cleanly.
    let out = Command::new("pkill")
        .args(["-TERM", "-x", "ollama"])
        .output()
        .map_err(|e| format!("pkill failed: {e}"))?;
    // pkill exits 0 if it killed something, 1 if no process matched — both are fine.
    let killed = out.status.code() == Some(0);
    Ok(serde_json::json!({ "ok": true, "killed": killed }))
}

/// Run a user-supplied SELECT/WITH query. Rejects anything that
/// isn't purely read-only so the DB Console can't corrupt state.
///
/// Optional `topic` param is bound to `:topic` in the SQL by sqlite-utils
/// (safe from SQL injection). `params` is a map of additional named bindings.
/// Native fast-path for the cached insights read.
///
/// `synthesize_insights(topic, cached=true)` was just one row from
/// `topic_insights` — but it went through the Python sidecar (50–200ms warm,
/// 500–2000ms cold on a fresh DMG). This rusqlite path collapses it to ~1ms.
/// Returns the same shape the Python load_insights() emitted, with
/// `_cached=true`, `_generated_at`, `_corpus_size`, `_provider`, `_model`.
/// Returns `{ok: false, error}` when no cached row exists, matching how
/// the Python branch communicated "never generated".
/// Native bundled count fetch — replaces 11 separate `runQuery` calls (one
/// per tab freshness badge) with a single rusqlite round-trip.
///
/// Returns a JSON object: `{ painpoints, feature_wishes, workarounds,
/// products, concepts, evidence_papers, total_findings, posts, sources,
/// hypotheses, ai_analyses }`. Empty/zero values are still present so the
/// frontend can simply look up keys without null-guarding every read.
///
/// On a fresh DB (no `graph_nodes` table yet), every counter is 0 — never
/// errors. Sub-millisecond on warm WAL.
/// Native rusqlite path for the Papers tab. Mirrors `research papers-list`
/// shape: list of paper rows with derived `pdf_url` and `has_fulltext` flag.
/// Was a Python sidecar call — now ~1 ms on warm WAL.
/// Native rusqlite path for the Bets tab. Mirrors `research hypothesis-list`.
/// Hydrates `evidence_json` / `tactic_link_json` / `notes_json` JSON columns
/// the same way Python's `_hydrate` did.
/// Native bundled fetch for the Solutions tab. Returns:
///   { painpoints: [{ painpoint_id, painpoint_label, metadata_json,
///                    interventions: [...], papers: [...] }] }
/// Replaces 1 + 2*N round-trips (one per painpoint × interventions × papers)
/// with **2 SQL statements** total — one for painpoints, one big JOIN for
/// every intervention and every paper across all painpoints. Matches the
/// frontend's existing render shape so no UI changes are needed.
/// Path to the user's BYOK env file (`~/.config/openreply/.env`).
///
/// macOS/Linux: `$HOME/.config/openreply/.env`.
/// Windows: `%USERPROFILE%\.config\openreply\.env` — `HOME` is not set by
/// default on Windows, so we fall back to `USERPROFILE` (the standard
/// per-user root the OS guarantees). Same `.config/openreply` suffix is
/// kept so `openreply reset` (and the bundled `.env` doc) point at the
/// same location on every platform.
fn byok_env_path() -> Result<std::path::PathBuf, String> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|e| format!("HOME/USERPROFILE unset: {e}"))?;
    let dir = std::path::PathBuf::from(home).join(".config").join("openreply");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(".env"))
}

/// Parse simple KEY=VALUE pairs from the env file (ignores comments + blanks).
fn parse_env(contents: &str) -> std::collections::BTreeMap<String, String> {
    let mut out = std::collections::BTreeMap::new();
    for line in contents.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') { continue; }
        if let Some((k, v)) = line.split_once('=') {
            let v = v.trim().trim_matches('"').trim_matches('\'');
            out.insert(k.trim().to_string(), v.to_string());
        }
    }
    out
}

/// Serialize the env map back, one KEY=VALUE per line.
fn serialize_env(map: &std::collections::BTreeMap<String, String>) -> String {
    let mut lines = String::new();
    lines.push_str("# Generated by OpenReply — edit keys in Settings\n");
    for (k, v) in map {
        lines.push_str(&format!("{}={}\n", k, v));
    }
    lines
}

fn env_or_file_value(
    map: &std::collections::BTreeMap<String, String>,
    keys: &[&str],
) -> Option<String> {
    for key in keys {
        if let Ok(v) = std::env::var(key) {
            let t = v.trim();
            if !t.is_empty() {
                return Some(t.to_string());
            }
        }
        if let Some(v) = map.get(*key) {
            let t = v.trim();
            if !t.is_empty() {
                return Some(t.to_string());
            }
        }
    }
    None
}

/// Read current BYOK status — returns which keys are set (masked values).
#[tauri::command]
pub async fn byok_status(_app: AppHandle) -> Result<Value, String> {
    let path = byok_env_path()?;
    let contents = std::fs::read_to_string(&path).unwrap_or_default();
    let map = parse_env(&contents);
    let mask = |keys: &[&str]| -> Value {
        match env_or_file_value(&map, keys) {
            Some(v) => {
                let masked = if v.len() > 8 {
                    format!("{}…{}", &v[..4], &v[v.len()-4..])
                } else { "•".repeat(v.len()) };
                serde_json::json!({ "set": true, "preview": masked })
            }
            _ => serde_json::json!({ "set": false, "preview": "" }),
        }
    };
    // Non-secret values (pref / model / base-url) — return raw so user can see.
    let raw = |keys: &[&str]| -> Value {
        env_or_file_value(&map, keys)
            .map(Value::String)
            .unwrap_or(Value::String(String::new()))
    };
    Ok(serde_json::json!({
        "path": path.to_string_lossy().to_string(),
        "anthropic":  mask(&["ANTHROPIC_API_KEY"]),
        "openai":     mask(&["OPENAI_API_KEY"]),
        "openrouter": mask(&["OPENROUTER_API_KEY"]),
        "groq":       mask(&["GROQ_API_KEY"]),
        "deepseek":   mask(&["DEEPSEEK_API_KEY"]),
        "mistral":    mask(&["MISTRAL_API_KEY"]),
        "google":     mask(&["GOOGLE_API_KEY"]),
        "nvidia":     mask(&["NVIDIA_API_KEY"]),
        // Alias: most frontend code looks up `byok.ollama` (mirroring the
        // BYOK provider key), while a few older spots use `ollama_base_url`.
        // Return both — same URL string, non-empty when the user has saved one.
        "ollama":               raw(&["OLLAMA_BASE_URL"]),
        "ollama_base_url":      raw(&["OLLAMA_BASE_URL"]),
        "reddit_client_id":     mask(&["REDDIT_CLIENT_ID"]),
        "reddit_client_secret": mask(&["REDDIT_CLIENT_SECRET"]),
        "reddit_refresh_token": mask(&["REDDIT_REFRESH_TOKEN"]),
        // Data-source API keys for non-Reddit fetchers. YouTube is required
        // to collect video comments; the other two are optional rate-limit
        // upgrades for Semantic Scholar + PubMed. All three surface in the
        // BYOK modal's "Reddit + sources" tab.
        "youtube_api_key":          mask(&["YOUTUBE_API_KEY"]),
        "semantic_scholar_api_key": mask(&["SEMANTIC_SCHOLAR_API_KEY", "S2_API_KEY"]),
        "ncbi_api_key":             mask(&["NCBI_API_KEY"]),
        "scrapecreators_api_key":   mask(&["SCRAPECREATORS_API_KEY"]),
        "truthsocial_token":        mask(&["TRUTHSOCIAL_TOKEN"]),
        "x_auth_token":             mask(&["AUTH_TOKEN"]),
        "x_ct0":                    mask(&["CT0"]),
        "xai_api_key":              mask(&["XAI_API_KEY"]),
        "xquik_api_key":            mask(&["XQUIK_API_KEY"]),
        "llm_provider": raw(&["LLM_PROVIDER"]),
        "llm_model":    raw(&["LLM_MODEL"]),
    }))
}

/// Set (or update) a single BYOK key. Empty `value` deletes the key.
#[tauri::command]
pub async fn byok_set(_app: AppHandle, name: String, value: String) -> Result<Value, String> {
    const ALLOWED: &[&str] = &[
        "ANTHROPIC_API_KEY",
        "OPENAI_API_KEY",
        "OPENROUTER_API_KEY",
        "GROQ_API_KEY",
        "DEEPSEEK_API_KEY",
        "MISTRAL_API_KEY",
        "GOOGLE_API_KEY",
        "NVIDIA_API_KEY",
        "PERPLEXITY_API_KEY",
        "OLLAMA_BASE_URL",
        "LLM_PROVIDER",
        "LLM_MODEL",
        "REDDIT_CLIENT_ID",
        "REDDIT_CLIENT_SECRET",
        "REDDIT_REFRESH_TOKEN",
        "YOUTUBE_API_KEY",
        "SEMANTIC_SCHOLAR_API_KEY",
        "S2_API_KEY",
        "NCBI_API_KEY",
        "BSKY_HANDLE",
        "BSKY_APP_PASSWORD",
        "SCRAPECREATORS_API_KEY",
        "TRUTHSOCIAL_TOKEN",
        "AUTH_TOKEN",
        "CT0",
        "XAI_API_KEY",
        "XQUIK_API_KEY",
    ];
    if !ALLOWED.contains(&name.as_str()) {
        return Err(format!("key '{}' is not allowed", name));
    }
    let path = byok_env_path()?;
    let contents = std::fs::read_to_string(&path).unwrap_or_default();
    let mut map = parse_env(&contents);
    let trimmed = value.trim().to_string();
    let cleared = trimmed.is_empty();
    if cleared {
        map.remove(&name);
    } else {
        map.insert(name.clone(), trimmed.clone());
    }
    std::fs::write(&path, serialize_env(&map)).map_err(|e| e.to_string())?;
    // Restrict perms to 0600 on unix so keys aren't world-readable.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    // Mirror the change into the running process's env so subsequent
    // byok_status / list_provider_models / fetch_openai_compat calls
    // (which prefer process env over file via env_or_file_value) see
    // the new value immediately. Without this, dotenvy's boot-time
    // snapshot wins forever — saving LLM_PROVIDER=nvidia to the file
    // would still resolve to whatever the env was at app launch
    // (typically the previous default, e.g. "ollama"), so the UI
    // pill, llm-ready predicates, and Python sidecar all keep using
    // the stale provider until the app is fully restarted.
    //
    // SAFETY: std::env::set_var / remove_var are unsafe in
    // multi-threaded programs because libc getenv may race with
    // setenv. We accept that for BYOK because (a) writes are
    // user-initiated, never reentrant, (b) the alternative is forcing
    // an app restart on every key change. Production note: if a
    // future upgrade flips Rust 2024 edition this becomes an `unsafe`
    // block — wrap accordingly.
    if cleared {
        std::env::remove_var(&name);
    } else {
        std::env::set_var(&name, &trimmed);
    }
    Ok(serde_json::json!({
        "ok": true,
        "path": path.to_string_lossy().to_string(),
        "cleared": cleared,
    }))
}

/// Open a URL in the user's default browser.
#[tauri::command]
pub async fn open_url(_app: AppHandle, url: String) -> Result<(), String> {
    // SECURITY: only hand web/mail URLs to the OS opener. Without this, a
    // malicious link in rendered markdown (LLM output / collected posts) could
    // pass `file://` (open an arbitrary local file/app), `javascript:`, or a
    // custom-scheme handler straight to `open` / `xdg-open` / `cmd start`.
    let lower = url.trim().to_ascii_lowercase();
    let allowed = lower.starts_with("https://")
        || lower.starts_with("http://")
        || lower.starts_with("mailto:");
    if !allowed {
        return Err(format!(
            "refused to open non-web URL: {}",
            url.chars().take(80).collect::<String>()
        ));
    }
    let cmd_result = {
        #[cfg(target_os = "macos")]
        { std::process::Command::new("open").arg(&url).spawn() }
        #[cfg(target_os = "linux")]
        { std::process::Command::new("xdg-open").arg(&url).spawn() }
        #[cfg(target_os = "windows")]
        { std::process::Command::new("cmd").args(["/c", "start", &url]).spawn() }
    };
    cmd_result.map(|_| ()).map_err(|e| e.to_string())
}

/// Close the splash window and reveal the main window. Called from the
/// frontend once the first route has rendered, so the user never sees a
/// blank webview during cold start.
#[tauri::command]
pub async fn close_splash(app: AppHandle) -> Result<(), String> {
    if let Some(splash) = app.get_webview_window("splash") {
        let _ = splash.close();
    }
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.set_focus();
    }
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────
// Dynamic model list per cloud provider
//
// Replaces the hardcoded curated lists in the BYOK modal. Called server-side
// (from Rust) because several provider APIs (Anthropic, OpenAI, Groq, etc.)
// don't set CORS headers for arbitrary webview origins, so a direct browser
// fetch gets blocked. Running here through reqwest means one consistent
// code path regardless of provider, no CORS shenanigans, and the API key
// stays on the Rust side rather than leaking into the JS call.
// ─────────────────────────────────────────────────────────────────────────

fn read_byok_value(key: &str) -> Result<String, String> {
    if let Ok(v) = std::env::var(key) {
        let t = v.trim();
        if !t.is_empty() {
            return Ok(t.to_string());
        }
    }
    let path = byok_env_path()?;
    let contents = std::fs::read_to_string(&path).unwrap_or_default();
    parse_env(&contents)
        .get(key)
        .cloned()
        .ok_or_else(|| format!("{} not set", key))
}

/// List available models from a cloud provider's /models endpoint.
///
/// Providers that return an OpenAI-style `{data: [{id, ...}]}` payload
/// (OpenAI, OpenRouter, Groq, DeepSeek, Mistral) are handled uniformly.
/// Anthropic and Google Gemini have their own shapes — parsed individually.
///
/// Returns `Vec<{id, context_length?, description?, created?, pricing?}>`
/// where fields beyond `id` are best-effort (not every provider exposes them).
#[tauri::command]
pub async fn list_provider_models(provider: String) -> Result<Value, String> {
    let prov = provider.to_lowercase();

    // Build request (url + headers + api-key location) per provider.
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;

    let models_json: Value = match prov.as_str() {
        "anthropic" => {
            let key = read_byok_value("ANTHROPIC_API_KEY")?;
            let resp = client
                .get("https://api.anthropic.com/v1/models")
                .header("x-api-key", &key)
                .header("anthropic-version", "2023-06-01")
                .send()
                .await
                .map_err(|e| format!("anthropic request failed: {}", e))?;
            if !resp.status().is_success() {
                let code = resp.status();
                let body = resp.text().await.unwrap_or_default();
                return Err(format!("anthropic returned {}: {}", code, body));
            }
            resp.json().await.map_err(|e| e.to_string())?
        }
        "openai" => fetch_openai_compat(&client, "https://api.openai.com/v1/models", "OPENAI_API_KEY").await?,
        "openrouter" => fetch_openai_compat(&client, "https://openrouter.ai/api/v1/models", "OPENROUTER_API_KEY").await?,
        "nvidia" => fetch_openai_compat(&client, "https://integrate.api.nvidia.com/v1/models", "NVIDIA_API_KEY").await?,
        "groq" => fetch_openai_compat(&client, "https://api.groq.com/openai/v1/models", "GROQ_API_KEY").await?,
        "deepseek" => fetch_openai_compat(&client, "https://api.deepseek.com/v1/models", "DEEPSEEK_API_KEY").await?,
        "mistral" => fetch_openai_compat(&client, "https://api.mistral.ai/v1/models", "MISTRAL_API_KEY").await?,
        "google" => {
            let key = read_byok_value("GOOGLE_API_KEY")?;
            let url = format!(
                "https://generativelanguage.googleapis.com/v1beta/models?key={}",
                key
            );
            let resp = client
                .get(&url)
                .send()
                .await
                .map_err(|e| format!("google request failed: {}", e))?;
            if !resp.status().is_success() {
                let code = resp.status();
                let body = resp.text().await.unwrap_or_default();
                return Err(format!("google returned {}: {}", code, body));
            }
            resp.json().await.map_err(|e| e.to_string())?
        }
        "ollama" => {
            // Uses local /api/tags and does not require auth. Included so
            // the frontend can share one code path across providers.
            let base = std::env::var("OLLAMA_BASE_URL")
                .ok()
                .or_else(|| read_byok_value("OLLAMA_BASE_URL").ok())
                .unwrap_or_else(|| "http://localhost:11434".to_string());
            let url = format!("{}/api/tags", base.trim_end_matches('/'));
            let resp = client
                .get(&url)
                .send()
                .await
                .map_err(|e| format!("ollama request failed: {}", e))?;
            if !resp.status().is_success() {
                return Err(format!("ollama returned {}", resp.status()));
            }
            resp.json().await.map_err(|e| e.to_string())?
        }
        other => return Err(format!("unknown provider: {}", other)),
    };

    // Normalize each provider's shape into [{id, context_length?, description?, created?}].
    let normalized = normalize_models(&prov, &models_json);
    Ok(Value::Array(normalized))
}

/// Shared helper for OpenAI-compatible endpoints.
async fn fetch_openai_compat(
    client: &reqwest::Client,
    url: &str,
    env_key: &str,
) -> Result<Value, String> {
    let api_key = read_byok_value(env_key)?;
    let resp = client
        .get(url)
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
        .await
        .map_err(|e| format!("{} request failed: {}", env_key, e))?;
    if !resp.status().is_success() {
        let code = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("{} returned {}: {}", url, code, body));
    }
    resp.json().await.map_err(|e| e.to_string())
}

/// Flatten provider-specific response shapes into a uniform list of
/// `{id, context_length?, description?, created?}` JSON objects that
/// the frontend can render identically across providers.
fn normalize_models(provider: &str, raw: &Value) -> Vec<Value> {
    let mut out: Vec<Value> = Vec::new();

    match provider {
        "anthropic" => {
            // {"data": [{"id": "...", "display_name": "..."}, ...]}
            if let Some(arr) = raw.get("data").and_then(|v| v.as_array()) {
                for m in arr {
                    let id = m.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let desc = m.get("display_name").and_then(|v| v.as_str()).map(String::from);
                    out.push(serde_json::json!({ "id": id, "description": desc }));
                }
            }
        }
        "google" => {
            // {"models": [{"name": "models/gemini-...", "displayName": "...",
            //              "inputTokenLimit": 2000000, "supportedGenerationMethods": [...]}]}
            if let Some(arr) = raw.get("models").and_then(|v| v.as_array()) {
                for m in arr {
                    let name = m.get("name").and_then(|v| v.as_str()).unwrap_or("");
                    // Strip "models/" prefix so frontend displays just the model name.
                    let id = name.strip_prefix("models/").unwrap_or(name).to_string();
                    let desc = m
                        .get("displayName")
                        .and_then(|v| v.as_str())
                        .map(String::from);
                    let ctx = m.get("inputTokenLimit").cloned().unwrap_or(Value::Null);
                    // Only surface models that can generate content (filter out embedding-only).
                    let methods = m
                        .get("supportedGenerationMethods")
                        .and_then(|v| v.as_array())
                        .map(|a| {
                            a.iter()
                                .filter_map(|x| x.as_str())
                                .any(|s| s == "generateContent")
                        })
                        .unwrap_or(true);
                    if !methods {
                        continue;
                    }
                    out.push(serde_json::json!({
                        "id": id, "description": desc, "context_length": ctx,
                    }));
                }
            }
        }
        "ollama" => {
            // {"models": [{"name": "gemma3:4b", "details": {"family": "...", "parameter_size": "..."}}]}
            if let Some(arr) = raw.get("models").and_then(|v| v.as_array()) {
                for m in arr {
                    let id = m.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    // Skip embedding / OCR / BERT families — not chat-capable.
                    let family = m
                        .get("details")
                        .and_then(|d| d.get("family"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    if matches!(family, "bert" | "nomic-bert")
                        || id.to_lowercase().contains("embed")
                    {
                        continue;
                    }
                    let param_size = m
                        .get("details")
                        .and_then(|d| d.get("parameter_size"))
                        .and_then(|v| v.as_str())
                        .map(String::from);
                    out.push(serde_json::json!({ "id": id, "description": param_size }));
                }
            }
        }
        _ => {
            // OpenAI-compatible: {"data": [{"id": "...", "context_length"?: ..., ...}]}
            // (OpenRouter also sets "context_length" + "pricing". Groq/Mistral/DeepSeek
            // just return a minimal {id}.)
            if let Some(arr) = raw.get("data").and_then(|v| v.as_array()) {
                for m in arr {
                    let id = m.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    if id.is_empty() {
                        continue;
                    }
                    // Skip non-chat OpenAI models: embeddings, whisper, dall-e, tts.
                    // Cheap heuristic — id substring match. Users that really want
                    // them can type the ID in the default-provider tab.
                    let low = id.to_lowercase();
                    let blocklist = [
                        "embedding", "whisper", "dall-e", "tts-", "text-moderation",
                        "omni-moderation", "babbage", "davinci",
                    ];
                    if blocklist.iter().any(|s| low.contains(s)) {
                        continue;
                    }
                    let ctx = m.get("context_length").cloned().unwrap_or(Value::Null);
                    let desc = m
                        .get("description")
                        .and_then(|v| v.as_str())
                        .map(String::from)
                        .or_else(|| m.get("name").and_then(|v| v.as_str()).map(String::from));
                    out.push(serde_json::json!({
                        "id": id, "context_length": ctx, "description": desc,
                    }));
                }
            }
        }
    }

    out
}

// ─── MCP ↔ App integration (one-click connect to Claude Code) ─────────────────
//
// Spec: docs/superpowers/specs/2026-04-21-mcp-app-integration.md (v1).
// We shell out to `openreply mcp {install,uninstall,status} --json` so all
// the JSON-merge / token-gen / atomic-write logic stays in one place
// (src/openreply/mcp/install.py), testable from CLI.
//
// Two execution modes for the MCP entry's command:
//   - Dev:  if `.venv/bin/python` is found near CWD → register as
//           `uv --directory <repo> run openreply mcp serve` (current dev flow).
//   - Prod: bundled binary → register the absolute path to the sidecar exe
//           inside Contents/MacOS so Claude Code spawns it directly without
//           needing `uv` on the user's PATH.

/// LetsMove-style auto-relocation. If we're running under macOS App
/// Translocation (which Gatekeeper forces on quarantined .apps launched
/// from anywhere other than /Applications), ask the user once to move
/// us into /Applications, then do it — copy, clear the quarantine xattr
/// that's causing the translocation to keep happening, and relaunch
/// from the stable location. Return true if relocation kicked off
/// (caller MUST exit so the translocated process dies).
///
/// Why this matters: MCP install writes Claude's `command:` to the path
/// it sees right now. Under translocation that's a randomized
/// `/private/var/folders/.../AppTranslocation/<UUID>/d/OpenReply.app/...`
/// path that reaps when the app quits. Claude saves it, then can't find
/// it on the next launch — the user sees "openreply" in /mcp but "failed
/// to start" every time.
///
/// All the dialogs use `osascript display dialog` so we don't need to
/// pull in a Tauri plugin we'd otherwise not use, and the prompts work
/// before the webview has even loaded.
#[cfg(target_os = "macos")]
#[allow(dead_code)] // called from main.rs setup() only in release builds
pub fn maybe_relocate_to_applications() -> bool {
    let exe = match std::env::current_exe() {
        Ok(p) => p,
        Err(_) => return false,
    };
    let exe_str = exe.to_string_lossy();
    if !exe_str.contains("/AppTranslocation/") {
        return false;
    }
    // .app/Contents/MacOS/<exe> → .app
    let app_path = match exe
        .parent()
        .and_then(|p| p.parent())
        .and_then(|p| p.parent())
    {
        Some(p) => p.to_path_buf(),
        None => return false,
    };
    let app_name = match app_path.file_name() {
        Some(n) => n.to_string_lossy().to_string(),
        None => return false,
    };
    if !app_name.ends_with(".app") {
        return false;
    }
    let target = std::path::PathBuf::from("/Applications").join(&app_name);

    // Ask the user. `osascript` returns exit 0 on the default/right
    // button (Move) and exit 1 on Cancel.
    let prompt = format!(
        r#"display dialog "OpenReply needs to live in your Applications folder for MCP and auto-updates to work properly.\n\nMove it now? (recommended)" \
           with title "Move OpenReply to Applications" \
           buttons {{"Cancel", "Move to Applications"}} default button "Move to Applications" \
           with icon caution"#,
    );
    let ok = std::process::Command::new("osascript")
        .arg("-e")
        .arg(&prompt)
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    if !ok {
        return false;
    }

    // If something already lives at /Applications/OpenReply.app, ask
    // before clobbering — could be an older version the user wants to
    // keep, or a stuck-installed one we should replace.
    if target.exists() {
        let confirm = r#"display dialog "An older OpenReply.app already lives in /Applications. Replace it with this version?" \
                       with title "Replace existing OpenReply" \
                       buttons {"Cancel", "Replace"} default button "Replace" \
                       with icon caution"#;
        let ok2 = std::process::Command::new("osascript")
            .arg("-e")
            .arg(confirm)
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        if !ok2 {
            return false;
        }
        let _ = std::fs::remove_dir_all(&target);
    }

    // `ditto` preserves macOS metadata (codesignature xattrs, resource
    // forks) where `cp -R` strips them and breaks the signature. The
    // translocated source is a read-only copy but ditto handles that.
    let copy_ok = std::process::Command::new("ditto")
        .arg(&app_path)
        .arg(&target)
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    if !copy_ok {
        let err = r#"display alert "Couldn't copy OpenReply to /Applications" message "Drag OpenReply.app to /Applications manually, then reopen it from there." as critical"#;
        let _ = std::process::Command::new("osascript")
            .arg("-e")
            .arg(err)
            .status();
        return false;
    }

    // Clear quarantine on the destination. WITHOUT this the next
    // launch from /Applications would just translocate again — quarantine
    // attribute is what triggers Gatekeeper's translocation feature.
    let _ = std::process::Command::new("xattr")
        .args(["-dr", "com.apple.quarantine"])
        .arg(&target)
        .status();

    // Relaunch the newly-moved copy. `open` treats this as a fresh
    // launch and the new process inherits no state from us.
    let _ = std::process::Command::new("open").arg(&target).status();
    true
}

#[cfg(not(target_os = "macos"))]
pub fn maybe_relocate_to_applications() -> bool {
    false
}

fn resolve_sidecar_bin_path() -> Option<std::path::PathBuf> {
    // In a packaged Tauri app, the sidecar lives next to the main exe in
    // Contents/MacOS/. `current_exe()` gives us the main app binary; its
    // sibling `openreply` (or `openreply.exe` on Windows) is the sidecar.
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    for name in ["openreply-cli", "openreply-cli.exe"] {
        let candidate = dir.join(name);
        if candidate.exists() {
            return Some(candidate);
        }
    }
    None
}

/// True when the path looks ephemeral — i.e. on a mounted disk image,
/// removable media, a temp dir that will disappear once the user
/// ejects/unmounts, OR a macOS App Translocation path. MCP clients need
/// a stable path; writing any of these into ~/.claude.json bricks MCP
/// the moment the temp location is reaped.
///
/// **App Translocation** (the one that bit us in v0.1.x): macOS
/// Gatekeeper copies a freshly-downloaded .app to a randomized
/// `/private/var/folders/.../AppTranslocation/<UUID>/d/Foo.app` when
/// it's run from anywhere other than /Applications. That path is
/// re-generated on each launch and reaped on quit — Claude saves it,
/// then can't find it. Detect by the literal "/AppTranslocation/"
/// segment which is unique to this feature.
fn is_ephemeral_path(p: &std::path::Path) -> bool {
    let s = p.to_string_lossy();
    s.starts_with("/Volumes/")
        || s.starts_with("/private/tmp/")
        || s.starts_with("/tmp/")
        || s.contains("/AppTranslocation/")
}

fn dev_project_dir() -> Option<std::path::PathBuf> {
    // Walk up looking for a `pyproject.toml` to mark the repo root. Same
    // 5-step budget as find_dev_venv_python so behaviour is consistent.
    let mut cur = std::env::current_dir().ok()?.canonicalize().ok()?;
    let mut visited: std::collections::HashSet<std::path::PathBuf> =
        std::collections::HashSet::new();
    for _ in 0..5 {
        if !visited.insert(cur.clone()) { break; }
        if cur.join("pyproject.toml").exists() && cur.join(".venv").exists() {
            return Some(cur);
        }
        cur = cur.parent()?.canonicalize().ok()?;
    }
    None
}

/// List known MCP clients (Claude Code, Cursor, Cline, …) and which configs exist.
#[tauri::command]
pub async fn mcp_clients(app: AppHandle) -> Result<Value, String> {
    run_cli(&app, vec!["mcp", "clients", "--json"]).await.map_err(err_to_string)
}

/// Check whether OpenReply is connected to the chosen MCP client and DB-aligned.
/// `client` defaults to `claude-code` when None/empty.
#[tauri::command]
pub async fn mcp_status(app: AppHandle, client: Option<String>) -> Result<Value, String> {
    let dd = data_dir(&app).map_err(err_to_string)?;
    let dd_str = dd.to_string_lossy().to_string();
    let mut args: Vec<String> = vec![
        "mcp".into(), "status".into(),
        "--data-dir".into(), dd_str,
        "--json".into(),
    ];
    if let Some(c) = client.as_deref().filter(|s| !s.is_empty()) {
        args.push("--client".into()); args.push(c.into());
    }
    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let mut result = run_cli(&app, arg_refs).await.map_err(err_to_string)?;
    // Decorate the status payload with a stable-path warning so the Settings
    // UI can render a "move to /Applications first" prompt without itself
    // having to compute the running .app's location.
    if let Some(bin) = resolve_sidecar_bin_path() {
        if is_ephemeral_path(&bin) {
            if let Some(obj) = result.as_object_mut() {
                obj.insert("ephemeral_app_path".into(), Value::Bool(true));
                obj.insert(
                    "ephemeral_app_path_hint".into(),
                    Value::String(format!(
                        "OpenReply.app is running from {}. Move it to /Applications and re-open from there before clicking Connect.",
                        bin.display()
                    )),
                );
            }
        }
    }
    Ok(result)
}

/// Connect (or re-sync) OpenReply's MCP entry in the chosen client's config.
/// Aligns OPENREPLY_DATA_DIR and writes a token to the data dir.
#[tauri::command]
pub async fn mcp_install(app: AppHandle, client: Option<String>) -> Result<Value, String> {
    let dd = data_dir(&app).map_err(err_to_string)?;
    let dd_str = dd.to_string_lossy().to_string();

    let mut args: Vec<String> = vec![
        "mcp".into(), "install".into(),
        "--data-dir".into(), dd_str,
        "--json".into(),
    ];
    if let Some(c) = client.as_deref().filter(|s| !s.is_empty()) {
        args.push("--client".into()); args.push(c.into());
    }
    // Prefer project-dir in dev so MCP clients run the Python CLI directly.
    // This avoids stale/broken debug sidecar binaries being written into
    // client configs (observed with Cursor MCP connect timeouts).
    if let Some(proj) = dev_project_dir() {
        args.push("--project-dir".into());
        args.push(proj.to_string_lossy().to_string());
    } else if let Some(bin) = resolve_sidecar_bin_path() {
        // Refuse to write an ephemeral path into the MCP client config.
        // Once the temp/translocation/DMG path is reaped, every MCP
        // spawn fails and the user has no recourse short of re-running
        // install. Surface a path-specific actionable message.
        if is_ephemeral_path(&bin) {
            let bin_str = bin.to_string_lossy().to_string();
            let msg = if bin_str.contains("/AppTranslocation/") {
                format!(
                    "OpenReply.app is running under macOS App Translocation ({}). \
                     This happens when the .app is launched from anywhere other than \
                     /Applications (e.g. from the DMG mount, Downloads, or Desktop). \
                     The translocated path changes on every launch — Claude can't \
                     find the MCP binary after a restart. \
                     \n\nFix: Quit OpenReply. Move (don't copy) OpenReply.app to /Applications. \
                     Run in Terminal: xattr -dr com.apple.quarantine '/Applications/OpenReply.app'. \
                     Reopen from /Applications. MCP will auto-connect on the next launch.",
                    bin_str
                )
            } else if bin_str.starts_with("/Volumes/") {
                format!(
                    "OpenReply.app is running from a mounted disk image ({}). \
                     MCP needs a stable path. Quit OpenReply, drag OpenReply.app to \
                     /Applications (eject the DMG), then open it from /Applications \
                     and click Connect again.",
                    bin_str
                )
            } else {
                format!(
                    "OpenReply.app is running from a temporary location ({}). \
                     Move OpenReply.app to /Applications and reopen it from there.",
                    bin_str
                )
            };
            return Err(msg);
        }
        args.push("--bin".into());
        args.push(bin.to_string_lossy().to_string());
    }
    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    run_cli(&app, arg_refs).await.map_err(err_to_string)
}

/// Dry-run sibling of `mcp_install`: build the EXACT mcpServers entry Connect
/// would write and return it (as `{ok, snippet, config_path, ...}`) WITHOUT
/// touching any config file or creating a token-write. Powers the Settings
/// "Copy config" button so users can paste the entry into any MCP client by
/// hand. Mirrors `mcp_install`'s command/path resolution byte-for-byte (dev →
/// `--project-dir`, prod → `--bin`, same ephemeral-path guard) so the shown
/// snippet matches what Connect would actually write.
#[tauri::command]
pub async fn mcp_config_snippet(app: AppHandle, client: Option<String>) -> Result<Value, String> {
    let dd = data_dir(&app).map_err(err_to_string)?;
    let dd_str = dd.to_string_lossy().to_string();

    let mut args: Vec<String> = vec![
        "mcp".into(), "config".into(),
        "--data-dir".into(), dd_str,
        "--json".into(),
    ];
    if let Some(c) = client.as_deref().filter(|s| !s.is_empty()) {
        args.push("--client".into()); args.push(c.into());
    }
    if let Some(proj) = dev_project_dir() {
        args.push("--project-dir".into());
        args.push(proj.to_string_lossy().to_string());
    } else if let Some(bin) = resolve_sidecar_bin_path() {
        // Don't hand the user a snippet with an ephemeral path that will
        // break after the .app is reaped/relaunched — same guard as install.
        if is_ephemeral_path(&bin) {
            let bin_str = bin.to_string_lossy().to_string();
            let msg = if bin_str.contains("/AppTranslocation/") {
                format!(
                    "OpenReply.app is running under macOS App Translocation ({}). \
                     Move OpenReply.app to /Applications and reopen it from there \
                     before copying the MCP config — the current path changes on \
                     every launch and won't work after a restart.",
                    bin_str
                )
            } else if bin_str.starts_with("/Volumes/") {
                format!(
                    "OpenReply.app is running from a mounted disk image ({}). \
                     Drag it to /Applications (eject the DMG) and reopen from there \
                     before copying the MCP config.",
                    bin_str
                )
            } else {
                format!(
                    "OpenReply.app is running from a temporary location ({}). \
                     Move it to /Applications and reopen before copying the config.",
                    bin_str
                )
            };
            return Err(msg);
        }
        args.push("--bin".into());
        args.push(bin.to_string_lossy().to_string());
    }
    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    run_cli(&app, arg_refs).await.map_err(err_to_string)
}

/// Remove OpenReply's MCP entry from the chosen client's config + delete the token.
#[tauri::command]
pub async fn mcp_uninstall(app: AppHandle, client: Option<String>) -> Result<Value, String> {
    let dd = data_dir(&app).map_err(err_to_string)?;
    let dd_str = dd.to_string_lossy().to_string();
    let mut args: Vec<String> = vec![
        "mcp".into(), "uninstall".into(),
        "--data-dir".into(), dd_str,
        "--json".into(),
    ];
    if let Some(c) = client.as_deref().filter(|s| !s.is_empty()) {
        args.push("--client".into()); args.push(c.into());
    }
    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    run_cli(&app, arg_refs).await.map_err(err_to_string)
}

// ── CLI symlink to /usr/local/bin/openreply ───────────────────────────────
//
// In a DMG install the Python sidecar binary lives at
// `<OpenReply.app>/Contents/MacOS/openreply-cli-aarch64-apple-darwin` — invisible
// to the user's terminal. These commands manage a symlink at
// `/usr/local/bin/openreply` pointing at that bundled binary so the recipient
// can `openreply research collect ...` from anywhere. The link uses
// `osascript with administrator privileges` since /usr/local/bin requires
// sudo on a fresh Mac without homebrew.
//
// Symlink (not copy) so a future app update is picked up automatically.

const CLI_SYMLINK_PATH: &str = "/usr/local/bin/openreply";

#[tauri::command]
pub async fn cli_symlink_status() -> Result<Value, String> {
    let target = std::path::Path::new(CLI_SYMLINK_PATH);
    let installed = target.exists() || target.is_symlink();
    let points_to: Option<String> = if target.is_symlink() {
        std::fs::read_link(target).ok().map(|p| p.to_string_lossy().to_string())
    } else if target.exists() {
        // It's a regular file (copy, not symlink) — record path so UI can warn
        Some(format!("(regular file at {})", CLI_SYMLINK_PATH))
    } else {
        None
    };
    let expected = resolve_sidecar_bin_path().map(|p| p.to_string_lossy().to_string());
    let healthy = match (&points_to, &expected) {
        (Some(p), Some(e)) => p == e,
        _ => false,
    };
    Ok(serde_json::json!({
        "installed": installed,
        "healthy": healthy,
        "path": CLI_SYMLINK_PATH,
        "points_to": points_to,
        "expected": expected,
    }))
}

#[tauri::command]
pub async fn install_cli_symlink() -> Result<Value, String> {
    let sidecar = resolve_sidecar_bin_path()
        .ok_or_else(|| "Could not locate the bundled openreply-cli binary. Reinstall OpenReply and try again.".to_string())?;
    let sidecar_str = sidecar.to_string_lossy().to_string();
    // Escape single-quotes for embedding inside the AppleScript double-quoted
    // shell command. AppleScript handles its own outer quoting; we just need
    // the inner shell-safe path.
    let safe = sidecar_str.replace('\'', r"'\''");
    let script = format!(
        r#"do shell script "mkdir -p /usr/local/bin && ln -sf '{src}' '{dst}'" with administrator privileges"#,
        src = safe,
        dst = CLI_SYMLINK_PATH,
    );
    let output = tokio::process::Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .output()
        .await
        .map_err(|e| format!("Could not run osascript: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if stderr.contains("User canceled") || stderr.contains("(-128)") {
            return Err("Install cancelled.".to_string());
        }
        return Err(format!("Install failed: {stderr}"));
    }
    Ok(serde_json::json!({
        "ok": true,
        "path": CLI_SYMLINK_PATH,
        "points_to": sidecar_str,
        "message": format!("Installed. Try `{} --help` in your terminal.", CLI_SYMLINK_PATH),
    }))
}

#[tauri::command]
pub async fn uninstall_cli_symlink() -> Result<Value, String> {
    let target = std::path::Path::new(CLI_SYMLINK_PATH);
    if !target.exists() && !target.is_symlink() {
        return Ok(serde_json::json!({"ok": true, "removed": false, "message": "Not installed."}));
    }
    let script = format!(
        r#"do shell script "rm -f '{dst}'" with administrator privileges"#,
        dst = CLI_SYMLINK_PATH,
    );
    let output = tokio::process::Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .output()
        .await
        .map_err(|e| format!("Could not run osascript: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if stderr.contains("User canceled") || stderr.contains("(-128)") {
            return Err("Uninstall cancelled.".to_string());
        }
        return Err(format!("Uninstall failed: {stderr}"));
    }
    Ok(serde_json::json!({"ok": true, "removed": true}))
}


// ── AG-C: global-competitors (T2.5) + finding feedback (T2.4) ─────────

/// T2.5 — Cross-topic competitor dedup. Reads product-kind graph nodes
/// across all topics and clusters them by label embedding similarity.
/// T2.4 — Persist user feedback on a finding (wrong/off_topic/spam/ok).
/// Next synthesize call for the topic splices these titles into the
/// prompt as a negative-examples block.
// ── AG-E: prompt overrides (T3.7) ──────────────────────────────────────
/// Set a prompt override. `text` is the full override body; empty clears it.
// ── AG-E: saved views (T3.1) ──────────────────────────────────────────
// ── AG-D: CSV ingest ──
/// Bulk-ingest a structured CSV into a topic corpus.
///
/// Expected headers: `post_id,title,body,author,url,created_utc,source_type`.
/// Missing columns are tolerated except `title`. Delegates to the Python
/// `research ingest-csv` subcommand, which runs the relevance gate via
/// `_tag_posts`. Returns the JSON envelope the Python side emits:
/// `{ok, parsed, skipped, tagged, dry_run, path, topic}`.
// ─── Task 8 — saturation v1 + coverage gaps panel ──────────────────────────

/// Saturation metric v1 — distinct graph clusters per last 50 posts.
/// Pure SQL; no LLM. Returns `{score, hint, new_clusters_last_50_posts,
/// window_start}` where hint ∈ rich | converging | saturated.
/// Coverage gap analyzer — which data dimensions are underrepresented.
/// Returns `{total_posts, by_source, gaps: [...]}` where each gap has
/// `suggested_sources` the UI turns into one-click "+ Add X" buttons.
// ── Video ingest (yt-dlp + faster-whisper) ──────────────────────────────────
//
// Design: docs/video-ingest.md. Flow:
//   ingest_video_preview → yt_dlp.extract_info(download=False) — fast metadata
//   ingest_video         → streaming: download audio, transcribe, insert rows
//   whisper_*            → model catalogue / download / delete / default
//   ytdlp_version|update → overlay auto-updater controls
//
// All wrap the Python CLI (src/openreply/cli/main.py → ingest video /
// whisper / ytdlp subcommands). Streaming commands emit events the webview
// listens to via @tauri-apps/api/event::listen().

/// Search YouTube via yt-dlp (no API key needed). Returns metadata for up to
/// `limit` videos: id, title, channel, url, thumbnail, duration_s,
/// view_count, published, description. Pair with `ingest_video` to
/// actually transcribe + ingest a chosen result.
// ─── Task 9.5 — Extraction prefs pane + token usage ─────────────────────────
//
// Three surface commands:
//   * extraction_prefs_get(topic?) — effective config for the Settings pane
//     and the per-topic override row. Reads extraction.json + topic_prefs.
//   * extraction_prefs_set(scope, prefs) — writes either the global JSON
//     (scope="global") or upserts the topic_prefs row (scope="topic:<name>").
//   * today_token_spend() — aggregate cost for the running day, broken down
//     by (provider, model) for the Settings card.
//
// All three are designed to tolerate a fresh install (missing file, missing
// table, missing columns on old topic_prefs rows). Write paths use native
// rusqlite so the UI can refresh without paying the Python sidecar boot cost.

/// Global extraction-prefs defaults. Mirrors
/// ``enrich_worker._EXTRACTION_DEFAULTS`` on the Python side so a fresh
/// install (no ``extraction.json``) behaves identically no matter which
/// reader touches it first.
fn extraction_defaults() -> serde_json::Value {
    serde_json::json!({
        "mode": "auto",
        "threshold": 100,
        "batch_size": 5,
        "window_start": null,
        "window_end": null,
        "daily_token_cap": null,
        "release_llm_idle": false,
        "paused_until": null,
    })
}

/// Merge b into a (shallow). Values in b override a; nulls in b clear keys.
fn merge_json_shallow(a: &mut serde_json::Map<String, Value>, b: &serde_json::Map<String, Value>) {
    for (k, v) in b {
        a.insert(k.clone(), v.clone());
    }
}

/// Compute the effective prefs for a topic by merging defaults → global → topic.
fn compute_effective(
    global: &serde_json::Map<String, Value>,
    topic_row: Option<&serde_json::Map<String, Value>>,
) -> Value {
    let mut eff = extraction_defaults().as_object().cloned().unwrap_or_default();
    merge_json_shallow(&mut eff, global);
    if let Some(t) = topic_row {
        // Only merge non-null keys — NULL columns mean "use global".
        for (k, v) in t {
            if !v.is_null() {
                eff.insert(k.clone(), v.clone());
            }
        }
    }
    Value::Object(eff)
}

/// Read the global extraction.json file. Returns an empty object if missing.
fn read_global_prefs(app: &AppHandle) -> Result<serde_json::Map<String, Value>, String> {
    let dir = data_dir(app).map_err(err_to_string)?;
    let path = dir.join("extraction.json");
    if !path.exists() {
        return Ok(serde_json::Map::new());
    }
    let raw = std::fs::read_to_string(&path).map_err(|e| format!("read extraction.json: {e}"))?;
    if raw.trim().is_empty() {
        return Ok(serde_json::Map::new());
    }
    let v: Value = serde_json::from_str(&raw).map_err(|e| format!("parse extraction.json: {e}"))?;
    Ok(v.as_object().cloned().unwrap_or_default())
}

/// Atomic write of extraction.json via tmp-file + rename. POSIX-safe; on
/// Windows the rename call isn't atomic across crashes but good enough.
fn write_global_prefs(app: &AppHandle, prefs: &serde_json::Map<String, Value>) -> Result<(), String> {
    let dir = data_dir(app).map_err(err_to_string)?;
    let path = dir.join("extraction.json");
    let tmp = dir.join("extraction.json.tmp");
    let body = serde_json::to_string_pretty(prefs).map_err(|e| format!("serialize: {e}"))?;
    std::fs::write(&tmp, body).map_err(|e| format!("write tmp: {e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("rename: {e}"))
}

/// Topic-pref columns we expose via extraction_prefs. Mirrors the ALTER
/// TABLE list in ``db.py::_ensure_extraction_prefs_schema``.
const TOPIC_PREF_COLS: &[(&str, &str)] = &[
    ("extraction_mode",         "mode"),
    ("extraction_threshold",    "threshold"),
    ("extraction_batch_size",   "batch_size"),
    ("extraction_window_start", "window_start"),
    ("extraction_window_end",   "window_end"),
    ("daily_token_cap",         "daily_token_cap"),
    ("release_llm_idle",        "release_llm_idle"),
];

/// Read the topic's row from topic_prefs. Returns None if the row doesn't
/// exist, or Some(map) with only the columns that are currently non-null.
fn read_topic_prefs_row(
    db_path: &std::path::Path,
    topic: &str,
) -> Result<Option<serde_json::Map<String, Value>>, String> {
    use rusqlite::OpenFlags;
    let conn = rusqlite::Connection::open_with_flags(
        db_path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    ).map_err(|e| format!("open db: {e}"))?;
    // Detect which columns actually exist — an older schema may not have
    // all the extraction_* columns yet.
    let mut stmt = conn.prepare("PRAGMA table_info(topic_prefs)")
        .map_err(|e| format!("pragma: {e}"))?;
    let cols_iter = stmt.query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| format!("query cols: {e}"))?;
    let mut have_cols: std::collections::HashSet<String> = std::collections::HashSet::new();
    for c in cols_iter {
        if let Ok(name) = c {
            have_cols.insert(name);
        }
    }
    drop(stmt);
    let available: Vec<(&str, &str)> = TOPIC_PREF_COLS.iter()
        .filter(|(src, _)| have_cols.contains(*src))
        .copied()
        .collect();
    if available.is_empty() {
        return Ok(None);
    }
    let col_list = available.iter().map(|(s, _)| *s).collect::<Vec<_>>().join(", ");
    let sql = format!("SELECT {} FROM topic_prefs WHERE topic = ?1", col_list);
    let mut stmt = conn.prepare(&sql).map_err(|e| format!("prepare select: {e}"))?;
    let mut rows = stmt.query([topic]).map_err(|e| format!("query: {e}"))?;
    let row = match rows.next().map_err(|e| format!("row: {e}"))? {
        Some(r) => r,
        None => return Ok(None),
    };
    let mut out = serde_json::Map::new();
    for (i, (_, out_key)) in available.iter().enumerate() {
        let vref = row.get_ref(i).map_err(|e| format!("col: {e}"))?;
        let v: Value = match vref {
            rusqlite::types::ValueRef::Null => Value::Null,
            rusqlite::types::ValueRef::Integer(n) => {
                // release_llm_idle is stored as 0/1 — coerce to bool for the UI.
                if *out_key == "release_llm_idle" {
                    Value::Bool(n != 0)
                } else {
                    Value::from(n)
                }
            }
            rusqlite::types::ValueRef::Real(f) => {
                serde_json::Number::from_f64(f).map(Value::Number).unwrap_or(Value::Null)
            }
            rusqlite::types::ValueRef::Text(t) => {
                String::from_utf8_lossy(t).into_owned().into()
            }
            rusqlite::types::ValueRef::Blob(_) => Value::Null,
        };
        out.insert((*out_key).to_string(), v);
    }
    Ok(Some(out))
}

/// Write topic_prefs overrides. Each key in `prefs` corresponds to one of
/// TOPIC_PREF_COLS's out_key slots. NULL values clear the override.
fn write_topic_prefs_row(
    db_path: &std::path::Path,
    topic: &str,
    prefs: &serde_json::Map<String, Value>,
) -> Result<(), String> {
    use rusqlite::OpenFlags;
    let conn = rusqlite::Connection::open_with_flags(
        db_path,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    ).map_err(|e| format!("open db rw: {e}"))?;
    conn.busy_timeout(std::time::Duration::from_millis(2000))
        .map_err(|e| format!("busy_timeout: {e}"))?;
    // Ensure the row exists — new topics may not have a prefs entry yet.
    conn.execute(
        "INSERT OR IGNORE INTO topic_prefs (topic, scheduled, deleted_at) VALUES (?1, 0, '')",
        [topic],
    ).map_err(|e| format!("insert row: {e}"))?;
    // Introspect columns so we only UPDATE what exists.
    let mut stmt = conn.prepare("PRAGMA table_info(topic_prefs)")
        .map_err(|e| format!("pragma: {e}"))?;
    let rows_iter = stmt.query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| format!("pragma query: {e}"))?;
    let mut have_cols: std::collections::HashSet<String> = std::collections::HashSet::new();
    for c in rows_iter {
        if let Ok(name) = c { have_cols.insert(name); }
    }
    drop(stmt);
    for (src_col, out_key) in TOPIC_PREF_COLS {
        if !have_cols.contains(*src_col) { continue; }
        let Some(v) = prefs.get(*out_key) else { continue; };
        let set_sql = format!("UPDATE topic_prefs SET {} = ?1 WHERE topic = ?2", src_col);
        let topic_s = topic.to_string();
        let result = match v {
            Value::Null => {
                let none: Option<String> = None;
                conn.execute(&set_sql, rusqlite::params![none, &topic_s])
            }
            Value::Bool(b) => {
                let as_int = if *b { 1_i64 } else { 0_i64 };
                conn.execute(&set_sql, rusqlite::params![as_int, &topic_s])
            }
            Value::Number(n) => {
                if let Some(i) = n.as_i64() {
                    conn.execute(&set_sql, rusqlite::params![i, &topic_s])
                } else if let Some(f) = n.as_f64() {
                    conn.execute(&set_sql, rusqlite::params![f, &topic_s])
                } else {
                    let s = n.to_string();
                    conn.execute(&set_sql, rusqlite::params![s, &topic_s])
                }
            }
            Value::String(s) => {
                conn.execute(&set_sql, rusqlite::params![s, &topic_s])
            }
            _ => continue,
        };
        result.map_err(|e| format!("update {src_col}: {e}"))?;
    }
    Ok(())
}

/// Read effective extraction prefs. With `topic=None` returns only the
/// global layer merged onto defaults. With a topic, also reads the
/// per-topic row and merges on top.
///
/// Response shape: `{global: {...}, topic: {...|null}, effective: {...}}`.
#[tauri::command]
pub async fn extraction_prefs_get(
    app: AppHandle,
    topic: Option<String>,
) -> Result<Value, String> {
    let global_map = read_global_prefs(&app)?;
    // Merge global onto defaults to produce the "display global" shape.
    let mut display_global = extraction_defaults().as_object().cloned().unwrap_or_default();
    merge_json_shallow(&mut display_global, &global_map);

    let mut topic_val = Value::Null;
    let mut effective = compute_effective(&global_map, None);
    if let Some(t) = topic.as_ref().map(|s| s.trim().to_string()).filter(|s| !s.is_empty()) {
        let dir = data_dir(&app).map_err(err_to_string)?;
        let db_path = dir.join("openreply.db");
        if db_path.exists() {
            match read_topic_prefs_row(&db_path, &t) {
                Ok(Some(row)) => {
                    effective = compute_effective(&global_map, Some(&row));
                    topic_val = Value::Object(row);
                }
                Ok(None) => {}
                Err(e) => {
                    return Ok(serde_json::json!({
                        "global": Value::Object(display_global),
                        "topic": Value::Null,
                        "effective": effective,
                        "warning": e,
                    }));
                }
            }
        }
    }
    Ok(serde_json::json!({
        "global": Value::Object(display_global),
        "topic": topic_val,
        "effective": effective,
    }))
}

/// Write extraction prefs. `scope` is either `"global"` or `"topic:<name>"`.
/// `prefs` is a shallow object whose keys mirror the effective prefs shape.
#[tauri::command]
pub async fn extraction_prefs_set(
    app: AppHandle,
    scope: String,
    prefs: Value,
) -> Result<Value, String> {
    let prefs_map = prefs.as_object()
        .cloned()
        .ok_or_else(|| "prefs must be a JSON object".to_string())?;
    if scope == "global" {
        // Read-modify-write so callers can send partial updates.
        let mut existing = read_global_prefs(&app)?;
        merge_json_shallow(&mut existing, &prefs_map);
        write_global_prefs(&app, &existing)?;
        return Ok(serde_json::json!({ "ok": true, "scope": "global" }));
    }
    if let Some(topic) = scope.strip_prefix("topic:") {
        let t = topic.trim();
        if t.is_empty() {
            return Err("scope 'topic:' must include a topic name".into());
        }
        let dir = data_dir(&app).map_err(err_to_string)?;
        let db_path = dir.join("openreply.db");
        if !db_path.exists() {
            return Err("db not initialized yet — run a collect first".into());
        }
        write_topic_prefs_row(&db_path, t, &prefs_map)?;
        return Ok(serde_json::json!({ "ok": true, "scope": scope }));
    }
    Err(format!("unknown scope: {scope} (expected 'global' or 'topic:<name>')"))
}

/// Today's aggregate token spend across providers. Returns:
/// `{tokens_in, tokens_out, est_usd, breakdown: [{provider, model, ...}]}`.
#[tauri::command]
pub async fn today_token_spend(app: AppHandle) -> Result<Value, String> {
    let dir = data_dir(&app).map_err(err_to_string)?;
    let db_path = dir.join("openreply.db");
    if !db_path.exists() {
        return Ok(serde_json::json!({
            "tokens_in": 0, "tokens_out": 0, "est_usd": 0.0, "breakdown": []
        }));
    }
    let today = local_today_iso();
    let mut params = serde_json::Map::new();
    params.insert("day".to_string(), Value::String(today.clone()));
    let breakdown = match crate::db::query_db(
        &db_path,
        "SELECT provider, model, tokens_in, tokens_out, est_usd \
           FROM extraction_daily_usage WHERE day = :day \
          ORDER BY est_usd DESC",
        Some(&params),
    ) {
        Ok(rows) => rows,
        Err(_) => vec![],
    };
    let mut tokens_in: i64 = 0;
    let mut tokens_out: i64 = 0;
    let mut est_usd: f64 = 0.0;
    for row in &breakdown {
        if let Some(v) = row.get("tokens_in").and_then(|v| v.as_i64()) { tokens_in += v; }
        if let Some(v) = row.get("tokens_out").and_then(|v| v.as_i64()) { tokens_out += v; }
        if let Some(v) = row.get("est_usd").and_then(|v| v.as_f64()) { est_usd += v; }
    }
    Ok(serde_json::json!({
        "day": today,
        "tokens_in": tokens_in,
        "tokens_out": tokens_out,
        "est_usd": est_usd,
        "breakdown": breakdown,
    }))
}

/// Local-calendar YYYY-MM-DD. Shells out to `date` on Unix so we always
/// match the Python worker's `datetime.now().strftime("%Y-%m-%d")` (also
/// local). Falls back to a UTC computation if `date` is unavailable (which
/// only happens in sandboxed test runs).
fn local_today_iso() -> String {
    #[cfg(unix)]
    {
        if let Ok(out) = std::process::Command::new("date").arg("+%Y-%m-%d").output() {
            if out.status.success() {
                let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if !s.is_empty() { return s; }
            }
        }
    }
    // UTC fallback — acceptable drift at day boundaries for a cost UI.
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let days = (secs / 86_400) as i64;
    let (y, m, d) = days_to_ymd(days);
    format!("{:04}-{:02}-{:02}", y, m, d)
}


/// Days-since-Unix-epoch → (year, month, day). Gregorian, Howard Hinnant's
/// civil-from-days algorithm.
fn days_to_ymd(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}


fn device_id_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = data_dir(app).map_err(err_to_string)?;
    std::fs::create_dir_all(&dir).map_err(err_to_string)?;
    Ok(dir.join("device_id"))
}

fn ensure_device_id(app: &AppHandle) -> Result<String, String> {
    let path = device_id_path(app)?;
    if let Ok(raw) = std::fs::read_to_string(&path) {
        let id = raw.trim().to_string();
        if !id.is_empty() {
            return Ok(id);
        }
    }
    let id = Uuid::new_v4().to_string();
    std::fs::write(&path, &id).map_err(err_to_string)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(id)
}

#[cfg(target_os = "macos")]
fn get_macos_ioreg_uuid() -> Option<String> {
    let out = std::process::Command::new("ioreg")
        .args(["-d2", "-c", "IOPlatformExpertDevice"])
        .output()
        .ok()?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    stdout.lines().find_map(|line| {
        if !line.contains("IOPlatformUUID") {
            return None;
        }
        line.split('=')
            .nth(1)
            .map(|v| v.trim().trim_matches('"').to_string())
    })
}

#[cfg(target_os = "linux")]
fn get_linux_machine_id() -> Option<String> {
    std::fs::read_to_string("/etc/machine-id")
        .or_else(|_| std::fs::read_to_string("/var/lib/dbus/machine-id"))
        .ok()
        .map(|s| s.trim().to_string())
}

#[cfg(target_os = "windows")]
fn get_windows_machine_guid() -> Option<String> {
    let out = std::process::Command::new("reg")
        .args([
            "query",
            r"HKLM\SOFTWARE\Microsoft\Cryptography",
            "/v",
            "MachineGuid",
        ])
        .output()
        .ok()?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    stdout.lines().find_map(|line| {
        if !line.to_ascii_lowercase().contains("machineguid") {
            return None;
        }
        line.split_whitespace().last().map(|s| s.trim().to_string())
    })
}

fn build_device_signature(app: &AppHandle) -> Result<String, String> {
    let os = std::env::consts::OS;
    let arch = std::env::consts::ARCH;
    let hw_id = {
        #[cfg(target_os = "macos")]
        {
            get_macos_ioreg_uuid()
        }
        #[cfg(target_os = "linux")]
        {
            get_linux_machine_id()
        }
        #[cfg(target_os = "windows")]
        {
            get_windows_machine_guid()
        }
        #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
        {
            None
        }
    };
    let stable = hw_id.unwrap_or_else(|| ensure_device_id(app).unwrap_or_else(|_| "unknown-device".to_string()));
    let seed = format!("openreply|{}|{}|{}", os, arch, stable);
    let mut hasher = Sha256::new();
    hasher.update(seed.as_bytes());
    Ok(format!("{:x}", hasher.finalize()))
}


#[tauri::command]
pub async fn device_signature(app: AppHandle) -> Result<Value, String> {
    let sig = build_device_signature(&app)?;
    Ok(serde_json::json!({
        "device_signature": sig,
        "os": std::env::consts::OS,
        "arch": std::env::consts::ARCH
    }))
}


/// Dotted version compare. `version_lt("0.1.19", "0.1.20") == true`. Missing /
/// non-numeric segments are treated as 0, so partial or `v`-prefixed strings
/// compare sanely without a semver dep.
fn version_lt(a: &str, b: &str) -> bool {
    let norm = |s: &str| -> Vec<u64> {
        s.trim().trim_start_matches('v').trim_start_matches('V')
            // drop any pre-release/build suffix (e.g. "0.1.20-beta")
            .split(|c| c == '-' || c == '+').next().unwrap_or("")
            .split('.')
            .map(|p| p.trim().parse::<u64>().unwrap_or(0))
            .collect()
    };
    let (va, vb) = (norm(a), norm(b));
    let n = va.len().max(vb.len());
    for i in 0..n {
        let x = va.get(i).copied().unwrap_or(0);
        let y = vb.get(i).copied().unwrap_or(0);
        if x != y {
            return x < y;
        }
    }
    false
}

/// Force-update gate. Polls `{api_base}/v1/health` for `min_app_version` /
/// `latest_app_version` / `app_download_url` and compares them to the built
/// `CARGO_PKG_VERSION`.
///   - `update_required` → installed version < server `min_app_version`.
///     The frontend HARD-BLOCKS the app and shows a Download screen.
///   - `update_available` → installed version < `latest_app_version` (soft).
/// On ANY network/parse failure we return `ok:false` and NEVER set
/// update_required — an unreachable server (offline / outage) must never lock
/// a user out of a perfectly good build.
#[tauri::command]
pub async fn check_app_version(api_base: String) -> Result<Value, String> {
    let current = env!("CARGO_PKG_VERSION");
    let base = api_base.trim().trim_end_matches('/').to_string();
    if base.is_empty() {
        return Ok(serde_json::json!({ "ok": false, "current": current }));
    }
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
    {
        Ok(c) => c,
        Err(_) => return Ok(serde_json::json!({ "ok": false, "current": current })),
    };
    let resp = client.get(format!("{}/v1/health", base)).send().await;
    let body: Value = match resp {
        Ok(r) if r.status().is_success() => r.json().await.unwrap_or_else(|_| serde_json::json!({})),
        _ => return Ok(serde_json::json!({ "ok": false, "current": current })),
    };
    let min = body.get("min_app_version").and_then(|v| v.as_str()).filter(|s| !s.is_empty());
    let latest = body.get("latest_app_version").and_then(|v| v.as_str()).filter(|s| !s.is_empty());
    let download_url = body
        .get("app_download_url")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .unwrap_or("")
        .to_string();
    let update_required = min.map(|m| version_lt(current, m)).unwrap_or(false);
    let update_available = latest.map(|l| version_lt(current, l)).unwrap_or(false);
    Ok(serde_json::json!({
        "ok": true,
        "current": current,
        "min": min,
        "latest": latest,
        "download_url": download_url,
        "update_required": update_required,
        "update_available": update_available,
    }))
}


// ════════════════════════════════════════════════════════════════════════
//  App reset / clean-install — Danger Zone in Settings.
//
//  Three commands powering the "start fresh on this machine" flow:
//    1. `app_reset_preview` — read-only summary of what would be
//       deleted (paths, sizes, topic count, BYOK provider list).
//       Drives the confirmation modal so users know exactly what's
//       going away before they type DELETE.
//    2. `app_hard_reset` — wipes the entire data_dir contents
//       (SQLite + caches + schedule.log) AND the BYOK env file.
//       Caller (FE) is responsible for clearing localStorage and
//       triggering relaunch.
//    3. `app_relaunch` — calls Tauri's `app.restart()` so the user
//       gets the fresh-install experience without manually quitting.
//
//  All three are cross-platform via `data_dir(app)` (Tauri resolves
//  app_data_dir per OS: ~/Library/Application Support on macOS,
//  %APPDATA% on Windows, ~/.local/share on Linux) and `byok_env_path()`
//  (`HOME` with `USERPROFILE` fallback for Windows).
// ════════════════════════════════════════════════════════════════════════

/// Recursive size walker for the data_dir preview. Returns
/// (file_count, total_bytes). Symlinks intentionally NOT followed —
/// otherwise an `~/Library/Application Support/com.shantanu.openreply/openreply`
/// containing a symlink to / would lock the UI for minutes.
fn walk_dir_size(path: &std::path::Path) -> (u64, u64) {
    fn recurse(p: &std::path::Path, files: &mut u64, bytes: &mut u64) {
        let meta = match std::fs::symlink_metadata(p) {
            Ok(m) => m,
            Err(_) => return,
        };
        let ft = meta.file_type();
        if ft.is_symlink() {
            return;
        }
        if ft.is_dir() {
            if let Ok(entries) = std::fs::read_dir(p) {
                for entry in entries.flatten() {
                    recurse(&entry.path(), files, bytes);
                }
            }
        } else if ft.is_file() {
            *files += 1;
            *bytes += meta.len();
        }
    }
    let mut files = 0;
    let mut bytes = 0;
    recurse(path, &mut files, &mut bytes);
    (files, bytes)
}

/// Read-only preview of what `app_hard_reset` would delete. Safe to
/// call any time — does not modify anything on disk.
///
/// Returns a JSON object the FE renders inside the confirmation modal:
///   - `data_dir`: absolute path of the app data folder.
///   - `data_files`, `data_bytes`, `data_mb`: total content under it.
///   - `sqlite_present`: whether `openreply.sqlite` exists.
///   - `topic_count`: distinct topics with at least one post (0 if no DB).
///   - `license_present`, `license_email`: always false / null in the open-source build.
///   - `byok_env_path`: absolute path to the keys file (may be null
///     if HOME/USERPROFILE unset).
///   - `byok_present`: whether the file exists.
///   - `byok_providers`: short names of providers with a non-empty key.
#[tauri::command]
pub async fn app_reset_preview(app: AppHandle) -> Result<Value, String> {
    use crate::cli::data_dir;

    let data = data_dir(&app).map_err(err_to_string)?;
    let (files, bytes) = walk_dir_size(&data);

    // SQLite topic count — open read-only so a held write-lock from the
    // running app doesn't block us. Falls back to 0 silently on any
    // error (schema missing, file absent, version mismatch).
    let sqlite_path = data.join("openreply.sqlite");
    let sqlite_present = sqlite_path.exists();
    let mut topic_count: i64 = 0;
    if sqlite_present {
        let uri = format!("file:{}?mode=ro", sqlite_path.to_string_lossy());
        if let Ok(conn) = rusqlite::Connection::open_with_flags(
            &uri,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_URI,
        ) {
            topic_count = conn
                .query_row(
                    "SELECT count(DISTINCT topic) FROM topic_posts",
                    [],
                    |r| r.get::<_, i64>(0),
                )
                .unwrap_or(0);
        }
    }

    // License fields are not used in the open-source build.
    let license_present = false;
    let license_email: Option<String> = None;

    // BYOK env file — list providers that have a non-empty key.
    let byok_path = byok_env_path().ok();
    let byok_present = byok_path
        .as_ref()
        .map(|p| p.exists())
        .unwrap_or(false);
    let mut byok_providers: Vec<String> = vec![];
    if let Some(p) = byok_path.as_ref() {
        if byok_present {
            if let Ok(content) = std::fs::read_to_string(p) {
                let map = parse_env(&content);
                // (key in the env file, friendly name shown in the modal)
                let providers: &[(&str, &str)] = &[
                    ("ANTHROPIC_API_KEY",  "anthropic"),
                    ("OPENAI_API_KEY",     "openai"),
                    ("OPENROUTER_API_KEY", "openrouter"),
                    ("GROQ_API_KEY",       "groq"),
                    ("DEEPSEEK_API_KEY",   "deepseek"),
                    ("MISTRAL_API_KEY",    "mistral"),
                    ("GOOGLE_API_KEY",     "google"),
                    ("NVIDIA_API_KEY",     "nvidia"),
                    ("REDDIT_CLIENT_ID",   "reddit"),
                ];
                for (env_key, name) in providers {
                    if map.get(*env_key).map_or(false, |v| !v.is_empty()) {
                        byok_providers.push((*name).to_string());
                    }
                }
            }
        }
    }

    Ok(serde_json::json!({
        "data_dir": data.to_string_lossy().to_string(),
        "data_files": files,
        "data_bytes": bytes,
        "data_mb": (bytes as f64 / 1_048_576.0 * 100.0).round() / 100.0,
        "sqlite_present": sqlite_present,
        "topic_count": topic_count,
        "license_present": license_present,
        "license_email": license_email,
        "byok_env_path": byok_path.map(|p| p.to_string_lossy().to_string()),
        "byok_present": byok_present,
        "byok_providers": byok_providers,
    }))
}

/// Wipe the app data dir contents + BYOK env file. Idempotent — re-running
/// on an already-clean machine returns `removed: []`.
///
/// We `remove_dir_all` + `create_dir_all` the data_dir rather than walking
/// + removing per-file so transient locked files (Tauri's own log handle,
/// in-flight SQLite WAL) bubble up as one clear error instead of partial
/// state. The recreate ensures the next launch doesn't blow up looking
/// for a missing app data folder.
///
/// Caller MUST:
///   1. Clear browser-side localStorage (data_dir wipe doesn't touch
///      WebView storage — that's separate per-app on Tauri).
///   2. Call `app_relaunch` (or instruct user to Cmd+Q + reopen) so any
///      cached in-memory state from before the reset is discarded.
#[tauri::command]
pub async fn app_hard_reset(app: AppHandle) -> Result<Value, String> {
    use crate::cli::data_dir;

    let data = data_dir(&app).map_err(err_to_string)?;
    let mut removed: Vec<String> = vec![];
    let mut errors: Vec<String> = vec![];

    // Wipe + recreate. Recreating an empty dir is safe — next launch's
    // data_dir() call will be a no-op since it already exists.
    if data.exists() {
        match std::fs::remove_dir_all(&data) {
            Ok(_) => removed.push(data.to_string_lossy().to_string()),
            Err(e) => errors.push(format!("remove {}: {e}", data.display())),
        }
        if let Err(e) = std::fs::create_dir_all(&data) {
            errors.push(format!("recreate {}: {e}", data.display()));
        }
    }

    // BYOK env file — delete the file but leave the .config/openreply
    // directory so future `byok_set` calls don't have to recreate it.
    if let Ok(env_path) = byok_env_path() {
        if env_path.exists() {
            match std::fs::remove_file(&env_path) {
                Ok(_) => removed.push(env_path.to_string_lossy().to_string()),
                Err(e) => errors.push(format!("remove {}: {e}", env_path.display())),
            }
        }
    }

    if !errors.is_empty() {
        return Ok(serde_json::json!({
            "ok": false,
            "removed": removed,
            "errors": errors,
        }));
    }
    Ok(serde_json::json!({
        "ok": true,
        "removed": removed,
    }))
}

/// Restart the running app. Equivalent to the user quitting (Cmd+Q on
/// macOS, Alt+F4 on Windows) and re-launching from Applications / Start
/// Menu / Launcher. The current process is replaced — this command does
/// not return.
///
/// Called by the Hard Reset flow right after `app_hard_reset` so the
/// user lands in the wizard with zero in-memory state from the pre-reset
/// session. On Tauri 2 this is `AppHandle::restart()`; we don't have
/// to thread an exit code since Tauri handles the spawn-then-exit
/// dance internally.
#[tauri::command]
pub async fn app_relaunch(app: AppHandle) -> Result<(), String> {
    // restart() returns Infallible / `!` on Tauri 2 — the call never
    // returns because the current process is replaced. The Result wrap
    // keeps the command shape consistent with the rest of the API so the
    // FE can `await` it without special-casing.
    app.restart();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_env_handles_comments_quotes() {
        let raw = r#"
# ignore
FOO=bar
EMPTY=
QUOTED="hello"
SINGLE='world'
"#;
        let m = parse_env(raw);
        assert_eq!(m.get("FOO").map(String::as_str), Some("bar"));
        assert_eq!(m.get("EMPTY").map(String::as_str), Some(""));
        assert_eq!(m.get("QUOTED").map(String::as_str), Some("hello"));
        assert_eq!(m.get("SINGLE").map(String::as_str), Some("world"));
    }

    #[test]
    fn serialize_env_roundtrip() {
        let mut m = std::collections::BTreeMap::new();
        m.insert("LLM_PROVIDER".into(), "ollama".into());
        m.insert("OLLAMA_BASE_URL".into(), "http://127.0.0.1:11434".into());
        let s = serialize_env(&m);
        assert!(s.contains("LLM_PROVIDER=ollama"));
        let parsed = parse_env(&s);
        assert_eq!(parsed.get("LLM_PROVIDER").map(String::as_str), Some("ollama"));
    }
}


// ── Goal-directed self-evolving agents (Goal Playbook + idea synthesis) ──────
// Triangle: these + main.rs::generate_handler! + or/api.js wrappers.

/// Set the active agent's structured goal.
#[tauri::command]
pub async fn agent_goal_set(
    app: AppHandle,
    objective: String,
    audience: String,
    win_signal: String,
    guardrails: String,
) -> Result<Value, String> {
    run_cli(&app, vec![
        "reply", "goal-set",
        "--objective", &objective, "--audience", &audience,
        "--win-signal", &win_signal, "--guardrails", &guardrails, "--json",
    ]).await.map_err(err_to_string)
}

/// Read the active agent's current Goal Playbook.
#[tauri::command]
pub async fn agent_playbook_get(app: AppHandle) -> Result<Value, String> {
    run_cli(&app, vec!["reply", "playbook", "--json"]).await.map_err(err_to_string)
}

/// Re-distill the active agent's Goal Playbook (manual "Evolve now").
#[tauri::command]
pub async fn agent_evolve(app: AppHandle) -> Result<Value, String> {
    run_cli(&app, vec!["reply", "evolve", "--json"]).await.map_err(err_to_string)
}

/// List suggested ideas, or synthesize fresh ones when `suggest` is true.
#[tauri::command]
pub async fn agent_ideas(app: AppHandle, suggest: Option<bool>, n: Option<u32>) -> Result<Value, String> {
    let nn = n.unwrap_or(5).to_string();
    let mut args = vec!["reply".to_string(), "ideas".to_string(),
                        "--n".to_string(), nn, "--json".to_string()];
    if suggest.unwrap_or(false) {
        args.push("--suggest".into());
    }
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    run_cli(&app, refs).await.map_err(err_to_string)
}

/// Turn a suggested idea into a real content draft.
#[tauri::command]
pub async fn agent_idea_draft(
    app: AppHandle,
    idea: String,
    kind: Option<String>,
    platform: Option<String>,
) -> Result<Value, String> {
    let k = kind.unwrap_or_default();
    let p = platform.unwrap_or_default();
    run_cli(&app, vec![
        "reply", "idea-draft", "--idea", &idea, "--kind", &k, "--platform", &p, "--json",
    ]).await.map_err(err_to_string)
}

/// Mark a suggested idea used / dismissed.
#[tauri::command]
pub async fn agent_idea_status(app: AppHandle, idea: String, status: String) -> Result<Value, String> {
    run_cli(&app, vec![
        "reply", "idea-status", "--idea", &idea, "--status", &status, "--json",
    ]).await.map_err(err_to_string)
}

// ─────────────────────────────────────────────────────────────────────────
// Minimal X-account worktree bridge.
// ─────────────────────────────────────────────────────────────────────────

/// `openreply x-account add <handle> <auth_token> <ct0>`
#[tauri::command]
pub async fn x_account_add(
    app: AppHandle,
    handle: String,
    auth_token: Option<String>,
    ct0: Option<String>,
) -> Result<Value, String> {
    // Cookies are optional — with just the handle the Python CLI auto-imports
    // browser cookies (or falls back to public read access).
    let at = auth_token.unwrap_or_default();
    let c0 = ct0.unwrap_or_default();
    let mut args = vec!["x-account", "add", &handle];
    if !at.is_empty() && !c0.is_empty() {
        args.push(&at);
        args.push(&c0);
    }
    args.push("--json");
    run_cli(&app, args).await.map_err(err_to_string)
}

/// `openreply x-account list`
#[tauri::command]
pub async fn x_account_list(app: AppHandle) -> Result<Value, String> {
    run_cli(&app, vec!["x-account", "list", "--json"]).await.map_err(err_to_string)
}

/// `openreply x-account profile <handle>`
#[tauri::command]
pub async fn x_account_profile(app: AppHandle, handle: String) -> Result<Value, String> {
    run_cli(&app, vec!["x-account", "profile", &handle, "--json"]).await.map_err(err_to_string)
}

/// `openreply x-account fetch-posts <handle> --count n --with-threads`
#[tauri::command]
pub async fn x_account_fetch_posts(
    app: AppHandle,
    handle: String,
    count: Option<u32>,
    with_threads: Option<bool>,
) -> Result<Value, String> {
    let n = count.unwrap_or(10).to_string();
    let mut args = vec![
        "x-account", "fetch-posts", &handle, "--count", &n,
    ];
    if with_threads.unwrap_or(false) {
        args.push("--with-threads");
    }
    args.push("--json");
    run_cli(&app, args).await.map_err(err_to_string)
}

/// `openreply x-account import-browser <handle>`
#[tauri::command]
pub async fn x_account_import_browser(
    app: AppHandle,
    handle: String,
) -> Result<Value, String> {
    run_cli(&app, vec![
        "x-account", "import-browser", &handle, "--json",
    ]).await.map_err(err_to_string)
}

/// `openreply x-account fetch-thread <handle> <tweet_id_or_url> --limit n`
#[tauri::command]
pub async fn x_account_fetch_thread(
    app: AppHandle,
    handle: String,
    tweet_id_or_url: String,
    limit: Option<u32>,
) -> Result<Value, String> {
    let l = limit.unwrap_or(50).to_string();
    run_cli(&app, vec![
        "x-account", "fetch-thread", &handle, &tweet_id_or_url, "--limit", &l, "--json",
    ]).await.map_err(err_to_string)
}

/// `openreply x-account save-to-library <handle> --count n --with-threads`
#[tauri::command]
pub async fn x_account_save_to_library(
    app: AppHandle,
    handle: String,
    count: Option<u32>,
    with_threads: Option<bool>,
) -> Result<Value, String> {
    let n = count.unwrap_or(25).to_string();
    let mut args = vec!["x-account", "save-to-library", &handle, "--count", &n];
    if with_threads.unwrap_or(false) {
        args.push("--with-threads");
    }
    args.push("--json");
    run_cli(&app, args).await.map_err(err_to_string)
}
