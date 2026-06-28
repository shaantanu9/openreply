# Manual TODO — things that can't be automated

Tasks here require human action: Apple/GitHub dashboard clicks, account
creation, real-device testing, credential uploads. Each file is a markdown
checklist. When every box in a file is ticked, move the file to `done/`.

## Index

| File | What it covers |
|---|---|
| [`publish-macos.md`](./publish-macos.md) | Step-by-step *how* to create the Developer ID cert, export the `.p12`, add the GitHub Actions secrets, smoke-test, and push the release tag. |
| [`launch-day.md`](./launch-day.md) | Release-day run-through checklist. |
| [`tauri-improvements.md`](./tauri-improvements.md) | Outstanding Tauri desktop-app polish items. |
| [`mcp-future-scope.md`](./mcp-future-scope.md) | MCP server future-scope ideas. |
| [`future-scope-bundled-local-llm.md`](./future-scope-bundled-local-llm.md) | Future scope — bundling a local LLM. |
| [`phase7-pdf-export.md`](./phase7-pdf-export.md) | PDF-export phase follow-ups. |

## Status

Release signing and notarization are optional for local/unsigned builds. See
`publish-macos.md` for the full signed-release checklist.
