//! Tauri commands invoked from the frontend via `invoke(...)`.
//!
//! Each command is a thin bridge to one gapmap invocation. Heavy
//! lifting stays in Python.

use crate::cli::{
    cancel_active_chat, cancel_active_enrich, cancel_active_job, cancel_active_stream, data_dir,
    run_cli, run_cli_chat_streaming, run_cli_enrich_streaming, run_cli_stream_streaming,
    run_cli_streaming, ActiveChat, ActiveChatPid, ActiveJob, ActiveJobPid, ActiveStream,
    ActiveStreamPid,
};
use tauri::{Emitter, Listener};
use serde_json::Value;
use tauri::{AppHandle, Manager};
use sha2::{Digest, Sha256};
use uuid::Uuid;
use jsonwebtoken::{decode, Algorithm, DecodingKey, Validation};
// NOTE: `keyring::Entry` intentionally removed 2026-04-24. Keychain storage
// caused macOS to prompt for the login password on every dev rebuild (code-sign
// identity changes invalidate the ACL of the `gapmap-license` keychain item,
// so `security` asks the user to unlock it again). Switched to a file-based
// token store in the app's data dir (0600 perms, same as `device_id`). Less
// defensive against local disk compromise than Keychain, but the threat model
// here (user's own Mac, token is a 180d JWT that can be revoked server-side
// via `/v1/license/revoke`) makes the UX trade worth it.

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct LicenseState {
    api_base: String,
    email: String,
    license_id: String,
    activation_key: String,
    device_signature: String,
    access_token: String,
    user_id: Option<String>,
    expires_at: Option<String>,
    last_verified_at: Option<String>,
}

// Filename inside data_dir that holds the activation JWT. 0600 perms on Unix.
// Parallel with `device_id` (also a plain file in the same directory).
const LICENSE_TOKEN_FILE: &str = "license_token";

// In-process cache of the activation JWT. Exists purely to collapse repeated
// keychain reads down to one per app launch. Without this, every Settings
// page load + every `mcp_*` command fires its own `read_access_token()` →
// macOS shows its "gapmap wants to read …" prompt every time the current
// binary's code signature doesn't match the item's ACL (which is ~every
// dev rebuild). Feels like a privacy breach even though we're always
// reading the same one string.
//
// Semantics:
//   `None`          → never attempted a read in this process yet.
//   `Some(None)`    → read returned empty / entry missing — negative cache
//                     so we don't re-prompt for a user who simply hasn't
//                     activated yet.
//   `Some(Some(t))` → last known token value.
//
// Invalidation: `save_access_token` re-seeds the cache with the fresh value.
// `clear_access_token` flips it to `Some(None)`. There is no time-based
// expiry — the JWT's own `expires_at` is the authoritative expiry (checked
// by `compute_activation_reason`).
use std::sync::Mutex;
static TOKEN_CACHE: Mutex<Option<Option<String>>> = Mutex::new(None);

#[derive(Debug, Clone, serde::Deserialize)]
struct VerifiedTokenClaims {
    device_fingerprint: Option<String>,
}

fn err_to_string<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

