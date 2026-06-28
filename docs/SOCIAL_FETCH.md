# Social Media Fetch — How Content & Posts Are Pulled

> How OpenReply fetches content ideas and posts from every social platform:
> the mechanism, the credential, the endpoint, what comes back, the cost, and
> how it lands in the `posts` table. Read this to understand (or extend) any
> social source.

## The pipeline in one picture

```
Connections UI (paste key / cookie / app-password)
      │  creds_save_manual / creds_toggle  (Tauri command → CLI)
      ▼
source_credentials  (local SQLite — cookie_json, kind, enabled)
      │  credentials.api_key() / cookie_header() / get_credential()
      ▼
sources/<platform>.py  fetch_<platform>(query, limit) ──► list[dict] (canonical post rows)
      │  collect_adapter.run_<platform>()  → upsert_posts() + topic_posts tag
      ▼
posts table  ──►  ranking (RRF) ──► Opportunities / Overview in the app
```

A source runs in a collect when its name is in the run's source list. That list is
**default sweep + connected social sources** (see "Connect = enabled" below), or an
explicit `--sources` flag.

## Credential model

`source_credentials` (one row per source) stores everything locally — never sent
anywhere but the platform's own API. `kind` drives the Connections card:

| kind | UI card | stored as | example sources |
|---|---|---|---|
| `cookie` | browser login + import / paste-cookie | `{name: value, …}` cookie map | reddit, twitter, linkedin, xiaohongshu, xueqiu, bilibili |
| `api_key` | single key field | `{"api_key": "…"}` | scrapecreators, truthsocial, exa_search |
| `login_pair` | two fields | `{"handle": "…", "app_password": "…"}` | bluesky |
| `public` | "Test reach" only | (no secret; a marker row only if you mute it) | hackernews, devto, mastodon, youtube |

Every adapter resolves its credential from this store **first**, then falls back to
an env var — so a key pasted in the UI works without restarting the sidecar.

## Connect = enabled

When you connect (and verify) a platform, it's automatically added to your collection
runs. Mute any source with the **"Used in collection"** toggle on its card
(`creds toggle --source X --disabled`). Mechanics:
`reach_connections.connected_collection_sources()` returns the dispatchable
source-names for every connection that is connected + enabled, expanded via its
`unlocks` map. `collect.py` appends them to the default sweep (only when you didn't
pin an explicit `--sources`).

## Per-platform reference

| Platform | Mechanism | Credential | Endpoint | Returns | Cost |
|---|---|---|---|---|---|
| **X / Twitter** | cookie/bird → xAI → xquik fallback chain | `twitter` cookie (auth_token+ct0) **or** `XAI_API_KEY`/`XQUIK_API_KEY` | x.com GraphQL / api.x.ai / xquik | posts | free (cookie) / paid (API) |
| **TikTok** | ScrapeCreators REST | `scrapecreators` api_key | api.scrapecreators.com/v*/tiktok/* | posts | 100 free credits → PAYG |
| **Instagram** | ScrapeCreators REST | `scrapecreators` api_key | …/instagram/* | posts | shared SC key |
| **Threads** | ScrapeCreators REST | `scrapecreators` api_key | …/threads/* | posts | shared SC key |
| **Pinterest** | ScrapeCreators REST | `scrapecreators` api_key | …/pinterest/* | pins | shared SC key |
| **YouTube** | yt-dlp search → comments + transcript (API v3 fallback) | none (`YOUTUBE_API_KEY` optional) | ytsearch / Data API v3 | video comments + transcript chunks | free |
| **Bluesky** | AT Protocol authed search | `bluesky` login_pair (handle + app-password) | bsky.social/xrpc searchPosts | posts | free |
| **Mastodon** | public hashtag search | none | instance `/api/v2/search` | posts | free |
| **TruthSocial** | Mastodon-compatible API | `truthsocial` api_key (bearer token) | truthsocial.com/api/v2/search | statuses | free (token) |
| **Bilibili** | public API | none (optional `BILIBILI_PROXY`) | api.bilibili.com | videos | free |
| **Xiaohongshu** | signed web API | `xiaohongshu` cookie (web_session) | xiaohongshu.com web API | notes | free (cookie) |
| **LinkedIn** | Jina Reader (URL-only, not topic-search) | optional `linkedin` cookie (li_at) | r.jina.ai/{url} | page text | free |

> **Server vs desktop:** cookie/binary paths (X via *bird*, yt-dlp, xiaohongshu local
> server) only work in this **desktop** app. API-key paths (ScrapeCreators, xAI/xquik,
> TruthSocial, Bluesky) also port to web/edge — see
> `fintech_repos/last30days-skill/docs/WEB_AND_EDGE_GUIDE.md`.

## Canonical post row

Every adapter normalizes into the shared `posts` shape so ranking treats all sources
uniformly:

```
id, sub, source_type, author, title, selftext, url,
score, upvote_ratio, num_comments, created_utc,
is_self, over_18, flair, permalink, fetched_at
```

`source_type` is the platform name; `score`/`num_comments` map to the platform's
likes/replies so engagement-weighted RRF ranking works across sources.

## Verify a source end-to-end

```bash
# 1. Connect (or paste) a credential, then live-test it:
openreply creds verify --source scrapecreators --json   # → {"connected": true, "message": "OK — 3 rows"}

# 2. Confirm it's in the run set:
openreply creds toggle --source bluesky --enabled --json

# 3. Run a collect and confirm rows land:
openreply collect "your topic"        # connected social sources auto-included
```

## Extending — adding a new social source

1. `sources/<x>.py` → `fetch_<x>(query, limit) -> list[dict]` (canonical rows), reading
   its credential from `credentials` first, env fallback.
2. `sources/collect_adapter.py` → `run_<x>()` + register in the `SOURCES` dispatch map.
3. `reach_connections.GATED` → add an entry (`kind`, `query` probe, `unlocks`, `note`);
   add a `_live_check` branch.
4. That's it — the Connections UI, toggle, verify, and auto-include all work generically.
