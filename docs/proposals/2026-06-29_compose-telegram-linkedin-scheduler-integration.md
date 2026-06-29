# Compose + Telegram + LinkedIn + Scheduler Integration Plan

> Scope: extend the existing OpenReply Compose/content engine so a user can chat-style draft platform-native posts (especially LinkedIn), schedule them for multiple platforms, receive them in Telegram with action buttons, and copy/post directly from the notification.
>
> Author: Kimi Code (agent session)  
> Date: 2026-06-29  
> Branch target: `public-main`

---

## 1. Current state (what exists today)

| Component | File(s) | Status |
|---|---|---|
| Compose UI prototype | `prototype/compose.html` | Static HTML demo only; not wired to backend. |
| Content generation engine | `src/openreply/reply/content.py` | Generates `post`, `thread`, `script`, `youtube`, `article`, `followup_*`, `repurpose` from agent knowledge + corpus. |
| Content CLI | `src/openreply/cli/agent_cmds.py` (`content_app`) | `generate`, `update`, `list`, `delete` for `content_items`. |
| Platform catalog | `src/openreply/reply/platforms.py` | Lists LinkedIn, X, Reddit, etc. `can_reply=True`. |
| LinkedIn format hint | `src/openreply/reply/content.py:_PLATFORM_HINTS["linkedin"]` | LLM prompt adds “professional, short paragraphs with line breaks”. |
| Growth→drafts | `src/openreply/content/drafts.py` | Generates drafts from fetched posts; also has LinkedIn hint. |
| Telegram/Slack transport | `src/openreply/reply/notify.py` | `send_telegram`, `send_slack`, event toggles, multi-target support. |
| Two-way Telegram bot | `src/openreply/reply/bot.py` | Long-poll loop; handles `draft:`, `skip:`, `posted:`, `regen:` callback actions. |
| Opportunity scheduler | `src/openreply/reply/scheduler.py` | Auto-pilot: daily content + opportunity drafting; notifies via Telegram (`article` event). |
| Reply poster | `src/openreply/reply/poster.py` | `process_due()` fires queued replies; falls back to Telegram reminder. |
| X publisher | `src/openreply/publish/x.py` + `src/openreply/cli/publish_cmds.py` | Posts threads/tweets to X; records `remote_url` in `content_items`. |
| Content data model | `src/openreply/reply/schema.py` + `content.py` | `content_items` table with `status`, `scheduled_at`, `posted_at`, `platform`, `body`, etc. |

### Key gaps

1. **Telegram buttons are reply-opportunity only.** The formatters and bot actions know about `reply_opportunities`, not `content_items` (Compose drafts).
2. **No LinkedIn publisher.** Only X has a `publish/<platform>.py` adapter.
3. **No scheduled-content poster.** `content_items.scheduled_at` exists but nothing ticks it like `poster.process_due()` does for replies.
4. **No per-platform variants.** One draft body is used as-is; LinkedIn and X need different structures/lengths.
5. **No chat-style “draft me a LinkedIn post about X” surface.** The CLI exists but there is no conversational Telegram `/draft` command.
6. **No “Copy text” button in Telegram.** Users cannot one-tap copy a draft body from the notification.

---

## 2. Goal

A user can:

1. Type an angle or paste a source post (in app or Telegram).
2. Get a platform-native draft for **LinkedIn** (or X, Reddit, etc.) grounded in the agent’s knowledge.
3. Review/edit, then **schedule** it for one or more platforms.
4. Receive a Telegram notification with:
   - the draft preview,
   - platform label,
   - buttons: **Copy text**, **Mark posted**, **Reschedule**, **Regenerate**.
5. Have due scheduled posts either auto-publish (where a write adapter exists) or surface as a Telegram reminder.

---

## 3. Data-model changes

### 3.1 `content_items` additions

Add columns (idempotent migrations in `content.py:_ensure` and `schema.py`):

```python
"variants_json": str,   # {"linkedin": "...", "x": "..."}
"targets_json": str,    # ["linkedin", "x"] — platforms to publish to
"notify_sent": int,     # epoch of last Telegram notification
"error": str,           # last publish/schedule error
```

Existing columns remain: `id, agent_id, kind, platform, opportunity_id, parent_id, title, body, compliant, compliance_notes, status, scheduled_at, posted_at, remote_url, angle, created_at, updated_at`.

### 3.2 New table: `content_publish_log`

One row per publish attempt, mirroring the planned pattern in `SOCIAL_CONTENT_TOOL_PLAN.md`:

```sql
CREATE TABLE content_publish_log (
  id TEXT PRIMARY KEY,
  content_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  attempted_at INTEGER,
  status TEXT,            -- ok | error | skipped
  remote_id TEXT,
  remote_url TEXT,
  error TEXT,
  metrics_json TEXT
);
CREATE INDEX idx_content_publish_log_content ON content_publish_log(content_id);
```

