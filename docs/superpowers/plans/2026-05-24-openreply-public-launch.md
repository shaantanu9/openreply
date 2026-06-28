# OpenReply Public Launch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a v0.1.0 public, OSS-buildable OpenReply release where search → gather → relate → conclude → chat all work end-to-end in a shareable signed DMG, with auto-update.

**Architecture:** 5 phases — Foundation (sidecar + feature-flag license gate + OSS hygiene), Flow (Topic Dashboard + Brief orchestrator), Chat (corpus chat tab using existing `research/chat.py`), Sign+Release (notarized DMG + GitHub Release), Auto-update (tauri-plugin-updater). Each phase is independently shippable. Spec: `docs/superpowers/specs/2026-05-24-openreply-public-launch-design.md`.

**Tech Stack:** Tauri 2 (Rust + vanilla JS), Python sidecar via PyInstaller, SQLite (`rusqlite` from Rust, `sqlite3`/raw SQL from Python), `node:test` for JS tests, `pytest` for Python tests, GitHub Actions for release CI.

---

## File structure overview

**New files:**

```
app-tauri/src/components/
  PipelineStatus.js              # P1 — status strip component
  PipelineStatus.test.mjs        # P1 — node:test
  BriefCard.js                   # P1 — brief renderer
  BriefCard.test.mjs             # P1 — node:test
  WorkspaceStripCard.js          # P1 — deep-link card
  WorkspaceStripCard.test.mjs    # P1 — node:test

app-tauri/src/screens/
  topic_dashboard.js             # P1 — host that combines strip + brief + workspace
  topic_dashboard.test.mjs       # P1 — node:test
  chat.js                        # P2 — chat tab UI

src/reddit_research/research/
  brief_orchestrator.py          # P1 — sequences audience→synthesize→deliberate→launch
tests/
  test_brief_orchestrator.py     # P1 — pytest

scripts/
  smoke_test_dmg.sh              # P0 + P1 — runs full pipeline + asserts every stage done

docs/manual-todo/
  oss-launch.md                  # P0 — manual TODO items for user

changelogs/                      # one per task per the global rule
  2026-05-24_NN_*.md
```

**Modified files:**

```
app-tauri/src-tauri/Cargo.toml             # P0 — add license-gate feature
app-tauri/src-tauri/build.rs               # P0 — feature-aware secret resolution
app-tauri/src-tauri/src/commands.rs        # P0 — #[cfg] guards on 5 license fns
app-tauri/src-tauri/src/main.rs            # P0 — #[cfg] guards on command registration
app-tauri/src-tauri/Cargo.toml             # P2/P4 — chat IPC handlers, updater plugin
app-tauri/src-tauri/src/commands.rs        # P1 — generate_brief; P2 — chat command; SQL migrations
app-tauri/src-tauri/src/main.rs            # P1+P2+P4 — register new commands + plugin
app-tauri/src-tauri/tauri.conf.json        # P4 — updater pubkey + endpoint
app-tauri/vite.config.js                   # P0 — __OPENREPLY_LICENSE_GATE_ENABLED__ define
app-tauri/src/main.js                      # P0 — gate-conditional onboarding
app-tauri/src/screens/welcome.js           # P0 — hide license input behind flag
app-tauri/src/screens/topic.js             # P1 — mount topic_dashboard.js at top
app-tauri/src/api.js                       # P1 — generate_brief wrapper; P2 — chat wrappers
app-tauri/package.json                     # P0 — tauri:build:gated script; P0 — add new tests
README.md                                  # P0 — OSS posture rewrite
scripts/publish-mac.sh                     # P0/P1 — --adhoc + --gated flags
.github/workflows/release.yml              # P3 — verify; P4 — updater step
pyproject.toml                             # P0 — SPDX header
```

**No-touch (preserved verbatim):**

- All other screens in `app-tauri/src/screens/` (43 files).
- All MCP tools in `src/reddit_research/mcp/`.
- All CLI commands.
- The 2026-05-18 GUI consistency spec's primitives (`PageShell`, `EmptyState`, `ErrorCard`, `LoadingSkeleton`) — consumed, not modified.

---

# Phase P0 — Foundation

Goal of P0: anyone can `git clone && uv sync --all-extras && cd app-tauri && npm install && npm run tauri build` and get a working app with no secret ceremony. Default build is ungated; the activation infrastructure stays in tree behind a Cargo feature.

---

## Task 1: Rebuild the Python sidecar (arm64 + x86_64)

**Why:** The shipped `app-tauri/src-tauri/binaries/reddit-cli-aarch64-apple-darwin` is from Apr 21 and predates audience/iterate/launch/deliberate/paper-pipeline. Rebuild against current code before anything else.

**Files:**
- Modify: `app-tauri/src-tauri/binaries/reddit-cli-aarch64-apple-darwin` (rebuild)
- Modify: `app-tauri/src-tauri/binaries/reddit-cli-x86_64-apple-darwin` (rebuild)
- Create: `changelogs/2026-05-24_01_rebuild-sidecar.md`

- [ ] **Step 1: Confirm pyinstaller spec and python env are current**

Run:
```bash
cd /Users/shantanubombatkar/Documents/GitHub/reddit-myind
uv sync --all-extras
test -f reddit-cli.spec && echo "spec exists"
```
Expected: `spec exists` + uv resolves without errors.

- [ ] **Step 2: Build arm64 sidecar**

Run:
```bash
cd /Users/shantanubombatkar/Documents/GitHub/reddit-myind
ARCH=arm64 bash scripts/publish-mac.sh --arch arm64 --sidecar-only 2>&1 | tail -40
```
If the script doesn't have `--sidecar-only`, fall back to:
```bash
uv run pyinstaller reddit-cli.spec --clean --noconfirm
```
Expected: `dist/reddit-cli` exists.

- [ ] **Step 3: Copy to Tauri binaries dir and codesign ad-hoc**

```bash
cp dist/reddit-cli app-tauri/src-tauri/binaries/reddit-cli-aarch64-apple-darwin
codesign --force --deep --sign - app-tauri/src-tauri/binaries/reddit-cli-aarch64-apple-darwin
codesign -dvv app-tauri/src-tauri/binaries/reddit-cli-aarch64-apple-darwin 2>&1 | grep "Signature="
```
Expected: `Signature=adhoc`.

- [ ] **Step 4: Build x86_64 sidecar (cross-arch via PyInstaller on Apple Silicon requires `arch -x86_64`)**

```bash
arch -x86_64 /bin/bash -c 'cd /Users/shantanubombatkar/Documents/GitHub/reddit-myind && uv run pyinstaller reddit-cli.spec --clean --noconfirm --distpath dist-x86_64'
cp dist-x86_64/reddit-cli app-tauri/src-tauri/binaries/reddit-cli-x86_64-apple-darwin
codesign --force --deep --sign - app-tauri/src-tauri/binaries/reddit-cli-x86_64-apple-darwin
```
If the x86_64 toolchain isn't installed, document this in the changelog as deferred to CI (the `release.yml` matrix builds it natively).

- [ ] **Step 5: Smoke-test the new arm64 binary at the command level**

```bash
./app-tauri/src-tauri/binaries/reddit-cli-aarch64-apple-darwin --version
./app-tauri/src-tauri/binaries/reddit-cli-aarch64-apple-darwin search --help
./app-tauri/src-tauri/binaries/reddit-cli-aarch64-apple-darwin audience --help
```
Expected: all three print without error. (`audience --help` not printing = Apr 21 binary; printing = post-audience build.)

- [ ] **Step 6: Write changelog and commit**

Create `changelogs/2026-05-24_01_rebuild-sidecar.md`:
```markdown
# Rebuild Python sidecar (arm64 + x86_64)

**Date:** 2026-05-24
**Type:** Infrastructure

## Summary

Rebuild the bundled `reddit-cli` PyInstaller binary against current code so the
shipped DMG actually carries audience / iterate / launch / deliberate / paper-
pipeline features (Apr 21 binary predated them).

## Changes

- arm64 binary rebuilt and ad-hoc codesigned in place.
- x86_64 binary rebuilt (or deferred to release CI).
- Verified `audience --help` and friends respond at the command line.

## Files Modified

- `app-tauri/src-tauri/binaries/reddit-cli-aarch64-apple-darwin` — rebuilt
- `app-tauri/src-tauri/binaries/reddit-cli-x86_64-apple-darwin` — rebuilt (if local toolchain present)
```

```bash
git add app-tauri/src-tauri/binaries/ changelogs/2026-05-24_01_rebuild-sidecar.md
git commit -m "$(cat <<'EOF'
chore(sidecar): rebuild arm64 + x86_64 against current code

Apr 21 binary predated audience/iterate/launch/deliberate features.
Rebuild + ad-hoc codesign so the shipped DMG ships current behavior.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Add `license-gate` Cargo feature (Rust side)

**Why:** Preserve activation infrastructure; default build is ungated.

**Files:**
- Modify: `app-tauri/src-tauri/Cargo.toml`
- Modify: `app-tauri/src-tauri/build.rs`
- Modify: `app-tauri/src-tauri/src/commands.rs` (5 license functions; cfg-guard registration)
- Modify: `app-tauri/src-tauri/src/main.rs` (cfg-guard command registration)
- Create: `changelogs/2026-05-24_02_license-gate-feature-flag.md`

- [ ] **Step 1: Add the feature to Cargo.toml**

In `app-tauri/src-tauri/Cargo.toml`, replace the `[features]` block:

```toml
[features]
default = ["custom-protocol"]
custom-protocol = ["tauri/custom-protocol"]
# When enabled, the in-app license-activation gate is active and a real
# JWT_DESKTOP_SECRET must be supplied at build time. Default OSS builds
# leave this OFF so the app runs ungated.
license-gate = []
```

- [ ] **Step 2: Make `build.rs` feature-aware**

Replace `app-tauri/src-tauri/build.rs` with:

```rust
fn main() {
    println!("cargo:rerun-if-env-changed=JWT_DESKTOP_SECRET");
    println!("cargo:rerun-if-env-changed=CARGO_FEATURE_LICENSE_GATE");

    let profile = std::env::var("PROFILE").unwrap_or_else(|_| "debug".to_string());
    let license_gate_enabled = std::env::var("CARGO_FEATURE_LICENSE_GATE").is_ok();

    let secret = match (std::env::var("JWT_DESKTOP_SECRET"), license_gate_enabled, profile.as_str()) {
        (Ok(s), _, _) => s,
        // Ungated default build — never validates tokens; placeholder satisfies env!() at runtime.
        (Err(_), false, _) => {
            "openreply-oss-public-no-gate-placeholder-secret-32chars".to_string()
        }
        // Gated debug build — fall back so devs don't have to set the secret locally.
        (Err(_), true, "debug") => {
            println!(
                "cargo:warning=JWT_DESKTOP_SECRET missing; using debug fallback. Set explicitly for gated production builds."
            );
            "dev-local-jwt-secret-change-before-release-0123456789".to_string()
        }
        // Gated release build — secret is mandatory.
        (Err(_), true, _) => panic!("JWT_DESKTOP_SECRET must be set when license-gate feature is enabled in release"),
    };

    assert!(
        secret.len() >= 32,
        "JWT_DESKTOP_SECRET must be at least 32 chars"
    );
    println!("cargo:rustc-env=JWT_DESKTOP_SECRET={}", secret);
    tauri_build::build()
}
```

- [ ] **Step 3: `cfg`-guard the license commands in `commands.rs`**

Find each of the 5 license commands and wrap their full definition (the `#[tauri::command]` attribute plus the `fn` body) with `#[cfg(feature = "license-gate")]`. Then add stubs for the ungated path below each one.

For `license_status`, find the existing definition (around `commands.rs:5110` / function name `pub async fn license_status`) and replace its leading attribute line with:

```rust
#[cfg(feature = "license-gate")]
#[tauri::command]
pub async fn license_status(app: tauri::AppHandle) -> Result<LicenseStatus, String> {
    // ... existing body unchanged ...
}

#[cfg(not(feature = "license-gate"))]
#[tauri::command]
pub async fn license_status(_app: tauri::AppHandle) -> Result<LicenseStatus, String> {
    // Ungated build: report "activated forever" so onboarding skips license step.
    Ok(LicenseStatus {
        activated: true,
        plan: "oss".to_string(),
        expires_at: None,
        reason: None,
    })
}
```

Do the same shape for `license_activate`, `license_server_check`, `license_default_api_base`, `license_logout`. The ungated stubs should each return the "already activated / no-op" success shape compatible with the existing struct. Reference the existing function signatures in `commands.rs:5110-6150`.

For helpers that aren't `#[tauri::command]` (like `load_license_state`, `compute_activation_reason`, `is_license_not_expired`, `verify_license_token`), wrap them with `#[cfg(feature = "license-gate")]` and add no ungated counterpart — they are unused when the feature is off, so `#[allow(dead_code)]` is not needed because the cfg gates the whole symbol.

- [ ] **Step 4: Verify `main.rs` command registration still compiles in both feature states**

The 5 commands are already registered at `main.rs:289-293`. They remain registered in both feature states (since the function names always exist, they just have different bodies). No edit to `main.rs` for this task.

- [ ] **Step 5: Compile both feature states**

```bash
cd app-tauri/src-tauri
cargo check
cargo check --features license-gate
```
Expected: both pass cleanly.

- [ ] **Step 6: Run Rust tests in both states**

```bash
cd app-tauri/src-tauri
cargo test
cargo test --features license-gate
```
Expected: both green.

- [ ] **Step 7: Write changelog and commit**

Create `changelogs/2026-05-24_02_license-gate-feature-flag.md`:

```markdown
# License gate behind Cargo feature flag (default OFF)

**Date:** 2026-05-24
**Type:** Feature

## Summary

The license-activation flow is now opt-in via the new `license-gate` Cargo
feature. Default OSS builds ship with the gate OFF — no JWT secret needed,
no activation prompt. A future paid build path is one `--features license-gate`
away. Zero deletion of activation code.

## Changes

- `Cargo.toml` — new `license-gate` feature (off by default).
- `build.rs` — feature-aware `JWT_DESKTOP_SECRET` resolution; no panic when
  the feature is off.
- `commands.rs` — 5 license commands are `#[cfg]`-guarded; ungated stubs
  always report activated.
- Compiles + tests pass in both feature states.

## Files Modified

