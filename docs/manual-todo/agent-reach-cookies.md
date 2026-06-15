# Reach Connections — per-source cookie / key setup

> One-time, per-user manual steps to unlock the Agent Reach sources. Most are
> done from the in-app **Connections** screen (sidebar). This file documents
> what each platform needs and the environment-variable alternatives.

## How the in-app flow works

1. Open **Connections** in the sidebar.
2. Click **Open login in browser** → sign into the platform in your system browser.
3. Click **Import from browser** → Gap Map extracts the session cookie from
   Chrome/Brave/Firefox/Safari and stores it locally (`source_credentials` table).
4. The badge flips to **Connected** after a live verify.
5. If auto-import fails (e.g. Chrome 127+ app-bound encryption), use **Paste
   cookie manually** — install the [Cookie-Editor](https://cookie-editor.com/)
   extension, copy the cookie value(s), paste, **Save**.

Nothing leaves the machine — credentials live in the local SQLite DB.

## Per-platform

- [ ] **Reddit** — cookie `reddit_session`. Unlocks full posts (score + comments)
      instead of titles-only RSS. Login: https://www.reddit.com/login
- [ ] **X / Twitter** — cookies `auth_token` + `ct0`. Enables the free bird search
      path. Login: https://x.com/login
- [ ] **Xiaohongshu (小红书)** — cookie `web_session`. Required (no anonymous path).
      Login: https://www.xiaohongshu.com
- [ ] **Xueqiu (雪球)** — optional cookie `xq_a_token` (works anonymously; cookie
      improves quota). Login: https://xueqiu.com
- [ ] **Bilibili** — optional cookie `SESSDATA` (search works without login).
      Login: https://www.bilibili.com
- [ ] **LinkedIn** — cookie `li_at` (stored for future deep-search; today it reads
      public URLs via Jina). Login: https://www.linkedin.com/login
- [ ] **Exa Search** — API key (not a cookie). Get a free key at
      https://dashboard.exa.ai/api-keys and paste it into the Exa card.

## Environment-variable alternatives (CI / headless)

- `REDDIT_PROXY` — route Reddit requests around server-IP 403s (e.g.
  `http://user:pass@host:port`). Applies to the cookie-JSON and RSS tiers.
- `BILIBILI_PROXY` — proxy for bilibili if risk-control 412s your IP.
- `EXA_API_KEY` — Exa key (used if no key is stored in Connections).

## CLI equivalents

```bash
gapmap creds list                                   # status of every source
gapmap creds import --source reddit                 # extract from browser + verify
gapmap creds save  --source xueqiu --value "xq_a_token=...; u=..."
gapmap creds save  --source exa_search --value exa_live_xxx
gapmap creds verify --source reddit
gapmap creds delete --source reddit
```

## Notes / future scope

- Credentials are stored unencrypted in the local app DB (same trust boundary as
  the rest of the local data). **Future hardening:** OS keychain (macOS Keychain /
  Tauri stronghold) + cookie encryption at rest.
- LinkedIn deep profile/company/job search needs the upstream `linkedin-scraper`
  MCP — out of scope for the current native reader.
- Xiaohongshu is heavily anti-bot (signed headers); even with a valid cookie the
  web search endpoint can reject requests — the source degrades to `[]` cleanly.
