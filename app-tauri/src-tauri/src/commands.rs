//! Tauri commands invoked from the frontend via `invoke(...)`.
//!
//! Each command is a thin bridge to one reddit-cli invocation. Heavy
//! lifting stays in Python.

use crate::cli::{
    cancel_active_chat, cancel_active_job, cancel_active_stream, data_dir, run_cli,
    run_cli_chat_streaming, run_cli_stream_streaming, run_cli_streaming,
    ActiveChat, ActiveChatPid, ActiveJob, ActiveJobPid, ActiveStream, ActiveStreamPid,
};
use tauri::Listener;
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
///
/// Historically this SQL joined `topic_posts` and showed only topics that had
/// at least one post. That made newly-created topics invisible for 30-60 s
/// while the sidecar fetched data. We now UNION in `topic_prefs` — every
/// collect upserts that table as its first action, so the row appears in
/// listing as soon as the user hits "Start", even if no posts have landed.
/// `COALESCE` fills post counts with 0 for brand-new topics.
#[tauri::command]
pub async fn list_topics(app: AppHandle) -> Result<Value, String> {
    // Filter soft-deleted rows (T1.3). A topic counts as deleted when its
    // topic_prefs row has a non-empty deleted_at. The LEFT JOIN picks up
    // rows that have no topic_prefs entry at all — those stay visible.
    let sql = "WITH t AS ( \
                 SELECT topic FROM topic_posts \
                 UNION SELECT topic FROM topic_prefs \
               ) \
               SELECT t.topic, \
                      COALESCE(stats.posts, 0) AS posts, \
                      COALESCE(stats.sources, 0) AS sources, \
                      COALESCE(stats.last_collect, pref.last_run_ts) AS last_collect, \
                      (SELECT count(*) FROM graph_nodes n \
                       WHERE n.topic=t.topic AND n.kind='painpoint') AS painpoints \
               FROM t \
               LEFT JOIN ( \
                 SELECT tp.topic, \
                        count(DISTINCT tp.post_id) AS posts, \
                        count(DISTINCT coalesce(p.source_type,'reddit')) AS sources, \
                        max(tp.added_at) AS last_collect \
                 FROM topic_posts tp \
                 LEFT JOIN posts p ON p.id=tp.post_id \
                 GROUP BY tp.topic \
               ) stats ON stats.topic = t.topic \
               LEFT JOIN topic_prefs pref ON pref.topic = t.topic \
               WHERE coalesce(pref.deleted_at, '') = '' \
               ORDER BY last_collect DESC NULLS LAST";
    native_query(&app, sql).await
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
    // overview_stats returns a single-row shape, not an array — unwrap.
    let rows = native_query(&app, sql).await?;
    if let Some(arr) = rows.as_array() {
        if let Some(first) = arr.first() {
            return Ok(first.clone());
        }
    }
    Ok(Value::Object(serde_json::Map::new()))
}

/// Recent fetch events for the activity feed.
#[tauri::command]
pub async fn recent_activity(app: AppHandle) -> Result<Value, String> {
    let sql = "SELECT kind, params_json, started_at, ended_at, rows, error \
               FROM fetches ORDER BY started_at DESC LIMIT 12";
    native_query(&app, sql).await
}

/// Native-SQLite helper — same fallback shape as `run_query` (empty array
/// if DB doesn't exist yet) but without the read-only SQL validator (these
/// queries are hardcoded string literals above, not user-supplied).
async fn native_query(app: &AppHandle, sql: &str) -> Result<Value, String> {
    let dir = crate::cli::data_dir(app).map_err(err_to_string)?;
    let db_path = dir.join("reddit.db");
    if !db_path.exists() {
        return Ok(Value::Array(vec![]));
    }
    let sql_owned = sql.to_string();
    tokio::task::spawn_blocking(move || {
        crate::db::query_db(&db_path, &sql_owned, None).map(Value::from)
    })
    .await
    .map_err(|e| format!("query task failed: {e}"))?
    .map_err(|e| e.to_string())
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
) -> Result<Value, String> {
    use crate::cli::ActiveCollects;

    // Single-flight dedup. If the user navigates away from `#/collect/X` and
    // comes back, renderCollect will call start_collect again. Without this
    // we'd spawn a duplicate Python sidecar for the same topic — two parallel
    // writers stomping on the schema. Instead, return already_running so the
    // UI subscribes to the already-streaming events.
    //
    // We clone the inner Arc once and release the State borrow immediately —
    // keeping a long-lived `state` binding would block the subsequent
    // `app.listen_any(...)` and `app.unlisten(...)` calls from borrowing app.
    let active_arc = {
        let state = app.state::<ActiveCollects>();
        state.0.clone()
    };
    {
        let map = active_arc.lock().map_err(|e| e.to_string())?;
        if map.contains_key(&topic) {
            let started_at = map.get(&topic).copied().unwrap_or(0);
            return Ok(serde_json::json!({
                "ok": true,
                "already_running": true,
                "topic": topic,
                "started_at": started_at,
            }));
        }
    }

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

    // The desktop app always skips the CLI's legacy inline LLM extraction
    // pass. Incremental extraction runs in a separate long-lived worker
    // process that drains `extraction_queue` in batches of 5 — see
    // docs/superpowers/plans/2026-04-21-incremental-enrichment.md Task 2.
    // Leaving the inline pass on would block `collect:done` for minutes
    // on aggressive collects and starve the worker's writer of the SQLite
    // busy window.
    args.push("--skip-extraction".into());

    // Register the topic as in-flight BEFORE spawning the sidecar. We remove
    // it when `collect:done` fires (via the listener below).
    let now_secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    {
        let mut map = active_arc.lock().map_err(|e| e.to_string())?;
        map.insert(topic.clone(), now_secs);
    }

    // Subscribe to collect:done so we can auto-remove the topic from the
    // active set. Since only one collect runs per topic at a time (enforced
    // by this map), clearing `topic_clone` on any collect:done event is safe.
    let active_for_listener = active_arc.clone();
    let topic_clone = topic.clone();
    let unlisten = app.listen_any("collect:done", move |_event| {
        if let Ok(mut map) = active_for_listener.lock() {
            map.remove(&topic_clone);
        }
    });

    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let stream_result =
        run_cli_streaming(&app, arg_refs, "collect:progress", "collect:done").await;

    // Always unlisten + ensure topic is cleared, regardless of outcome.
    // On success the listener has already cleared the topic (collect:done
    // fired which is why run_cli_streaming returned); the remove below is a
    // no-op. On failure (sidecar refused to start, etc.) the listener may
    // have never fired — we manually clear so a user retry doesn't return
    // {already_running: true} for a ghost process.
    app.unlisten(unlisten);
    if let Ok(mut map) = active_arc.lock() {
        map.remove(&topic);
    }

    stream_result
        .map(|_| {
            serde_json::json!({
                "ok": true,
                "already_running": false,
                "topic": topic,
                "started_at": now_secs,
            })
        })
        .map_err(err_to_string)
}

