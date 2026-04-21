//! Thin wrapper around the bundled `reddit-cli` Python sidecar.
//!
//! Every UI command funnels through here. We always pass `--json` and parse
//! stdout; on non-zero exit we surface stderr as the error message.
//!
//! Long-running commands (collect) store the child handle in shared state
//! so a Cancel button can actually terminate the subprocess.
//!
//! ## Dev-mode bypass
//!
//! On macOS, Gatekeeper verifies every `.so` inside the PyInstaller-bundled
//! `reddit-cli` binary on every launch, which can take 2+ minutes per call.
//! Unusable in dev. So in dev builds we detect a project `.venv/bin/python`
//! relative to the Tauri working dir and invoke `python -m reddit_research.cli.main`
//! directly, which launches in ~200 ms. Production bundles (no .venv nearby)
//! fall through to the sidecar binary as before.

use anyhow::{anyhow, Result};
use serde_json::{Value};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::{
    process::{Command, CommandChild, CommandEvent},
    ShellExt,
};

/// Walk up from CWD looking for `.venv/bin/python`. Returns its absolute path
/// if found within a few parent dirs, or None. Used only in dev builds.
///
/// Hardened against symlink loops: we canonicalize each step and track the
/// set of visited paths. A pathological symlink that creates a cycle
/// (`a -> b -> a`) breaks the walk early rather than revisiting dirs within
/// the 5-parent budget.
/// Public re-export for the worker supervisor — same dev bypass logic so
/// the long-lived extraction worker also skips macOS Gatekeeper verification
/// in development. See `find_dev_venv_python` for the actual walk.
pub fn find_dev_venv_python_pub() -> Option<std::path::PathBuf> {
    find_dev_venv_python()
}

fn find_dev_venv_python() -> Option<std::path::PathBuf> {
    // Explicit override always wins.
    if let Ok(p) = std::env::var("REDDIT_MYIND_DEV_PYTHON") {
        let pb = std::path::PathBuf::from(p);
        if pb.exists() {
            return Some(pb);
        }
    }
    let mut cur = std::env::current_dir().ok()?.canonicalize().ok()?;
    let mut visited: std::collections::HashSet<std::path::PathBuf> =
        std::collections::HashSet::new();
    for _ in 0..5 {
        // Symlink-loop guard: if we've visited this canonical path before,
        // bail out rather than walking in a circle.
        if !visited.insert(cur.clone()) {
            break;
        }
        let candidate = cur.join(".venv").join("bin").join("python");
        if candidate.exists() {
            return Some(candidate);
        }
        let parent = match cur.parent() {
            Some(p) => p.to_path_buf(),
            None => break,
        };
        // Canonicalize the parent too so symlinks don't confuse dedup.
        cur = match parent.canonicalize() {
            Ok(p) => p,
            Err(_) => break,
        };
    }
    None
}

/// Build a Tauri shell Command for the sidecar binary. Used for both dev
/// and production — capabilities only whitelist `binaries/reddit-cli`, which
/// keeps the DMG-shippable signature intact for any user.
fn build_sidecar_cmd(app: &AppHandle, user_args: &[&str]) -> Result<Command> {
    let mut cmd = app
        .shell()
        .sidecar("reddit-cli")
        .map_err(|e| anyhow!("sidecar missing: {e}"))?;
    for a in user_args {
        cmd = cmd.arg(*a);
    }
    Ok(cmd)
}

/// Dev-only helper: spawn `python -m reddit_research.cli.main` via
/// `tokio::process::Command` so we bypass macOS Gatekeeper's 2+ minute
/// PyInstaller verification. Only runs if a `.venv/bin/python` is found
/// near CWD — production DMG installs never see this.
async fn run_dev_python_cli(py: std::path::PathBuf, args: &[&str], data_dir: &str) -> Result<Value> {
    let t0 = std::time::Instant::now();
    eprintln!("[sidecar] dev-python {} args={:?}", py.display(), args);
    let mut cmd = tokio::process::Command::new(&py);
    cmd.arg("-m").arg("reddit_research.cli.main");
    for a in args { cmd.arg(a); }
    cmd.env("REDDIT_MYIND_DATA_DIR", data_dir)
       .env("PYTHONUNBUFFERED", "1");
    let output = cmd.output().await
        .map_err(|e| anyhow!("dev python spawn failed: {e}"))?;
    let elapsed = t0.elapsed().as_millis();
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        eprintln!("[sidecar] dev-python FAILED in {elapsed}ms: {stderr}");
        return Err(anyhow!("cli exited {}: {}", output.status.code().unwrap_or(-1), stderr));
    }
    eprintln!("[sidecar] dev-python OK in {elapsed}ms");
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    // Parse-failure path: surface the raw output as a structured sentinel so
    // the frontend can distinguish "no data" from "Python printed a traceback
    // instead of JSON and we silently dropped it". Previously used
    // `.unwrap_or(Value::Null)` which masked every Python crash as an empty
    // UI card. See docs/superpowers/specs/2026-04-20-audit-fixes-plan.md Fix 3.
    Ok(parse_or_diagnostic(&stdout))
}

