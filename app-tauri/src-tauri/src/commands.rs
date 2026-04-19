//! Tauri commands invoked from the frontend via `invoke(...)`.
//!
//! Each command is a thin bridge to one reddit-cli invocation. Heavy
//! lifting stays in Python.

use crate::cli::{
    cancel_active_chat, cancel_active_job, cancel_active_stream, data_dir, run_cli,
    run_cli_chat_streaming, run_cli_stream_streaming, run_cli_streaming,
    ActiveChat, ActiveChatPid, ActiveJob, ActiveJobPid, ActiveStream, ActiveStreamPid,
};
use serde_json::Value;
use tauri::{AppHandle, Manager};

fn err_to_string<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// Strip SQL line/block comments (same rules as `run_query`) for keyword checks only.
fn strip_sql_comments(trimmed: &str) -> String {
    let mut cleaned = String::new();
    let mut in_block = false;
    let mut in_line = false;
    let bytes = trimmed.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        let c = bytes[i] as char;
        let next = bytes.get(i + 1).copied().unwrap_or(0) as char;
        if in_block {
            if c == '*' && next == '/' {
                in_block = false;
                i += 2;
                continue;
            }
            i += 1;
            continue;
        }
        if in_line {
            if c == '\n' {
                in_line = false;
                cleaned.push('\n');
            }
            i += 1;
            continue;
        }
        if c == '/' && next == '*' {
            in_block = true;
            i += 2;
            continue;
        }
        if c == '-' && next == '-' {
            in_line = true;
            i += 2;
            continue;
        }
        cleaned.push(c);
        i += 1;
    }
    cleaned
}

/// Rejects queries that are not read-only (used by DB console).
pub(crate) fn validate_read_only_sql(trimmed: &str) -> Result<(), String> {
    if trimmed.is_empty() {
        return Err("empty query".into());
    }
    let cleaned = strip_sql_comments(trimmed);
    let lower = cleaned.trim().to_ascii_lowercase();
    let starts_ok = lower.starts_with("select")
        || lower.starts_with("with")
        || lower.starts_with("pragma")
        || lower.starts_with("explain");
    if !starts_ok {
        return Err("only SELECT / WITH / PRAGMA / EXPLAIN are allowed".into());
    }
    for bad in &[
        "insert ", "update ", "delete ", "drop ", "alter ", "create ", "replace ",
        "truncate ", "attach ", "detach ", "vacuum", "reindex",
    ] {
        if forbidden_keyword_present(&lower, bad) {
            return Err(format!("query contains forbidden keyword: {}", bad.trim()));
        }
    }
    Ok(())
}

/// True if `needle` appears as a real SQL keyword token, not inside an identifier
/// (e.g. `last_update` must not trip on `update `).
fn forbidden_keyword_present(lower: &str, needle: &str) -> bool {
    fn is_ident_byte(b: u8) -> bool {
        b.is_ascii_alphanumeric() || b == b'_'
    }
    let bytes = lower.as_bytes();
    let nb = needle.as_bytes();
    if needle.ends_with(' ') {
        let core = &nb[..nb.len() - 1];
        if core.is_empty() {
            return false;
        }
        for i in 0..=bytes.len().saturating_sub(core.len()) {
            if bytes.get(i..i + core.len()) == Some(core) {
                let prev_ok = i == 0 || !is_ident_byte(bytes[i - 1]);
                let after = i + core.len();
                let next_is_ws = after < bytes.len() && matches!(bytes[after], b' ' | b'\t' | b'\n' | b'\r');
                if prev_ok && next_is_ws {
                    return true;
                }
            }
        }
        false
    } else {
        let core = nb;
        if core.is_empty() {
            return false;
        }
        for i in 0..=bytes.len().saturating_sub(core.len()) {
            if bytes.get(i..i + core.len()) == Some(core) {
                let prev_ok = i == 0 || !is_ident_byte(bytes[i - 1]);
                let after = i + core.len();
                let after_ok = after >= bytes.len() || !is_ident_byte(bytes[after]);
                if prev_ok && after_ok {
                    return true;
                }
            }
        }
        false
    }
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
    run_cli(&app, vec!["query", sql, "--json"]).await.map_err(err_to_string)
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
    run_cli(&app, vec!["query", sql, "--json"]).await.map_err(err_to_string)
}

