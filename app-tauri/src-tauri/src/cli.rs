//! Thin wrapper around the bundled `gapmap` Python sidecar.
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
//! `gapmap` binary on every launch, which can take 2+ minutes per call.
//! Unusable in dev. So in dev builds we detect a project `.venv/bin/python`
//! relative to the Tauri working dir and invoke `python -m gapmap.cli.main`
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
    if let Ok(p) = std::env::var("GAPMAP_DEV_PYTHON") {
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

/// Recursively sum the on-disk size of a directory (best-effort; ignores
/// unreadable entries). Used only to report how much the orphan reaper freed.
fn dir_size_bytes(path: &std::path::Path) -> u64 {
    let mut total = 0u64;
    if let Ok(entries) = std::fs::read_dir(path) {
        for e in entries.flatten() {
            match e.metadata() {
                Ok(m) if m.is_dir() => total += dir_size_bytes(&e.path()),
                Ok(m) => total += m.len(),
                Err(_) => {}
            }
        }
    }
    total
}

/// Reap orphaned PyInstaller onefile extraction dirs (`_MEI*`) from the
/// system temp dir.
///
/// PyInstaller's onefile bootloader extracts ~130 MB of Python runtime +
/// `.so` files into a fresh `_MEIxxxxxx` dir on EVERY sidecar spawn and
/// removes it on graceful exit. A crash / SIGKILL (sidecar lock-timeout,
/// Claude Code reloading the MCP server, the user force-quitting the app)
/// leaves the dir behind. Across many sessions these accumulate — on Gap
/// Map a user reached 41 dirs = 4.56 GB, which filled the boot volume and
/// made `mkdtemp` / `.so` extraction fail with
/// `[PYI-NNNNN:ERROR] Could not create temporary directory!` and
/// `decompression resulted in return code -1!`. That 255-exits EVERY
/// sidecar call — data tabs, audience build, table counts, AND MCP install —
/// so the whole app looks broken on a fresh install with a tight disk.
///
/// Safety: only dirs whose mtime is older than `min_age` are removed, so we
/// never touch a currently-extracting sidecar or a freshly-started MCP
/// server (mtime is stamped at extraction = process start). Default 6 h is
/// well past any single sidecar call and past a normal Claude Code MCP
/// session cycle; override via `GAPMAP_MEI_REAP_MIN_AGE_SECS`. Returns
/// `(dirs_removed, bytes_freed)`. Cheap to call on boot; safe to call often.
pub fn reap_pyinstaller_orphans() -> (u64, u64) {
    let min_age_secs: u64 = std::env::var("GAPMAP_MEI_REAP_MIN_AGE_SECS")
        .ok()
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(6 * 60 * 60);
    let tmp = std::env::temp_dir();
    let now = std::time::SystemTime::now();
    let mut removed = 0u64;
    let mut freed = 0u64;
    let entries = match std::fs::read_dir(&tmp) {
        Ok(e) => e,
        Err(_) => return (0, 0),
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let is_mei = path
            .file_name()
            .and_then(|n| n.to_str())
            .map(|n| n.starts_with("_MEI"))
            .unwrap_or(false);
        if !is_mei {
            continue;
        }
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        if !meta.is_dir() {
            continue;
        }
        // Age gate: skip anything younger than min_age — it could be a live
        // extraction or a running MCP server we must not yank out from under.
        let old_enough = meta
            .modified()
            .ok()
            .and_then(|m| now.duration_since(m).ok())
            .map(|d| d.as_secs() >= min_age_secs)
            .unwrap_or(false);
        if !old_enough {
            continue;
        }
        let dir_bytes = dir_size_bytes(&path);
        if std::fs::remove_dir_all(&path).is_ok() {
            removed += 1;
            freed += dir_bytes;
        }
    }
    (removed, freed)
}

/// Build a Tauri shell Command for the sidecar binary. Used for both dev
/// and production — capabilities only whitelist `binaries/gapmap`, which
/// keeps the DMG-shippable signature intact for any user.
///
/// Pre-injects `GAPMAP_FFMPEG_PATH` when a bundled / system ffmpeg is
/// resolvable, so every sidecar invocation (one-shot or streaming) can hand
/// yt-dlp a working demuxer without each caller wiring the env.
fn build_sidecar_cmd(app: &AppHandle, user_args: &[&str]) -> Result<Command> {
    let mut cmd = app
        .shell()
        .sidecar("gapmap-cli")
        .map_err(|e| anyhow!("sidecar missing: {e}"))?;
    for a in user_args {
        cmd = cmd.arg(*a);
    }
    let ffmpeg = ffmpeg_env_value(app);
    if !ffmpeg.is_empty() {
        cmd = cmd.env("GAPMAP_FFMPEG_PATH", ffmpeg);
    }
    Ok(cmd)
}

/// Dev-only helper: spawn `python -m gapmap.cli.main` via
/// `tokio::process::Command` so we bypass macOS Gatekeeper's 2+ minute
/// PyInstaller verification. Only runs if a `.venv/bin/python` is found
/// near CWD — production DMG installs never see this.
async fn run_dev_python_cli(py: std::path::PathBuf, args: &[&str], data_dir: &str) -> Result<Value> {
    let t0 = std::time::Instant::now();
    eprintln!("[sidecar] dev-python {} args={:?}", py.display(), args);
    let mut cmd = tokio::process::Command::new(&py);
    cmd.arg("-m").arg("gapmap.cli.main");
    for a in args { cmd.arg(a); }
    cmd.env("GAPMAP_DATA_DIR", data_dir)
       .env("PYTHONUNBUFFERED", "1");
    // Propagate GAPMAP_FFMPEG_PATH — set by the caller (run_cli) via
    // ffmpeg_env_value(app). yt-dlp inside the sidecar reads this to point
    // at the bundled/static ffmpeg instead of a system install.
    if let Ok(ffmpeg) = std::env::var("GAPMAP_FFMPEG_PATH") {
        if !ffmpeg.is_empty() { cmd.env("GAPMAP_FFMPEG_PATH", ffmpeg); }
    }
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

// ─── Long-running dev-python daemon ────────────────────────────────────────
//
// `run_cli` previously paid the full Python interpreter / module-import cost
// on EVERY invocation (~300-1500 ms each). When the topic page mounts we fire
// 3+ such calls in parallel (saturation, coverage-gaps, byok_status, …) and
// each one spawns its own `python -m gapmap.cli.main`. Multiply by
// every page navigation and the perceived "even local DB feels slow" follows.
//
// The daemon process keeps the Python interpreter warm. It reads one
// JSON request per line on stdin, dispatches via Click's
// `standalone_mode=False`, and writes one JSON response per line on stdout.
// First call still pays imports; every subsequent call lands in the
// already-warm process — measured 12 s → 0.5 s for 3 sequential calls.
//
// Failure handling: any IO/parse failure on the daemon channel marks the
// slot as broken, kills the child, and signals the caller to fall back to
// the existing one-shot `output()` path so a single bad command can't take
// down the whole app. On the next call we lazily re-spawn.
//
// Scope: dev-mode only for now. The bundled PyInstaller path stays on
// one-shot — the dev wins are huge and the bundled-binary plumbing through
// Tauri's shell-plugin Command (event-channel stdin/stdout) is a meatier
// refactor for a follow-up. Cross-session SWR caching (Fix #2) already
// covers most user-visible cold-start pain in the bundled DMG.

struct DevDaemon {
    // Held to keep the process alive; `kill()` reaped on `shutdown_dev_daemon`.
    child: tokio::process::Child,
    stdin: tokio::process::ChildStdin,
    stdout: tokio::io::BufReader<tokio::process::ChildStdout>,
    next_id: u64,
}

static DEV_DAEMON: std::sync::OnceLock<Arc<tokio::sync::Mutex<Option<DevDaemon>>>> =
    std::sync::OnceLock::new();

fn dev_daemon_slot() -> Arc<tokio::sync::Mutex<Option<DevDaemon>>> {
    DEV_DAEMON
        .get_or_init(|| Arc::new(tokio::sync::Mutex::new(None)))
        .clone()
}

async fn spawn_dev_daemon(
    py: &std::path::Path,
    data_dir: &str,
) -> Result<DevDaemon> {
    use std::process::Stdio;
    use tokio::io::{AsyncBufReadExt, BufReader as TokioBufReader};

    let mut cmd = tokio::process::Command::new(py);
    cmd.arg("-m").arg("gapmap.cli.main").arg("daemon");
    cmd.env("GAPMAP_DATA_DIR", data_dir)
        .env("PYTHONUNBUFFERED", "1");
    if let Ok(ffmpeg) = std::env::var("GAPMAP_FFMPEG_PATH") {
        if !ffmpeg.is_empty() {
            cmd.env("GAPMAP_FFMPEG_PATH", ffmpeg);
        }
    }
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| anyhow!("daemon spawn failed: {e}"))?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| anyhow!("daemon stdin not piped"))?;
    let mut stdout = TokioBufReader::new(
        child
            .stdout
            .take()
            .ok_or_else(|| anyhow!("daemon stdout not piped"))?,
    );

    // Handshake — daemon prints {"_daemon_ready": true} once imports finish.
    let mut handshake = String::new();
    stdout
        .read_line(&mut handshake)
        .await
        .map_err(|e| anyhow!("daemon handshake read failed: {e}"))?;
    let v: Value = serde_json::from_str(handshake.trim())
        .map_err(|e| anyhow!("daemon handshake invalid JSON ({e}): {}", handshake.trim()))?;
    if v.get("_daemon_ready") != Some(&Value::Bool(true)) {
        return Err(anyhow!(
            "daemon handshake unexpected: {}",
            handshake.trim()
        ));
    }
    eprintln!("[sidecar] dev-python daemon spawned, pid={:?}", child.id());

    Ok(DevDaemon {
        child,
        stdin,
        stdout,
        next_id: 0,
    })
}

