# MCP activation gate: specific reason codes for every failure mode

**Date:** 2026-04-24
**Type:** Fix / UX

## Summary

MCP tools (Claude Code / Desktop / Cursor / Windsurf / Cline integration)
were silently refusing to connect with a single generic "MCP is locked
until this device is activated" message, regardless of whether the device
had never been activated, the licence had expired, the device fingerprint
had drifted, the access token was missing, or the stored licence was for
a different machine. Users reported they "can't tell why MCP isn't
working." This change introduces five stable reason codes that flow from
the Rust gate through `license_status` and any gated Tauri command, and
the Settings → MCP card renders a case-specific banner + CTA for each.

## Reason codes

Stable, documented on the Rust side and consumed by the UI:

| Code                    | Meaning                                                                      |
|-------------------------|------------------------------------------------------------------------------|
| `not_activated`         | No licence state persisted (first-time user).                                |
| `device_mismatch`       | Stored licence is for a different device signature.                          |
| `token_missing`         | Licence state exists but access-token blob is empty / keychain was cleared.  |
| `expired`               | `expires_at` is in the past.                                                 |
| `token_device_mismatch` | JWT's `device_fingerprint` claim no longer matches this device.              |

Rust emits errors as `[mcp:<code>] <human-readable message>` so the UI can
parse them at callsites other than `license_status`.

## Changes

- **Rust:** Added `compute_activation_reason(app)` → `Result<Option<(String, String)>, String>` in `commands.rs`. Single source of truth for "is this device activated?" + "if not, why not?"
- **Rust:** `ensure_mcp_allowed` rewritten to call the helper and emit `[mcp:<code>] <message>` on failure. All 4 gated Tauri commands (`mcp_clients / mcp_status / mcp_install / mcp_uninstall`) now return specific reasons instead of the one generic string.
- **Rust:** `license_status` now returns `reason_code` + `reason` fields whenever `activated=false`, so the UI can render per-case messaging without needing a round-trip through an error.
- **UI:** `settings.js` replaces the one-size-fits-all `renderActivationGate()` with a `GATE_COPY` table keyed by reason code. Each entry has a badge, heading, body, and a CTA button pointing at the right recovery route:
  - `not_activated` → "Activate this device"
  - `device_mismatch` → "Re-activate this device" (move licence here)
  - `token_missing` → "Refresh activation"
  - `expired` → "Renew & re-activate" (with the actual expiry date inlined from the backend message)
  - `token_device_mismatch` → "Re-activate this device"
- **UI:** Added `parseMcpReason(err)` helper that extracts `[mcp:<code>]` from thrown errors. `refresh()` and `runWith()` now call `renderActivationGate(code, msg)` when a gated error surfaces mid-session (e.g. licence expired while the card was open), instead of the raw "unable to read status" text.
- **UI:** Initial `license_status` probe also passes `reason_code` + `reason` through so first render already picks the right banner.

## Files Created

- `changelogs/2026-04-24_06_mcp-activation-reason-codes.md` (this file)

## Files Modified

- `app-tauri/src-tauri/src/commands.rs` — added `compute_activation_reason`, rewrote `ensure_mcp_allowed`, enriched `license_status` return shape.
- `app-tauri/src/screens/settings.js` — added `GATE_COPY` table, rewrote `renderActivationGate(reason_code, reason)` to render per-case banners with CTAs, added `parseMcpReason` error parser, wired `refresh()` + `runWith()` + initial probe through the parser.

## Verification

1. `cd app-tauri/src-tauri && cargo check` → compiles clean.
2. `node --check app-tauri/src/screens/settings.js` — pre-existing import naming warning in the file (predates this change); not introduced here.
3. Manual matrix — in the desktop app, open **Settings → Use with an MCP client** for each scenario:
   - **Never activated** → "Not activated" badge, CTA "Activate this device".
   - **Activated on another machine first (copied the user-data folder)** → "Different device" badge, CTA "Re-activate this device".
   - **Deleted the keychain token via macOS Keychain Access** → "Token missing" badge.
   - **Manually edit `expires_at` to a past date in the state file** → "Expired" badge, body includes the actual date.
   - **Change hostname and restart** → "Device fingerprint changed" badge.
4. API shape: `invoke('license_status')` now returns `{activated, reason_code, reason, email?, license_id?, expires_at?, …}` when not activated (previously only `{activated, device_signature}`).

## Not in scope

- Automatic re-activation retry (e.g. silently refresh the token when `token_device_mismatch` fires on a benign hostname change). Any change that mints a new token needs user confirmation — this pass only surfaces the precise reason.
- Pushing the same reason codes into the MCP installer's Python-side failure envelopes. The Rust gate short-circuits before the Python helper runs, so that's unreachable today; worth revisiting if we ever move the gate to the Python side.