/// Recent fetch events for the activity feed.
#[tauri::command]
pub async fn recent_activity(app: AppHandle) -> Result<Value, String> {
    let sql = "SELECT kind, params_json, started_at, ended_at, rows, error \
               FROM fetches ORDER BY started_at DESC LIMIT 12";
    run_cli(&app, vec!["query", sql, "--json"]).await.map_err(err_to_string)
}

/// Discover sub candidates for a topic.
#[tauri::command]
pub async fn discover_subs(app: AppHandle, topic: String, limit: u32) -> Result<Value, String> {
    let lim = limit.to_string();
    run_cli(
        &app,
        vec!["research", "discover", "--topic", &topic, "--limit", &lim, "--json"],
    )
    .await
    .map_err(err_to_string)
}

/// Start a topic collect. Streams progress via `collect:progress` events
/// and emits `collect:done` when complete.
///
/// `sources` (optional) — comma-separated external source names (e.g.
/// "hn,arxiv,pubmed"). Forwarded as `--sources X,Y,Z`.
///
/// `skip_reddit` (default false) — skip the Reddit fetch stages entirely.
/// Useful for topping up an existing topic with only externals.
#[tauri::command]
pub async fn start_collect(
    app: AppHandle,
    topic: String,
    aggressive: bool,
    sources: Option<String>,
    skip_reddit: Option<bool>,
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
    if let Some(s) = sources.as_ref() {
        let trimmed = s.trim();
        if !trimmed.is_empty() {
            args.push("--sources".into());
            args.push(trimmed.into());
        }
    }
    if skip_reddit.unwrap_or(false) {
        args.push("--skip-reddit".into());
    }
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
        vec!["research", "graph", "build", "--topic", &topic, "--json"],
    )
    .await
    .map_err(err_to_string)
}

/// Enrich the graph with LLM-extracted semantic nodes (painpoints, features,
/// workarounds). Safe to call regardless of key state — Python side returns
/// `{ok: false, skipped: true, reason}` when no provider is configured.
#[tauri::command]
pub async fn enrich_graph(app: AppHandle, topic: String) -> Result<Value, String> {
    run_cli(
        &app,
        vec!["research", "graph", "enrich", "--topic", &topic, "--json"],
    )
    .await
    .map_err(err_to_string)
}

/// Run the Problem -> Why -> Science -> Solution pipeline for a topic.
/// Returns a summary JSON or `{ok: false, skipped: true, reason}` if no
/// LLM provider is configured.
#[tauri::command]
pub async fn run_solutions_pipeline(app: AppHandle, topic: String) -> Result<Value, String> {
    run_cli(
        &app,
        vec!["research", "solutions", "--topic", &topic, "--json"],
    )
    .await
    .map_err(err_to_string)
}

/// Run the temporal-gaps classifier (CHRONIC / EMERGING / FADING).
/// Returns either a list of classified painpoints, an `_error` dict when
/// historical data is missing, or `{ok:false, skipped:true, ...}` on no LLM.
#[tauri::command]
pub async fn run_temporal_gaps(app: AppHandle, topic: String) -> Result<Value, String> {
    run_cli(
        &app,
        vec!["research", "temporal-gaps", "--topic", &topic, "--json"],
    )
    .await
    .map_err(err_to_string)
}

/// Quick-extract — runs `research gaps` for a topic without building the
/// graph. Returns the 4-category JSON for preview only. Use enrich_graph
/// to persist the results into the knowledge graph.
#[tauri::command]
pub async fn quick_extract_gaps(app: AppHandle, topic: String) -> Result<Value, String> {
    run_cli(
        &app,
        vec!["research", "gaps", "--topic", &topic, "--json"],
    )
    .await
    .map_err(err_to_string)
}