This keeps `content_items` clean and lets us retry/idempotently post.

### 3.3 `reply_notify` events

Add an event toggle:

```python
"ev_content": 1   # notify on new/scheduled/due content items
```

Update `_EVENT_FLAG` and `get_config()`/`set_config()` in `notify.py`.

---

## 4. Backend implementation

### 4.1 LinkedIn publisher (`src/openreply/publish/linkedin.py`)

Auth:
- Store OAuth 2 user access token via `credentials.set_credential("linkedin_publish", {"access_token": ...}, kind="api_key")`.
- Requires `w_member_social` scope.

Core function:

```python
def publish(body: str, *, dry_run: bool = False) -> PublishResult
```

Implementation notes:
- Single post: `POST https://api.linkedin.com/v2/ugcPosts`
- Author URN: resolve from `https://api.linkedin.com/v2/me` or require user URN in creds.
- Body JSON:
  ```json
  {
    "author": "urn:li:person:<id>",
    "lifecycleState": "PUBLISHED",
    "specificContent": {
      "com.linkedin.ugc.ShareContent": {
        "shareCommentary": {"text": "<body>"},
        "shareMediaCategory": "NONE"
      }
    },
    "visibility": {"com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC"}
  }
  ```
- Handle 201 → return `remote_id`/`remote_url`.
- Add `plan(body)` for `--dry-run`.

### 4.2 Content generation variants

Extend `generate_content()` in `content.py`:

- If `platforms` is a list, generate one body per platform and store in `variants_json`.
- Default remains single-platform for backward compatibility.
- Use stronger per-platform prompts for LinkedIn (no hashtags, line breaks, professional) and X (≤280 chars per post).

Add helper:

```python
def generate_for_platforms(kind, platforms, angle, agent_id, provider) -> dict
```

Returns the content item with `variants_json` populated.

### 4.3 Scheduled-content poster

New module: `src/openreply/reply/content_poster.py`

```python
def due_content_items(now=None) -> list[dict]
def autopost_item(item: dict, platform: str) -> PublishResult
def process_due_content(now=None, notify=False) -> dict
```

Behavior:
1. Select `content_items WHERE status = 'scheduled' AND scheduled_at <= now`.
2. For each target platform:
   - If publisher exists and creds are present → publish → write `content_publish_log` → update `content_items` to `posted`/`remote_url`.
   - Else → send Telegram reminder with Copy/Mark-posted/Reschedule/Regenerate buttons (deduped by `content_id`).

### 4.4 Telegram formatters for content items

In `src/openreply/reply/notify.py`:

```python
def _fmt_content_item(item: dict, variant_platform: str | None = None) -> tuple[str, str, list]:
    platform = variant_platform or item.get("platform") or "post"
    body = item.get("body", "")
    if variant_platform and item.get("variants_json"):
        variants = json.loads(item["variants_json"])
        body = variants.get(variant_platform, body)
    title = item.get("title") or f"{item.get('kind','post')} · {platform}"
    tg = (
        f"📝 <b>{title}</b>\n"
        f"Platform: <b>{platform}</b>\n\n"
        f"<code>{body[:1200]}</code>"
    )
    cid = item.get("id", "")
    buttons = [
        {"text": "📋 Copy text", "data": f"copy:{cid}:{platform}"},
        {"text": "✅ Mark posted", "data": f"posted:{cid}:{platform}"},
        {"text": "🗓 Reschedule", "data": f"schedule:{cid}"},
        {"text": "🔄 Regenerate", "data": f"regen:{cid}"},
    ]
    return tg, body, buttons
```

Register under `_FORMATTERS["content_item"] = lambda p: _fmt_content_item(p["item"], p.get("platform"))`.

### 4.5 Telegram bot actions

In `src/openreply/reply/bot.py`, extend `_handle_action`:

- `copy:{cid}[:{platform}]` → reply with the body in a `<code>` block so the user can long-press copy. Include a toast “Copied to clipboard” (actual clipboard copy is frontend/Tauri).
- `posted:{cid}[:{platform}]` → set `content_items.status = 'posted'` and `posted_at = now`.
- `schedule:{cid}` → reply asking for a time, or set a default +1h schedule.
- `regen:{cid}` → call `content.generate_content` with the same kind/platform/angle and reply with the new draft.

### 4.6 Chat-style Telegram `/draft` command

Add command parsing in `bot.py` (currently it only handles `callback_query`):

```python
if message_text.startswith("/draft"):
    parts = message_text.split(None, 2)
    platform = parts[1] if len(parts) > 1 else "linkedin"
    angle = parts[2] if len(parts) > 2 else ""
    item = content.generate_content("post", platform=platform, angle=angle)
    tg, _, buttons = notify._fmt_content_item(item)
    _send(token, chat, tg, buttons)
```

Also support `/draft thread linkedin Why manual tagging fails`.

---

## 5. CLI additions

### 5.1 Content generation with variants

