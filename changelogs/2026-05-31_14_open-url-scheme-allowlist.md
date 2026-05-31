# open_url: allow only web/mail schemes (block file:// / javascript: / custom)

**Date:** 2026-05-31
**Type:** Fix (security)

## Summary

The `open_url` Tauri command passed its `url` straight to the OS opener
(`open` / `xdg-open` / `cmd start`) with no validation. A malicious link in
rendered markdown (LLM output, collected posts/papers) could therefore pass
`file:///…` (open an arbitrary local file/app), `javascript:`, or a custom
scheme handler to the shell-out. Paired with the markdown-render XSS hardening
(changelog `_11`), this closes the link-handling surface.

## Change
`app-tauri/src-tauri/src/commands.rs::open_url` now allowlists schemes —
`https://`, `http://`, `mailto:` — and returns a clear error for anything else,
before spawning the opener.

## Files Modified
- `app-tauri/src-tauri/src/commands.rs` — scheme allowlist in `open_url`.

## Verification
- `cargo check` — 0 errors.

## Notes
Done in an isolated worktree off `multi-source`; it only modifies the existing
`open_url` body (no `main.rs` registration change), in a region the concurrent
`feat/merge-topics` session isn't editing — so it merges cleanly.

The other two backlog items remain blocked by that session: **Task-Manager
cancel wiring** and the **perf native-rusqlite/SWR sweep** both add new commands
(new `main.rs` `generate_handler!` lines that collide with the session's
in-flight MCP command), and the perf sweep is a multi-pass effort. They'll be
done once `feat/merge-topics` lands its `commands.rs`/`main.rs` changes.
