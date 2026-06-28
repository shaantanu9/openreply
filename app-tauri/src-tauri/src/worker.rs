//! Rust-side supervisor for the Python extraction worker.
//!
//! The worker is a long-lived Python sidecar (`research enrich-worker --serve`)
//! that drains the `extraction_queue` SQLite table in batches of 5. It emits
//! newline-delimited JSON events on stdout like `{"_event":"enrich:tick",...}`
//! which we re-emit to the frontend as Tauri events of the same name.
//!
//! Why its own state (not `ActiveJob`)? A collect / chat is a short-lived job
//! with a cancel button. The worker is a background daemon — `cancel_active_job`
//! MUST NOT reap it. It has its own `ExtractionWorker` state slot and its own
//! start/stop commands.
//!
//! Supervised restart: on crash (non-clean exit) we restart with exponential
//! backoff (1s, 5s, 30s). After 3 restarts within 5 min we give up and emit
//! `enrich:supervisor-gave-up` so the frontend can show a banner.

use anyhow::{anyhow, Result};
use serde_json::Value;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};

/// Max restarts allowed inside RESTART_WINDOW before giving up.
const RESTART_MAX: u32 = 3;
/// Sliding window for counting restarts.
const RESTART_WINDOW: Duration = Duration::from_secs(300);
/// Backoff ladder — index = restart attempt number.
const BACKOFF_LADDER: [u64; 3] = [1, 5, 30];

/// Post-count threshold beyond which the incremental extraction worker
/// auto-starts. Any topic with ≥ this many rows in `topic_posts` unlocks
/// Phase-B (async extraction). Below this, the collect-screen still
/// accumulates posts but findings aren't extracted yet.
pub const ENRICH_THRESHOLD: u64 = 100;

/// Shared state for the extraction worker. Exposed as Tauri managed state
/// (wrap in `Arc` when registering via `.manage()`).
#[derive(Default)]
pub struct ExtractionWorker {
    /// Child process handle — `Some` while the worker is running. Only the
    /// sidecar path stores a real `CommandChild`; the dev-python branch falls
    /// back to tracking the raw OS pid via `child_pid`.
    pub child: Mutex<Option<CommandChild>>,
    /// Raw OS pid when we spawned via `tokio::process::Command` (dev path).
    /// `None` when sidecar path is used — `CommandChild::kill()` is enough.
    pub child_pid: Mutex<Option<u32>>,
    /// Timestamp of the last `enrich:tick` event — UI shows "Updated Xs ago".
    pub last_tick: Mutex<Option<SystemTime>>,
    /// Cumulative count of posts processed across all batches since boot.
    pub processed_total: Mutex<u64>,
    /// Current depth of the extraction_queue (updated per tick).
    pub queued: Mutex<u64>,
    /// Last ms a batch took (for the status card).
    pub last_batch_ms: Mutex<u64>,
    /// Last error surfaced from the worker. Cleared on next successful tick.
    pub last_error: Mutex<Option<String>>,
    /// Count of supervised restarts within the current sliding window.
    pub restart_count: Mutex<u32>,
    /// Most recent restart time — used to reset the counter once the window
    /// expires.
    pub last_restart: Mutex<Option<Instant>>,
    /// Set true when the app is shutting down — prevents the supervisor from
    /// respawning a child that was killed intentionally by the exit handler.
    pub shutting_down: Mutex<bool>,
    /// True while a start attempt is in flight. Guards `start_worker` against
    /// racing frontend double-taps.
    pub starting: Mutex<bool>,
}

