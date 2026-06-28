# OpenReply — Dual App Architecture Spec
## Complete Product, Technical & Implementation Guide
### OpenReply Community + OpenReply Pro

> **This document is the single source of truth for both apps.**
> Read every section before writing any code.
> Cross-reference with `subscription-model.md` (billing/LS)
> and `tauri-licence-impl.md` (Tauri/Rust licence system).

---

## 0. The core philosophy

```
Two apps. One engine. Different contracts with the user.

OpenReply Community          OpenReply Pro
──────────────────         ──────────────────────────
Free forever               $69 one-time
Internet = the product     Internet = optional
Login required             Activation key only
Insights publish publicly  Nothing ever leaves machine
Your data on our server    Your data on your machine
Research social network    Private intelligence terminal
Next.js web app            Tauri desktop app (Rust)
```

Neither app is a crippled version of the other.
They are different products for different contexts.
The same person may use both — Community to share
publicly, Pro for sensitive competitive intelligence.

---

## 1. Product positioning

### 1.1 OpenReply Community

**What it is:** A research publishing platform.
Running a sweep without publishing is pointless —
the publish-discover loop IS the product.

**Who it is for:**
- Indie hackers validating startup ideas publicly
- PhD students and researchers publishing open findings
- Product consultants building a public research portfolio
- Anyone who wants to contribute to and benefit from
  a shared gap intelligence database

**The value exchange:**
- User gets: free access to the full sweep engine,
  public profile, discoverable research, community signal
- OpenReply gets: published content, SEO, network effects,
  proof that the product works (the insights ARE the demo)

**Analogy:** GitHub public repos. Free because the
content benefits the platform. Privacy is what you pay for.

---

### 1.2 OpenReply Pro

**What it is:** A private intelligence terminal.
Runs entirely on the user's machine. After the one-time
activation, no OpenReply server is involved in any
research operation.

**Who it is for:**
- PMs and founders doing sensitive competitor research
- Enterprise teams who cannot let research leave their network
- Researchers working under NDA or data governance rules
- Power users who want to own their own data pipeline
- Teams who want to plug OpenReply into their own infrastructure

**The value exchange:**
- User pays: $69 once
- User gets: perpetual licence, full offline operation,
  zero telemetry, optional own-DB connection,
  activation key only (no account, no login)

**Analogy:** Obsidian. Your vault, your machine, your rules.
No account required. Sync is optional and yours to manage.

---

## 2. App comparison table

| Property | Community | Pro |
|---|---|---|
| Price | Free | $69 one-time |
| Auth | Email + Google OAuth | Activation key only |
| Account required | Yes | No |
| Internet required | Yes — always | No — launch/activate only |
| Data storage | Supabase cloud (our server) | Local SQLite on device |
| Own DB support | No | Yes — optional |
| Insights publishing | Automatic (opt-out per workspace) | Never |
| BYOK | Yes | Yes |
| Source connectors | All 13 | All 13 |
| Workspaces | Unlimited | Unlimited |
| Export formats | MD, PDF, CSV | MD, PDF, CSV |
| Scheduler | Community-managed cron | Local cron (Live Pass) |
| Competitor monitors | Server-side | Local (Live Pass) |
| Offline use | No | Yes |
| Licence check | JWT from login session | Device-bound JWT from key |
| Telemetry | Standard web analytics | None |
| Platform | Web (browser) or Tauri shell | Tauri desktop only |
| macOS | Yes | Yes |
| Windows | Yes (web) | Yes (Tauri) |
| Linux | Yes (web) | Yes (Tauri) |

---

## 3. Shared core engine

Both apps use the same research engine.
Write it once as a shared Rust crate.

### 3.1 Monorepo structure

```
openreply/
├── packages/
│   ├── core/                        ← shared Rust crate
│   │   ├── Cargo.toml
│   │   └── src/
│   │       ├── lib.rs
│   │       ├── sweep/               ← source fetching pipeline
│   │       │   ├── mod.rs
│   │       │   ├── reddit.rs
│   │       │   ├── hackernews.rs
│   │       │   ├── g2.rs
│   │       │   ├── twitter.rs
│   │       │   ├── arxiv.rs
│   │       │   ├── appstore.rs
│   │       │   ├── producthunt.rs
│   │       │   ├── devto.rs
│   │       │   ├── capterra.rs
│   │       │   ├── trustpilot.rs
│   │       │   ├── github_issues.rs
│   │       │   ├── rss.rs
│   │       │   └── custom_inject.rs  ← user-uploaded CSV/JSON
│   │       ├── extraction/           ← AI gap analysis
│   │       │   ├── mod.rs
│   │       │   ├── classifier.rs     ← pain/workaround/request/praise
│   │       │   ├── ranker.rs         ← frequency + severity scoring
│   │       │   ├── deduplicator.rs   ← merge similar signals
│   │       │   └── prompt.rs         ← extraction prompt templates
│   │       ├── models/               ← shared data types
│   │       │   ├── post.rs           ← raw post
│   │       │   ├── insight.rs        ← extracted pain point
│   │       │   ├── workspace.rs
│   │       │   ├── sweep_result.rs
│   │       │   └── openreply_map.rs        ← the ranked output
│   │       └── export/
│   │           ├── markdown.rs
│   │           ├── pdf.rs
│   │           └── csv.rs
│   │
│   ├── openreply-community/            ← Next.js 14 web app
│   │   ├── package.json
│   │   ├── next.config.ts
│   │   └── src/
│   │       ├── app/                 ← App Router pages
│   │       ├── components/
│   │       ├── lib/
│   │       └── api/                 ← API routes
│   │
│   └── openreply-pro/                  ← Tauri 2 desktop app
│       ├── package.json             ← frontend (React/Svelte)
│       ├── src/                     ← frontend source
│       └── src-tauri/               ← Rust backend
│           ├── Cargo.toml
│           └── src/
│
├── Cargo.toml                       ← workspace root
└── pnpm-workspace.yaml
```

