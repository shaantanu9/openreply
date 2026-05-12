// Persona agent Tauri commands — Phase 1 (2026-05-12).
//
// Self-contained module. The entire persona feature can be removed by:
//   1. deleting this file
//   2. removing `mod persona_cmds;` from main.rs
//   3. removing the `commands::persona_agent_*` entries from generate_handler!
//   4. removing the api.js wrappers
//   5. deleting src/reddit_research/persona/ + cli/persona_cmds.py
//
// Naming convention `persona_agent_*` chosen to avoid collision with the
// pre-existing `commands::persona_view` (subreddit-author clustering).

use serde_json::Value;
use tauri::AppHandle;

use crate::cli::{run_cli, run_cli_streaming};

fn err_to_string<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

#[tauri::command]
pub async fn persona_agent_list(app: AppHandle) -> Result<Value, String> {
    run_cli(&app, vec!["persona", "list", "--json"]).await.map_err(err_to_string)
}

#[tauri::command]
pub async fn persona_agent_create(
    app: AppHandle,
    name: String,
    goal: String,
    lens: String,
    system_prompt: Option<String>,
    color: Option<String>,
    icon: Option<String>,
) -> Result<Value, String> {
    let mut args: Vec<&str> = vec!["persona", "create", "-n", &name, "-g", &goal, "-l", &lens];
    if let Some(s) = system_prompt.as_deref() {
        args.push("--system-prompt");
        args.push(s);
    }
    if let Some(s) = color.as_deref() {
        args.push("--color");
        args.push(s);
    }
    if let Some(s) = icon.as_deref() {
        args.push("--icon");
        args.push(s);
    }
    args.push("--json");
    run_cli(&app, args).await.map_err(err_to_string)
}

#[tauri::command]
pub async fn persona_agent_update(
    app: AppHandle,
    persona_id: i64,
    name: Option<String>,
    goal: Option<String>,
    lens: Option<String>,
    system_prompt: Option<String>,
    color: Option<String>,
    icon: Option<String>,
    active: Option<bool>,
) -> Result<Value, String> {
    let id_s = persona_id.to_string();
    let mut args: Vec<&str> = vec!["persona", "update", &id_s];
    if let Some(s) = name.as_deref() {
        args.push("--name");
        args.push(s);
    }
    if let Some(s) = goal.as_deref() {
        args.push("--goal");
        args.push(s);
    }
    if let Some(s) = lens.as_deref() {
        args.push("--lens");
        args.push(s);
    }
    if let Some(s) = system_prompt.as_deref() {
        args.push("--system-prompt");
        args.push(s);
    }
    if let Some(s) = color.as_deref() {
        args.push("--color");
        args.push(s);
    }
    if let Some(s) = icon.as_deref() {
        args.push("--icon");
        args.push(s);
    }
    if let Some(b) = active {
        args.push(if b { "--active" } else { "--inactive" });
    }
    args.push("--json");
    run_cli(&app, args).await.map_err(err_to_string)
}

#[tauri::command]
pub async fn persona_agent_delete(app: AppHandle, persona_id: i64) -> Result<Value, String> {
    let id_s = persona_id.to_string();
    run_cli(&app, vec!["persona", "delete", &id_s, "--json"]).await.map_err(err_to_string)
}

#[tauri::command]
pub async fn persona_agent_memories(
    app: AppHandle,
    persona_id: i64,
    topic: Option<String>,
    limit: Option<u32>,
) -> Result<Value, String> {
    let id_s = persona_id.to_string();
    let lim_s = limit.unwrap_or(50).to_string();
    let mut args: Vec<&str> = vec!["persona", "memories", &id_s, "--limit", &lim_s];
    if let Some(t) = topic.as_deref() {
        args.push("-t");
        args.push(t);
    }
    args.push("--json");
    run_cli(&app, args).await.map_err(err_to_string)
}

#[tauri::command]
pub async fn persona_agent_chat(
    app: AppHandle,
    persona_id: i64,
    question: String,
    k: Option<u32>,
) -> Result<Value, String> {
    let id_s = persona_id.to_string();
    let k_s = k.unwrap_or(8).to_string();
    run_cli(
        &app,
        vec![
            "persona", "chat", &id_s, &question, "--k", &k_s, "--json",
        ],
    )
    .await
    .map_err(err_to_string)
}

/// Phase 4a — persona-of-personas. Streams `persona_ingest:progress` events
/// (same channel as regular ingest) so the UI's existing listener handles
/// both. Source key is `peer:<conclusion_id>` for provenance.
#[tauri::command]
pub async fn persona_agent_ingest_peers(
    app: AppHandle,
    persona_id: i64,
    limit: Option<u32>,
) -> Result<(), String> {
    let id_s = persona_id.to_string();
    let lim_s = limit.unwrap_or(50).to_string();
    let args: Vec<&str> = vec![
        "persona", "ingest-peers", &id_s, "--limit", &lim_s, "--json",
    ];
    run_cli_streaming(&app, args, "persona_ingest:progress", "persona_ingest:done")
        .await
        .map_err(err_to_string)
}