/// SIGTERM any `enrich-worker --serve` Python processes other than ours
/// before we spawn a new one. Defends against the dev-restart leak where
/// the previous Tauri process exited but its child (the worker) survived
/// orphaned and holds a SQLite write-lock + ~300 MB of ChromaDB+ONNX state.
///
/// Implementation: shell out to `pgrep -f` (BSD/macOS + GNU/Linux ship it),
/// SIGTERM each matching pid that isn't this process. SIGKILL after 1s for
/// stragglers. Returns count killed; errors are intentionally swallowed —
/// a worker we couldn't reap is a smaller problem than failing to start a
/// new one because pgrep didn't exist on a weird system.
fn reap_orphan_workers() -> usize {
    let own_pid = std::process::id();
    let pgrep_out = match std::process::Command::new("pgrep")
        .args(["-f", "enrich-worker --serve"])
        .output()
    {
        Ok(o) => o,
        Err(_) => return 0,
    };
    if !pgrep_out.status.success() {
        return 0;  // no matches — nothing to do
    }
    let stdout = String::from_utf8_lossy(&pgrep_out.stdout);
    let pids: Vec<u32> = stdout
        .lines()
        .filter_map(|l| l.trim().parse::<u32>().ok())
        .filter(|p| *p != own_pid)
        .collect();
    if pids.is_empty() {
        return 0;
    }
    eprintln!("[worker] reaping {} orphan worker(s): {:?}", pids.len(), pids);
    for pid in &pids {
        let _ = std::process::Command::new("kill")
            .args(["-TERM", &pid.to_string()])
            .output();
    }
    // Brief grace period for clean exit, then SIGKILL stragglers.
    std::thread::sleep(std::time::Duration::from_millis(1000));
    for pid in &pids {
        // `kill -0` checks if pid is alive; ignore exit code, just SIGKILL
        // on best-effort. This loop's worst case is "we sigkill an already-
        // dead pid" → kill returns 1, harmless.
        let still_alive = std::process::Command::new("kill")
            .args(["-0", &pid.to_string()])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        if still_alive {
            let _ = std::process::Command::new("kill")
                .args(["-KILL", &pid.to_string()])
                .output();
        }
    }
    pids.len()
}

/// Idempotent start. If the worker is already running (child slot non-empty
/// OR a start is currently in flight), returns Ok(()) without doing anything.
///
/// Spawns the sidecar with `research enrich-worker --serve`, streams stdout
/// line-by-line, and re-emits every `{_event: "..."}` line as a Tauri event
/// of the same name with the remaining JSON as the payload.
///
/// On non-clean exit (crash / OOM), schedules a supervised restart unless
/// we've already restarted 3 times in the last 5 min.
pub async fn start_worker(app: AppHandle) -> Result<(), String> {
    let state = match app.try_state::<Arc<ExtractionWorker>>() {
        Some(s) => s.inner().clone(),
        None => return Err("ExtractionWorker state not registered".into()),
    };

    // Already running or starting? No-op.
    {
        let child_guard = state.child.lock().map_err(|e| e.to_string())?;
        if child_guard.is_some() {
            return Ok(());
        }
    }
    {
        let pid_guard = state.child_pid.lock().map_err(|e| e.to_string())?;
        if pid_guard.is_some() {
            return Ok(());
        }
    }
    {
        let mut starting = state.starting.lock().map_err(|e| e.to_string())?;
        if *starting {
            return Ok(());
        }
        *starting = true;
    }

    // Reset the shutting_down flag — we're explicitly starting.
    {
        let mut sd = state.shutting_down.lock().map_err(|e| e.to_string())?;
        *sd = false;
    }

    let data = crate::cli::data_dir(&app).map_err(|e| e.to_string())?;
    let data_str = data.to_string_lossy().to_string();

    // Sweep for orphan workers BEFORE spawning. Tauri-dev restarts (HMR,
    // SIGINT + relaunch) leave the previous worker process running parented
    // to the now-dead old Rust process — by the time we get here, our
    // in-memory state thinks no worker exists, and we'd spawn a second one.
    // Two workers racing on the same SQLite write-lock + each holding
    // ~200-400 MB of ChromaDB+ONNX state is a real memory leak (observed:
    // 3 stacked workers after a few dev cycles, app got hangy + RSS spiked).
    // Kill anything matching `enrich-worker --serve` that ISN'T this child.
    // Best-effort: pgrep / kill failures are fine — the spawn below will
    // still succeed even if a stragler survives, and the python side has
    // its own pid-file lock as a last line of defense.
    let _ = reap_orphan_workers();

    // Dev bypass: if a .venv/bin/python is near CWD, skip the PyInstaller
    // sidecar for the same reason run_cli_streaming does — macOS Gatekeeper
    // verification on the bundled binary can hang 2+ minutes per spawn,
    // which is unusable for a long-lived worker that restarts on crash.
    let spawn_result = if let Some(py) = crate::cli::find_dev_venv_python_pub() {
        spawn_dev_python_worker(&app, state.clone(), py, &data_str).await
    } else {
        spawn_sidecar_worker(&app, state.clone(), &data_str).await
    };

    {
        let mut starting = state.starting.lock().map_err(|e| e.to_string())?;
        *starting = false;
    }
    spawn_result.map_err(|e| e.to_string())
}