/// Parse stdout as JSON; on failure return `{_parse_error, _raw, _parse_error_message}`
/// so the frontend can render a real diagnostic instead of silently showing empty state.
fn parse_or_diagnostic(stdout: &str) -> Value {
    match serde_json::from_str::<Value>(stdout) {
        Ok(v) => v,
        Err(err) => {
            let preview: String = stdout.chars().take(500).collect();
            eprintln!(
                "[sidecar] JSON parse failed: {err}. Raw stdout (first 500 chars):\n{preview}"
            );
            serde_json::json!({
                "_parse_error": true,
                "_raw": stdout,
                "_parse_error_message": err.to_string(),
            })
        }
    }
}

/// Shared handle to the currently-running long job (if any).
/// `main.rs` inserts this as managed state; commands mutate it.
#[derive(Default, Clone)]
pub struct ActiveJob(pub Arc<Mutex<Option<CommandChild>>>);

/// Separate handle for the chat sidecar — lets chat run during a collect
/// and gives it its own cancel button.
#[derive(Default, Clone)]
pub struct ActiveChat(pub Arc<Mutex<Option<CommandChild>>>);

/// Parallel handles for **dev-python** streaming jobs — when the dev bypass
/// spawns `.venv/bin/python` directly (via `tokio::process::Command`), there's
/// no `CommandChild`; we keep the OS pid instead so cancel can SIGTERM it.
/// Production (PyInstaller sidecar) continues to use ActiveJob/ActiveChat
/// above. Cancel tries both, so whichever branch populated its slot gets
/// killed.
#[derive(Default, Clone)]
pub struct ActiveJobPid(pub Arc<Mutex<Option<u32>>>);
#[derive(Default, Clone)]
pub struct ActiveChatPid(pub Arc<Mutex<Option<u32>>>);

/// Same shape as ActiveJob — stores the live `reddit-cli stream` child handle so cancel can kill it.
#[derive(Default)]
pub struct ActiveStream(pub Arc<Mutex<Option<CommandChild>>>);

#[derive(Default)]
pub struct ActiveStreamPid(pub Arc<Mutex<Option<u32>>>);

/// In-flight dedup for graph operations (enrich / build). Unlike
/// ActiveJob/ActiveChat these are fire-and-forget sidecar calls without a
/// cancel button — if the user double-clicks "Enrich" or `loadMap` re-fires
/// while one is still running, we want the second call to return immediately
/// with `{already_running: true}` instead of spawning a duplicate Python
/// process. Duplicates compound until Ollama's inference queue + SQLite
/// write-lock starves everything else (observed: 11 stacked enrichments
/// blocking "Build gap map" indefinitely).
///
/// Key format: `"<op>:<topic>"`, e.g. `"enrich:calari tracking app"`. Same
/// topic under different ops (build vs enrich) runs concurrently, which is
/// fine — they touch different parts of the schema.
#[derive(Default, Clone)]
pub struct ActiveGraphOps(pub Arc<Mutex<std::collections::HashSet<String>>>);

/// In-flight `start_collect` dedup + visibility registry.
///
/// Two problems solved:
///   1. If the user navigates away from `#/collect/X` and back, `renderCollect`
///      would re-call `start_collect`, spawning a DUPLICATE Python sidecar for
///      the same topic. The first call's events are still streaming — the
///      second one stomps on the schema with parallel writes.
///   2. The home screen has no way to know "is any collect running right now?".
///      A pinned "Collecting now: X — click to open log" banner needs this.
///
/// Keyed by topic string. Tracks start timestamp so the UI can show elapsed.
#[derive(Default, Clone)]
pub struct ActiveCollects(pub Arc<Mutex<std::collections::HashMap<String, u64>>>);