### 3.2 Core crate public API

```rust
// packages/core/src/lib.rs

pub mod sweep;
pub mod extraction;
pub mod models;
pub mod export;

// The main entry point both apps call
pub struct OpenReplyEngine {
    pub byok_config: ByokConfig,
    pub storage: Box<dyn StorageBackend>,  // trait — SQLite or Postgres
}

impl OpenReplyEngine {
    pub async fn run_sweep(
        &self,
        workspace_id: &str,
        sources: Vec<SourceConfig>,
    ) -> Result<SweepResult, EngineError>;

    pub async fn extract_insights(
        &self,
        sweep_result: &SweepResult,
    ) -> Result<Vec<Insight>, EngineError>;

    pub async fn build_openreply_map(
        &self,
        workspace_id: &str,
    ) -> Result<OpenReply, EngineError>;

    pub async fn export(
        &self,
        workspace_id: &str,
        format: ExportFormat,
    ) -> Result<ExportOutput, EngineError>;
}

/// BYOK configuration — same in both apps
pub struct ByokConfig {
    pub anthropic_key: Option<String>,
    pub openai_key: Option<String>,
    pub gemini_key: Option<String>,
    pub preferred_provider: AiProvider,
}

/// Storage backend trait — SQLite for Pro, Postgres for Community
pub trait StorageBackend: Send + Sync {
    async fn save_post(&self, post: &Post) -> Result<(), StorageError>;
    async fn save_insight(&self, insight: &Insight) -> Result<(), StorageError>;
    async fn get_workspace(&self, id: &str) -> Result<Workspace, StorageError>;
    async fn list_insights(&self, workspace_id: &str) -> Result<Vec<Insight>, StorageError>;
    // ... all CRUD operations
}
```

---

## 4. OpenReply Community — full spec

### 4.1 Tech stack

```
Frontend:     Next.js 14 (App Router)
Styling:      Tailwind CSS
Auth:         Supabase Auth (email + Google OAuth)
Database:     Supabase Postgres
Realtime:     Supabase Realtime (live sweep progress)
Storage:      Supabase Storage (export files)
Email:        Resend
Deployment:   Vercel
Domain:       openreply.app
Engine:       openreply-core compiled to WASM
              OR Node.js subprocess calling core CLI
```

### 4.2 Why internet is mandatory

The Community app has no local storage. Every operation
writes to Supabase in real time:

- Workspaces stored in Supabase Postgres
- Raw posts stored in Supabase Postgres (partitioned by workspace)
- Insights stored in Supabase Postgres
- Published research served from Supabase
- Auth session managed by Supabase Auth

If the internet is unavailable, the user cannot:
- Load their workspaces
- Run a sweep (results have nowhere to go)
- View their findings
- Publish or update research

This is not a bug. It is the design. The internet IS
the product for Community users. Frame it this way in the UI.

### 4.3 Database schema (Supabase)

```sql
-- Users (extends Supabase auth.users)
create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  username      text unique not null,
  display_name  text,
  avatar_url    text,
  bio           text,
  website       text,
  twitter_handle text,
  research_count int default 0,
  follower_count int default 0,
  is_verified   boolean default false,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- Workspaces
create table public.workspaces (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references public.profiles(id) on delete cascade,
  name          text not null,
  slug          text unique,              -- for public URL: /explore/[slug]
  description   text,
  topic         text,                     -- the market/problem being researched
  is_public     boolean default true,     -- Community default: public
  status        text default 'active',    -- 'active' | 'archived'
  last_sweep_at timestamptz,
  post_count    int default 0,
  insight_count int default 0,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- Source configurations per workspace
create table public.workspace_sources (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid references public.workspaces(id) on delete cascade,
  source_type   text not null,  -- 'reddit' | 'hackernews' | 'g2' | etc.
  config        jsonb,          -- source-specific config (subreddits, queries, etc.)
  is_active     boolean default true,
  created_at    timestamptz default now()
);

-- BYOK keys (encrypted at rest — stored per user, not per workspace)
create table public.byok_keys (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references public.profiles(id) on delete cascade,
  provider      text not null,            -- 'anthropic' | 'openai' | 'gemini'
  -- NEVER store raw keys — encrypt with user-specific key derived from their password
  encrypted_key text not null,
  key_preview   text,                     -- last 4 chars for UI display only
  created_at    timestamptz default now(),
  unique(user_id, provider)
);

-- Raw posts from sweeps (large table — partition by workspace)
create table public.posts (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid references public.workspaces(id) on delete cascade,
  sweep_id      uuid,
  source_type   text not null,
  source_url    text,
  source_id     text,                     -- original post ID on source platform
  title         text,
  body          text,
  author        text,
  published_at  timestamptz,
  score         int,                      -- upvotes/stars on source platform
  indexed_at    timestamptz default now(),
  unique(workspace_id, source_type, source_id)  -- prevent duplicate ingestion
) partition by list(source_type);

-- Extracted insights
create table public.insights (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid references public.workspaces(id) on delete cascade,
  sweep_id      uuid,
  post_id       uuid references public.posts(id),
  insight_type  text not null,  -- 'pain' | 'workaround' | 'request' | 'praise'
  title         text not null,
  description   text,
  severity      int,            -- 1-5
  frequency     int,            -- how many posts mention this
  frequency_pct numeric(5,2),   -- % of total posts
  tags          text[],
  source_urls   text[],         -- traceable back to raw posts
  created_at    timestamptz default now()
);

-- Sweeps (audit log of each run)
create table public.sweeps (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid references public.workspaces(id) on delete cascade,
  user_id       uuid references public.profiles(id),
  status        text default 'running',  -- 'running'|'complete'|'failed'
  sources_swept text[],
  posts_indexed int default 0,
  insights_found int default 0,
  started_at    timestamptz default now(),
  completed_at  timestamptz,
  error_message text
);

-- Published research (the public explore feed)
create table public.published_research (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid references public.workspaces(id) on delete cascade,
  user_id         uuid references public.profiles(id),
  slug            text unique not null,
  title           text not null,
  description     text,
  -- Snapshot of insights at publish time (denormalised for performance)
  insights_snapshot jsonb,
  source_types    text[],
  post_count      int,
  insight_count   int,
  view_count      int default 0,
  upvote_count    int default 0,
  published_at    timestamptz default now(),
  updated_at      timestamptz default now(),
  is_featured     boolean default false
);

-- Upvotes on published research
create table public.research_upvotes (
  user_id       uuid references public.profiles(id),
  research_id   uuid references public.published_research(id),
  created_at    timestamptz default now(),
  primary key(user_id, research_id)
);

-- Follows between users
create table public.follows (
  follower_id   uuid references public.profiles(id),
  following_id  uuid references public.profiles(id),
  created_at    timestamptz default now(),
  primary key(follower_id, following_id)
);
```

