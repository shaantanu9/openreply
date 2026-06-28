# X/Twitter Account Worktree (MVP)

A minimal, local-first X/Twitter account manager inside OpenReply / OpenReply. It stores account cookies in the same SQLite database the rest of the app uses, exposes a small CLI, and is wired into the Tauri desktop UI.

## What it does

1. **Store X accounts locally** (`x_accounts` table): handle, `auth_token`, `ct0` (CSRF), active flag, timestamps.
2. **Import cookies from the browser** so you don't have to paste `auth_token`/`ct0` manually.
3. **Fetch a profile** via the vendored `bird-search.mjs` Node client, falling back to Twitter's internal GraphQL `UserByScreenName` endpoint when real cookies are present.
4. **Fetch recent posts** via `bird-search.mjs` (`--user` mode), falling back to the internal GraphQL `UserTweets` endpoint.
5. **Fetch reply threads** via `bird-search.mjs` (`conversation_id:` search), falling back to the internal GraphQL `TweetDetail` endpoint.
6. **Surface everything** in the desktop app under **Account → X Account**.

## Files

```
src/openreply/x_account/
├── __init__.py
├── store.py      # SQLite CRUD
├── fetch.py      # Twitter GraphQL fetcher
└── cli.py        # Typer CLI

app-tauri/src-tauri/src/commands.rs   # Rust → CLI bridges
app-tauri/src-tauri/src/main.rs       # command registration
app-tauri/src/or/api.js               # JS API wrappers
app-tauri/src/or/dynamic.js           # X Account screen
app-tauri/src/or/shell.js             # sidebar nav item
```

## How auth works

X's internal web API requires two browser cookies from a logged-in session:

| Cookie | What it is | How to get it |
|---|---|---|
| `auth_token` | Session token | Log in to x.com → DevTools → Application → Cookies → `auth_token` |
| `ct0` | CSRF token | Same place; also sent as `X-Csrf-Token` header |

The fetcher also uses the public web bearer token that Twitter's own frontend uses.

### Fallback for missing / placeholder cookies

The fetcher first tries the vendored `bird-search.mjs` Node client. It only needs placeholder values in `AUTH_TOKEN`/`CT0` to reach many public timelines and conversation searches, so the flow works even when you haven't imported real browser cookies yet. If `bird-search.mjs` is unavailable (no Node) or fails, it falls back to direct X GraphQL calls using the stored real cookies.

> These credentials live only in your local SQLite database (`~/Library/Application Support/com.shantanu.openreply/openreply/openreply.db` on macOS). They are never sent anywhere except X's own API.

## CLI usage

All commands are available through the `openreply` CLI:

```bash
# Add an account manually
openreply x-account add <handle> <auth_token> <ct0>

# Import cookies from the default browser (no manual paste)
openreply x-account import-browser <handle>

# List stored accounts
openreply x-account list

# Remove an account
openreply x-account remove <handle>

# Fetch profile
openreply x-account profile <handle>

# Fetch recent posts
openreply x-account fetch-posts <handle> --count 10

# Fetch recent posts including reply threads
openreply x-account fetch-posts <handle> --count 10 --with-threads

# Fetch a conversation thread by tweet id or URL
openreply x-account fetch-thread <handle> <tweet_id_or_url> --limit 50
```

Example:

```bash
# Manual
openreply x-account add elonmusk abc123 xyz789

# Browser import (recommended on macOS)
openreply x-account import-browser elonmusk

openreply x-account profile elonmusk
openreply x-account fetch-posts elonmusk --count 5 --with-threads
openreply x-account fetch-thread elonmusk https://x.com/elonmusk/status/1234567890 --limit 30
```

> Every command also accepts a hidden `--json` flag. That flag is used by the Tauri Rust bridge and is safe to ignore when using the CLI directly.

## Tauri / GUI usage

The desktop app adds a sidebar item: **Account → X Account**.

The screen lets you:
- Add an account by pasting handle + `auth_token` + `ct0`.
- **Import from browser** to pull cookies automatically (Chrome/Brave/Edge/Firefox/Safari on macOS).
- See all stored accounts.
- Click an account to load its profile and last N posts.
- Toggle **Include reply threads** to also fetch threads for reply tweets.
- Paste a tweet URL/id and click **Fetch thread** to load a full conversation.

### Command triangle

```
UI (api.js)
  └─ invoke("x_account_add", ...)  →  Tauri Rust (commands.rs)
        └─ run_cli("x-account", "add", ...)  →  Python sidecar
              └─ src/openreply/x_account/cli.py
                    └─ SQLite / Twitter GraphQL
```