/// Result of a daemon round-trip. `DaemonBroken` means the IPC layer itself
/// failed (write/read/parse) — caller should drop the slot and fall back to
/// one-shot. `CommandFailed` is a clean dispatch where the command itself
/// errored — propagate as-is, no fallback (one-shot would just fail too).
enum DaemonOutcome {
    Ok(Value),
    CommandFailed(String),
    DaemonBroken(String),
}

// Maximum time we wait for the daemon's request mutex before declaring lock
// contention and falling back to a one-shot Python spawn. Pre-fix, a long
// LLM job (sentiment-by-source, audience-build, concepts) could hold this
// lock for 30-90s while every other `run_cli` call from the UI — settings
// refreshes, topic queries, tab switches — queued behind it, making the
// whole app feel frozen. The one-shot fallback costs ~200ms in dev (.venv
// python) and ~2-5s in the bundled DMG (macOS Gatekeeper boot), so we keep
// the dev wait shorter than the prod wait.
const DAEMON_LOCK_TIMEOUT_DEV_SECS: u64 = 3;
const DAEMON_LOCK_TIMEOUT_PROD_SECS: u64 = 6;

async fn run_via_dev_daemon(
    py: &std::path::Path,
    args: &[&str],
    data_dir: &str,
) -> DaemonOutcome {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt};

    let slot = dev_daemon_slot();
    let mut guard = match tokio::time::timeout(
        std::time::Duration::from_secs(DAEMON_LOCK_TIMEOUT_DEV_SECS),
        slot.lock(),
    )
    .await
    {
        Ok(g) => g,
        Err(_) => {
            // Long-running LLM job is holding the slot. Bail out so `run_cli`
            // falls through to the one-shot path — UI queries can't be
            // starved by background work.
            return DaemonOutcome::DaemonBroken(format!(
                "lock contention >{DAEMON_LOCK_TIMEOUT_DEV_SECS}s — falling back to one-shot"
            ));
        }
    };

    // Lazy spawn / re-spawn after a previous broken slot.
    if guard.is_none() {
        match spawn_dev_daemon(py, data_dir).await {
            Ok(d) => {
                *guard = Some(d);
            }
            Err(e) => {
                return DaemonOutcome::DaemonBroken(format!("spawn: {e}"));
            }
        }
    }

    let daemon = guard.as_mut().expect("daemon slot just populated");
    daemon.next_id += 1;
    let req_id = daemon.next_id;

    let request = serde_json::json!({ "id": req_id, "args": args });
    let request_line = match serde_json::to_string(&request) {
        Ok(s) => format!("{s}\n"),
        Err(e) => return DaemonOutcome::DaemonBroken(format!("encode: {e}")),
    };

    if let Err(e) = daemon.stdin.write_all(request_line.as_bytes()).await {
        let _ = guard.take();
        return DaemonOutcome::DaemonBroken(format!("write: {e}"));
    }
    if let Err(e) = daemon.stdin.flush().await {
        let _ = guard.take();
        return DaemonOutcome::DaemonBroken(format!("flush: {e}"));
    }

    let mut response = String::new();
    match daemon.stdout.read_line(&mut response).await {
        Ok(0) => {
            let _ = guard.take();
            return DaemonOutcome::DaemonBroken("EOF on stdout".into());
        }
        Ok(_) => {}
        Err(e) => {
            let _ = guard.take();
            return DaemonOutcome::DaemonBroken(format!("read: {e}"));
        }
    }

    let resp: Value = match serde_json::from_str(response.trim()) {
        Ok(v) => v,
        Err(e) => {
            let _ = guard.take();
            return DaemonOutcome::DaemonBroken(format!(
                "parse: {e}: {}",
                response.trim()
            ));
        }
    };

    if resp.get("ok") == Some(&Value::Bool(true)) {
        DaemonOutcome::Ok(resp.get("result").cloned().unwrap_or(Value::Null))
    } else {
        let err = resp
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown daemon command error")
            .to_string();
        DaemonOutcome::CommandFailed(err)
    }
}

