# OpenReply — Proper Content Engine (Article, Follow-ups, YouTube, Shorts)

**Date:** 2026-06-27
**Status:** Approved — implementing
**Owner:** Shantanu

## Problem

The Compose screen is a static mockup: the "Generate" button just reveals a
hardcoded textarea and never calls the real engine. The backend
(`content.generate_content`) already produces `post` / `thread` / `script` /
`article` drafts from the agent's voice + live Reddit corpus and saves them to
`content_items`, but:

- The UI is not wired to it.
- There is no **YouTube long-form** kind (only a generic 30–60s `script`).
- There is no **follow-up** kind (reply-to-reply or sequence post).
- Specs are generic one-liners — output is not properly structured per type.
- There is no way to **edit / save / schedule** a generated draft.

## Goal

Make content generation real and properly structured: wire the UI to the
engine, add the new kinds, give each kind a distinct structured template, make
output editable + saveable + platform-aware. Publishing stays manual
(draft → scheduled → posted).

## Command triangle (existing, reused)

```
api.contentGenerate(kind, platform, angle, ctx)
  → Rust content_generate            (app-tauri/src-tauri/src/commands.rs)
  → CLI `gapmap content generate …`  (src/gapmap/cli/agent_cmds.py)
  → content.generate_content()       (src/gapmap/reply/content.py)
  → content_items SQLite table
```

## Final content kinds

| Kind | New? | Structure |
|---|---|---|
| `post` | keep | single concise scroll-stopping post |
| `thread` | keep | 5–8 numbered parts, each a complete thought |
| `article` | quality pass | title · 2-sentence intro · 3 `##` sections · takeaway (600–900 words) |
| `script` | keep | **Short** (Reels/Shorts/TikTok): hook line + 3 beats + CTA, 30–60s |
| `youtube` | **NEW** | **Long-form**: hook · intro · 3–5 segments each with a `[VISUAL]` cue · CTA · outro |
| `followup_reply` | **NEW** | reply to someone's response — needs parent thread + their reply as context |
| `followup_post` | **NEW** | sequence follow-up (part 2 / update / recap) — needs the original draft as context |

## Per-kind spec design (`_KIND_SPECS`)

Each spec is a structured instruction block, not a one-liner. Examples:

- **article** — "Write a 600–900 word article. Output: a title line, a
  2-sentence intro, exactly 3 sections each with a `## ` heading and 2–3
  paragraphs, then a one-line **Takeaway:**. Markdown."
- **youtube** — "Write a long-form YouTube script (~5–8 min). Sections, in order:
  HOOK (1–2 punchy lines), INTRO (who/what/why-watch), 3–5 SEGMENTS each titled
  and ending with a `[VISUAL: …]` cue, CTA (subscribe + next step), OUTRO. Label
  each section in caps."
- **script** — "Write a 30–60s vertical short script. HOOK (first line stops
  the scroll), then 3 BEATS, then CTA. Keep it spoken-word, ~120 words."
- **followup_reply** — "You previously engaged in this thread. Write a single
  follow-up reply to the latest response below. Be specific, additive, human —
  acknowledge their point, add value, never salesy. Context follows."
- **followup_post** — "Write a follow-up to your earlier content (the
  'original' below). It should stand alone but build on it — an update, a part 2,
  or a lesson learned. Same brand voice."

## Platform-awareness

`generate_content` derives a length/format hint and `max_tokens` from
`platform`:

| Platform | Hint |
|---|---|
| `x` / twitter | ≤280 chars per post; punchy |
| `linkedin` | professional, line breaks, 1–2 short paras |
| `reddit` | conversational, no marketing tone, markdown ok |
| `youtube` | spoken-word, segment labels |
| default | platform-neutral |

The hint is appended to the prompt; `max_tokens` scales (post/script ≈ 500,
article/youtube ≈ 1400).

## Context for follow-ups

`generate_content(..., context_id=None, context_text="")`:

- `followup_post` → if `context_id` given, load that `content_items.body` as the
  "original" and store `parent_id = context_id`.
- `followup_reply` → `context_text` holds the thread + the latest reply (pasted
  in the UI, or pulled from an opportunity later). Stored in `opportunity_id`
  reference if it came from one.

## Editing / saving / scheduling

New `update_content(id, *, body=None, status=None, scheduled_at=None)`:
- updates `body`, bumps `updated_at`.
- `status` in {draft, scheduled, posted}; setting `scheduled` stamps
  `scheduled_at` (epoch) when provided.

## Data model change

`content_items` gains `parent_id TEXT` (id of the content item a follow-up
builds on). `_ensure()` keeps the create-if-missing path AND runs a light
`ALTER TABLE … ADD COLUMN parent_id` guarded by a column-existence check, so
existing DBs migrate without data loss.

## Layer-by-layer changes

1. **`src/gapmap/reply/content.py`**
   - Restructure `_KIND_SPECS` into rich per-kind blocks; add `youtube`,
     `followup_reply`, `followup_post`.
   - `generate_content`: add `context_id`, `context_text`; platform hint +
     dynamic `max_tokens`; persist `parent_id`.
   - Add `update_content(...)`; add `parent_id` migration in `_ensure`.

2. **`src/gapmap/cli/agent_cmds.py`**
   - `generate`: add `--context-id`, `--context-text`; update help/kinds doc.
   - New `content update` command (`--body` / `--status` / `--scheduled-at`).

3. **`app-tauri/src-tauri/src/commands.rs` + `main.rs`**
   - Extend `content_generate` with `context_id` / `context_text` passthrough.
   - Add `content_update`; register in `generate_handler!`.

4. **`app-tauri/src/or/api.js`**
   - `contentGenerate(kind, platform, angle, ctx)` (ctx = {contextId, contextText}).
   - `contentUpdate(id, fields)`.

5. **`app-tauri/src/or/views.js` (Compose + Queue)**
   - Kind buttons: Post, Thread, Short script, **YouTube**, Article, **Follow-up**.
   - Follow-up: Reply/Sequence sub-toggle + context input (paste reply, or pick
     an existing draft for sequence).
   - Generate → real call with loading state → editable output textarea.
   - Save draft / Schedule → `contentUpdate`.
   - "Recent drafts" + Queue render real `contentList`.
   - Keep static fallback when `api.isTauri()` is false (prototype still renders).

## Non-goals (YAGNI)

- Auto-publishing / outbound adapters (kept manual).
- A separate templates subsystem / registry.
- Multi-step scheduled drip automation beyond a single follow-up.

## Testing

- Python: `generate_content` for each kind returns a record with non-empty
  `body` and correct `kind`; follow-ups attach `parent_id`/context;
  `update_content` mutates body/status; `parent_id` migration is idempotent.
- Manual: Compose in Tauri dev generates each kind, edits, saves, schedules;
  Queue lists real drafts; non-Tauri prototype still renders statically.
