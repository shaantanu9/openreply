//! Tauri commands invoked from the frontend via `invoke(...)`.
//!
//! Each command is a thin bridge to one reddit-cli invocation. Heavy
//! lifting stays in Python.

use crate::cli::{data_dir, run_cli, run_cli_streaming};
use serde::Serialize;
use serde_json::Value;
use tauri::AppHandle;

fn err_to_string<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// `reddit-cli info` — config + table counts.
#[tauri::command]
pub async fn cli_info(app: AppHandle) -> Result<Value, String> {
    run_cli(&app, vec!["info"]).await.map_err(err_to_string)
}

/// Per-topic inventory for the home screen.
#[tauri::command]
pub async fn list_topics(app: AppHandle) -> Result<Value, String> {
    let sql = "SELECT tp.topic, \
                      count(DISTINCT tp.post_id) AS posts, \
                      count(DISTINCT coalesce(p.source_type,'reddit')) AS sources, \
                      max(tp.added_at) AS last_collect, \
                      (SELECT count(*) FROM graph_nodes n \
                       WHERE n.topic=tp.topic AND n.kind='painpoint') AS painpoints \
               FROM topic_posts tp \
               LEFT JOIN posts p ON p.id=tp.post_id \
               GROUP BY tp.topic \
               ORDER BY last_collect DESC";
    run_cli(&app, vec!["query", sql]).await.map_err(err_to_string)
}

/// Global overview stats (sum across topics) for the hero banner.
#[tauri::command]
pub async fn overview_stats(app: AppHandle) -> Result<Value, String> {
    let sql = "SELECT \
                 (SELECT count(*) FROM posts) AS total_posts, \
                 (SELECT count(*) FROM topic_posts) AS total_tagged, \
                 (SELECT count(DISTINCT topic) FROM topic_posts) AS total_topics, \
                 (SELECT count(*) FROM graph_nodes WHERE kind='painpoint') AS total_painpoints, \
                 (SELECT count(*) FROM graph_nodes WHERE kind='workaround') AS total_workarounds, \
                 (SELECT count(DISTINCT coalesce(source_type,'reddit')) FROM posts) AS total_sources";
    run_cli(&app, vec!["query", sql]).await.map_err(err_to_string)
}

/// Recent fetch events for the activity feed.
#[tauri::command]
pub async fn recent_activity(app: AppHandle) -> Result<Value, String> {
    let sql = "SELECT kind, params_json, started_at, ended_at, rows, error \
               FROM fetches ORDER BY started_at DESC LIMIT 12";
    run_cli(&app, vec!["query", sql]).await.map_err(err_to_string)
}

/// Discover sub candidates for a topic.
#[tauri::command]
pub async fn discover_subs(app: AppHandle, topic: String, limit: u32) -> Result<Value, String> {
    let lim = limit.to_string();
    run_cli(
        &app,
        vec!["research", "discover", "--topic", &topic, "--limit", &lim],
    )
    .await
    .map_err(err_to_string)
}

/// Kick off an aggressive multi-source collect. Streams progress.
#[tauri::command]
pub async fn start_collect(
    app: AppHandle,
    topic: String,
    aggressive: bool,
) -> Result<(), String> {
    let mut args: Vec<String> = vec![
        "research".into(),
        "collect".into(),
        "--topic".into(),
        topic.clone(),
    ];
    if aggressive {
        args.push("--aggressive".into());
    }
    // Convert to &str slice for run_cli_streaming
    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    run_cli_streaming(&app, arg_refs, "collect:progress", "collect:done")
        .await
        .map_err(err_to_string)
}

/// Build the structural graph for a topic.
#[tauri::command]
pub async fn build_graph(app: AppHandle, topic: String) -> Result<Value, String> {
    run_cli(
        &app,
        vec!["research", "graph", "build", "--topic", &topic],
    )
    .await
    .map_err(err_to_string)
}

/// Export the gap-map HTML for a topic. Returns absolute path.
#[tauri::command]
pub async fn export_html(app: AppHandle, topic: String) -> Result<String, String> {
    let data = data_dir(&app).map_err(err_to_string)?;
    let out_path = data.join(format!(
        "gap-map-{}.html",
        topic.replace(' ', "-").to_lowercase()
    ));
    let out_str = out_path.to_string_lossy().to_string();
    run_cli(
        &app,
        vec![
            "research", "graph", "export", "--topic", &topic, "--out", &out_str,
        ],
    )
    .await
    .map_err(err_to_string)?;
    Ok(out_str)
}

/// Findings (painpoints / feature_wish / product / workaround) for a topic.
#[tauri::command]
pub async fn get_findings(app: AppHandle, topic: String, kind: String) -> Result<Value, String> {
    let sql = format!(
        "SELECT n.id, n.label, n.metadata_json, \
               (SELECT count(*) FROM graph_edges e \
                WHERE e.topic=n.topic AND (e.src=n.id OR e.dst=n.id) \
                AND e.kind IN ('evidenced_by','wished_in','built_in','solves','about_product')) \
               AS evidence_count \
         FROM graph_nodes n \
         WHERE n.topic='{}' AND n.kind='{}' \
         ORDER BY evidence_count DESC LIMIT 20",
        topic.replace('\'', "''"),
        kind.replace('\'', "''")
    );
    run_cli(&app, vec!["query", &sql]).await.map_err(err_to_string)
}

/// The app's persistent data dir (for "Reveal in Finder" etc.)
#[tauri::command]
pub async fn app_data_dir(app: AppHandle) -> Result<String, String> {
    data_dir(&app)
        .map(|p| p.to_string_lossy().to_string())
        .map_err(err_to_string)
}

#[derive(Serialize)]
pub struct CollectResult {
    pub topic: String,
    pub posts_fetched: usize,
}