/// Best-effort kill of the running daemon — used on app shutdown so the
/// orphan Python doesn't outlive its parent.
pub async fn shutdown_dev_daemon() {
    let slot = dev_daemon_slot();
    let mut guard = slot.lock().await;
    if let Some(mut daemon) = guard.take() {
        let _ = daemon.child.kill().await;
    }
    // Also kill the bundled-sidecar daemon if it's alive.
    shutdown_sidecar_daemon().await;
}

// ─── Long-running BUNDLED-SIDECAR daemon ──────────────────────────────────
//
// Mirror of the dev-python daemon above, but driven from the PyInstaller
// binary inside Gap Map.app/Contents/MacOS/gapmap-cli when no .venv is
// present. The bundled CLI supports the same `daemon` subcommand
// (gapmap.cli.main::daemon — JSON-line in / JSON-line out).
//
// Why: previously, every `run_cli` call in DMG mode spawned a fresh
// PyInstaller process (~2-5 s of macOS Gatekeeper verification + Python
// boot, even warm). Settings makes 6-8 such calls in parallel → cards
// queue → 30 s of skeleton. The daemon keeps the Python interpreter +
// import graph warm; round-trip drops to ~10-100 ms.
//
// The slot is keyed by the resolved binary path, so a user who moves
// Gap Map.app between locations gets a fresh daemon for the new path
// (and we kill the old one).