/// Run an ad-hoc Reddit search via PRAW. Returns an array of post rows.
#[tauri::command]
pub async fn run_reddit_search(
    app: AppHandle,
    query: String,
    sub: Option<String>,
    sort: Option<String>,
    time_filter: Option<String>,
    limit: Option<u32>,
) -> Result<Value, String> {
    let limit_str = limit.unwrap_or(50).to_string();
    let mut args: Vec<&str> = vec!["search", &query];
    if let Some(s) = sub.as_ref() {
        if !s.is_empty() {
            args.push("--sub");
            args.push(s.as_str());
        }
    }
    let sort_v = sort.unwrap_or_else(|| "relevance".to_string());
    args.push("--sort");
    args.push(sort_v.as_str());
    let time_v = time_filter.unwrap_or_else(|| "all".to_string());
    args.push("--time");
    args.push(time_v.as_str());
    args.push("--limit");
    args.push(&limit_str);
    args.push("--json");
    run_cli(&app, args).await.map_err(err_to_string)
}

/// Start a live Reddit stream. Long-running — use cancel_stream to stop.
/// Emits `stream:hit` event per matching post/comment, `stream:done` when ended.
/// Empty `keywords` = firehose mode (every post/comment).
#[tauri::command]
pub async fn start_stream(
    app: AppHandle,
    sub: String,
    keywords: String,
    watch: String,
) -> Result<(), String> {
    let args: Vec<String> = vec![
        "stream".into(),
        "--sub".into(),
        sub,
        "--keywords".into(),
        keywords,
        "--watch".into(),
        watch,
        "--json".into(),
    ];
    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    run_cli_stream_streaming(&app, arg_refs, "stream:hit", "stream:done")
        .await
        .map_err(err_to_string)
}

/// Cancel the active stream (if any). Returns true if a stream was killed.
#[tauri::command]
pub async fn cancel_stream(app: AppHandle) -> Result<bool, String> {
    Ok(cancel_active_stream(&app))
}

/// Is a stream currently active? Checks both prod + dev-python slots.
#[tauri::command]
pub async fn stream_status(app: AppHandle) -> Result<bool, String> {
    if let Some(s) = app.try_state::<ActiveStream>() {
        if s.0.lock().map_err(|e| e.to_string())?.is_some() {
            return Ok(true);
        }
    }
    if let Some(s) = app.try_state::<ActiveStreamPid>() {
        if s.0.lock().map_err(|e| e.to_string())?.is_some() {
            return Ok(true);
        }
    }
    Ok(false)
}

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

#[tauri::command]
pub async fn schedule_enable_topic(
    app: AppHandle,
    topic: String,
    enabled: bool,
) -> Result<Value, String> {
    let flag = if enabled { "--enabled" } else { "--disabled" };
    run_cli(
        &app,
        vec!["research", "schedule-enable", "--topic", &topic, flag],
    )
    .await
    .map(|_| serde_json::json!({"ok": true, "topic": topic, "enabled": enabled}))
    .map_err(err_to_string)
}

#[tauri::command]
pub async fn schedule_mark_seen(app: AppHandle, topic: String) -> Result<Value, String> {
    run_cli(
        &app,
        vec!["research", "schedule-seen", "--topic", &topic],
    )
    .await
    .map(|_| serde_json::json!({"ok": true, "topic": topic}))
    .map_err(err_to_string)
}

/// Time-windowed diff of findings — "what's new in the last N days?".
#[tauri::command]
pub async fn diff_findings(
    app: AppHandle,
    topic: String,
    window_days: Option<u32>,
) -> Result<Value, String> {
    let win = window_days.unwrap_or(7).to_string();
    run_cli(
        &app,
        vec![
            "research", "diff", "--topic", &topic, "--window", &win, "--json",
        ],
    )
    .await
    .map_err(err_to_string)
}