/// Return the set of topics that have an in-flight collect, with their start
/// timestamps. Empty object = nothing running. Used by the home screen to
/// pin a "Collecting now" banner with click-to-view-log.
#[tauri::command]
pub async fn active_collects(app: AppHandle) -> Result<Value, String> {
    use crate::cli::ActiveCollects;
    let arc = {
        let state = app.state::<ActiveCollects>();
        state.0.clone()
    };
    let map = arc.lock().map_err(|e| e.to_string())?;
    let out: serde_json::Map<String, Value> = map
        .iter()
        .map(|(k, v)| (k.clone(), Value::from(*v)))
        .collect();
    Ok(Value::Object(out))
}

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
async fn run_graph_op_deduped(
    app: &AppHandle,
    op: &str,
    topic: &str,
    args: Vec<&str>,
) -> Result<Value, String> {
    use crate::cli::ActiveGraphOps;
    let key = format!("{}:{}", op, topic);
    let state = app.state::<ActiveGraphOps>();

    // Try to insert the key — if it's already there, another call is in flight.
    {
        let mut set = state.0.lock().map_err(|e| e.to_string())?;
        if set.contains(&key) {
            return Ok(serde_json::json!({
                "ok": false,
                "already_running": true,
                "topic": topic,
                "op": op,
                "reason": format!(
                    "A {} for topic {:?} is already running. Wait for it to finish before triggering another.",
                    op, topic
                ),
            }));
        }
        set.insert(key.clone());
    }

    // Run the job. The `guard` drops the key back out on success OR error —
    // implemented inline as scope exit rather than a Drop impl because
    // async drop order around `?` is finicky.
    let result = run_cli(app, args).await.map_err(err_to_string);
    {
        if let Ok(mut set) = state.0.lock() {
            set.remove(&key);
        }
    }
    result
}

/// Build the structural graph for a topic. Deduped per-topic.
#[tauri::command]
pub async fn build_graph(app: AppHandle, topic: String) -> Result<Value, String> {
    run_graph_op_deduped(
        &app,
        "build",
        &topic,
        vec!["research", "graph", "build", "--topic", &topic, "--json"],
    )
    .await
}

/// Enrich the graph with LLM-extracted semantic nodes (painpoints, features,
/// workarounds). Safe to call regardless of key state — Python side returns
/// `{ok: false, skipped: true, reason}` when no provider is configured.
/// Deduped per-topic: concurrent callers get `{already_running: true}` back.
#[tauri::command]
pub async fn enrich_graph(app: AppHandle, topic: String) -> Result<Value, String> {
    run_graph_op_deduped(
        &app,
        "enrich",
        &topic,
        vec!["research", "graph", "enrich", "--topic", &topic, "--json"],
    )
    .await
}

/// Phase-1 Insight Engine — one-shot long-context synthesis across all sources.
///
/// Runs `research insights --topic T --json`, returning the full structured
/// market report (opportunity-scored findings, competitors, quadrant).
/// Pass `cached=true` to return the last persisted report without hitting
/// the LLM — cheap for re-renders / tab revisits.
#[tauri::command]
pub async fn synthesize_insights(
    app: AppHandle,
    topic: String,
    cached: Option<bool>,
) -> Result<Value, String> {
    let mut args: Vec<&str> = vec!["research", "insights", "--topic", &topic, "--json"];
    if cached.unwrap_or(false) {
        args.push("--cached");
    }
    run_cli(&app, args).await.map_err(err_to_string)
}

/// Chunked (map-reduce) synthesis — splits the corpus into N small chunks,
/// runs one LLM call per chunk (parallel up to `max_workers`), merges
/// findings deterministically. Use this when the single-call path hits
/// 402/credit errors — each chunk uses `max_tokens_per_chunk` (default 800)
/// so low-budget providers can still produce findings.
///
/// `max_workers=None` picks a provider-adaptive default (Ollama=1, Groq=2,
/// others=4). Set to 1 for strictly sequential execution.
#[tauri::command]
pub async fn synthesize_insights_chunked(
    app: AppHandle,
    topic: String,
    chunk_size: Option<u32>,
    max_workers: Option<u32>,
    max_tokens_per_chunk: Option<u32>,
) -> Result<Value, String> {
    let cs = chunk_size.unwrap_or(40).to_string();
    let mtp = max_tokens_per_chunk.unwrap_or(800).to_string();
    let mut args: Vec<&str> = vec![
        "research", "insights", "--topic", &topic,
        "--chunked",
        "--chunk-size", &cs,
        "--max-tokens-per-chunk", &mtp,
        "--json",
    ];
    let mw_str: String;
    if let Some(mw) = max_workers {
        mw_str = mw.to_string();
        args.push("--max-workers");
        args.push(&mw_str);
    }
    run_cli(&app, args).await.map_err(err_to_string)
}

/// Unified end-to-end gap-discovery pipeline: chunked LLM synth + palace
/// cross-source evidence + science fetch + solutions pipeline + experiment
/// proposals. Every step persists to SQLite so Map/Insights/Research pick
/// up the new nodes without needing a separate refresh.
#[tauri::command]
pub async fn run_gap_discovery(
    app: AppHandle,
    topic: String,
    chunk_size: Option<u32>,
    max_workers: Option<u32>,
    papers_per_painpoint: Option<u32>,
    no_experiments: Option<bool>,
) -> Result<Value, String> {
    let cs = chunk_size.map(|n| n.to_string());
    let mw = max_workers.map(|n| n.to_string());
    let pp = papers_per_painpoint.unwrap_or(5).to_string();
    let mut args: Vec<&str> = vec!["research", "gap-discovery", "--topic", &topic, "--json"];
    if let Some(s) = cs.as_deref() { args.push("--chunk-size"); args.push(s); }
    if let Some(s) = mw.as_deref() { args.push("--max-workers"); args.push(s); }
    args.push("--papers"); args.push(&pp);
    if no_experiments.unwrap_or(false) { args.push("--no-experiments"); }
    run_cli(&app, args).await.map_err(err_to_string)
}

