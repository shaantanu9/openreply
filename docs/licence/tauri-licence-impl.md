# OpenReply — Tauri Licence & Activation System
## Complete Implementation Spec for Local Model / Claude Code

> **Read this entire document before writing a single line of code.**
> This is the authoritative spec for the Tauri (Rust) side of the OpenReply
> licensing system. The server-side spec lives in `subscription-model.md`.
> These two documents together form the full system.

---

## 0. Architecture overview

```
┌─────────────────────────────────────────────────────────────┐
│                    OpenReply Desktop (Tauri)                    │
│                                                              │
│  ┌──────────────┐   invoke()   ┌───────────────────────────┐ │
│  │   Frontend   │ ──────────► │    Tauri Commands (Rust)   │ │
│  │ React/Svelte │ ◄────────── │  ALL feature gates here    │ │
│  └──────────────┘             └───────────┬───────────────┘ │
│                                           │                  │
│                         ┌─────────────────┼──────────────┐  │
│                         │                 │              │  │
│                   ┌─────▼──────┐  ┌──────▼──────┐       │  │
│                   │ licence.rs │  │ fingerprint │       │  │
│                   │ JWT verify │  │    .rs      │       │  │
│                   │ plan gates │  │ HW hash     │       │  │
│                   └─────┬──────┘  └─────────────┘       │  │
│                         │                                │  │
│                   ┌─────▼──────┐                         │  │
│                   │ stronghold │  ← OS Keychain           │  │
│                   │ JWT store  │    (macOS/Win/Linux)      │  │
│                   └────────────┘                         │  │
└───────────────────────────────────────────────────────────┘
                           │ HTTPS only
                    ┌──────▼──────────┐
                    │  Activation API │
                    │ (Next.js server)│
                    │ /api/v1/device/ │
                    │     activate    │
                    └─────────────────┘
```

**Key principle:** Every feature-gated operation goes through a Tauri command
written in Rust. The frontend cannot bypass Rust. There is no JavaScript path
to any premium feature — the JS only renders UI and calls `invoke()`.

---

## 1. Project structure

```
src-tauri/
├── Cargo.toml
├── build.rs                        ← bakes JWT secret into binary at compile time
├── tauri.conf.json
└── src/
    ├── main.rs                     ← app entry point, plugin registration
    ├── lib.rs                      ← command registration
    ├── licence/
    │   ├── mod.rs                  ← public API for the licence module
    │   ├── fingerprint.rs          ← device fingerprint (per OS)
    │   ├── jwt.rs                  ← JWT verify/decode/issue
    │   ├── store.rs                ← OS Keychain read/write via stronghold
    │   ├── validator.rs            ← online re-validation against server
    │   └── features.rs             ← feature set definition + free-tier defaults
    ├── commands/
    │   ├── mod.rs
    │   ├── activation.rs           ← activate_licence, deactivate_device
    │   ├── workspace.rs            ← create_workspace (gated)
    │   ├── sweep.rs                ← run_sweep, run_scheduled_sweep (gated)
    │   ├── export.rs               ← export_pdf, export_csv (gated)
    │   ├── monitor.rs              ← start_monitor, stop_monitor (gated)
    │   └── plan.rs                 ← get_plan_state (read current licence)
    └── error.rs                    ← unified LicenceError enum
```

---

## 2. Cargo.toml dependencies

```toml
[package]
name = "openreply"
version = "0.1.0"
edition = "2021"

[dependencies]
tauri = { version = "2", features = ["protocol-asset"] }

# OS Keychain — macOS Keychain / Windows Credential Manager / Linux libsecret
tauri-plugin-stronghold = "2"

# HTTP client for activation API calls
reqwest = { version = "0.12", features = ["json", "rustls-tls"], default-features = false }

# JWT — verify server-issued tokens
jsonwebtoken = "9"

# Hashing — SHA-256 for fingerprint + key hashing
sha2 = "0.10"
hex = "0.4"

# Serialization
serde = { version = "1", features = ["derive"] }
serde_json = "1"

# Async runtime
tokio = { version = "1", features = ["full"] }

# Error handling
thiserror = "1"
anyhow = "1"

# Time
chrono = { version = "0.4", features = ["serde"] }

# System info for fingerprinting
sysinfo = "0.30"

# macOS IOKit bindings (fingerprint)
[target.'cfg(target_os = "macos")'.dependencies]
core-foundation = "0.9"
io-kit-sys = "0.3"

# Windows registry (fingerprint)
[target.'cfg(target_os = "windows")'.dependencies]
winreg = "0.52"

[build-dependencies]
# nothing extra needed — we use env! macro
```

---

## 3. build.rs — bake JWT secret into binary at compile time

This is critical. The JWT verification secret never ships in a `.env` file,
never appears in source code, never in any readable file shipped with the app.
It is embedded into the compiled binary at build time.

```rust
// src-tauri/build.rs
fn main() {
    // JWT_DESKTOP_SECRET must be set in CI/CD environment, NOT committed to git
    // e.g. in GitHub Actions: secrets.JWT_DESKTOP_SECRET
    // Local dev: export JWT_DESKTOP_SECRET="your-dev-secret-here"
    println!("cargo:rerun-if-env-changed=JWT_DESKTOP_SECRET");

    let secret = std::env::var("JWT_DESKTOP_SECRET")
        .expect("JWT_DESKTOP_SECRET must be set at build time");

    // Validate it's long enough
    assert!(secret.len() >= 32, "JWT_DESKTOP_SECRET must be at least 32 chars");

    // Make it available as a compile-time constant in the binary
    println!("cargo:rustc-env=JWT_DESKTOP_SECRET={}", secret);

    tauri_build::build()
}
```

Usage in Rust code:
```rust
const JWT_SECRET: &str = env!("JWT_DESKTOP_SECRET");
// This string is embedded in the binary. It is NOT a runtime env var.
// The binary must be rebuilt if the secret rotates.
```

---

## 4. error.rs — unified error type

```rust
// src-tauri/src/error.rs
use serde::Serialize;
use thiserror::Error;

#[derive(Error, Debug, Serialize)]
#[serde(tag = "code", content = "message")]
pub enum LicenceError {
    #[error("No licence found — free tier active")]
    NoLicence,

    #[error("Licence expired")]
    Expired,

    #[error("Device mismatch — this licence belongs to a different machine")]
    DeviceMismatch,

    #[error("JWT signature invalid — token may have been tampered")]
    InvalidSignature,

    #[error("Plan upgrade required: {0}")]
    UpgradeRequired(String),  // "pro" | "live_pass" | "team"

    #[error("Device limit reached for this licence")]
    DeviceLimitReached,

    #[error("Invalid activation key")]
    InvalidKey,

    #[error("Key revoked")]
    KeyRevoked,

    #[error("Network error: {0}")]
    NetworkError(String),

    #[error("Server error: {0}")]
    ServerError(String),

    #[error("Storage error: {0}")]
    StorageError(String),
}

// Allow Tauri commands to return this as an Err
impl From<LicenceError> for String {
    fn from(e: LicenceError) -> Self {
        serde_json::to_string(&e).unwrap_or_else(|_| e.to_string())
    }
}
```