### 4.4 RLS policies

```sql
-- Profiles: public read, own write
create policy "profiles_public_read" on public.profiles for select using (true);
create policy "profiles_own_write" on public.profiles for all using (auth.uid() = id);

-- Workspaces: public workspaces visible to all, private to owner only
create policy "workspaces_public_read" on public.workspaces
  for select using (is_public = true or auth.uid() = user_id);
create policy "workspaces_own_write" on public.workspaces
  for all using (auth.uid() = user_id);

-- Insights: visible if workspace is public or owned
create policy "insights_read" on public.insights
  for select using (
    exists (
      select 1 from public.workspaces w
      where w.id = workspace_id
      and (w.is_public = true or w.user_id = auth.uid())
    )
  );
create policy "insights_own_write" on public.insights
  for all using (
    exists (
      select 1 from public.workspaces w
      where w.id = workspace_id and w.user_id = auth.uid()
    )
  );

-- BYOK keys: owner only, never public
create policy "byok_owner_only" on public.byok_keys
  for all using (auth.uid() = user_id);

-- Posts: same as insights
create policy "posts_read" on public.posts
  for select using (
    exists (
      select 1 from public.workspaces w
      where w.id = workspace_id
      and (w.is_public = true or w.user_id = auth.uid())
    )
  );

-- Published research: always public read
create policy "published_public_read" on public.published_research
  for select using (true);
create policy "published_own_write" on public.published_research
  for all using (auth.uid() = user_id);
```

### 4.5 App Router pages

```
src/app/
├── page.tsx                      ← marketing homepage (redirect if logged in)
├── login/page.tsx                ← Supabase Auth UI
├── register/page.tsx             ← sign up + role selection
│
├── dashboard/
│   ├── page.tsx                  ← user's workspaces
│   ├── layout.tsx                ← sidebar nav
│   ├── workspace/
│   │   ├── [id]/
│   │   │   ├── page.tsx          ← workspace dashboard
│   │   │   ├── ingest/page.tsx   ← source configuration
│   │   │   ├── sweep/page.tsx    ← run sweep + live progress
│   │   │   ├── insights/page.tsx ← gap map view
│   │   │   ├── report/page.tsx   ← export
│   │   │   └── settings/page.tsx ← workspace settings + publish toggle
│   ├── settings/
│   │   ├── page.tsx              ← account settings
│   │   ├── byok/page.tsx         ← API key management
│   │   └── profile/page.tsx      ← public profile settings
│
├── explore/
│   ├── page.tsx                  ← public research feed (SEO landing)
│   ├── [slug]/page.tsx           ← individual published research
│   └── topic/[topic]/page.tsx    ← all research on a topic
│
├── @[username]/
│   └── page.tsx                  ← public researcher profile
│
└── api/
    └── v1/
        ├── sweep/route.ts        ← POST start sweep
        ├── sweep/[id]/route.ts   ← GET sweep status (SSE stream)
        ├── insights/route.ts     ← GET/POST insights
        ├── publish/route.ts      ← POST publish workspace
        ├── unpublish/route.ts    ← POST unpublish
        └── byok/route.ts         ← PUT/DELETE API keys
```

### 4.6 Sweep flow (Community — online)