### Rust commands

```rust
x_account_add(handle, auth_token, ct0)
x_account_import_browser(handle)
x_account_list()
x_account_profile(handle)
x_account_fetch_posts(handle, count, with_threads)
x_account_fetch_thread(handle, tweet_id_or_url, limit)
```

### JS API methods

```js
api.xAccountAdd(handle, authToken, ct0)
api.xAccountImportBrowser(handle)
api.xAccountList()
api.xAccountProfile(handle)
api.xAccountFetchPosts(handle, count, withThreads)
api.xAccountFetchThread(handle, tweetIdOrUrl, limit)
```

## Data model

`x_accounts` table:

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PRIMARY KEY | auto |
| `handle` | TEXT UNIQUE | stored lowercase, `@` stripped |
| `auth_token` | TEXT | session cookie |
| `ct0` | TEXT | CSRF cookie |
| `active` | INTEGER | 1/0 |
| `created_at` | TEXT | ISO UTC |
| `updated_at` | TEXT | ISO UTC |

Account rows are masked when serialized (`auth_token` and `ct0` become `abcd***`).

## Twitter GraphQL details

Profile:

```
GET https://x.com/i/api/graphql/xc8f1g7BYqr6VTzTbvNlGw/UserByScreenName
Query params: variables={screen_name, withSafetyModeUserFields}, features={...}
Headers: Authorization: Bearer <token>, X-Csrf-Token: <ct0>, Cookie: auth_token=...; ct0=...
```

Posts:

```
GET https://x.com/i/api/graphql/E3opETHurmVJflFsUBVuUQ/UserTweets
Query params: variables={userId, count, ...}, features={...}
```

The fetcher extracts:
- Profile: `rest_id`, `name`, `description`, `followers_count`, `friends_count`, `statuses_count`, `verified`.
- Post: `id_str`, `full_text`, `favorite_count`, `retweet_count`, `reply_count`, `created_at`, plus reply/retweet flags and a reconstructed URL.

## Testing

### CLI

```bash
cd /Users/shantanubombatkar/Documents/GitHub/reddit-myind
source .venv/bin/activate

# add a test account
python -m openreply.cli.main x-account add testuser fake_token fake_ct0

# list
python -m openreply.cli.main x-account list

# remove
python -m openreply.cli.main x-account remove testuser
```

### Real account (requires valid cookies)

```bash
python -m openreply.cli.main x-account add <handle> <auth_token> <ct0>
python -m openreply.cli.main x-account profile <handle>
python -m openreply.cli.main x-account fetch-posts <handle> --count 5
```

### Tauri compile check

```bash
cd app-tauri/src-tauri
cargo check
```

## Verification

Verified end-to-end in the Tauri dev app (macOS):

1. `cargo check` and `cargo test` pass for `app-tauri/src-tauri`.
2. `npm run build` passes for the frontend.
3. `tauri dev` launches the app; the X Account sidebar item renders.
4. Adding an account via CLI makes it appear in the UI's "Stored accounts" list.
5. Clicking an account triggers `x_account_profile` + `x_account_fetch_posts` and renders the result.
6. The UI shows **Import from browser**, **Include reply threads**, and **Fetch thread** controls.
7. Fake/expired cookies fail gracefully with a 401 instead of crashing the UI.

Screenshots captured during verification:
- `/tmp/openreply-xaccount-v3.png` — X Account page after fixing `--json` support.
- `/tmp/openreply-xaccount-v8.png` — stored account loaded and profile fetched end-to-end.
- `/tmp/openreply-xaccount-v11.png` — full UI with import, thread toggle, and thread fetch controls.

## Known limitations (MVP)

- Cookie login only — no OAuth app flow yet.
- No automatic cookie refresh; when `auth_token` expires, re-import or re-paste cookies.
- Browser import works best on macOS with Chrome/Brave/Edge/Firefox/Safari; encrypted v20 Chrome cookies may require manual paste.
- Posts are not yet normalized into the shared `posts` table for ranking/opportunities.
- No scheduling or autopilot.

## Next steps

1. Normalize fetched tweets + threads into the canonical `posts` table so the rest of OpenReply (ranking, synthesis, opportunities) can consume them.
2. Add X posting via the existing `content_publish_x` publisher.
3. Wire into the Connections / Reach flow so X collection can be enabled per topic.
4. Add periodic background refresh of stored X accounts.
