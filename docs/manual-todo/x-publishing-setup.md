# X (Twitter) Publishing — manual setup

The Compose **𝕏 Publish** button and `openreply publish x` post real tweets/threads
via the X API v2. Code is built and working; it only needs **your** X API write
credentials (one-time, can't be automated — it requires a developer account).

## What you need (4 values)

From an X (Twitter) developer app with **Read and Write** permission:

- [ ] `api_key` (a.k.a. consumer key / API key)
- [ ] `api_secret` (consumer secret / API key secret)
- [ ] `access_token` (user access token — must be regenerated **after** setting
      the app to Read **and** Write)
- [ ] `access_secret` (access token secret)

## Steps

1. [ ] Go to <https://developer.x.com/en/portal/dashboard> → create a Project + App
       (Free tier allows posting).
2. [ ] App settings → **User authentication settings** → set App permissions to
       **Read and Write**. Save.
3. [ ] Keys and tokens tab → copy **API Key** + **API Key Secret**.
4. [ ] **Regenerate** the **Access Token and Secret** (the old one is read-only if
       generated before step 2) → copy both.
5. [ ] Store them (CLI):
   ```bash
   openreply publish set-creds \
     --api-key YOUR_API_KEY \
     --api-secret YOUR_API_SECRET \
     --access-token YOUR_ACCESS_TOKEN \
     --access-secret YOUR_ACCESS_SECRET
   ```
   (or, once the Settings → "Connect X" form is added, paste them there)
6. [ ] Verify: `openreply publish status` → `{"x": true}`.

## Using it

- **Preview first (no post):** `openreply publish x --content-id <id> --dry-run`
  shows exactly which tweets will go out (threads split on blank lines, each
  wrapped to 280 chars).
- **Post:** the **𝕏 Publish** button on any X content card in Compose, or
  `openreply publish x --content-id <id>`. On success the draft flips to `posted`
  and its tweet URL is recorded.

## Notes / gotchas

- Credentials are stored locally in `source_credentials["x_publish"]` (same
  encrypted-at-rest local DB as other connections) — never leave the machine.
- The **most common failure is a 403** = the access token was generated while the
  app was still Read-only. Fix: set Read+Write (step 2), then **regenerate** the
  access token (step 4).
- Free tier has a monthly post cap; heavy threading can hit it.
- Nothing posts without credentials present — `publish x` returns a structured
  "no X credentials" error, never a partial post.

## Future scope

- [ ] Settings → "Connect X" credential form (UI for `set-creds`, mirrors the
      Connections screen pattern).
- [ ] LinkedIn / Threads / Bluesky publish adapters (same `publish/<platform>.py`
      contract — X is the reference implementation).