#[tauri::command]
pub async fn list_experiments(app: AppHandle, topic: String) -> Result<Value, String> {
    run_cli(&app, vec!["research", "experiments-list", "--topic", &topic, "--json"])
        .await.map_err(err_to_string)
}

#[tauri::command]
pub async fn persona_view(app: AppHandle, topic: String, persona: String) -> Result<Value, String> {
    run_cli(&app, vec!["research", "persona-view", "--topic", &topic, "--persona", &persona, "--json"])
        .await.map_err(err_to_string)
}

// ─── Phase 5-10 bundle — cross-topic, export, matrix, research linking ─

#[tauri::command]
pub async fn top_opportunities(
    app: AppHandle,
    limit: Option<u32>,
    min_score: Option<f64>,
) -> Result<Value, String> {
    let limit_s = limit.unwrap_or(20).to_string();
    let ms = min_score.unwrap_or(0.0).to_string();
    run_cli(
        &app,
        vec!["research", "top-opportunities",
             "--limit", &limit_s, "--min-score", &ms, "--json"],
    )
    .await.map_err(err_to_string)
}

#[tauri::command]
pub async fn search_findings_global(
    app: AppHandle,
    query: String,
    topic: Option<String>,
    limit: Option<u32>,
) -> Result<Value, String> {
    let limit_s = limit.unwrap_or(30).to_string();
    let mut args: Vec<&str> = vec![
        "research", "search-findings",
        "--query", &query, "--limit", &limit_s, "--json",
    ];
    let t = topic.unwrap_or_default();
    if !t.is_empty() { args.push("--topic"); args.push(t.as_str()); }
    run_cli(&app, args).await.map_err(err_to_string)
}

#[tauri::command]
pub async fn related_topics_for(
    app: AppHandle,
    topic: String,
    limit: Option<u32>,
) -> Result<Value, String> {
    let limit_s = limit.unwrap_or(5).to_string();
    run_cli(
        &app,
        vec!["research", "related-topics",
             "--topic", &topic, "--limit", &limit_s, "--json"],
    )
    .await.map_err(err_to_string)
}

/// Phase-7 export. `format` = "markdown" | "hypotheses" | "slack".
/// Returns the full content string; the UI can copy to clipboard or
/// save-file dialog. No --json flag since the outputs are free-form text.
#[tauri::command]
pub async fn export_brief(
    app: AppHandle,
    topic: String,
    format: Option<String>,
) -> Result<String, String> {
    let fmt = format.unwrap_or_else(|| "markdown".to_string());
    // Export command emits plain markdown on stdout (no --json wrapper).
    // We invoke CLI raw and return the string.
    let data_dir = crate::cli::data_dir(&app).map_err(err_to_string)?;
    let data_str = data_dir.to_string_lossy().to_string();
    let py = std::env::var("REDDIT_MYIND_DEV_PYTHON").ok().and_then(|p| {
        let pb = std::path::PathBuf::from(p);
        if pb.exists() { Some(pb) } else { None }
    }).or_else(|| {
        let mut cur = std::env::current_dir().ok()?;
        for _ in 0..5 {
            let c = cur.join(".venv").join("bin").join("python");
            if c.exists() { return Some(c); }
            if !cur.pop() { break; }
        }
        None
    });
    if let Some(py) = py {
        // Dev path — tokio::process for direct stdout capture
        let output = tokio::process::Command::new(&py)
            .arg("-m").arg("reddit_research.cli.main")
            .arg("research").arg("export-brief")
            .arg("--topic").arg(&topic)
            .arg("--format").arg(&fmt)
            .env("REDDIT_MYIND_DATA_DIR", &data_str)
            .env("PYTHONUNBUFFERED", "1")
            .output().await.map_err(|e| e.to_string())?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).to_string());
        }
        return Ok(String::from_utf8_lossy(&output.stdout).to_string());
    }
    // Prod path — sidecar. The sidecar returns plain markdown; run_cli
    // wraps it in serde_json::from_str and returns Value::Null on parse
    // failure. We want the raw string, so we use shell().sidecar().
    use tauri_plugin_shell::ShellExt;
    let output = app.shell().sidecar("reddit-cli")
        .map_err(|e| e.to_string())?
        .args(["research", "export-brief", "--topic", &topic, "--format", &fmt])
        .env("REDDIT_MYIND_DATA_DIR", &data_str)
        .env("PYTHONUNBUFFERED", "1")
        .output().await.map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[tauri::command]
pub async fn competitor_matrix(
    app: AppHandle,
    topic: String,
) -> Result<Value, String> {
    run_cli(
        &app,
        vec!["research", "competitor-matrix", "--topic", &topic, "--json"],
    )
    .await.map_err(err_to_string)
}

#[tauri::command]
pub async fn link_research(
    app: AppHandle,
    topic: String,
    k: Option<u32>,
) -> Result<Value, String> {
    let k_s = k.unwrap_or(3).to_string();
    run_cli(
        &app,
        vec!["research", "link-research", "--topic", &topic, "--k", &k_s, "--json"],
    )
    .await.map_err(err_to_string)
}

#[tauri::command]
pub async fn research_links(
    app: AppHandle,
    topic: String,
    finding: Option<String>,
) -> Result<Value, String> {
    let mut args: Vec<&str> = vec!["research", "research-links",
                                    "--topic", &topic, "--json"];
    let f = finding.unwrap_or_default();
    if !f.is_empty() { args.push("--finding"); args.push(f.as_str()); }
    run_cli(&app, args).await.map_err(err_to_string)
}

// ─── Phase 4 — Monitoring + Weekly Delta View ─────────────────────────
//
// Runs `research monitor-*` CLI commands. Drives the Dashboard's
// "What's changed this week" card and per-topic delta indicators.
// See src/reddit_research/research/monitor.py.

#[tauri::command]
pub async fn monitor_run_topic(
    app: AppHandle,
    topic: String,
    skip_collect: Option<bool>,
) -> Result<Value, String> {
    let flag = if skip_collect.unwrap_or(true) { "--skip-collect" } else { "--with-collect" };
    run_cli(
        &app,
        vec!["research", "monitor-run", "--topic", &topic, flag, "--json"],
    )
    .await
    .map_err(err_to_string)
}

