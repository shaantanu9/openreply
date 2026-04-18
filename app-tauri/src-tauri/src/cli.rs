//! Thin wrapper around the bundled `reddit-cli` Python sidecar.
//!
//! All UI commands funnel through here. We always pass `--json` and parse
//! stdout; on non-zero exit we surface stderr as the error message.

use anyhow::{anyhow, Result};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::{process::CommandEvent, ShellExt};

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

/// Start the sidecar and stream its stderr lines as Tauri events.
/// Callers listen on `progress_event` on the frontend.
pub async fn run_cli_streaming(
    app: &AppHandle,
    args: Vec<&str>,
    progress_event: &'static str,
    done_event: &'static str,
) -> Result<()> {
    let data = data_dir(app)?;
    let data_str = data.to_string_lossy().to_string();

    let (mut rx, _child) = app
        .shell()
        .sidecar("reddit-cli")
        .map_err(|e| anyhow!("sidecar missing: {e}"))?
        .env("REDDIT_MYIND_DATA_DIR", &data_str)
        .args(&args)
        .spawn()
        .map_err(|e| anyhow!("sidecar spawn failed: {e}"))?;

    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stderr(bytes) | CommandEvent::Stdout(bytes) => {
                    if let Ok(s) = String::from_utf8(bytes) {
                        // Emit each line individually if a chunk has newlines
                        for line in s.lines() {
                            if !line.trim().is_empty() {
                                let _ = app_clone.emit(progress_event, line.to_string());
                            }
                        }
                    }
                }
                CommandEvent::Terminated(payload) => {
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