/// Export the gap-map HTML for a topic. Returns absolute path.
#[tauri::command]
pub async fn export_html(
    app: AppHandle,
    topic: String,
    force: Option<bool>,
) -> Result<String, String> {
    let data = data_dir(&app).map_err(err_to_string)?;
    let out_path = data.join(format!(
        "gap-map-{}.html",
        topic.replace(' ', "-").to_lowercase()
    ));
    let out_str = out_path.to_string_lossy().to_string();

    // Fast path — skip the sidecar spawn if we already have a non-empty
    // export file. `force=true` bypasses this (wired to the Rebuild button).
    // Freshness vs graph_nodes.ts is checked in the frontend (one cheap
    // SQL round-trip) so we don't need to do it here too.
    if !force.unwrap_or(false) {
        if let Ok(meta) = std::fs::metadata(&out_path) {
            if meta.is_file() && meta.len() > 0 {
                return Ok(out_str);
            }
        }
    }

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

/// Export the graph as raw JSON (D3-compatible). Returns absolute path.
#[tauri::command]
pub async fn export_graph_json(app: AppHandle, topic: String) -> Result<String, String> {
    let data = data_dir(&app).map_err(err_to_string)?;
    let out_path = data.join(format!(
        "gap-graph-{}.json",
        topic.replace(' ', "-").to_lowercase()
    ));
    let out_str = out_path.to_string_lossy().to_string();
    run_cli(
        &app,
        vec![
            "research", "graph", "export", "--topic", &topic,
            "--format", "json", "--out", &out_str,
        ],
    )
    .await
    .map_err(err_to_string)?;
    Ok(out_str)
}

/// Findings (painpoints / feature_wish / product / workaround) for a topic.
/// Uses parameterized SQL so topic/kind strings can't break out of the query.
#[tauri::command]
pub async fn get_findings(app: AppHandle, topic: String, kind: String) -> Result<Value, String> {
    let sql = "SELECT n.id, n.label, n.metadata_json, \
               (SELECT count(*) FROM graph_edges e \
                WHERE e.topic=n.topic AND (e.src=n.id OR e.dst=n.id) \
                AND e.kind IN ('evidenced_by','wished_in','built_in','solves','about_product')) \
               AS evidence_count \
         FROM graph_nodes n \
         WHERE n.topic=:topic AND n.kind=:kind \
         ORDER BY evidence_count DESC LIMIT 100";
    let kind_param = format!("kind={}", kind);
    run_cli(
        &app,
        vec!["query", sql, "--topic", &topic, "--param", &kind_param, "--json"],
    )
    .await
    .map_err(err_to_string)
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
/// sqlite-utils' query() only runs a single statement, so we issue three calls.
#[tauri::command]
pub async fn delete_topic(app: AppHandle, topic: String) -> Result<Value, String> {
    for table in ["topic_posts", "graph_nodes", "graph_edges"] {
        let sql = format!("DELETE FROM {table} WHERE topic=:topic");
        run_cli(
            &app,
            vec!["query", &sql, "--topic", &topic, "--json"],
        )
        .await
        .map_err(err_to_string)?;
    }
    Ok(serde_json::json!({ "ok": true, "topic": topic }))
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

/// Is a long-running collect currently active? Checks BOTH the prod sidecar
/// slot and the dev-python pid slot so the UI chip is accurate either way.
#[tauri::command]
pub async fn collect_status(app: AppHandle) -> Result<bool, String> {
    if let Some(s) = app.try_state::<ActiveJob>() {
        if s.0.lock().map_err(|e| e.to_string())?.is_some() {
            return Ok(true);
        }
    }
    if let Some(s) = app.try_state::<ActiveJobPid>() {
        if s.0.lock().map_err(|e| e.to_string())?.is_some() {
            return Ok(true);
        }
    }
    Ok(false)
}

/// The app's persistent data dir (for "Reveal in Finder" etc.)
#[tauri::command]
pub async fn app_data_dir(app: AppHandle) -> Result<String, String> {
    data_dir(&app)
        .map(|p| p.to_string_lossy().to_string())
        .map_err(err_to_string)
}

/// Local semantic search over the posts corpus — hybrid vector + BM25 via the
/// ChromaDB palace. Offline (no external API). Returns up to `k` hits with
/// score, text, and metadata. Topic / source filters are optional.
#[tauri::command]
pub async fn semantic_search(
    app: AppHandle,
    query: String,
    topic: Option<String>,
    source: Option<String>,
    k: Option<u32>,
) -> Result<Value, String> {
    let k_str = k.unwrap_or(10).to_string();
    let mut args: Vec<String> = vec![
        "research".into(), "semantic-search".into(),
        "--query".into(), query,
        "--k".into(), k_str,
        "--json".into(),
    ];
    if let Some(t) = topic { if !t.is_empty() { args.push("--topic".into()); args.push(t); } }
    if let Some(s) = source { if !s.is_empty() { args.push("--source".into()); args.push(s); } }
    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    run_cli(&app, arg_refs).await.map_err(err_to_string)
}

/// Find the k posts semantically closest to `post_id`.
#[tauri::command]
pub async fn related_posts(
    app: AppHandle,
    post_id: String,
    k: Option<u32>,
    topic: Option<String>,
) -> Result<Value, String> {
    let k_str = k.unwrap_or(10).to_string();
    let mut args: Vec<String> = vec![
        "research".into(), "related-posts".into(),
        "--post-id".into(), post_id,
        "--k".into(), k_str,
        "--json".into(),
    ];
    if let Some(t) = topic { if !t.is_empty() { args.push("--topic".into()); args.push(t); } }
    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    run_cli(&app, arg_refs).await.map_err(err_to_string)
}

/// One-shot reindex of every row in `posts` into the semantic palace. Used
/// after enabling the retrieval extras on an existing corpus.
#[tauri::command]
pub async fn reindex_palace(app: AppHandle) -> Result<Value, String> {
    run_cli(&app, vec!["research", "reindex-palace", "--json"])
        .await
        .map_err(err_to_string)
}

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
/// `palace:warmup:done` when finished. Safe to call when the model is
/// already cached — emits `{event:"done", ok:true, already:true}` instantly.
#[tauri::command]
pub async fn palace_warmup(app: AppHandle) -> Result<(), String> {
    // Reuse the chat streaming helper — same contract (JSON per line on
    // stdout, done event on exit). Event namespace is per-command so the
    // UI can subscribe to just palace progress without noise from chat.
    run_cli_chat_streaming(
        &app,
        vec!["research", "palace-warmup"],
        "palace:warmup:progress",
        "palace:warmup:done",
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
    let db = dir.join("reddit.db");
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
#[tauri::command]
pub async fn start_chat(
    app: AppHandle,
    topic: String,
    question: String,
    mode: String,
    agent: Option<bool>,
) -> Result<(), String> {
    let mut args: Vec<String> = vec![
        "research".into(),
        "chat".into(),
        "--topic".into(),
        topic,
        "--mode".into(),
        mode,
        "--json".into(),
    ];
    if agent.unwrap_or(false) {
        args.push("--agent".into());
    }
    if !question.trim().is_empty() {
        args.push("--question".into());
        args.push(question);
    }
    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    run_cli_chat_streaming(&app, arg_refs, "chat:progress", "chat:done")
        .await
        .map_err(err_to_string)
}

/// Cancel the active chat job, if any.
#[tauri::command]
pub async fn cancel_chat(app: AppHandle) -> Result<bool, String> {
    Ok(cancel_active_chat(&app))
}

/// Is a chat currently streaming? Checks both prod + dev-python slots.
#[tauri::command]
pub async fn chat_status(app: AppHandle) -> Result<bool, String> {
    if let Some(s) = app.try_state::<ActiveChat>() {
        if s.0.lock().map_err(|e| e.to_string())?.is_some() {
            return Ok(true);
        }
    }
    if let Some(s) = app.try_state::<ActiveChatPid>() {
        if s.0.lock().map_err(|e| e.to_string())?.is_some() {
            return Ok(true);
        }
    }
    Ok(false)
}

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
#[tauri::command]
pub async fn run_query(
    app: AppHandle,
    sql: String,
    topic: Option<String>,
    params: Option<std::collections::HashMap<String, String>>,
) -> Result<Value, String> {
    let trimmed = sql.trim();
    validate_read_only_sql(trimmed)?;
    // Build arg vec dynamically — `--topic` and `--param name=value` are optional.
    let mut args: Vec<String> = vec!["query".into(), trimmed.into(), "--json".into()];
    if let Some(t) = &topic {
        args.push("--topic".into());
        args.push(t.clone());
    }
    if let Some(p) = &params {
        for (k, v) in p {
            args.push("--param".into());
            args.push(format!("{k}={v}"));
        }
    }
    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    run_cli(&app, arg_refs).await.map_err(err_to_string)
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
    // Non-secret values (pref / model / base-url) — return raw so user can see.
    let raw = |k: &str| -> Value {
        map.get(k).map(|v| Value::String(v.clone())).unwrap_or(Value::String(String::new()))
    };
    Ok(serde_json::json!({
        "path": path.to_string_lossy().to_string(),
        "anthropic":  mask("ANTHROPIC_API_KEY"),
        "openai":     mask("OPENAI_API_KEY"),
        "openrouter": mask("OPENROUTER_API_KEY"),
        "groq":       mask("GROQ_API_KEY"),
        "deepseek":   mask("DEEPSEEK_API_KEY"),
        "mistral":    mask("MISTRAL_API_KEY"),
        "google":     mask("GOOGLE_API_KEY"),
        // Alias: most frontend code looks up `byok.ollama` (mirroring the
        // BYOK provider key), while a few older spots use `ollama_base_url`.
        // Return both — same URL string, non-empty when the user has saved one.
        "ollama":               raw("OLLAMA_BASE_URL"),
        "ollama_base_url":      raw("OLLAMA_BASE_URL"),
        "reddit_client_id":     mask("REDDIT_CLIENT_ID"),
        "reddit_client_secret": mask("REDDIT_CLIENT_SECRET"),
        "reddit_refresh_token": mask("REDDIT_REFRESH_TOKEN"),
        // Data-source API keys for non-Reddit fetchers. YouTube is required
        // to collect video comments; the other two are optional rate-limit
        // upgrades for Semantic Scholar + PubMed. All three surface in the
        // BYOK modal's "Reddit + sources" tab.
        "youtube_api_key":          mask("YOUTUBE_API_KEY"),
        "semantic_scholar_api_key": mask("SEMANTIC_SCHOLAR_API_KEY"),
        "ncbi_api_key":             mask("NCBI_API_KEY"),
        "llm_provider": raw("LLM_PROVIDER"),
        "llm_model":    raw("LLM_MODEL"),
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
        "OLLAMA_BASE_URL",
        "LLM_PROVIDER",
        "LLM_MODEL",
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strip_sql_line_comment_preserves_newline() {
        let s = "SELECT 1\n-- ignored\ndelete from x";
        let out = strip_sql_comments(s);
        assert!(out.contains("SELECT 1"));
        assert!(!out.contains("ignored"));
        assert!(out.contains("delete"));
    }

    #[test]
    fn strip_sql_block_comment_multiline() {
        let s = "SELECT /* a\nb */ 2";
        assert_eq!(strip_sql_comments(s), "SELECT  2");
    }

    #[test]
    fn validate_read_only_accepts_select_with_pragma() {
        assert!(validate_read_only_sql("SELECT 1").is_ok());
        assert!(validate_read_only_sql("  select * from posts ").is_ok());
        assert!(validate_read_only_sql("WITH x AS (SELECT 1) SELECT * FROM x").is_ok());
        assert!(validate_read_only_sql("PRAGMA table_info(posts)").is_ok());
        assert!(validate_read_only_sql("EXPLAIN QUERY PLAN SELECT 1").is_ok());
    }

    #[test]
    fn validate_read_only_rejects_mutations() {
        assert!(validate_read_only_sql("").is_err());
        assert!(validate_read_only_sql("   ").is_err());
        assert!(validate_read_only_sql("INSERT INTO t VALUES (1)").is_err());
        assert!(validate_read_only_sql("UPDATE posts SET x=1").is_err());
        assert!(validate_read_only_sql("DELETE FROM posts").is_err());
        assert!(validate_read_only_sql("DROP TABLE posts").is_err());
        assert!(validate_read_only_sql("VACUUM").is_err());
    }

    #[test]
    fn validate_read_only_comments_before_select() {
        assert!(validate_read_only_sql("-- leading\nSELECT 1").is_ok());
        assert!(validate_read_only_sql("/* hi */ SELECT 1").is_ok());
        assert!(validate_read_only_sql("-- a\n-- b\nSELECT 1").is_ok());
    }

    #[test]
    fn validate_read_only_rejects_delete_after_select() {
        assert!(validate_read_only_sql("SELECT 1; DELETE FROM posts").is_err());
        assert!(validate_read_only_sql("WITH x AS (SELECT 1) DELETE FROM posts").is_err());
    }

    #[test]
    fn validate_read_only_rejects_other_mutations() {
        assert!(validate_read_only_sql("ATTACH DATABASE 'x' AS y").is_err());
        assert!(validate_read_only_sql("SELECT 1; DROP TABLE posts").is_err());
        assert!(validate_read_only_sql("REPLACE INTO t VALUES (1)").is_err());
        assert!(validate_read_only_sql("CREATE VIEW v AS SELECT 1").is_err());
    }

    #[test]
    fn validate_read_only_allows_replace_function_in_select() {
        // Keyword list uses `replace ` with trailing space — REPLACE(...) is OK.
        assert!(validate_read_only_sql("SELECT replace(title, '-', '') FROM posts").is_ok());
    }

    /// Substring guard: literals containing forbidden words are rejected.
    #[test]
    fn validate_read_only_false_positive_insert_in_string() {
        assert!(validate_read_only_sql("SELECT 'insert into' AS x").is_err());
    }

    #[test]
    fn validate_read_only_rejects_insert_preamble_after_strip() {
        assert!(validate_read_only_sql("-- c\nINSERT INTO t VALUES (1)").is_err());
    }

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

    #[test]
    fn strip_sql_comments_block_and_line() {
        assert_eq!(strip_sql_comments("SELECT 1"), "SELECT 1");
        assert_eq!(
            strip_sql_comments("/* banner */ SELECT 2"),
            " SELECT 2"
        );
        assert_eq!(
            strip_sql_comments("SELECT 1 -- trailing\nFROM t"),
            "SELECT 1 \nFROM t"
        );
        assert_eq!(strip_sql_comments(""), "");
    }

    #[test]
    fn validate_read_only_rejects_attach_replace_truncate() {
        assert!(validate_read_only_sql("ATTACH DATABASE 'x' AS y").is_err());
        assert!(validate_read_only_sql("SELECT 1; REPLACE INTO t VALUES (1)").is_err());
        assert!(validate_read_only_sql("SELECT 1 WHERE 'truncate ' = 'x'").is_err());
        assert!(validate_read_only_sql("PRAGMA integrity_check").is_ok());
    }

    #[test]
    fn validate_read_only_rejects_forbidden_after_with() {
        assert!(validate_read_only_sql("WITH u AS (SELECT 1) DELETE FROM posts").is_err());
    }

    #[test]
    fn validate_read_only_select_with_substring_false_positive() {
        // Must not reject identifiers containing "update" without a space-delimited keyword
        assert!(validate_read_only_sql("SELECT last_update FROM posts").is_ok());
    }
}