/// Spawn the prod PyInstaller sidecar and wire its stdout/stderr → events.
async fn spawn_sidecar_worker(
    app: &AppHandle,
    state: Arc<ExtractionWorker>,
    data_str: &str,
) -> Result<()> {
    let cmd = app
        .shell()
        .sidecar("openreply-cli")
        .map_err(|e| anyhow!("sidecar missing: {e}"))?
        .args(["research", "enrich-worker", "--serve"])
        .env("OPENREPLY_DATA_DIR", data_str)
        .env("PYTHONUNBUFFERED", "1");

    let (mut rx, child) = cmd
        .spawn()
        .map_err(|e| anyhow!("sidecar spawn failed: {e}"))?;

    {
        let mut guard = state.child.lock().map_err(|e| anyhow!("{e}"))?;
        *guard = Some(child);
    }

    let app_clone = app.clone();
    let state_clone = state.clone();
    let data_str_owned = data_str.to_string();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) | CommandEvent::Stderr(bytes) => {
                    if let Ok(s) = String::from_utf8(bytes) {
                        for line in s.lines() {
                            let line = line.trim();
                            if line.is_empty() {
                                continue;
                            }
                            handle_worker_line(&app_clone, &state_clone, line);
                        }
                    }
                }
                CommandEvent::Terminated(payload) => {
                    {
                        let mut guard = state_clone.child.lock().unwrap();
                        *guard = None;
                    }
                    let code = payload.code.unwrap_or(-1);
                    on_worker_exit(
                        app_clone.clone(),
                        state_clone.clone(),
                        code,
                        data_str_owned.clone(),
                    );
                    break;
                }
                _ => {}
            }
        }
    });

    Ok(())
}

/// Dev path — spawn `.venv/bin/python -m openreply.cli.main research
/// enrich-worker --serve` via tokio::process so we bypass Gatekeeper.
async fn spawn_dev_python_worker(
    app: &AppHandle,
    state: Arc<ExtractionWorker>,
    py: std::path::PathBuf,
    data_str: &str,
) -> Result<()> {
    use std::process::Stdio;
    use tokio::io::{AsyncBufReadExt, BufReader};

    let mut cmd = tokio::process::Command::new(&py);
    cmd.arg("-m")
        .arg("openreply.cli.main")
        .arg("research")
        .arg("enrich-worker")
        .arg("--serve")
        .env("OPENREPLY_DATA_DIR", data_str)
        .env("PYTHONUNBUFFERED", "1")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| anyhow!("dev python spawn failed: {e}"))?;

    if let Some(pid) = child.id() {
        let mut guard = state.child_pid.lock().map_err(|e| anyhow!("{e}"))?;
        *guard = Some(pid);
    }

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| anyhow!("no stdout pipe"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| anyhow!("no stderr pipe"))?;

    // stdout — primary event stream (NDJSON)
    let app_a = app.clone();
    let state_a = state.clone();
    tauri::async_runtime::spawn(async move {
        let mut reader = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            let line = line.trim().to_string();
            if line.is_empty() {
                continue;
            }
            handle_worker_line(&app_a, &state_a, &line);
        }
    });

    // stderr — log-only, never parsed as events. Route to enrich:log so the
    // UI can show a worker-log panel for debugging.
    let app_b = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut reader = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            let line = line.trim().to_string();
            if line.is_empty() {
                continue;
            }
            let _ = app_b.emit("enrich:log", line);
        }
    });

    let app_c = app.clone();
    let state_c = state.clone();
    let data_str_owned = data_str.to_string();
    tauri::async_runtime::spawn(async move {
        let status = child.wait().await;
        {
            let mut guard = state_c.child_pid.lock().unwrap();
            *guard = None;
        }
        let code = status.ok().and_then(|s| s.code()).unwrap_or(-1);
        on_worker_exit(app_c, state_c, code, data_str_owned);
    });

    Ok(())
}