```
User clicks "Run sweep" in dashboard
        ↓
POST /api/v1/sweep { workspace_id, sources[] }
        ↓
Server: create sweeps row (status: 'running')
        ↓
Server: for each source connector:
  - fetch posts (Reddit API, HN Algolia, G2 scraper, etc.)
  - upsert into posts table (unique constraint prevents dupes)
        ↓
Server: call BYOK AI endpoint with extraction prompt
  - user's Anthropic/OpenAI/Gemini key from byok_keys table
  - classify each post: pain | workaround | request | praise
  - extract structured insight per theme
        ↓
Server: rank insights by frequency + severity
  - deduplicate similar signals
  - compute frequency_pct
        ↓
Server: upsert insights table
        ↓
Server: update sweeps row (status: 'complete')
        ↓
Realtime: Supabase broadcast sweep:complete event
        ↓
Client: re-fetch insights, render gap map
        ↓
If workspace.is_public:
  Auto-update published_research snapshot
```

### 4.7 The public explore page

```
GET /explore
├── Featured research (curated by OpenReply team)
├── Recently published (paginated)
├── Trending topics (by upvote velocity)
└── Browse by category: SaaS | Dev Tools | Consumer | B2B | Hardware

GET /explore/[slug]
├── Research title + description
├── Published by @username on [date]
├── Sources used: Reddit (2.1k posts), HN (890), G2 (340)...
├── Total posts indexed: 40,247
├── Gap map visualisation (ranked pain points)
│   ├── #1 Pain: Data export limits — 82% signal | 340 mentions
│   ├── #2 Pain: No offline mode — 67% signal | 278 mentions
│   └── #3 Workaround: Manual CSV via Zapier — 23 mentions
├── DIY workarounds section
├── Upvote button
├── "Powered by OpenReply" → download link
└── Related research (same topic, different researchers)
```

**SEO strategy:** Every published research page is a static-ish
page with schema markup. "AI analytics tool user complaints 2025"
will rank. The publish flow is the acquisition engine.

### 4.8 Privacy toggle UX

```
Workspace Settings → Visibility

┌─────────────────────────────────────────────────────────┐
│  Research visibility                                     │
│                                                          │
│  [●] Public  (current)                                   │
│      Your gap map is published at:                       │
│      openreply.app/explore/ai-analytics-gaps-2025           │
│      Last updated: 22 Apr 2026                           │
│      Views: 1,247  |  Upvotes: 83                        │
│                                                          │
│  [○] Private                                             │
│      Only you can see this workspace.                    │
│      Your published page will be taken down.             │
│      Available on OpenReply Pro ($69) or after upgrade.    │
│                                                          │
│  What gets published:                                    │
│  ✓ Ranked pain points and descriptions                   │
│  ✓ Source types used (not credentials)                   │
│  ✓ Post counts and sweep metadata                        │
│  ✗ Raw source posts (never published)                    │
│  ✗ Your BYOK API keys (never published)                  │
│  ✗ Source connector configurations                       │
└─────────────────────────────────────────────────────────┘
```

### 4.9 BYOK key storage in Community app

Community stores BYOK keys server-side, encrypted.
This is a necessary trust trade-off for an online app.
Be transparent about it.

```typescript
// lib/byok.ts

// Encryption: AES-256-GCM with key derived from user's password
// User's password is the only thing that can decrypt their API keys
// Even a database breach reveals nothing — keys are useless without the password

async function encryptApiKey(rawKey: string, userPassword: string): Promise<string> {
  const salt = crypto.randomBytes(16)
  const iv = crypto.randomBytes(12)
  // Derive encryption key from user's password using PBKDF2
  const derivedKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(userPassword),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  )
  const encKey = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    derivedKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  )
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    encKey,
    new TextEncoder().encode(rawKey)
  )
  // Store: base64(salt) + '.' + base64(iv) + '.' + base64(encrypted)
  return [
    Buffer.from(salt).toString('base64'),
    Buffer.from(iv).toString('base64'),
    Buffer.from(encrypted).toString('base64'),
  ].join('.')
}
```

**Tell users this clearly in the UI:**
> "Your API keys are encrypted with your password before storage.
> OpenReply cannot read them. If you forget your password, your
> API keys are unrecoverable."

---

## 5. OpenReply Pro — full spec

### 5.1 Tech stack

```
Desktop framework:  Tauri 2
Backend language:   Rust
Frontend:           React 18 + TypeScript
Styling:            Tailwind CSS
Local database:     SQLite via SQLx
Optional database:  Any Postgres-compatible (user-provided)
Auth:               None — activation key only
Licence:            Device-bound JWT (see tauri-licence-impl.md)
Distribution:       Direct download from openreply.app/pro
                    macOS: .dmg with code signing + notarisation
                    Windows: .msi with code signing
                    Linux: .AppImage
```

### 5.2 What "no login" means technically

The Pro app has zero Supabase Auth dependency.
There is no concept of a session token, refresh token,
or user account in the app.

The only server touch after purchase:
1. `POST /api/v1/device/activate` — one-time activation
2. `POST /api/v1/licence/validate` — background heartbeat on launch
   (can be disabled in Settings → Privacy → Disable online validation)

That is the entire network footprint of OpenReply Pro.
Every other operation — sweeps, extraction, storage, export —
happens 100% locally on the user's machine.

### 5.3 Local SQLite schema