#[tauri::command]
pub async fn monitor_tick(
    app: AppHandle,
    skip_collect: Option<bool>,
) -> Result<Value, String> {
    let flag = if skip_collect.unwrap_or(true) { "--skip-collect" } else { "--with-collect" };
    run_cli(&app, vec!["research", "monitor-tick", flag, "--json"])
        .await
        .map_err(err_to_string)
}

/// Topic-scoped run history. Omit `topic` for the dashboard view across
/// all topics (returns top-N by delta magnitude within `since_days`).
#[tauri::command]
pub async fn monitor_deltas(
    app: AppHandle,
    topic: Option<String>,
    limit: Option<u32>,
    since_days: Option<u32>,
) -> Result<Value, String> {
    let limit_s = limit.unwrap_or(10).to_string();
    let since_s = since_days.unwrap_or(7).to_string();
    let mut args: Vec<&str> = vec!["research", "monitor-deltas", "--limit", &limit_s, "--json"];
    if let Some(t) = topic.as_ref() {
        if !t.is_empty() {
            args.push("--topic");
            args.push(t.as_str());
        }
    }
    args.push("--since-days");
    args.push(&since_s);
    run_cli(&app, args).await.map_err(err_to_string)
}

// ─── Phase 3 — Hypothesis Tracking / Decision Journal ───────────────────
//
// Promote synthesize_insights hypothesis cards to stateful, trackable bets
// stored in the `hypothesis_tests` SQLite table. The UI's "Save as bet"
// button calls `hypothesis_create`; the Bets tab + state pills call
// `hypothesis_update_status` and `hypothesis_list`. See
// src/reddit_research/research/hypothesis_tracker.py for the state machine.

#[tauri::command]
pub async fn hypothesis_create(
    app: AppHandle,
    topic: String,
    card_json: String,
    status: Option<String>,
) -> Result<Value, String> {
    let s = status.unwrap_or_else(|| "draft".to_string());
    run_cli(
        &app,
        vec![
            "research", "hypothesis-create",
            "--topic", &topic,
            "--card", &card_json,
            "--status", &s,
            "--json",
        ],
    )
    .await
    .map_err(err_to_string)
}

#[tauri::command]
pub async fn hypothesis_update_status(
    app: AppHandle,
    id: String,
    status: String,
    notes: Option<String>,
) -> Result<Value, String> {
    let mut args: Vec<&str> = vec![
        "research", "hypothesis-update",
        "--id", &id,
        "--status", &status,
        "--json",
    ];
    let n = notes.unwrap_or_default();
    if !n.is_empty() {
        args.push("--notes");
        args.push(n.as_str());
    }
    run_cli(&app, args).await.map_err(err_to_string)
}

#[tauri::command]
pub async fn hypothesis_list(
    app: AppHandle,
    topic: Option<String>,
    status: Option<String>,
    include_archived: Option<bool>,
) -> Result<Value, String> {
    let mut args: Vec<String> = vec![
        "research".into(), "hypothesis-list".into(), "--json".into(),
    ];
    if let Some(t) = topic.as_ref() {
        if !t.is_empty() { args.push("--topic".into()); args.push(t.clone()); }
    }
    if let Some(s) = status.as_ref() {
        if !s.is_empty() { args.push("--status".into()); args.push(s.clone()); }
    }
    if include_archived.unwrap_or(false) {
        args.push("--include-archived".into());
    }
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    run_cli(&app, arg_refs).await.map_err(err_to_string)
}

#[tauri::command]
pub async fn hypothesis_delete(app: AppHandle, id: String) -> Result<Value, String> {
    run_cli(
        &app,
        vec!["research", "hypothesis-delete", "--id", &id, "--json"],
    )
    .await
    .map_err(err_to_string)
}

#[tauri::command]
pub async fn hypothesis_stats(
    app: AppHandle,
    topic: Option<String>,
) -> Result<Value, String> {
    let mut args: Vec<String> = vec!["research".into(), "hypothesis-stats".into(), "--json".into()];
    if let Some(t) = topic.as_ref() {
        if !t.is_empty() { args.push("--topic".into()); args.push(t.clone()); }
    }
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    run_cli(&app, arg_refs).await.map_err(err_to_string)
}

/// Pre-check before starting a collect — "does this topic already exist?"
/// UI uses the result to offer Open / Augment / New-fresh choices.
#[tauri::command]
pub async fn find_existing_topic(
    app: AppHandle,
    user_input: String,
) -> Result<Value, String> {
    run_cli(
        &app,
        vec!["research", "find-existing-topic", "--input", &user_input, "--json"],
    ).await.map_err(err_to_string)
}

/// Merge LLM-canonicalization-caused duplicate topic rows. Dry-run by default.
/// Does NOT merge rows that differ purely in user casing — those stay separate.
#[tauri::command]
pub async fn merge_duplicate_topics(
    app: AppHandle,
    apply: Option<bool>,
) -> Result<Value, String> {
    let mut args: Vec<&str> = vec!["research", "merge-duplicate-topics", "--json"];
    if apply.unwrap_or(false) { args.push("--apply"); }
    run_cli(&app, args).await.map_err(err_to_string)
}

/// Relevance-gate cleanup for an existing topic. Dry-run by default.
#[tauri::command]
pub async fn clean_corpus(
    app: AppHandle,
    topic: String,
    threshold: Option<f64>,
    apply: Option<bool>,
    min_keep: Option<i64>,
) -> Result<Value, String> {
    let t = threshold.unwrap_or(0.30).to_string();
    let mk = min_keep.unwrap_or(20).to_string();
    let mut args: Vec<&str> = vec![
        "research", "clean-corpus", "--topic", &topic,
        "--threshold", &t, "--min-keep", &mk, "--json",
    ];
    if apply.unwrap_or(false) { args.push("--apply"); }
    run_cli(&app, args).await.map_err(err_to_string)
}

// ─── Dual-Mode Pivot — Product Mode commands ─────────────────────────────
// Commands for the new product-centric surface. See research/product.py,
// product_sweep.py, product_digest.py. Every command uses run_cli which
// routes dev→venv python, prod→PyInstaller sidecar automatically.