/// Resolve the data dir used by the Python CLI for this app.
/// `~/Library/Application Support/com.shantanu.gapmap/reddit-myind`.
pub fn data_dir(app: &AppHandle) -> Result<std::path::PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| anyhow!("app_data_dir failed: {e}"))?
        .join("reddit-myind");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// Run the sidecar with `args`, return parsed JSON from stdout.
///
/// When stdout isn't valid JSON (e.g. `research graph export` prints a
/// "wrote PATH" confirmation), we return `Value::Null` instead of erroring —
/// exit code is the source of truth for success/failure. Callers that need
/// the Value just check `.is_null()`.
pub async fn run_cli(app: &AppHandle, args: Vec<&str>) -> Result<Value> {
    let data = data_dir(app)?;
    let data_str = data.to_string_lossy().to_string();

    // Dev fast path — skip the bundled PyInstaller binary entirely when a
    // .venv/bin/python exists near CWD. Avoids macOS Gatekeeper slow launches.
    if let Some(py) = find_dev_venv_python() {
        return run_dev_python_cli(py, &args, &data_str).await;
    }

    let sidecar = build_sidecar_cmd(app, &args)?
        .env("REDDIT_MYIND_DATA_DIR", &data_str)
        .env("PYTHONUNBUFFERED", "1");

    let output = sidecar
        .output()
        .await
        .map_err(|e| anyhow!("sidecar spawn failed: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(anyhow!(
            "cli exited {}: {}",
            output.status.code().unwrap_or(-1),
            stderr
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    // See `parse_or_diagnostic` above — returns a `{_parse_error, _raw}` sentinel
    // on non-JSON stdout instead of the old silent `null`. Frontend detects
    // this sentinel and renders a real diagnostic.
    Ok(parse_or_diagnostic(&stdout))
}

/// Dev-only streaming bypass — spawn `.venv/bin/python -m reddit_research.cli.main`
/// via `tokio::process::Command`, pipe stdout+stderr, and emit per-line
/// events on `progress_event`. When the child exits, emit a done event with
/// `{code}` (for chat) or `{code, error_class, hint}` (for collect — see
/// `on_exit` below to customise).
///
/// Sidesteps the Tauri permission system + macOS Gatekeeper PyInstaller
/// verification, which can hang streaming spawns for 2+ minutes. PID is
/// stored in `pid_slot` so the matching cancel command can SIGTERM it.
async fn run_dev_python_streaming(
    app: &AppHandle,
    py: std::path::PathBuf,
    args: &[&str],
    data_str: &str,
    progress_event: &str,
    done_event: &str,
    pid_slot: Arc<Mutex<Option<u32>>>,
    on_exit: impl Fn(i32, &std::collections::VecDeque<String>) -> serde_json::Value + Send + 'static,
) -> Result<()> {
    use std::process::Stdio;
    use tokio::io::{AsyncBufReadExt, BufReader};

    // Own the event names so the three tokio::spawn closures below don't
    // need to borrow them across the `'static` boundary.
    let progress_event = progress_event.to_string();
    let done_event = done_event.to_string();

    let mut cmd = tokio::process::Command::new(&py);
    cmd.arg("-m").arg("reddit_research.cli.main");
    for a in args { cmd.arg(*a); }
    cmd.env("REDDIT_MYIND_DATA_DIR", data_str)
       .env("PYTHONUNBUFFERED", "1")
       .stdout(Stdio::piped())
       .stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| anyhow!("dev python spawn failed: {e}"))?;
    if let Some(pid) = child.id() {
        *pid_slot.lock().unwrap() = Some(pid);
    }
    let stdout = child.stdout.take().ok_or_else(|| anyhow!("no stdout pipe"))?;
    let stderr = child.stderr.take().ok_or_else(|| anyhow!("no stderr pipe"))?;

    // Collect the last ~40 lines across both streams so on_exit can classify.
    // Shared buffer protected by a parking_lot-free std Mutex — no hot path.
    let recent: Arc<Mutex<std::collections::VecDeque<String>>> =
        Arc::new(Mutex::new(std::collections::VecDeque::with_capacity(40)));

    let app_a = app.clone();
    let recent_a = recent.clone();
    let progress_a = progress_event.clone();
    tokio::spawn(async move {
        let mut reader = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            if line.trim().is_empty() { continue; }
            {
                let mut r = recent_a.lock().unwrap();
                if r.len() == 40 { r.pop_front(); }
                r.push_back(line.clone());
            }
            let _ = app_a.emit(progress_a.as_str(), line);
        }
    });

    let app_b = app.clone();
    let recent_b = recent.clone();
    let progress_b = progress_event.clone();
    tokio::spawn(async move {
        let mut reader = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            if line.trim().is_empty() { continue; }
            {
                let mut r = recent_b.lock().unwrap();
                if r.len() == 40 { r.pop_front(); }
                r.push_back(line.clone());
            }
            let _ = app_b.emit(progress_b.as_str(), line);
        }
    });

    let app_c = app.clone();
    let pid_slot_c = pid_slot.clone();
    let done_c = done_event.clone();
    tokio::spawn(async move {
        let status = child.wait().await;
        *pid_slot_c.lock().unwrap() = None;
        let code = status.ok().and_then(|s| s.code()).unwrap_or(-1);
        let r = recent.lock().unwrap();
        let payload = on_exit(code, &r);
        let _ = app_c.emit(done_c.as_str(), payload);
    });

    Ok(())
}

