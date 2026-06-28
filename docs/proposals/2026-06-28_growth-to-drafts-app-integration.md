# Plan: Growth Collection → Queue Drafts (App Integration)

## Goal
Let users run `collect-growth` from the Tauri desktop app / prototype and have the fetched posts turned into editable queue drafts (posts, threads, replies) that appear in the Queue screen.

## Current State
- CLI: `openreply collect-growth <topic>` fetches from 24 sources and persists rows to `posts` / `topic_posts`.
- CLI: `--drafts` flag will generate LLM-powered drafts and save them to a new `content_queue` table.
- App: `prototype/queue.html` is the source of truth; `app-tauri/src/or/views.js` is auto-generated from it.
- App: Queue UI is static JS data; no backend reads from a drafts table yet.
- DB: No `content_queue` table exists yet (this proposal adds it).

## Proposed Data Model

### `content_queue` table
```sql
CREATE TABLE content_queue (
  id TEXT PRIMARY KEY,              -- stable uuid
  topic TEXT,                       -- the growth topic, e.g. "note taking app"
  source_post_id TEXT,              -- posts.id that inspired the draft
  source_type TEXT,                 -- e.g. "github_trending", "hn"
  source_url TEXT,                  -- original URL
  platform TEXT,                    -- "X", "LinkedIn", "Reddit", "Blog"
  content_type TEXT,                -- "post" | "thread" | "article" | "reply"
  title TEXT,                       -- headline / thread hook
  body TEXT,                        -- full draft text
  status TEXT DEFAULT 'draft',      -- "draft" | "scheduled" | "posted" | "archived"
  scheduled_at TEXT,                -- ISO UTC when scheduled
  created_at TEXT,                  -- ISO UTC
  updated_at TEXT,                  -- ISO UTC
  metadata_json TEXT                -- JSON: {author, score, flair, ...}
);
```

Indexes: `topic`, `status`, `source_type`, `created_at`.

## App Integration Steps

### 1. Rust backend command (Tauri)
Add a Tauri command in `app-tauri/src-tauri/src/commands.rs`:

```rust
#[tauri::command]
fn collect_growth(topic: String, bundle: String, limit: i32, drafts: bool) -> Result<Value, String>;
```

Implementation options:
- **Option A (recommended)**: call the Python sidecar with `collect-growth <topic> --bundle <bundle> --limit <limit> [--drafts] --json`, then parse JSON and return it. Reuses all Python logic unchanged.
- **Option B**: duplicate the runner logic in Rust. More work, harder to maintain.

Go with **Option A**.

### 2. Python sidecar entry
Ensure the bundled `openreply` binary / sidecar supports `collect-growth`. The CLI command added in `src/openreply/cli/main.py` already provides this.

### 3. Frontend: Queue screen reads `content_queue`
Update `prototype/queue.html` so the table is rendered from the DB (via Tauri API) instead of a hardcoded JS array.

Pattern:
- On load: `invoke('list_content_drafts', { topic, status: 'draft' })`.
- Render rows with working filter pills (All / Drafts / Scheduled / Posted) and date sorting (already prototyped).
- Add "Generate from growth" button that opens a modal:
  - Topic input
  - Bundle selector (content / social / opensource / web)
  - Limit slider
  - "Generate drafts" button → invokes `collect_growth` with `drafts: true`.
- After generation, refresh the queue table.

### 4. Prototype-only fallback
For the static HTML prototype (no Tauri), keep the JS-rendered table but add a "Load sample growth drafts" button that fetches from a local JSON file or localStorage.

### 5. Regenerate Tauri views
After editing `prototype/queue.html`, run the view generator (if one exists) to update `app-tauri/src/or/views.js`.

## CLI → App Handoff
The CLI `--drafts` flow writes drafts to `content_queue`. The app simply reads that table. No extra IPC payload needed beyond the summary JSON.

## Open Questions
1. Should drafts be tied to an active Agent / persona voice? (Yes — pass `agent_id` to the LLM prompt and store it in `metadata_json`.)
2. Should the user pick the target platform before generation? (Default to "X" for posts, "LinkedIn" for articles, "Reddit" for replies; let user override in the modal.)
3. Auto-scheduling? (Out of scope for first pass; status stays `draft`.)

## Suggested Milestones
1. **MVP**: CLI `--drafts` works; `content_queue` table exists; prototype queue can display static sample drafts.
2. **V1**: Tauri "Generate from growth" button; Queue reads real drafts from DB.
3. **V2**: Per-agent voice, platform picker, one-click schedule.
