# Production-audit fixes: markdown XSS, version sync, centralized repo-URL constant

**Date:** 2026-05-31
**Type:** Fix (security + release hygiene) / Refactor

## Summary

First wave of fixes from the full-app production audit. Three verified, isolated
issues fixed; the rest are triaged into a prioritized backlog (separate).

## Changes

### 1. Markdown XSS in topic report rendering (P1 security)
`topic.js::inlineMd` rendered untrusted text (LLM output + collected
posts/papers) as HTML with **no escaping** and injected link `href` **unescaped
+ no scheme check** — so `[x](javascript:…)` or a stray `<img onerror>` in
collected content would execute. Now: `esc()` the input first, and allow only
`http(s)`/`asset`/`mailto` link schemes (otherwise render the label as plain
text). Matches the escaping already used for post-link anchors elsewhere in the
file.

### 2. Version drift (P0 release)
`pyproject.toml` was `0.1.0` while `package.json` / `Cargo.toml` /
`tauri.conf.json` were `0.1.7`. Bumped pyproject to `0.1.7` so the wheel /
sidecar `--version` / CI artifact naming match the app.

### 3. Stale repo URL → single source of truth (P2 + the user's "fix from one place")
The old fork URL `github.com/shaantanu98/reddit-myind` was hardcoded in three
files (OpenRouter `HTTP-Referer`, polite-API `User-Agent`, exported-report
footer). Created **`src/openreply/core/identity.py`** as the single source of truth
(`GITHUB_URL`, `GITHUB_ORG/REPO`, `DOCS_METHODOLOGY_URL`, `HOMEPAGE_URL`,
`CONTACT_EMAIL`). `chat.py` (HTTP-Referer) and `_http.py` (User-Agent) now import
`GITHUB_URL`; the export footer is corrected to `myind-ai/openreply` (left inline —
it's inside a large d3/CSS HTML template where f-string interpolation is unsafe).
Rebrand/fork now = edit `core/identity.py` once.

## Files Created
- `src/openreply/core/identity.py` — project-identity single source of truth.

## Files Modified
- `app-tauri/src/screens/topic.js` — `inlineMd` escapes input + scheme-validates links.
- `pyproject.toml` — version 0.1.0 → 0.1.7.
- `src/openreply/sources/_http.py` — `USER_AGENT` from `core.identity`.
- `src/openreply/research/chat.py` — `HTTP-Referer` from `core.identity`.
- `src/openreply/graph/export.py` — footer URL → `myind-ai/openreply`.

## Verification
- `node --check topic.js` clean; `npm run build` succeeds.
- `core.identity` imports clean; `USER_AGENT` resolves to the canonical URL.
- `py_compile` clean on all changed Python.

## Backlog (audit findings NOT in this commit — prioritized for follow-up)
- **P0 release:** Intel (x86_64) sidecar binary is stale (missing sklearn +
  teach-from-video + crash-safe worker) — needs a cross-build (CI).
- **P0 release:** `preflight-release.sh` doesn't validate `pyproject.toml` version.
- **P1 security:** CSP `unsafe-inline` (script-src/style-src); `open_url` scheme
  allowlist.
- **P1 robustness:** extraction-worker `RSS_CEILING_MB=600` OOM → "gave up";
  remaining unguarded post-await DOM writes in a few screens.
- **P1 half-done:** Task Manager cancel buttons are stubbed (`alert("not wired")`).
- **P1 perf:** native-rusqlite + screen-cache partial adoption (several read
  commands still daemon round-trip; ~screens missing SWR persist).
