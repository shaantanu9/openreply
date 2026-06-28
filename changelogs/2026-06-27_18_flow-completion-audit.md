# User-journey audit + flow completion (Queue, Agents, Pricing, onboarding)

**Date:** 2026-06-27
**Type:** Fix + Feature

## Summary

Audited the entire OpenReply user journey and all ~18 screens (first-run gate →
activation → onboarding → agents → overview → engagement + intelligence + account
screens) via a three-way parallel audit. Result: **command triangle is 100% wired
(zero dead UI calls across 73)** and onboarding has **no P0 blockers**. Fixed the real
gaps the audit surfaced — a read-only Queue, missing agent edit/delete, dead Pricing
buttons, and onboarding clarity.

## Changes

- **Queue — completed (was read-only, no error handling).** `renderQueue` now has a
  loading/error/empty/data state with **Retry**, and per-item actions: **Edit** (inline
  modal → save body), **Mark posted / Back to draft** (status transition), and **Delete**
  (confirm). Added the backing `delete_content` (`reply/content.py`), `content delete`
  CLI, `content_delete` Rust command + JS `contentDelete`.
- **Agents — added Edit + Delete.** Each agent card gets **Edit** (make active → open the
  Keywords editor) and **Delete** (confirm → `agent_delete`). Added the `agent_delete`
  Rust command (CLI `agent delete` already existed) + JS `agentDelete`.
- **Pricing — wired (was static `views.js` with dead "Upgrade" buttons).** New live
  `renderPricing`: reads `licenseStatus` to badge the user's **current plan**, and wires
  hosted-tier buttons to open the hosted site via `openUrl` (honest — no fake checkout;
  self-host stays free/no-caps per the product ethos). Registered `pricing` in the `DYN`
  route map so it overrides the static prototype.
- **Onboarding clarity.** Welcome marks the API-key field **"· required to finish"** (non-
  Ollama) and labels Test connection **"(optional)"**. Overview shows a **fresh-agent
  banner** guiding a new user to "↻ Refresh + learn" then "Find opportunities" when the
  agent has no knowledge yet.

## Verification

- `content.py` + `agent_cmds.py` parse; CLI `content delete` / `agent delete` return
  graceful JSON for a missing id.
- `vite build` passes (230 KB).
- `cargo check`: new `content_delete` / `agent_delete` mirror the existing `content_update`
  pattern. (Build currently blocked by the pre-existing environmental
  `binaries/openreply-cli-onedir/**/*` glob — the bundled sidecar isn't present in this dev
  checkout — unrelated to these changes.)

## Files Created

- `docs/superpowers/specs/` audit not separately specced; see changelog.

## Files Modified

- `src/openreply/reply/content.py` (`delete_content`), `cli/agent_cmds.py` (`content delete`).
- `app-tauri/src-tauri/src/commands.rs` + `main.rs` (`content_delete`, `agent_delete`).
- `app-tauri/src/or/api.js` (`contentDelete`, `agentDelete`).
- `app-tauri/src/or/dynamic.js` (`renderQueue` rewrite, agent Edit/Delete, `renderPricing`,
  Welcome required/optional labels, Overview fresh-agent banner; `pricing` in `DYN`).

## Audit findings — deferred (P2 polish, non-blocking)

- Keywords save button has no "saving…" spinner.
- Inline agent-create shows no explicit success toast (form just hides).
- Collected `or-user-name` isn't displayed anywhere (sidebar footer is collaborator-active;
  left untouched to avoid collision).
- Compose lacks field-level validation; browser-mode degradation message is terse.

## Follow-up

- Prod sidecar rebuild before a DMG so the new `content delete` / `agent delete` CLI ship.
