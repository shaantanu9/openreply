//! Tauri commands invoked from the frontend via `invoke(...)`.
//!
//! Each command is a thin bridge to one reddit-cli invocation. Heavy
//! lifting stays in Python.

use crate::cli::{cancel_active_job, data_dir, run_cli, run_cli_streaming, ActiveJob};
use serde_json::Value;
use tauri::{AppHandle, Manager};

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

/// Generate the premium citation-rich markdown report for a topic.
#[tauri::command]
pub async fn export_report_pro(app: AppHandle, topic: String) -> Result<String, String> {
    let data = data_dir(&app).map_err(err_to_string)?;
    let out_path = data.join(format!(
        "report-pro-{}.md",
        topic.replace(' ', "-").to_lowercase()
    ));
    let out_str = out_path.to_string_lossy().to_string();
    run_cli(
        &app,
        vec![
            "research", "report-pro", "--topic", &topic, "--out", &out_str,
        ],
    )
    .await
    .map_err(err_to_string)?;
    Ok(out_str)
}

/// Ingest a local file into a topic (CSV/JSON/TXT/VTT/SRT/MD).
#[tauri::command]
pub async fn ingest_file(
    app: AppHandle,
    path: String,
    topic: String,
    source_type: String,
) -> Result<Value, String> {
    run_cli(
        &app,
        vec![
            "ingest", "file",
            "--path", &path,
            "--topic", &topic,
            "--source-type", &source_type,
        ],
    )
    .await
    .map_err(err_to_string)
}

/// List exported files (.md, .html) in the app data dir.
#[tauri::command]
pub async fn list_exports(app: AppHandle) -> Result<Value, String> {
    let data = data_dir(&app).map_err(err_to_string)?;
    let mut out = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&data) {
        for entry in entries.flatten() {
            let path = entry.path();
            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
            if !matches!(ext, "md" | "html") { continue; }
            let meta = entry.metadata().ok();
            let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
            let modified = meta
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            out.push(serde_json::json!({
                "name": entry.file_name().to_string_lossy().to_string(),
                "path": path.to_string_lossy().to_string(),
                "ext": ext,
                "size": size,
                "modified": modified,
            }));
        }
    }
    out.sort_by(|a, b| {
        b.get("modified").and_then(|v| v.as_u64()).unwrap_or(0)
            .cmp(&a.get("modified").and_then(|v| v.as_u64()).unwrap_or(0))
    });
    Ok(Value::Array(out))
}

/// Delete a topic — removes its topic_posts + graph nodes/edges, keeps posts.
#[tauri::command]
pub async fn delete_topic(app: AppHandle, topic: String) -> Result<Value, String> {
    let esc_topic = topic.replace('\'', "''");
    let sql = format!(
        "DELETE FROM topic_posts WHERE topic='{}'; \
         DELETE FROM graph_nodes WHERE topic='{}'; \
         DELETE FROM graph_edges WHERE topic='{}';",
        esc_topic, esc_topic, esc_topic
    );
    run_cli(&app, vec!["query", &sql]).await.map_err(err_to_string)
}

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
#[tauri::command]
pub async fn cancel_collect(app: AppHandle) -> Result<bool, String> {
    Ok(cancel_active_job(&app))
}

/// Is a long-running collect currently active?
#[tauri::command]
pub async fn collect_status(app: AppHandle) -> Result<bool, String> {
    let state = app.state::<ActiveJob>();
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    Ok(guard.is_some())
}

/// The app's persistent data dir (for "Reveal in Finder" etc.)
#[tauri::command]
pub async fn app_data_dir(app: AppHandle) -> Result<String, String> {
    data_dir(&app)
        .map(|p| p.to_string_lossy().to_string())
        .map_err(err_to_string)
}

/// Path to the user's BYOK env file (`~/.config/reddit-myind/.env`).
fn byok_env_path() -> Result<std::path::PathBuf, String> {
    let home = std::env::var("HOME").map_err(|e| e.to_string())?;
    let dir = std::path::PathBuf::from(home).join(".config").join("reddit-myind");
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
    lines.push_str("# Generated by Gap Map — edit keys in Settings\n");
    for (k, v) in map {
        lines.push_str(&format!("{}={}\n", k, v));
    }
    lines
}

/// Read current BYOK status — returns which keys are set (masked values).
#[tauri::command]
pub async fn byok_status(_app: AppHandle) -> Result<Value, String> {
    let path = byok_env_path()?;
    let contents = std::fs::read_to_string(&path).unwrap_or_default();
    let map = parse_env(&contents);
    let mask = |k: &str| -> Value {
        match map.get(k) {
            Some(v) if !v.is_empty() => {
                let masked = if v.len() > 8 {
                    format!("{}…{}", &v[..4], &v[v.len()-4..])
                } else { "•".repeat(v.len()) };
                serde_json::json!({ "set": true, "preview": masked })
            }
            _ => serde_json::json!({ "set": false, "preview": "" }),
        }
    };
    Ok(serde_json::json!({
        "path": path.to_string_lossy().to_string(),
        "anthropic": mask("ANTHROPIC_API_KEY"),
        "openai":    mask("OPENAI_API_KEY"),
        "reddit_client_id":     mask("REDDIT_CLIENT_ID"),
        "reddit_client_secret": mask("REDDIT_CLIENT_SECRET"),
        "reddit_refresh_token": mask("REDDIT_REFRESH_TOKEN"),
    }))
}

/// Set (or update) a single BYOK key. Empty `value` deletes the key.
/// Whitelisted names: ANTHROPIC_API_KEY, OPENAI_API_KEY, REDDIT_CLIENT_ID,
/// REDDIT_CLIENT_SECRET, REDDIT_REFRESH_TOKEN.
#[tauri::command]
pub async fn byok_set(_app: AppHandle, name: String, value: String) -> Result<Value, String> {
    const ALLOWED: &[&str] = &[
        "ANTHROPIC_API_KEY",
        "OPENAI_API_KEY",
        "REDDIT_CLIENT_ID",
        "REDDIT_CLIENT_SECRET",
        "REDDIT_REFRESH_TOKEN",
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
        map.insert(name.clone(), trimmed);
    }
    std::fs::write(&path, serialize_env(&map)).map_err(|e| e.to_string())?;
    // Restrict perms to 0600 on unix so keys aren't world-readable.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
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