/// Parse a worker stdout line as JSON; if it's a `{_event: "..."}` dict,
/// re-emit that event to the frontend with the rest of the payload as the
/// event body. Also updates the shared state (processed_total, queued,
/// last_tick, last_batch_ms, last_error).
fn handle_worker_line(app: &AppHandle, state: &Arc<ExtractionWorker>, line: &str) {
    let parsed: Result<Value, _> = serde_json::from_str(line);
    let Ok(Value::Object(mut obj)) = parsed else {
        // Not JSON — log to a side channel so the dev console can still see
        // Python tracebacks / prints. Don't spam main events.
        let _ = app.emit("enrich:log", line.to_string());
        return;
    };

    let Some(event_name_value) = obj.remove("_event") else {
        let _ = app.emit("enrich:log", line.to_string());
        return;
    };
    let Some(event_name) = event_name_value.as_str() else {
        return;
    };
    let event_name = event_name.to_string();

    // Stash stats from tick events so status queries are instant.
    match event_name.as_str() {
        "enrich:tick" => {
            if let Ok(mut t) = state.last_tick.lock() {
                *t = Some(SystemTime::now());
            }
            if let Some(n) = obj.get("processed").and_then(|v| v.as_u64()) {
                if let Ok(mut total) = state.processed_total.lock() {
                    *total = total.saturating_add(n);
                }
            }
            if let Some(q) = obj.get("queued").and_then(|v| v.as_u64()) {
                if let Ok(mut g) = state.queued.lock() {
                    *g = q;
                }
            }
            if let Some(ms) = obj.get("duration_ms").and_then(|v| v.as_u64()) {
                if let Ok(mut m) = state.last_batch_ms.lock() {
                    *m = ms;
                }
            }
            // Clear stale error on a good tick.
            if let Ok(mut e) = state.last_error.lock() {
                *e = None;
            }
        }
        "enrich:idle" => {
            if let Some(q) = obj.get("queued").and_then(|v| v.as_u64()) {
                if let Ok(mut g) = state.queued.lock() {
                    *g = q;
                }
            }
        }
        "enrich:error" | "enrich:oom" => {
            if let Some(msg) = obj.get("message").and_then(|v| v.as_str()) {
                if let Ok(mut e) = state.last_error.lock() {
                    *e = Some(msg.to_string());
                }
            }
        }
        _ => {}
    }

    let payload = Value::Object(obj);
    let _ = app.emit(&event_name, payload);
}