#[tauri::command]
pub async fn product_create(
    app: AppHandle,
    name: String,
    one_liner: Option<String>,
    category: Option<String>,
    topic: Option<String>,
    competitors: Option<serde_json::Value>,
    monitoring_cadence: Option<String>,
) -> Result<Value, String> {
    let competitors_json = competitors
        .map(|v| v.to_string())
        .unwrap_or_else(|| "[]".to_string());
    let ol = one_liner.unwrap_or_default();
    let cat = category.unwrap_or_default();
    let tp = topic.unwrap_or_default();
    let cad = monitoring_cadence.unwrap_or_else(|| "daily".to_string());
    let args: Vec<&str> = vec![
        "research", "product-create",
        "--name", &name,
        "--one-liner", &ol,
        "--category", &cat,
        "--topic", &tp,
        "--competitors", &competitors_json,
        "--cadence", &cad,
        "--json",
    ];
    run_cli(&app, args).await.map_err(err_to_string)
}

#[tauri::command]
pub async fn product_list(
    app: AppHandle,
    active_only: Option<bool>,
) -> Result<Value, String> {
    let mut args: Vec<&str> = vec!["research", "product-list", "--json"];
    if !active_only.unwrap_or(true) { args.push("--all"); } else { args.push("--active-only"); }
    run_cli(&app, args).await.map_err(err_to_string)
}

#[tauri::command]
pub async fn product_get(
    app: AppHandle,
    product_id: String,
) -> Result<Value, String> {
    run_cli(&app, vec!["research", "product-get", "--id", &product_id, "--json"])
        .await.map_err(err_to_string)
}

#[tauri::command]
pub async fn product_update(
    app: AppHandle,
    product_id: String,
    fields: serde_json::Value,
) -> Result<Value, String> {
    let fields_json = fields.to_string();
    run_cli(
        &app,
        vec!["research", "product-update", "--id", &product_id,
             "--fields", &fields_json, "--json"],
    ).await.map_err(err_to_string)
}

#[tauri::command]
pub async fn product_add_competitor(
    app: AppHandle,
    product_id: String,
    name: String,
    urls: Option<serde_json::Value>,
    category: Option<String>,
) -> Result<Value, String> {
    let urls_json = urls.map(|v| v.to_string()).unwrap_or_else(|| "{}".to_string());
    let cat = category.unwrap_or_default();
    run_cli(
        &app,
        vec!["research", "product-add-competitor", "--id", &product_id,
             "--name", &name, "--urls", &urls_json, "--category", &cat, "--json"],
    ).await.map_err(err_to_string)
}

#[tauri::command]
pub async fn product_remove_competitor(
    app: AppHandle,
    product_id: String,
    name: String,
) -> Result<Value, String> {
    run_cli(
        &app,
        vec!["research", "product-remove-competitor", "--id", &product_id,
             "--name", &name, "--json"],
    ).await.map_err(err_to_string)
}

#[tauri::command]
pub async fn product_delete(
    app: AppHandle,
    product_id: String,
) -> Result<Value, String> {
    run_cli(
        &app,
        vec!["research", "product-delete", "--id", &product_id, "--json"],
    ).await.map_err(err_to_string)
}

#[tauri::command]
pub async fn product_sweep(
    app: AppHandle,
    product_id: String,
    trigger: Option<String>,
    skip_collect: Option<bool>,
) -> Result<Value, String> {
    let t = trigger.unwrap_or_else(|| "manual".to_string());
    let flag = if skip_collect.unwrap_or(true) { "--skip-collect" } else { "--with-collect" };
    run_cli(
        &app,
        vec!["research", "product-sweep", "--id", &product_id,
             "--trigger", &t, flag, "--json"],
    ).await.map_err(err_to_string)
}

#[tauri::command]
pub async fn product_signals(
    app: AppHandle,
    product_id: String,
    since_days: Option<i64>,
    include_resolved: Option<bool>,
    limit: Option<i64>,
) -> Result<Value, String> {
    let sd = since_days.unwrap_or(7).to_string();
    let lim = limit.unwrap_or(100).to_string();
    let mut args: Vec<&str> = vec![
        "research", "product-signals", "--id", &product_id,
        "--since-days", &sd, "--limit", &lim, "--json",
    ];
    if include_resolved.unwrap_or(false) { args.push("--include-resolved"); }
    run_cli(&app, args).await.map_err(err_to_string)
}

#[tauri::command]
pub async fn product_signal_action(
    app: AppHandle,
    signal_id: String,
    action: String,
    notes: Option<String>,
    snooze_days: Option<i64>,
) -> Result<Value, String> {
    let n = notes.unwrap_or_default();
    let sd = snooze_days.unwrap_or(7).to_string();
    run_cli(
        &app,
        vec!["research", "product-signal-action", "--id", &signal_id,
             "--action", &action, "--notes", &n, "--snooze-days", &sd, "--json"],
    ).await.map_err(err_to_string)
}

#[tauri::command]
pub async fn product_digest(
    app: AppHandle,
    product_id: String,
    days: Option<i64>,
) -> Result<Value, String> {
    // Digest is plain markdown, not JSON — surface through the same
    // plain-text path as export_brief. Reusing the run_cli infrastructure
    // with tolerant parsing: sidecar emits markdown on stdout, run_cli's
    // parse_or_diagnostic wraps it in a `{_parse_error:true, _raw}` shape
    // which the frontend detects and renders as plain string.
    let d = days.unwrap_or(7).to_string();
    let out = run_cli(
        &app,
        vec!["research", "product-digest", "--id", &product_id, "--days", &d],
    ).await.map_err(err_to_string)?;
    // Return the raw string wrapped in a known shape.
    if let Some(raw) = out.get("_raw").and_then(|v| v.as_str()) {
        return Ok(serde_json::json!({"ok": true, "markdown": raw}));
    }
    // If somehow valid JSON came back, still pass through.
    Ok(out)
}

#[tauri::command]
pub async fn product_dashboard(
    app: AppHandle,
    product_id: String,
    days: Option<i64>,
) -> Result<Value, String> {
    let d = days.unwrap_or(7).to_string();
    run_cli(
        &app,
        vec!["research", "product-dashboard", "--id", &product_id,
             "--days", &d, "--json"],
    ).await.map_err(err_to_string)
}

