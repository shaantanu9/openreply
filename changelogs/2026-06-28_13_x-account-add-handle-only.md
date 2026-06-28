# X account add — handle only, no token/CSRF prompt

**Date:** 2026-06-28
**Type:** UI Enhancement

## Summary

Adding an X/Twitter account on the **X Account** screen no longer asks for the
`auth_token` and `ct0` (CSRF) cookies. The user now types just the handle and
clicks Save. Cookies are resolved automatically: if the user is logged in to
x.com, the cookies are imported from the browser; otherwise the account is
stored with placeholder cookies, which the vendored bird client uses for
public-timeline reads. This matches the already-handle-only Watch screen and
removes a confusing manual step (most users never had the raw cookie values).

## Changes

- **Add form** (`renderXAccount` → `renderAddForm`): dropped the `auth_token`
  and `ct0` input fields; form is now a single Handle field with a hint that
  cookies auto-import. Save calls `api.xAccountAdd(handle)` with no cookie args
  and toasts "cookies imported" when the browser import succeeded.
- **CLI `x-account add`**: `auth_token` and `ct0` are now optional positional
  args (default `""`). When both are empty the command calls
  `import_browser_cookies()`; on success it stores the real cookies
  (`source: "browser"`), otherwise stores empty strings (`source: "public"`).
- **Rust `x_account_add`**: `auth_token`/`ct0` changed to `Option<String>`;
  cookie args are only forwarded to the CLI when both are present and non-empty.
- **JS `api.xAccountAdd`**: passes `authToken`/`ct0` as `null` when omitted.

## Verification

- `openreply x-account add paulg --json` → `ok: true`, `source: "public"`,
  stored with empty cookies.
- `openreply x-account fetch-posts paulg --count 3` → 3 real posts returned via
  the placeholder-cookie bird path.
- `cargo check` clean; `node --check` clean on `dynamic.js` and `api.js`.

## Files Modified

- `src/openreply/x_account/cli.py` — optional cookie args + browser auto-import.
- `app-tauri/src-tauri/src/commands.rs` — `x_account_add` cookies now optional.
- `app-tauri/src/or/api.js` — `xAccountAdd` sends null cookies when omitted.
- `app-tauri/src/or/dynamic.js` — handle-only add form + auto-import toast.