```bash
openreply content generate post --platform linkedin --angle "..."
openreply content generate post --platforms linkedin,x --angle "..."
```

### 5.2 LinkedIn publisher

```bash
openreply publish set-creds-linkedin --access-token <token> [--author-urn <urn>]
openreply publish linkedin --content-id <id> [--dry-run]
```

### 5.3 Scheduled-content tick

```bash
openreply content post-due [--notify]
```

Hook into existing scheduler alongside `reply post-due`.

### 5.4 Telegram bot command

Already exists: `openreply reply bot-poll`. After the changes it will additionally handle `/draft` and content-item callback actions.

---

## 6. Frontend / Tauri integration

### 6.1 Replace `prototype/compose.html` with a wired screen

- Call Tauri command `content_generate(kind, platform, angle)`.
- Show platform picker (LinkedIn, X, Reddit, etc.).
- Show draft editor + platform variant tabs.
- Add “Schedule” picker → calls `content_update(id, scheduled_at=...)`.
- Add “Publish now” → calls `publish_to_platform(id, platform)`.

### 6.2 Tauri commands to add

In `app-tauri/src-tauri/src/commands.rs` and `main.rs`:

```rust
content_generate, content_update, content_list, content_delete,
content_post_due, publish_linkedin, publish_x
```

Most can invoke the existing CLI via `run_cli_streaming` following the established triangle pattern.

---

## 7. Testing checklist

| Test | How |
|---|---|
| LinkedIn publisher dry-run | `openreply publish linkedin --content-id <id> --dry-run` returns planned body. |
| LinkedIn live post | With creds, post publishes and `content_publish_log` records remote URL. |
| Telegram content notification | Generate content; `notify.dispatch("content_item", {"item": item})` sends message with buttons. |
| Copy button | Tap → bot replies with body in `<code>` block. |
| Mark posted button | Tap → `content_items.status` becomes `posted`. |
| Regenerate button | Tap → new draft generated and sent back. |
| `/draft` command | `/draft linkedin Why folders fail` returns a LinkedIn draft. |
| Schedule tick | Set `scheduled_at` in past; run `content post-due`; item publishes or reminder fires. |
| Idempotency | Re-running `content post-due` does not duplicate posts (check `content_publish_log`). |

---

## 8. Migration / rollout

1. **Phase 0** (this doc): land plan in `public-main`.
2. **Phase 1**: LinkedIn publisher + creds CLI.
3. **Phase 2**: Telegram content-item formatter + bot actions (`copy`, `posted`, `regen`).
4. **Phase 3**: Scheduled-content poster (`content_poster.py`) wired into scheduler.
5. **Phase 4**: Per-platform variants + `/draft` chat command.
6. **Phase 5**: Wire `prototype/compose.html` (or app-tauri screen) to backend.

---

## 9. Risks and mitigations

| Risk | Mitigation |
|---|---|
| LinkedIn API approval lag | Apply for developer app early; use `--dry-run` until approved. |
| Telegram HTML parse errors | `notify.py` already retries as plain text; keep that path. |
| Duplicate scheduled posts | Enforce idempotency via `content_publish_log` (unique on `content_id, platform, status='ok'`). |
| One draft body used for all platforms | Introduce `variants_json` and generate per-platform. |
| Bot poll missing commands | Currently only handles `callback_query`; extend to `message.text` for `/draft`. |

---

## 10. Files to touch

### New files
- `src/openreply/publish/linkedin.py`
- `src/openreply/reply/content_poster.py`
- `docs/proposals/2026-06-29_compose-telegram-linkedin-scheduler-integration.md` (this file)

### Modified files
- `src/openreply/reply/content.py` — variants, generation helpers
- `src/openreply/reply/notify.py` — `ev_content`, `_fmt_content_item`
- `src/openreply/reply/bot.py` — content actions, `/draft` command
- `src/openreply/reply/schema.py` — new columns + `content_publish_log`
- `src/openreply/reply/scheduler.py` — call `content_poster.process_due_content`
- `src/openreply/cli/agent_cmds.py` — `--platforms`, `/draft` exposure
- `src/openreply/cli/publish_cmds.py` — LinkedIn creds + publish command
- `src/openreply/cli/reply_cmds.py` — `content-post-due` command
- `src/openreply/publish/base.py` — add `reply_to_*` is X-specific; keep generic
- `prototype/compose.html` or `app-tauri/src/` — wired composer screen
- Tests: `tests/test_content_drafts.py`, new `tests/test_publish_linkedin.py`, `tests/test_telegram_company_mode.py`

---

## 11. Related docs

- `SOCIAL_CONTENT_TOOL_PLAN.md` — broader social-content fork plan
- `docs/architecture/TAURI_AND_FETCH_ARCHITECTURE.md` — Tauri↔Python command triangle
- `src/openreply/reply/platforms.py` — platform catalog
- `src/openreply/publish/x.py` — publisher pattern to copy