---

## 5. licence/features.rs — plan definitions embedded in Rust

```rust
// src-tauri/src/licence/features.rs
use serde::{Deserialize, Serialize};

/// The feature set extracted from a validated JWT.
/// This struct controls every gate in the app.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Features {
    /// null = unlimited
    pub max_workspaces: Option<u32>,
    /// null = unlimited
    pub max_sources: Option<u32>,
    /// Can run scheduled daily brief sweeps
    pub scheduler: bool,
    /// Can run live competitor monitors
    pub monitors: bool,
    /// Can export to PDF
    pub export_pdf: bool,
    /// Can export to CSV
    pub export_csv: bool,
    /// Days of signal history accessible
    pub history_days: u32,
    /// Extra device slots (Live Pass adds +1)
    pub max_devices: u32,
    /// plan identifier for UI display
    pub plan_id: String,
    /// whether a Live Pass add-on is active
    pub live_pass_active: bool,
    /// whether this is a trial
    pub is_trial: bool,
    /// trial days remaining (0 if not trial)
    pub trial_days_left: u32,
}

impl Features {
    /// Free tier — returned when no valid JWT is present
    pub fn free() -> Self {
        Self {
            max_workspaces: Some(1),
            max_sources: Some(3),
            scheduler: false,
            monitors: false,
            export_pdf: false,
            export_csv: false,
            history_days: 30,
            max_devices: 1,
            plan_id: "free".to_string(),
            live_pass_active: false,
            is_trial: false,
            trial_days_left: 0,
        }
    }

    /// Pro perpetual (no Live Pass)
    pub fn pro() -> Self {
        Self {
            max_workspaces: None,
            max_sources: None,
            scheduler: false,
            monitors: false,
            export_pdf: true,
            export_csv: true,
            history_days: 365,
            max_devices: 1,
            plan_id: "pro".to_string(),
            live_pass_active: false,
            is_trial: false,
            trial_days_left: 0,
        }
    }

    /// Pro + Live Pass
    pub fn pro_with_live_pass() -> Self {
        Self {
            max_workspaces: None,
            max_sources: None,
            scheduler: true,
            monitors: true,
            export_pdf: true,
            export_csv: true,
            history_days: 365,
            max_devices: 2,
            plan_id: "live_pass".to_string(),
            live_pass_active: true,
            is_trial: false,
            trial_days_left: 0,
        }
    }

    /// Team plan
    pub fn team() -> Self {
        Self {
            max_workspaces: None,
            max_sources: None,
            scheduler: true,
            monitors: true,
            export_pdf: true,
            export_csv: true,
            history_days: 365,
            max_devices: 3,
            plan_id: "team".to_string(),
            live_pass_active: true,
            is_trial: false,
            trial_days_left: 0,
        }
    }

    /// Pro trial (same as Pro but with trial flags)
    pub fn pro_trial(days_left: u32) -> Self {
        Self {
            is_trial: true,
            trial_days_left: days_left,
            plan_id: "pro_trial".to_string(),
            ..Self::pro()
        }
    }
}

/// Check helpers used by Tauri commands
impl Features {
    pub fn check_workspace_limit(&self, current_count: u32) -> bool {
        match self.max_workspaces {
            None => true,
            Some(max) => current_count < max,
        }
    }

    pub fn check_source_limit(&self, current_count: u32) -> bool {
        match self.max_sources {
            None => true,
            Some(max) => current_count < max,
        }
    }

    pub fn check_history_access(&self, days_ago: u32) -> bool {
        days_ago <= self.history_days
    }
}
```

---

## 6. licence/fingerprint.rs — hardware device fingerprint

```rust
// src-tauri/src/licence/fingerprint.rs
use sha2::{Digest, Sha256};

/// Returns a stable, deterministic SHA-256 fingerprint for this device.
/// Same machine always returns the same hash.
/// Cannot be reversed to obtain hardware IDs.
/// Survives OS reinstalls (tied to logic board, not OS install).
pub fn get_device_fingerprint() -> String {
    let raw = collect_raw_identifiers();
    hash_raw(&raw)
}

fn hash_raw(raw: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(raw.as_bytes());
    hex::encode(hasher.finalize())
}

// ── macOS implementation ────────────────────────────────────────────────────
#[cfg(target_os = "macos")]
fn collect_raw_identifiers() -> String {
    let hw_uuid = get_macos_hw_uuid().unwrap_or_else(|| "unknown_uuid".to_string());
    let serial  = get_macos_serial().unwrap_or_else(|| "unknown_serial".to_string());
    // Salt with app name so the same hash can't be used for another app
    format!("openreply::macos::{}::{}", hw_uuid, serial)
}

#[cfg(target_os = "macos")]
fn get_macos_hw_uuid() -> Option<String> {
    // IOPlatformUUID — tied to the logic board, survives reinstalls
    // This is what Apple uses for device registration
    let output = std::process::Command::new("ioreg")
        .args(["-d2", "-c", "IOPlatformExpertDevice"])
        .output()
        .ok()?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    for line in stdout.lines() {
        if line.contains("IOPlatformUUID") {
            // Line looks like: "IOPlatformUUID" = "XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX"
            let parts: Vec<&str> = line.splitn(2, '=').collect();
            if let Some(val) = parts.get(1) {
                return Some(val.trim().trim_matches('"').to_string());
            }
        }
    }
    None
}

#[cfg(target_os = "macos")]
fn get_macos_serial() -> Option<String> {
    let output = std::process::Command::new("system_profiler")
        .args(["SPHardwareDataType"])
        .output()
        .ok()?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    for line in stdout.lines() {
        if line.trim().starts_with("Serial Number") {
            // Line: "      Serial Number (system): XXXXXXXXXX"
            let parts: Vec<&str> = line.splitn(2, ':').collect();
            if let Some(val) = parts.get(1) {
                return Some(val.trim().to_string());
            }
        }
    }
    None
}

// ── Windows implementation ──────────────────────────────────────────────────
#[cfg(target_os = "windows")]
fn collect_raw_identifiers() -> String {
    let machine_guid = get_windows_machine_guid()
        .unwrap_or_else(|| "unknown_guid".to_string());
    let cpu_id = get_windows_cpu_id()
        .unwrap_or_else(|| "unknown_cpu".to_string());
    format!("openreply::windows::{}::{}", machine_guid, cpu_id)
}

#[cfg(target_os = "windows")]
fn get_windows_machine_guid() -> Option<String> {
    use winreg::enums::*;
    use winreg::RegKey;
    // MachineGuid is set on Windows installation, stable across reboots
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let crypto = hklm.open_subkey("SOFTWARE\\Microsoft\\Cryptography").ok()?;
    crypto.get_value("MachineGuid").ok()
}

#[cfg(target_os = "windows")]
fn get_windows_cpu_id() -> Option<String> {
    // ProcessorId from WMI — additional entropy
    let output = std::process::Command::new("wmic")
        .args(["cpu", "get", "ProcessorId", "/value"])
        .output()
        .ok()?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    for line in stdout.lines() {
        if line.starts_with("ProcessorId=") {
            return Some(line.trim_start_matches("ProcessorId=").trim().to_string());
        }
    }
    None
}

// ── Linux implementation ─────────────────────────────────────────────────────
#[cfg(target_os = "linux")]
fn collect_raw_identifiers() -> String {
    let machine_id = get_linux_machine_id()
        .unwrap_or_else(|| "unknown_id".to_string());
    format!("openreply::linux::{}", machine_id)
}

#[cfg(target_os = "linux")]
fn get_linux_machine_id() -> Option<String> {
    // /etc/machine-id — set on OS install, stable across reboots
    std::fs::read_to_string("/etc/machine-id")
        .or_else(|_| std::fs::read_to_string("/var/lib/dbus/machine-id"))
        .ok()
        .map(|s| s.trim().to_string())
}
```