/// Supervised exit handler. Schedules a restart unless we're shutting down
/// or have already restarted too many times.
fn on_worker_exit(
    app: AppHandle,
    state: Arc<ExtractionWorker>,
    code: i32,
    _data_str: String,
) {
    // Fire an exit notification so the frontend knows the worker died.
    let _ = app.emit(
        "enrich:exited",
        serde_json::json!({ "code": code }),
    );

    // If the exit handler / user initiated shutdown, do NOT restart.
    if let Ok(sd) = state.shutting_down.lock() {
        if *sd {
            return;
        }
    }

    // OOM (exit 137) is the memory governor doing its job — it intentionally
    // exits so we restart with fresh memory after dropping chromadb+ONNX.
    // That is RECOVERABLE and expected under heavy extraction, so it must NOT
    // count toward the crash give-up window (otherwise 3 OOM-recycles in 300s
    // wrongly trips "extraction worker gave up"). Restart with a short backoff
    // and leave the crash counter untouched; only genuine crashes (import
    // error, segfault, non-137 non-clean exits) accrue toward give-up.
    if code == 137 {
        let app_spawn = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_secs(3)).await;
            let _ = start_worker(app_spawn).await;
        });
        return;
    }

    // Tally restarts within the sliding window.
    let now = Instant::now();
    let (attempt_idx, give_up) = {
        let mut count = state.restart_count.lock().unwrap();
        let mut last = state.last_restart.lock().unwrap();
        // Reset counter if the window has expired since last restart.
        if let Some(prev) = *last {
            if now.duration_since(prev) > RESTART_WINDOW {
                *count = 0;
            }
        }
        if *count >= RESTART_MAX {
            (0, true)
        } else {
            let idx = *count as usize;
            *count += 1;
            *last = Some(now);
            (idx.min(BACKOFF_LADDER.len() - 1), false)
        }
    };

    if give_up {
        // Surface a "worker is dead, user intervention needed" banner.
        let _ = app.emit(
            "enrich:supervisor-gave-up",
            serde_json::json!({
                "restarts": RESTART_MAX,
                "window_secs": RESTART_WINDOW.as_secs(),
            }),
        );
        return;
    }

    let delay_secs = BACKOFF_LADDER[attempt_idx];
    let app_spawn = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(delay_secs)).await;
        // Best-effort — if start_worker errors here we rely on another
        // `enrich:exited` to retry up to RESTART_MAX.
        let _ = start_worker(app_spawn).await;
    });
}

/// Stop the worker (SIGTERM child, mark shutting_down so the supervisor
/// doesn't restart it). Idempotent — no-op if not running.
pub async fn stop_worker(app: AppHandle) -> Result<(), String> {
    stop_worker_blocking(&app);
    Ok(())
}

/// Synchronous variant used by the Tauri `ExitRequested` handler — fires
/// SIGTERM before the app exits so no zombie Python process is left behind.
pub fn stop_worker_blocking(app: &AppHandle) {
    // Pull the Arc out of the State borrow immediately so the State<'_, T>
    // temporary drops before we start locking mutexes. Without this dance
    // the compiler complains that `state` (still bound to the State borrow)
    // outlives `app` at end-of-scope.
    let state: Arc<ExtractionWorker> = {
        let s = match app.try_state::<Arc<ExtractionWorker>>() {
            Some(s) => s,
            None => return,
        };
        s.inner().clone()
    };
    if let Ok(mut sd) = state.shutting_down.lock() {
        *sd = true;
    };
    if let Ok(mut guard) = state.child.lock() {
        if let Some(child) = guard.take() {
            let _ = child.kill();
        }
    };
    if let Ok(mut guard) = state.child_pid.lock() {
        if let Some(pid) = guard.take() {
            kill_pid(pid);
        }
    };
}

/// Best-effort SIGTERM on a Unix pid. On Windows we shell out to taskkill.
fn kill_pid(pid: u32) {
    #[cfg(unix)]
    {
        let _ = std::process::Command::new("kill")
            .arg("-TERM")
            .arg(pid.to_string())
            .status();
    }
    #[cfg(windows)]
    {
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/F"])
            .status();
    }
}