/// Streaming ingest — emits `persona_ingest:progress` events line-by-line
/// and a final `persona_ingest:done` envelope. Pass persona_id=None to fan
/// out across every active persona.
#[tauri::command]
pub async fn persona_agent_ingest(
    app: AppHandle,
    persona_id: Option<i64>,
    topic: Option<String>,
    limit: Option<u32>,
) -> Result<(), String> {
    let id_s = persona_id.map(|i| i.to_string());
    let lim_s = limit.unwrap_or(50).to_string();
    let mut args: Vec<&str> = vec!["persona", "ingest", "--limit", &lim_s, "--json"];
    if let Some(s) = id_s.as_deref() {
        args.push("-p");
        args.push(s);
    }
    if let Some(t) = topic.as_deref() {
        args.push("-t");
        args.push(t);
    }
    run_cli_streaming(&app, args, "persona_ingest:progress", "persona_ingest:done")
        .await
        .map_err(err_to_string)
}

/// Streaming teach-from-video — emits the same `persona_ingest:progress` /
/// `persona_ingest:done` events as the regular ingest path so the UI's
/// existing listener handles both. The leading `teach:start` / `teach:fetched`
/// / `teach:error` events ride on the same `:progress` channel; the UI
/// pattern-matches by `ev.event` to render the fetch phase distinctly.
#[tauri::command]
pub async fn persona_agent_teach_video(
    app: AppHandle,
    persona_id: i64,
    url: String,
    comments_limit: Option<u32>,
) -> Result<(), String> {
    let id_s = persona_id.to_string();
    let cl_s = comments_limit.unwrap_or(100).to_string();
    let args: Vec<&str> = vec![
        "persona", "teach-video", &id_s, &url,
        "--comments", &cl_s, "--json",
    ];
    run_cli_streaming(&app, args, "persona_ingest:progress", "persona_ingest:done")
        .await
        .map_err(err_to_string)
}

// ─── Phase 2b — graph + conclusions ───

#[tauri::command]
pub async fn persona_agent_graph(
    app: AppHandle,
    persona_id: i64,
    edge_limit: Option<u32>,
) -> Result<Value, String> {
    let id_s = persona_id.to_string();
    let el_s = edge_limit.unwrap_or(500).to_string();
    run_cli(
        &app,
        vec!["persona", "graph", &id_s, "--edge-limit", &el_s, "--json"],
    )
    .await
    .map_err(err_to_string)
}

#[tauri::command]
pub async fn persona_agent_backfill(
    app: AppHandle,
    persona_id: i64,
) -> Result<Value, String> {
    let id_s = persona_id.to_string();
    run_cli(&app, vec!["persona", "backfill", &id_s, "--json"])
        .await
        .map_err(err_to_string)
}

/// Streaming conclusion synthesis. Emits `persona_conclude:progress` per
/// cluster event and `persona_conclude:done` at the end.
#[tauri::command]
pub async fn persona_agent_conclude(
    app: AppHandle,
    persona_id: i64,
    no_refresh: Option<bool>,
) -> Result<(), String> {
    let id_s = persona_id.to_string();
    let mut args: Vec<&str> = vec!["persona", "conclude", &id_s, "--json"];
    if no_refresh.unwrap_or(false) {
        args.push("--no-refresh");
    }
    run_cli_streaming(&app, args, "persona_conclude:progress", "persona_conclude:done")
        .await
        .map_err(err_to_string)
}

#[tauri::command]
pub async fn persona_agent_rejections(
    app: AppHandle,
    persona_id: i64,
    direction: Option<String>,
    limit: Option<u32>,
) -> Result<Value, String> {
    let id_s = persona_id.to_string();
    let dir = direction.unwrap_or_else(|| "involving".to_string());
    let lim_s = limit.unwrap_or(50).to_string();
    run_cli(
        &app,
        vec![
            "persona", "rejections", &id_s,
            "--direction", &dir, "--limit", &lim_s,
            "--json",
        ],
    )
    .await
    .map_err(err_to_string)
}

#[tauri::command]
pub async fn persona_agent_share(
    app: AppHandle,
    from_persona_id: i64,
    memory_id: i64,
    to_persona_id: i64,
) -> Result<Value, String> {
    let from_s = from_persona_id.to_string();
    let mid_s = memory_id.to_string();
    let to_s = to_persona_id.to_string();
    run_cli(
        &app,
        vec![
            "persona", "share",
            "-f", &from_s, "-m", &mid_s, "-t", &to_s,
            "--json",
        ],
    )
    .await
    .map_err(err_to_string)
}

#[tauri::command]
pub async fn persona_agent_conclusions(
    app: AppHandle,
    persona_id: i64,
    limit: Option<u32>,
) -> Result<Value, String> {
    let id_s = persona_id.to_string();
    let lim_s = limit.unwrap_or(100).to_string();
    run_cli(
        &app,
        vec!["persona", "conclusions", &id_s, "--limit", &lim_s, "--json"],
    )
    .await
    .map_err(err_to_string)
}