static SIDECAR_DAEMON: std::sync::OnceLock<Arc<tokio::sync::Mutex<Option<DevDaemon>>>> =
    std::sync::OnceLock::new();

fn sidecar_daemon_slot() -> Arc<tokio::sync::Mutex<Option<DevDaemon>>> {
    SIDECAR_DAEMON
        .get_or_init(|| Arc::new(tokio::sync::Mutex::new(None)))
        .clone()
}

async fn spawn_sidecar_daemon(
    sidecar: &std::path::Path,
    data_dir: &str,
) -> Result<DevDaemon> {
    use std::process::Stdio;
    use tokio::io::{AsyncBufReadExt, BufReader as TokioBufReader};

    let mut cmd = tokio::process::Command::new(sidecar);
    cmd.arg("daemon");
    cmd.env("GAPMAP_DATA_DIR", data_dir)
        .env("PYTHONUNBUFFERED", "1");
    if let Ok(ffmpeg) = std::env::var("GAPMAP_FFMPEG_PATH") {
        if !ffmpeg.is_empty() {
            cmd.env("GAPMAP_FFMPEG_PATH", ffmpeg);
        }
    }
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| anyhow!("sidecar daemon spawn failed: {e}"))?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| anyhow!("sidecar daemon stdin not piped"))?;
    let mut stdout = TokioBufReader::new(
        child
            .stdout
            .take()
            .ok_or_else(|| anyhow!("sidecar daemon stdout not piped"))?,
    );

    let mut handshake = String::new();
    stdout
        .read_line(&mut handshake)
        .await
        .map_err(|e| anyhow!("sidecar daemon handshake read failed: {e}"))?;
    let v: Value = serde_json::from_str(handshake.trim())
        .map_err(|e| anyhow!("sidecar daemon handshake invalid JSON ({e}): {}", handshake.trim()))?;
    if v.get("_daemon_ready") != Some(&Value::Bool(true)) {
        return Err(anyhow!(
            "sidecar daemon handshake unexpected: {}",
            handshake.trim()
        ));
    }
    eprintln!("[sidecar] bundled daemon spawned, pid={:?}, path={}", child.id(), sidecar.display());

    Ok(DevDaemon {
        child,
        stdin,
        stdout,
        next_id: 0,
    })
}