/// Write an atomic JSON file at `{data_dir}/.active_topics.json` mapping
/// `topic → unix_ts_secs`. The Python worker reads this to prioritize
/// currently-viewed topics in the drain order.
///
/// Atomicity: write to `.active_topics.json.tmp` then `rename` — on POSIX,
/// rename is atomic within the same filesystem. Without this, the worker
/// could `read` a partially-written file on macOS and get an empty set.
pub fn mark_active(app: &AppHandle, topic: &str) -> Result<(), String> {
    if topic.trim().is_empty() {
        return Err("topic is empty".into());
    }
    let dir = crate::cli::data_dir(app).map_err(|e| e.to_string())?;
    let path = dir.join(".active_topics.json");
    let tmp = dir.join(".active_topics.json.tmp");

    // Load existing map. On parse error or missing file, start fresh.
    let mut map: std::collections::HashMap<String, u64> = match std::fs::read_to_string(&path) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(_) => std::collections::HashMap::new(),
    };
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    map.insert(topic.to_string(), now);

    // Evict entries older than 1h so the file doesn't grow unbounded.
    let cutoff = now.saturating_sub(3600);
    map.retain(|_, ts| *ts > cutoff);

    let body = serde_json::to_string(&map).map_err(|e| e.to_string())?;
    std::fs::write(&tmp, body).map_err(|e| format!("write tmp: {e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("rename: {e}"))
}

// ───────────────────────── Tauri commands ─────────────────────────

/// Start the extraction worker if it isn't already running. Idempotent.
#[tauri::command]
pub async fn start_extraction_worker(app: AppHandle) -> Result<(), String> {
    start_worker(app).await
}

/// Stop the extraction worker. Idempotent.
#[tauri::command]
pub async fn stop_extraction_worker(app: AppHandle) -> Result<(), String> {
    stop_worker(app).await
}

/// Current worker status — used by the Settings → Extraction card and the
/// topic-page freshness badge.
#[tauri::command]
pub async fn extraction_worker_status(app: AppHandle) -> Result<Value, String> {
    let state = app
        .try_state::<Arc<ExtractionWorker>>()
        .ok_or_else(|| "ExtractionWorker state not registered".to_string())?
        .inner()
        .clone();

    let running = {
        let c1 = state.child.lock().map_err(|e| e.to_string())?;
        let c2 = state.child_pid.lock().map_err(|e| e.to_string())?;
        c1.is_some() || c2.is_some()
    };
    let queued = *state.queued.lock().map_err(|e| e.to_string())?;
    let processed_total = *state.processed_total.lock().map_err(|e| e.to_string())?;
    let last_batch_ms = *state.last_batch_ms.lock().map_err(|e| e.to_string())?;
    let last_error = state
        .last_error
        .lock()
        .map_err(|e| e.to_string())?
        .clone();
    let last_tick_iso = state
        .last_tick
        .lock()
        .map_err(|e| e.to_string())?
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs());

    Ok(serde_json::json!({
        "running": running,
        "queued": queued,
        "processed_total": processed_total,
        "last_batch_ms": last_batch_ms,
        "last_error": last_error,
        // Frontend converts secs → ISO / relative via new Date(x*1000).
        "last_tick_iso": last_tick_iso,
    }))
}

/// Mark a topic as "active" (currently viewed) so the worker prioritizes it
/// in the drain order. Called from the frontend on topic-page render + hash
/// change. See `mark_active` for file-format details.
#[tauri::command]
pub async fn mark_topic_active(app: AppHandle, topic: String) -> Result<(), String> {
    mark_active(&app, &topic)
}