---

## 7. licence/jwt.rs — JWT claims and verification

```rust
// src-tauri/src/licence/jwt.rs
use chrono::Utc;
use jsonwebtoken::{decode, Algorithm, DecodingKey, Validation};
use serde::{Deserialize, Serialize};

use crate::error::LicenceError;
use crate::licence::features::Features;

/// The full claims payload embedded in the JWT issued by the activation server.
/// This mirrors the server-side JWT payload exactly — keep both in sync.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LicenceClaims {
    // Standard JWT fields
    pub sub: String,           // licence ID (uuid)
    pub iss: String,           // "openreply-activation-suite"
    pub aud: Vec<String>,      // ["openreply-desktop"]
    pub iat: i64,              // issued at (unix timestamp)
    pub exp: i64,              // expiry (unix timestamp) — 180 days from issue

    // OpenReply specific
    pub user_id: String,
    pub email: String,
    pub device_fingerprint: String,  // sha256 of hardware fingerprint
    pub plan_id: String,             // "free" | "pro" | "live_pass" | "team" | "pro_trial"
    pub live_pass_active: bool,
    pub is_trial: bool,
    pub trial_ends_at: Option<i64>,  // unix timestamp, None if not trial
    pub features: Features,          // full feature set embedded — works offline
}

impl LicenceClaims {
    /// Compute remaining trial days. Returns 0 if not a trial or already expired.
    pub fn trial_days_left(&self) -> u32 {
        if !self.is_trial {
            return 0;
        }
        if let Some(ends_at) = self.trial_ends_at {
            let now = Utc::now().timestamp();
            if ends_at > now {
                return ((ends_at - now) / 86400).max(0) as u32;
            }
        }
        0
    }

    /// True if the JWT itself has expired (180-day window)
    pub fn is_jwt_expired(&self) -> bool {
        Utc::now().timestamp() > self.exp
    }
}

/// Verify and decode a JWT string.
/// Returns LicenceClaims on success, LicenceError on any failure.
pub fn verify_jwt(token: &str) -> Result<LicenceClaims, LicenceError> {
    // Secret baked into binary at compile time via build.rs
    let secret = env!("JWT_DESKTOP_SECRET");
    let key = DecodingKey::from_secret(secret.as_bytes());

    let mut validation = Validation::new(Algorithm::HS256);
    validation.set_issuer(&["openreply-activation-suite"]);
    validation.set_audience(&["openreply-desktop"]);
    // We handle expiry manually so offline use works past JWT exp
    // (we re-validate online but don't lock out offline users immediately)
    validation.validate_exp = false;

    let token_data = decode::<LicenceClaims>(token, &key, &validation)
        .map_err(|e| match e.kind() {
            jsonwebtoken::errors::ErrorKind::InvalidSignature => LicenceError::InvalidSignature,
            jsonwebtoken::errors::ErrorKind::ExpiredSignature => LicenceError::Expired,
            _ => LicenceError::InvalidSignature,
        })?;

    Ok(token_data.claims)
}
```

---

## 8. licence/store.rs — OS Keychain storage

```rust
// src-tauri/src/licence/store.rs
//
// Uses tauri-plugin-stronghold which wraps:
//   macOS  → Keychain Services (same as Safari passwords)
//   Windows → Windows Credential Manager
//   Linux  → libsecret / kwallet
//
// The JWT is NEVER written to a plain file on disk.
// NEVER stored in localStorage or any web storage.
// NEVER passed to the frontend.

use crate::error::LicenceError;

const KEYCHAIN_KEY: &str = "openreply_licence_token";
const KEYCHAIN_VAULT: &str = "openreply.app";

/// Save JWT to OS keychain. Overwrites any existing entry.
pub fn save_token(token: &str) -> Result<(), LicenceError> {
    // tauri-plugin-stronghold API
    // In Tauri v2 you access this through the app handle
    // Actual implementation wired in commands/activation.rs where app handle is available
    // This module defines the interface; see activation.rs for the wiring
    keychain_write(KEYCHAIN_VAULT, KEYCHAIN_KEY, token.as_bytes())
        .map_err(|e| LicenceError::StorageError(e.to_string()))
}

/// Read JWT from OS keychain. Returns None if not found.
pub fn read_token() -> Option<String> {
    keychain_read(KEYCHAIN_VAULT, KEYCHAIN_KEY)
        .ok()
        .flatten()
        .and_then(|bytes| String::from_utf8(bytes).ok())
}

/// Delete JWT from OS keychain. Used on deactivation or revocation.
pub fn clear_token() -> Result<(), LicenceError> {
    keychain_delete(KEYCHAIN_VAULT, KEYCHAIN_KEY)
        .map_err(|e| LicenceError::StorageError(e.to_string()))
}

// ── Stronghold wrappers ─────────────────────────────────────────────────────
// These are thin wrappers. The actual tauri-plugin-stronghold calls
// happen through the AppHandle in commands. Replace these stubs with
// the real stronghold plugin calls as per tauri-plugin-stronghold docs.

fn keychain_write(vault: &str, key: &str, value: &[u8]) -> anyhow::Result<()> {
    // TODO: wire to tauri_plugin_stronghold
    // stronghold.save_record(vault, key, value)?;
    // For now stub with a file-based fallback for development only
    #[cfg(debug_assertions)]
    {
        let path = std::env::temp_dir().join(format!("{}.{}.tmp", vault, key));
        std::fs::write(path, value)?;
    }
    Ok(())
}

fn keychain_read(vault: &str, key: &str) -> anyhow::Result<Option<Vec<u8>>> {
    #[cfg(debug_assertions)]
    {
        let path = std::env::temp_dir().join(format!("{}.{}.tmp", vault, key));
        if path.exists() {
            return Ok(Some(std::fs::read(path)?));
        }
        return Ok(None);
    }
    #[allow(unreachable_code)]
    Ok(None)
}

fn keychain_delete(vault: &str, key: &str) -> anyhow::Result<()> {
    #[cfg(debug_assertions)]
    {
        let path = std::env::temp_dir().join(format!("{}.{}.tmp", vault, key));
        if path.exists() { std::fs::remove_file(path)?; }
    }
    Ok(())
}
```