async fn run_via_sidecar_daemon(
    sidecar: &std::path::Path,
    args: &[&str],
    data_dir: &str,
) -> DaemonOutcome {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt};

    let slot = sidecar_daemon_slot();
    // Same lock-timeout pattern as the dev daemon. Prod timeout is longer
    // because the one-shot fallback (`build_sidecar_cmd().output()`) pays
    // a macOS Gatekeeper + Python-boot tax on every spawn, so we prefer to
    // wait a bit longer for the warm daemon before giving up.
    let mut guard = match tokio::time::timeout(
        std::time::Duration::from_secs(DAEMON_LOCK_TIMEOUT_PROD_SECS),
        slot.lock(),
    )
    .await
    {
        Ok(g) => g,
        Err(_) => {
            return DaemonOutcome::DaemonBroken(format!(
                "lock contention >{DAEMON_LOCK_TIMEOUT_PROD_SECS}s — falling back to one-shot"
            ));
        }
    };

    if guard.is_none() {
        match spawn_sidecar_daemon(sidecar, data_dir).await {
            Ok(d) => *guard = Some(d),
            Err(e) => return DaemonOutcome::DaemonBroken(format!("spawn: {e}")),
        }
    }

    let daemon = guard.as_mut().expect("daemon slot just populated");
    daemon.next_id += 1;
    let req_id = daemon.next_id;

    let request = serde_json::json!({ "id": req_id, "args": args });
    let request_line = match serde_json::to_string(&request) {
        Ok(s) => format!("{s}\n"),
        Err(e) => return DaemonOutcome::DaemonBroken(format!("encode: {e}")),
    };

    if let Err(e) = daemon.stdin.write_all(request_line.as_bytes()).await {
        let _ = guard.take();
        return DaemonOutcome::DaemonBroken(format!("write: {e}"));
    }
    if let Err(e) = daemon.stdin.flush().await {
        let _ = guard.take();
        return DaemonOutcome::DaemonBroken(format!("flush: {e}"));
    }

    let mut response = String::new();
    match daemon.stdout.read_line(&mut response).await {
        Ok(0) => {
            let _ = guard.take();
            return DaemonOutcome::DaemonBroken("EOF on stdout".into());
        }
        Ok(_) => {}
        Err(e) => {
            let _ = guard.take();
            return DaemonOutcome::DaemonBroken(format!("read: {e}"));
        }
    }

    let resp: Value = match serde_json::from_str(response.trim()) {
        Ok(v) => v,
        Err(e) => {
            let _ = guard.take();
            return DaemonOutcome::DaemonBroken(format!("parse: {e}: {}", response.trim()));
        }
    };

    if resp.get("ok") == Some(&Value::Bool(true)) {
        DaemonOutcome::Ok(resp.get("result").cloned().unwrap_or(Value::Null))
    } else {
        let err = resp
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown daemon command error")
            .to_string();
        DaemonOutcome::CommandFailed(err)
    }
}

pub async fn shutdown_sidecar_daemon() {
    let slot = sidecar_daemon_slot();
    let mut guard = slot.lock().await;
    if let Some(mut daemon) = guard.take() {
        let _ = daemon.child.kill().await;
    }
}