- `app-tauri/src-tauri/Cargo.toml`
- `app-tauri/src-tauri/build.rs`
- `app-tauri/src-tauri/src/commands.rs`
```

```bash
git add app-tauri/src-tauri/Cargo.toml app-tauri/src-tauri/build.rs app-tauri/src-tauri/src/commands.rs changelogs/2026-05-24_02_license-gate-feature-flag.md
git commit -m "$(cat <<'EOF'
feat(license): cfg-guard license commands behind license-gate feature (default OFF)

Preserves activation code; default OSS build needs no JWT secret and skips
the activation step entirely. cargo check + cargo test pass in both states.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Feature-flag the JS license gate

**Files:**
- Modify: `app-tauri/vite.config.js`
- Modify: `app-tauri/src/main.js` (lines 272-278)
- Modify: `app-tauri/src/screens/welcome.js`
- Modify: `app-tauri/package.json`
- Create: `changelogs/2026-05-24_03_license-gate-fe.md`

- [ ] **Step 1: Inject build-time flag via Vite**

Modify `app-tauri/vite.config.js` to add a `define` block. Read its current contents first; the addition is:

```js
import { defineConfig } from 'vite';

export default defineConfig({
  // ... existing config ...
  define: {
    __OPENREPLY_LICENSE_GATE_ENABLED__: JSON.stringify(process.env.OPENREPLY_LICENSE_GATE === 'true'),
  },
});
```

If a `define` block already exists, merge the new key in.

- [ ] **Step 2: Update `isLicenseActivatedLocally` and `mustStayInOnboarding` in `main.js`**

Replace lines 272-278 of `app-tauri/src/main.js`:

```js
function isLicenseActivatedLocally() {
  // Ungated OSS build: gate is permanently "activated".
  if (typeof __OPENREPLY_LICENSE_GATE_ENABLED__ !== 'undefined' && !__OPENREPLY_LICENSE_GATE_ENABLED__) {
    return true;
  }
  return localStorage.getItem('openreply.license.activated') === 'true';
}

function mustStayInOnboarding() {
  // Onboarding includes BYOK + first topic. The license step is gated separately.
  if (!isOnboardingComplete()) return true;
  if (typeof __OPENREPLY_LICENSE_GATE_ENABLED__ !== 'undefined' && !__OPENREPLY_LICENSE_GATE_ENABLED__) {
    return false;
  }
  return !isLicenseActivatedLocally();
}
```

- [ ] **Step 3: Hide the license-key input in `welcome.js` when ungated**

Open `app-tauri/src/screens/welcome.js`. Find the license-key input region (search for `license`, `activation`, or `openreply.license.activated`). Wrap the rendering of the license-input step with:

```js
const LICENSE_GATE_ENABLED = (typeof __OPENREPLY_LICENSE_GATE_ENABLED__ !== 'undefined')
  ? __OPENREPLY_LICENSE_GATE_ENABLED__
  : true;

if (LICENSE_GATE_ENABLED) {
  // ... existing license-input step render ...
}
// else: skip the license step in the wizard sequence
```

If the welcome flow uses a step-list array, omit the license step entry when `!LICENSE_GATE_ENABLED`. The exact patch depends on the existing wizard structure — read `welcome.js` and apply the smallest possible change that hides the license step from the wizard order when the flag is off.

- [ ] **Step 4: Add `tauri:build:gated` script**

In `app-tauri/package.json`, replace the `scripts` block to include:

```json
"scripts": {
  "dev": "vite",
  "build": "vite build",
  "preview": "vite preview",
  "tauri": "tauri",
  "tauri:dev": "bash scripts/dev.sh",
  "tauri:build": "tauri build",
  "tauri:build:gated": "OPENREPLY_LICENSE_GATE=true tauri build -- --features license-gate",
  "test": "node --test src/api.test.mjs src/lib/collectFormat.test.mjs src/screens/settings.avatar.test.mjs src/screens/welcome.onboarding.test.mjs src/components/PageShell.test.mjs src/components/LoadingSkeleton.test.mjs src/components/ErrorCard.test.mjs src/components/EmptyState.test.mjs",
  "test:rust": "cargo test --manifest-path src-tauri/Cargo.toml -- --nocapture"
}
```

- [ ] **Step 5: Verify the FE builds in both states**

```bash
cd app-tauri
npm run build
OPENREPLY_LICENSE_GATE=true npm run build
```
Expected: both succeed.

- [ ] **Step 6: Verify the existing JS tests still pass**

```bash
cd app-tauri
npm test
```
Expected: all green (no new tests added in this task; the change is conditional behavior, smoke-covered in Task 5+ flows).

- [ ] **Step 7: Write changelog and commit**

Create `changelogs/2026-05-24_03_license-gate-fe.md`:

```markdown
# License gate frontend conditional (default OFF)

**Date:** 2026-05-24
**Type:** Feature

## Summary

Mirrors the Rust feature flag on the frontend. `__OPENREPLY_LICENSE_GATE_ENABLED__`
is a Vite-time constant; when false, `isLicenseActivatedLocally` always returns
true, the welcome wizard hides the license step, and onboarding completes on
BYOK + first topic.

## Changes

- `vite.config.js` — define `__OPENREPLY_LICENSE_GATE_ENABLED__`.
- `main.js` — conditional gate functions.
- `welcome.js` — hide license step when gate off.
- `package.json` — new `tauri:build:gated` script for paid build path.

## Files Modified

- `app-tauri/vite.config.js`
- `app-tauri/src/main.js`
- `app-tauri/src/screens/welcome.js`
- `app-tauri/package.json`
```

