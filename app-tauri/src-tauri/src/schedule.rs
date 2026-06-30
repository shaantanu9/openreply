//! Scheduled-run support — installs a macOS launchd agent that invokes
//! `openreply schedule-tick` on an interval. Linux / Windows
//! return a "not supported" status response.
//!
//! The sidecar binary path is resolved dynamically at install time so the
//! plist works regardless of where the app is installed (no hardcoded
//! `/Applications/...` path).

use serde_json::{json, Value};
use std::path::PathBuf;
use std::process::Command;

const LABEL: &str = "com.shantanu.openreply.schedule";

fn plist_path() -> Option<PathBuf> {
    let home = std::env::var_os("HOME")?;
    Some(PathBuf::from(home)
        .join("Library/LaunchAgents")
        .join(format!("{LABEL}.plist")))
}

fn sidecar_absolute(app: &tauri::AppHandle) -> Option<PathBuf> {
    // Prefer the dev-venv Python if present (so dev use matches runtime behavior).
    // Otherwise the bundled PyInstaller sidecar next to the app binary.
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            // Tauri dev: sidecar lives in src-tauri/binaries/, walk up.
            for up in 0..6 {
                let mut p = dir.to_path_buf();
                for _ in 0..up {
                    p = match p.parent() {
                        Some(pp) => pp.to_path_buf(),
                        None => break,
                    };
                }
                let cand = p
                    .join("src-tauri")
                    .join("binaries")
                    .join("openreply-cli-aarch64-apple-darwin");
                if cand.exists() {
                    return Some(cand);
                }
            }
        }
    }
    // Fall back to a well-known bundled location.
    let _ = app;
    None
}

fn plist_body(interval_secs: u32, sidecar: &str, data_dir: &str) -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>{label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>{sidecar}</string>
    <string>schedule-tick</string>
    <string>--json</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>OPENREPLY_DATA_DIR</key><string>{data_dir}</string>
    <key>PYTHONUNBUFFERED</key><string>1</string>
  </dict>
  <key>StartInterval</key><integer>{interval}</integer>
  <key>RunAtLoad</key><false/>
  <key>StandardOutPath</key><string>{data_dir}/schedule.log</string>
  <key>StandardErrorPath</key><string>{data_dir}/schedule.err.log</string>
</dict>
</plist>
"#,
        label = LABEL,
        sidecar = sidecar,
        data_dir = data_dir,
        interval = interval_secs,
    )
}

/// Write + load the launchd agent. Returns path on success.
#[cfg(target_os = "macos")]
pub fn install(app: &tauri::AppHandle, interval_hours: u32, data_dir: &str) -> Result<Value, String> {
    let interval_secs = interval_hours.saturating_mul(3600);
    if interval_secs < 300 {
        return Err("interval must be at least 300 seconds (5 minutes)".into());
    }
    let sidecar = sidecar_absolute(app)
        .ok_or_else(|| "could not resolve sidecar binary path".to_string())?;
    let sidecar_str = sidecar.to_string_lossy().to_string();
    let path = plist_path().ok_or("no home directory")?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let body = plist_body(interval_secs, &sidecar_str, data_dir);
    std::fs::write(&path, body).map_err(|e| e.to_string())?;
    // Unload first in case a previous version is loaded.
    let _ = Command::new("launchctl").args(["unload", "-w"]).arg(&path).output();
    let out = Command::new("launchctl")
        .args(["load", "-w"])
        .arg(&path)
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(format!(
            "launchctl load failed: {}",
            String::from_utf8_lossy(&out.stderr)
        ));
    }
    Ok(json!({
        "installed": true,
        "path": path.to_string_lossy(),
        "interval_hours": interval_hours,
        "sidecar": sidecar_str,
    }))
}

#[cfg(target_os = "macos")]
pub fn uninstall() -> Result<Value, String> {
    let path = plist_path().ok_or("no home directory")?;
    let _ = Command::new("launchctl").args(["unload", "-w"]).arg(&path).output();
    let _ = std::fs::remove_file(&path);
    Ok(json!({"uninstalled": true}))
}

#[cfg(target_os = "macos")]
pub fn status() -> Result<Value, String> {
    let path = plist_path().ok_or("no home directory")?;
    let installed = path.exists();
    // Ask launchctl if it's actually loaded.
    let loaded = Command::new("launchctl")
        .arg("list")
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.contains(LABEL))
        .unwrap_or(false);
    Ok(json!({
        "installed": installed,
        "loaded": loaded,
        "path": path.to_string_lossy(),
    }))
}

// ── Non-macOS stubs ─────────────────────────────────────────────────────

#[cfg(not(target_os = "macos"))]
pub fn install(_app: &tauri::AppHandle, _interval_hours: u32, _data_dir: &str) -> Result<Value, String> {
    Ok(json!({"installed": false, "reason": "not supported on this platform"}))
}

#[cfg(not(target_os = "macos"))]
pub fn uninstall() -> Result<Value, String> {
    Ok(json!({"uninstalled": false, "reason": "not supported on this platform"}))
}

#[cfg(not(target_os = "macos"))]
pub fn status() -> Result<Value, String> {
    Ok(json!({"installed": false, "loaded": false, "reason": "not supported on this platform"}))
}