/// "Retry all failed" — reset the extraction_queue rows that failed
/// (attempts >= 3 OR last_error set), clear the supervisor's restart counter,
/// and kick the worker back up. End-to-end: the banner the user sees after
/// `enrich:supervisor-gave-up` becomes actionable instead of a no-op.
///
/// Three steps, all idempotent:
///   1. SQL: `UPDATE extraction_queue SET attempts=0, last_error=NULL
///            WHERE attempts>=3 OR last_error IS NOT NULL`
///   2. Reset supervisor state (`restart_count`, `last_restart`, `shutting_down`).
///   3. `start_worker(app)` — orphan-reaping is built in.
///
/// Returns the row counts so the UI can show "✓ retried 30 rows".
#[tauri::command]
pub async fn retry_extraction_failures(app: AppHandle) -> Result<Value, String> {
    use rusqlite::Connection;

    let dir = crate::cli::data_dir(&app).map_err(|e| e.to_string())?;
    let db_path = dir.join("openreply.db");
    if !db_path.exists() {
        return Err(format!("DB not found at {}", db_path.display()));
    }

    // Reset failed rows in a blocking thread — rusqlite is sync and we're in
    // a tauri async runtime. spawn_blocking keeps the event loop free.
    let dbp = db_path.clone();
    let reset_count: i64 = tauri::async_runtime::spawn_blocking(move || -> Result<i64, String> {
        let conn = Connection::open(&dbp).map_err(|e| format!("open db: {e}"))?;
        // Count first so we can report. Cheap aggregate, no row scan because
        // both columns have indexes in the schema.
        let n: i64 = conn
            .query_row(
                "SELECT count(*) FROM extraction_queue
                  WHERE attempts >= 3 OR last_error IS NOT NULL",
                [],
                |r| r.get(0),
            )
            .map_err(|e| format!("count: {e}"))?;
        conn.execute(
            "UPDATE extraction_queue
                SET attempts = 0,
                    last_error = NULL
              WHERE attempts >= 3 OR last_error IS NOT NULL",
            [],
        )
        .map_err(|e| format!("update: {e}"))?;
        Ok(n)
    })
    .await
    .map_err(|e| format!("join: {e}"))??;

    // Reset supervisor state so the next start_worker isn't immediately
    // gated by the 3-strikes counter from a prior crash burst. Pull the Arc
    // out of the State<'_, T> borrow into an owned binding before locking —
    // see `stop_worker_blocking` for the same dance, otherwise the State
    // temporary's lifetime ends mid-expression and the lock fails to borrow.
    let s_opt: Option<Arc<ExtractionWorker>> = app
        .try_state::<Arc<ExtractionWorker>>()
        .map(|st| st.inner().clone());
    if let Some(s) = s_opt {
        if let Ok(mut c) = s.restart_count.lock() { *c = 0; }
        if let Ok(mut l) = s.last_restart.lock() { *l = None; }
        if let Ok(mut sd) = s.shutting_down.lock() { *sd = false; }
        if let Ok(mut le) = s.last_error.lock() { *le = None; }
    }

    // Kick the worker. Idempotent — if one's already running this is a no-op;
    // if dead, it spawns fresh (with orphan reaping). Errors are surfaced so
    // the UI can distinguish "queue reset succeeded but spawn failed" from
    // "everything went green".
    let start_err = start_worker(app.clone()).await.err();

    Ok(serde_json::json!({
        "ok": start_err.is_none(),
        "rows_reset": reset_count,
        "worker_restart_error": start_err,
    }))
}

/// Manually re-enqueue every post of a topic (re-runs extraction even for
/// posts already in graph_nodes when `force=true`). Uses a one-shot sidecar
/// spawn, *not* the long-lived worker.
///
/// NOTE: The CLI subcommand `research enrich-worker --enqueue-topic <topic>`
/// does not exist yet — the Rust plumbing is in place, but calling this today
/// will error out with "no such option". Follow-up Task 5.5 will add the
/// CLI flag on the Python side.
#[tauri::command]
pub async fn enqueue_extraction(
    app: AppHandle,
    topic: String,
    force: Option<bool>,
) -> Result<Value, String> {
    let mut args: Vec<String> = vec![
        "research".into(),
        "enrich-worker".into(),
        "--enqueue-topic".into(),
        topic,
    ];
    if force.unwrap_or(false) {
        args.push("--force".into());
    }
    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    crate::cli::run_cli(&app, arg_refs)
        .await
        .map_err(|e| e.to_string())
}