---

## 9. licence/validator.rs — online heartbeat + re-validation

```rust
// src-tauri/src/licence/validator.rs
//
// Called on every app launch (non-blocking, background task).
// If online: pings server to check revocation + plan changes.
// If offline: trusts local JWT (works for up to 180 days offline).
// Server can return a refreshed JWT with updated plan info.

use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;

use crate::error::LicenceError;
use crate::licence::features::Features;

const VALIDATE_URL: &str = "https://your-activation-server.vercel.app/api/v1/licence/validate";
const TIMEOUT_SECS: u64 = 4;  // Don't block app launch more than 4 seconds

#[derive(Serialize)]
struct ValidateRequest {
    device_fingerprint: String,
}

#[derive(Deserialize)]
struct ValidateResponse {
    valid: bool,
    revoked: bool,
    refreshed_token: Option<String>,  // new JWT if plan changed server-side
    message: Option<String>,
}

/// Perform background validation. Returns updated JWT if server issued one.
/// Returns None if offline or server unreachable — caller uses existing JWT.
pub async fn validate_online(
    current_jwt: &str,
    device_fingerprint: &str,
) -> Option<String> {
    let client = Client::builder()
        .timeout(Duration::from_secs(TIMEOUT_SECS))
        .build()
        .ok()?;

    let res = client
        .post(VALIDATE_URL)
        .bearer_auth(current_jwt)
        .json(&ValidateRequest {
            device_fingerprint: device_fingerprint.to_string(),
        })
        .send()
        .await
        .ok()?;

    match res.status().as_u16() {
        200 => {
            let body: ValidateResponse = res.json().await.ok()?;
            if body.revoked {
                // Server explicitly revoked this licence — signal to wipe local token
                return Some("__REVOKED__".to_string());
            }
            // Return refreshed token if server issued one (plan upgrade/downgrade)
            body.refreshed_token
        }
        401 => Some("__REVOKED__".to_string()),
        _ => None,  // Server error — fail gracefully, use local JWT
    }
}
```

---

## 10. licence/mod.rs — the public API

```rust
// src-tauri/src/licence/mod.rs
//
// This is the only file other modules import from.
// All internal implementation is private.

pub mod features;
pub mod fingerprint;
pub mod jwt;
pub mod store;
pub mod validator;

use crate::error::LicenceError;
use features::Features;
use fingerprint::get_device_fingerprint;
use jwt::{verify_jwt, LicenceClaims};
use store::{clear_token, read_token, save_token};

/// The single source of truth for licence state.
/// Cached after first load; refreshed on online validation.
#[derive(Debug, Clone)]
pub struct LicenceState {
    pub claims: Option<LicenceClaims>,
    pub features: Features,
    pub fingerprint: String,
}

impl LicenceState {
    /// Load and verify licence from OS keychain.
    /// Returns free tier if no valid licence found.
    /// This is called on every app launch.
    pub fn load() -> Self {
        let fingerprint = get_device_fingerprint();
        let features;
        let claims;

        match try_load_licence(&fingerprint) {
            Ok(c) => {
                // Build features with current trial_days_left
                let mut f = c.features.clone();
                f.trial_days_left = c.trial_days_left();
                f.is_trial = c.is_trial;
                features = f;
                claims = Some(c);
            }
            Err(e) => {
                eprintln!("[licence] Load failed: {:?} — using free tier", e);
                features = Features::free();
                claims = None;
            }
        }

        Self { claims, features, fingerprint }
    }

    /// Save a newly issued JWT (from activation API response)
    pub fn save_new_token(&mut self, token: &str) -> Result<(), LicenceError> {
        // Verify before saving — never store garbage
        let new_claims = verify_jwt(token)?;

        // Verify device fingerprint matches this machine
        if new_claims.device_fingerprint != self.fingerprint {
            return Err(LicenceError::DeviceMismatch);
        }

        save_token(token)?;

        // Update in-memory state
        let mut features = new_claims.features.clone();
        features.trial_days_left = new_claims.trial_days_left();
        features.is_trial = new_claims.is_trial;
        self.features = features;
        self.claims = Some(new_claims);

        Ok(())
    }

    /// Wipe licence and fall to free tier (revocation / deactivation)
    pub fn revoke(&mut self) {
        let _ = clear_token();
        self.features = Features::free();
        self.claims = None;
    }

    /// Update from a refreshed JWT issued by online validation
    pub fn apply_refreshed_token(&mut self, token: &str) -> Result<(), LicenceError> {
        self.save_new_token(token)
    }

    // ── Feature gate helpers used by Tauri commands ──────────────────────────

    pub fn require_pro(&self) -> Result<(), LicenceError> {
        if self.claims.is_none() {
            return Err(LicenceError::UpgradeRequired("pro".to_string()));
        }
        Ok(())
    }

    pub fn require_live_pass(&self) -> Result<(), LicenceError> {
        if !self.features.live_pass_active {
            return Err(LicenceError::UpgradeRequired("live_pass".to_string()));
        }
        Ok(())
    }

    pub fn require_workspace_slot(&self, current_count: u32) -> Result<(), LicenceError> {
        if !self.features.check_workspace_limit(current_count) {
            return Err(LicenceError::UpgradeRequired("pro".to_string()));
        }
        Ok(())
    }

    pub fn require_source_slot(&self, current_count: u32) -> Result<(), LicenceError> {
        if !self.features.check_source_limit(current_count) {
            return Err(LicenceError::UpgradeRequired("pro".to_string()));
        }
        Ok(())
    }

    pub fn require_pdf_export(&self) -> Result<(), LicenceError> {
        if !self.features.export_pdf {
            return Err(LicenceError::UpgradeRequired("pro".to_string()));
        }
        Ok(())
    }

    pub fn require_csv_export(&self) -> Result<(), LicenceError> {
        if !self.features.export_csv {
            return Err(LicenceError::UpgradeRequired("pro".to_string()));
        }
        Ok(())
    }

    pub fn require_history_access(&self, days_ago: u32) -> Result<(), LicenceError> {
        if !self.features.check_history_access(days_ago) {
            return Err(LicenceError::UpgradeRequired("pro".to_string()));
        }
        Ok(())
    }
}

fn try_load_licence(fingerprint: &str) -> Result<LicenceClaims, LicenceError> {
    // 1. Read from keychain
    let token = read_token().ok_or(LicenceError::NoLicence)?;

    // 2. Verify JWT signature (secret baked into binary)
    let claims = verify_jwt(&token)?;

    // 3. *** THE ANTI-SHARING CHECK ***
    // Device fingerprint in JWT must match this machine's fingerprint
    if claims.device_fingerprint != fingerprint {
        // Someone copied the JWT file from another machine
        // Wipe it and fall to free tier
        let _ = clear_token();
        return Err(LicenceError::DeviceMismatch);
    }

    // 4. Check if trial has expired
    if claims.is_trial && claims.trial_days_left() == 0 {
        // Trial expired — server will have downgraded, but we also check locally
        // We still return the claims and let the server validation downgrade
        // Don't wipe immediately in case user is offline
    }

    Ok(claims)
}
```