```sql
-- Mirrors the Community Postgres schema but local
-- No user_id columns — there is only one user

CREATE TABLE workspaces (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name          TEXT NOT NULL,
  description   TEXT,
  topic         TEXT,
  created_at    TEXT DEFAULT (datetime('now')),
  updated_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE workspace_sources (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_type   TEXT NOT NULL,
  config        TEXT,  -- JSON string
  is_active     INTEGER DEFAULT 1,
  created_at    TEXT DEFAULT (datetime('now'))
);

-- BYOK keys stored in macOS Keychain (not in SQLite)
-- This table only stores metadata, not the actual keys
CREATE TABLE byok_config (
  provider      TEXT PRIMARY KEY,  -- 'anthropic' | 'openai' | 'gemini'
  key_preview   TEXT,              -- last 4 chars for UI
  is_set        INTEGER DEFAULT 0,
  preferred     INTEGER DEFAULT 0,
  updated_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE posts (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  sweep_id      TEXT,
  source_type   TEXT NOT NULL,
  source_url    TEXT,
  source_id     TEXT,
  title         TEXT,
  body          TEXT,
  author        TEXT,
  published_at  TEXT,
  score         INTEGER,
  indexed_at    TEXT DEFAULT (datetime('now')),
  UNIQUE(workspace_id, source_type, source_id)
);

CREATE TABLE insights (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  sweep_id      TEXT,
  post_id       TEXT REFERENCES posts(id),
  insight_type  TEXT NOT NULL,
  title         TEXT NOT NULL,
  description   TEXT,
  severity      INTEGER,
  frequency     INTEGER,
  frequency_pct REAL,
  tags          TEXT,  -- JSON array string
  source_urls   TEXT,  -- JSON array string
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE sweeps (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  status        TEXT DEFAULT 'running',
  sources_swept TEXT,  -- JSON array
  posts_indexed INTEGER DEFAULT 0,
  insights_found INTEGER DEFAULT 0,
  started_at    TEXT DEFAULT (datetime('now')),
  completed_at  TEXT,
  error_message TEXT
);

-- Settings table (key-value store)
CREATE TABLE settings (
  key           TEXT PRIMARY KEY,
  value         TEXT,
  updated_at    TEXT DEFAULT (datetime('now'))
);

-- Custom DB connection (if user opts in)
CREATE TABLE db_connection (
  id            INTEGER PRIMARY KEY CHECK (id = 1),  -- singleton
  connection_type TEXT,  -- 'local' | 'postgres' | 'supabase'
  connection_url TEXT,   -- encrypted with device fingerprint
  is_active     INTEGER DEFAULT 0,
  last_tested_at TEXT,
  last_test_ok  INTEGER DEFAULT 0
);

-- Indices for performance
CREATE INDEX idx_posts_workspace ON posts(workspace_id);
CREATE INDEX idx_insights_workspace ON insights(workspace_id);
CREATE INDEX idx_insights_type ON insights(insight_type);
CREATE INDEX idx_sweeps_workspace ON sweeps(workspace_id);
```

### 5.4 Database file location

```
macOS:    ~/Library/Application Support/com.openreply.pro/openreply.db
Windows:  %APPDATA%\com.openreply.pro\openreply.db
Linux:    ~/.local/share/com.openreply.pro/openreply.db
```

The user owns this file completely. They can:
- Back it up manually
- Open it with any SQLite browser
- Move it to another machine (but they'd also need the JWT
  re-activated on that machine via the activation page)
- Delete it (resets all data, not the licence)

### 5.5 Own DB connection — the power user feature

Users can point OpenReply Pro at their own database.
This is the team use case without a Team plan — 5 researchers
in a company share one Postgres, each with their own Pro licence.

```
Settings → Storage → Database Connection

┌─────────────────────────────────────────────────────────┐
│  Database                                                │
│                                                          │
│  [●] Local SQLite (default)                              │
│      ~/Library/Application Support/openreply.pro/openreply.db  │
│      Size: 124 MB                                        │
│                                                          │
│  [○] Your own Postgres                                   │
│      Connection string:                                  │
│      postgresql://user:pass@host:5432/dbname             │
│                                                          │
│  [○] Your own Supabase                                   │
│      Project URL:   https://xxx.supabase.co              │
│      Service key:   eyJ... (stored in macOS Keychain)    │
│                                                          │
│  [Test connection]                                       │
│                                                          │
│  Note: OpenReply will create its own schema (openreply_pro.*) │
│  in your database. Existing tables are never modified.   │
│  Your credentials are stored in macOS Keychain only.     │
└─────────────────────────────────────────────────────────┘
```

#### Own DB implementation in Rust

