# Onboarding resilience: test timeout, working skip, stepped loading UI

**Date:** 2026-07-02
**Type:** Fix / UI Enhancement

## Summary

On a fresh install the onboarding "Connect your AI" step could sit on "Testing…"
indefinitely (the NVIDIA/OpenAI-compatible provider timeout is 300s and the
first sidecar spawn is slow), the "Skip — explore the app first" button appeared
to do nothing, and agent creation / URL fetch showed no progress so slow calls
read as a frozen app. This makes onboarding never appear stuck and gives every
slow op a clear stepped progress line.

## Changes

- **Test connection can't hang:** the onboarding test now races `testLlm`
  against a 60s timeout with a first-run "warming up the engine" hint at 4s, and
  on timeout tells the user their key is saved and they can Continue anyway.
- **Skip actually works:** the router (`main.js` gateCheck) forces the welcome
  wizard until `localStorage.or-onboarded` is set. Both the ready-screen exits
  ("Create my first agent" → `#/agents`, "Skip — explore" → `#/`) now set that
  flag before navigating, and a new "Skip for now" link on the AI step lets a
  user escape a slow/failed test.
- **Stepped loading UI:** added `withTimeout()` + `stepLine()` helpers.
  - URL fetch shows `Fetching page → AI reviewing → Filling form` (90s cap).
  - Agent creation shows `Saving agent → Registering knowledge scope → Ready`
    (60s cap), with the button disabled while in flight.

## Root cause notes

- The LLM key **does** save correctly (`~/.config/openreply/.env`) and the
  backend `test-llm` works in ~600ms — verified. The perceived "not working /
  hanging" on a fresh DMG install is the macOS Gatekeeper quarantine scan of the
  ad-hoc-signed bundled sidecar on first spawn (fix: notarize, or
  `xattr -dr com.apple.quarantine OpenReply.app`). These UI changes ensure the
  app degrades gracefully instead of appearing frozen.

## Files Modified

- `app-tauri/src/or/dynamic.js` — onboarding test timeout + skip flag + AI-step
  skip link; `withTimeout()`/`stepLine()`; stepped `runUrlFetch` + `createAgent`.
