# Fix topic Chat timestamps showing "20584d ago"

**Date:** 2026-06-01
**Type:** Fix

## Summary

The Chat tab inside a topic rendered every message timestamp as "20584d ago" (≈ time since the Unix epoch). Root cause was a seconds-vs-milliseconds unit mismatch: chat messages store `ts` as `Date.now()` (epoch **milliseconds**), but the three render sites passed `m.ts / 1000` (seconds) into `timeAgo()`, which itself expects **milliseconds** (`new Date(ts)`). Dividing by 1000 made `new Date()` interpret the value as a moment ~20 days after 1970, so `Date.now() − that` came out to ~20584 days. Removing the erroneous `/ 1000` makes chat timestamps render correctly ("just now", "5m ago", etc.).

## Changes

- Removed the stray `/ 1000` from all three `timeAgo(...)` calls in the Chat tab so message timestamps are passed in milliseconds, matching `timeAgo`'s contract (verified against every other caller in the app and `api.test.mjs`).
- Confirmed the global Chats screen (`screens/chats.js`) was already correct — its `timeAgoMs` treats `updated_at` as ms, and the Rust backend (`commands.rs::chat_conv_save`) writes `now_ms()`.

## Root cause detail

- `api.js:timeAgo(ts)` → `new Date(ts)` expects epoch **ms**.
- `topic.js` chat messages: `ts: Date.now()` (ms) at the user/assistant push.
- Buggy calls: `timeAgo(ts / 1000)` → `new Date(1.78e9)` ≈ Jan 1970 → "20584d ago".

## Files Modified

- `app-tauri/src/screens/topic.js` — fixed three `timeAgo` call sites:
  - line ~3914 (live 30s timestamp refresh interval)
  - line ~4066 (`chatBubble` static render)
  - line ~4255 (`renderAssistantInPlace` streaming render)