/// Start the sidecar and stream output as Tauri events.
/// Stores the child handle in `ActiveJob` so cancel can kill it.
pub async fn run_cli_streaming(
    app: &AppHandle,
    args: Vec<&str>,
    progress_event: &'static str,
    done_event: &'static str,
) -> Result<()> {
    // Refuse to start a second job while one is running. Check BOTH branches:
    //   - ActiveJob      → prod (PyInstaller sidecar, CommandChild)
    //   - ActiveJobPid   → dev  (`.venv/bin/python`, raw pid)
    // Without the second check, the dev bypass could stack a second collect on
    // top of a still-running first one (two Python processes writing to the
    // same SQLite in parallel) and starve SIGTERM semantics on cancel.
    if let Some(state) = app.try_state::<ActiveJob>() {
        if state.0.lock().unwrap().is_some() {
            return Err(anyhow!(
                "another collect is already running. Cancel it first."
            ));
        }
    }
    if let Some(state) = app.try_state::<ActiveJobPid>() {
        if state.0.lock().unwrap().is_some() {
            return Err(anyhow!(
                "another collect is already running. Cancel it first."
            ));
        }
    }

    let data = data_dir(app)?;
    let data_str = data.to_string_lossy().to_string();

    // Dev fast path — use .venv/bin/python + tokio::process streaming.
    // In prod (DMG), this falls through to the PyInstaller sidecar below.
    if let Some(py) = find_dev_venv_python() {
        let pid_slot = if let Some(state) = app.try_state::<ActiveJobPid>() {
            state.0.clone()
        } else {
            Arc::new(Mutex::new(None))
        };
        return run_dev_python_streaming(
            app, py, &args, &data_str, progress_event, done_event, pid_slot,
            |code, recent| {
                let (class, hint) = classify_collect_error(code, recent);
                serde_json::json!({ "code": code, "error_class": class, "hint": hint })
            },
        ).await;
    }

    let (mut rx, child) = build_sidecar_cmd(app, &args)?
        .env("REDDIT_MYIND_DATA_DIR", &data_str)
        .env("PYTHONUNBUFFERED", "1")
        .spawn()
        .map_err(|e| anyhow!("sidecar spawn failed: {e}"))?;

    // Store child so cancel can reach it
    if let Some(state) = app.try_state::<ActiveJob>() {
        *state.0.lock().unwrap() = Some(child);
    }

    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        // Collect the last ~40 lines of output so we can classify failures.
        // VecDeque with cap keeps memory bounded even on very long collects.
        let mut recent_lines: std::collections::VecDeque<String> =
            std::collections::VecDeque::with_capacity(40);
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stderr(bytes) | CommandEvent::Stdout(bytes) => {
                    if let Ok(s) = String::from_utf8(bytes) {
                        for line in s.lines() {
                            if line.trim().is_empty() { continue; }
                            if recent_lines.len() == 40 { recent_lines.pop_front(); }
                            recent_lines.push_back(line.to_string());
                            let _ = app_clone.emit(progress_event, line.to_string());
                        }
                    }
                }
                CommandEvent::Terminated(payload) => {
                    if let Some(state) = app_clone.try_state::<ActiveJob>() {
                        *state.0.lock().unwrap() = None;
                    }
                    let code = payload.code.unwrap_or(-1);
                    let (class, hint) = classify_collect_error(code, &recent_lines);
                    let _ = app_clone.emit(
                        done_event,
                        serde_json::json!({
                            "code": code,
                            "error_class": class,
                            "hint": hint,
                        }),
                    );
                    break;
                }
                _ => {}
            }
        }
    });

    Ok(())
}

