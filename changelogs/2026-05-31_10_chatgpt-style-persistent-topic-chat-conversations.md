# ChatGPT-style persistent topic chat conversations

**Date:** 2026-05-31
**Type:** Feature

## Summary

The topic **Chat** tab previously kept a single rolling conversation per topic
in `localStorage`, capped at the last 50 messages, with no way to revisit older
chats — once you hit Clear or started a new line of questioning, the previous
thread was gone. This adds ChatGPT-style saved conversations: a per-topic
conversation rail with multiple named threads, durable in SQLite (no 50-message
cap), each auto-titled from its first message and renameable/deletable. Existing
`localStorage` chats are migrated automatically on first open.

Storage uses a new native read-write rusqlite path (no Python sidecar spawn on
the hot path). The schema is a single `chat_conversations` table storing each
thread's message array as a JSON blob — matching the UI's in-memory
`chatHistory` shape, which avoids per-token row churn during streaming. The
backend list command already supports `topic = NULL` (every conversation across
all topics) so a future global "Chats" view is a thin UI add.

## Changes

- **Schema** (`chat_conversations`): `id, topic, title, messages_json,
  msg_count, created_at, updated_at`, indexed on `(topic, updated_at)` and
  `(updated_at)`. Pre-created in Python `init_schema` and guarded with
  `CREATE TABLE IF NOT EXISTS` on the Rust side.
- **Native Rust read-write path** (`db.rs`): new `open_rw` (WAL + 2s
  busy_timeout) + `chat_ensure_schema` + `chat_conv_list` / `chat_conv_get` /
  `chat_conv_save` (upsert, derives `msg_count`) / `chat_conv_rename` /
  `chat_conv_delete`. The rest of `db.rs` stays read-only; chat tables are new
  and untouched by Python, so Rust safely owns these writes.
- **Tauri commands** (`commands.rs` + `main.rs`): `chat_conv_list`,
  `chat_conv_get`, `chat_conv_save`, `chat_conv_rename`, `chat_conv_delete`,
  registered in `generate_handler!`.
- **api.js**: `chatConvList(topic=null)`, `chatConvGet`, `chatConvSave`,
  `chatConvRename`, `chatConvDelete`.
- **topic.js Chat tab**:
  - Persistence swapped from `localStorage` to the DB (`saveChatHistory` →
    fire-and-forget `persistActiveConv`; `loadChatHistory` is now the in-memory
    buffer hydrated by `hydrateChat`). 50-message cap removed.
  - `hydrateChat`: one-time-per-session legacy-`localStorage` migration into a
    DB conversation, then restores the last-open thread (stored → most-recent →
    fresh).
  - New conversation rail (`refreshConvRail`, `selectConversation`,
    `newConversation`, `renameConversation`, `deleteConversation`): list of
    saved threads, **+ New**, click to open, double-click to rename, hover-trash
    to delete. Active thread highlighted; auto-title = first user message.
  - "Clear" now deletes the current thread and starts a fresh one (others stay
    saved).
- **style.css**: `.chat-layout` / `.chat-conv-rail` + item/title/meta/delete
  styles; collapses above the chat on ≤880px viewports.

## Verification

- `cargo check` → 0 errors. Python `init_schema` creates the table; raw SQL
  upsert/select/delete round-trip verified on the real DB.
- `node --check` clean on topic.js + api.js; `npm test` → 50/50 pass.
- Tauri camelCase→snake_case arg conversion confirmed against existing commands
  (`postId`→`post_id`), so `messagesJson`→`messages_json` binds correctly.
- Not yet click-tested in a live `tauri:dev` window — each layer validated
  independently; recommend a manual smoke (ask → New → switch → rename → delete →
  restart) before shipping.

## Files Created

- `changelogs/2026-05-31_10_chatgpt-style-persistent-topic-chat-conversations.md`

## Files Modified

- `src/gapmap/core/db.py` — `chat_conversations` table in `init_schema`.
- `app-tauri/src-tauri/src/db.rs` — native read-write chat-conversation CRUD.
- `app-tauri/src-tauri/src/commands.rs` — 5 Tauri chat-conversation commands.
- `app-tauri/src-tauri/src/main.rs` — registered the 5 commands.
- `app-tauri/src/api.js` — 5 `chatConv*` bindings.
- `app-tauri/src/screens/topic.js` — DB-backed persistence, hydration +
  migration, conversation rail UI.
- `app-tauri/src/style.css` — conversation-rail styles.

## Follow-up

- **Global "Chats" view** (all topics in one list) — the backend
  (`chatConvList(null)`) already supports it; needs a `/chats` route + sidebar
  entry. Deferred to a focused follow-up.
- Rebuild the bundled PyInstaller sidecar before the next DMG (only matters for
  the schema pre-create; native Rust handles all chat reads/writes regardless).