```rust
// src-tauri/src/storage/mod.rs

pub enum StorageBackend {
    Sqlite(SqlitePool),
    Postgres(PgPool),
}

impl StorageBackend {
    /// Initialise from settings. Called on app launch.
    pub async fn from_settings(settings: &Settings) -> Result<Self, StorageError> {
        match settings.db_connection_type.as_deref() {
            Some("postgres") | Some("supabase") => {
                let encrypted_url = settings.db_connection_url.as_ref()
                    .ok_or(StorageError::NoConnectionString)?;
                // Decrypt with device fingerprint
                let url = decrypt_with_fingerprint(encrypted_url)?;
                let pool = PgPool::connect(&url).await
                    .map_err(|e| StorageError::ConnectionFailed(e.to_string()))?;
                // Run migrations to create openreply_pro schema
                sqlx::migrate!("./migrations/postgres")
                    .run(&pool).await?;
                Ok(Self::Postgres(pool))
            }
            _ => {
                // Default: local SQLite
                let db_path = get_app_data_dir()?.join("openreply.db");
                let pool = SqlitePool::connect(&format!("sqlite:{}", db_path.display()))
                    .await?;
                sqlx::migrate!("./migrations/sqlite").run(&pool).await?;
                Ok(Self::Sqlite(pool))
            }
        }
    }
}

// Tauri command to test a connection before saving
#[tauri::command]
pub async fn test_db_connection(connection_string: String) -> Result<bool, String> {
    // Try to connect with a short timeout
    let pool = sqlx::postgres::PgPoolOptions::new()
        .acquire_timeout(std::time::Duration::from_secs(5))
        .connect(&connection_string)
        .await
        .map_err(|e| e.to_string())?;
    // Test with a simple query
    sqlx::query("SELECT 1").execute(&pool).await
        .map(|_| true)
        .map_err(|e| e.to_string())
}

// Save connection string encrypted with device fingerprint
#[tauri::command]
pub async fn save_db_connection(
    connection_type: String,
    connection_string: String,
) -> Result<(), String> {
    // Encrypt URL with device fingerprint so it can't be moved to another machine
    let fingerprint = get_device_fingerprint();
    let encrypted = encrypt_with_fingerprint(&connection_string, &fingerprint)
        .map_err(|e| e.to_string())?;
    // Store in SQLite settings (not the Keychain — it's already encrypted)
    save_setting("db_connection_type", &connection_type).await?;
    save_setting("db_connection_url", &encrypted).await?;
    Ok(())
}
```

### 5.6 Pro app Tauri pages

```
src/                              ← React frontend
├── App.tsx                       ← router setup
├── pages/
│   ├── Onboarding.tsx            ← shown on first launch (no JWT)
│   ├── Activation.tsx            ← enter licence key
│   ├── Dashboard.tsx             ← workspace list
│   ├── Workspace.tsx             ← workspace detail
│   ├── Ingest.tsx                ← source configuration
│   ├── Sweep.tsx                 ← run sweep + progress
│   ├── OpenReply.tsx                ← insights visualisation
│   ├── Report.tsx                ← export
│   └── Settings/
│       ├── index.tsx             ← settings root
│       ├── Licence.tsx           ← key management + devices
│       ├── BYOK.tsx              ← API key management
│       ├── Database.tsx          ← storage backend selection
│       └── Privacy.tsx           ← telemetry / heartbeat controls
└── components/
    ├── GatedFeature.tsx          ← feature gate wrapper
    └── UpgradePrompt.tsx         ← shown for locked features
```

### 5.7 First launch flow (Pro)

```
First launch — no JWT in Keychain
        ↓
Show Onboarding screen:
  "Welcome to OpenReply Pro"
  "This app runs entirely on your machine."
  "To get started, enter your activation key."
  "No account. No login. Just the key."
        ↓
User enters key from purchase email
        ↓
Activation.tsx → invoke('activate_licence', { key })
        ↓
Rust: validate key with server, bind device, get JWT
        ↓
JWT saved to macOS Keychain
        ↓
App redirects to Dashboard
        ↓
Background: validate_licence_online() runs silently
        ↓
User is in. No login. No account. Done.
```

### 5.8 Zero telemetry — what this means

```rust
// src-tauri/src/telemetry.rs

// OpenReply Pro collects NOTHING by default.
// No analytics. No crash reporting. No usage tracking.
// The only outbound calls are:
//   1. Activation server (one-time key validation)
//   2. Heartbeat server (once per launch, can be disabled)
//   3. User's own AI provider (BYOK — OpenReply never sees this traffic)
//   4. Source APIs (Reddit, HN, etc. — goes directly from user's machine)

pub fn collect_telemetry() {
    // intentionally empty
}
```

Show this in Settings → Privacy:

```
Privacy settings

Activation validation
[✓] Validate licence on launch (recommended)
    OpenReply checks once per launch that your licence
    is still active. Disable to use fully offline.
    If disabled, app trusts local JWT for 180 days.

Crash reporting
[✗] Send crash reports to OpenReply
    Disabled. Crash logs stay on your machine.

Usage analytics
[✗] Anonymous usage analytics
    Disabled. We have no idea how you use the app.
```

---

## 6. The publish/sync bridge

### 6.1 Community → Explore publish flow

```
User sets workspace.is_public = true
        ↓
POST /api/v1/publish { workspace_id }
        ↓
Server: read insights from Supabase
Server: build insights_snapshot JSON:
{
  "title": "AI Product Analytics — OpenReply",
  "topic": "AI analytics tools",
  "sources": ["reddit", "hackernews", "g2", "twitter"],
  "post_count": 40247,
  "sweep_date": "2026-04-22",
  "insights": [
    {
      "type": "pain",
      "title": "Data export limits",
      "frequency_pct": 82.3,
      "severity": 4,
      "mention_count": 340,
      "sample_quotes": []  ← NEVER include raw post text in published data
    },
    ...
  ],
  "workarounds": [...],
  "published_by": "shantanu_builds",
  "powered_by": "OpenReply Community"
}
Server: upsert published_research row with snapshot
Server: regenerate static page at /explore/[slug]
        (Next.js ISR with revalidate: 3600)
```

### 6.2 What is NEVER published

Even in Community (fully public) mode, these never
appear on the explore page or in any API response:

```
NEVER PUBLISHED:
├── Raw source posts (verbatim Reddit/HN/G2 text)
├── BYOK API keys
├── Source connector credentials or configuration
├── User's email address
├── Post author names from source platforms
├── Source post URLs (linking back to originals could
│   create GDPR/copyright issues)
└── Any text the user added as private notes
```

