# Learnings — Tier-1..6 quality-pass + MCP parity build

**Date:** 2026-04-21
**Context:** one session, 4 parallel subagents + foreground, ~7,000 lines landed.

---

## What worked

### 1. Append-only headers for parallel agent lanes

Every shared file (`commands.rs`, `main.rs`, `api.js`, `style.css`, `cli/main.py`, `index.html`) got a strict rule: **appends only, under a `// ── AG-X: <feature> ──` header at the end of the appropriate section**. No agent edited an existing line in a shared file.

**Result:** zero merge conflicts across 5 parallel lanes + FG. Normally orchestrating 4 background agents touching the same Rust handler list would be a coordination nightmare — the append discipline eliminated it.

**When to reuse:** any parallel subagent dispatch where 2+ agents need to register into the same handler table / command list / route array.

### 2. Schema pre-flight before agent dispatch

The main session landed every schema change (new tables, new columns) in `core/db.py` **before** launching the subagents. Then each agent was told "do NOT modify core/db.py — schema is already in place." This removed the highest-risk shared file from the critical path.

**When to reuse:** any multi-agent build where schema changes are cross-cutting. Land them centrally first.

### 3. Each agent gets a self-contained brief

Agent prompts included: concrete file paths, the existing patterns to follow, the exact header format, verification commands (`ast.parse`, `node --check`, `cargo check`), and an explicit "don't touch these files" list.

**Result:** agents finished in 3-10 minutes each, no back-and-forth, no "where does this go" questions.

### 4. E2E test suite wrote itself AFTER ship

Writing the `test_integration_tier_e2e.py` suite caught a real bug in `saved_views.create_view` (sqlite-utils `last_pk` returning None for up-front `id: int` schemas). Without the E2E test, this bug would have shipped dormant.

**Lesson:** "all unit tests pass" ≠ "the feature works." Integration tests that exercise the full CRUD path catch different bugs.

---

## What broke

### sqlite-utils `last_pk` is inconsistent

When a table is declared with `id: int` as the PK up-front (not auto-increment), `last_pk` returns None after an insert. The obvious pattern — insert, read back via `get(last_pk)` — fails with `IndexError / NotFoundError`.

**Fix pattern:**
```python
max_row = list(db.query(f"SELECT coalesce(max(id), 0) AS m FROM {TABLE}"))
next_id = (max_row[0]["m"] if max_row else 0) + 1
row["id"] = next_id
db[TABLE].insert(row, pk="id")
created = db[TABLE].get(next_id)
```

Works regardless of how the PK column was declared.

### HTML comments containing backticks inside JS template literals

`ingest.js` had an HTML comment `<!-- only title is required -->` inside a `` ` `` template literal; the backtick-in-comment broke JS parsing. Fix: strip backticks from any comment inside a template literal.

**Rule:** template literals are unforgiving. No backticks, no `${` sequences, in embedded HTML comments.

### Route tab-store reconciliation pitfall

`main.js` route code was modified by the user mid-session to add tab-strip reconciliation. If an agent had touched the same function the merge would have failed — the user's edit is what the tab-strip feature needed, not the pre-agent state.

**Lesson:** when the user is actively editing a file in parallel, don't modify it; send the agent to a different file. The session's append-only rule covered this implicitly.

---

## Gotchas that cost time

### ChromaDB cold-first-call silent pass-through

The relevance gate relies on ChromaDB's default embedder. On first-ever run (model not downloaded yet), `_embed` returns None silently and the gate admits everything. No user-facing log message.

**Fix plan (T-1..14 sprint):** warm the embedder eagerly on sidecar boot when a relevance-sensitive feature is enabled. Emit a one-time "warming up relevance model, ~10s" toast.

### sqlite-utils schema-drift on lazy `ALTER TABLE`

Adding `deleted_at` to `topic_prefs` via `ALTER TABLE ... ADD COLUMN` works, but older rows have NULL and the `WHERE coalesce(pref.deleted_at, '') = ''` filter became load-bearing. If any future query forgets the `coalesce`, old topics vanish.

**Rule:** use `coalesce(col, '')` everywhere `deleted_at` is checked. Treat NULL and empty-string as "not deleted."

### Toast undo-button race

The `setTimeout(() => t.remove(), 10000)` for the undo toast doesn't check whether the user clicked Undo mid-flight. Guarded with a closure-captured `undone` flag. Cleaner pattern: AbortController + clearTimeout.

---

## Rules for next session

1. **Land schema changes centrally, then dispatch agents.** Never make subagents race on `init_schema`.
2. **Append-only in shared files under AG-X headers.** Hard rule, no exceptions.
3. **Every shared Tauri command needs all 3 surfaces.** CLI + Tauri + MCP or it's not a complete feature.
4. **E2E test per shipped feature** — unit tests catch logic, E2E tests catch wiring.
5. **Eager-warm any embedder that a user-visible feature depends on** — silent cold behavior = silent failure.
6. **Never use `db.query(...).last_pk`** for integer-PK schemas. Explicit `max(id)+1` is bulletproof.
7. **Every destructive action needs soft-delete + undo**, not just a type-to-confirm modal.
8. **Docs go in `docs/UPDATES_DETAIL.md` and `docs/TESTING_AND_IMPROVEMENTS.md`** — one for users, one for ops/QA.

---

## Items shipped that weren't on the sprint plan

Emerged naturally during the build:
- `docs/BUILD_PLAN_ALL_TIERS.md` — lane map for subagent dispatch
- `docs/UPDATES_DETAIL.md` — user-facing reference for everything shipped
- `docs/TESTING_AND_IMPROVEMENTS.md` — working backlog + acceptance matrix
- `docs/ops/lfs-maintenance.md` — LFS runbook
- `tests/test_integration_tier_e2e.py` — 9 E2E smoke tests
- 28 new MCP tools (parity pass)

These make the build maintainable, not just shipped.
