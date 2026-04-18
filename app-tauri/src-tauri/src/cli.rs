//! Thin wrapper around the bundled `reddit-cli` Python sidecar.
//!
//! Every UI command funnels through here. We always pass `--json` and parse
//! stdout; on non-zero exit we surface stderr as the error message.
//!
//! Long-running commands (collect) store the child handle in shared state
//! so a Cancel button can actually terminate the subprocess.

use anyhow::{anyhow, Result};
use serde_json::Value;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};

/// Shared handle to the currently-running long job (if any).
/// `main.rs` inserts this as managed state; commands mutate it.
#[derive(Default, Clone)]
pub struct ActiveJob(pub Arc<Mutex<Option<CommandChild>>>);

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

/// Run the sidecar with `args` + always `--json`, return parsed JSON.
pub async fn run_cli(app: &AppHandle, mut args: Vec<&str>) -> Result<Value> {
    if !args.iter().any(|a| *a == "--json") {
        args.push("--json");
    }
    let data = data_dir(app)?;
    let data_str = data.to_string_lossy().to_string();

    let sidecar = app
        .shell()
        .sidecar("reddit-cli")
        .map_err(|e| anyhow!("sidecar missing: {e}"))?
        .env("REDDIT_MYIND_DATA_DIR", &data_str)
        .args(&args);

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
    serde_json::from_str(&stdout).map_err(|e| anyhow!("bad json from cli: {e}\nstdout: {stdout}"))
}

/// Start the sidecar and stream output as Tauri events.
/// Stores the child handle in `ActiveJob` so cancel can kill it.
pub async fn run_cli_streaming(
    app: &AppHandle,
    args: Vec<&str>,
    progress_event: &'static str,
    done_event: &'static str,
) -> Result<()> {
    // Refuse to start a second job while one is running
    if let Some(state) = app.try_state::<ActiveJob>() {
        if state.0.lock().unwrap().is_some() {
            return Err(anyhow!(
                "another collect is already running. Cancel it first."
            ));
        }
    }

    let data = data_dir(app)?;
    let data_str = data.to_string_lossy().to_string();

    let (mut rx, child) = app
        .shell()
        .sidecar("reddit-cli")
        .map_err(|e| anyhow!("sidecar missing: {e}"))?
        .env("REDDIT_MYIND_DATA_DIR", &data_str)
        .args(&args)
        .spawn()
        .map_err(|e| anyhow!("sidecar spawn failed: {e}"))?;

    // Store child so cancel can reach it
    if let Some(state) = app.try_state::<ActiveJob>() {
        *state.0.lock().unwrap() = Some(child);
    }

    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stderr(bytes) | CommandEvent::Stdout(bytes) => {
                    if let Ok(s) = String::from_utf8(bytes) {
                        for line in s.lines() {
                            if !line.trim().is_empty() {
                                let _ = app_clone.emit(progress_event, line.to_string());
                            }
                        }
                    }
                }
                CommandEvent::Terminated(payload) => {
                    // Clear the active child handle
                    if let Some(state) = app_clone.try_state::<ActiveJob>() {
                        *state.0.lock().unwrap() = None;
                    }
                    let code = payload.code.unwrap_or(-1);
                    let _ = app_clone
                        .emit(done_event, serde_json::json!({"code": code}));
                    break;
                }
                _ => {}
            }
        }
    });

    Ok(())
}

/// Kill the currently-running sidecar child, if any.
pub fn cancel_active_job(app: &AppHandle) -> bool {
    if let Some(state) = app.try_state::<ActiveJob>() {
        let mut guard = state.0.lock().unwrap();
        if let Some(child) = guard.take() {
            let _ = child.kill();
            return true;
        }
    }
    false
}