---

## 11. commands/activation.rs — Tauri commands for key entry + device management

```rust
// src-tauri/src/commands/activation.rs
use reqwest::Client;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::Mutex;
use tauri::State;

use crate::error::LicenceError;
use crate::licence::{fingerprint::get_device_fingerprint, LicenceState};

// ── Shared state ────────────────────────────────────────────────────────────
pub type LicenceMutex = Mutex<LicenceState>;

// ── Request/response types ───────────────────────────────────────────────────

#[derive(Serialize)]
struct ActivateRequest {
    email: String,
    activation_key: String,
    device_fingerprint: String,
    app: String,
    os: String,
    arch: String,
}

#[derive(Deserialize)]
struct ActivateResponse {
    token: String,
    plan_id: String,
    device_id: String,
}

#[derive(Serialize)]
pub struct ActivateResult {
    pub plan_id: String,
    pub email: String,
    pub device_id: String,
}

#[derive(Serialize)]
pub struct DeviceInfo {
    pub os: String,
    pub arch: String,
    pub fingerprint_preview: String,  // first 8 chars only — never expose full hash to frontend
}

// ── Commands ─────────────────────────────────────────────────────────────────

/// Called when user enters activation key in the UI.
/// Sends key + device fingerprint to server, stores returned JWT in keychain.
#[tauri::command]
pub async fn activate_licence(
    email: String,
    activation_key: String,
    licence: State<'_, LicenceMutex>,
    app: tauri::AppHandle,
) -> Result<ActivateResult, String> {

    // Sanitise key — remove dashes, uppercase
    let clean_key = activation_key
        .replace('-', "")
        .to_uppercase()
        .trim()
        .to_string();

    if clean_key.len() != 16 {
        return Err(LicenceError::InvalidKey.into());
    }

    let fingerprint = get_device_fingerprint();
    let os = std::env::consts::OS.to_string();
    let arch = std::env::consts::ARCH.to_string();

    // Call activation server
    let client = Client::new();
    let server_url = option_env!("ACTIVATION_SERVER_URL")
        .unwrap_or("https://your-activation-server.vercel.app");

    let res = client
        .post(format!("{}/api/v1/device/activate", server_url))
        .json(&ActivateRequest {
            email: email.clone(),
            activation_key: clean_key,
            device_fingerprint: fingerprint.clone(),
            app: "openreply-desktop".to_string(),
            os: os.clone(),
            arch: arch.clone(),
        })
        .send()
        .await
        .map_err(|e| LicenceError::NetworkError(e.to_string()))?;

    match res.status().as_u16() {
        200 => {
            let body: ActivateResponse = res.json().await
                .map_err(|e| LicenceError::ServerError(e.to_string()))?;

            // Save JWT to keychain + update in-memory state
            let mut state = licence.lock().unwrap();
            state.save_new_token(&body.token)
                .map_err(|e| LicenceError::StorageError(e.to_string()))?;

            Ok(ActivateResult {
                plan_id: body.plan_id,
                email,
                device_id: body.device_id,
            })
        }
        401 => Err(LicenceError::InvalidKey.into()),
        409 => Err(LicenceError::DeviceLimitReached.into()),
        403 => Err(LicenceError::KeyRevoked.into()),
        _ => {
            let msg = res.text().await.unwrap_or_default();
            Err(LicenceError::ServerError(msg).into())
        }
    }
}

/// Called on app launch — background online validation.
/// Non-blocking: spawned as a task, updates state if server responds.
#[tauri::command]
pub async fn validate_licence_online(
    licence: State<'_, LicenceMutex>,
) -> Result<(), String> {

    let (token, fingerprint) = {
        let state = licence.lock().unwrap();
        let token = crate::licence::store::read_token();
        let fp = state.fingerprint.clone();
        (token, fp)
    };

    let Some(token) = token else { return Ok(()); };

    use crate::licence::validator::validate_online;
    let result = validate_online(&token, &fingerprint).await;

    match result {
        Some(r) if r == "__REVOKED__" => {
            let mut state = licence.lock().unwrap();
            state.revoke();
            // Emit event to frontend so it can show revocation notice
            // app.emit("licence:revoked", ()).ok();
        }
        Some(refreshed_token) => {
            let mut state = licence.lock().unwrap();
            let _ = state.apply_refreshed_token(&refreshed_token);
            // Emit event so frontend re-reads plan state
            // app.emit("licence:refreshed", ()).ok();
        }
        None => {} // Offline or server error — use local JWT, no action needed
    }

    Ok(())
}

/// Deactivate this device — frees a slot on the server.
#[tauri::command]
pub async fn deactivate_device(
    licence: State<'_, LicenceMutex>,
) -> Result<(), String> {

    let (token, fingerprint) = {
        let state = licence.lock().unwrap();
        let t = crate::licence::store::read_token().ok_or("no_licence")?;
        let fp = state.fingerprint.clone();
        (t, fp)
    };

    let client = Client::new();
    let server_url = option_env!("ACTIVATION_SERVER_URL")
        .unwrap_or("https://your-activation-server.vercel.app");

    let _ = client
        .post(format!("{}/api/v1/device/deactivate", server_url))
        .bearer_auth(&token)
        .json(&serde_json::json!({ "device_fingerprint": fingerprint }))
        .send()
        .await;

    // Always clear local token regardless of server response
    let mut state = licence.lock().unwrap();
    state.revoke();

    Ok(())
}

/// Returns current plan state to the frontend.
/// Frontend uses this for rendering upgrade prompts, plan badges, etc.
#[tauri::command]
pub fn get_plan_state(
    licence: State<'_, LicenceMutex>,
) -> crate::licence::features::Features {
    licence.lock().unwrap().features.clone()
}

/// Returns device info for display on the activation page.
#[tauri::command]
pub fn get_device_info() -> DeviceInfo {
    let fp = get_device_fingerprint();
    DeviceInfo {
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        fingerprint_preview: format!("{}…", &fp[..8]),
    }
}
```

---

## 12. commands/workspace.rs — gated workspace commands

