# Manual TODO — things that can't be automated

Tasks here require human action: Apple/GitHub dashboard clicks, account
creation, real-device testing, credential uploads. Each file is a markdown
checklist. When every box in a file is ticked, move the file to `done/`.

## Index

| File | What it covers |
|---|---|
| [`future-scope-signing-and-secrets.md`](./future-scope-signing-and-secrets.md) | **Deferred for the v0.1.0 unsigned beta** — `JWT_DESKTOP_SECRET`, Developer ID cert + notarization, auto-update. What each is, why it was deferred, what's degraded without it, and the upgrade path to a signed 1.0. |
| [`publish-macos.md`](./publish-macos.md) | Step-by-step *how* to create the Developer ID cert, export the `.p12`, add the GitHub Actions secrets, smoke-test, and push the release tag. |
| [`launch-day.md`](./launch-day.md) | Release-day run-through checklist. |
| [`tauri-improvements.md`](./tauri-improvements.md) | Outstanding Tauri desktop-app polish items. |
| [`mcp-future-scope.md`](./mcp-future-scope.md) | MCP server future-scope ideas. |
| [`future-scope-bundled-local-llm.md`](./future-scope-bundled-local-llm.md) | Future scope — bundling a local LLM. |
| [`phase7-pdf-export.md`](./phase7-pdf-export.md) | PDF-export phase follow-ups. |

## Status (2026-05-17)

The v0.1.0 launch is an **unsigned macOS beta**. The launch-blocking manual
items (Developer ID cert, `JWT_DESKTOP_SECRET` in GitHub Secrets, auto-update)
are intentionally deferred — see `future-scope-signing-and-secrets.md` for the
why and the upgrade path. Nothing in that file blocks an unsigned beta.