#[tauri::command]
pub async fn product_convert_topic(
    app: AppHandle,
    topic: String,
    name: Option<String>,
    one_liner: Option<String>,
) -> Result<Value, String> {
    let n = name.unwrap_or_default();
    let ol = one_liner.unwrap_or_default();
    let mut args: Vec<&str> = vec![
        "research", "product-convert-topic", "--topic", &topic,
        "--one-liner", &ol, "--json",
    ];
    if !n.is_empty() { args.push("--name"); args.push(&n); }
    run_cli(&app, args).await.map_err(err_to_string)
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
pub async fn run_temporal_gaps(
    app: AppHandle,
    topic: String,
    force: Option<bool>,
) -> Result<Value, String> {
    // `force=true` invalidates the graph_nodes cache before re-running.
    // Default is cache-hit: subsequent tab opens return persisted rows in
    // milliseconds instead of re-calling the 30-90s LLM pass.
    let mut args: Vec<&str> = vec!["research", "temporal-gaps", "--topic", &topic, "--json"];
    if force.unwrap_or(false) {
        args.push("--force");
    }
    run_cli(&app, args).await.map_err(err_to_string)
}

/// Per-source sentiment aggregation for a topic. One LLM call per source
/// with ≥3 posts. Persists results as graph_nodes kind='source_sentiment'
/// so the UI can re-render fast on next open without re-running the LLM.
#[tauri::command]
pub async fn run_sentiment_by_source(app: AppHandle, topic: String) -> Result<Value, String> {
    run_cli(
        &app,
        vec!["research", "sentiment-by-source", "--topic", &topic, "--json"],
    )
    .await
    .map_err(err_to_string)
}

/// Concept Agent — synthesize 3-5 evidence-backed product concepts from a
/// topic's painpoints. Returns {topic, concepts, persisted, reason?}.
/// Concepts are persisted as graph_nodes kind='concept' with edges back to
/// their source painpoints so the UI can render clickable citations.
#[tauri::command]
pub async fn run_concepts(app: AppHandle, topic: String) -> Result<Value, String> {
    run_cli(
        &app,
        vec!["research", "concepts", "--topic", &topic, "--json"],
    )
    .await
    .map_err(err_to_string)
}

// ─── Paper-research (students / UX research / evidence-backed reports) ────────

#[tauri::command]
pub async fn papers_list(app: AppHandle, topic: String, limit: Option<u32>) -> Result<Value, String> {
    let lim = limit.unwrap_or(200).to_string();
    run_cli(
        &app,
        vec!["research", "papers-list", "--topic", &topic, "--limit", &lim, "--json"],
    ).await.map_err(err_to_string)
}

#[tauri::command]
pub async fn papers_export(
    app: AppHandle,
    topic: String,
    fmt: String,
    limit: Option<u32>,
) -> Result<Value, String> {
    let lim_s = limit.map(|n| n.to_string());
    let mut args: Vec<&str> = vec!["research", "papers-export",
                                    "--topic", &topic, "--fmt", &fmt, "--json"];
    if let Some(ref s) = lim_s { args.push("--limit"); args.push(s); }
    run_cli(&app, args).await.map_err(err_to_string)
}

#[tauri::command]
pub async fn oa_lookup(app: AppHandle, doi: String) -> Result<Value, String> {
    run_cli(
        &app,
        vec!["research", "oa-lookup", "--doi", &doi, "--json"],
    ).await.map_err(err_to_string)
}

// ─── Intent layer (per-topic deliverable routing) ──────────────────────────────

#[tauri::command]
pub async fn list_intents(app: AppHandle) -> Result<Value, String> {
    run_cli(&app, vec!["research", "intents", "--json"]).await.map_err(err_to_string)
}

#[tauri::command]
pub async fn topic_intent_get(app: AppHandle, topic: String) -> Result<Value, String> {
    run_cli(
        &app,
        vec!["research", "intent-get", "--topic", &topic, "--json"],
    ).await.map_err(err_to_string)
}

#[tauri::command]
pub async fn topic_intent_set(
    app: AppHandle,
    topic: String,
    intent: String,
) -> Result<Value, String> {
    run_cli(
        &app,
        vec!["research", "intent-set", "--topic", &topic, "--intent", &intent, "--json"],
    ).await.map_err(err_to_string)
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

/// Analyze a single paper (summary / relevance / builder takeaway).
#[tauri::command]
pub async fn analyze_paper(
    app: AppHandle,
    topic: String,
    post_id: String,
) -> Result<Value, String> {
    run_cli(
        &app,
        vec![
            "research", "analyze-papers",
            "--topic", &topic, "--post-id", &post_id, "--json",
        ],
    )
    .await
    .map_err(err_to_string)
}

/// Bulk-analyze every unanalyzed academic paper for a topic.
#[tauri::command]
pub async fn analyze_papers_bulk(
    app: AppHandle,
    topic: String,
    limit: Option<u32>,
) -> Result<Value, String> {
    let mut args: Vec<String> = vec![
        "research".into(), "analyze-papers".into(),
        "--topic".into(), topic.clone(),
        "--json".into(),
    ];
    if let Some(n) = limit {
        args.push("--limit".into());
        args.push(n.to_string());
    }
    let argv: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    run_cli(&app, argv).await.map_err(err_to_string)
}

/// Read all paper-analysis rows for a topic (one SELECT, no LLM).
#[tauri::command]
pub async fn paper_analyses_get(
    app: AppHandle,
    topic: String,
) -> Result<Value, String> {
    let sql =
        "SELECT pa.post_id, pa.topic, pa.summary, pa.relevance, pa.takeaway, \
         pa.ts, pa.provider, pa.model \
         FROM paper_analyses pa WHERE pa.topic = :topic";
    run_cli(
        &app,
        vec!["query", sql, "--topic", &topic, "--json"],
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

/// Soft-delete a topic (T1.3). Sets topic_prefs.deleted_at and hides the
/// topic from list_topics / the graph. Reversible via restore_topic for 7
/// days; after that purge_deleted moves it to hard-delete during a nightly
/// sweep. If the topic has no topic_prefs row (rare — graph-only topic),
/// we fall back to an immediate hard-delete since there's nowhere to stash
/// a tombstone.
#[tauri::command]
pub async fn delete_topic(app: AppHandle, topic: String) -> Result<Value, String> {
    run_cli(
        &app,
        vec!["research", "topic-soft-delete", "--topic", &topic, "--json"],
    )
    .await
    .map_err(err_to_string)
}

/// Restore a soft-deleted topic by clearing deleted_at.
#[tauri::command]
pub async fn restore_topic(app: AppHandle, topic: String) -> Result<Value, String> {
    run_cli(
        &app,
        vec!["research", "topic-restore", "--topic", &topic, "--json"],
    )
    .await
    .map_err(err_to_string)
}

/// List soft-deleted topics (within the restore window).
#[tauri::command]
pub async fn list_trash(app: AppHandle) -> Result<Value, String> {
    run_cli(&app, vec!["research", "topic-trash-list", "--json"])
        .await
        .map_err(err_to_string)
}

/// Hard-purge soft-deleted topics older than `min_age_days` (default 7).
/// Typically called from a launchd nightly sweep; exposed here for a
/// Settings "Empty trash now" button.
#[tauri::command]
pub async fn purge_deleted_topics(
    app: AppHandle,
    min_age_days: Option<i64>,
) -> Result<Value, String> {
    let d = min_age_days.unwrap_or(7).to_string();
    run_cli(
        &app,
        vec!["research", "topic-trash-purge", "--min-age-days", &d, "--json"],
    )
    .await
    .map_err(err_to_string)
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

/// Onboarding / startup diagnostics. Wraps `reddit-cli health --json` with a
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
    let trimmed = sql.trim().to_string();
    validate_read_only_sql(&trimmed)?;

    // Native SQLite path — no sidecar spawn. Opens the WAL-mode DB file
    // read-only and runs the prepared statement directly. Typical query
    // goes from 30-70s (bundled sidecar cold start on a fresh DMG) to
    // sub-10ms. See src/db.rs for the connection cache + param binding.
    let dir = crate::cli::data_dir(&app).map_err(err_to_string)?;
    let db_path = dir.join("reddit.db");
    if !db_path.exists() {
        // No DB yet — return an empty array so the UI doesn't error out
        // on a fresh install before the first collect has landed.
        return Ok(serde_json::Value::Array(vec![]));
    }

    // Build the named-params map the way Python did it: merge `--topic`
    // into `params` under key `topic`, then pass the whole thing through.
    let mut p_map: serde_json::Map<String, serde_json::Value> = serde_json::Map::new();
    if let Some(t) = topic {
        p_map.insert("topic".into(), serde_json::Value::String(t));
    }
    if let Some(extra) = params {
        for (k, v) in extra {
            p_map.insert(k, serde_json::Value::String(v));
        }
    }

    tokio::task::spawn_blocking(move || {
        let params_ref = if p_map.is_empty() { None } else { Some(&p_map) };
        crate::db::query_db(&db_path, &trimmed, params_ref)
            .map(Value::from)
    })
    .await
    .map_err(|e| format!("query task failed: {e}"))?
    .map_err(|e| e.to_string())
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

// ─── MCP ↔ App integration (one-click connect to Claude Code) ─────────────────
//
// Spec: docs/superpowers/specs/2026-04-21-mcp-app-integration.md (v1).
// We shell out to `reddit-cli mcp {install,uninstall,status} --json` so all
// the JSON-merge / token-gen / atomic-write logic stays in one place
// (src/reddit_research/mcp/install.py), testable from CLI.
//
// Two execution modes for the MCP entry's command:
//   - Dev:  if `.venv/bin/python` is found near CWD → register as
//           `uv --directory <repo> run reddit-cli mcp serve` (current dev flow).
//   - Prod: bundled binary → register the absolute path to the sidecar exe
//           inside Contents/MacOS so Claude Code spawns it directly without
//           needing `uv` on the user's PATH.

fn resolve_sidecar_bin_path() -> Option<std::path::PathBuf> {
    // In a packaged Tauri app, the sidecar lives next to the main exe in
    // Contents/MacOS/. `current_exe()` gives us the main app binary; its
    // sibling `reddit-cli` (or `reddit-cli.exe` on Windows) is the sidecar.
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    for name in ["reddit-cli", "reddit-cli.exe"] {
        let candidate = dir.join(name);
        if candidate.exists() {
            return Some(candidate);
        }
    }
    None
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

/// Check whether Gap Map is connected to the chosen MCP client and DB-aligned.
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
    run_cli(&app, arg_refs).await.map_err(err_to_string)
}

/// Connect (or re-sync) Gap Map's MCP entry in the chosen client's config.
/// Aligns REDDIT_MYIND_DATA_DIR and writes a token to the data dir.
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
    if let Some(bin) = resolve_sidecar_bin_path() {
        args.push("--bin".into());
        args.push(bin.to_string_lossy().to_string());
    } else if let Some(proj) = dev_project_dir() {
        args.push("--project-dir".into());
        args.push(proj.to_string_lossy().to_string());
    }
    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    run_cli(&app, arg_refs).await.map_err(err_to_string)
}

/// Remove Gap Map's MCP entry from the chosen client's config + delete the token.
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

// ── AG-C: global-competitors (T2.5) + finding feedback (T2.4) ─────────

/// T2.5 — Cross-topic competitor dedup. Reads product-kind graph nodes
/// across all topics and clusters them by label embedding similarity.
#[tauri::command]
pub async fn global_competitors(
    app: AppHandle,
    min_topics: Option<u32>,
    threshold: Option<f32>,
) -> Result<Value, String> {
    let mt = min_topics.unwrap_or(2).to_string();
    let th = threshold.unwrap_or(0.80).to_string();
    run_cli(
        &app,
        vec![
            "research", "global-competitors",
            "--min-topics", &mt,
            "--threshold", &th,
            "--json",
        ],
    )
    .await
    .map_err(err_to_string)
}

/// T2.4 — Persist user feedback on a finding (wrong/off_topic/spam/ok).
/// Next synthesize call for the topic splices these titles into the
/// prompt as a negative-examples block.
#[tauri::command]
pub async fn feedback_record(
    app: AppHandle,
    topic: String,
    title: String,
    kind: Option<String>,
    verdict: String,
    note: Option<String>,
) -> Result<Value, String> {
    let kind_s = kind.unwrap_or_else(|| "painpoint".into());
    let note_s = note.unwrap_or_default();
    let mut args: Vec<&str> = vec![
        "research", "feedback-record",
        "--topic", &topic,
        "--title", &title,
        "--kind", &kind_s,
        "--verdict", &verdict,
        "--json",
    ];
    if !note_s.is_empty() {
        args.push("--note");
        args.push(note_s.as_str());
    }
    run_cli(&app, args).await.map_err(err_to_string)
}

// ── AG-E: prompt overrides (T3.7) ──────────────────────────────────────
#[tauri::command]
pub async fn prompt_list(app: AppHandle) -> Result<Value, String> {
    run_cli(&app, vec!["research", "prompt-list", "--json"])
        .await
        .map_err(err_to_string)
}

#[tauri::command]
pub async fn prompt_get(app: AppHandle, key: String) -> Result<Value, String> {
    run_cli(&app, vec!["research", "prompt-get", "--key", &key, "--json"])
        .await
        .map_err(err_to_string)
}

/// Set a prompt override. `text` is the full override body; empty clears it.
#[tauri::command]
pub async fn prompt_set(app: AppHandle, key: String, text: String) -> Result<Value, String> {
    // Stream the override through a tempfile so we never pass large prompts
    // on the command line (arg-list limits on some platforms) and avoid
    // shell-quoting issues with newlines / backticks / quotes.
    use std::io::Write;
    let mut tmp = std::env::temp_dir();
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    tmp.push(format!("gapmap_prompt_{}_{}.txt", key.replace('/', "_"), ts));
    {
        let mut f = std::fs::File::create(&tmp).map_err(|e| format!("tmpfile: {e}"))?;
        f.write_all(text.as_bytes()).map_err(|e| format!("write: {e}"))?;
    }
    let tmp_s = tmp.to_string_lossy().to_string();
    let result = run_cli(
        &app,
        vec!["research", "prompt-set", "--key", &key, "--file", &tmp_s, "--json"],
    )
    .await
    .map_err(err_to_string);
    let _ = std::fs::remove_file(&tmp);
    result
}

#[tauri::command]
pub async fn prompt_clear(app: AppHandle, key: String) -> Result<Value, String> {
    run_cli(&app, vec!["research", "prompt-clear", "--key", &key, "--json"])
        .await
        .map_err(err_to_string)
}

// ── AG-E: saved views (T3.1) ──────────────────────────────────────────
#[tauri::command]
pub async fn saved_views(app: AppHandle, scope: Option<String>) -> Result<Value, String> {
    let mut args: Vec<String> = vec!["research".into(), "saved-view-list".into()];
    if let Some(s) = scope.as_ref() {
        let t = s.trim();
        if !t.is_empty() {
            args.push("--scope".into());
            args.push(t.into());
        }
    }
    args.push("--json".into());
    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    run_cli(&app, arg_refs).await.map_err(err_to_string)
}

#[tauri::command]
pub async fn saved_view_create(
    app: AppHandle,
    scope: String,
    name: String,
    filter_json: Value,
    pinned: Option<bool>,
) -> Result<Value, String> {
    let flt = serde_json::to_string(&filter_json).unwrap_or_else(|_| "{}".into());
    let mut args: Vec<String> = vec![
        "research".into(),
        "saved-view-create".into(),
        "--scope".into(),
        scope,
        "--name".into(),
        name,
        "--filter".into(),
        flt,
    ];
    if pinned.unwrap_or(false) {
        args.push("--pinned".into());
    }
    args.push("--json".into());
    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    run_cli(&app, arg_refs).await.map_err(err_to_string)
}

#[tauri::command]
pub async fn saved_view_update(
    app: AppHandle,
    id: i64,
    name: Option<String>,
    scope: Option<String>,
    filter_json: Option<Value>,
    pinned: Option<bool>,
) -> Result<Value, String> {
    let id_s = id.to_string();
    let mut args: Vec<String> = vec![
        "research".into(),
        "saved-view-update".into(),
        "--id".into(),
        id_s,
    ];
    if let Some(n) = name {
        args.push("--name".into());
        args.push(n);
    }
    if let Some(s) = scope {
        args.push("--scope".into());
        args.push(s);
    }
    if let Some(f) = filter_json {
        let flt = serde_json::to_string(&f).unwrap_or_else(|_| "{}".into());
        args.push("--filter".into());
        args.push(flt);
    }
    if let Some(p) = pinned {
        args.push(if p { "--pinned".into() } else { "--unpinned".into() });
    }
    args.push("--json".into());
    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    run_cli(&app, arg_refs).await.map_err(err_to_string)
}

#[tauri::command]
pub async fn saved_view_delete(app: AppHandle, id: i64) -> Result<Value, String> {
    let id_s = id.to_string();
    run_cli(
        &app,
        vec!["research", "saved-view-delete", "--id", &id_s, "--json"],
    )
    .await
    .map_err(err_to_string)
}

// ── AG-D: CSV ingest ──
/// Bulk-ingest a structured CSV into a topic corpus.
///
/// Expected headers: `post_id,title,body,author,url,created_utc,source_type`.
/// Missing columns are tolerated except `title`. Delegates to the Python
/// `research ingest-csv` subcommand, which runs the relevance gate via
/// `_tag_posts`. Returns the JSON envelope the Python side emits:
/// `{ok, parsed, skipped, tagged, dry_run, path, topic}`.
#[tauri::command]
pub async fn ingest_csv_file(
    app: AppHandle,
    topic: String,
    path: String,
) -> Result<Value, String> {
    run_cli(
        &app,
        vec![
            "research", "ingest-csv",
            "--path", &path,
            "--topic", &topic,
            "--source", "csv",
            "--json",
        ],
    )
    .await
    .map_err(err_to_string)
}

// ─── Task 8 — saturation v1 + coverage gaps panel ──────────────────────────

/// Saturation metric v1 — distinct graph clusters per last 50 posts.
/// Pure SQL; no LLM. Returns `{score, hint, new_clusters_last_50_posts,
/// window_start}` where hint ∈ rich | converging | saturated.
#[tauri::command]
pub async fn topic_saturation(app: AppHandle, topic: String) -> Result<Value, String> {
    run_cli(
        &app,
        vec!["research", "saturation", "--topic", &topic, "--json"],
    )
    .await
    .map_err(err_to_string)
}

/// Coverage gap analyzer — which data dimensions are underrepresented.
/// Returns `{total_posts, by_source, gaps: [...]}` where each gap has
/// `suggested_sources` the UI turns into one-click "+ Add X" buttons.
#[tauri::command]
pub async fn topic_coverage_gaps(app: AppHandle, topic: String) -> Result<Value, String> {
    run_cli(
        &app,
        vec!["research", "coverage-gaps", "--topic", &topic, "--json"],
    )
    .await
    .map_err(err_to_string)
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