The published snapshot contains only the **extracted,
structured insights** — not the raw data behind them.
This is both a legal protection and a trust signal.

### 6.3 Pro → Community bridge (optional power feature)

A Pro user can optionally publish one specific gap map
to the Community explore page, without creating an account,
by using a one-time publish token.

```
Pro Settings → Share Research

┌─────────────────────────────────────────────────────────┐
│  Share to OpenReply Explore (optional)                     │
│                                                          │
│  You can publish a gap map anonymously to               │
│  openreply.app/explore without creating an account.        │
│                                                          │
│  Workspace: AI Product Analytics                         │
│  [Publish anonymously to Explore →]                      │
│                                                          │
│  What will be published:                                 │
│  ✓ Ranked insights and descriptions                      │
│  ✗ Your identity (published as "Pro user")              │
│  ✗ Raw posts or source credentials                       │
│                                                          │
│  You'll get a shareable URL you can use or delete        │
│  at any time.                                            │
└─────────────────────────────────────────────────────────┘
```

Implementation:
```rust
#[tauri::command]
pub async fn publish_to_explore(
    workspace_id: String,
    licence: State<'_, LicenceMutex>,
) -> Result<String, String> {
    // Build insights snapshot locally
    let snapshot = build_insights_snapshot(&workspace_id).await?;

    // POST to server with JWT auth (no account needed — JWT proves Pro licence)
    let token = read_token().ok_or("no_licence")?;
    let client = reqwest::Client::new();
    let res = client
        .post("https://openreply.app/api/v1/pro/publish")
        .bearer_auth(&token)
        .json(&snapshot)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let body: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    let url = body["url"].as_str().ok_or("no_url")?.to_string();
    Ok(url)  // → "https://openreply.app/explore/pro-abc123"
}
```

---

## 7. Licence gating comparison

### Community app gates
```
Free tier (default):
├── All workspaces public by default
├── Cannot set workspace to private
└── Upgrade prompt: "Go private with Pro — $69"

No feature crippling in Community.
The only gate is privacy.
```

### Pro app gates
```
No licence (key not entered):
├── App launches in demo mode
├── Can browse UI but cannot save anything
├── Run 1 free demo sweep on sample data (no API key needed)
└── Prompts to enter activation key

Pro licence (base, $69 one-time):
├── All workspaces, all sources, PDF/CSV export
├── Local SQLite storage
├── Own DB connection
├── Manual sweeps only
└── 1 device

Pro + Live Pass ($69 + $39/year):
├── Everything in Pro
├── Scheduled daily brief automation
├── Competitor live monitors
├── New source connectors as shipped
└── 2 device activations

Team ($149/year for 3 keys):
├── 3 activation keys
├── Each key = full Pro + Live Pass
└── Own DB highly recommended for shared workspace
```

---

## 8. Environment variables

### Community app (Vercel)
```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Resend
RESEND_API_KEY=
RESEND_FROM_EMAIL=noreply@openreply.app

# JWT for Pro cross-publish endpoint
TOKEN_SIGNING_SECRET=        # must match Pro build secret

# App
NEXT_PUBLIC_APP_URL=https://openreply.app
NEXT_PUBLIC_PRO_DOWNLOAD_URL=https://openreply.app/pro/download
```

### Pro app (build time — CI/CD only, NEVER committed)
```bash
# JWT secret baked into binary (see tauri-licence-impl.md section 3)
JWT_DESKTOP_SECRET=          # min 32 chars, must match TOKEN_SIGNING_SECRET

# Activation server URL baked into binary
ACTIVATION_SERVER_URL=https://openreply.app

# App signing (for distribution)
APPLE_CERTIFICATE=           # base64 encoded .p12
APPLE_CERTIFICATE_PASSWORD=
APPLE_SIGNING_IDENTITY=
APPLE_TEAM_ID=
APPLE_API_KEY=               # for notarisation
APPLE_API_ISSUER=
```

---

## 9. Distribution

### Community
- Web app at `app.openreply.app`
- Works in any modern browser
- Progressive Web App (PWA) support optional
- No download required

### Pro
```
macOS:
  openreply-pro-1.0.0-aarch64.dmg   ← Apple Silicon
  openreply-pro-1.0.0-x86_64.dmg    ← Intel Mac
  Signed with Apple Developer certificate
  Notarised with Apple notarisation service
  Gatekeeper passes on first launch

Windows:
  openreply-pro-1.0.0-x86_64.msi
  Signed with Windows code signing certificate
  SmartScreen warning minimal with EV cert

Linux:
  openreply-pro-1.0.0-amd64.AppImage
  No signing required
```

All distributed via direct download from `openreply.app/pro`.
No app store. No App Store 30% cut. No review process.
Lemon Squeezy handles payment → user gets download link immediately.

---

## 10. How the two apps share the pricing page

The marketing homepage (`openreply.app`) serves both.
Pricing section has two columns:

```
Community                    Pro
─────────────────────        ──────────────────────────
Free forever                 $69 one-time
                             + $39/yr Live Pass
                             + $149/yr Team

Always online                Fully offline
Publish and discover         Private by default
Login with email             Activation key only

[Get started free]           [Buy Pro — $69]
app.openreply.app/register      [How activation works →]
```

The CTA for Pro opens the Lemon Squeezy checkout directly.
After purchase, user receives key by email → enters in app.
No account creation for Pro at any point.

---