/// Inspect the tail of a collect's stderr/stdout to classify WHY it failed,
/// so the UI can show targeted advice instead of "Collect failed".
fn classify_collect_error(
    code: i32,
    recent_lines: &std::collections::VecDeque<String>,
) -> (&'static str, String) {
    if code == 0 {
        return ("ok", String::new());
    }
    // Join just the last 20 lines — enough context without flooding the payload.
    let tail: String = recent_lines
        .iter()
        .rev()
        .take(20)
        .rev()
        .cloned()
        .collect::<Vec<_>>()
        .join("\n");
    let lower = tail.to_ascii_lowercase();
    if lower.contains("ratelimit") || lower.contains("rate limit") || lower.contains("429") {
        return (
            "reddit_rate_limit",
            "Reddit rate-limited us. Wait 60s and retry, or add Reddit creds in Settings to raise the limit (60→100/min).".into(),
        );
    }
    if lower.contains("no such host") || lower.contains("name resolution")
        || lower.contains("networkerror") || lower.contains("connection refused")
        || lower.contains("timed out") {
        return (
            "network",
            "Network unreachable. Check your internet connection and try again.".into(),
        );
    }
    if lower.contains("anthropic_api_key") || lower.contains("openai_api_key")
        || lower.contains("no llm provider configured") {
        return (
            "llm_key",
            "No LLM key configured. Add one in Settings → API keys, then retry.".into(),
        );
    }
    if lower.contains("unable to load model") || lower.contains("ollama") && lower.contains("500") {
        return (
            "llm_model",
            "Ollama couldn't load the selected model. Pick a different one in Settings → BYOK → Ollama.".into(),
        );
    }
    if lower.contains("databaseerror") || lower.contains("operationalerror")
        || lower.contains("database is locked") {
        return (
            "db",
            "DB error. Try closing other tools that may have the DB open, then retry.".into(),
        );
    }
    (
        "unknown",
        format!("Collect exited {code}. Check the log above for the specific error."),
    )
}

/// Kill the currently-running sidecar child, if any. Tries both branches —
/// the Tauri-shell `CommandChild` (prod) and the dev-python pid (dev).
pub fn cancel_active_job(app: &AppHandle) -> bool {
    let mut killed = false;
    if let Some(state) = app.try_state::<ActiveJob>() {
        let mut guard = state.0.lock().unwrap();
        if let Some(child) = guard.take() {
            let _ = child.kill();
            killed = true;
        }
    }
    if let Some(state) = app.try_state::<ActiveJobPid>() {
        let mut guard = state.0.lock().unwrap();
        if let Some(pid) = guard.take() {
            kill_pid(pid);
            killed = true;
        }
    }
    killed
}

/// Best-effort SIGTERM on a Unix pid. On Windows we shell out to taskkill.
/// Only used by the dev-python streaming path — prod uses CommandChild::kill.
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