/// Resolve the bundled `gapmap-cli` next to `current_exe`. Mirrors the
/// same helper in commands.rs (kept local to cli.rs so daemon code is
/// self-contained).
fn resolve_bundled_sidecar() -> Option<std::path::PathBuf> {
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

/// Same shape as ActiveJob — stores the live `gapmap stream` child handle so cancel can kill it.
#[derive(Default)]
pub struct ActiveStream(pub Arc<Mutex<Option<CommandChild>>>);

#[derive(Default)]
pub struct ActiveStreamPid(pub Arc<Mutex<Option<u32>>>);

/// Live-child handles for the streaming enrich path (`enrich_graph_stream`).
/// Kept separate from ActiveJob/ActiveStream so a stream-mode enrich can
/// overlap with a user's collect or chat session — they share nothing at the
/// SQLite layer (enrich only writes to graph_nodes/edges) and users
/// legitimately trigger an enrich while reading the map in another tab.
/// Dedup of *concurrent enrich streams* is still handled per-topic by
/// ActiveGraphOps + `enrich:<topic>` keys.
#[derive(Default)]
pub struct ActiveEnrich(pub Arc<Mutex<Option<CommandChild>>>);

#[derive(Default)]
pub struct ActiveEnrichPid(pub Arc<Mutex<Option<u32>>>);

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
///
/// Value: the `Instant` at which the key was inserted. Used by
/// `run_graph_op_deduped` to auto-expire stale locks — if a previous sidecar
/// crashed silently (Ollama hang, SIGKILL, process panic between insert and
/// remove) the key would stay forever and every subsequent call would return
/// `already_running`, stranding the user. With the timestamp we treat any
/// key older than `GRAPH_OP_STALE_AFTER` (10 min) as stale and reclaim it.
#[derive(Default, Clone)]
pub struct ActiveGraphOps(
    pub Arc<Mutex<std::collections::HashMap<String, std::time::Instant>>>,
);

/// One-shot marker set by `cancel_active_job` so the streaming
/// `Terminated` handler can classify the resulting `code = -1` (or
/// negative signal exit) as `error_class = "cancelled"` instead of
/// `"unknown"`. Without this, a user clicking Cancel sees
/// `× collect exited with code -1 [unknown]` — indistinguishable from a
/// real crash. The marker auto-resets after the next done event so
/// future failures aren't misreported as cancellations.
#[derive(Default, Clone)]
pub struct CollectCancelMarker(pub Arc<Mutex<bool>>);

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

/// One pending entry in the collect queue. Stored as a string-args vector so
/// it can replay via the same code path as a fresh `start_collect`.
#[derive(Clone, Debug)]
pub struct QueuedCollect {
    pub topic: String,
    pub args: Vec<String>,
    pub queued_at: u64,
}

/// FIFO queue of collects waiting for the single-flight slot to free up.
///
/// Why we have this:
///   The user kicks off collect-A for "roofing marketplace" (running ~3 min).
///   They search for collect-B "ai coding assistants" — currently the sidecar
///   refuses to start because the single-flight ActiveJob lock is held.
///   The old UX surfaced this as `failed to start: another collect is
///   already running. Cancel it first.` with no way to know which collect
///   blocked them, no way to wait, no way to swap.
///
///   With this queue, the UI now offers three policies (`if_busy`):
///     - "error":            current behaviour, but with structured blocked_by
///                           metadata so the modal can render which topic blocks.
///     - "queue":            append to this VecDeque. When the running collect
///                           finishes (collect:done event), the front-of-queue
///                           is auto-spawned — keeps single-flight invariant
///                           while letting the user batch work.
///     - "cancel_and_start": SIGTERM the running sidecar, drain the queue
///                           briefly, then start the new one. Used when the
///                           user wants to switch focus immediately.
///
/// Single-flight is still preserved against SQLite write contention — only
/// one Python sidecar runs at a time. The queue is just a "next up" list.
#[derive(Default, Clone)]
pub struct CollectQueue(pub Arc<Mutex<std::collections::VecDeque<QueuedCollect>>>);

/// Resolve the bundled ffmpeg binary the Python sidecar should use for
/// yt-dlp audio extraction. Priority:
///   1. `GAPMAP_FFMPEG_PATH` env (dev override — point at /opt/homebrew/bin/ffmpeg).
///   2. Tauri `resource_dir()/binaries/ffmpeg-aarch64-apple-darwin` (shipped DMG).
///   3. `app-tauri/src-tauri/binaries/ffmpeg-aarch64-apple-darwin` relative to
///      dev CWD — picks up a drop-in static ffmpeg for `npm run tauri dev`.
///   4. System PATH (`/opt/homebrew/bin/ffmpeg`, `/usr/local/bin/ffmpeg`, `/usr/bin/ffmpeg`).
/// Returns `None` if nothing resolves — yt-dlp may still work for URLs that
/// ship audio directly (rare) but m4a/webm mux jobs will fail with a clean
/// error message the UI can surface.
pub fn resolve_ffmpeg_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    if let Ok(p) = std::env::var("GAPMAP_FFMPEG_PATH") {
        let pb = std::path::PathBuf::from(p);
        if pb.exists() { return Some(pb); }
    }
    // Bundled next to the PyInstaller sidecar binary.
    if let Ok(res) = app.path().resource_dir() {
        let bundled = res.join("binaries").join("ffmpeg-aarch64-apple-darwin");
        if bundled.exists() { return Some(bundled); }
        let bundled2 = res.join("ffmpeg-aarch64-apple-darwin");
        if bundled2.exists() { return Some(bundled2); }
    }
    // Dev layout — walk up from CWD looking for the drop-in binary.
    if let Ok(mut cur) = std::env::current_dir() {
        for _ in 0..5 {
            let candidate = cur
                .join("app-tauri").join("src-tauri").join("binaries")
                .join("ffmpeg-aarch64-apple-darwin");
            if candidate.exists() { return Some(candidate); }
            if !cur.pop() { break; }
        }
    }
    // System fallback — acceptable in dev, surfaces shared-lib deps but works.
    for p in ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg"] {
        let pb = std::path::PathBuf::from(p);
        if pb.exists() { return Some(pb); }
    }
    None
}

/// Stringified ffmpeg path suitable for passing into env. Empty when unresolved.
fn ffmpeg_env_value(app: &AppHandle) -> String {
    resolve_ffmpeg_path(app)
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default()
}