```rust
// src-tauri/src/commands/workspace.rs
use serde::{Deserialize, Serialize};
use tauri::State;
use crate::commands::activation::LicenceMutex;
use crate::error::LicenceError;

#[derive(Serialize, Deserialize)]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub source_count: u32,
    pub created_at: String,
}

/// Create a new workspace.
/// Gated: Free = 1 workspace max. Pro/Live Pass = unlimited.
#[tauri::command]
pub async fn create_workspace(
    name: String,
    licence: State<'_, LicenceMutex>,
) -> Result<Workspace, String> {

    let state = licence.lock().unwrap();

    // Count existing workspaces from local DB
    let current_count = count_workspaces_in_db().await;

    state.require_workspace_slot(current_count)
        .map_err(|e| -> String { e.into() })?;

    drop(state);  // release lock before async DB call

    // Proceed to create
    create_workspace_in_db(name).await
        .map_err(|e| LicenceError::ServerError(e.to_string()).into())
}

/// Add a source connector to a workspace.
/// Gated: Free = 3 sources max. Pro = unlimited.
#[tauri::command]
pub async fn add_source(
    workspace_id: String,
    source_type: String,
    licence: State<'_, LicenceMutex>,
) -> Result<(), String> {

    let state = licence.lock().unwrap();
    let current_source_count = count_sources_in_workspace(&workspace_id).await;
    state.require_source_slot(current_source_count)
        .map_err(|e| -> String { e.into() })?;
    drop(state);

    add_source_to_db(&workspace_id, &source_type).await
        .map_err(|e| LicenceError::ServerError(e.to_string()).into())
}

// Stub DB helpers — replace with actual SQLite/SQLx calls
async fn count_workspaces_in_db() -> u32 { 0 }
async fn count_sources_in_workspace(_id: &str) -> u32 { 0 }
async fn create_workspace_in_db(_name: String) -> anyhow::Result<Workspace> {
    Ok(Workspace { id: uuid::Uuid::new_v4().to_string(), name: _name, source_count: 0, created_at: "".to_string() })
}
async fn add_source_to_db(_ws: &str, _src: &str) -> anyhow::Result<()> { Ok(()) }
```

---

## 13. commands/sweep.rs — gated sweep commands

```rust
// src-tauri/src/commands/sweep.rs
use tauri::State;
use crate::commands::activation::LicenceMutex;

/// Run a manual sweep — available on all plans including Free.
/// (Free is limited by source count, not sweep execution)
#[tauri::command]
pub async fn run_manual_sweep(
    workspace_id: String,
    licence: State<'_, LicenceMutex>,
) -> Result<SweepResult, String> {

    // Manual sweep is always allowed if licence exists
    // Source limit is enforced at source-add time, not sweep time
    let _state = licence.lock().unwrap();

    execute_sweep(&workspace_id).await
        .map_err(|e| e.to_string())
}

/// Run a scheduled sweep (daily brief mode).
/// Gated: Live Pass or Team plan only.
#[tauri::command]
pub async fn run_scheduled_sweep(
    workspace_id: String,
    licence: State<'_, LicenceMutex>,
) -> Result<SweepResult, String> {

    {
        let state = licence.lock().unwrap();
        state.require_live_pass()
            .map_err(|e| -> String { e.into() })?;
    }

    execute_sweep(&workspace_id).await
        .map_err(|e| e.to_string())
}

/// Configure the daily brief scheduler.
/// Gated: Live Pass or Team plan only.
#[tauri::command]
pub async fn configure_scheduler(
    workspace_id: String,
    cron_expression: String,
    licence: State<'_, LicenceMutex>,
) -> Result<(), String> {

    {
        let state = licence.lock().unwrap();
        state.require_live_pass()
            .map_err(|e| -> String { e.into() })?;
    }

    save_scheduler_config(&workspace_id, &cron_expression).await
        .map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
pub struct SweepResult {
    pub posts_indexed: u32,
    pub pain_points_found: u32,
    pub sources_swept: u32,
}

async fn execute_sweep(_ws: &str) -> anyhow::Result<SweepResult> {
    Ok(SweepResult { posts_indexed: 0, pain_points_found: 0, sources_swept: 0 })
}
async fn save_scheduler_config(_ws: &str, _cron: &str) -> anyhow::Result<()> { Ok(()) }
```

---

## 14. commands/export.rs — gated export commands

```rust
// src-tauri/src/commands/export.rs
use tauri::State;
use crate::commands::activation::LicenceMutex;

/// Export workspace as Markdown — free on all plans.
#[tauri::command]
pub async fn export_markdown(
    workspace_id: String,
    _licence: State<'_, LicenceMutex>,
) -> Result<String, String> {
    // No gate — markdown is always free
    generate_markdown_export(&workspace_id).await
        .map_err(|e| e.to_string())
}

/// Export workspace as PDF — Pro and above only.
#[tauri::command]
pub async fn export_pdf(
    workspace_id: String,
    licence: State<'_, LicenceMutex>,
) -> Result<Vec<u8>, String> {

    {
        let state = licence.lock().unwrap();
        state.require_pdf_export()
            .map_err(|e| -> String { e.into() })?;
    }

    generate_pdf_export(&workspace_id).await
        .map_err(|e| e.to_string())
}

/// Export workspace as CSV — Pro and above only.
#[tauri::command]
pub async fn export_csv(
    workspace_id: String,
    licence: State<'_, LicenceMutex>,
) -> Result<String, String> {

    {
        let state = licence.lock().unwrap();
        state.require_csv_export()
            .map_err(|e| -> String { e.into() })?;
    }

    generate_csv_export(&workspace_id).await
        .map_err(|e| e.to_string())
}

async fn generate_markdown_export(_ws: &str) -> anyhow::Result<String> { Ok(String::new()) }
async fn generate_pdf_export(_ws: &str) -> anyhow::Result<Vec<u8>> { Ok(vec![]) }
async fn generate_csv_export(_ws: &str) -> anyhow::Result<String> { Ok(String::new()) }
```

---

## 15. commands/monitor.rs — competitor monitoring (Live Pass only)

```rust
// src-tauri/src/commands/monitor.rs
use tauri::State;
use crate::commands::activation::LicenceMutex;

/// Start a competitor monitor.
/// Gated: Live Pass or Team plan only.
#[tauri::command]
pub async fn start_competitor_monitor(
    competitor_name: String,
    source_types: Vec<String>,
    licence: State<'_, LicenceMutex>,
) -> Result<String, String> {

    {
        let state = licence.lock().unwrap();
        state.require_live_pass()
            .map_err(|e| -> String { e.into() })?;
    }

    create_monitor(&competitor_name, &source_types).await
        .map_err(|e| e.to_string())
}

async fn create_monitor(_name: &str, _sources: &[String]) -> anyhow::Result<String> {
    Ok(uuid::Uuid::new_v4().to_string())
}
```

---