fn sanitize_export_file_stem(topic: &str) -> String {
    topic
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string()
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

/// `gapmap info` — config + table counts.
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

/// Per-topic graph coverage — how many of each node + edge kind exist, plus
/// the source_type breakdown for posts. Powers the "Gap Map coverage" card
/// on the topic page so users see the full pipeline output at a glance
/// (posts → painpoints → mechanisms → interventions → evidence_papers →
///  concepts, and every relation type between them).
#[tauri::command]
pub async fn topic_graph_summary(app: AppHandle, topic: String) -> Result<Value, String> {
    // Three queries instead of one so each subquery can be read independently
    // by callers and the JS side doesn't have to parse a hand-rolled payload.
    let nodes_sql = format!(
        "SELECT kind, count(*) AS c FROM graph_nodes WHERE topic = '{t}' \
         GROUP BY kind ORDER BY count(*) DESC",
        t = topic.replace('\'', "''"),
    );
    let edges_sql = format!(
        "SELECT kind, count(*) AS c FROM graph_edges WHERE topic = '{t}' \
         GROUP BY kind ORDER BY count(*) DESC",
        t = topic.replace('\'', "''"),
    );
    let sources_sql = format!(
        "SELECT coalesce(p.source_type,'reddit') AS source_type, count(*) AS c \
         FROM posts p JOIN topic_posts tp ON tp.post_id = p.id \
         WHERE tp.topic = '{t}' GROUP BY p.source_type ORDER BY count(*) DESC",
        t = topic.replace('\'', "''"),
    );

    let nodes = native_query(&app, &nodes_sql).await?;
    let edges = native_query(&app, &edges_sql).await?;
    let sources = native_query(&app, &sources_sql).await?;

    Ok(serde_json::json!({
        "topic":   topic,
        "nodes":   nodes,
        "edges":   edges,
        "sources": sources,
    }))
}

/// Native-SQLite helper — same fallback shape as `run_query` (empty array
/// if DB doesn't exist yet) but without the read-only SQL validator (these
/// queries are hardcoded string literals above, not user-supplied).
async fn native_query(app: &AppHandle, sql: &str) -> Result<Value, String> {
    let dir = crate::cli::data_dir(app).map_err(err_to_string)?;
    let db_path = dir.join("gapmap.db");
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

/// Canonicalize a topic — returns the corrected canonical form, variants,
/// confidence, and the LLM-scored keyword fan-out that `start_collect`
/// will use. Cached per-topic; uncached takes ~1 LLM call (~400 tokens).
///
/// Drives the Collect screen's "Searching for…" strip so users can see
/// the expanded synonyms (e.g. "public speaking anxiety app" → also
/// searches "confident speaking", "speaking tricks", …) and the
/// "Did you mean…?" modal when confidence is low.
#[tauri::command]
pub async fn canonicalize_topic(app: AppHandle, topic: String) -> Result<Value, String> {
    run_cli(
        &app,
        vec!["research", "canonicalize", "--topic", &topic, "--json"],
    )
    .await
    .map_err(err_to_string)
}

/// Build the CLI args vector for a topic collect. Pulled out of
/// `start_collect` so the queue dequeue path can replay the same args
/// shape without duplicating the assembly.
fn build_collect_args(
    topic: &str,
    aggressive: bool,
    sources: Option<&str>,
    skip_reddit: bool,
) -> Vec<String> {
    let mut args: Vec<String> = vec![
        "research".into(),
        "collect".into(),
        "--topic".into(),
        topic.into(),
    ];
    if aggressive {
        args.push("--aggressive".into());
    }
    if let Some(s) = sources {
        let trimmed = s.trim();
        if !trimmed.is_empty() {
            args.push("--sources".into());
            args.push(trimmed.into());
        }
    }
    if skip_reddit {
        args.push("--skip-reddit".into());
    }
    // The desktop app always skips the CLI's legacy inline LLM extraction
    // pass. Incremental extraction runs in a separate long-lived worker
    // process — leaving the inline pass on would block `collect:done` for
    // minutes on aggressive collects.
    args.push("--skip-extraction".into());
    args
}

/// True when a collect sidecar is currently holding the single-flight slot.
fn is_collect_running(app: &AppHandle) -> bool {
    use crate::cli::{ActiveJob, ActiveJobPid};
    if let Some(s) = app.try_state::<ActiveJob>() {
        if s.0.lock().ok().map(|g| g.is_some()).unwrap_or(false) {
            return true;
        }
    }
    if let Some(s) = app.try_state::<ActiveJobPid>() {
        if s.0.lock().ok().map(|g| g.is_some()).unwrap_or(false) {
            return true;
        }
    }
    false
}

/// Pop the next queued collect (if any) and spawn it. Called automatically
/// after `collect:done` fires. Spawned via `tauri::async_runtime::spawn` so
/// it never blocks the listener that triggered it.
fn drain_collect_queue(app: &AppHandle) {
    use crate::cli::CollectQueue;

    // Bail if a collect is somehow still running — we don't want to overlap
    // sidecars even if the queue trigger races.
    if is_collect_running(app) {
        return;
    }
    let next = {
        let queue_arc = match app.try_state::<CollectQueue>() {
            Some(s) => s.0.clone(),
            None => return,
        };
        let mut q = match queue_arc.lock() {
            Ok(g) => g,
            Err(_) => return,
        };
        q.pop_front()
    };
    if let Some(qc) = next {
        let app_clone = app.clone();
        let topic = qc.topic.clone();
        let args = qc.args.clone();
        // Notify UI that we transitioned a queued item into running.
        let _ = app.emit(
            "collect:queue:dequeued",
            serde_json::json!({ "topic": topic, "queued_at": qc.queued_at }),
        );
        tauri::async_runtime::spawn(async move {
            let _ = run_collect_inner(app_clone, topic, args).await;
        });
    }
}

/// Inner runner shared by `start_collect` and the queue drain. Spawns the
/// sidecar via `run_cli_streaming`, manages the `ActiveCollects` map, and
/// drains the queue on completion.
///
/// **Lifecycle gotcha:** `run_cli_streaming` is *fire-and-forget* — it
/// spawns the streaming task and returns `Ok(())` as soon as the child
/// process is alive. It does NOT await sidecar termination. The previous
/// implementation cleaned up `ActiveCollects` and unlistened immediately
/// after this `await`, which left the slot held + the topic map empty
/// for the entire duration of the collect — exactly the orphan state the
/// busy modal then surfaces, and what the periodic sweeper interprets as
/// "kill this dead process". Net effect: every collect was self-killing
/// itself within ~8 s of starting.
///
/// Fix: register a one-shot `collect:done` listener that does the
/// cleanup when the sidecar actually terminates. `once_any` auto-
/// unregisters after the first fire so it doesn't leak across repeated
/// collects.
async fn run_collect_inner(
    app: AppHandle,
    topic: String,
    args: Vec<String>,
) -> Result<Value, String> {
    use crate::cli::ActiveCollects;

    let active_arc = {
        let state = app.state::<ActiveCollects>();
        state.0.clone()
    };

    let now_secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    {
        let mut map = active_arc.lock().map_err(|e| e.to_string())?;
        map.insert(topic.clone(), now_secs);
    }

    // One-shot cleanup. Fires when the sidecar actually emits `collect:done`
    // (i.e., the streaming task observed `Terminated`), which is the only
    // moment we know the slot will be released — `run_cli_streaming` itself
    // doesn't wait for that. Both `ActiveCollects` removal and the queue
    // drain live here so they fire in the right order regardless of how
    // long the sidecar runs.
    let active_for_listener = active_arc.clone();
    let topic_for_listener = topic.clone();
    let app_for_listener = app.clone();
    app.once_any("collect:done", move |_event| {
        if let Ok(mut map) = active_for_listener.lock() {
            map.remove(&topic_for_listener);
        }
        drain_collect_queue(&app_for_listener);
    });

    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let stream_result =
        run_cli_streaming(&app, arg_refs, "collect:progress", "collect:done").await;

    // If the spawn itself failed, `collect:done` will never fire — we have
    // to clean up synchronously here instead. The one-shot listener is
    // harmless in that case (it'll just sit waiting for an event that
    // never arrives, and Tauri will GC it on app shutdown).
    if stream_result.is_err() {
        if let Ok(mut map) = active_arc.lock() {
            map.remove(&topic);
        }
        drain_collect_queue(&app);
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
#[tauri::command]
pub async fn start_collect(
    app: AppHandle,
    topic: String,
    aggressive: bool,
    sources: Option<String>,
    skip_reddit: Option<bool>,
    if_busy: Option<String>,
) -> Result<Value, String> {
    use crate::cli::{ActiveCollects, CollectQueue};

    let policy = if_busy.as_deref().unwrap_or("error");

    let active_arc = {
        let state = app.state::<ActiveCollects>();
        state.0.clone()
    };

    // Same-topic dedup — never spawn a duplicate sidecar for the SAME topic.
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

    let args = build_collect_args(
        &topic,
        aggressive,
        sources.as_deref(),
        skip_reddit.unwrap_or(false),
    );

    // Orphan auto-reap. The single-flight slot can end up "held" with no
    // matching entry in `ActiveCollects` when a prior sidecar dies without
    // its `Terminated` event ever reaching us (panic between writes, hard
    // SIGKILL by the OS, dev HMR rebuild that drops the listener mid-flight).
    // Symptoms in the UI: the busy modal shows "(orphan sidecar — name
    // unavailable)" with "unknown elapsed". Queueing waits forever because
    // `collect:done` never fires; the user has to click "Stop and start" on a
    // process that's already dead. Detect-and-reap here so the modal never
    // surfaces in that state — if the slot is held but the topic map is
    // empty, drop the slot (best-effort kill is idempotent if already dead).
    {
        let map_empty = active_arc.lock().map_err(|e| e.to_string())?.is_empty();
        if map_empty && is_collect_running(&app) {
            // Silent kill — the orphan reap is a maintenance action, not
            // a user cancellation. Using the loud variant would set the
            // cancel marker, which would then mislabel THIS new collect's
            // eventual exit as "cancelled by user".
            let _ = crate::cli::cancel_active_job_silent(&app);
            let _ = app.emit(
                "collect:orphan:reaped",
                serde_json::json!({ "trigger": "start_collect" }),
            );
        }
    }

    // If something else is running, branch on the policy.
    if is_collect_running(&app) {
        // Get the running topic + its started_at for blocked_by metadata.
        let entry = {
            let map = active_arc.lock().map_err(|e| e.to_string())?;
            map.iter().next().map(|(k, v)| (k.clone(), *v))
        };
        let now_secs = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        // When the slot is held but the topic map is empty (orphan / HMR
        // restart), don't compute elapsed off started_at=0 — that yielded
        // ~1.7 billion seconds = "29 million minutes". Use 0 as a sentinel
        // and let the frontend show "(unknown)" without bogus minutes.
        let (running_topic, running_started, elapsed) = match entry {
            Some((topic, started)) => (topic, started, now_secs.saturating_sub(started)),
            None => ("(unknown — sidecar still alive)".into(), 0u64, 0u64),
        };

        match policy {
            "queue" => {
                let queue_arc = {
                    let st = app.state::<CollectQueue>();
                    st.0.clone()
                };
                let queued_at = now_secs;
                let position = {
                    let mut q = queue_arc.lock().map_err(|e| e.to_string())?;
                    // Reject duplicate-in-queue too, so the user can't
                    // accidentally enqueue the same topic twice.
                    if q.iter().any(|x| x.topic == topic) {
                        return Ok(serde_json::json!({
                            "ok": true,
                            "queued": true,
                            "already_queued": true,
                            "topic": topic,
                            "blocked_by": {
                                "topic": running_topic,
                                "started_at": running_started,
                                "elapsed_secs": elapsed,
                            },
                        }));
                    }
                    q.push_back(crate::cli::QueuedCollect {
                        topic: topic.clone(),
                        args: args.clone(),
                        queued_at,
                    });
                    q.len()
                };
                let _ = app.emit("collect:queue:enqueued",
                    serde_json::json!({ "topic": topic, "position": position }));
                return Ok(serde_json::json!({
                    "ok": true,
                    "queued": true,
                    "position": position,
                    "topic": topic,
                    "queued_at": queued_at,
                    "blocked_by": {
                        "topic": running_topic,
                        "started_at": running_started,
                        "elapsed_secs": elapsed,
                    },
                }));
            }
            "cancel_and_start" => {
                // Kill the running sidecar. cancel_active_job emits
                // `collect:done` (with code=-1) via the streaming hook, which
                // unblocks any UI listener AND clears the active map.
                let prior = running_topic.clone();
                crate::cli::cancel_active_job(&app);
                // Tiny grace so the prior `collect:done` listener gets to
                // remove `prior` from `ActiveCollects` before we insert ours.
                tokio::time::sleep(std::time::Duration::from_millis(150)).await;
                // Spawn the new one in the background so we don't block this
                // command. UI is already subscribed to collect:progress.
                let app_clone = app.clone();
                let topic_for_spawn = topic.clone();
                let args_for_spawn = args.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = run_collect_inner(app_clone, topic_for_spawn, args_for_spawn).await;
                });
                return Ok(serde_json::json!({
                    "ok": true,
                    "started": true,
                    "cancelled": prior,
                    "topic": topic,
                }));
            }
            _ /* "error" */ => {
                return Ok(serde_json::json!({
                    "ok": false,
                    "blocked": true,
                    "topic": topic,
                    "blocked_by": {
                        "topic": running_topic,
                        "started_at": running_started,
                        "elapsed_secs": elapsed,
                    },
                }));
            }
        }
    }

    // Nothing running — straight path.
    run_collect_inner(app, topic, args).await
}

/// Catalog of external sources the Python `research collect` will sweep.
/// Mirrors the lists in `src/gapmap/research/collect.py` so the
/// "topic recon" card on the collect screen can preview the exact set
/// that's about to be queried — without spinning up the sidecar first.
///
/// `aggressive=true` returns the 15-source aggressive sweep; otherwise
/// the 8-source quick default.
///
/// Each entry: { id, label, kind: "external", default_aggressive,
/// default_quick }. The frontend matches `id` against the sidecar's
/// `[src] …` progress lines to flip a chip from "queued" → "fetched".
#[tauri::command]
pub async fn collect_source_catalog(aggressive: bool) -> Result<Vec<Value>, String> {
    // (id, label, in_aggressive_default, in_quick_default)
    // Order matches collect.py for visual consistency.
    let all: &[(&str, &str, bool, bool)] = &[
        ("hn",            "Hacker News",         true,  true),
        ("appstore",      "App Store",           true,  false),
        ("playstore",     "Play Store",          true,  false),
        ("trustpilot",    "Trustpilot",          true,  false),
        ("producthunt",   "Product Hunt",        true,  false),
        ("rss_products",  "RSS — Products",      true,  true),
        ("rss_tech_news", "RSS — Tech News",     true,  true),
        ("arxiv",         "arXiv",               true,  true),
        ("openalex",      "OpenAlex",            true,  false),
        ("pubmed",        "PubMed",              true,  false),
        ("gnews",         "Google News",         true,  true),
        ("devto",         "Dev.to",              true,  true),
        ("stackoverflow", "Stack Overflow",      true,  true),
        ("github",        "GitHub Trending",     true,  true),
        ("trends",        "Google Trends",       true,  false),
        // Opt-in (only included when explicitly requested via --sources):
        ("alternativeto", "AlternativeTo",       false, false),
        ("lemmy",         "Lemmy",               false, false),
        ("mastodon",      "Mastodon",            false, false),
        ("github_issues", "GitHub Issues",       false, false),
        ("youtube",       "YouTube",             false, false),
        ("scholar",       "Google Scholar",      false, false),
    ];

    let out: Vec<Value> = all.iter()
        .filter(|(_, _, ag, qk)| if aggressive { *ag } else { *qk })
        .map(|(id, label, ag, qk)| serde_json::json!({
            "id": id,
            "label": label,
            "kind": "external",
            "default_aggressive": ag,
            "default_quick": qk,
        }))
        .collect();
    Ok(out)
}

/// List the pending collect queue (FIFO order).
/// Used by the status bar to render "+ N queued: A, B".
#[tauri::command]
pub async fn list_collect_queue(app: AppHandle) -> Result<Vec<Value>, String> {
    use crate::cli::CollectQueue;
    let arc = {
        let state = app.state::<CollectQueue>();
        state.0.clone()
    };
    let q = arc.lock().map_err(|e| e.to_string())?;
    Ok(q.iter()
        .map(|qc| serde_json::json!({
            "topic": qc.topic,
            "queued_at": qc.queued_at,
        }))
        .collect())
}

/// Remove a queued collect by topic. Returns true if it was found.
/// Use this to cancel a queued item before it ever starts.
#[tauri::command]
pub async fn cancel_queued_collect(app: AppHandle, topic: String) -> Result<bool, String> {
    use crate::cli::CollectQueue;
    let arc = {
        let state = app.state::<CollectQueue>();
        state.0.clone()
    };
    let mut q = arc.lock().map_err(|e| e.to_string())?;
    let before = q.len();
    q.retain(|qc| qc.topic != topic);
    let removed = q.len() < before;
    drop(q);
    if removed {
        let _ = app.emit("collect:queue:cancelled", serde_json::json!({ "topic": topic }));
    }
    Ok(removed)
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
/// Maximum age of a graph-op inflight key before it's considered stale.
/// An enrich on a 7k-post topic with Ollama can take 3-4 min, so this has
/// to be generous — but not so long that a crashed sidecar strands the
/// user for hours. 10 min is the observed max + buffer.
const GRAPH_OP_STALE_AFTER: std::time::Duration = std::time::Duration::from_secs(600);

async fn run_graph_op_deduped(
    app: &AppHandle,
    op: &str,
    topic: &str,
    args: Vec<&str>,
) -> Result<Value, String> {
    use crate::cli::ActiveGraphOps;
    let key = format!("{}:{}", op, topic);
    let state = app.state::<ActiveGraphOps>();

    // Try to insert the key. If it's already there AND still fresh, another
    // call really is in flight → return `already_running`. If the existing
    // entry is older than GRAPH_OP_STALE_AFTER, assume the previous sidecar
    // crashed without removing its key (seen when Ollama hangs + the user
    // kills -9 the dev server) and reclaim it.
    {
        let mut map = state.0.lock().map_err(|e| e.to_string())?;
        let now = std::time::Instant::now();
        if let Some(inserted_at) = map.get(&key) {
            let age = now.saturating_duration_since(*inserted_at);
            if age < GRAPH_OP_STALE_AFTER {
                let remaining = GRAPH_OP_STALE_AFTER.saturating_sub(age).as_secs();
                return Ok(serde_json::json!({
                    "ok": false,
                    "already_running": true,
                    "topic": topic,
                    "op": op,
                    "age_seconds": age.as_secs(),
                    "auto_clears_in_seconds": remaining,
                    "reason": format!(
                        "A {} for topic {:?} is already running (started {}s ago). It will auto-clear in {}s if truly stuck, or click Unstick to force-clear now.",
                        op, topic, age.as_secs(), remaining
                    ),
                }));
            }
            // Stale — fall through to reclaim.
        }
        map.insert(key.clone(), now);
    }

    // Run the job. Scope exit removes the key on success OR error — kept
    // inline rather than via Drop because async drop order around `?` is
    // finicky.
    let result = run_cli(app, args).await.map_err(err_to_string);
    {
        if let Ok(mut map) = state.0.lock() {
            map.remove(&key);
        }
    }
    result
}

/// Force-clear in-flight graph-op locks. Escape hatch for when
/// `run_graph_op_deduped`'s staleness check hasn't fired yet but the user
/// is certain nothing is actually running (e.g. they quit the dev server
/// mid-enrich and restarted). Accepts optional `topic` + `op` filter;
/// omit both to clear everything. Returns the list of cleared keys.
#[tauri::command]
pub async fn clear_graph_inflight(
    app: AppHandle,
    topic: Option<String>,
    op: Option<String>,
) -> Result<Value, String> {
    use crate::cli::ActiveGraphOps;
    let state = app.state::<ActiveGraphOps>();
    let mut map = state.0.lock().map_err(|e| e.to_string())?;
    let to_remove: Vec<String> = map
        .keys()
        .filter(|k| {
            match (&op, &topic) {
                (Some(o), Some(t)) => k.as_str() == format!("{}:{}", o, t),
                (Some(o), None)    => k.starts_with(&format!("{}:", o)),
                (None,    Some(t)) => k.ends_with(&format!(":{}", t)),
                (None,    None)    => true,
            }
        })
        .cloned()
        .collect();
    for k in &to_remove {
        map.remove(k);
    }
    Ok(serde_json::json!({
        "ok": true,
        "cleared": to_remove,
        "cleared_count": to_remove.len(),
    }))
}

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
#[tauri::command]
pub async fn cancel_enrich_for_topic(
    app: AppHandle,
    topic: Option<String>,
) -> Result<Value, String> {
    use crate::cli::ActiveGraphOps;

    let killed = cancel_active_enrich(&app);

    // Free the per-topic lock. When `topic` is None, clear every `enrich:*`
    // key (matches the existing `clear_graph_inflight` semantics for the
    // op-only filter). The common UI path passes the specific topic.
    let mut cleared: Vec<String> = Vec::new();
    if let Some(state) = app.try_state::<ActiveGraphOps>() {
        let mut map = state.0.lock().map_err(|e| e.to_string())?;
        let to_remove: Vec<String> = map
            .keys()
            .filter(|k| match &topic {
                Some(t) => k.as_str() == format!("enrich:{}", t),
                None => k.starts_with("enrich:"),
            })
            .cloned()
            .collect();
        for k in &to_remove {
            map.remove(k);
        }
        cleared = to_remove;
    }

    Ok(serde_json::json!({
        "ok": true,
        "killed": killed,
        "cleared": cleared,
    }))
}

/// Snapshot of current memory + state-slot sizes across the Rust process and
/// any tracked sidecar children. Plumbed for diagnosing the "memory grows
/// exponentially / app hangs" reports — call from DevTools console
/// (`window.__gapmapMemStats()`) to see which layer is bloating.
///
/// Returns:
///   - `rust_pid` / `rust_rss_mb`: this Tauri host process.
///   - `sidecar_*`: rss + pid of the longest-lived sidecar slots if non-empty.
///   - `slots`: live count of each Active* state map (large counts mean a
///     stuck dedup key — typical hang cause).
///
/// Implemented via `ps -o rss=,vsz= -p <pid>` so we don't pull in `libc` or
/// a sysinfo crate just for a debug helper. RSS is reported in MB (rounded).
#[tauri::command]
pub async fn mem_stats(app: AppHandle) -> Result<Value, String> {
    use crate::cli::{
        ActiveChat, ActiveChatPid, ActiveCollects, ActiveEnrich, ActiveEnrichPid,
        ActiveGraphOps, ActiveJob, ActiveJobPid, ActiveStream, ActiveStreamPid,
    };

    fn rss_mb_of(pid: u32) -> Option<u64> {
        // `ps -o rss= -p PID` — RSS in KB on both macOS and Linux. Empty
        // stdout means the process exited; treat as None.
        let out = std::process::Command::new("ps")
            .args(["-o", "rss=", "-p", &pid.to_string()])
            .output()
            .ok()?;
        let s = String::from_utf8_lossy(&out.stdout);
        let kb: u64 = s.trim().parse().ok()?;
        Some(kb / 1024)
    }

    let own_pid = std::process::id();
    let own_rss = rss_mb_of(own_pid);

    // Slot sizes — reading these without spawning any sidecar so the
    // command is safe to call from a hot button without thrashing.
    let job_running = app.try_state::<ActiveJob>()
        .and_then(|s| s.0.lock().ok().map(|g| g.is_some())).unwrap_or(false);
    let chat_running = app.try_state::<ActiveChat>()
        .and_then(|s| s.0.lock().ok().map(|g| g.is_some())).unwrap_or(false);
    let stream_running = app.try_state::<ActiveStream>()
        .and_then(|s| s.0.lock().ok().map(|g| g.is_some())).unwrap_or(false);
    let enrich_running = app.try_state::<ActiveEnrich>()
        .and_then(|s| s.0.lock().ok().map(|g| g.is_some())).unwrap_or(false);

    let job_pid = app.try_state::<ActiveJobPid>()
        .and_then(|s| s.0.lock().ok().and_then(|g| *g));
    let chat_pid = app.try_state::<ActiveChatPid>()
        .and_then(|s| s.0.lock().ok().and_then(|g| *g));
    let stream_pid = app.try_state::<ActiveStreamPid>()
        .and_then(|s| s.0.lock().ok().and_then(|g| *g));
    let enrich_pid = app.try_state::<ActiveEnrichPid>()
        .and_then(|s| s.0.lock().ok().and_then(|g| *g));

    let active_collects: Vec<String> = app.try_state::<ActiveCollects>()
        .and_then(|s| s.0.lock().ok().map(|g| g.keys().cloned().collect()))
        .unwrap_or_default();
    // Each entry is `(op:topic, instant_inserted)` — we expose just the keys
    // so the UI can show "5 stuck enrich locks" if any. Ages are inferred
    // client-side from the count + timestamps if needed; surface count here.
    let graph_inflight_keys: Vec<String> = app.try_state::<ActiveGraphOps>()
        .and_then(|s| s.0.lock().ok().map(|g| g.keys().cloned().collect()))
        .unwrap_or_default();

    let mut sidecar_pids: Vec<(String, u32, Option<u64>)> = Vec::new();
    if let Some(p) = job_pid    { sidecar_pids.push(("collect".into(),    p, rss_mb_of(p))); }
    if let Some(p) = chat_pid   { sidecar_pids.push(("chat".into(),       p, rss_mb_of(p))); }
    if let Some(p) = stream_pid { sidecar_pids.push(("stream".into(),     p, rss_mb_of(p))); }
    if let Some(p) = enrich_pid { sidecar_pids.push(("enrich".into(),     p, rss_mb_of(p))); }

    Ok(serde_json::json!({
        "rust_pid": own_pid,
        "rust_rss_mb": own_rss,
        "slots": {
            "active_job_running":     job_running,
            "active_chat_running":    chat_running,
            "active_stream_running":  stream_running,
            "active_enrich_running":  enrich_running,
            "active_collects":        active_collects,
            "graph_inflight_keys":    graph_inflight_keys,
            "graph_inflight_count":   graph_inflight_keys.len(),
        },
        "sidecars": sidecar_pids.into_iter().map(|(name, pid, rss)| serde_json::json!({
            "name": name, "pid": pid, "rss_mb": rss,
        })).collect::<Vec<_>>(),
        "captured_at": std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs()).unwrap_or(0),
    }))
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
#[tauri::command]
pub async fn enrich_graph_stream(
    app: AppHandle,
    topic: String,
    only: Option<String>,
    parallel: Option<bool>,
) -> Result<Value, String> {
    use crate::cli::ActiveGraphOps;

    // Reclaim stale + check in-flight. Same policy as run_graph_op_deduped
    // but we can't use that helper directly — it awaits run_cli to completion
    // and expects a synchronous JSON return, whereas we're firing up a
    // streaming sidecar and returning immediately.
    let key = format!("enrich:{}", topic);
    {
        let state = app.state::<ActiveGraphOps>();
        let mut map = state.0.lock().map_err(|e| e.to_string())?;
        let now = std::time::Instant::now();
        if let Some(inserted_at) = map.get(&key) {
            let age = now.saturating_duration_since(*inserted_at);
            let stale_after = std::time::Duration::from_secs(600);
            if age < stale_after {
                let remaining = stale_after.saturating_sub(age).as_secs();
                return Ok(serde_json::json!({
                    "ok": false,
                    "already_running": true,
                    "topic": topic,
                    "op": "enrich",
                    "age_seconds": age.as_secs(),
                    "auto_clears_in_seconds": remaining,
                    "reason": format!(
                        "An enrich for topic {:?} is already running (started {}s ago). Subscribe to enrich:progress to watch it.",
                        topic, age.as_secs()
                    ),
                }));
            }
        }
        map.insert(key.clone(), now);
    }

    // Build the argv. Keep `--stream` AFTER `--topic`/`--limit` so the
    // typer parser sees the flags in the same shape as the non-stream path
    // (no order dependency in typer, but readable).
    let mut args: Vec<&str> = vec![
        "research", "graph", "enrich",
        "--topic", &topic,
        "--stream",
        // Always emit JSON payloads to stdout — `--json` is a no-op in
        // stream mode (the `_emit` at the bottom is skipped when streaming)
        // but passing it keeps the CLI call shape consistent with the
        // non-stream variant so logs line up.
        "--json",
    ];
    let only_lc: String;
    if let Some(o) = only.as_deref() {
        if !o.is_empty() {
            only_lc = o.to_lowercase();
            args.push("--only");
            args.push(&only_lc);
        }
    }
    if parallel.unwrap_or(false) {
        args.push("--parallel");
    }

    // The streaming helper returns as soon as the sidecar is spawned. The
    // `enrich:progress` / `enrich:stream:done` events fire asynchronously
    // from background tokio tasks. We register a listener that clears the
    // dedup key when the done event arrives AND auto-unlistens itself —
    // without the unlisten-in-closure, each streaming call would permanently
    // leak another handler, so after a few hundred enriches the cleanup fan
    // would fire hundreds of times per done event. See the analogous
    // pattern in `start_collect` above.
    let app_for_cleanup = app.clone();
    let key_for_cleanup = key.clone();
    let unlisten_slot: std::sync::Arc<std::sync::Mutex<Option<tauri::EventId>>> =
        std::sync::Arc::new(std::sync::Mutex::new(None));
    let unlisten_slot_for_closure = unlisten_slot.clone();
    let unlisten_id = app.listen_any("enrich:stream:done", move |_ev| {
        if let Some(state) = app_for_cleanup.try_state::<ActiveGraphOps>() {
            if let Ok(mut m) = state.0.lock() {
                m.remove(&key_for_cleanup);
            }
        }
        // Self-unlisten so the handler is gone before the next enrich call
        // registers its own. `take()` ensures the unlisten happens once
        // even if multiple done events ever fire.
        if let Ok(mut slot) = unlisten_slot_for_closure.lock() {
            if let Some(id) = slot.take() {
                app_for_cleanup.unlisten(id);
            }
        }
    });
    if let Ok(mut slot) = unlisten_slot.lock() {
        *slot = Some(unlisten_id);
    }

    let spawn_result = run_cli_enrich_streaming(
        &app, args, "enrich:progress", "enrich:stream:done",
    )
    .await;

    // If the spawn itself failed (binary missing, fork failed, dev python
    // not found) the `enrich:stream:done` event will never fire — that's
    // the cleanup leak. Clear the inflight key NOW so a follow-up call
    // doesn't get stuck for 10 minutes waiting for the stale-after timer.
    // The listener registered above is also still alive; it'll harmlessly
    // no-op on the (now absent) key when whatever future done event fires.
    if let Err(ref e) = spawn_result {
        let state = app.state::<ActiveGraphOps>();
        if let Ok(mut map) = state.0.lock() {
            map.remove(&key);
        }
        return Err(err_to_string(e.to_string()));
    }
    drop(spawn_result);  // suppress unused warning on Ok branch

    Ok(serde_json::json!({
        "ok": true,
        "streaming": true,
        "topic": topic,
        "only": only,
        "parallel": parallel.unwrap_or(false),
        "progress_event": "enrich:progress",
        "done_event": "enrich:stream:done",
    }))
}

/// Build dense relation edges between semantic findings (relates_to /
/// potentially_solves / could_address / co_evidenced). Safe to call repeatedly;
/// graph_edges upserts keep this idempotent.
#[tauri::command]
pub async fn relate_graph(app: AppHandle, topic: String) -> Result<Value, String> {
    run_graph_op_deduped(
        &app,
        "relate",
        &topic,
        vec!["research", "graph", "relate", "--topic", &topic, "--json"],
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
    let py = std::env::var("GAPMAP_DEV_PYTHON").ok().and_then(|p| {
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
            .arg("-m").arg("gapmap.cli.main")
            .arg("research").arg("export-brief")
            .arg("--topic").arg(&topic)
            .arg("--format").arg(&fmt)
            .env("GAPMAP_DATA_DIR", &data_str)
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
    let output = app.shell().sidecar("gapmap-cli")
        .map_err(|e| e.to_string())?
        .args(["research", "export-brief", "--topic", &topic, "--format", &fmt])
        .env("GAPMAP_DATA_DIR", &data_str)
        .env("PYTHONUNBUFFERED", "1")
        .output().await.map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Run the full paper research pipeline for a topic + query.
/// Triggers the Papers tab's "Find papers" button — searches 6 academic
/// sources, dedupes + ranks, fetches fulltext for top-cited papers, runs
/// LLM analysis, stores everything to SQLite. The UI re-reads `papers_list`
/// when this returns to show the freshly-discovered papers.
#[tauri::command]
pub async fn paper_research_pipeline(
    app: AppHandle,
    topic: String,
    query: Option<String>,
    limit_per_source: Option<u32>,
    max_fulltext: Option<u32>,
    year_from: Option<i32>,
    provider: Option<String>,
    sources: Option<String>,
) -> Result<Value, String> {
    let lps = limit_per_source.unwrap_or(5).to_string();
    let mft = max_fulltext.unwrap_or(3).to_string();
    let yf  = year_from.map(|y| y.to_string()).unwrap_or_default();
    let q   = query.unwrap_or_default();
    let p   = provider.unwrap_or_default();
    let src = sources.unwrap_or_default();

    let mut args: Vec<&str> = vec![
        "research", "papers",
        "--topic", &topic,
        "--limit-per-source", &lps,
        "--max-fulltext", &mft,
        "--json",
    ];
    if !q.is_empty()   { args.push("--query");      args.push(q.as_str()); }
    if !yf.is_empty()  { args.push("--year-from");  args.push(yf.as_str()); }
    if !p.is_empty()   { args.push("--provider");   args.push(p.as_str()); }
    if !src.is_empty() { args.push("--sources");    args.push(src.as_str()); }

    run_cli(&app, args).await.map_err(err_to_string)
}

/// Research-paper pipeline stage 1 — structured outline.
#[tauri::command]
pub async fn paper_outline_generate(
    app: AppHandle,
    topic: String,
    provider: Option<String>,
) -> Result<Value, String> {
    let mut args: Vec<&str> = vec![
        "research", "paper-outline",
        "--topic", &topic, "--json",
    ];
    let p = provider.unwrap_or_default();
    if !p.is_empty() {
        args.push("--provider");
        args.push(p.as_str());
    }
    run_cli(&app, args).await.map_err(err_to_string)
}

/// Research-paper pipeline stage 2 — markdown draft generation.
#[tauri::command]
pub async fn paper_draft_generate(
    app: AppHandle,
    topic: String,
    provider: Option<String>,
    style: Option<String>,
) -> Result<Value, String> {
    let style_v = style.unwrap_or_else(|| "IMRaD".to_string());
    let mut args: Vec<&str> = vec![
        "research", "paper-draft",
        "--topic", &topic,
        "--style", &style_v,
        "--json",
    ];
    let p = provider.unwrap_or_default();
    if !p.is_empty() {
        args.push("--provider");
        args.push(p.as_str());
    }
    run_cli(&app, args).await.map_err(err_to_string)
}

/// Research-paper pipeline stage 3 — experiment plan generation.
#[tauri::command]
pub async fn experiment_plan_generate(
    app: AppHandle,
    topic: String,
    provider: Option<String>,
) -> Result<Value, String> {
    let mut args: Vec<&str> = vec![
        "research", "paper-experiments",
        "--topic", &topic, "--json",
    ];
    let p = provider.unwrap_or_default();
    if !p.is_empty() {
        args.push("--provider");
        args.push(p.as_str());
    }
    run_cli(&app, args).await.map_err(err_to_string)
}

/// Research-paper pipeline stage 4 — export draft with citations.
#[tauri::command]
pub async fn paper_export_with_citations(
    app: AppHandle,
    topic: String,
    provider: Option<String>,
    format: Option<String>,
    style: Option<String>,
) -> Result<Value, String> {
    let format_v = format.unwrap_or_else(|| "markdown".to_string());
    let style_v = style.unwrap_or_else(|| "IMRaD".to_string());
    let mut args: Vec<&str> = vec![
        "research", "paper-export",
        "--topic", &topic,
        "--format", &format_v,
        "--style", &style_v,
        "--json",
    ];
    let p = provider.unwrap_or_default();
    if !p.is_empty() {
        args.push("--provider");
        args.push(p.as_str());
    }
    run_cli(&app, args).await.map_err(err_to_string)
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
// See src/gapmap/research/monitor.py.

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
// src/gapmap/research/hypothesis_tracker.py for the state machine.

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

// ─── Page explainer — eye-icon "why this page exists" ───────────────────

#[tauri::command]
pub async fn page_explanation_get(
    app: AppHandle,
    slug: String,
) -> Result<Value, String> {
    run_cli(
        &app,
        vec!["research", "page-explanation-get", "--slug", &slug, "--json"],
    ).await.map_err(err_to_string)
}

#[tauri::command]
pub async fn page_explanations_list(app: AppHandle) -> Result<Value, String> {
    run_cli(
        &app,
        vec!["research", "page-explanations-list", "--json"],
    ).await.map_err(err_to_string)
}

// ─── Runtime snapshot — Task Manager backing ────────────────────────────

#[tauri::command]
pub async fn runtime_snapshot(
    app: AppHandle,
    recent_limit: Option<i64>,
) -> Result<Value, String> {
    let r = recent_limit.unwrap_or(25).to_string();
    run_cli(
        &app,
        vec!["research", "runtime-snapshot", "--recent-limit", &r, "--json"],
    ).await.map_err(err_to_string)
}

// ─── Lifecycle pivot — Stage-Gate verdict + Kano categorization ──────────

#[tauri::command]
pub async fn product_gate_set(
    app: AppHandle,
    product_id: String,
    status: String,
    notes: Option<String>,
) -> Result<Value, String> {
    let n = notes.unwrap_or_default();
    run_cli(
        &app,
        vec!["research", "product-gate-set", "--id", &product_id,
             "--status", &status, "--notes", &n, "--json"],
    ).await.map_err(err_to_string)
}

#[tauri::command]
pub async fn product_gate_get(
    app: AppHandle,
    product_id: String,
) -> Result<Value, String> {
    run_cli(
        &app,
        vec!["research", "product-gate-get", "--id", &product_id, "--json"],
    ).await.map_err(err_to_string)
}

#[tauri::command]
pub async fn run_kano_categorize(app: AppHandle, topic: String) -> Result<Value, String> {
    run_cli(
        &app,
        vec!["research", "kano-categorize", "--topic", &topic, "--json"],
    ).await.map_err(err_to_string)
}

// ─── Iterate / Autoresearch (2026-05-03 Phase 4) ──────────────────────────
// Persistent in-app autoresearch loop. Each call wraps a CLI subcommand
// that touches new SQLite tables: iterate_runs, iterate_iterations,
// topic_pipeline_config.

#[tauri::command]
pub async fn iterate_run(
    app: AppHandle,
    topic: String,
    loop_kind: String,
    grid_json: Option<String>,
    notes: Option<String>,
) -> Result<Value, String> {
    let g = grid_json.unwrap_or_default();
    let n = notes.unwrap_or_default();
    let mut args: Vec<&str> = vec![
        "research", "iterate-run",
        "--topic", &topic, "--loop", &loop_kind,
        "--notes", &n, "--json",
    ];
    if !g.is_empty() {
        args.push("--grid");
        args.push(&g);
    }
    run_cli(&app, args).await.map_err(err_to_string)
}

#[tauri::command]
pub async fn iterate_start(
    app: AppHandle,
    topic: String,
    loop_kind: String,
    grid_json: Option<String>,
    notes: Option<String>,
) -> Result<Value, String> {
    let g = grid_json.unwrap_or_default();
    let n = notes.unwrap_or_default();
    let mut args: Vec<&str> = vec![
        "research", "iterate-start",
        "--topic", &topic, "--loop", &loop_kind,
        "--notes", &n, "--json",
    ];
    if !g.is_empty() {
        args.push("--grid");
        args.push(&g);
    }
    run_cli(&app, args).await.map_err(err_to_string)
}

#[tauri::command]
pub async fn iterate_execute(
    app: AppHandle,
    run_id: String,
) -> Result<Value, String> {
    run_cli(&app, vec!["research", "iterate-execute",
                       "--run-id", &run_id, "--json"])
        .await.map_err(err_to_string)
}

#[tauri::command]
pub async fn iterate_status(
    app: AppHandle,
    run_id: String,
) -> Result<Value, String> {
    run_cli(&app, vec!["research", "iterate-status",
                       "--run-id", &run_id, "--json"])
        .await.map_err(err_to_string)
}

#[tauri::command]
pub async fn iterate_list(
    app: AppHandle,
    topic: Option<String>,
    limit: Option<i64>,
) -> Result<Value, String> {
    let lim = limit.unwrap_or(30).to_string();
    let t = topic.unwrap_or_default();
    let mut args: Vec<&str> = vec![
        "research", "iterate-list", "--limit", &lim, "--json",
    ];
    if !t.is_empty() {
        args.push("--topic"); args.push(&t);
    }
    run_cli(&app, args).await.map_err(err_to_string)
}

#[tauri::command]
pub async fn iterate_cancel(
    app: AppHandle,
    run_id: String,
) -> Result<Value, String> {
    run_cli(&app, vec!["research", "iterate-cancel",
                       "--run-id", &run_id, "--json"])
        .await.map_err(err_to_string)
}

#[tauri::command]
pub async fn iterate_apply(
    app: AppHandle,
    run_id: String,
) -> Result<Value, String> {
    run_cli(&app, vec!["research", "iterate-apply",
                       "--run-id", &run_id, "--json"])
        .await.map_err(err_to_string)
}

#[tauri::command]
pub async fn iterate_applied(
    app: AppHandle,
    topic: String,
) -> Result<Value, String> {
    run_cli(&app, vec!["research", "iterate-applied",
                       "--topic", &topic, "--json"])
        .await.map_err(err_to_string)
}

#[tauri::command]
pub async fn pipeline_run(
    app: AppHandle,
    topic: String,
    force: Option<bool>,
    no_llm: Option<bool>,
    provider: Option<String>,
) -> Result<Value, String> {
    let f = if force.unwrap_or(false) { "--force" } else { "--no-force" };
    let prov = provider.unwrap_or_default();
    let mut args: Vec<&str> = vec![
        "research", "pipeline-run", "--topic", &topic, f, "--json",
    ];
    if no_llm.unwrap_or(false) { args.push("--no-llm"); }
    if !prov.is_empty() { args.push("--provider"); args.push(&prov); }
    run_cli(&app, args).await.map_err(err_to_string)
}

#[tauri::command]
pub async fn pipeline_status(
    app: AppHandle,
    topic: String,
) -> Result<Value, String> {
    run_cli(&app, vec!["research", "pipeline-status",
                       "--topic", &topic, "--json"])
        .await.map_err(err_to_string)
}

// ─── Deliberation (2026-05-03 Phase 3) ────────────────────────────────────
// 5-persona debate over a topic's cached findings.

#[tauri::command]
pub async fn deliberate(
    app: AppHandle,
    topic: String,
    rounds: Option<i64>,
    no_llm: Option<bool>,
    provider: Option<String>,
) -> Result<Value, String> {
    let r = rounds.unwrap_or(1).to_string();
    let prov = provider.unwrap_or_default();
    let mut args: Vec<&str> = vec![
        "research", "deliberate", "--topic", &topic, "--rounds", &r, "--json",
    ];
    if no_llm.unwrap_or(false) {
        args.push("--no-llm");
    }
    if !prov.is_empty() {
        args.push("--provider");
        args.push(&prov);
    }
    run_cli(&app, args).await.map_err(err_to_string)
}

// ─── Audience personas (2026-05-03) ───────────────────────────────────────
// Cluster real authors in a topic into ICP personas backed by their
// actual posts. Pairs with the Audience screen + Launch Brief.

#[tauri::command]
pub async fn audience_personas_build(
    app: AppHandle,
    topic: String,
    llm: Option<bool>,
    provider: Option<String>,
    min_posts: Option<i64>,
) -> Result<Value, String> {
    let llm_flag = if llm.unwrap_or(true) { "--llm" } else { "--no-llm" };
    let prov = provider.unwrap_or_default();
    let mp = min_posts.unwrap_or(3).to_string();
    let mut args: Vec<&str> = vec![
        "research", "audience-build",
        "--topic", &topic,
        llm_flag,
        "--min-posts", &mp,
        "--json",
    ];
    if !prov.is_empty() {
        args.push("--provider");
        args.push(&prov);
    }
    run_cli(&app, args).await.map_err(err_to_string)
}

#[tauri::command]
pub async fn audience_personas_get(
    app: AppHandle,
    topic: String,
) -> Result<Value, String> {
    run_cli(
        &app,
        vec!["research", "audience-get", "--topic", &topic, "--json"],
    ).await.map_err(err_to_string)
}

// ─── Launch & GTM (2026-05-02) ────────────────────────────────────────────
// Per-topic Launch Brief: target audience, demographics, where to launch,
// market requirements. Deterministic + optional LLM augmentation.

#[tauri::command]
pub async fn launch_brief(
    app: AppHandle,
    topic: String,
    llm: Option<bool>,
    provider: Option<String>,
) -> Result<Value, String> {
    let llm_flag = if llm.unwrap_or(true) { "--llm" } else { "--no-llm" };
    let prov = provider.unwrap_or_default();
    let mut args: Vec<&str> = vec![
        "research", "launch-brief", "--topic", &topic, llm_flag, "--json",
    ];
    if !prov.is_empty() {
        args.push("--provider");
        args.push(&prov);
    }
    run_cli(&app, args).await.map_err(err_to_string)
}

#[tauri::command]
pub async fn launch_brief_get(
    app: AppHandle,
    topic: String,
) -> Result<Value, String> {
    run_cli(
        &app,
        vec!["research", "launch-brief-get", "--topic", &topic, "--json"],
    ).await.map_err(err_to_string)
}

// ─── Discovery framework expansion (2026-05-01_04) ────────────────────────
// OST + RICE + MoSCoW + Empathy Maps + Four Risks + Value Curve.

#[tauri::command]
pub async fn ost_build(
    app: AppHandle,
    topic: String,
    product_id: Option<String>,
) -> Result<Value, String> {
    let pid = product_id.unwrap_or_default();
    let mut args: Vec<&str> = vec!["research", "ost-build", "--topic", &topic, "--json"];
    if !pid.is_empty() {
        args.push("--product-id");
        args.push(&pid);
    }
    run_cli(&app, args).await.map_err(err_to_string)
}

#[tauri::command]
pub async fn ost_set_outcome(
    app: AppHandle,
    product_id: String,
    outcome: String,
) -> Result<Value, String> {
    run_cli(
        &app,
        vec!["research", "ost-set-outcome", "--id", &product_id,
             "--outcome", &outcome, "--json"],
    ).await.map_err(err_to_string)
}

// OST experiment CRUD — distinct namespace from gap_discovery's
// `experiments-list` / `list_experiments` which surface a different
// (LLM-proposed, paper-grounded) experiment concept.
#[tauri::command]
pub async fn ost_experiment_create(
    app: AppHandle,
    topic: String,
    painpoint_id: String,
    intervention_id: Option<String>,
    hypothesis: String,
    method: Option<String>,
    success_criteria: Option<String>,
    sample_size: Option<i64>,
) -> Result<Value, String> {
    let iv = intervention_id.unwrap_or_default();
    let m = method.unwrap_or_else(|| "custom".to_string());
    let sc = success_criteria.unwrap_or_default();
    let ss = sample_size.unwrap_or(0).to_string();
    let mut args: Vec<&str> = vec![
        "research", "ost-experiment-create",
        "--topic", &topic,
        "--painpoint-id", &painpoint_id,
        "--hypothesis", &hypothesis,
        "--method", &m,
        "--success-criteria", &sc,
        "--sample-size", &ss,
        "--json",
    ];
    if !iv.is_empty() {
        args.push("--intervention-id");
        args.push(&iv);
    }
    run_cli(&app, args).await.map_err(err_to_string)
}

#[tauri::command]
pub async fn ost_experiments_list(
    app: AppHandle,
    topic: String,
    painpoint_id: Option<String>,
) -> Result<Value, String> {
    let pp = painpoint_id.unwrap_or_default();
    let mut args: Vec<&str> = vec!["research", "ost-experiments-list", "--topic", &topic, "--json"];
    if !pp.is_empty() {
        args.push("--painpoint-id");
        args.push(&pp);
    }
    run_cli(&app, args).await.map_err(err_to_string)
}

#[tauri::command]
pub async fn ost_experiment_update(
    app: AppHandle,
    experiment_id: String,
    fields_json: String,
) -> Result<Value, String> {
    run_cli(
        &app,
        vec!["research", "ost-experiment-update", "--id", &experiment_id,
             "--fields-json", &fields_json, "--json"],
    ).await.map_err(err_to_string)
}

#[tauri::command]
pub async fn ost_experiment_delete(
    app: AppHandle,
    experiment_id: String,
) -> Result<Value, String> {
    run_cli(
        &app,
        vec!["research", "ost-experiment-delete", "--id", &experiment_id, "--json"],
    ).await.map_err(err_to_string)
}

#[tauri::command]
pub async fn run_rice_score(
    app: AppHandle,
    topic: String,
    default_effort: Option<i64>,
    overwrite_effort: Option<bool>,
) -> Result<Value, String> {
    let de = default_effort.unwrap_or(3).to_string();
    let mut args: Vec<&str> = vec![
        "research", "rice-score", "--topic", &topic,
        "--default-effort", &de, "--json",
    ];
    if overwrite_effort.unwrap_or(false) {
        args.push("--overwrite-effort");
    }
    run_cli(&app, args).await.map_err(err_to_string)
}

#[tauri::command]
pub async fn rice_set(
    app: AppHandle,
    intervention_id: String,
    reach: Option<i64>,
    impact: Option<i64>,
    confidence: Option<i64>,
    effort: Option<i64>,
) -> Result<Value, String> {
    let mut args: Vec<String> = vec![
        "research".into(), "rice-set".into(),
        "--id".into(), intervention_id,
    ];
    if let Some(v) = reach      { args.push("--reach".into());      args.push(v.to_string()); }
    if let Some(v) = impact     { args.push("--impact".into());     args.push(v.to_string()); }
    if let Some(v) = confidence { args.push("--confidence".into()); args.push(v.to_string()); }
    if let Some(v) = effort     { args.push("--effort".into());     args.push(v.to_string()); }
    args.push("--json".into());
    let argv: Vec<&str> = args.iter().map(String::as_str).collect();
    run_cli(&app, argv).await.map_err(err_to_string)
}

#[tauri::command]
pub async fn run_moscow_categorize(app: AppHandle, topic: String) -> Result<Value, String> {
    run_cli(
        &app,
        vec!["research", "moscow-categorize", "--topic", &topic, "--json"],
    ).await.map_err(err_to_string)
}

#[tauri::command]
pub async fn run_empathy_build(
    app: AppHandle,
    topic: String,
    persona: Option<String>,
) -> Result<Value, String> {
    let p = persona.unwrap_or_else(|| "primary".to_string());
    run_cli(
        &app,
        vec!["research", "empathy-build", "--topic", &topic,
             "--persona", &p, "--json"],
    ).await.map_err(err_to_string)
}

#[tauri::command]
pub async fn empathy_get(
    app: AppHandle,
    topic: String,
    persona: Option<String>,
) -> Result<Value, String> {
    let p = persona.unwrap_or_else(|| "primary".to_string());
    run_cli(
        &app,
        vec!["research", "empathy-get", "--topic", &topic, "--persona", &p, "--json"],
    ).await.map_err(err_to_string)
}

#[tauri::command]
pub async fn empathy_list(app: AppHandle, topic: String) -> Result<Value, String> {
    run_cli(
        &app,
        vec!["research", "empathy-list", "--topic", &topic, "--json"],
    ).await.map_err(err_to_string)
}

#[tauri::command]
pub async fn four_risks_get(app: AppHandle, product_id: String) -> Result<Value, String> {
    run_cli(
        &app,
        vec!["research", "four-risks-get", "--id", &product_id, "--json"],
    ).await.map_err(err_to_string)
}

#[tauri::command]
pub async fn four_risks_set(
    app: AppHandle,
    product_id: String,
    risk: String,
    status: String,
    notes: Option<String>,
) -> Result<Value, String> {
    let n = notes.unwrap_or_default();
    run_cli(
        &app,
        vec!["research", "four-risks-set", "--id", &product_id,
             "--risk", &risk, "--status", &status, "--notes", &n, "--json"],
    ).await.map_err(err_to_string)
}

#[tauri::command]
pub async fn value_curve_get(app: AppHandle, product_id: String) -> Result<Value, String> {
    run_cli(
        &app,
        vec!["research", "value-curve-get", "--id", &product_id, "--json"],
    ).await.map_err(err_to_string)
}

#[tauri::command]
pub async fn value_curve_set(
    app: AppHandle,
    product_id: String,
    payload_json: String,
) -> Result<Value, String> {
    run_cli(
        &app,
        vec!["research", "value-curve-set", "--id", &product_id,
             "--payload-json", &payload_json, "--json"],
    ).await.map_err(err_to_string)
}

// ── TAM / SAM / SOM ────────────────────────────────────────────────
#[tauri::command]
pub async fn tam_sam_som_get(app: AppHandle, product_id: String) -> Result<Value, String> {
    run_cli(&app, vec!["research", "tam-sam-som-get", "--id", &product_id, "--json"])
        .await.map_err(err_to_string)
}

#[tauri::command]
pub async fn tam_sam_som_set(
    app: AppHandle,
    product_id: String,
    payload_json: String,
) -> Result<Value, String> {
    run_cli(&app, vec!["research", "tam-sam-som-set", "--id", &product_id,
        "--payload-json", &payload_json, "--json"])
        .await.map_err(err_to_string)
}

// ── Porter's Five Forces ──────────────────────────────────────────────
#[tauri::command]
pub async fn porter_get(app: AppHandle, product_id: String) -> Result<Value, String> {
    run_cli(&app, vec!["research", "porter-get", "--id", &product_id, "--json"])
        .await.map_err(err_to_string)
}

#[tauri::command]
pub async fn porter_set(
    app: AppHandle,
    product_id: String,
    force: String,
    score: i64,
    notes: Option<String>,
) -> Result<Value, String> {
    let n = notes.unwrap_or_default();
    let s = score.to_string();
    run_cli(&app, vec!["research", "porter-set", "--id", &product_id,
        "--force", &force, "--score", &s, "--notes", &n, "--json"])
        .await.map_err(err_to_string)
}

// ── 2x2 positioning map ───────────────────────────────────────────────
#[tauri::command]
pub async fn positioning_get(app: AppHandle, product_id: String) -> Result<Value, String> {
    run_cli(&app, vec!["research", "positioning-get", "--id", &product_id, "--json"])
        .await.map_err(err_to_string)
}

#[tauri::command]
pub async fn positioning_set(
    app: AppHandle,
    product_id: String,
    payload_json: String,
) -> Result<Value, String> {
    run_cli(&app, vec!["research", "positioning-set", "--id", &product_id,
        "--payload-json", &payload_json, "--json"])
        .await.map_err(err_to_string)
}

// ── Cost model + pricing tiers ────────────────────────────────────────
#[tauri::command]
pub async fn cost_model_get(app: AppHandle, product_id: String) -> Result<Value, String> {
    run_cli(&app, vec!["research", "cost-model-get", "--id", &product_id, "--json"])
        .await.map_err(err_to_string)
}

#[tauri::command]
pub async fn cost_model_set(
    app: AppHandle,
    product_id: String,
    payload_json: String,
) -> Result<Value, String> {
    run_cli(&app, vec!["research", "cost-model-set", "--id", &product_id,
        "--payload-json", &payload_json, "--json"])
        .await.map_err(err_to_string)
}

// ── Customer Discovery Interviews ─────────────────────────────────────
#[tauri::command]
pub async fn interview_create(
    app: AppHandle,
    topic: String,
    name: String,
    payload_json: Option<String>,
    product_id: Option<String>,
) -> Result<Value, String> {
    let pj = payload_json.unwrap_or_else(|| "{}".to_string());
    let pid = product_id.unwrap_or_default();
    run_cli(&app, vec!["research", "interview-create", "--topic", &topic,
        "--name", &name, "--payload-json", &pj, "--product-id", &pid, "--json"])
        .await.map_err(err_to_string)
}

#[tauri::command]
pub async fn interview_update(
    app: AppHandle,
    interview_id: String,
    payload_json: String,
) -> Result<Value, String> {
    run_cli(&app, vec!["research", "interview-update", "--id", &interview_id,
        "--payload-json", &payload_json, "--json"])
        .await.map_err(err_to_string)
}

#[tauri::command]
pub async fn interview_delete(app: AppHandle, interview_id: String) -> Result<Value, String> {
    run_cli(&app, vec!["research", "interview-delete", "--id", &interview_id, "--json"])
        .await.map_err(err_to_string)
}

#[tauri::command]
pub async fn interview_get(app: AppHandle, interview_id: String) -> Result<Value, String> {
    run_cli(&app, vec!["research", "interview-get", "--id", &interview_id, "--json"])
        .await.map_err(err_to_string)
}

#[tauri::command]
pub async fn interview_list(
    app: AppHandle,
    topic: Option<String>,
    product_id: Option<String>,
) -> Result<Value, String> {
    let t = topic.unwrap_or_default();
    let p = product_id.unwrap_or_default();
    run_cli(&app, vec!["research", "interview-list", "--topic", &t, "--product-id", &p, "--json"])
        .await.map_err(err_to_string)
}

#[tauri::command]
pub async fn interview_summary(
    app: AppHandle,
    topic: String,
    product_id: Option<String>,
) -> Result<Value, String> {
    let p = product_id.unwrap_or_default();
    run_cli(&app, vec!["research", "interview-summary", "--topic", &topic,
        "--product-id", &p, "--json"])
        .await.map_err(err_to_string)
}

// ── Sean Ellis PMF ────────────────────────────────────────────────────
#[tauri::command]
pub async fn pmf_add(
    app: AppHandle,
    topic: String,
    payload_json: String,
) -> Result<Value, String> {
    run_cli(&app, vec!["research", "pmf-add", "--topic", &topic,
        "--payload-json", &payload_json, "--json"])
        .await.map_err(err_to_string)
}

#[tauri::command]
pub async fn pmf_list(
    app: AppHandle,
    topic: Option<String>,
    product_id: Option<String>,
) -> Result<Value, String> {
    let t = topic.unwrap_or_default();
    let p = product_id.unwrap_or_default();
    run_cli(&app, vec!["research", "pmf-list", "--topic", &t, "--product-id", &p, "--json"])
        .await.map_err(err_to_string)
}

#[tauri::command]
pub async fn pmf_score(
    app: AppHandle,
    topic: String,
    product_id: Option<String>,
) -> Result<Value, String> {
    let p = product_id.unwrap_or_default();
    run_cli(&app, vec!["research", "pmf-score", "--topic", &topic,
        "--product-id", &p, "--json"])
        .await.map_err(err_to_string)
}

#[tauri::command]
pub async fn pmf_delete(app: AppHandle, response_id: String) -> Result<Value, String> {
    run_cli(&app, vec!["research", "pmf-delete", "--id", &response_id, "--json"])
        .await.map_err(err_to_string)
}

// ── Pricing surveys ───────────────────────────────────────────────────
#[tauri::command]
pub async fn vw_add(
    app: AppHandle,
    topic: String,
    payload_json: String,
) -> Result<Value, String> {
    run_cli(&app, vec!["research", "vw-add", "--topic", &topic,
        "--payload-json", &payload_json, "--json"])
        .await.map_err(err_to_string)
}

#[tauri::command]
pub async fn vw_aggregate(
    app: AppHandle,
    topic: String,
    product_id: Option<String>,
) -> Result<Value, String> {
    let p = product_id.unwrap_or_default();
    run_cli(&app, vec!["research", "vw-aggregate", "--topic", &topic,
        "--product-id", &p, "--json"])
        .await.map_err(err_to_string)
}

#[tauri::command]
pub async fn nps_add(
    app: AppHandle,
    topic: String,
    payload_json: String,
) -> Result<Value, String> {
    run_cli(&app, vec!["research", "nps-add", "--topic", &topic,
        "--payload-json", &payload_json, "--json"])
        .await.map_err(err_to_string)
}

#[tauri::command]
pub async fn nps_score(
    app: AppHandle,
    topic: String,
    product_id: Option<String>,
) -> Result<Value, String> {
    let p = product_id.unwrap_or_default();
    run_cli(&app, vec!["research", "nps-score", "--topic", &topic,
        "--product-id", &p, "--json"])
        .await.map_err(err_to_string)
}

#[tauri::command]
pub async fn maxdiff_add(
    app: AppHandle,
    topic: String,
    payload_json: String,
) -> Result<Value, String> {
    run_cli(&app, vec!["research", "maxdiff-add", "--topic", &topic,
        "--payload-json", &payload_json, "--json"])
        .await.map_err(err_to_string)
}

#[tauri::command]
pub async fn maxdiff_ranking(
    app: AppHandle,
    topic: String,
    product_id: Option<String>,
) -> Result<Value, String> {
    let p = product_id.unwrap_or_default();
    run_cli(&app, vec!["research", "maxdiff-ranking", "--topic", &topic,
        "--product-id", &p, "--json"])
        .await.map_err(err_to_string)
}

#[tauri::command]
pub async fn survey_list(
    app: AppHandle,
    topic: Option<String>,
    product_id: Option<String>,
    kind: Option<String>,
) -> Result<Value, String> {
    let t = topic.unwrap_or_default();
    let p = product_id.unwrap_or_default();
    let k = kind.unwrap_or_default();
    run_cli(&app, vec!["research", "survey-list", "--topic", &t, "--product-id", &p,
        "--kind", &k, "--json"])
        .await.map_err(err_to_string)
}

#[tauri::command]
pub async fn survey_delete(app: AppHandle, response_id: String) -> Result<Value, String> {
    run_cli(&app, vec!["research", "survey-delete", "--id", &response_id, "--json"])
        .await.map_err(err_to_string)
}

// ── PERT ───────────────────────────────────────────────────────────────
#[tauri::command]
pub async fn pert_add(
    app: AppHandle,
    product_id: String,
    label: String,
    optimistic: Option<f64>,
    most_likely: Option<f64>,
    pessimistic: Option<f64>,
    role: Option<String>,
    notes: Option<String>,
    tier: Option<String>,
) -> Result<Value, String> {
    let o = optimistic.unwrap_or(0.0).to_string();
    let m = most_likely.unwrap_or(0.0).to_string();
    let p = pessimistic.unwrap_or(0.0).to_string();
    let r = role.unwrap_or_else(|| "eng".to_string());
    let n = notes.unwrap_or_default();
    let t = tier.unwrap_or_else(|| "mvp".to_string());
    run_cli(&app, vec!["research", "pert-add", "--id", &product_id,
        "--label", &label, "--o", &o, "--m", &m, "--p", &p,
        "--role", &r, "--notes", &n, "--tier", &t, "--json"])
        .await.map_err(err_to_string)
}

#[tauri::command]
pub async fn pert_update(
    app: AppHandle,
    task_id: String,
    payload_json: String,
) -> Result<Value, String> {
    run_cli(&app, vec!["research", "pert-update", "--id", &task_id,
        "--payload-json", &payload_json, "--json"])
        .await.map_err(err_to_string)
}

#[tauri::command]
pub async fn pert_delete(app: AppHandle, task_id: String) -> Result<Value, String> {
    run_cli(&app, vec!["research", "pert-delete", "--id", &task_id, "--json"])
        .await.map_err(err_to_string)
}

#[tauri::command]
pub async fn pert_list(
    app: AppHandle,
    product_id: String,
    tier: Option<String>,
) -> Result<Value, String> {
    let t = tier.unwrap_or_default();
    run_cli(&app, vec!["research", "pert-list", "--id", &product_id, "--tier", &t, "--json"])
        .await.map_err(err_to_string)
}

#[tauri::command]
pub async fn pert_rollup(
    app: AppHandle,
    product_id: String,
    multiplier: Option<f64>,
    contingency_pct: Option<f64>,
    tier: Option<String>,
) -> Result<Value, String> {
    let m = multiplier.unwrap_or(1.75).to_string();
    let c = contingency_pct.unwrap_or(17.5).to_string();
    let t = tier.unwrap_or_default();
    run_cli(&app, vec!["research", "pert-rollup", "--id", &product_id,
        "--multiplier", &m, "--contingency", &c, "--tier", &t, "--json"])
        .await.map_err(err_to_string)
}

// ── PRD Generator ──────────────────────────────────────────────────────
#[tauri::command]
pub async fn prd_export(app: AppHandle, product_id: String) -> Result<Value, String> {
    run_cli(&app, vec!["research", "prd-export", "--id", &product_id, "--json"])
        .await.map_err(err_to_string)
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
#[tauri::command]
pub async fn paper_pdf_fetch(
    app: AppHandle,
    url: String,
    post_id: Option<String>,
) -> Result<Value, String> {
    use sha2::{Digest, Sha256};
    use std::fmt::Write as _;
    use std::fs;
    use tauri::Manager;

    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err(format!("invalid url scheme: {url}"));
    }

    let cache_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("app_local_data_dir failed: {e}"))?
        .join("paper_pdf_cache");
    fs::create_dir_all(&cache_dir).map_err(|e| format!("mkdir cache: {e}"))?;

    // Stable filename: prefer post_id when supplied (cleaner in Finder),
    // else hash the URL. Always end in .pdf so the OS picks the right viewer.
    let stem = match post_id.as_deref().filter(|s| !s.is_empty()) {
        Some(pid) => pid.replace(['/', '\\', ':'], "_"),
        None => {
            let mut h = Sha256::new();
            h.update(url.as_bytes());
            let digest = h.finalize();
            let mut s = String::with_capacity(24);
            for b in &digest[..12] {
                write!(&mut s, "{b:02x}").ok();
            }
            s
        }
    };
    let dest = cache_dir.join(format!("{stem}.pdf"));

    if !dest.exists() {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(60))
            .redirect(reqwest::redirect::Policy::limited(8))
            .user_agent("gapmap/1.0 (paper-pdf-fetch)")
            .build()
            .map_err(|e| format!("client build: {e}"))?;
        let resp = client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("fetch failed: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!("HTTP {} for {url}", resp.status()));
        }
        // Sanity-check content-type. Some publisher landing pages 200 with
        // an HTML body instead of redirecting to the PDF — saving that as
        // .pdf would render a blank viewer with no useful error.
        let ct = resp
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_lowercase();
        if !ct.is_empty() && !(ct.contains("pdf") || ct.contains("octet-stream")) {
            return Err(format!(
                "expected PDF, got content-type: {ct} (publisher likely served an HTML wall — try the 'Open externally' button)"
            ));
        }
        let bytes = resp
            .bytes()
            .await
            .map_err(|e| format!("read body: {e}"))?;
        // Magic-byte check — first 4 bytes of every valid PDF are `%PDF`.
        if bytes.len() < 4 || &bytes[..4] != b"%PDF" {
            return Err(
                "downloaded payload is not a PDF (magic bytes missing)".to_string()
            );
        }
        let tmp = dest.with_extension("pdf.tmp");
        fs::write(&tmp, &bytes).map_err(|e| format!("write tmp: {e}"))?;
        fs::rename(&tmp, &dest).map_err(|e| format!("rename: {e}"))?;
    }

    let size = fs::metadata(&dest).map(|m| m.len()).unwrap_or(0);
    Ok(serde_json::json!({
        "ok": true,
        "path": dest.to_string_lossy(),
        "size": size,
        "cached": true,
    }))
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

/// Cross-table search — posts, graph nodes, analyses, papers, hypotheses,
/// feedback, + optional palace semantic hits in aggressive mode. Persists
/// a summary row to mcp_analyses so future pipelines can consume it.
#[tauri::command]
pub async fn search_all(
    app: AppHandle,
    query: String,
    topic: Option<String>,
    aggressive: Option<bool>,
) -> Result<Value, String> {
    let mut args: Vec<&str> = vec!["research", "search-all", "--query", &query, "--json"];
    if let Some(t) = topic.as_ref() {
        if !t.is_empty() {
            args.push("--topic");
            args.push(t.as_str());
        }
    }
    if aggressive.unwrap_or(false) {
        args.push("--aggressive");
    }
    run_cli(&app, args).await.map_err(err_to_string)
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
    mode: Option<String>,
    max_post_nodes: Option<i64>,
) -> Result<String, String> {
    let export_dir = read_export_dir(&app)?;
    let file_stem = sanitize_export_file_stem(&topic);
    let out_path = export_dir.join(format!("gap-map-{}.html", file_stem));
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

    let mut args: Vec<String> = vec![
        "research".into(),
        "graph".into(),
        "export".into(),
        "--topic".into(),
        topic.clone(),
        "--out".into(),
        out_str.clone(),
    ];
    if let Some(m) = mode {
        if !m.trim().is_empty() {
            args.push("--mode".into());
            args.push(m);
        }
    }
    if let Some(n) = max_post_nodes {
        if n > 0 {
            args.push("--max-post-nodes".into());
            args.push(n.to_string());
        }
    }

    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    run_cli(&app, arg_refs)
        .await
        .map_err(err_to_string)?;
    Ok(out_str)
}

/// Export the graph as raw JSON (D3-compatible). Returns absolute path.
#[tauri::command]
pub async fn export_graph_json(app: AppHandle, topic: String) -> Result<String, String> {
    let export_dir = read_export_dir(&app)?;
    let file_stem = sanitize_export_file_stem(&topic);
    let out_path = export_dir.join(format!("gap-graph-{}.json", file_stem));
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
    let export_dir = read_export_dir(&app)?;
    let file_stem = sanitize_export_file_stem(&topic);
    let out_path = export_dir.join(format!("report-pro-{}.md", file_stem));
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

/// Walk a folder recursively and ingest every supported file (md/pdf/csv/
/// json/txt/vtt/srt) into a single topic. The Python side enforces a
/// configurable file-count cap and skips the usual junk dirs (.git,
/// node_modules, dist, build, hidden subtrees) so the user can drop a
/// project root without polluting the corpus.
///
/// Returns the per-file ingest summary so the UI can show "ingested 12/14
/// files, 2 failed (… reasons)" without a second round-trip.
#[tauri::command]
pub async fn ingest_folder(
    app: AppHandle,
    path: String,
    topic: String,
    source_type: String,
    extensions: Option<String>,
    max_files: Option<u32>,
) -> Result<Value, String> {
    let mut args: Vec<&str> = vec![
        "ingest", "folder",
        "--path", &path,
        "--topic", &topic,
        "--source-type", &source_type,
        "--json",
    ];
    let max_str: String;
    if let Some(m) = max_files {
        max_str = m.to_string();
        args.push("--max-files");
        args.push(&max_str);
    }
    if let Some(ext) = extensions.as_deref() {
        if !ext.is_empty() {
            args.push("--ext");
            args.push(ext);
        }
    }
    run_cli(&app, args).await.map_err(err_to_string)
}

/// List exported files (.md, .html) in the app data dir.
#[tauri::command]
pub async fn list_exports(app: AppHandle) -> Result<Value, String> {
    let data = read_export_dir(&app)?;
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
#[tauri::command]
pub async fn clear_orphan_collect_lock(app: AppHandle) -> Result<Value, String> {
    use crate::cli::ActiveCollects;
    let map_empty = {
        let state = app.state::<ActiveCollects>();
        let map = state.0.lock().map_err(|e| e.to_string())?;
        map.is_empty()
    };
    let slot_held = is_collect_running(&app);
    if !(slot_held && map_empty) {
        return Ok(serde_json::json!({
            "ok": true,
            "was_orphan": false,
            "slot_held": slot_held,
            "map_empty": map_empty,
            "killed": false,
        }));
    }
    // Silent kill — manual Unstick is also a maintenance action. The
    // user pressed Unstick because they wanted to RUN something, not to
    // cancel something. If we used the loud variant the next collect
    // they kick off would get its exit mislabeled as cancelled-by-user.
    let killed = crate::cli::cancel_active_job_silent(&app);
    let _ = app.emit(
        "collect:orphan:reaped",
        serde_json::json!({ "trigger": "manual_unstick", "killed": killed }),
    );
    Ok(serde_json::json!({
        "ok": true,
        "was_orphan": true,
        "slot_held": true,
        "map_empty": true,
        "killed": killed,
    }))
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

/// Onboarding / startup diagnostics. Wraps `gapmap health --json` with a
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
#[tauri::command]
pub async fn palace_prewarm(app: AppHandle) -> Result<Value, String> {
    run_cli(
        &app,
        vec!["research", "palace-prewarm", "--json"],
    )
    .await
    .map_err(err_to_string)
}

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
    let db = dir.join("gapmap.db");
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
    let db_path = dir.join("gapmap.db");
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

/// Native fast-path for the cached insights read.
///
/// `synthesize_insights(topic, cached=true)` was just one row from
/// `topic_insights` — but it went through the Python sidecar (50–200ms warm,
/// 500–2000ms cold on a fresh DMG). This rusqlite path collapses it to ~1ms.
/// Returns the same shape the Python load_insights() emitted, with
/// `_cached=true`, `_generated_at`, `_corpus_size`, `_provider`, `_model`.
/// Returns `{ok: false, error}` when no cached row exists, matching how
/// the Python branch communicated "never generated".
#[tauri::command]
pub async fn topic_insights_cached(
    app: AppHandle,
    topic: String,
) -> Result<Value, String> {
    let dir = crate::cli::data_dir(&app).map_err(err_to_string)?;
    let db_path = dir.join("gapmap.db");
    if !db_path.exists() {
        return Ok(serde_json::json!({
            "ok": false, "topic": topic,
            "error": "No cached insight — run without --cached to generate.",
        }));
    }
    let topic_clone = topic.clone();
    let rows = tokio::task::spawn_blocking(move || {
        let mut p = serde_json::Map::new();
        p.insert("topic".into(), serde_json::Value::String(topic_clone));
        crate::db::query_db(
            &db_path,
            "SELECT report_json, generated_at, corpus_size, provider, model \
             FROM topic_insights WHERE topic = :topic",
            Some(&p),
        )
    })
    .await
    .map_err(|e| format!("task failed: {e}"))?
    .map_err(|e| {
        // If the table doesn't exist yet (fresh install before any synth),
        // surface the Python-equivalent "no cached" sentinel.
        let msg = e.to_string();
        if msg.contains("no such table") {
            String::new()
        } else {
            msg
        }
    });
    let rows = match rows {
        Ok(r) => r,
        Err(e) if e.is_empty() => {
            return Ok(serde_json::json!({
                "ok": false, "topic": topic,
                "error": "No cached insight — run without --cached to generate.",
            }));
        }
        Err(e) => return Err(e),
    };
    if rows.is_empty() {
        return Ok(serde_json::json!({
            "ok": false, "topic": topic,
            "error": "No cached insight — run without --cached to generate.",
        }));
    }
    let row = &rows[0];
    let report_json = row.get("report_json").and_then(|v| v.as_str()).unwrap_or("");
    let mut report: Value = match serde_json::from_str(report_json) {
        Ok(v) => v,
        Err(_) => {
            return Ok(serde_json::json!({
                "ok": false, "topic": topic,
                "error": "cached report JSON corrupt",
            }));
        }
    };
    if let Some(obj) = report.as_object_mut() {
        obj.insert("_cached".into(), Value::Bool(true));
        if let Some(v) = row.get("generated_at") { obj.insert("_generated_at".into(), v.clone()); }
        if let Some(v) = row.get("corpus_size")  { obj.insert("_corpus_size".into(),  v.clone()); }
        if let Some(v) = row.get("provider")     { obj.insert("_provider".into(),     v.clone()); }
        if let Some(v) = row.get("model")        { obj.insert("_model".into(),        v.clone()); }
        // Mirror the Python ok flag — when persisted reports omit "ok",
        // they're still valid (load_insights doesn't add one), so default to true.
        if !obj.contains_key("ok") {
            obj.insert("ok".into(), Value::Bool(true));
        }
    }
    Ok(report)
}

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
#[tauri::command]
pub async fn topic_counts_bundle(
    app: AppHandle,
    topic: String,
) -> Result<Value, String> {
    let dir = crate::cli::data_dir(&app).map_err(err_to_string)?;
    let db_path = dir.join("gapmap.db");
    if !db_path.exists() {
        return Ok(serde_json::json!({
            "painpoints": 0, "feature_wishes": 0, "workarounds": 0,
            "products": 0, "concepts": 0, "evidence_papers": 0,
            "total_findings": 0, "posts": 0, "sources": 0,
            "hypotheses": 0, "ai_analyses": 0,
        }));
    }
    let topic_clone = topic.clone();
    let result = tokio::task::spawn_blocking(move || -> serde_json::Map<String, Value> {
        let mut p = serde_json::Map::new();
        p.insert("topic".into(), Value::String(topic_clone.clone()));

        // Helper that runs a `SELECT count(*) AS n FROM ...` and returns the
        // integer or 0 on any error (missing table on fresh install, etc.).
        let count = |sql: &str| -> i64 {
            match crate::db::query_db(&db_path, sql, Some(&p)) {
                Ok(rows) => rows.first()
                    .and_then(|r| r.get("n"))
                    .and_then(|v| v.as_i64())
                    .unwrap_or(0),
                Err(_) => 0,
            }
        };

        let painpoints       = count("SELECT count(*) AS n FROM graph_nodes WHERE topic=:topic AND kind='painpoint'");
        let feature_wishes   = count("SELECT count(*) AS n FROM graph_nodes WHERE topic=:topic AND kind='feature_wish'");
        let workarounds      = count("SELECT count(*) AS n FROM graph_nodes WHERE topic=:topic AND kind='workaround'");
        let products         = count("SELECT count(*) AS n FROM graph_nodes WHERE topic=:topic AND kind='product'");
        let concepts         = count("SELECT count(*) AS n FROM graph_nodes WHERE topic=:topic AND kind='concept'");
        let evidence_papers  = count("SELECT count(*) AS n FROM graph_nodes WHERE topic=:topic AND kind='evidence_paper'");
        let total_findings   = count("SELECT count(*) AS n FROM graph_nodes WHERE topic=:topic");
        let posts            = count("SELECT count(*) AS n FROM topic_posts WHERE topic=:topic");
        let sources          = count(
            "SELECT count(DISTINCT coalesce(p.source_type,'reddit')) AS n \
             FROM topic_posts tp JOIN posts p ON p.id=tp.post_id WHERE tp.topic=:topic"
        );
        let hypotheses       = count("SELECT count(*) AS n FROM hypotheses WHERE topic=:topic");
        let ai_analyses      = count("SELECT count(*) AS n FROM mcp_analyses WHERE topic=:topic");

        let mut m = serde_json::Map::new();
        m.insert("painpoints".into(),       Value::from(painpoints));
        m.insert("feature_wishes".into(),   Value::from(feature_wishes));
        m.insert("workarounds".into(),      Value::from(workarounds));
        m.insert("products".into(),         Value::from(products));
        m.insert("concepts".into(),         Value::from(concepts));
        m.insert("evidence_papers".into(),  Value::from(evidence_papers));
        m.insert("total_findings".into(),   Value::from(total_findings));
        m.insert("posts".into(),            Value::from(posts));
        m.insert("sources".into(),          Value::from(sources));
        m.insert("hypotheses".into(),       Value::from(hypotheses));
        m.insert("ai_analyses".into(),      Value::from(ai_analyses));
        m
    })
    .await
    .map_err(|e| format!("count bundle failed: {e}"))?;
    Ok(Value::Object(result))
}

/// Native rusqlite path for the Papers tab. Mirrors `research papers-list`
/// shape: list of paper rows with derived `pdf_url` and `has_fulltext` flag.
/// Was a Python sidecar call — now ~1 ms on warm WAL.
#[tauri::command]
pub async fn papers_list_native(
    app: AppHandle,
    topic: String,
    limit: Option<u32>,
) -> Result<Value, String> {
    let lim = limit.unwrap_or(200) as i64;
    let dir = crate::cli::data_dir(&app).map_err(err_to_string)?;
    let db_path = dir.join("gapmap.db");
    if !db_path.exists() {
        return Ok(Value::Array(vec![]));
    }
    let topic_clone = topic;
    let lim_clone = lim;
    let result = tokio::task::spawn_blocking(move || -> Result<Vec<Value>, String> {
        let mut p = serde_json::Map::new();
        p.insert("topic".into(), Value::String(topic_clone));
        p.insert("limit".into(), Value::from(lim_clone));
        // LEFT JOIN paper_full_texts to get cached-fulltext flag in one shot.
        // Source filter mirrors Python's `_papers_for_topic`: arxiv, openalex,
        // pubmed, scholar (research-paper sources).
        let sql = "SELECT \
            p.id, p.title, p.author, p.url, p.permalink, \
            COALESCE(p.source_type, 'reddit') AS source_type, \
            p.score, p.num_comments, p.created_utc, p.flair, \
            substr(COALESCE(p.selftext, ''), 1, 500) AS selftext, \
            (CASE \
                WHEN COALESCE(p.source_type,'') = 'arxiv' \
                     AND p.url LIKE '%arxiv.org/abs/%' \
                THEN replace(rtrim(p.url, '/'), '/abs/', '/pdf/') || '.pdf' \
                ELSE '' \
             END) AS pdf_url, \
            (CASE WHEN ft.post_id IS NOT NULL THEN 1 ELSE 0 END) AS has_fulltext \
            FROM topic_posts tp \
            JOIN posts p ON p.id = tp.post_id \
            LEFT JOIN paper_full_texts ft \
                  ON ft.post_id = p.id AND ft.status = 'ok' \
            WHERE tp.topic = :topic \
              AND COALESCE(p.source_type, 'reddit') \
                  IN ('arxiv', 'pubmed', 'openalex', 'scholar', 'semantic_scholar', 'crossref') \
            ORDER BY COALESCE(p.score, 0) DESC, p.created_utc DESC \
            LIMIT :limit";
        match crate::db::query_db(&db_path, sql, Some(&p)) {
            Ok(rows) => {
                // Coerce has_fulltext from i64 to bool for the frontend.
                let mut out: Vec<Value> = Vec::with_capacity(rows.len());
                for mut r in rows {
                    if let Some(obj) = r.as_object_mut() {
                        if let Some(v) = obj.get("has_fulltext").and_then(|v| v.as_i64()) {
                            obj.insert("has_fulltext".into(), Value::Bool(v != 0));
                        }
                    }
                    out.push(r);
                }
                Ok(out)
            }
            // Tables missing on a fresh install — return [] so the UI shows
            // the empty CTA instead of an error card.
            Err(e) => {
                let msg = e.to_string();
                if msg.contains("no such table") {
                    Ok(Vec::new())
                } else {
                    Err(msg)
                }
            }
        }
    })
    .await
    .map_err(|e| format!("papers_list_native failed: {e}"))??;
    Ok(Value::Array(result))
}

/// Native rusqlite path for the Bets tab. Mirrors `research hypothesis-list`.
/// Hydrates `evidence_json` / `tactic_link_json` / `notes_json` JSON columns
/// the same way Python's `_hydrate` did.
#[tauri::command]
pub async fn hypothesis_list_native(
    app: AppHandle,
    topic: Option<String>,
    status: Option<String>,
    include_archived: Option<bool>,
) -> Result<Value, String> {
    let dir = crate::cli::data_dir(&app).map_err(err_to_string)?;
    let db_path = dir.join("gapmap.db");
    if !db_path.exists() {
        return Ok(Value::Array(vec![]));
    }
    let inc_archived = include_archived.unwrap_or(false);
    let topic_clone = topic;
    let status_clone = status;
    let result = tokio::task::spawn_blocking(move || -> Result<Vec<Value>, String> {
        let mut where_parts: Vec<&str> = vec!["1=1"];
        let mut p = serde_json::Map::new();
        if let Some(t) = topic_clone.as_ref() {
            where_parts.push("topic = :topic");
            p.insert("topic".into(), Value::String(t.clone()));
        }
        if let Some(s) = status_clone.as_ref() {
            where_parts.push("status = :status");
            p.insert("status".into(), Value::String(s.clone()));
        } else if !inc_archived {
            where_parts.push("status != 'archived'");
        }
        let where_clause = where_parts.join(" AND ");
        let sql = format!(
            "SELECT * FROM hypothesis_tests WHERE {where_clause} ORDER BY last_updated DESC"
        );
        let p_opt = if p.is_empty() { None } else { Some(&p) };
        match crate::db::query_db(&db_path, &sql, p_opt) {
            Ok(rows) => {
                // Mirror Python's `_hydrate`: card_json → card,
                // linked_evidence → evidence. Everything else stays as-is.
                let mut out: Vec<Value> = Vec::with_capacity(rows.len());
                for mut r in rows {
                    if let Some(obj) = r.as_object_mut() {
                        let card = obj.get("card_json")
                            .and_then(|v| v.as_str())
                            .and_then(|s| serde_json::from_str::<Value>(s).ok())
                            .unwrap_or_else(|| serde_json::json!({}));
                        obj.insert("card".into(), card);
                        let evidence = obj.get("linked_evidence")
                            .and_then(|v| v.as_str())
                            .and_then(|s| serde_json::from_str::<Value>(s).ok())
                            .unwrap_or_else(|| Value::Array(Vec::new()));
                        obj.insert("evidence".into(), evidence);
                    }
                    out.push(r);
                }
                Ok(out)
            }
            Err(e) => {
                let msg = e.to_string();
                if msg.contains("no such table") {
                    Ok(Vec::new())
                } else {
                    Err(msg)
                }
            }
        }
    })
    .await
    .map_err(|e| format!("hypothesis_list_native failed: {e}"))??;
    Ok(Value::Array(result))
}

/// Native bundled fetch for the Solutions tab. Returns:
///   { painpoints: [{ painpoint_id, painpoint_label, metadata_json,
///                    interventions: [...], papers: [...] }] }
/// Replaces 1 + 2*N round-trips (one per painpoint × interventions × papers)
/// with **2 SQL statements** total — one for painpoints, one big JOIN for
/// every intervention and every paper across all painpoints. Matches the
/// frontend's existing render shape so no UI changes are needed.
#[tauri::command]
pub async fn solutions_data_bundle(
    app: AppHandle,
    topic: String,
) -> Result<Value, String> {
    let dir = crate::cli::data_dir(&app).map_err(err_to_string)?;
    let db_path = dir.join("gapmap.db");
    if !db_path.exists() {
        return Ok(serde_json::json!({ "painpoints": [] }));
    }
    let topic_clone = topic;
    let bundle = tokio::task::spawn_blocking(move || -> Result<Value, String> {
        let mut p = serde_json::Map::new();
        p.insert("topic".into(), Value::String(topic_clone.clone()));
        let pp_sql = "SELECT n.id AS painpoint_id, n.label AS painpoint_label, \
                             n.metadata_json \
                      FROM graph_nodes n \
                      WHERE n.topic = :topic AND n.kind = 'painpoint' \
                      ORDER BY n.label";
        let painpoints = match crate::db::query_db(&db_path, pp_sql, Some(&p)) {
            Ok(r) => r,
            Err(e) if e.to_string().contains("no such table") =>
                return Ok(serde_json::json!({ "painpoints": [] })),
            Err(e) => return Err(e.to_string()),
        };
        if painpoints.is_empty() {
            return Ok(serde_json::json!({ "painpoints": [] }));
        }

        // One JOIN to fetch every intervention for every painpoint at once.
        // The mechanism node sits between painpoint and intervention.
        let iv_sql = "SELECT e1.src AS painpoint_id, \
                             iv.id AS id, iv.label AS label, iv.metadata_json \
                      FROM graph_edges e1 \
                      JOIN graph_nodes m ON m.id = e1.dst AND m.kind = 'mechanism' \
                      JOIN graph_edges e2 ON e2.src = m.id AND e2.kind = 'addressed_by' \
                      JOIN graph_nodes iv ON iv.id = e2.dst AND iv.kind = 'intervention' \
                      WHERE e1.kind = 'explained_by' \
                        AND e1.src IN ( \
                          SELECT id FROM graph_nodes \
                          WHERE topic = :topic AND kind = 'painpoint' \
                        )";
        let interventions = match crate::db::query_db(&db_path, iv_sql, Some(&p)) {
            Ok(r) => r,
            Err(_) => Vec::new(),
        };

        // Same idea for evidence-paper edges.
        let pap_sql = "SELECT e.src AS painpoint_id, \
                              p2.id AS id, p2.label AS label, p2.metadata_json \
                       FROM graph_edges e \
                       JOIN graph_nodes p2 ON p2.id = e.dst AND p2.kind = 'evidence_paper' \
                       WHERE e.kind = 'has_evidence' \
                         AND e.src IN ( \
                           SELECT id FROM graph_nodes \
                           WHERE topic = :topic AND kind = 'painpoint' \
                         )";
        let papers = match crate::db::query_db(&db_path, pap_sql, Some(&p)) {
            Ok(r) => r,
            Err(_) => Vec::new(),
        };

        // Bucket into per-painpoint maps.
        let mut iv_by_pp: std::collections::HashMap<String, Vec<Value>> =
            std::collections::HashMap::new();
        for mut row in interventions {
            if let Some(obj) = row.as_object_mut() {
                let pid = obj.remove("painpoint_id")
                    .and_then(|v| v.as_str().map(String::from))
                    .unwrap_or_default();
                iv_by_pp.entry(pid).or_default().push(Value::Object(obj.clone()));
            }
        }
        let mut pap_by_pp: std::collections::HashMap<String, Vec<Value>> =
            std::collections::HashMap::new();
        for mut row in papers {
            if let Some(obj) = row.as_object_mut() {
                let pid = obj.remove("painpoint_id")
                    .and_then(|v| v.as_str().map(String::from))
                    .unwrap_or_default();
                pap_by_pp.entry(pid).or_default().push(Value::Object(obj.clone()));
            }
        }

        // Stitch the bundle.
        let mut bundled: Vec<Value> = Vec::with_capacity(painpoints.len());
        for pp in painpoints {
            if let Some(obj) = pp.as_object() {
                let pid = obj.get("painpoint_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let mut entry = serde_json::Map::new();
                entry.insert("pp".into(), Value::Object(obj.clone()));
                entry.insert("interventions".into(),
                             Value::Array(iv_by_pp.remove(&pid).unwrap_or_default()));
                entry.insert("papers".into(),
                             Value::Array(pap_by_pp.remove(&pid).unwrap_or_default()));
                bundled.push(Value::Object(entry));
            }
        }
        Ok(serde_json::json!({ "painpoints": bundled }))
    })
    .await
    .map_err(|e| format!("solutions_data_bundle failed: {e}"))??;
    Ok(bundle)
}

/// Path to the user's BYOK env file (`~/.config/gapmap/.env`).
///
/// macOS/Linux: `$HOME/.config/gapmap/.env`.
/// Windows: `%USERPROFILE%\.config\gapmap\.env` — `HOME` is not set by
/// default on Windows, so we fall back to `USERPROFILE` (the standard
/// per-user root the OS guarantees). Same `.config/gapmap` suffix is
/// kept so `gapmap reset` (and the bundled `.env` doc) point at the
/// same location on every platform.
fn byok_env_path() -> Result<std::path::PathBuf, String> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|e| format!("HOME/USERPROFILE unset: {e}"))?;
    let dir = std::path::PathBuf::from(home).join(".config").join("gapmap");
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
// We shell out to `gapmap mcp {install,uninstall,status} --json` so all
// the JSON-merge / token-gen / atomic-write logic stays in one place
// (src/gapmap/mcp/install.py), testable from CLI.
//
// Two execution modes for the MCP entry's command:
//   - Dev:  if `.venv/bin/python` is found near CWD → register as
//           `uv --directory <repo> run gapmap mcp serve` (current dev flow).
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
/// `/private/var/folders/.../AppTranslocation/<UUID>/d/Gap Map.app/...`
/// path that reaps when the app quits. Claude saves it, then can't find
/// it on the next launch — the user sees "gapmap" in /mcp but "failed
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
        r#"display dialog "Gap Map needs to live in your Applications folder for MCP and auto-updates to work properly.\n\nMove it now? (recommended)" \
           with title "Move Gap Map to Applications" \
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

    // If something already lives at /Applications/Gap Map.app, ask
    // before clobbering — could be an older version the user wants to
    // keep, or a stuck-installed one we should replace.
    if target.exists() {
        let confirm = r#"display dialog "An older Gap Map.app already lives in /Applications. Replace it with this version?" \
                       with title "Replace existing Gap Map" \
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
        let err = r#"display alert "Couldn't copy Gap Map to /Applications" message "Drag Gap Map.app to /Applications manually, then reopen it from there." as critical"#;
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
    // sibling `gapmap` (or `gapmap.exe` on Windows) is the sidecar.
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    for name in ["gapmap-cli", "gapmap-cli.exe"] {
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
    ensure_mcp_allowed(&app)?;
    run_cli(&app, vec!["mcp", "clients", "--json"]).await.map_err(err_to_string)
}

/// Check whether Gap Map is connected to the chosen MCP client and DB-aligned.
/// `client` defaults to `claude-code` when None/empty.
#[tauri::command]
pub async fn mcp_status(app: AppHandle, client: Option<String>) -> Result<Value, String> {
    ensure_mcp_allowed(&app)?;
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
                        "Gap Map.app is running from {}. Move it to /Applications and re-open from there before clicking Connect.",
                        bin.display()
                    )),
                );
            }
        }
    }
    Ok(result)
}

/// Connect (or re-sync) Gap Map's MCP entry in the chosen client's config.
/// Aligns GAPMAP_DATA_DIR and writes a token to the data dir.
#[tauri::command]
pub async fn mcp_install(app: AppHandle, client: Option<String>) -> Result<Value, String> {
    ensure_mcp_allowed(&app)?;
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
                    "Gap Map.app is running under macOS App Translocation ({}). \
                     This happens when the .app is launched from anywhere other than \
                     /Applications (e.g. from the DMG mount, Downloads, or Desktop). \
                     The translocated path changes on every launch — Claude can't \
                     find the MCP binary after a restart. \
                     \n\nFix: Quit Gap Map. Move (don't copy) Gap Map.app to /Applications. \
                     Run in Terminal: xattr -dr com.apple.quarantine '/Applications/Gap Map.app'. \
                     Reopen from /Applications. MCP will auto-connect on the next launch.",
                    bin_str
                )
            } else if bin_str.starts_with("/Volumes/") {
                format!(
                    "Gap Map.app is running from a mounted disk image ({}). \
                     MCP needs a stable path. Quit Gap Map, drag Gap Map.app to \
                     /Applications (eject the DMG), then open it from /Applications \
                     and click Connect again.",
                    bin_str
                )
            } else {
                format!(
                    "Gap Map.app is running from a temporary location ({}). \
                     Move Gap Map.app to /Applications and reopen it from there.",
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

/// Remove Gap Map's MCP entry from the chosen client's config + delete the token.
#[tauri::command]
pub async fn mcp_uninstall(app: AppHandle, client: Option<String>) -> Result<Value, String> {
    ensure_mcp_allowed(&app)?;
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

// ── CLI symlink to /usr/local/bin/gapmap ──────────────────────────────────
//
// In a DMG install the Python sidecar binary lives at
// `<Gap Map.app>/Contents/MacOS/gapmap-cli-aarch64-apple-darwin` — invisible
// to the user's terminal. These commands manage a symlink at
// `/usr/local/bin/gapmap` pointing at that bundled binary so the recipient
// can `gapmap research collect ...` from anywhere. The link uses
// `osascript with administrator privileges` since /usr/local/bin requires
// sudo on a fresh Mac without homebrew.
//
// Symlink (not copy) so a future app update is picked up automatically.

const CLI_SYMLINK_PATH: &str = "/usr/local/bin/gapmap";

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
        .ok_or_else(|| "Could not locate the bundled gapmap-cli binary. Reinstall Gap Map and try again.".to_string())?;
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

/// Structured activation check — shared by `license_status`, `ensure_mcp_allowed`,
/// and anything else that needs to know *why* a licence is failing (not just
/// that it is). Returns a `(code, human_message)` pair when the device is
/// not fully activated, or `None` when everything checks out.
///
/// Reason codes (stable, safe to match on in UI):
///   - `not_activated`         — no licence state persisted (first-time user)
///   - `device_mismatch`       — stored state is for a different device signature
///   - `token_missing`         — licence state exists but access-token blob is empty
///   - `expired`               — `expires_at` is in the past
///   - `token_device_mismatch` — JWT's device_fingerprint claim ≠ current device
fn compute_activation_reason(app: &AppHandle) -> Result<Option<(String, String)>, String> {
    let sig = build_device_signature(app)?;
    let Some(state) = load_license_state(app)? else {
        return Ok(Some((
            "not_activated".into(),
            "This device has not been activated yet. Activate your licence in onboarding or Settings → Licence.".into(),
        )));
    };
    if state.device_signature != sig {
        return Ok(Some((
            "device_mismatch".into(),
            "Stored licence is for a different device. Re-activate this device to unlock MCP.".into(),
        )));
    }
    let token = read_access_token(&app).unwrap_or_default();
    if token.trim().is_empty() {
        return Ok(Some((
            "token_missing".into(),
            "Activation token is missing from local storage. Re-activate this device to refresh it.".into(),
        )));
    }
    if !is_license_not_expired(&state.expires_at) {
        let when = state.expires_at.clone().unwrap_or_else(|| "unknown".into());
        return Ok(Some((
            "expired".into(),
            format!(
                "Licence expired on {when}. Open the customer portal from Activate → Purchase history to renew, then re-activate."
            ),
        )));
    }
    if !token_matches_device_fingerprint(&token, &sig) {
        return Ok(Some((
            "token_device_mismatch".into(),
            "Activation token does not match this device fingerprint (hostname or hardware changed). Re-activate to refresh.".into(),
        )));
    }
    Ok(None)
}

/// True when the license gate should enforce activation as a precondition
/// for MCP install/uninstall/status. Default OFF so a DMG can be shared
/// without anyone needing an activation key first; flip ON when you start
/// monetising via paid keys.
///
/// Read from `GAPMAP_LICENSE_GATE_ENABLED` env at runtime (truthy:
/// "1", "true", "yes", "on" — anything else is OFF). Runtime not
/// compile-time so the same DMG can be deployed both gated and ungated
/// just by toggling the env (e.g. via a wrapper script that exports it
/// before launching Gap Map.app).
fn license_gate_enabled() -> bool {
    matches!(
        std::env::var("GAPMAP_LICENSE_GATE_ENABLED")
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase()
            .as_str(),
        "1" | "true" | "yes" | "on"
    )
}

#[tauri::command]
pub async fn license_gate_status() -> Result<Value, String> {
    Ok(serde_json::json!({
        "enabled": license_gate_enabled(),
        "env_var": "GAPMAP_LICENSE_GATE_ENABLED",
    }))
}

fn ensure_mcp_allowed(app: &AppHandle) -> Result<(), String> {
    // Feature flag — when OFF (default), MCP install/uninstall/status
    // work regardless of activation. Lets you ship the DMG to anyone
    // without provisioning a key for them first.
    if !license_gate_enabled() {
        return Ok(());
    }
    match compute_activation_reason(app)? {
        None => Ok(()),
        Some((code, msg)) => Err(format!("[mcp:{code}] {msg}")),
    }
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

// ── Video ingest (yt-dlp + faster-whisper) ──────────────────────────────────
//
// Design: docs/video-ingest.md. Flow:
//   ingest_video_preview → yt_dlp.extract_info(download=False) — fast metadata
//   ingest_video         → streaming: download audio, transcribe, insert rows
//   whisper_*            → model catalogue / download / delete / default
//   ytdlp_version|update → overlay auto-updater controls
//
// All wrap the Python CLI (src/gapmap/cli/main.py → ingest video /
// whisper / ytdlp subcommands). Streaming commands emit events the webview
// listens to via @tauri-apps/api/event::listen().

#[tauri::command]
pub async fn ingest_video_preview(app: AppHandle, url: String) -> Result<Value, String> {
    run_cli(
        &app,
        vec!["ingest", "video", "--url", &url, "--preview", "--json"],
    )
    .await
    .map_err(err_to_string)
}

/// Search YouTube via yt-dlp (no API key needed). Returns metadata for up to
/// `limit` videos: id, title, channel, url, thumbnail, duration_s,
/// view_count, published, description. Pair with `ingest_video` to
/// actually transcribe + ingest a chosen result.
#[tauri::command]
pub async fn youtube_search(
    app: AppHandle,
    query: String,
    limit: Option<u32>,
) -> Result<Value, String> {
    let limit_str = limit.unwrap_or(10).to_string();
    run_cli(
        &app,
        vec![
            "ingest", "youtube-search",
            "--query", &query,
            "--limit", &limit_str,
            "--json",
        ],
    )
    .await
    .map_err(err_to_string)
}

#[tauri::command]
pub async fn ingest_video(
    app: AppHandle,
    url: String,
    topic: Option<String>,
    model: Option<String>,
    language: Option<String>,
) -> Result<(), String> {
    let model = model.unwrap_or_else(|| "auto".into());
    let language = language.unwrap_or_else(|| "auto".into());
    let mut args: Vec<String> = vec![
        "ingest".into(), "video".into(),
        "--url".into(), url,
        "--model".into(), model,
        "--language".into(), language,
        "--json".into(),
    ];
    if let Some(t) = topic {
        args.push("--topic".into());
        args.push(t);
    }
    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    run_cli_streaming(&app, arg_refs, "video:progress", "video:done")
        .await
        .map_err(err_to_string)
}

#[tauri::command]
pub async fn whisper_list(app: AppHandle) -> Result<Value, String> {
    run_cli(&app, vec!["whisper", "list", "--json"]).await.map_err(err_to_string)
}

#[tauri::command]
pub async fn whisper_catalogue(app: AppHandle) -> Result<Value, String> {
    run_cli(&app, vec!["whisper", "catalogue", "--json"]).await.map_err(err_to_string)
}

#[tauri::command]
pub async fn whisper_download(app: AppHandle, tier: String) -> Result<(), String> {
    run_cli_streaming(
        &app,
        vec!["whisper", "download", &tier, "--json"],
        "whisper:download-progress",
        "whisper:download-done",
    )
    .await
    .map_err(err_to_string)
}

#[tauri::command]
pub async fn whisper_delete(app: AppHandle, tier: String) -> Result<Value, String> {
    run_cli(&app, vec!["whisper", "delete", &tier, "--json"]).await.map_err(err_to_string)
}

#[tauri::command]
pub async fn whisper_set_default(app: AppHandle, tier: String) -> Result<Value, String> {
    run_cli(&app, vec!["whisper", "default", &tier, "--json"]).await.map_err(err_to_string)
}

#[tauri::command]
pub async fn ytdlp_version(app: AppHandle) -> Result<Value, String> {
    run_cli(&app, vec!["ytdlp", "version", "--json"]).await.map_err(err_to_string)
}

#[tauri::command]
pub async fn ytdlp_update(
    app: AppHandle,
    force: Option<bool>,
) -> Result<Value, String> {
    let mut args: Vec<&str> = vec!["ytdlp", "update", "--json"];
    if force.unwrap_or(false) {
        args.push("--force");
    }
    run_cli(&app, args).await.map_err(err_to_string)
}

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
        let db_path = dir.join("gapmap.db");
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
        let db_path = dir.join("gapmap.db");
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
    let db_path = dir.join("gapmap.db");
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

fn is_license_not_expired(expires_at: &Option<String>) -> bool {
    let Some(raw) = expires_at else { return true; };
    let expiry_date = raw.get(0..10).unwrap_or("").trim();
    if expiry_date.is_empty() {
        return true;
    }
    // ISO date lexical compare is safe for YYYY-MM-DD.
    let today = local_today_iso();
    today.as_str() <= expiry_date
}

fn verify_license_token(token: &str) -> Result<VerifiedTokenClaims, String> {
    let secret = env!("JWT_DESKTOP_SECRET");
    let key = DecodingKey::from_secret(secret.as_bytes());
    let mut validation = Validation::new(Algorithm::HS256);
    // Expiry is checked using the server-issued `expires_at` field for this
    // app flow; keep JWT exp soft to avoid hard lockout during transient clock
    // drift. Signature + issuer + audience are still strictly verified.
    validation.validate_exp = false;
    validation.set_issuer(&["gapmap-activation-suite"]);
    validation.set_audience(&["gapmap-desktop"]);
    decode::<VerifiedTokenClaims>(token, &key, &validation)
        .map(|d| d.claims)
        .map_err(|e| format!("invalid activation token: {e}"))
}

fn token_matches_device_fingerprint(token: &str, expected_sig: &str) -> bool {
    match verify_license_token(token) {
        Ok(claims) => match claims.device_fingerprint.as_deref() {
            Some(fp) => fp == expected_sig,
            None => false,
        },
        Err(_) => false,
    }
}

fn normalize_activation_key(raw: &str) -> Result<String, String> {
    let cleaned = raw
        .trim()
        .replace('-', "")
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect::<String>()
        .to_uppercase();
    if cleaned.len() != 16 {
        return Err("activation key must be 16 chars (format XXXX-XXXX-XXXX-XXXX)".into());
    }
    let is_allowed = cleaned.chars().all(|c| matches!(c, 'A'..='Z' | '2'..='9'));
    if !is_allowed {
        return Err("activation key may only use A-Z and 2-9 (no 0/1)".into());
    }
    Ok(cleaned)
}

fn license_token_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = data_dir(app).map_err(err_to_string)?;
    std::fs::create_dir_all(&dir).map_err(err_to_string)?;
    Ok(dir.join(LICENSE_TOKEN_FILE))
}

fn save_access_token(app: &AppHandle, token: &str) -> Result<(), String> {
    let path = license_token_path(app)?;
    std::fs::write(&path, token).map_err(err_to_string)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    if let Ok(mut guard) = TOKEN_CACHE.lock() {
        *guard = Some(Some(token.to_string()));
    }
    Ok(())
}

fn read_access_token(app: &AppHandle) -> Option<String> {
    // Fast path: cache is populated (positive or negative).
    if let Ok(guard) = TOKEN_CACHE.lock() {
        if let Some(cached) = guard.as_ref() {
            return cached.clone();
        }
    }
    // Cold path: read the file. Never prompts the user (file is owned by
    // the user and 0600-read-permissioned), so this replaces the Keychain
    // round-trip that was triggering macOS's login prompt on every rebuild.
    let path = match license_token_path(app) {
        Ok(p) => p,
        Err(_) => {
            if let Ok(mut guard) = TOKEN_CACHE.lock() {
                *guard = Some(None);
            }
            return None;
        }
    };
    let mut fetched: Option<String> = std::fs::read_to_string(&path)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    // Fallback / migration path. Older builds stored the activation JWT in
    // the macOS Keychain (later in this file before 2026-04-24) — when we
    // moved to file-based storage existing users were left with no token at
    // the new location. `license_state.json` *also* persists `access_token`
    // in plain text, so we can recover it from there silently and then
    // promote it to the canonical file location on first read. Without
    // this, every previously-activated user hits `[mcp:token_missing]` on
    // their first launch after the upgrade and the MCP card just spins.
    if fetched.is_none() {
        if let Ok(Some(state)) = load_license_state(app) {
            let from_state = state.access_token.trim().to_string();
            if !from_state.is_empty() {
                fetched = Some(from_state.clone());
                // Best-effort write-through so the next read goes straight
                // to the file. Failures here are non-fatal — we still have
                // the value in memory + license_state.json.
                if let Err(e) = std::fs::write(&path, &from_state) {
                    eprintln!("[license] migrate token to file failed: {e}");
                } else {
                    #[cfg(unix)]
                    {
                        use std::os::unix::fs::PermissionsExt;
                        let _ = std::fs::set_permissions(
                            &path,
                            std::fs::Permissions::from_mode(0o600),
                        );
                    }
                }
            }
        }
    }

    if let Ok(mut guard) = TOKEN_CACHE.lock() {
        *guard = Some(fetched.clone());
    }
    fetched
}

fn clear_access_token(app: &AppHandle) {
    if let Ok(path) = license_token_path(app) {
        let _ = std::fs::remove_file(&path);
    }
    if let Ok(mut guard) = TOKEN_CACHE.lock() {
        *guard = Some(None);
    }
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

fn license_state_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = data_dir(app).map_err(err_to_string)?;
    std::fs::create_dir_all(&dir).map_err(err_to_string)?;
    Ok(dir.join("license_state.json"))
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
    let seed = format!("gapmap|{}|{}|{}", os, arch, stable);
    let mut hasher = Sha256::new();
    hasher.update(seed.as_bytes());
    Ok(format!("{:x}", hasher.finalize()))
}

fn load_license_state(app: &AppHandle) -> Result<Option<LicenseState>, String> {
    let path = license_state_path(app)?;
    if !path.exists() {
        return Ok(None);
    }
    let raw = std::fs::read_to_string(&path).map_err(err_to_string)?;
    let parsed: LicenseState = serde_json::from_str(&raw).map_err(err_to_string)?;
    Ok(Some(parsed))
}

fn save_license_state(app: &AppHandle, state: &LicenseState) -> Result<(), String> {
    let path = license_state_path(app)?;
    let mut safe = state.clone();
    safe.access_token = String::new();
    let raw = serde_json::to_string_pretty(&safe).map_err(err_to_string)?;
    std::fs::write(&path, raw).map_err(err_to_string)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
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

#[tauri::command]
pub async fn license_status(app: AppHandle) -> Result<Value, String> {
    let sig = build_device_signature(&app)?;
    let reason = compute_activation_reason(&app)?;
    let state = load_license_state(&app)?;
    let activated = reason.is_none();
    let (reason_code, reason_msg) = match reason {
        Some((c, m)) => (Some(c), Some(m)),
        None => (None, None),
    };
    if let Some(s) = state {
        return Ok(serde_json::json!({
            "activated": activated,
            "reason_code": reason_code,
            "reason": reason_msg,
            "email": s.email,
            "license_id": s.license_id,
            "device_signature": sig,
            "expires_at": s.expires_at,
            "last_verified_at": s.last_verified_at,
            "api_base": s.api_base
        }));
    }
    Ok(serde_json::json!({
        "activated": false,
        "reason_code": reason_code.unwrap_or_else(|| "not_activated".into()),
        "reason": reason_msg.unwrap_or_else(|| "This device has not been activated yet.".into()),
        "device_signature": sig
    }))
}

#[derive(Debug, serde::Serialize)]
struct ActivateRequest<'a> {
    email: &'a str,
    password: &'a str,
    activation_key: &'a str,
    device_signature: &'a str,
    app: &'a str,
    os: &'a str,
    arch: &'a str,
    onboarding: Option<&'a Value>,
}

#[derive(Debug, serde::Deserialize)]
struct ActivateResponse {
    ok: Option<bool>,
    token: Option<String>,
    access_token: Option<String>,
    license_id: Option<String>,
    user_id: Option<String>,
    expires_at: Option<String>,
}

#[tauri::command]
pub async fn license_activate(
    app: AppHandle,
    api_base: String,
    email: String,
    password: String,
    activation_key: String,
    onboarding: Option<Value>,
) -> Result<Value, String> {
    let base = api_base.trim().trim_end_matches('/').to_string();
    if base.is_empty() {
        return Err("license api base is required".into());
    }
    if email.trim().is_empty() || password.trim().is_empty() || activation_key.trim().is_empty() {
        return Err("email, password and activation key are required".into());
    }
    let cleaned_key = normalize_activation_key(&activation_key)?;
    let sig = build_device_signature(&app)?;
    let endpoint = format!("{}/v1/device/activate", base);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(err_to_string)?;
    let payload = ActivateRequest {
        email: email.trim(),
        password: password.trim(),
        activation_key: &cleaned_key,
        device_signature: &sig,
        app: "gapmap-desktop",
        os: std::env::consts::OS,
        arch: std::env::consts::ARCH,
        onboarding: onboarding.as_ref(),
    };
    let resp = client
        .post(endpoint)
        .json(&payload)
        .send()
        .await
        .map_err(err_to_string)?;
    let status = resp.status();
    let body = resp.text().await.map_err(err_to_string)?;
    if !status.is_success() {
        return Err(format!("activation failed ({}): {}", status.as_u16(), body));
    }
    let parsed: ActivateResponse = serde_json::from_str(&body).map_err(|e| {
        format!("activation response is not valid JSON: {} | body={}", e, body)
    })?;
    let ok = parsed.ok.unwrap_or(true);
    let token = parsed.access_token.or(parsed.token).unwrap_or_default();
    let license_id = parsed.license_id.unwrap_or_default();
    if !ok || token.is_empty() || license_id.is_empty() {
        return Err("activation response missing token/license_id".into());
    }
    // Hard requirement from licence spec: token must be signed with baked secret
    // and bound to this device fingerprint before we persist it.
    let claims = verify_license_token(&token)?;
    if claims.device_fingerprint.as_deref() != Some(sig.as_str()) {
        return Err("activation token belongs to a different device".into());
    }
    let state = LicenseState {
        api_base: base,
        email: email.trim().to_string(),
        license_id: license_id.clone(),
        activation_key: cleaned_key,
        device_signature: sig.clone(),
        access_token: token,
        user_id: parsed.user_id,
        expires_at: parsed.expires_at.clone(),
        last_verified_at: Some(local_today_iso()),
    };
    save_access_token(&app, &state.access_token)?;
    save_license_state(&app, &state)?;
    Ok(serde_json::json!({
        "ok": true,
        "activated": true,
        "license_id": license_id,
        "device_signature": sig,
        "expires_at": parsed.expires_at
    }))
}

#[tauri::command]
pub async fn license_server_check(api_base: String) -> Result<Value, String> {
    let base = api_base.trim().trim_end_matches('/').to_string();
    if base.is_empty() {
        return Err("license api base is required".into());
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(err_to_string)?;
    let probes = [
        format!("{}/v1/health", base),
        format!("{}/health", base),
        format!("{}/healthz", base),
    ];
    let mut last_err = String::new();
    for url in probes {
        match client.get(&url).send().await {
            Ok(resp) => {
                if resp.status().is_success() {
                    return Ok(serde_json::json!({
                        "ok": true,
                        "url": url,
                        "status": resp.status().as_u16()
                    }));
                }
                last_err = format!("{} -> HTTP {}", url, resp.status().as_u16());
            }
            Err(e) => {
                last_err = format!("{} -> {}", url, e);
            }
        }
    }
    Err(format!("license server not reachable: {}", last_err))
}

/// Default License API URL pre-filled into onboarding Step 6.
///
/// Priority:
///   1. `GAPMAP_LICENSE_API_BASE` env (highest — set by user/op for testing).
///   2. `LICENSE_API_BASE` env (legacy alias).
///   3. Compile-time constant `DEFAULT_LICENSE_API_BASE`.
///
/// Baking the URL into the binary means a DMG recipient sees
/// `https://gapmap.myind.ai` pre-filled in onboarding — they don't have
/// to know it. Override via env for staging / localhost dev.
const DEFAULT_LICENSE_API_BASE: &str = "https://gapmap.myind.ai";

#[tauri::command]
pub async fn license_default_api_base() -> Result<Value, String> {
    let from_env = std::env::var("GAPMAP_LICENSE_API_BASE")
        .or_else(|_| std::env::var("LICENSE_API_BASE"))
        .unwrap_or_default();
    let base = from_env.trim().trim_end_matches('/').to_string();
    let final_base = if base.is_empty() {
        DEFAULT_LICENSE_API_BASE.to_string()
    } else {
        base
    };
    Ok(serde_json::json!({
        "api_base": final_base
    }))
}

#[tauri::command]
pub async fn license_logout(app: AppHandle) -> Result<Value, String> {
    let path = license_state_path(&app)?;
    if path.exists() {
        let _ = std::fs::remove_file(path);
    }
    clear_access_token(&app);
    Ok(serde_json::json!({ "ok": true }))
}

// ════════════════════════════════════════════════════════════════════════
//  App reset / clean-install — Danger Zone in Settings.
//
//  Three commands powering the "start fresh on this machine" flow:
//    1. `app_reset_preview` — read-only summary of what would be
//       deleted (paths, sizes, topic count, license email, BYOK
//       provider list). Drives the confirmation modal so users know
//       exactly what's going away before they type DELETE.
//    2. `app_hard_reset` — wipes the entire data_dir contents
//       (SQLite + license_state.json + caches + schedule.log) AND
//       the BYOK env file. Caller (FE) is responsible for clearing
//       localStorage and triggering relaunch.
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
/// otherwise an `~/Library/Application Support/com.shantanu.gapmap/gapmap`
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
///   - `sqlite_present`: whether `gapmap.sqlite` exists.
///   - `topic_count`: distinct topics with at least one post (0 if no DB).
///   - `license_present`, `license_email`: license_state.json status.
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
    let sqlite_path = data.join("gapmap.sqlite");
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

    // License email — best-effort parse, never error out.
    let license_path = data.join("license_state.json");
    let license_present = license_path.exists();
    let mut license_email: Option<String> = None;
    if license_present {
        if let Ok(content) = std::fs::read_to_string(&license_path) {
            if let Ok(json) = serde_json::from_str::<Value>(&content) {
                license_email = json
                    .get("email")
                    .and_then(|v| v.as_str())
                    .map(String::from)
                    // Some license payloads nest under "user".
                    .or_else(|| {
                        json.get("user")
                            .and_then(|u| u.get("email"))
                            .and_then(|v| v.as_str())
                            .map(String::from)
                    });
            }
        }
    }

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

    // BYOK env file — delete the file but leave the .config/gapmap
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