/// Start the sidecar for chat — streams JSON events, uses its own state
/// (doesn't conflict with a concurrent collect).
pub async fn run_cli_chat_streaming(
    app: &AppHandle,
    args: Vec<&str>,
    progress_event: &'static str,
    done_event: &'static str,
) -> Result<()> {
    if let Some(state) = app.try_state::<ActiveChat>() {
        if state.0.lock().unwrap().is_some() {
            return Err(anyhow!("another chat is already streaming. Cancel it first."));
        }
    }
    if let Some(state) = app.try_state::<ActiveChatPid>() {
        if state.0.lock().unwrap().is_some() {
            return Err(anyhow!("another chat is already streaming. Cancel it first."));
        }
    }

    let data = data_dir(app)?;
    let data_str = data.to_string_lossy().to_string();

    // Dev fast path — chat was previously locked to the PyInstaller sidecar
    // even when `.venv/bin/python` was present, so every in-dev code change
    // to chat.py / provider resolution required a full rebuild to take
    // effect. Route dev chat through the venv Python instead; prod (DMG)
    // still uses the bundled binary below.
    if let Some(py) = find_dev_venv_python() {
        let pid_slot = if let Some(state) = app.try_state::<ActiveChatPid>() {
            state.0.clone()
        } else {
            Arc::new(Mutex::new(None))
        };
        return run_dev_python_streaming(
            app, py, &args, &data_str, progress_event, done_event, pid_slot,
            |code, _recent| serde_json::json!({ "code": code }),
        ).await;
    }

    let (mut rx, child) = build_sidecar_cmd(app, &args)?
        .env("REDDIT_MYIND_DATA_DIR", &data_str)
        .env("PYTHONUNBUFFERED", "1")
        .spawn()
        .map_err(|e| anyhow!("sidecar spawn failed: {e}"))?;

    if let Some(state) = app.try_state::<ActiveChat>() {
        *state.0.lock().unwrap() = Some(child);
    }

    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) | CommandEvent::Stderr(bytes) => {
                    if let Ok(s) = String::from_utf8(bytes) {
                        for line in s.lines() {
                            if !line.trim().is_empty() {
                                let _ = app_clone.emit(progress_event, line.to_string());
                            }
                        }
                    }
                }
                CommandEvent::Terminated(payload) => {
                    if let Some(state) = app_clone.try_state::<ActiveChat>() {
                        *state.0.lock().unwrap() = None;
                    }
                    let code = payload.code.unwrap_or(-1);
                    let _ = app_clone.emit(done_event, serde_json::json!({ "code": code }));
                    break;
                }
                _ => {}
            }
        }
    });

    Ok(())
}

/// Cancel a running chat, if any. Same dual-branch as cancel_active_job.
pub fn cancel_active_chat(app: &AppHandle) -> bool {
    let mut killed = false;
    if let Some(state) = app.try_state::<ActiveChat>() {
        let mut guard = state.0.lock().unwrap();
        if let Some(child) = guard.take() {
            let _ = child.kill();
            killed = true;
        }
    }
    if let Some(state) = app.try_state::<ActiveChatPid>() {
        let mut guard = state.0.lock().unwrap();
        if let Some(pid) = guard.take() {
            kill_pid(pid);
            killed = true;
        }
    }
    killed
}

pub fn cancel_active_stream(app: &AppHandle) -> bool {
    let mut killed = false;
    if let Some(state) = app.try_state::<ActiveStream>() {
        if let Ok(mut guard) = state.0.lock() {
            if let Some(child) = guard.take() {
                let _ = child.kill();
                killed = true;
            }
        }
    }
    if let Some(state) = app.try_state::<ActiveStreamPid>() {
        if let Ok(mut guard) = state.0.lock() {
            *guard = None;
        }
    }
    killed
}