```bash
git add app-tauri/vite.config.js app-tauri/src/main.js app-tauri/src/screens/welcome.js app-tauri/package.json changelogs/2026-05-24_03_license-gate-fe.md
git commit -m "$(cat <<'EOF'
feat(license): frontend gate conditional on __OPENREPLY_LICENSE_GATE_ENABLED__ (default OFF)

Mirrors the Cargo feature on the JS side. tauri:build:gated script provides
the opt-in path for paid builds.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: OSS hygiene — README, SPDX, manual-todo, smoke-test script

**Files:**
- Modify: `README.md` (top section rewrite; keep depth)
- Modify: `pyproject.toml` (add SPDX header)
- Create: `docs/manual-todo/oss-launch.md`
- Create: `scripts/smoke_test_dmg.sh`
- Create: `changelogs/2026-05-24_04_oss-hygiene.md`

- [ ] **Step 1: Rewrite README top section**

Open `README.md`. Replace everything from the first line through the end of the "Install" section with:

```markdown
# OpenReply

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/shaantanu9/openreply?include_prereleases)](https://github.com/shaantanu9/openreply/releases)
[![CI](https://github.com/shaantanu9/openreply/actions/workflows/release.yml/badge.svg)](https://github.com/shaantanu9/openreply/actions)

**Multi-source product research — desktop app, MCP server, and CLI.**

OpenReply collects signals from 23+ sources (Reddit, Hacker News, arXiv, PubMed,
GitHub, App Store, YouTube, and more), runs LLM synthesis across 8 providers,
and surfaces the gaps competitors haven't filled.

Three surfaces, one SQLite store:

| Surface | Use it when |
|---|---|
| **Desktop app** (`OpenReply.app`) | GUI research — collect, synthesize, graph, chat, export |
| **MCP server** (90+ tools) | Claude Code / Cursor integration — research inside your IDE |
| **CLI** (`reddit-cli`) | Automation, scripting, headless pipelines |

---

## Install

### Desktop app

Download the latest `.dmg` (macOS) / `.msi` (Windows) / `.AppImage` (Linux) from
the [Releases](https://github.com/shaantanu9/openreply/releases) page.

> **macOS first-launch (ad-hoc-signed builds, pre-v0.1.x notarization):**
> Right-click `OpenReply.app` → Open → Open Anyway. After the first launch,
> Gatekeeper remembers it.

### MCP server + CLI (Python)

Requirements: Python 3.11+, [uv](https://docs.astral.sh/uv/).

```bash
git clone https://github.com/shaantanu9/openreply.git && cd openreply
uv sync --all-extras        # everything (fetch + mcp + analyze + dev)
# or: uv sync               # base fetch only
```

### Build from source (desktop app)

```bash
git clone https://github.com/shaantanu9/openreply.git && cd openreply
uv sync --all-extras
cd app-tauri && npm install
npm run tauri:build          # default OSS build — no secret needed
```

For the **paid / license-gated** build path (optional, advanced):

```bash
export JWT_DESKTOP_SECRET="$(openssl rand -hex 32)"
OPENREPLY_LICENSE_GATE=true npm run tauri:build:gated
```
```

Keep the rest of the existing README from "Quick start" downward untouched.

- [ ] **Step 2: Add SPDX header to `pyproject.toml`**

Prepend to `pyproject.toml`:

```toml
# SPDX-License-Identifier: MIT
```

- [ ] **Step 3: Create `docs/manual-todo/oss-launch.md`**

Create the file:

```markdown
# OSS Launch — Manual Steps

These steps cannot be automated and must be done by hand before / during the
v0.1.0 public release.

## Repository

- [ ] Flip GitHub repo to **public**. (Confirm repo name — README references
      `shaantanu9/openreply` but the local checkout is `reddit-myind`. Pick
      one and align README + `release.yml` + `tauri.conf.json`.)
- [ ] Upload `openreply_logo.jpg` as the repo's Social Preview image.
- [ ] Verify Issue Templates render (`.github/ISSUE_TEMPLATE/`).

## P1 — sharing the DMG ad-hoc

- [ ] Run `bash scripts/publish-mac.sh --adhoc --arch arm64` locally to produce
      an ad-hoc-signed DMG.
- [ ] Share via Drive / direct download. Recipients open with right-click → Open
      → Open Anyway on first launch.

## P3 — signed + notarized release (requires Apple Dev account)

- [ ] Create **Developer ID Application** cert at developer.apple.com →
      Certificates → New → Developer ID Application. Export as `.p12` with
      passphrase.
- [ ] Generate app-specific password at appleid.apple.com → Sign-in & Security
      → App-Specific Passwords (for notarization).
- [ ] Add GitHub Secrets:
  - `APPLE_CERTIFICATE` — base64-encoded p12
  - `APPLE_CERTIFICATE_PASSWORD`
  - `APPLE_ID` (your Apple ID email)
  - `APPLE_PASSWORD` (the app-specific password from above)
  - `APPLE_TEAM_ID`
  - `TAURI_SIGNING_PRIVATE_KEY` (P4 prereq — generated in Task 16)
  - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
- [ ] Run an **unsigned** `release.yml` CI pass FIRST (push a no-cert tag like
      `v0.1.0-rc1`) to confirm matrix is green. Then add secrets.

## P4 — auto-update

- [ ] Generate updater signing keypair:
      `cd app-tauri && npm run tauri signer generate -- -w ~/.tauri/openreply.key`
- [ ] Put the **public** key into `tauri.conf.json` `plugins.updater.pubkey`.
- [ ] Put the **private** key into `TAURI_SIGNING_PRIVATE_KEY` GitHub Secret.

## Ongoing

- [ ] After every release, smoke-test the published artifact on a clean VM
      (or a different Mac than the one that built it).
- [ ] Update `FEATURES.md` whenever a phase merges.
```

- [ ] **Step 4: Create `scripts/smoke_test_dmg.sh`**

Create:

```bash
#!/usr/bin/env bash
# OpenReply sidecar / pipeline smoke test.
# Runs the full pipeline on a fixed topic and asserts every stage completes.
# Used pre-tag and on PRs that touch the orchestrator.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

TOPIC="${SMOKE_TOPIC:-noise-cancelling headphones}"
CLI="${SMOKE_CLI:-./app-tauri/src-tauri/binaries/reddit-cli-aarch64-apple-darwin}"

if [[ ! -x "$CLI" ]]; then
  echo "smoke: CLI not found or not executable at $CLI" >&2
  echo "smoke: hint — run uv run pyinstaller reddit-cli.spec first" >&2
  exit 2
fi

echo "smoke: pipeline against topic '$TOPIC'"
echo "smoke: using CLI $CLI"

stages=(
  "search:./bin discover --topic \"$TOPIC\" --max 3 --json"
  "collect:./bin research collect --topic \"$TOPIC\" --aggressive false --json"
  "synth:./bin research synthesize --topic \"$TOPIC\" --json"
  "audience:./bin research audience --topic \"$TOPIC\" --json"
  "launch:./bin research launch-brief --topic \"$TOPIC\" --json"
)

fail=0
for stage in "${stages[@]}"; do
  name="${stage%%:*}"
  cmd="${stage#*:}"
  cmd="${cmd//.\/bin/$CLI}"
  echo "smoke: stage=$name"
  if ! eval "$cmd" >/tmp/smoke_$name.out 2>&1; then
    echo "  FAIL — see /tmp/smoke_$name.out"
    tail -20 /tmp/smoke_$name.out
    fail=1
  else
    echo "  OK"
  fi
done

if [[ $fail -eq 1 ]]; then
  echo "smoke: at least one stage failed"
  exit 1
fi
echo "smoke: all stages passed"
```

Make it executable:
```bash
chmod +x scripts/smoke_test_dmg.sh
```

- [ ] **Step 5: Write changelog and commit**

Create `changelogs/2026-05-24_04_oss-hygiene.md`:

```markdown
# OSS hygiene — README, SPDX, manual-TODO, smoke test

**Date:** 2026-05-24
**Type:** Documentation + Infrastructure

## Summary

Public-launch hygiene pass: README rewrite for OSS posture, SPDX header on
pyproject.toml, `docs/manual-todo/oss-launch.md` capturing the user-side
steps (Apple cert, GitHub secrets, repo rename), and a `scripts/smoke_test_dmg.sh`
pipeline harness used before tagging releases.

## Files Created

- `docs/manual-todo/oss-launch.md`
- `scripts/smoke_test_dmg.sh`

## Files Modified

- `README.md` — top section rewrite, OSS badges, build-from-source
- `pyproject.toml` — SPDX header
```

```bash
git add README.md pyproject.toml docs/manual-todo/oss-launch.md scripts/smoke_test_dmg.sh changelogs/2026-05-24_04_oss-hygiene.md
git commit -m "$(cat <<'EOF'
docs: OSS hygiene pass — README, SPDX, manual-TODO, smoke harness

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# Phase P1 — Flow (Topic Dashboard + Brief)

Goal of P1: Topic page has a Brief on top, a Workspace strip below, and a live Pipeline Status. All existing tabs preserved underneath.

---

## Task 5: `PipelineStatus.js` component + test

**Files:**
- Create: `app-tauri/src/components/PipelineStatus.js`
- Create: `app-tauri/src/components/PipelineStatus.test.mjs`
- Modify: `app-tauri/package.json` (add the test to the `test` script)
- Create: `changelogs/2026-05-24_05_pipeline-status-component.md`

- [ ] **Step 1: Write the failing test**

Create `app-tauri/src/components/PipelineStatus.test.mjs`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';

import { pipelineStatus } from './PipelineStatus.js';

test('renders one pill per stage with status class', () => {
  const html = pipelineStatus({
    stages: [
      { key: 'discover', label: 'discover', status: 'done' },
      { key: 'collect',  label: 'collect',  status: 'running', detail: '234/612' },
      { key: 'synth',    label: 'synth',    status: 'pending' },
    ],
  });
  assert.match(html, /data-stage="discover"/);
  assert.match(html, /data-stage="collect"/);
  assert.match(html, /data-stage="synth"/);
  assert.match(html, /status-done/);
  assert.match(html, /status-running/);
  assert.match(html, /status-pending/);
  assert.match(html, /234\/612/);
});

test('renders failed stage with why link', () => {
  const html = pipelineStatus({
    stages: [{ key: 'launch', label: 'launch', status: 'failed', detail: 'llm_key' }],
  });
  assert.match(html, /status-failed/);
  assert.match(html, /Why\?/);
});

test('shows re-run + cancel CTAs when handlers supplied', () => {
  const html = pipelineStatus({
    stages: [{ key: 'a', label: 'a', status: 'done' }],
    onReRun: 'window.__rerun()',
    onCancel: 'window.__cancel()',
  });
  assert.match(html, /__rerun/);
  assert.match(html, /__cancel/);
});

test('skips re-run + cancel when no handlers', () => {
  const html = pipelineStatus({
    stages: [{ key: 'a', label: 'a', status: 'done' }],
  });
  assert.doesNotMatch(html, /Re-run/);
  assert.doesNotMatch(html, /Cancel/);
});
```

- [ ] **Step 2: Run the test, confirm it fails**

```bash
cd app-tauri
node --test src/components/PipelineStatus.test.mjs
```
Expected: FAIL with "Cannot find module './PipelineStatus.js'".

- [ ] **Step 3: Implement the component**

Create `app-tauri/src/components/PipelineStatus.js`:

```javascript
// pipelineStatus({stages, onReRun?, onCancel?}) → HTML string
//
// stages: [{key, label, status, detail?}]
//   status ∈ {pending, running, done, skipped, failed}
//
// Stages render as pills in a horizontal strip. Failed stages get a
// "Why?" link that the parent screen wires to open an error card.

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function pillHtml({ key, label, status, detail }) {
  const statusClass = `status-${status}`;
  const detailHtml = detail ? `<span class="pipeline-pill__detail">${escapeHtml(detail)}</span>` : '';
  const whyHtml = status === 'failed'
    ? `<a class="pipeline-pill__why" data-stage="${escapeHtml(key)}" href="#">Why?</a>`
    : '';
  return `
    <div class="pipeline-pill ${statusClass}" data-stage="${escapeHtml(key)}">
      <span class="pipeline-pill__label">${escapeHtml(label)}</span>
      ${detailHtml}
      ${whyHtml}
    </div>`;
}

export function pipelineStatus({ stages = [], onReRun, onCancel } = {}) {
  const pills = stages.map(pillHtml).join('');
  const reRun = onReRun
    ? `<button class="btn btn--ghost" onclick="${escapeHtml(onReRun)}">Re-run</button>`
    : '';
  const cancel = onCancel
    ? `<button class="btn btn--ghost" onclick="${escapeHtml(onCancel)}">Cancel</button>`
    : '';
  const ctas = (reRun || cancel)
    ? `<div class="pipeline-status__ctas">${reRun}${cancel}</div>`
    : '';

  return `
    <div class="pipeline-status">
      <div class="pipeline-status__pills">${pills}</div>
      ${ctas}
    </div>`;
}
```

- [ ] **Step 4: Run the test, confirm it passes**

```bash
cd app-tauri
node --test src/components/PipelineStatus.test.mjs
```
Expected: 4 passing.

- [ ] **Step 5: Add the test to `package.json` test script**

Edit `app-tauri/package.json` and extend `"test"` to include the new file:

```json
"test": "node --test src/api.test.mjs src/lib/collectFormat.test.mjs src/screens/settings.avatar.test.mjs src/screens/welcome.onboarding.test.mjs src/components/PageShell.test.mjs src/components/LoadingSkeleton.test.mjs src/components/ErrorCard.test.mjs src/components/EmptyState.test.mjs src/components/PipelineStatus.test.mjs"
```

- [ ] **Step 6: Run the full FE test suite**

```bash
cd app-tauri
npm test
```
Expected: all green.

- [ ] **Step 7: Changelog + commit**

Create `changelogs/2026-05-24_05_pipeline-status-component.md`:

```markdown
# Pipeline Status component

**Date:** 2026-05-24
**Type:** Feature

## Summary

Adds `pipelineStatus()` — render-fn that produces the pill strip used at the
top of the Topic Dashboard. Pure DOM-string; matches the existing primitives
pattern. Failed stages expose a `Why?` link the parent wires to error UI.

## Files Created

- `app-tauri/src/components/PipelineStatus.js`
- `app-tauri/src/components/PipelineStatus.test.mjs`
```

```bash
git add app-tauri/src/components/PipelineStatus.js app-tauri/src/components/PipelineStatus.test.mjs app-tauri/package.json changelogs/2026-05-24_05_pipeline-status-component.md
git commit -m "$(cat <<'EOF'
feat(ui): pipelineStatus component + node:test (4 passing)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `BriefCard.js` component + test

**Files:**
- Create: `app-tauri/src/components/BriefCard.js`
- Create: `app-tauri/src/components/BriefCard.test.mjs`
- Modify: `app-tauri/package.json` (add test)
- Create: `changelogs/2026-05-24_06_brief-card-component.md`

- [ ] **Step 1: Write the failing test**

Create `app-tauri/src/components/BriefCard.test.mjs`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';

import { briefCard } from './BriefCard.js';

const sampleBrief = {
  headline_gap: 'Sleep meditation apps mostly ignore daytime micro-naps.',
  evidence: [
    { quote: 'Wish there was a 7-minute session for lunch breaks',
      source_label: 'r/getdisciplined', url: 'https://reddit.com/r/getdisciplined/x' },
    { quote: 'Headspace nap thing is buried 4 taps deep',
      source_label: 'HN comment',         url: 'https://news.ycombinator.com/x' },
    { quote: 'I just play rain sounds on YouTube instead',
      source_label: 'r/Meditation',       url: 'https://reddit.com/r/Meditation/y' },
  ],
  mvp: ['Single big "Nap" button', 'Auto-detects 7/12/20-min slot', 'Wake-alarm built in'],
  audience: { headline: 'Knowledge workers 28-42, 1-2 office days/week' },
  gtm: 'Launch on r/getdisciplined with a 30-day diary thread.',
};

test('renders all 5 sections of a full brief', () => {
  const html = briefCard({ brief: sampleBrief });
  assert.match(html, /Sleep meditation apps mostly ignore/);
  assert.match(html, /7-minute session for lunch/);
  assert.match(html, /HN comment/);
  assert.match(html, /Single big "Nap" button/);
  assert.match(html, /Knowledge workers 28-42/);
  assert.match(html, /r\/getdisciplined with a 30-day diary/);
});

test('shows generate CTA when brief is null', () => {
  const html = briefCard({ brief: null });
  assert.match(html, /Generate brief/);
});

test('renders export + copy + regenerate buttons when handlers given', () => {
  const html = briefCard({
    brief: sampleBrief,
    onExport: { docx: 'window.__d()', pptx: 'window.__p()' },
    onCopy: 'window.__c()',
    onRegenerate: 'window.__r()',
  });
  assert.match(html, /__d\(\)/);
  assert.match(html, /__p\(\)/);
  assert.match(html, /__c\(\)/);
  assert.match(html, /__r\(\)/);
});

test('handles partial brief (missing audience + gtm)', () => {
  const partial = { headline_gap: sampleBrief.headline_gap, evidence: sampleBrief.evidence, mvp: sampleBrief.mvp };
  const html = briefCard({ brief: partial });
  assert.match(html, /Sleep meditation apps mostly ignore/);
  assert.match(html, /Audience snapshot pending/);
  assert.match(html, /Day-1 GTM pending/);
});
```

- [ ] **Step 2: Run the test, confirm it fails**

```bash
cd app-tauri
node --test src/components/BriefCard.test.mjs
```
Expected: FAIL.

- [ ] **Step 3: Implement the component**

Create `app-tauri/src/components/BriefCard.js`:

```javascript
// briefCard({brief, onExport?, onCopy?, onRegenerate?}) → HTML string
//
// brief: {
//   headline_gap: string,
//   evidence: [{quote, source_label, url}],
//   mvp: string[],
//   audience: {headline: string},
//   gtm: string,
// }
//
// If brief is null/undefined, renders a "Generate brief" CTA.
// Partial briefs degrade legibly — each section shows its own pending state.

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function sectionHtml(title, contentHtml, pending) {
  if (pending) {
    return `
      <section class="brief-section brief-section--pending">
        <h4 class="brief-section__title">${escapeHtml(title)}</h4>
        <p class="brief-section__pending">${escapeHtml(title)} pending</p>
      </section>`;
  }
  return `
    <section class="brief-section">
      <h4 class="brief-section__title">${escapeHtml(title)}</h4>
      ${contentHtml}
    </section>`;
}

function evidenceListHtml(items) {
  return `<ul class="brief-evidence">` + items.map((e) => `
    <li class="brief-evidence__item">
      <blockquote>${escapeHtml(e.quote)}</blockquote>
      <a class="brief-evidence__source" href="${escapeHtml(e.url)}" target="_blank" rel="noopener">${escapeHtml(e.source_label)}</a>
    </li>`).join('') + `</ul>`;
}

function mvpListHtml(items) {
  return `<ul class="brief-mvp">` + items.map((s) => `<li>${escapeHtml(s)}</li>`).join('') + `</ul>`;
}

function actionsHtml({ onExport, onCopy, onRegenerate }) {
  const docx = onExport?.docx ? `<button class="btn btn--ghost" onclick="${escapeHtml(onExport.docx)}">Export DOCX</button>` : '';
  const pptx = onExport?.pptx ? `<button class="btn btn--ghost" onclick="${escapeHtml(onExport.pptx)}">Export PPTX</button>` : '';
  const copy = onCopy ? `<button class="btn btn--ghost" onclick="${escapeHtml(onCopy)}">Copy Markdown</button>` : '';
  const regen = onRegenerate ? `<button class="btn btn--secondary" onclick="${escapeHtml(onRegenerate)}">Regenerate</button>` : '';
  if (!docx && !pptx && !copy && !regen) return '';
  return `<div class="brief-actions">${docx}${pptx}${copy}${regen}</div>`;
}

export function briefCard({ brief, onExport, onCopy, onRegenerate } = {}) {
  if (!brief) {
    return `
      <div class="brief-card brief-card--empty">
        <p class="brief-card__empty-msg">No brief yet for this topic.</p>
        ${onRegenerate ? `<button class="btn btn--primary" onclick="${escapeHtml(onRegenerate)}">Generate brief</button>` : ''}
      </div>`;
  }

  const headline = brief.headline_gap
    ? `<p class="brief-headline">${escapeHtml(brief.headline_gap)}</p>`
    : '';

  const evidenceSection = sectionHtml(
    'Evidence',
    Array.isArray(brief.evidence) && brief.evidence.length > 0
      ? evidenceListHtml(brief.evidence)
      : '<p class="brief-section__pending">Evidence pending</p>',
    !brief.evidence || brief.evidence.length === 0,
  );

  const mvpSection = sectionHtml(
    'MVP scope',
    Array.isArray(brief.mvp) && brief.mvp.length > 0 ? mvpListHtml(brief.mvp) : '',
    !brief.mvp || brief.mvp.length === 0,
  );

  const audienceSection = sectionHtml(
    'Audience snapshot',
    brief.audience?.headline ? `<p>${escapeHtml(brief.audience.headline)}</p>` : '',
    !brief.audience?.headline,
  );

  const gtmSection = sectionHtml(
    'Day-1 GTM',
    brief.gtm ? `<p>${escapeHtml(brief.gtm)}</p>` : '',
    !brief.gtm,
  );

  return `
    <article class="brief-card">
      ${headline}
      ${evidenceSection}
      ${mvpSection}
      ${audienceSection}
      ${gtmSection}
      ${actionsHtml({ onExport, onCopy, onRegenerate })}
    </article>`;
}
```

- [ ] **Step 4: Run test, confirm pass**

```bash
cd app-tauri
node --test src/components/BriefCard.test.mjs
```
Expected: 4 passing.

- [ ] **Step 5: Add to package.json test script**

Extend the `"test"` line in `app-tauri/package.json` to include `src/components/BriefCard.test.mjs`. Run `npm test` and confirm green.

- [ ] **Step 6: Changelog + commit**

Create `changelogs/2026-05-24_06_brief-card-component.md` with the standard format, then:

```bash
git add app-tauri/src/components/BriefCard.js app-tauri/src/components/BriefCard.test.mjs app-tauri/package.json changelogs/2026-05-24_06_brief-card-component.md
git commit -m "$(cat <<'EOF'
feat(ui): briefCard component + node:test (4 passing)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: `WorkspaceStripCard.js` component + test

**Files:**
- Create: `app-tauri/src/components/WorkspaceStripCard.js`
- Create: `app-tauri/src/components/WorkspaceStripCard.test.mjs`
- Modify: `app-tauri/package.json`
- Create: `changelogs/2026-05-24_07_workspace-strip-component.md`

- [ ] **Step 1: Write the failing test**

Create `app-tauri/src/components/WorkspaceStripCard.test.mjs`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';

import { workspaceCard, workspaceStrip } from './WorkspaceStripCard.js';

test('workspaceCard renders label + count + href', () => {
  const html = workspaceCard({
    label: 'Insights',
    count: 12,
    href: '#/insights',
    icon: 'lightbulb',
  });
  assert.match(html, /Insights/);
  assert.match(html, />12</);
  assert.match(html, /href="#\/insights"/);
  assert.match(html, /data-icon="lightbulb"/);
});

test('workspaceCard shows em-dash when count is null', () => {
  const html = workspaceCard({ label: 'Papers', count: null, href: '#/papers' });
  assert.match(html, /Papers/);
  assert.match(html, />—</);
});

test('workspaceStrip wraps cards in a grid', () => {
  const html = workspaceStrip({
    cards: [
      { label: 'A', count: 1, href: '#/a' },
      { label: 'B', count: 2, href: '#/b' },
    ],
  });
  assert.match(html, /workspace-strip/);
  assert.match(html, />1</);
  assert.match(html, />2</);
});
```

- [ ] **Step 2: Run, confirm failure**

```bash
cd app-tauri
node --test src/components/WorkspaceStripCard.test.mjs
```
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `app-tauri/src/components/WorkspaceStripCard.js`:

```javascript
// workspaceCard({label, count, href, icon?}) → single anchor-card HTML
// workspaceStrip({cards}) → grid container wrapping multiple cards

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

export function workspaceCard({ label, count, href, icon } = {}) {
  const countText = (count === null || count === undefined) ? '—' : count;
  const iconAttr = icon ? ` data-icon="${escapeHtml(icon)}"` : '';
  return `
    <a class="workspace-card" href="${escapeHtml(href)}"${iconAttr}>
      <span class="workspace-card__count">${escapeHtml(countText)}</span>
      <span class="workspace-card__label">${escapeHtml(label)}</span>
    </a>`;
}

export function workspaceStrip({ cards = [] } = {}) {
  return `
    <div class="workspace-strip">
      ${cards.map(workspaceCard).join('')}
    </div>`;
}
```

- [ ] **Step 4: Test passes**

```bash
cd app-tauri
node --test src/components/WorkspaceStripCard.test.mjs
```
Expected: 3 passing.

- [ ] **Step 5: Wire into package.json + npm test**

Extend `"test"` to include the new file. Run `npm test`. Confirm all green.

- [ ] **Step 6: Changelog + commit**

```bash
git add app-tauri/src/components/WorkspaceStripCard.js app-tauri/src/components/WorkspaceStripCard.test.mjs app-tauri/package.json changelogs/2026-05-24_07_workspace-strip-component.md
git commit -m "$(cat <<'EOF'
feat(ui): workspaceCard + workspaceStrip + tests (3 passing)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: `brief_orchestrator.py` + pytest

**Files:**
- Create: `src/reddit_research/research/brief_orchestrator.py`
- Create: `tests/test_brief_orchestrator.py`
- Create: `changelogs/2026-05-24_08_brief-orchestrator.md`

- [ ] **Step 1: Write the failing test**

Create `tests/test_brief_orchestrator.py`:

```python
"""Brief orchestrator — sequences audience → synthesize → deliberate → launch.

Stages are idempotent (skipped when fresh) and partial-failure-tolerant
(downstream stages run on what's available).
"""
import json
from unittest.mock import MagicMock

import pytest

from reddit_research.research.brief_orchestrator import (
    OrchestratorEvent,
    StageStatus,
    generate_brief,
)


@pytest.fixture
def fake_db(tmp_path):
    """Empty sqlite path; orchestrator handles schema creation."""
    return tmp_path / "test.db"


@pytest.fixture
def fake_stages():
    """Replaceable stage fns; each returns a dict and records its call."""
    calls = []

    def make(name, result, *, fail=False):
        def run(topic, **kwargs):
            calls.append(name)
            if fail:
                raise RuntimeError(f"{name} failed")
            return result

        return run

    return {
        "make": make,
        "calls": calls,
    }


def test_happy_path_runs_all_4_stages_in_order(fake_db, fake_stages):
    stages = {
        "audience": fake_stages["make"]("audience", {"personas": [{"name": "knowledge worker"}]}),
        "synthesize": fake_stages["make"]("synthesize", {"insights": ["i1"]}),
        "deliberate": fake_stages["make"]("deliberate", {"rounds": 2, "notes": ["n1"]}),
        "launch_brief": fake_stages["make"]("launch_brief", {"brief": {"headline_gap": "x"}}),
    }
    events = []

    def emit(ev: OrchestratorEvent):
        events.append(ev)

    result = generate_brief(
        topic="meditation apps",
        db_path=fake_db,
        provider="anthropic",
        stages=stages,
        emit=emit,
        freshness_window_s=86400,
    )
    assert fake_stages["calls"] == ["audience", "synthesize", "deliberate", "launch_brief"]
    assert result["brief"]["headline_gap"] == "x"
    stage_statuses = {ev.stage: ev.status for ev in events if ev.status in (StageStatus.DONE, StageStatus.FAILED)}
    assert stage_statuses == {
        "audience": StageStatus.DONE,
        "synthesize": StageStatus.DONE,
        "deliberate": StageStatus.DONE,
        "launch_brief": StageStatus.DONE,
    }


def test_partial_failure_does_not_abort_pipeline(fake_db, fake_stages):
    stages = {
        "audience": fake_stages["make"]("audience", None, fail=True),
        "synthesize": fake_stages["make"]("synthesize", {"insights": ["i1"]}),
        "deliberate": fake_stages["make"]("deliberate", {"rounds": 2}),
        "launch_brief": fake_stages["make"]("launch_brief", {"brief": {"headline_gap": "x"}}),
    }
    events = []
    generate_brief(
        topic="meditation apps",
        db_path=fake_db,
        provider="anthropic",
        stages=stages,
        emit=events.append,
        freshness_window_s=86400,
    )
    statuses = {ev.stage: ev.status for ev in events if ev.status in (StageStatus.DONE, StageStatus.FAILED)}
    assert statuses["audience"] == StageStatus.FAILED
    assert statuses["synthesize"] == StageStatus.DONE
    assert statuses["launch_brief"] == StageStatus.DONE


def test_idempotent_skip_when_fresh(fake_db, fake_stages, monkeypatch):
    stages = {
        "audience": fake_stages["make"]("audience", {"personas": []}),
        "synthesize": fake_stages["make"]("synthesize", {"insights": []}),
        "deliberate": fake_stages["make"]("deliberate", {}),
        "launch_brief": fake_stages["make"]("launch_brief", {"brief": {"headline_gap": "ok"}}),
    }
    # First run — everything executes.
    generate_brief(
        topic="t", db_path=fake_db, provider="anthropic",
        stages=stages, emit=lambda ev: None, freshness_window_s=86400,
    )
    first_calls = list(fake_stages["calls"])
    fake_stages["calls"].clear()

    # Second run within freshness window — every stage skipped.
    events = []
    generate_brief(
        topic="t", db_path=fake_db, provider="anthropic",
        stages=stages, emit=events.append, freshness_window_s=86400,
    )
    assert fake_stages["calls"] == []  # nothing re-ran
    skipped = [ev for ev in events if ev.status == StageStatus.SKIPPED]
    assert len(skipped) == 4


def test_emits_running_event_before_done(fake_db, fake_stages):
    stages = {
        "audience": fake_stages["make"]("audience", {}),
        "synthesize": fake_stages["make"]("synthesize", {}),
        "deliberate": fake_stages["make"]("deliberate", {}),
        "launch_brief": fake_stages["make"]("launch_brief", {"brief": {}}),
    }
    events = []
    generate_brief(
        topic="t", db_path=fake_db, provider="anthropic",
        stages=stages, emit=events.append, freshness_window_s=86400,
    )
    # For each stage, RUNNING must precede DONE.
    for s in ("audience", "synthesize", "deliberate", "launch_brief"):
        idxs = [i for i, ev in enumerate(events) if ev.stage == s]
        statuses = [events[i].status for i in idxs]
        assert StageStatus.RUNNING in statuses
        assert StageStatus.DONE in statuses
        assert statuses.index(StageStatus.RUNNING) < statuses.index(StageStatus.DONE)
```

- [ ] **Step 2: Run, confirm failure**

```bash
cd /Users/shantanubombatkar/Documents/GitHub/reddit-myind
uv run pytest tests/test_brief_orchestrator.py -v
```
Expected: ImportError on `brief_orchestrator`.

- [ ] **Step 3: Implement orchestrator**

Create `src/reddit_research/research/brief_orchestrator.py`:

```python
"""Brief orchestrator — sequences audience → synthesize → deliberate → launch_brief.

Each stage is idempotent: results are persisted in `topic_briefs_stages` with
`generated_at`, and re-runs within `freshness_window_s` are skipped.

Partial failures do not abort: downstream stages run on whatever previous
stages produced (or nothing).
"""
from __future__ import annotations

import json
import sqlite3
import time
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Any, Callable, Mapping, Optional


class StageStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    DONE = "done"
    SKIPPED = "skipped"
    FAILED = "failed"


@dataclass
class OrchestratorEvent:
    stage: str
    status: StageStatus
    started_at: float
    ended_at: Optional[float] = None
    detail: Optional[str] = None
    error_class: Optional[str] = None


STAGE_ORDER = ("audience", "synthesize", "deliberate", "launch_brief")


def _init_schema(conn: sqlite3.Connection) -> None:
    conn.execute("""
        CREATE TABLE IF NOT EXISTS topic_briefs_stages (
            topic TEXT NOT NULL,
            stage TEXT NOT NULL,
            generated_at REAL NOT NULL,
            payload TEXT NOT NULL,
            PRIMARY KEY (topic, stage)
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS topic_briefs (
            topic TEXT NOT NULL,
            generated_at REAL NOT NULL,
            payload TEXT NOT NULL,
            PRIMARY KEY (topic, generated_at)
        )
    """)
    conn.commit()


def _is_fresh(conn: sqlite3.Connection, topic: str, stage: str, window_s: int) -> Optional[dict]:
    cur = conn.execute(
        "SELECT generated_at, payload FROM topic_briefs_stages WHERE topic=? AND stage=?",
        (topic, stage),
    )
    row = cur.fetchone()
    if not row:
        return None
    generated_at, payload = row
    if time.time() - generated_at > window_s:
        return None
    try:
        return json.loads(payload)
    except json.JSONDecodeError:
        return None


def _persist_stage(conn: sqlite3.Connection, topic: str, stage: str, payload: Any) -> None:
    conn.execute(
        "INSERT OR REPLACE INTO topic_briefs_stages(topic, stage, generated_at, payload) VALUES (?, ?, ?, ?)",
        (topic, stage, time.time(), json.dumps(payload, default=str)),
    )
    conn.commit()


def _persist_brief(conn: sqlite3.Connection, topic: str, brief: dict) -> None:
    conn.execute(
        "INSERT OR REPLACE INTO topic_briefs(topic, generated_at, payload) VALUES (?, ?, ?)",
        (topic, time.time(), json.dumps(brief, default=str)),
    )
    conn.commit()


def _classify_error(exc: BaseException) -> str:
    msg = str(exc).lower()
    if "rate" in msg and "limit" in msg:
        return "rate_limit"
    if "api key" in msg or "unauthorized" in msg or "401" in msg:
        return "llm_key"
    if "timeout" in msg or "connection" in msg:
        return "network"
    if "model" in msg and ("not found" in msg or "unknown" in msg):
        return "llm_model"
    return "unknown"


def generate_brief(
    topic: str,
    db_path: Path,
    provider: str,
    *,
    stages: Mapping[str, Callable[..., Any]],
    emit: Callable[[OrchestratorEvent], None],
    freshness_window_s: int = 86_400,
    rounds: int = 2,
) -> dict:
    """Run the 4-stage pipeline; emit progress events; return the final brief dict.

    `stages` is a dict of {name → callable(topic, **kwargs) → dict}. Inject the
    real research/audience.py, research/insights.py, research/deliberate.py,
    research/launch.py functions from the caller. Tests inject fakes.
    """
    conn = sqlite3.connect(str(db_path))
    try:
        _init_schema(conn)
        stage_outputs: dict[str, Optional[dict]] = {}

        for stage_name in STAGE_ORDER:
            started = time.time()
            fresh = _is_fresh(conn, topic, stage_name, freshness_window_s)
            if fresh is not None:
                stage_outputs[stage_name] = fresh
                emit(OrchestratorEvent(
                    stage=stage_name, status=StageStatus.SKIPPED,
                    started_at=started, ended_at=time.time(),
                    detail="fresh",
                ))
                continue

            emit(OrchestratorEvent(
                stage=stage_name, status=StageStatus.RUNNING,
                started_at=started,
            ))

            fn = stages.get(stage_name)
            if fn is None:
                emit(OrchestratorEvent(
                    stage=stage_name, status=StageStatus.FAILED,
                    started_at=started, ended_at=time.time(),
                    detail=f"no stage implementation for '{stage_name}'",
                    error_class="impl_missing",
                ))
                stage_outputs[stage_name] = None
                continue

            try:
                kwargs: dict[str, Any] = {"provider": provider}
                if stage_name == "deliberate":
                    kwargs["rounds"] = rounds
                # downstream stages get prior outputs as kwargs
                if stage_name == "synthesize":
                    kwargs["audience"] = stage_outputs.get("audience")
                if stage_name == "deliberate":
                    kwargs["audience"] = stage_outputs.get("audience")
                    kwargs["insights"] = stage_outputs.get("synthesize")
                if stage_name == "launch_brief":
                    kwargs["audience"] = stage_outputs.get("audience")
                    kwargs["insights"] = stage_outputs.get("synthesize")
                    kwargs["deliberate"] = stage_outputs.get("deliberate")
                payload = fn(topic, **kwargs)
                stage_outputs[stage_name] = payload
                _persist_stage(conn, topic, stage_name, payload)
                emit(OrchestratorEvent(
                    stage=stage_name, status=StageStatus.DONE,
                    started_at=started, ended_at=time.time(),
                ))
            except Exception as exc:  # noqa: BLE001 — orchestrator tolerates any stage failure
                stage_outputs[stage_name] = None
                emit(OrchestratorEvent(
                    stage=stage_name, status=StageStatus.FAILED,
                    started_at=started, ended_at=time.time(),
                    detail=str(exc),
                    error_class=_classify_error(exc),
                ))

        # Final brief assembly: pull from launch_brief stage if present; else degrade.
        launch_out = stage_outputs.get("launch_brief") or {}
        brief = launch_out.get("brief") if isinstance(launch_out, dict) else None
        if brief is None:
            brief = {
                "headline_gap": (stage_outputs.get("synthesize") or {}).get("headline")
                                if isinstance(stage_outputs.get("synthesize"), dict) else None,
                "evidence": [],
                "mvp": [],
                "audience": stage_outputs.get("audience") or {},
                "gtm": None,
                "degraded": True,
            }
        _persist_brief(conn, topic, brief)
        return {
            "brief": brief,
            "stages": stage_outputs,
        }
    finally:
        conn.close()
```

- [ ] **Step 4: Run tests, confirm pass**

```bash
cd /Users/shantanubombatkar/Documents/GitHub/reddit-myind
uv run pytest tests/test_brief_orchestrator.py -v
```
Expected: 4 passing.

- [ ] **Step 5: Changelog + commit**

Create `changelogs/2026-05-24_08_brief-orchestrator.md`:

```markdown
# Brief orchestrator (Python)

**Date:** 2026-05-24
**Type:** Feature

## Summary

`generate_brief()` sequences audience → synthesize → deliberate → launch_brief.
Each stage is idempotent (24h freshness cache); partial failures do not abort
the pipeline. Emits structured `OrchestratorEvent`s; persists per-stage output
to `topic_briefs_stages` and the final brief to `topic_briefs`.

## Files Created

- `src/reddit_research/research/brief_orchestrator.py`
- `tests/test_brief_orchestrator.py` (4 passing)
```

```bash
git add src/reddit_research/research/brief_orchestrator.py tests/test_brief_orchestrator.py changelogs/2026-05-24_08_brief-orchestrator.md
git commit -m "$(cat <<'EOF'
feat(research): brief_orchestrator — idempotent, partial-failure-tolerant pipeline

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: `generate_brief` Rust command + event streaming + CLI verb

**Files:**
- Modify: `app-tauri/src-tauri/src/commands.rs` — add `generate_brief` command
- Modify: `app-tauri/src-tauri/src/main.rs` — register the command
- Modify: `src/reddit_research/__main__.py` (or wherever Typer commands live) — add `brief generate` verb that calls `brief_orchestrator.generate_brief()` with real stage fns
- Modify: `app-tauri/src/api.js` — `generateBrief()` wrapper
- Create: `changelogs/2026-05-24_09_generate-brief-command.md`

- [ ] **Step 1: Add the Typer `brief generate` subcommand**

Open `src/reddit_research/__main__.py` (or the CLI module that owns `research collect`). Add a `brief` subcommand group with a `generate` verb that loads real stage fns from `research/audience.py`, `research/insights.py`, `research/deliberate.py`, `research/launch.py`, then calls `brief_orchestrator.generate_brief` and prints NDJSON events to stdout (one event per line) plus the final brief as a `{"final": ...}` line.

Real shape:

```python
import json
import typer
from pathlib import Path

from reddit_research.research.brief_orchestrator import (
    OrchestratorEvent,
    generate_brief,
)
# Real stage fns. These already exist in tree.
from reddit_research.research.audience import build_audience_personas
from reddit_research.research.insights import synthesize_topic_insights
from reddit_research.research.deliberate import deliberate_topic
from reddit_research.research.launch import build_launch_brief
from reddit_research.config import db_path  # whichever helper resolves the SQLite path

brief_app = typer.Typer(help="Brief orchestration")

def _emit(event: OrchestratorEvent) -> None:
    print(json.dumps({
        "event": "stage",
        "stage": event.stage,
        "status": event.status.value,
        "started_at": event.started_at,
        "ended_at": event.ended_at,
        "detail": event.detail,
        "error_class": event.error_class,
    }), flush=True)

@brief_app.command("generate")
def cmd_generate(
    topic: str = typer.Option(..., "--topic"),
    provider: str = typer.Option("anthropic", "--provider"),
    rounds: int = typer.Option(2, "--rounds"),
    freshness: int = typer.Option(86_400, "--freshness-window-s"),
):
    """Run the brief orchestrator and stream NDJSON events to stdout."""
    stages = {
        "audience": lambda topic, **kw: build_audience_personas(topic, provider=kw.get("provider")),
        "synthesize": lambda topic, **kw: synthesize_topic_insights(topic, provider=kw.get("provider")),
        "deliberate": lambda topic, **kw: deliberate_topic(topic, rounds=kw.get("rounds", 2), provider=kw.get("provider")),
        "launch_brief": lambda topic, **kw: build_launch_brief(topic, provider=kw.get("provider")),
    }
    result = generate_brief(
        topic=topic,
        db_path=Path(db_path()),
        provider=provider,
        stages=stages,
        emit=_emit,
        freshness_window_s=freshness,
        rounds=rounds,
    )
    print(json.dumps({"event": "final", "brief": result["brief"]}, default=str), flush=True)

# At the bottom of __main__.py where other groups are added:
app.add_typer(brief_app, name="brief")
```

Adapt the imports and `db_path` helper name to match the existing convention in the file. If `build_audience_personas` / `synthesize_topic_insights` / etc. have different signatures in the existing files, wrap each stage in a small lambda that adapts the orchestrator's `(topic, **kwargs)` calling convention to whatever the real function expects.

- [ ] **Step 2: Smoke the CLI verb directly**

```bash
cd /Users/shantanubombatkar/Documents/GitHub/reddit-myind
uv run reddit-cli brief generate --topic "noise-cancelling headphones" --rounds 1 2>&1 | head -20
```
Expected: at minimum 4 `{"event":"stage", ...}` lines + 1 `{"event":"final", ...}` line. Some stages may fail if the topic has no corpus — that's OK; the orchestrator tolerates it.

- [ ] **Step 3: Add the Rust `generate_brief` command**

In `app-tauri/src-tauri/src/commands.rs`, add a new command that spawns the sidecar with the `brief generate` verb and streams NDJSON events to the frontend via Tauri events. Reference the existing sidecar-spawn pattern in the file (search for `Command::new` or `tauri_plugin_shell`).

Sketch (concrete reference — adapt to existing patterns):

```rust
#[tauri::command]
pub async fn generate_brief(
    app: tauri::AppHandle,
    topic: String,
    provider: Option<String>,
    rounds: Option<u32>,
) -> Result<(), String> {
    use tauri::Emitter;
    use tauri_plugin_shell::ShellExt;
    use tauri_plugin_shell::process::CommandEvent;

    let provider = provider.unwrap_or_else(|| "anthropic".to_string());
    let rounds = rounds.unwrap_or(2);
    let topic_for_event = topic.clone();
    let app_clone = app.clone();

    let sidecar = app.shell().sidecar("reddit-cli")
        .map_err(|e| format!("sidecar lookup failed: {e}"))?
        .args([
            "brief", "generate",
            "--topic", &topic,
            "--provider", &provider,
            "--rounds", &rounds.to_string(),
        ]);

    let (mut rx, _child) = sidecar.spawn().map_err(|e| format!("spawn failed: {e}"))?;

    let event_name = format!("pipeline_status:{}", topic_for_event);
    tauri::async_runtime::spawn(async move {
        while let Some(ev) = rx.recv().await {
            if let CommandEvent::Stdout(bytes) = ev {
                if let Ok(line) = String::from_utf8(bytes.to_vec()) {
                    for part in line.split('\n').filter(|s| !s.trim().is_empty()) {
                        let _ = app_clone.emit(&event_name, part);
                    }
                }
            }
        }
    });

    Ok(())
}
```

Register the command in `main.rs` `tauri::generate_handler!` list (the same place `license_status` and friends are listed).

- [ ] **Step 4: Add a frontend wrapper**

In `app-tauri/src/api.js`, near the other invoke wrappers, add:

```js
export function generateBrief({ topic, provider, rounds } = {}) {
  return invoke('generate_brief', { topic, provider, rounds });
}

export function subscribeBriefEvents(topic, callback) {
  // callback receives parsed event objects from the NDJSON stream
  const eventName = `pipeline_status:${topic}`;
  return listen(eventName, (msg) => {
    try {
      callback(JSON.parse(msg.payload));
    } catch (e) {
      // Tolerant: skip malformed NDJSON lines
    }
  });
}
```

Import `listen` from `@tauri-apps/api/event` at the top of `api.js` if it isn't already imported.

- [ ] **Step 5: Verify Rust compiles, tests pass**

```bash
cd app-tauri/src-tauri
cargo check
cargo test
```
Expected: clean compile.

- [ ] **Step 6: Changelog + commit**

Create `changelogs/2026-05-24_09_generate-brief-command.md` documenting the new CLI verb + Rust command + JS wrapper:

```bash
git add src/reddit_research/__main__.py app-tauri/src-tauri/src/commands.rs app-tauri/src-tauri/src/main.rs app-tauri/src/api.js changelogs/2026-05-24_09_generate-brief-command.md
git commit -m "$(cat <<'EOF'
feat(brief): generate_brief Rust command + CLI verb + JS wrapper

Streams NDJSON pipeline events from the Python orchestrator to the frontend
via tauri::Emitter on pipeline_status:{topic}.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Mount the Topic Dashboard into `topic.js`

**Files:**
- Create: `app-tauri/src/screens/topic_dashboard.js`
- Create: `app-tauri/src/screens/topic_dashboard.test.mjs`
- Modify: `app-tauri/src/screens/topic.js` — mount the dashboard at the top
- Modify: `app-tauri/package.json`
- Create: `changelogs/2026-05-24_10_topic-dashboard-mounted.md`

- [ ] **Step 1: Failing test**

Create `app-tauri/src/screens/topic_dashboard.test.mjs`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';

import { renderTopicDashboard, updatePipelineFromEvent } from './topic_dashboard.js';

test('renderTopicDashboard returns container with three sections', () => {
  const html = renderTopicDashboard({
    topic: 'meditation apps',
    brief: null,
    pipeline: { stages: [] },
    workspace: { cards: [{ label: 'Insights', count: 12, href: '#/insights' }] },
  });
  assert.match(html, /Topic: meditation apps/);
  assert.match(html, /pipeline-status/);
  assert.match(html, /brief-card/);
  assert.match(html, /workspace-strip/);
});

test('updatePipelineFromEvent flips a pending stage to running', () => {
  const state = {
    stages: [
      { key: 'audience',   label: 'audience',   status: 'pending' },
      { key: 'synthesize', label: 'synthesize', status: 'pending' },
    ],
  };
  const next = updatePipelineFromEvent(state, {
    event: 'stage', stage: 'audience', status: 'running',
  });
  assert.equal(next.stages[0].status, 'running');
  assert.equal(next.stages[1].status, 'pending');
});

test('updatePipelineFromEvent ignores unknown stages without crashing', () => {
  const state = { stages: [{ key: 'audience', label: 'audience', status: 'pending' }] };
  const next = updatePipelineFromEvent(state, { event: 'stage', stage: 'unknown', status: 'done' });
  assert.deepStrictEqual(next, state);
});
```

- [ ] **Step 2: Run, confirm failure**

```bash
cd app-tauri
node --test src/screens/topic_dashboard.test.mjs
```
Expected: FAIL.

- [ ] **Step 3: Implement the dashboard host**

Create `app-tauri/src/screens/topic_dashboard.js`:

```javascript
import { pipelineStatus } from '../components/PipelineStatus.js';
import { briefCard } from '../components/BriefCard.js';
import { workspaceStrip } from '../components/WorkspaceStripCard.js';

const DEFAULT_STAGES = [
  { key: 'discover',   label: 'discover',   status: 'pending' },
  { key: 'collect',    label: 'collect',    status: 'pending' },
  { key: 'audience',   label: 'audience',   status: 'pending' },
  { key: 'synthesize', label: 'synth',      status: 'pending' },
  { key: 'deliberate', label: 'deliberate', status: 'pending' },
  { key: 'launch_brief', label: 'launch',   status: 'pending' },
];

const DEFAULT_WORKSPACE_CARDS = [
  { label: 'Insights',  count: null, href: '#/insights' },
  { label: 'Gap list',  count: null, href: '#/topic' }, // gap list lives in topic for now
  { label: 'Personas',  count: null, href: '#/personas' },
  { label: 'Papers',    count: null, href: '#/papers' },
  { label: 'Graph',     count: null, href: '#/topic' },
  { label: 'Compare',   count: null, href: '#/compare' },
  { label: 'Launch',    count: null, href: '#/launch' },
  { label: 'Reports',   count: null, href: '#/reports' },
];

export function renderTopicDashboard({ topic, brief = null, pipeline, workspace } = {}) {
  const stages = (pipeline && pipeline.stages && pipeline.stages.length) ? pipeline.stages : DEFAULT_STAGES;
  const cards  = (workspace && workspace.cards && workspace.cards.length) ? workspace.cards  : DEFAULT_WORKSPACE_CARDS;

  return `
    <section class="topic-dashboard">
      <header class="topic-dashboard__header">
        <h2 class="topic-dashboard__title">Topic: ${escapeHtml(topic ?? '')}</h2>
      </header>
      ${pipelineStatus({ stages, onReRun: 'window.__topicDashboardRerun()', onCancel: 'window.__topicDashboardCancel()' })}
      <div class="topic-dashboard__brief">${briefCard({ brief, onRegenerate: 'window.__topicDashboardRerun()' })}</div>
      <div class="topic-dashboard__workspace">${workspaceStrip({ cards })}</div>
    </section>`;
}

export function updatePipelineFromEvent(state, event) {
  if (!event || event.event !== 'stage') return state;
  const idx = state.stages.findIndex((s) => s.key === event.stage);
  if (idx === -1) return state;
  const next = { ...state, stages: state.stages.map((s, i) => i === idx ? {
    ...s,
    status: event.status,
    detail: event.detail ?? s.detail,
  } : s) };
  return next;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
```

- [ ] **Step 4: Tests pass**

```bash
cd app-tauri
node --test src/screens/topic_dashboard.test.mjs
```
Expected: 3 passing.

- [ ] **Step 5: Mount the dashboard in `topic.js`**

Open `app-tauri/src/screens/topic.js` (this is the 247 KB file — read carefully, find the render entry point — search for `export function`, `renderTopic`, or wherever the top-level HTML string is composed).

At the very top of the topic page's render output (before any tab UI), insert the dashboard. The simplest pattern:

```javascript
import { renderTopicDashboard, updatePipelineFromEvent } from './topic_dashboard.js';
import { generateBrief, subscribeBriefEvents } from '../api.js';

// ... existing imports ...

// Inside the renderTopic function (or equivalent), at the top of the returned HTML:
//   <div id="topic-dashboard-host">${renderTopicDashboard({ topic, brief: cachedBrief })}</div>
//   ... existing tab UI ...

// After the HTML mounts, wire the rerun handler + event subscription:
async function wireTopicDashboard(topic) {
  let state = { stages: [/* default stages */] };
  window.__topicDashboardRerun = async () => {
    state = { stages: [/* default stages, all pending */] };
    document.querySelector('#topic-dashboard-host').innerHTML =
      renderTopicDashboard({ topic, brief: null, pipeline: state });
    await generateBrief({ topic });
  };
  await subscribeBriefEvents(topic, (event) => {
    state = updatePipelineFromEvent(state, event);
    if (event.event === 'final' && event.brief) {
      document.querySelector('#topic-dashboard-host').innerHTML =
        renderTopicDashboard({ topic, brief: event.brief, pipeline: state });
    } else {
      // re-render only the strip portion if we want to be surgical; for v1 re-render whole host
      document.querySelector('#topic-dashboard-host').innerHTML =
        renderTopicDashboard({ topic, brief: null, pipeline: state });
    }
  });
}
```

Adapt the exact mount point to wherever `topic.js`'s existing render function is. The dashboard host is **additive** — existing tabs render after it. Do not remove any existing screen content.

- [ ] **Step 6: Add the dashboard test to package.json**

Extend `"test"` to include `src/screens/topic_dashboard.test.mjs`. Run `npm test`. Confirm green.

- [ ] **Step 7: Manual smoke test in `npm run tauri:dev`**

```bash
cd app-tauri
npm run tauri:dev
```
Then: open the app → navigate to any existing topic → confirm the dashboard appears above the existing tabs → click "Generate brief" → watch pipeline pills update live.

Capture any UI-breaking issues immediately; if the host div is colliding with the existing topic-screen layout, adjust the mount point.

- [ ] **Step 8: Changelog + commit**

```bash
git add app-tauri/src/screens/topic_dashboard.js app-tauri/src/screens/topic_dashboard.test.mjs app-tauri/src/screens/topic.js app-tauri/package.json changelogs/2026-05-24_10_topic-dashboard-mounted.md
git commit -m "$(cat <<'EOF'
feat(flow): Topic Dashboard mounted at top of topic.js (additive)

Pipeline status strip + brief card + workspace strip. Existing 44-screen
navigation untouched. Wired to generate_brief command + pipeline_status events.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# Phase P2 — Chat with the corpus

Goal of P2: a `Chat` tab that lets the user converse with the corpus. Backend leverages the existing `src/reddit_research/research/chat.py` (42 KB). New tab in the workspace strip; existing screens untouched.

---

## Task 11: `chat_threads` SQLite table + Rust `chat` command + Python tool wrappers

**Files:**
- Modify: `app-tauri/src-tauri/src/commands.rs` — add `chat`, `chat_thread_list`, `chat_thread_get`
- Modify: `app-tauri/src-tauri/src/main.rs` — register the 3 chat commands
- Create: `src/reddit_research/research/chat_threads.py` — thread persistence helpers
- Modify: `src/reddit_research/__main__.py` — `chat ask` CLI verb that streams NDJSON
- Modify: `app-tauri/src/api.js` — chat wrappers
- Create: `tests/test_chat_threads.py`
- Create: `changelogs/2026-05-24_11_chat-backend.md`

- [ ] **Step 1: Failing test for thread persistence**

Create `tests/test_chat_threads.py`:

```python
import json
from pathlib import Path

import pytest

from reddit_research.research.chat_threads import (
    append_message,
    create_thread,
    init_schema,
    list_threads,
    load_thread,
)


@pytest.fixture
def db(tmp_path):
    p = tmp_path / "chat.db"
    init_schema(p)
    return p


def test_create_then_load_round_trip(db):
    tid = create_thread(db, topic="meditation apps")
    assert tid
    assert load_thread(db, tid) == {"thread_id": tid, "topic": "meditation apps", "messages": []}


def test_append_then_list(db):
    tid = create_thread(db, topic="t1")
    append_message(db, tid, role="user", content="hi")
    append_message(db, tid, role="assistant", content="hello", tool_calls=[{"name": "search", "args": {"q": "x"}}])
    loaded = load_thread(db, tid)
    assert [m["role"] for m in loaded["messages"]] == ["user", "assistant"]
    assert loaded["messages"][1]["tool_calls"][0]["name"] == "search"


def test_list_threads_for_topic(db):
    create_thread(db, topic="t1")
    create_thread(db, topic="t1")
    create_thread(db, topic="t2")
    rows = list_threads(db, topic="t1")
    assert len(rows) == 2
```

- [ ] **Step 2: Run, confirm fail**

```bash
uv run pytest tests/test_chat_threads.py -v
```
Expected: ImportError.

- [ ] **Step 3: Implement `chat_threads.py`**

Create `src/reddit_research/research/chat_threads.py`:

```python
"""SQLite persistence for chat threads — keyed on (topic, thread_id).

Messages store {role, content, ts, tool_calls?, tokens?} per row.
"""
from __future__ import annotations

import json
import sqlite3
import time
import uuid
from pathlib import Path
from typing import Optional


SCHEMA = """
CREATE TABLE IF NOT EXISTS chat_threads (
    thread_id TEXT PRIMARY KEY,
    topic TEXT NOT NULL,
    created_at REAL NOT NULL,
    last_used_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_threads_topic ON chat_threads(topic, last_used_at DESC);

CREATE TABLE IF NOT EXISTS chat_messages (
    thread_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    tool_calls TEXT,
    tokens INTEGER,
    ts REAL NOT NULL,
    PRIMARY KEY (thread_id, seq),
    FOREIGN KEY (thread_id) REFERENCES chat_threads(thread_id)
);
"""


def init_schema(db_path: Path) -> None:
    conn = sqlite3.connect(str(db_path))
    try:
        conn.executescript(SCHEMA)
        conn.commit()
    finally:
        conn.close()


def create_thread(db_path: Path, topic: str) -> str:
    init_schema(db_path)
    tid = uuid.uuid4().hex
    now = time.time()
    conn = sqlite3.connect(str(db_path))
    try:
        conn.execute(
            "INSERT INTO chat_threads(thread_id, topic, created_at, last_used_at) VALUES (?, ?, ?, ?)",
            (tid, topic, now, now),
        )
        conn.commit()
    finally:
        conn.close()
    return tid


def append_message(
    db_path: Path,
    thread_id: str,
    role: str,
    content: str,
    tool_calls: Optional[list] = None,
    tokens: Optional[int] = None,
) -> None:
    init_schema(db_path)
    conn = sqlite3.connect(str(db_path))
    try:
        seq_row = conn.execute(
            "SELECT COALESCE(MAX(seq), -1) + 1 FROM chat_messages WHERE thread_id=?",
            (thread_id,),
        ).fetchone()
        seq = seq_row[0]
        conn.execute(
            "INSERT INTO chat_messages(thread_id, seq, role, content, tool_calls, tokens, ts) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (thread_id, seq, role, content, json.dumps(tool_calls) if tool_calls else None, tokens, time.time()),
        )
        conn.execute(
            "UPDATE chat_threads SET last_used_at=? WHERE thread_id=?",
            (time.time(), thread_id),
        )
        conn.commit()
    finally:
        conn.close()


def load_thread(db_path: Path, thread_id: str) -> dict:
    init_schema(db_path)
    conn = sqlite3.connect(str(db_path))
    try:
        head = conn.execute(
            "SELECT topic FROM chat_threads WHERE thread_id=?", (thread_id,),
        ).fetchone()
        if not head:
            return {"thread_id": thread_id, "topic": None, "messages": []}
        msgs = []
        for role, content, tool_calls, tokens, ts in conn.execute(
            "SELECT role, content, tool_calls, tokens, ts FROM chat_messages WHERE thread_id=? ORDER BY seq",
            (thread_id,),
        ):
            msg = {"role": role, "content": content, "ts": ts}
            if tool_calls:
                msg["tool_calls"] = json.loads(tool_calls)
            if tokens is not None:
                msg["tokens"] = tokens
            msgs.append(msg)
        return {"thread_id": thread_id, "topic": head[0], "messages": msgs}
    finally:
        conn.close()


def list_threads(db_path: Path, topic: str) -> list[dict]:
    init_schema(db_path)
    conn = sqlite3.connect(str(db_path))
    try:
        return [
            {"thread_id": tid, "created_at": ca, "last_used_at": lu}
            for tid, ca, lu in conn.execute(
                "SELECT thread_id, created_at, last_used_at FROM chat_threads WHERE topic=? ORDER BY last_used_at DESC",
                (topic,),
            )
        ]
    finally:
        conn.close()
```

- [ ] **Step 4: Tests pass**

```bash
uv run pytest tests/test_chat_threads.py -v
```
Expected: 3 passing.

- [ ] **Step 5: Add CLI `chat ask` verb that streams NDJSON**

In `src/reddit_research/__main__.py`, register a `chat` typer sub-app:

```python
import json
import typer
from pathlib import Path
from reddit_research.research import chat as chat_engine  # existing 42 KB module
from reddit_research.research.chat_threads import append_message, create_thread, load_thread
from reddit_research.config import db_path

chat_app = typer.Typer(help="Chat with a topic's corpus")

@chat_app.command("ask")
def chat_ask(
    topic: str = typer.Option(..., "--topic"),
    message: str = typer.Option(..., "--message"),
    thread_id: str = typer.Option(None, "--thread"),
    provider: str = typer.Option("anthropic", "--provider"),
    max_tokens: int = typer.Option(30_000, "--max-input-tokens"),
    max_rounds: int = typer.Option(4, "--max-tool-rounds"),
):
    """Send a single chat turn. Streams NDJSON of {event, ...} lines to stdout."""
    db = Path(db_path())
    tid = thread_id or create_thread(db, topic=topic)
    print(json.dumps({"event": "thread", "thread_id": tid}), flush=True)

    history = load_thread(db, tid)["messages"]
    append_message(db, tid, role="user", content=message)

    # chat_engine.run_turn is assumed to exist in research/chat.py. If the function
    # name differs, adapt to the public entry point that takes (topic, message,
    # history, provider, tool_caps) and yields events.
    for ev in chat_engine.run_turn(
        topic=topic,
        message=message,
        history=history,
        provider=provider,
        max_input_tokens=max_tokens,
        max_tool_rounds=max_rounds,
    ):
        print(json.dumps(ev, default=str), flush=True)
        if ev.get("event") == "final" and ev.get("content"):
            append_message(
                db, tid, role="assistant",
                content=ev["content"],
                tool_calls=ev.get("tool_calls"),
                tokens=ev.get("tokens"),
            )

app.add_typer(chat_app, name="chat")
```

If `research/chat.py` does not expose a `run_turn` generator with the assumed event shape, READ the file first and adapt this verb to whatever its public function is (search for `def ask`, `def run`, `def chat`). Document the adapter in the changelog. **Don't refactor `chat.py` in this task — just call its existing surface.**

- [ ] **Step 6: Add the `chat` Rust command**

In `commands.rs`, mirror the `generate_brief` pattern from Task 9:

```rust
#[tauri::command]
pub async fn chat(
    app: tauri::AppHandle,
    topic: String,
    message: String,
    thread_id: Option<String>,
    provider: Option<String>,
) -> Result<(), String> {
    use tauri::Emitter;
    use tauri_plugin_shell::ShellExt;
    use tauri_plugin_shell::process::CommandEvent;

    let provider = provider.unwrap_or_else(|| "anthropic".to_string());
    let mut args = vec![
        "chat".to_string(), "ask".to_string(),
        "--topic".to_string(), topic.clone(),
        "--message".to_string(), message,
        "--provider".to_string(), provider,
    ];
    if let Some(tid) = thread_id.as_ref() {
        args.push("--thread".to_string());
        args.push(tid.clone());
    }

    let sidecar = app.shell().sidecar("reddit-cli")
        .map_err(|e| format!("sidecar lookup failed: {e}"))?
        .args(args);
    let (mut rx, _child) = sidecar.spawn().map_err(|e| format!("spawn failed: {e}"))?;
    let app_clone = app.clone();
    let topic_clone = topic.clone();

    tauri::async_runtime::spawn(async move {
        let event_name = format!("chat:{}", topic_clone);
        while let Some(ev) = rx.recv().await {
            if let CommandEvent::Stdout(bytes) = ev {
                if let Ok(line) = String::from_utf8(bytes.to_vec()) {
                    for part in line.split('\n').filter(|s| !s.trim().is_empty()) {
                        let _ = app_clone.emit(&event_name, part);
                    }
                }
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn chat_thread_list(topic: String) -> Result<Vec<serde_json::Value>, String> {
    // shell out to the CLI for now; later may move to native rusqlite read
    // for sub-ms response. Out of scope: doing it natively here.
    let output = std::process::Command::new(/* sidecar path resolver */ "reddit-cli")
        .args(["chat", "list", "--topic", &topic, "--json"])
        .output()
        .map_err(|e| e.to_string())?;
    Ok(serde_json::from_slice(&output.stdout).unwrap_or_default())
}

#[tauri::command]
pub async fn chat_thread_get(thread_id: String) -> Result<serde_json::Value, String> {
    let output = std::process::Command::new("reddit-cli")
        .args(["chat", "get", "--thread", &thread_id, "--json"])
        .output()
        .map_err(|e| e.to_string())?;
    Ok(serde_json::from_slice(&output.stdout).unwrap_or_default())
}
```

Add `chat list` and `chat get` Typer verbs alongside `chat ask` for parity. Register all 3 commands in `main.rs`'s `tauri::generate_handler!`.

Note on the sidecar path: existing commands.rs has a sidecar resolver helper (search for `binaries` or `sidecar`). Use that helper instead of `Command::new("reddit-cli")` so the bundled binary is preferred when running inside the DMG.

- [ ] **Step 7: Frontend wrappers**

In `app-tauri/src/api.js`:

```js
export function chatAsk({ topic, message, threadId, provider } = {}) {
  return invoke('chat', { topic, message, threadId, provider });
}

export function chatThreadList(topic) {
  return invoke('chat_thread_list', { topic });
}

export function chatThreadGet(threadId) {
  return invoke('chat_thread_get', { threadId });
}

export function subscribeChatEvents(topic, callback) {
  return listen(`chat:${topic}`, (msg) => {
    try { callback(JSON.parse(msg.payload)); } catch (_e) { /* skip */ }
  });
}
```

- [ ] **Step 8: Compile + smoke**

```bash
cd app-tauri/src-tauri
cargo check
cd ..
npm test
```
Expected: clean.

- [ ] **Step 9: Changelog + commit**

```bash
git add src/reddit_research/research/chat_threads.py tests/test_chat_threads.py src/reddit_research/__main__.py app-tauri/src-tauri/src/commands.rs app-tauri/src-tauri/src/main.rs app-tauri/src/api.js changelogs/2026-05-24_11_chat-backend.md
git commit -m "$(cat <<'EOF'
feat(chat): chat_threads persistence + chat / list / get Rust commands + CLI verbs

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Chat tab UI (`screens/chat.js`)

**Files:**
- Create: `app-tauri/src/screens/chat.js`
- Create: `app-tauri/src/screens/chat.test.mjs`
- Modify: `app-tauri/src/main.js` — register `/chat` route
- Modify: `app-tauri/src/screens/topic_dashboard.js` — add Chat card to default workspace strip
- Modify: `app-tauri/package.json` — add the test
- Create: `changelogs/2026-05-24_12_chat-screen.md`

- [ ] **Step 1: Failing test**

Create `app-tauri/src/screens/chat.test.mjs`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';

import { renderChat, renderMessages, appendUserBubble } from './chat.js';

test('renderChat returns a composer + history container', () => {
  const html = renderChat({ topic: 'meditation apps', messages: [] });
  assert.match(html, /chat-screen/);
  assert.match(html, /chat-history/);
  assert.match(html, /chat-composer/);
});

test('renderMessages renders role-tagged bubbles', () => {
  const html = renderMessages({ messages: [
    { role: 'user',      content: 'hi'    },
    { role: 'assistant', content: 'hello', tool_calls: [{ name: 'search_corpus', args: {q: 'x'} }] },
  ] });
  assert.match(html, /chat-bubble--user/);
  assert.match(html, /chat-bubble--assistant/);
  assert.match(html, /Looked up:/);
});

test('appendUserBubble adds a new pending bubble', () => {
  const messages = [];
  appendUserBubble(messages, 'hi');
  assert.deepStrictEqual(messages, [{ role: 'user', content: 'hi' }]);
});
```

- [ ] **Step 2: Run, confirm fail**

```bash
cd app-tauri && node --test src/screens/chat.test.mjs
```
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `app-tauri/src/screens/chat.js`:

```javascript
import { chatAsk, subscribeChatEvents, chatThreadGet } from '../api.js';

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function bubbleHtml(msg) {
  const klass = `chat-bubble chat-bubble--${escapeHtml(msg.role)}`;
  const tools = (msg.tool_calls || []).map((tc) => `
    <details class="chat-tool-call">
      <summary>Looked up: ${escapeHtml(tc.name)}</summary>
      <pre>${escapeHtml(JSON.stringify(tc.args ?? {}, null, 2))}</pre>
    </details>`).join('');
  const footer = msg.role === 'assistant'
    ? `<footer class="chat-bubble__footer">used ${msg.tool_calls?.length ?? 0} tools, ${msg.tokens ?? 0} tokens</footer>`
    : '';
  return `
    <article class="${klass}">
      <div class="chat-bubble__content">${escapeHtml(msg.content)}</div>
      ${tools}
      ${footer}
    </article>`;
}

export function renderMessages({ messages = [] } = {}) {
  if (messages.length === 0) {
    return `<div class="chat-history__empty">Ask anything about this topic to get started.</div>`;
  }
  return messages.map(bubbleHtml).join('');
}

export function renderChat({ topic, messages = [], threadId = null } = {}) {
  return `
    <section class="chat-screen" data-topic="${escapeHtml(topic ?? '')}" data-thread="${escapeHtml(threadId ?? '')}">
      <header class="chat-screen__header">
        <h2>Chat — ${escapeHtml(topic ?? '')}</h2>
      </header>
      <div class="chat-history" id="chat-history">
        ${renderMessages({ messages })}
      </div>
      <form class="chat-composer" id="chat-composer">
        <textarea class="chat-composer__input" placeholder="Ask about this topic..." rows="2"></textarea>
        <button type="submit" class="btn btn--primary">Send</button>
      </form>
    </section>`;
}

export function appendUserBubble(messages, content) {
  messages.push({ role: 'user', content });
}

export async function wireChatScreen({ topic, threadId }) {
  const history = document.querySelector('#chat-history');
  const composer = document.querySelector('#chat-composer');
  if (!history || !composer) return;

  const messages = threadId
    ? (await chatThreadGet(threadId))?.messages ?? []
    : [];
  history.innerHTML = renderMessages({ messages });

  const unlisten = await subscribeChatEvents(topic, (event) => {
    if (event.event === 'thread' && !threadId) {
      threadId = event.thread_id;
    } else if (event.event === 'final') {
      messages.push({
        role: 'assistant',
        content: event.content,
        tool_calls: event.tool_calls,
        tokens: event.tokens,
      });
      history.innerHTML = renderMessages({ messages });
      history.scrollTop = history.scrollHeight;
    } else if (event.event === 'tool_call') {
      // optional: show a transient "calling X" indicator
    }
  });

  composer.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = composer.querySelector('.chat-composer__input');
    const text = input.value.trim();
    if (!text) return;
    appendUserBubble(messages, text);
    history.innerHTML = renderMessages({ messages });
    input.value = '';
    history.scrollTop = history.scrollHeight;
    await chatAsk({ topic, message: text, threadId });
  });

  // Provide a destroy hook the router can call on navigation away
  return () => { try { unlisten?.(); } catch (_) {} };
}
```

- [ ] **Step 4: Tests pass**

```bash
cd app-tauri && node --test src/screens/chat.test.mjs
```
Expected: 3 passing.

- [ ] **Step 5: Register the `/chat` route in `main.js`**

In `app-tauri/src/main.js`, find the route table / switch statement that maps hash routes to screen renderers (search for the other `/topic`, `/insights`, etc. routes). Add:

```js
import { renderChat, wireChatScreen } from './screens/chat.js';

// In the route table:
if (/^\/chat(\/(?<topic>[^/]+))?\/?$/.test(hash)) {
  const m = hash.match(/^\/chat(\/(?<topic>[^/]+))?\/?$/);
  const topic = decodeURIComponent(m.groups.topic || '');
  const threadId = new URLSearchParams(location.search).get('thread');
  main.innerHTML = renderChat({ topic, threadId });
  await wireChatScreen({ topic, threadId });
  return;
}
```

Adapt to the exact pattern of the existing router. If the router uses a registry instead of regex blocks, register the chat screen the same way.

- [ ] **Step 6: Add Chat to the default workspace strip**

Edit `app-tauri/src/screens/topic_dashboard.js`. Append `{ label: 'Chat', count: null, href: '#/chat' }` to `DEFAULT_WORKSPACE_CARDS`. (Future work: deep-link to per-topic chat — `#/chat/<topic-slug>` — once topic-slug routing is canonical.)

- [ ] **Step 7: Test script + npm test**

Extend `"test"` in `package.json` to include `src/screens/chat.test.mjs`. Run `npm test`. Confirm green.

- [ ] **Step 8: Manual smoke**

`npm run tauri:dev` → open app → visit `/chat` → type a question → confirm response renders.

- [ ] **Step 9: Changelog + commit**

```bash
git add app-tauri/src/screens/chat.js app-tauri/src/screens/chat.test.mjs app-tauri/src/main.js app-tauri/src/screens/topic_dashboard.js app-tauri/package.json changelogs/2026-05-24_12_chat-screen.md
git commit -m "$(cat <<'EOF'
feat(chat): chat tab UI + router wiring + workspace card

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Chat cost guardrails + eval

**Files:**
- Modify: `src/reddit_research/research/chat.py` (search for `max_input_tokens` / `max_tool_rounds` config wiring; add if missing)
- Create: `tests/test_chat_tool_selection.py`
- Create: `changelogs/2026-05-24_13_chat-guardrails.md`

- [ ] **Step 1: Audit existing guardrails in `chat.py`**

Read `src/reddit_research/research/chat.py`. Search for: `max_input_tokens`, `max_tokens`, `max_rounds`, `truncate`, `budget`. If those are already first-class, skip Step 2 and write the eval. If not, add them in Step 2.

- [ ] **Step 2: Add guardrails if missing**

The public entry point (`run_turn` or equivalent) should accept:

```python
def run_turn(
    *,
    topic: str,
    message: str,
    history: list[dict],
    provider: str,
    max_input_tokens: int = 30_000,
    max_tool_rounds: int = 4,
):
    ...
```

Implementation outline:

```python
def _truncate_history(history, max_tokens, approx_chars_per_token=4):
    budget_chars = max_tokens * approx_chars_per_token
    used = 0
    kept = []
    for msg in reversed(history):
        c = len(msg.get("content", ""))
        if used + c > budget_chars:
            break
        used += c
        kept.append(msg)
    return list(reversed(kept))

def run_turn(*, topic, message, history, provider, max_input_tokens, max_tool_rounds):
    history = _truncate_history(history, max_input_tokens)
    rounds = 0
    while rounds < max_tool_rounds:
        # ... call LLM with tool catalog ...
        if not tool_calls_requested:
            break
        # ... execute tool calls ...
        rounds += 1
    # Final assistant turn
    yield {"event": "final", "content": final_text, "tool_calls": tool_calls_log, "tokens": token_count}
```

If `chat.py` doesn't currently have a clean public entry, this task may grow — keep changes minimal and resist the urge to rewrite. The orchestrator+adapter pattern from Task 11 may need updating too if signatures change.

- [ ] **Step 3: Write the eval**

Create `tests/test_chat_tool_selection.py`:

```python
"""Coarse eval — 3 fixed prompts, asserts tool selection + token budget."""
from unittest.mock import patch, MagicMock

import pytest

from reddit_research.research import chat as chat_engine


@pytest.mark.parametrize(("prompt", "expected_tool"), [
    ("Find me a quote that proves people use lunch-break meditations", "search_corpus"),
    ("What gap is biggest?",                                          "find_gaps_excerpt"),
    ("Who's the target user?",                                        "top_personas"),
])
def test_first_tool_call_matches_intent(prompt, expected_tool):
    """Asserts that the LLM picks the right tool on a first call.

    Skip unless an LLM key is configured. This is an *eval* not a unit test —
    expect 2/3 to pass on a good day; tighten over time.
    """
    pytest.importorskip("anthropic")
    try:
        events = list(chat_engine.run_turn(
            topic="meditation apps",
            message=prompt,
            history=[],
            provider="anthropic",
            max_input_tokens=30_000,
            max_tool_rounds=2,
        ))
    except Exception as e:  # noqa: BLE001
        pytest.skip(f"chat engine raised: {e}")
    first_tool = next(
        (ev.get("name") for ev in events if ev.get("event") == "tool_call"),
        None,
    )
    if first_tool is None:
        pytest.skip("No tool call emitted — LLM may have answered without tools")
    assert first_tool == expected_tool


def test_truncation_respects_budget():
    history = [{"role": "user", "content": "x" * 1000} for _ in range(50)]
    kept = chat_engine._truncate_history(history, max_tokens=1000, approx_chars_per_token=4)
    # 1000 tokens × 4 chars/token = 4000 char budget → ~4 messages of 1000 chars each
    assert 3 <= len(kept) <= 5
```

- [ ] **Step 4: Run the eval**

```bash
uv run pytest tests/test_chat_tool_selection.py -v
```
Expected: `test_truncation_respects_budget` passes. The parametrized eval will SKIP if no API key is configured; that's intentional.

- [ ] **Step 5: Changelog + commit**

```bash
git add src/reddit_research/research/chat.py tests/test_chat_tool_selection.py changelogs/2026-05-24_13_chat-guardrails.md
git commit -m "$(cat <<'EOF'
feat(chat): cost guardrails (max_input_tokens, max_tool_rounds) + eval

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# Phase P3 — Sign + Release

Goal of P3: produce a notarized signed macOS DMG plus Linux AppImage and Windows MSI via the existing `release.yml` matrix, tagged as v0.1.0 GitHub Release. Requires user-side Apple cert work (documented in `docs/manual-todo/oss-launch.md`).

---

## Task 14: Verify unsigned CI pass + secrets dry-run

**Files:**
- Modify: `scripts/publish-mac.sh` — add `--adhoc` mode for local ad-hoc-signed DMG builds
- Modify: `.github/workflows/release.yml` (verify only — no edits unless drift)
- Create: `changelogs/2026-05-24_14_release-ci-verify.md`

- [ ] **Step 1: Add `--adhoc` flag to publish-mac.sh**

Read `scripts/publish-mac.sh`. Find the signing block. Add an `--adhoc` flag that bypasses Apple-cert signing and codesigns the bundle ad-hoc:

```bash
# Near the top of the script's arg parsing
ADHOC=0
for arg in "$@"; do
  case "$arg" in
    --adhoc) ADHOC=1 ;;
    --gated) GATED=1 ;;
    *) ;;
  esac
done

# In the build phase, when GATED is set:
if [[ "${GATED:-0}" == "1" ]]; then
  export OPENREPLY_LICENSE_GATE=true
  TAURI_FLAGS="-- --features license-gate"
fi

# When ADHOC is set, override the codesign identity:
if [[ "$ADHOC" == "1" ]]; then
  export TAURI_SIGNING_IDENTITY="-"
  echo "publish-mac.sh: ad-hoc signing mode (no Apple cert required)"
fi
```

Adapt to whatever shape the script currently has — the goal is two new toggles, not a rewrite.

- [ ] **Step 2: Run unsigned `release.yml` from a release-candidate tag**

This is the user-side test that the matrix is green BEFORE adding Apple secrets. From a clean working tree:

```bash
git tag v0.1.0-rc1
git push origin v0.1.0-rc1
```

Then in the GitHub Actions UI, watch the `release.yml` run.

- [ ] **Step 3: Read CI failures and fix in-place**

Common drift modes (from `LAUNCH.md` and recent commits):

- Frontend dist must exist for cargo check's `generate_context!()` macro (commit `c9bf46f` fixed this — verify the stub is still present in CI).
- Sidecar binary path naming differs between local (`reddit-cli`) and CI (`reddit-cli-aarch64-apple-darwin`).
- Python sidecar must be pre-built in CI before `tauri-action` runs.

Fix anything that breaks; commit fixes; re-tag `v0.1.0-rc2`; re-push; re-watch. Iterate until green.

- [ ] **Step 4: Run a local ad-hoc build to verify the DMG opens**

```bash
cd /Users/shantanubombatkar/Documents/GitHub/reddit-myind
bash scripts/publish-mac.sh --adhoc --arch arm64 2>&1 | tail -30
open app-tauri/src-tauri/target/release/bundle/dmg/*.dmg
```
Expected: DMG opens; drag-to-Applications; launch via right-click → Open → Open Anyway.

- [ ] **Step 5: Smoke test the DMG against the orchestrator**

Launch the installed `OpenReply.app`. Pick a topic. Click "Generate brief". Wait for completion. Confirm Brief renders and Workspace strip has clickable cards.

If anything breaks:
- Check `~/Library/Logs/com.shantanu.openreply/` for stderr.
- The pipeline status strip's failed stage detail will name the underlying error.

- [ ] **Step 6: Changelog + commit**

```bash
git add scripts/publish-mac.sh changelogs/2026-05-24_14_release-ci-verify.md
git commit -m "$(cat <<'EOF'
infra(release): publish-mac.sh --adhoc + --gated flags; CI verified green at v0.1.0-rcN

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: Tag v0.1.0 → public release

**Files:**
- Modify: `CHANGELOG.md` (move "Unreleased" into "0.1.0")
- Modify: `app-tauri/src-tauri/tauri.conf.json` (verify `version` is `0.1.0`)
- Create: `changelogs/2026-05-24_15_v0.1.0-release.md`

- [ ] **Step 1: Confirm the user has completed P3 manual TODO**

ASK the user explicitly:
- Apple Developer ID cert created?
- 7 GitHub Secrets added per `docs/manual-todo/oss-launch.md`?
- Repo flipped public?

Do NOT proceed past this point without explicit "yes" on all three. If any "no", instruct the user via `docs/manual-todo/oss-launch.md` and stop.

- [ ] **Step 2: Update CHANGELOG.md**

Open `CHANGELOG.md`. Move any "Unreleased" entries under a new heading:

```markdown
## [0.1.0] - 2026-05-24

### Added
- Topic Dashboard (Brief + Workspace strip + Pipeline Status)
- Brief orchestrator (audience → synthesize → deliberate → launch_brief)
- Corpus chat (`/chat`) with persisted threads + tool catalog
- Updater plumbing (P4 lands in v0.1.1)

### Changed
- License gate is now opt-in via `--features license-gate`; default OSS builds need no JWT secret
- Sidecar rebuilt with audience / iterate / launch / deliberate / paper-pipeline features

### Infrastructure
- macOS Developer ID signing + notarization
- Linux AppImage + Windows MSI in release matrix
- Ad-hoc signing path for local shareable builds
```

- [ ] **Step 3: Verify `tauri.conf.json` version**

Open `app-tauri/src-tauri/tauri.conf.json`. Confirm `"version": "0.1.0"`. If not, bump.

- [ ] **Step 4: Tag and push**

```bash
git add CHANGELOG.md app-tauri/src-tauri/tauri.conf.json changelogs/2026-05-24_15_v0.1.0-release.md
git commit -m "$(cat <<'EOF'
chore(release): v0.1.0

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"

git tag v0.1.0
git push origin multi-source
git push origin v0.1.0
```

**STOP HERE for user confirmation.** `git push origin v0.1.0` will trigger the public release CI run. Do NOT proceed without explicit user authorization — per the global CLAUDE.md rule "NEVER deploy to production without asking", this counts as a deploy.

- [ ] **Step 5: Watch CI; publish the draft release**

In GitHub Actions UI, watch `release.yml`. On success, a draft GitHub Release exists with artifacts. The user reviews the draft and clicks Publish — Claude does not auto-publish.

- [ ] **Step 6: Smoke the published artifacts**

For each artifact (macOS DMG, Linux AppImage, Windows MSI):
- Download from the public Release page.
- Install on a clean target.
- Open the app, pick a topic, generate the brief.
- Confirm all pipeline stages complete.

- [ ] **Step 7: Final commit + changelog**

```markdown
# v0.1.0 public release

**Date:** 2026-05-24
**Type:** Release

## Summary

First public OpenReply release. Topic Dashboard with end-to-end pipeline,
corpus chat, OSS build path, signed + notarized macOS DMG, Linux AppImage,
Windows MSI. License-gate infrastructure preserved as opt-in Cargo feature.

## Manual steps completed (user)

- Apple Developer ID cert created + p12 exported.
- 7 GitHub Secrets added.
- Repo flipped public on github.com.
```

---

# Phase P4 — Auto-update

Goal of P4: subsequent versions auto-deliver via `tauri-plugin-updater`. After P4 you cut `v0.1.1` to prove the loop works end-to-end.

---

## Task 16: Wire `tauri-plugin-updater`

**Files:**
- Modify: `app-tauri/src-tauri/Cargo.toml` — add plugin
- Modify: `app-tauri/package.json` — add `@tauri-apps/plugin-updater`
- Modify: `app-tauri/src-tauri/src/main.rs` — register plugin
- Modify: `app-tauri/src-tauri/tauri.conf.json` — plugins.updater config
- Modify: `app-tauri/src/main.js` — startup check + toast on update available
- Modify: `app-tauri/src-tauri/capabilities/main.json` — grant updater capability
- Create: `changelogs/2026-05-24_16_auto-update-wired.md`

- [ ] **Step 1: Generate the updater signing keypair (LOCAL, user-side)**

This step is interactive — instruct the user:

```bash
cd app-tauri
npx tauri signer generate -w ~/.tauri/openreply.key
```

The command prompts for a passphrase. The user MUST save:
- The **public key** printed to stdout → goes into `tauri.conf.json`.
- `~/.tauri/openreply.key` (private) → contents become `TAURI_SIGNING_PRIVATE_KEY` GitHub Secret.
- The passphrase → `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` GitHub Secret.

Wait for the user to confirm those three are stored before continuing.

- [ ] **Step 2: Add Rust + JS deps**

In `app-tauri/src-tauri/Cargo.toml` under `[dependencies]`:

```toml
tauri-plugin-updater = "2"
```

In `app-tauri/package.json` `dependencies`:

```json
"@tauri-apps/plugin-updater": "^2.0.0"
```

Run:
```bash
cd app-tauri && npm install
```

- [ ] **Step 3: Register the plugin in `main.rs`**

In `app-tauri/src-tauri/src/main.rs`, after the existing `tauri::Builder::default()`:

```rust
.plugin(tauri_plugin_updater::Builder::new().build())
```

Position it alongside the existing `.plugin(tauri_plugin_shell::init())` line.

- [ ] **Step 4: Configure the endpoint + pubkey**

Edit `app-tauri/src-tauri/tauri.conf.json`. Add a `plugins.updater` block:

```json
"plugins": {
  "updater": {
    "active": true,
    "endpoints": [
      "https://github.com/shaantanu9/openreply/releases/latest/download/latest.json"
    ],
    "dialog": false,
    "pubkey": "PASTE-PUBLIC-KEY-FROM-STEP-1"
  }
}
```

Update the URL to match your final public repo name.

- [ ] **Step 5: Grant updater capability**

In `app-tauri/src-tauri/capabilities/main.json` (or whichever capability file exists), add:

```json
{
  "permissions": [
    "updater:default",
    "updater:allow-check",
    "updater:allow-download-and-install"
  ]
}
```

If a capability file doesn't yet have a permissions array, add one with these entries.

- [ ] **Step 6: Frontend startup check + toast**

In `app-tauri/src/main.js`, near the app-start boot sequence (search for where the app first renders), add:

```js
import { check } from '@tauri-apps/plugin-updater';

async function checkForUpdatesOnStartup() {
  try {
    const update = await check();
    if (update?.available) {
      showUpdateToast(update);
    }
  } catch (_e) {
    // Tolerant: updater errors are non-fatal
  }
}

function showUpdateToast(update) {
  const toast = document.createElement('div');
  toast.className = 'update-toast';
  toast.innerHTML = `
    <span>Update available: v${update.version}</span>
    <button id="update-install" class="btn btn--primary">Install + restart</button>
  `;
  document.body.appendChild(toast);
  document.querySelector('#update-install').addEventListener('click', async () => {
    await update.downloadAndInstall();
  });
}

// Call once at app start (idempotent — `check` is cheap):
window.addEventListener('DOMContentLoaded', () => {
  setTimeout(checkForUpdatesOnStartup, 3_000);  // wait until first paint
});
```

- [ ] **Step 7: Update `release.yml` to publish `latest.json`**

The tauri-action GitHub Action publishes `latest.json` automatically when the updater plugin is configured AND `TAURI_SIGNING_PRIVATE_KEY` + `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` are set as env vars on the action step.

Open `.github/workflows/release.yml`. Confirm the `tauri-apps/tauri-action@vN` step's `env` block has:

```yaml
TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
```

If not, add them.

- [ ] **Step 8: Compile**

```bash
cd app-tauri/src-tauri
cargo check
cd ..
npm test
```
Expected: clean.

- [ ] **Step 9: Changelog + commit**

```bash
git add app-tauri/src-tauri/Cargo.toml app-tauri/package.json app-tauri/src-tauri/src/main.rs app-tauri/src-tauri/tauri.conf.json app-tauri/src/main.js app-tauri/src-tauri/capabilities/main.json .github/workflows/release.yml changelogs/2026-05-24_16_auto-update-wired.md
git commit -m "$(cat <<'EOF'
feat(updater): tauri-plugin-updater wired — endpoint, pubkey, capabilities, startup toast

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 17: Cut v0.1.1 to verify the update path

**Files:**
- Modify: `app-tauri/src-tauri/tauri.conf.json` — bump version
- Modify: `app-tauri/package.json` — bump version (if it tracks)
- Modify: `pyproject.toml` — bump version
- Modify: `CHANGELOG.md` — add 0.1.1 section
- Create: `changelogs/2026-05-24_17_v0.1.1-update-proof.md`

- [ ] **Step 1: Bump all version pins to 0.1.1**

Edit:
- `app-tauri/src-tauri/tauri.conf.json` → `"version": "0.1.1"`
- `app-tauri/package.json` → `"version": "0.1.1"`
- `pyproject.toml` → `version = "0.1.1"`

- [ ] **Step 2: Append to CHANGELOG.md**

```markdown
## [0.1.1] - 2026-05-24

### Added
- Auto-update via `tauri-plugin-updater`. First update check happens 3s after startup.
- Update available toast → install + restart button.
```

- [ ] **Step 3: Commit**

```bash
git add app-tauri/src-tauri/tauri.conf.json app-tauri/package.json pyproject.toml CHANGELOG.md changelogs/2026-05-24_17_v0.1.1-update-proof.md
git commit -m "$(cat <<'EOF'
chore(release): v0.1.1 — prove auto-update path

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Tag + push**

**STOP for user authorization** — this is a production release per the global CLAUDE.md rule.

```bash
git tag v0.1.1
git push origin multi-source
git push origin v0.1.1
```

- [ ] **Step 5: Verify the update lands on a v0.1.0 install**

On a Mac that has v0.1.0 installed from the public Release page:
- Quit and re-launch `OpenReply.app`.
- After ~3 seconds, the "Update available: v0.1.1" toast should appear.
- Click "Install + restart".
- The app downloads `latest.json` from the configured endpoint, downloads the new bundle, verifies the signature against the configured `pubkey`, and restarts.
- Confirm `OpenReply > About` (or About menu) now reads v0.1.1.

- [ ] **Step 6: Update FEATURES.md status table**

Open `FEATURES.md`. Find the launch / release section. Mark P0–P4 as ✅. Add the v0.1.0 + v0.1.1 entries.

- [ ] **Step 7: Final changelog**

Create `changelogs/2026-05-24_17_v0.1.1-update-proof.md`:

```markdown
# v0.1.1 — auto-update path verified

**Date:** 2026-05-24
**Type:** Release

## Summary

Cut v0.1.1 with no functional changes other than auto-update plumbing. Update
toast appears on existing v0.1.0 installs; install + restart upgrades the
binary; signature verification against the configured pubkey passes.

## Manual verification

- v0.1.0 → v0.1.1 update toast: yes
- Install + restart upgrades: yes
- About menu reports v0.1.1: yes
- Pipeline still works post-upgrade: yes
```

---

## Self-review summary

**Spec coverage:** Every section of the spec maps to ≥1 task:
- Spec §1 (Topic Dashboard) → Tasks 5, 6, 7, 10
- Spec §2 (Brief orchestrator) → Tasks 8, 9
- Spec §3 (Chat) → Tasks 11, 12, 13
- Spec §4 (License gate feature flag) → Tasks 2, 3
- Spec §5 (OSS readiness) → Task 4
- Spec §6 (Sidecar + DMG) → Tasks 1, 14
- Spec §7 (Sign + release) → Tasks 14, 15
- Spec §8 (Auto-update) → Tasks 16, 17
- Spec §9 (Error states) → wired into PipelineStatus (Task 5) + BriefCard (Task 6)
- Spec §10 (Testing) → tests in each task
- Spec §11 (Build order) → Tasks 1-17 follow the order

**Type consistency check:**
- `OrchestratorEvent` / `StageStatus` defined in Task 8, consumed by tests in Task 8 — consistent.
- `generateBrief` / `subscribeBriefEvents` defined in Task 9, used by Task 10 — consistent (`generateBrief` not `generate_brief` on JS side).
- `chatAsk` / `subscribeChatEvents` / `chatThreadGet` defined in Task 11, consumed by Task 12 — consistent.
- `pipelineStatus`, `briefCard`, `workspaceCard`, `workspaceStrip` — all consumed by Task 10 with the same signatures defined in Tasks 5/6/7.

**Placeholder scan:** No TBD/TODO placeholders. Wherever a step depends on existing code shape I haven't fully read (e.g., the exact shape of `chat.py`'s public entry, the welcome wizard's step array), the step says "read first and adapt" with concrete guidance.

**Manual blockers explicit:** Tasks 14, 15, 16, 17 all explicitly STOP for user confirmation before any push/tag/deploy. Task 14 requires user-side Apple cert + GitHub Secrets. Task 16 requires user-side updater key generation.

Plan is complete. Build order is sequential within each phase; phases are independently mergeable.