## 16. main.rs — app entry point and state setup

```rust
// src-tauri/src/main.rs
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod error;
mod licence;

use commands::activation::{
    activate_licence, deactivate_device, get_device_info, get_plan_state,
    validate_licence_online, LicenceMutex,
};
use commands::export::{export_csv, export_markdown, export_pdf};
use commands::monitor::start_competitor_monitor;
use commands::sweep::{configure_scheduler, run_manual_sweep, run_scheduled_sweep};
use commands::workspace::{add_source, create_workspace};
use licence::LicenceState;
use std::sync::Mutex;

fn main() {
    // Load licence state on startup — sync, before app window opens
    // Falls to free tier gracefully if no valid JWT found
    let licence_state = LicenceState::load();

    tauri::Builder::default()
        .plugin(tauri_plugin_stronghold::Builder::new(|password| {
            // Derive vault key from machine fingerprint
            // This means the vault can only be opened on this machine
            use argon2::Argon2;
            let fp = licence::fingerprint::get_device_fingerprint();
            let salt = b"openreply_vault_salt_v1";
            let mut key = vec![0u8; 32];
            Argon2::default()
                .hash_password_into(fp.as_bytes(), salt, &mut key)
                .expect("key derivation failed");
            key
        }).build())
        // Register licence state as managed state — accessible in all commands
        .manage(Mutex::new(licence_state) as LicenceMutex)
        // Register all commands
        .invoke_handler(tauri::generate_handler![
            // Activation
            activate_licence,
            deactivate_device,
            validate_licence_online,
            get_plan_state,
            get_device_info,
            // Workspace
            create_workspace,
            add_source,
            // Sweep
            run_manual_sweep,
            run_scheduled_sweep,
            configure_scheduler,
            // Export
            export_markdown,
            export_pdf,
            export_csv,
            // Monitor
            start_competitor_monitor,
        ])
        .setup(|app| {
            // Spawn background online validation — non-blocking
            // App continues loading while this runs
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let licence = app_handle.state::<LicenceMutex>();
                let _ = validate_licence_online(licence).await;
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

---

## 17. Frontend (TypeScript) — feature gate hooks

The frontend never reads the JWT directly. It calls `get_plan_state` once
on mount and stores the features object. All gate checks use that object.

```typescript
// src/lib/licence.ts
import { invoke } from '@tauri-apps/api/core'

export interface Features {
  max_workspaces: number | null   // null = unlimited
  max_sources: number | null
  scheduler: boolean
  monitors: boolean
  export_pdf: boolean
  export_csv: boolean
  history_days: number
  max_devices: number
  plan_id: string
  live_pass_active: boolean
  is_trial: boolean
  trial_days_left: number
}

export interface PlanState {
  features: Features
  isActivated: boolean
}

// Singleton — load once on app start
let _features: Features | null = null

export async function loadPlanState(): Promise<Features> {
  _features = await invoke<Features>('get_plan_state')
  return _features
}

export function getFeatures(): Features {
  return _features ?? freeFeatures()
}

function freeFeatures(): Features {
  return {
    max_workspaces: 1,
    max_sources: 3,
    scheduler: false,
    monitors: false,
    export_pdf: false,
    export_csv: false,
    history_days: 30,
    max_devices: 1,
    plan_id: 'free',
    live_pass_active: false,
    is_trial: false,
    trial_days_left: 0,
  }
}
```

```typescript
// src/lib/activation.ts
import { invoke } from '@tauri-apps/api/core'

export async function activateLicence(
  email: string,
  key: string
): Promise<{ plan_id: string; email: string; device_id: string }> {
  // Rust handles everything — network call, fingerprint, keychain storage
  return invoke('activate_licence', { email, activationKey: key })
}

export async function deactivateDevice(): Promise<void> {
  return invoke('deactivate_device')
}

export async function getDeviceInfo() {
  return invoke<{ os: string; arch: string; fingerprint_preview: string }>(
    'get_device_info'
  )
}
```

```tsx
// src/components/GatedFeature.tsx
import { getFeatures } from '../lib/licence'

interface Props {
  requires: 'pro' | 'live_pass'
  children: React.ReactNode
  fallback?: React.ReactNode
}

export function GatedFeature({ requires, children, fallback }: Props) {
  const f = getFeatures()

  const allowed =
    requires === 'pro'
      ? f.plan_id !== 'free'
      : f.live_pass_active

  if (!allowed) {
    return fallback ? (
      <>{fallback}</>
    ) : (
      <UpgradePrompt plan={requires} />
    )
  }

  return <>{children}</>
}

function UpgradePrompt({ plan }: { plan: string }) {
  const label = plan === 'live_pass' ? 'Live Pass — $39/yr' : 'Pro — $69'
  const onClick = () => {
    // Open the web activate page in the default browser
    // or show an in-app modal
    window.open('https://openreply.app/activate', '_blank')
  }
  return (
    <div className="upgrade-prompt">
      <span>This feature requires {label}</span>
      <button onClick={onClick}>Upgrade</button>
    </div>
  )
}
```

```tsx
// Usage example — scheduler toggle
import { GatedFeature } from './components/GatedFeature'
import { invoke } from '@tauri-apps/api/core'

function SchedulerPanel() {
  return (
    <GatedFeature
      requires="live_pass"
      fallback={
        <div className="locked">
          <p>Daily brief scheduler</p>
          <span>Live Pass · $39/yr</span>
        </div>
      }
    >
      {/* Only rendered if live_pass_active = true */}
      <SchedulerConfig
        onSave={(cron) => invoke('configure_scheduler', { cron })}
      />
    </GatedFeature>
  )
}
```

---

## 18. Environment variables and secrets

### Build time (CI/CD — GitHub Actions / local)

```bash
# .env.build — NEVER commit this file
JWT_DESKTOP_SECRET=your-minimum-32-char-secret-here-change-this
ACTIVATION_SERVER_URL=https://your-activation-server.vercel.app
```

```yaml
# .github/workflows/release.yml
- name: Build Tauri app
  env:
    JWT_DESKTOP_SECRET: ${{ secrets.JWT_DESKTOP_SECRET }}
    ACTIVATION_SERVER_URL: ${{ secrets.ACTIVATION_SERVER_URL }}
  run: npm run tauri build
```

### Runtime (server — Vercel / Supabase)

```bash
# Same JWT_DESKTOP_SECRET must be used on the server to sign tokens
# The server signs, the desktop app verifies — same secret
TOKEN_SIGNING_SECRET=same-value-as-JWT_DESKTOP_SECRET

SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
LS_API_KEY=
LS_STORE_ID=
LS_WEBHOOK_SECRET=
RESEND_API_KEY=
```

**Critical rule:** `JWT_DESKTOP_SECRET` / `TOKEN_SIGNING_SECRET` must be the
same value on both server and desktop build. The server signs the JWT with it.
The desktop binary verifies with it. If they differ, all activations fail.

---

## 19. Activation key format and generation

Keys are generated server-side on purchase. This is Rust pseudocode showing
the format used — the actual generation is in the Next.js server.

```
Format:  XXXX-XXXX-XXXX-XXXX
Example: ABCD-EF12-GHIJ-3456
Chars:   A-Z, 2-9 only (no 0, O, 1, I — avoids visual ambiguity)
Length:  16 chars + 3 dashes = 19 chars displayed
DB:      stored as sha256(raw_16_chars) — raw key never in DB
Email:   formatted with dashes for readability
App:     input strips dashes before sending to API
```

---

## 20. Complete flow walkthrough

```
① User buys Pro on Lemon Squeezy ($69)
   └─ LS fires webhook → POST /api/v1/webhooks/lemonsqueezy
      └─ Server: create user_plans row, generate key, email key to user

② User opens OpenReply desktop app
   └─ main.rs: LicenceState::load() runs
      └─ read_token() → None (no token yet)
      └─ Returns LicenceState { features: Features::free(), claims: None }
   └─ App renders in free tier
   └─ Background: validate_licence_online() → server has no token to validate

③ User goes to Preferences → Licence → enters key ABCD-EF12-GHIJ-3456
   └─ Frontend calls: invoke('activate_licence', { email, activationKey })
   └─ Rust: activate_licence command runs
      ├─ sanitise key: "ABCDEF12GHIJ3456"
      ├─ compute fingerprint: get_device_fingerprint() → "a3f9b2c1...f0a1"
      └─ POST /api/v1/device/activate {
           email, activation_key: "ABCDEF12GHIJ3456",
           device_fingerprint: "a3f9b2c1...f0a1",
           app: "openreply-desktop", os: "macos", arch: "aarch64"
         }

④ Server processes activation
   ├─ hash incoming key → lookup in activation_keys table
   ├─ check device slots: 0/1 used → OK
   ├─ INSERT into license_devices: { fingerprint_hash: sha256("a3f9b2c1...f0a1"), ... }
   └─ sign JWT: {
        sub: "licence_abc123",
        device_fingerprint: "a3f9b2c1...f0a1",  ← fingerprint embedded
        plan_id: "pro",
        features: { max_workspaces: null, export_pdf: true, ... },
        exp: now + 180 days
      }
   └─ return { token: "eyJ...", plan_id: "pro", device_id: "dev_xyz" }

⑤ Rust receives JWT
   └─ verify_jwt(token) → confirms signature with baked-in secret ✓
   └─ check device_fingerprint in claims == current fingerprint ✓
   └─ save_token(token) → OS Keychain (macOS Keychain Services)
   └─ update LicenceMutex state: features = Features::pro()
   └─ return Ok(ActivateResult) to frontend

⑥ Frontend receives Ok
   └─ calls get_plan_state() → Features::pro()
   └─ re-renders: Pro badge, all workspaces unlocked, PDF export visible
   └─ shows "Activated successfully" toast

⑦ User closes and reopens app
   └─ main.rs: LicenceState::load() runs again
      ├─ read_token() → reads from OS Keychain → "eyJ..."
      ├─ verify_jwt() → signature ✓
      ├─ get_device_fingerprint() → "a3f9b2c1...f0a1"
      ├─ claims.device_fingerprint == current_fingerprint ✓
      └─ Returns LicenceState { features: Features::pro(), claims: Some(...) }
   └─ Background: validate_licence_online() → server confirms still valid

⑧ User tries to use PDF export
   └─ invoke('export_pdf', { workspaceId })
   └─ Rust: export_pdf command
      ├─ state.require_pdf_export()
      ├─ features.export_pdf == true ✓
      └─ generate_pdf_export() → returns PDF bytes
   └─ Frontend: triggers file save dialog

⑨ Attempted attack: user copies JWT file from this machine to another
   └─ Other machine: read_token() → gets the JWT
   └─ verify_jwt() → signature ✓ (same content)
   └─ get_device_fingerprint() → "DIFFERENT_HASH" (different hardware)
   └─ claims.device_fingerprint != current_fingerprint ✗
   └─ clear_token() → wipes JWT from that machine's keychain
   └─ Returns Features::free() → attack fails, free tier only

⑩ Live Pass lapse (annual subscription expires)
   └─ Background validate_licence_online() runs on next app launch
   └─ Server: user_plans.status = 'expired' for live_pass
   └─ Server: returns refreshed JWT with live_pass_active: false, scheduler: false
   └─ Rust: apply_refreshed_token() → saves new JWT, updates in-memory state
   └─ App: re-renders — scheduler disabled, monitor disabled
   └─ Pro features (PDF, sources, workspaces) remain active (perpetual)
```

---

## 21. Implementation order for Claude Code

Implement in this exact order. Each step depends on the previous.

```
1.  error.rs                       — define LicenceError enum first
2.  licence/features.rs            — Features struct and plan definitions
3.  licence/fingerprint.rs         — device fingerprint per OS
4.  licence/jwt.rs                 — JWT verify and LicenceClaims struct
5.  build.rs                       — JWT secret baked into binary
6.  licence/store.rs               — OS Keychain read/write stubs
7.  licence/validator.rs           — online heartbeat
8.  licence/mod.rs                 — LicenceState public API
9.  commands/activation.rs         — activate_licence Tauri command
10. commands/workspace.rs          — create_workspace with gate
11. commands/sweep.rs              — run_sweep commands with gates
12. commands/export.rs             — export commands with gates
13. commands/monitor.rs            — monitor commands with gate
14. commands/plan.rs               — get_plan_state command
15. main.rs                        — wire everything, register commands
16. src/lib/licence.ts             — TypeScript feature state hook
17. src/lib/activation.ts          — TypeScript activation helpers
18. src/components/GatedFeature.tsx — UI gating component
19. Wire tauri-plugin-stronghold   — replace store.rs stubs with real calls
20. Integration test               — full activate → feature → revoke cycle
```

---

## 22. Testing the full cycle locally

```bash
# 1. Set build env vars
export JWT_DESKTOP_SECRET="dev-secret-minimum-32-characters-long"
export ACTIVATION_SERVER_URL="http://localhost:3000"

# 2. Build and run
cd src-tauri && cargo build
npm run tauri dev

# 3. Generate a test key using the dev mint endpoint
curl -X POST http://localhost:3000/api/v1/dev/mint \
  -H "x-dev-mint-secret: your-dev-mint-secret" \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","plan_id":"pro"}'
# → { "key": "ABCD-EF12-GHIJ-3456", "email": "test@example.com" }

# 4. Enter that key in the app activation screen
# 5. Verify Pro features unlock
# 6. Kill the app, reopen — verify JWT persists from keychain
# 7. Modify JWT on disk (impossible — it's in OS Keychain, not a file)
# 8. Test device mismatch: copy keychain entry to VM → should reject
```