/// Resolve the data dir used by the Python CLI for this app.
/// `~/Library/Application Support/com.shantanu.gapmap/gapmap`.
pub fn data_dir(app: &AppHandle) -> Result<std::path::PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| anyhow!("app_data_dir failed: {e}"))?
        .join("gapmap");
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
    let ffmpeg = ffmpeg_env_value(app);
    if !ffmpeg.is_empty() {
        // Propagate via process env so run_dev_python_cli picks it up without
        // threading another arg through every caller.
        std::env::set_var("GAPMAP_FFMPEG_PATH", &ffmpeg);
    }

    // Dev fast path — skip the bundled PyInstaller binary entirely when a
    // .venv/bin/python exists near CWD. Avoids macOS Gatekeeper slow launches.
    if let Some(py) = find_dev_venv_python() {
        // First try the long-running daemon (warm Python interpreter).
        // On any IPC-level failure we fall back to one-shot so a single
        // bad command can't strand the whole UI.
        match run_via_dev_daemon(&py, &args, &data_str).await {
            DaemonOutcome::Ok(v) => return Ok(v),
            DaemonOutcome::CommandFailed(msg) => {
                // Daemon ran the command cleanly but the command itself
                // errored — same outcome as a non-zero one-shot exit, so
                // surface it directly without re-running.
                return Err(anyhow!("cli error: {}", msg));
            }
            DaemonOutcome::DaemonBroken(reason) => {
                eprintln!(
                    "[sidecar] dev-python daemon broken ({reason}), falling back to one-shot"
                );
                // Slot was already cleared inside run_via_dev_daemon — next
                // call will re-spawn.
            }
        }
        return run_dev_python_cli(py, &args, &data_str).await;
    }

    // Production fast path — bundled sidecar daemon. Same long-running
    // process pattern, just spawned from gapmap-cli inside the .app
    // bundle. Cuts every Settings/Topic/Audience call from ~2-5 s to
    // ~10-100 ms. On daemon IPC failure we fall back to one-shot
    // (the original Tauri shell.sidecar code path below).
    if let Some(bundled) = resolve_bundled_sidecar() {
        match run_via_sidecar_daemon(&bundled, &args, &data_str).await {
            DaemonOutcome::Ok(v) => return Ok(v),
            DaemonOutcome::CommandFailed(msg) => {
                return Err(anyhow!("cli error: {}", msg));
            }
            DaemonOutcome::DaemonBroken(reason) => {
                eprintln!(
                    "[sidecar] bundled daemon broken ({reason}), falling back to one-shot"
                );
                // Slot cleared; next call re-spawns.
            }
        }
    }

    // build_sidecar_cmd pre-injects GAPMAP_FFMPEG_PATH itself — no need here.
    let sidecar = build_sidecar_cmd(app, &args)?
        .env("GAPMAP_DATA_DIR", &data_str)
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

/// Dev-only streaming bypass — spawn `.venv/bin/python -m gapmap.cli.main`
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
    cmd.arg("-m").arg("gapmap.cli.main");
    for a in args { cmd.arg(*a); }
    cmd.env("GAPMAP_DATA_DIR", data_str)
       .env("PYTHONUNBUFFERED", "1")
       .stdout(Stdio::piped())
       .stderr(Stdio::piped());
    let ffmpeg = ffmpeg_env_value(app);
    if !ffmpeg.is_empty() {
        cmd.env("GAPMAP_FFMPEG_PATH", &ffmpeg);
    }
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
        // Capture the cancel marker for this collect so the closure can
        // tell user-cancelled exits apart from real failures. Captured by
        // value so the closure stays `'static`.
        let cancel_marker = app
            .try_state::<CollectCancelMarker>()
            .map(|s| s.0.clone())
            .unwrap_or_else(|| Arc::new(Mutex::new(false)));
        return run_dev_python_streaming(
            app, py, &args, &data_str, progress_event, done_event, pid_slot,
            move |code, recent| {
                let was_cancelled = {
                    let mut g = cancel_marker.lock().unwrap();
                    let v = *g;
                    *g = false;
                    v
                };
                let (class, hint) = if was_cancelled && code != 0 {
                    ("cancelled", "Cancelled by user. Partial results are kept.".to_string())
                } else {
                    classify_collect_error(code, recent)
                };
                serde_json::json!({ "code": code, "error_class": class, "hint": hint })
            },
        ).await;
    }

    let (mut rx, child) = build_sidecar_cmd(app, &args)?
        .env("GAPMAP_DATA_DIR", &data_str)
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
                    let was_cancelled = take_cancel_marker(&app_clone);
                    let (class, hint) = if was_cancelled && code != 0 {
                        ("cancelled", "Cancelled by user. Partial results are kept.".to_string())
                    } else {
                        classify_collect_error(code, &recent_lines)
                    };
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
///
/// Sets `CollectCancelMarker` so the streaming `Terminated` handler can
/// surface `error_class = "cancelled"` to the UI instead of the generic
/// `unknown` bucket — otherwise the user sees
/// `× collect exited with code -1 [unknown]` which reads like a crash.
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
    if killed {
        if let Some(state) = app.try_state::<CollectCancelMarker>() {
            if let Ok(mut g) = state.0.lock() {
                *g = true;
            }
        }
    }
    killed
}

/// Take the cancel marker (returns true if cancel was just called) and
/// reset it. Called by the streaming `Terminated` handler so it knows to
/// label the exit as cancelled instead of failed.
pub fn take_cancel_marker(app: &AppHandle) -> bool {
    if let Some(state) = app.try_state::<CollectCancelMarker>() {
        if let Ok(mut g) = state.0.lock() {
            let was_set = *g;
            *g = false;
            return was_set;
        }
    }
    false
}