/// Start the sidecar for stream — streams NDJSON hits, uses its own state
/// (doesn't conflict with a concurrent collect or chat).
pub async fn run_cli_stream_streaming(
    app: &AppHandle,
    args: Vec<&str>,
    progress_event: &'static str,
    done_event: &'static str,
) -> Result<()> {
    if let Some(state) = app.try_state::<ActiveStream>() {
        if state.0.lock().unwrap().is_some() {
            return Err(anyhow!("another stream is already running. Cancel it first."));
        }
    }
    if let Some(state) = app.try_state::<ActiveStreamPid>() {
        if state.0.lock().unwrap().is_some() {
            return Err(anyhow!("another stream is already running. Cancel it first."));
        }
    }

    let data = data_dir(app)?;
    let data_str = data.to_string_lossy().to_string();

    if let Some(py) = find_dev_venv_python() {
        let pid_slot = if let Some(state) = app.try_state::<ActiveStreamPid>() {
            state.0.clone()
        } else {
            Arc::new(Mutex::new(None))
        };
        return run_dev_python_streaming(
            app, py, &args, &data_str, progress_event, done_event, pid_slot,
            |code, recent| {
                let (class, hint) = classify_collect_error(code, recent);
                serde_json::json!({ "code": code, "error_class": class, "hint": hint })
            },
        ).await;
    }

    let (mut rx, child) = build_sidecar_cmd(app, &args)?
        .env("REDDIT_MYIND_DATA_DIR", &data_str)
        .env("PYTHONUNBUFFERED", "1")
        .spawn()
        .map_err(|e| anyhow!("sidecar spawn failed: {e}"))?;

    if let Some(state) = app.try_state::<ActiveStream>() {
        *state.0.lock().unwrap() = Some(child);
    }

    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut recent_lines: std::collections::VecDeque<String> =
            std::collections::VecDeque::with_capacity(40);
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stderr(bytes) | CommandEvent::Stdout(bytes) => {
                    if let Ok(s) = String::from_utf8(bytes) {
                        for line in s.lines() {
                            if line.trim().is_empty() { continue; }
                            if recent_lines.len() == 40 { recent_lines.pop_front(); }
                            recent_lines.push_back(line.to_string());
                            let _ = app_clone.emit(progress_event, line.to_string());
                        }
                    }
                }
                CommandEvent::Terminated(payload) => {
                    if let Some(state) = app_clone.try_state::<ActiveStream>() {
                        *state.0.lock().unwrap() = None;
                    }
                    let code = payload.code.unwrap_or(-1);
                    let (class, hint) = classify_collect_error(code, &recent_lines);
                    let _ = app_clone.emit(
                        done_event,
                        serde_json::json!({
                            "code": code,
                            "error_class": class,
                            "hint": hint,
                        }),
                    );
                    break;
                }
                _ => {}
            }
        }
    });

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::classify_collect_error;
    use std::collections::VecDeque;

    fn tail(lines: &[&str]) -> VecDeque<String> {
        lines.iter().map(|s| (*s).to_string()).collect()
    }

    #[test]
    fn classify_ok_on_zero() {
        let empty = VecDeque::new();
        let (c, h) = classify_collect_error(0, &empty);
        assert_eq!(c, "ok");
        assert!(h.is_empty());
    }

    #[test]
    fn classify_reddit_rate_limit() {
        let q = tail(&["HTTP 429", "RateLimit exceeded"]);
        let (c, _) = classify_collect_error(1, &q);
        assert_eq!(c, "reddit_rate_limit");
    }

    #[test]
    fn classify_network_errors() {
        for msg in [
            "No such host known",
            "Temporary failure in name resolution",
            "Connection refused",
            "NetworkError when attempting to fetch",
            "timed out",
        ] {
            let q = tail(&[msg]);
            let (c, _) = classify_collect_error(2, &q);
            assert_eq!(c, "network", "expected network for {msg:?}");
        }
    }

    #[test]
    fn classify_llm_key_missing() {
        let q = tail(&["Error: ANTHROPIC_API_KEY not set"]);
        assert_eq!(classify_collect_error(1, &q).0, "llm_key");
        let q2 = tail(&["no llm provider configured"]);
        assert_eq!(classify_collect_error(1, &q2).0, "llm_key");
    }

    #[test]
    fn classify_ollama_model_load() {
        let q = tail(&["Ollama returned 500", "unable to load model llama3"]);
        assert_eq!(classify_collect_error(1, &q).0, "llm_model");
    }

    #[test]
    fn classify_database_locked() {
        let q = tail(&["sqlite3.OperationalError: database is locked"]);
        assert_eq!(classify_collect_error(1, &q).0, "db");
    }

    #[test]
    fn classify_unknown_fallback() {
        let q = tail(&["something weird happened"]);
        let (c, h) = classify_collect_error(9, &q);
        assert_eq!(c, "unknown");
        assert!(h.contains("9"));
    }

    #[test]
    fn classify_llm_model_unable_to_load_without_status_line() {
        let q = tail(&["POST /api/chat", "unable to load model 'missing'"]);
        assert_eq!(classify_collect_error(1, &q).0, "llm_model");
    }

    #[test]
    fn classify_llm_model_ollama_word_plus_500() {
        let q = tail(&["ollama runner", "internal error 500"]);
        assert_eq!(classify_collect_error(1, &q).0, "llm_model");
    }

    #[test]
    fn classify_reddit_ratelimit_one_word() {
        let q = tail(&["we got ratelimited by reddit"]);
        assert_eq!(classify_collect_error(1, &q).0, "reddit_rate_limit");
    }
}