## 11. Conversion paths

### Community → Pro conversion
```
Trigger: User tries to make a workspace private
Prompt:  "Private workspaces require OpenReply Pro"
         "Your research stays on your machine — no account, no sync."
         "One-time purchase: $69"
         [Buy Pro — $69 →]

Trigger: User has been on Community for 30 days
Email:   "You've published 8 gap maps. Want to keep the next one private?"

Trigger: User is a researcher working under NDA
Message: Shown on register if they select "Research" role:
         "Working with sensitive data? OpenReply Pro runs
          entirely offline. No data leaves your machine."
```

### Pro upsell to Live Pass
```
Trigger: User manually runs sweep for 7th time
Prompt:  "Automate this. Daily brief runs at 8am, you
          wake up to your priority list."
         "Live Pass — $39/yr"

Trigger: User opens Scheduler settings
Shows:   Locked UI with Live Pass upgrade CTA

Trigger: User opens Competitors tab
Shows:   Locked UI with Live Pass upgrade CTA
```

---

## 12. Implementation order — both apps

### Phase 1 — Core engine (shared, ~3 weeks)
```
1. Set up monorepo (Cargo workspace + pnpm workspace)
2. packages/core: models (Post, Insight, Workspace, SweepResult)
3. packages/core: StorageBackend trait
4. packages/core: sweep engine — Reddit + HN connectors first
5. packages/core: extraction — Anthropic BYOK prompt + classifier
6. packages/core: ranker + deduplicator
7. packages/core: markdown exporter
8. Write integration tests for core
```

### Phase 2 — Pro app (Tauri, ~4 weeks)
```
9.  Set up openreply-pro Tauri project
10. Implement licence system (tauri-licence-impl.md — all 22 sections)
11. SQLite storage backend
12. Wire core engine to Tauri commands
13. Onboarding + Activation screens
14. Dashboard + Workspace screens
15. Sweep + live progress (Tauri events to frontend)
16. OpenReply visualisation screen
17. Settings (BYOK, Database, Privacy, Licence)
18. Own DB connection feature
19. PDF + CSV export (gated)
20. Scheduler (Live Pass gated)
21. Competitor monitors (Live Pass gated)
22. macOS code signing + notarisation
23. Build pipeline (GitHub Actions)
```

### Phase 3 — Community app (Next.js, ~4 weeks)
```
24. Set up openreply-community Next.js project
25. Supabase schema + RLS migrations
26. Supabase Auth integration (email + Google)
27. BYOK key encryption/storage
28. Dashboard + workspace CRUD
29. Source configuration UI
30. Sweep API route + SSE progress stream
31. Insights display + gap map visualisation
32. Publish/unpublish flow
33. Explore page (SSG + ISR)
34. Individual research page ([slug])
35. User profile page (@username)
36. Upvotes + follows
37. Email flows (Resend — welcome, sweep complete, etc.)
38. SEO (sitemap, schema markup on explore pages)
39. Vercel deployment
```

### Phase 4 — Integration and cross-app features (~1 week)
```
40. Shared pricing page on openreply.app
41. Pro → Explore anonymous publish bridge
42. Activation server (shared between both apps)
    → already specced in subscription-model.md
43. Lemon Squeezy checkout for Pro
44. End-to-end test: buy Pro → activate → sweep → export
45. End-to-end test: Community register → sweep → publish → explore
```

---

## 13. File reference map

```
Document                        Covers
──────────────────────────────  ──────────────────────────────────────────
THIS FILE                       Both app architecture, shared core,
                                Community full spec, Pro full spec,
                                own-DB feature, publish flow

subscription-model.md           Billing (Lemon Squeezy), plan definitions,
                                server-side API, Supabase schema (server),
                                webhook handling, email flows

tauri-licence-impl.md           Tauri/Rust licence implementation in full,
                                device fingerprinting (all 3 OS),
                                JWT verification, OS Keychain storage,
                                all Tauri commands with code,
                                frontend TypeScript hooks,
                                build.rs secret embedding,
                                full activation flow walkthrough

openreply-map-home.html               Marketing homepage with 3-slide hero,
                                4-tier pricing section, comparison table

openreply-map-login.html              Community app login/register/forgot

openreply-map-activate.html           Pro app licence management web dashboard
```

---

## 14. Key decisions log

These decisions are final. Do not re-litigate them.

| Decision | Rationale |
|---|---|
| Two separate apps, not one app with a toggle | Different philosophies, different stacks, different UX. A toggle would compromise both. |
| Community is web-first, not Tauri | The internet IS the product. A Tauri shell adds complexity for no benefit. |
| Pro has no login, no account | The defining feature. Activation key only. Non-negotiable. |
| JWT secret baked into binary at compile time | Never in a file, never runtime env. Only reversible with binary disassembly. |
| Own DB uses device-fingerprint encryption | Connection strings never readable on another machine even if SQLite is copied. |
| Raw posts never published | Legal protection (copyright of source posts) + trust signal. |
| BYOK keys in OS Keychain (Pro) | macOS Keychain is OS-level security, not app-level. |
| BYOK keys encrypted with user password (Community) | Only the user can decrypt their own keys even if DB is breached. |
| Direct download, no App Store | No 30% cut, no review delays, no policy restrictions on BYOK features. |
| Lemon Squeezy for billing | Handles global VAT/GST, instant setup, good webhook reliability. |
| Shared core Rust crate | Write extraction logic once. Both apps get same quality. |