/// Same as `cancel_active_job` but does NOT set the cancel marker. Used
/// from internal recovery paths (orphan reaper / queue dedup) where the
/// kill is a maintenance action — labelling the eventual exit as
/// "cancelled by user" would be misleading. The streaming Terminated
/// handler will then fall through to the regular classifier; for a true
/// orphan it never fires anyway because the sidecar is already dead.
pub fn cancel_active_job_silent(app: &AppHandle) -> bool {
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
        .env("GAPMAP_DATA_DIR", &data_str)
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

/// Kill the most-recently-started enrich child (and its dev-venv PID twin),
/// returning whether anything was actually terminated. Mirrors
/// `cancel_active_chat` / `cancel_active_stream` so the caller doesn't have
/// to know which sidecar arm (prod-bundle CommandChild vs dev-venv tokio
/// Child) the current enrich is using.
///
/// IMPORTANT: this only kills the process; it does NOT remove the
/// `enrich:<topic>` lock from `ActiveGraphOps`. Callers that want to free
/// the slot for a fresh enrich must clear it separately (the `cancel_enrich
/// _for_topic` command above does both in one round-trip — that is the
/// preferred entry point for UI code).
pub fn cancel_active_enrich(app: &AppHandle) -> bool {
    let mut killed = false;
    if let Some(state) = app.try_state::<ActiveEnrich>() {
        if let Ok(mut guard) = state.0.lock() {
            if let Some(child) = guard.take() {
                let _ = child.kill();
                killed = true;
            }
        }
    }
    if let Some(state) = app.try_state::<ActiveEnrichPid>() {
        if let Ok(mut guard) = state.0.lock() {
            if let Some(pid) = guard.take() {
                kill_pid(pid);
                killed = true;
            }
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
        .env("GAPMAP_DATA_DIR", &data_str)
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

/// Spawn the sidecar for a stream-mode enrich and forward each stdout line as
/// a Tauri `progress_event` payload. Uses its own ActiveEnrich/ActiveEnrichPid
/// slots so it doesn't collide with ActiveJob (collect) or ActiveStream
/// (gapmap stream) — a user reading the map while a collect finishes still
/// gets progressive painpoints.
///
/// Unlike the collect path, we DON'T refuse a second enrich here — the
/// per-topic dedup is enforced at `run_graph_op_deduped` above (via
/// ActiveGraphOps). That means two DIFFERENT topics can enrich in parallel
/// (e.g. user opens topic A map, then navigates to topic B — both stream).
pub async fn run_cli_enrich_streaming(
    app: &AppHandle,
    args: Vec<&str>,
    progress_event: &'static str,
    done_event: &'static str,
) -> Result<()> {
    let data = data_dir(app)?;
    let data_str = data.to_string_lossy().to_string();

    // Dev fast path — .venv/bin/python streaming. Uses ActiveEnrichPid so
    // a future cancel button can SIGTERM just the enrich without touching
    // an unrelated collect.
    if let Some(py) = find_dev_venv_python() {
        let pid_slot = if let Some(state) = app.try_state::<ActiveEnrichPid>() {
            state.0.clone()
        } else {
            Arc::new(Mutex::new(None))
        };
        return run_dev_python_streaming(
            app, py, &args, &data_str, progress_event, done_event, pid_slot,
            |code, _recent| {
                // Enrich failures are classified client-side from the NDJSON
                // stream (we already emit extractor:error). Here we just
                // surface the exit code so the UI can distinguish "process
                // crashed before final enrich:done" from "process exited
                // cleanly and the done event is the authoritative summary".
                serde_json::json!({ "code": code })
            },
        ).await;
    }

    let (mut rx, child) = build_sidecar_cmd(app, &args)?
        .env("GAPMAP_DATA_DIR", &data_str)
        .env("PYTHONUNBUFFERED", "1")
        .spawn()
        .map_err(|e| anyhow!("sidecar spawn failed: {e}"))?;

    if let Some(state) = app.try_state::<ActiveEnrich>() {
        *state.0.lock().unwrap() = Some(child);
    }

    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stderr(bytes) | CommandEvent::Stdout(bytes) => {
                    if let Ok(s) = String::from_utf8(bytes) {
                        for line in s.lines() {
                            if line.trim().is_empty() { continue; }
                            let _ = app_clone.emit(progress_event, line.to_string());
                        }
                    }
                }
                CommandEvent::Terminated(payload) => {
                    if let Some(state) = app_clone.try_state::<ActiveEnrich>() {
                        *state.0.lock().unwrap() = None;
                    }
                    let code = payload.code.unwrap_or(-1);
                    let _ = app_clone.emit(
                        done_event,
                        serde_json::json!({ "code": code }),
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
