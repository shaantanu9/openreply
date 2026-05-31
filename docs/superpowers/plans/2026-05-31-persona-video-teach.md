# Persona "teach from video" (YouTube captions + Instagram Whisper) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user paste a YouTube *or* Instagram URL to teach a chosen persona — YT uses yt-dlp captions (existing path), Instagram uses the Whisper audio pipeline — then chat answers ground in the persona's per-persona ChromaDB memory ("mirofish").

**Architecture:** Add one router `teach_from_video(persona_id, url)` in `persona/teach.py`. YouTube → existing `teach_from_youtube`. Instagram/other → new `teach_from_media` that builds posts-table rows from `sources/video.fetch_video` (Whisper) and hands them to the SAME `upsert_posts → _tag_posts → ingest_persona` tail. Surface via CLI → Rust streaming command → `api.js` → a "Teach from video" box on the personas screen.

**Tech Stack:** Python (Typer CLI), faster-whisper + yt-dlp (`transcribe/`, `sources/video.py`), Tauri 2 Rust streaming command, vanilla-JS frontend.

**Spec:** `docs/superpowers/specs/2026-05-31-persona-video-teach-design.md`

---

### Task 1: `fetch_video` row shape recon (read-only, no commit)

**Files:**
- Read: `src/gapmap/sources/video.py:125` (`fetch_video`), `:89` (`preview_video`)
- Read: `src/gapmap/core/db.py` (`upsert_posts` row contract)

- [ ] **Step 1:** Read `fetch_video(...)` — record its exact signature and the
  posts-table row shape it returns (must include `id`, `source_type`, a
  title/selftext text field, `permalink`/`url`). Confirm it works from a bare
  URL and transcribes via `transcribe_audio` (Whisper).
- [ ] **Step 2:** Confirm `upsert_posts(rows)` and
  `research.collect._tag_posts(lens, ids, source=...)` accept those rows
  (they already do for YT in `teach.py:132-136`).
- [ ] No code change, no commit — this task de-risks Task 3.

---

### Task 2: Instagram URL parser + router skeleton (TDD)

**Files:**
- Modify: `src/gapmap/persona/teach.py` (add `parse_instagram_url`, `VIDEO_SOURCE`)
- Test: `tests/test_persona_teach_video.py` (create)

- [ ] **Step 1: Write the failing test**

```python
# tests/test_persona_teach_video.py
from gapmap.persona.teach import parse_instagram_url, classify_video_url

def test_parse_instagram_url():
    assert parse_instagram_url("https://www.instagram.com/reel/Cabc123/") == "Cabc123"
    assert parse_instagram_url("https://instagram.com/p/XyZ_9/?igshid=1") == "XyZ_9"
    assert parse_instagram_url("https://www.instagram.com/tv/Q-1/") == "Q-1"
    assert parse_instagram_url("https://youtu.be/dQw4w9WgXcQ") is None

def test_classify_video_url():
    assert classify_video_url("https://youtu.be/dQw4w9WgXcQ") == "youtube"
    assert classify_video_url("dQw4w9WgXcQ") == "youtube"            # bare id
    assert classify_video_url("https://www.instagram.com/reel/Cabc123/") == "instagram"
    assert classify_video_url("https://vimeo.com/12345") == "other"
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_persona_teach_video.py -q`
Expected: FAIL — `ImportError: cannot import name 'parse_instagram_url'`.

- [ ] **Step 3: Implement parser + classifier in `teach.py`**

```python
# add near parse_youtube_id
_IG_RE = re.compile(r"instagram\.com/(?:reel|p|tv|stories(?:/[^/]+)?)/([A-Za-z0-9_\-]+)")

def parse_instagram_url(url: str) -> str | None:
    """Extract the IG shortcode from a reel/post/tv/stories URL, else None."""
    if not url:
        return None
    m = _IG_RE.search(url.strip())
    return m.group(1) if m else None

def classify_video_url(url_or_id: str) -> str:
    """Route a shared URL: 'youtube' | 'instagram' | 'other'."""
    if parse_youtube_id(url_or_id):
        return "youtube"
    if parse_instagram_url(url_or_id):
        return "instagram"
    return "other"
```

- [ ] **Step 4: Run to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_persona_teach_video.py -q`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/gapmap/persona/teach.py tests/test_persona_teach_video.py
git commit -m "feat(persona): instagram URL parser + video-source classifier"
```

---

### Task 3: `teach_from_media` (Whisper) — IG/other → posts rows → ingest

**Files:**
- Modify: `src/gapmap/persona/teach.py`
- Test: `tests/test_persona_teach_video.py`

- [ ] **Step 1: Write the failing test** (mock the Whisper fetch + ingest so it's fast/offline)

```python
def test_teach_from_media_streams_and_ingests(monkeypatch):
    import gapmap.persona.teach as T
    # Persona exists
    monkeypatch.setattr(T, "get_persona", lambda pid: {"name": "X", "lens": "x", "active": 1})
    # Whisper fetch returns one transcript row (posts-table shape)
    rows = [{"id": "ig_1", "source_type": "instagram_transcript",
             "title": "", "selftext": "hello world transcript", "permalink": "", "url": "u"}]
    monkeypatch.setattr(T, "_fetch_media_rows", lambda url, **k: rows)
    monkeypatch.setattr(T, "upsert_posts", lambda r: None)
    monkeypatch.setattr(T, "_tag_posts", lambda *a, **k: None)
    monkeypatch.setattr(T, "ingest_persona",
                        lambda pid, **k: iter([{"event": "done", "kept": 1, "dropped": 0, "errors": 0}]))
    evs = list(T.teach_from_media(7, "https://www.instagram.com/reel/Cabc123/"))
    kinds = [e.get("event") for e in evs]
    assert "teach:start" in kinds and "teach:fetched" in kinds and "done" in kinds

def test_teach_from_media_ig_login_error_is_soft(monkeypatch):
    import gapmap.persona.teach as T
    monkeypatch.setattr(T, "get_persona", lambda pid: {"name": "X", "lens": "x", "active": 1})
    def boom(url, **k): raise RuntimeError("login required")
    monkeypatch.setattr(T, "_fetch_media_rows", boom)
    evs = list(T.teach_from_media(7, "https://www.instagram.com/reel/Cabc123/"))
    assert any(e.get("event") == "teach:error" for e in evs)   # surfaced, not raised
    assert evs[-1].get("event") == "done"                       # stream still closes cleanly
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_persona_teach_video.py -q`
Expected: FAIL — `AttributeError: module ... has no attribute 'teach_from_media'`.

- [ ] **Step 3: Implement `_fetch_media_rows` + `teach_from_media`**

Mirror `teach_from_youtube`'s tail exactly (upsert → tag → ingest). Use the row
shape confirmed in Task 1.

```python
def _fetch_media_rows(url: str, *, max_chunks: int = 60) -> list[dict]:
    """Whisper-transcribe any video URL (IG/other) → posts-table rows.
    Heavy import — only when teaching."""
    from ..sources.video import fetch_video   # yt-dlp audio → faster-whisper
    rows = fetch_video(url) or []              # confirm arg/return in Task 1
    return [r for r in rows if r.get("id")][:max_chunks]

def teach_from_media(
    persona_id: int, url: str, *, provider: str | None = None,
) -> Iterator[dict]:
    """Teach one persona from a non-YouTube video (Instagram, etc.) via the
    Whisper transcript path. Same NDJSON event shape as teach_from_youtube."""
    persona = get_persona(persona_id)
    if not persona:
        yield {"event": "error", "error": f"persona id={persona_id} not found"}
        return
    yield {"event": "teach:start", "video_id": url, "url": url}
    try:
        rows = _fetch_media_rows(url)
    except Exception as e:
        msg = str(e)
        hint = (" — Instagram needs a public reel or login cookies"
                if "login" in msg.lower() or "private" in msg.lower() else "")
        yield {"event": "teach:error", "error": f"transcription failed: {msg[:200]}{hint}"}
        yield {"event": "done", "kept": 0, "dropped": 0, "errors": 1}
        return
    if not rows:
        yield {"event": "teach:fetched", "rows": 0, "comments": 0,
               "transcript": 0, "description": 0}
        yield {"event": "done", "kept": 0, "dropped": 0, "errors": 0}
        return
    upsert_posts(rows)
    lens = (persona.get("lens") or "").strip() or f"persona_{persona_id}"
    try:
        _tag_posts(lens, [r["id"] for r in rows], source=f"teach:p{persona_id}:media")
    except Exception as e:
        yield {"event": "teach:error", "error": f"topic tag failed: {e}"}
    yield {"event": "teach:fetched", "rows": len(rows), "comments": 0,
           "transcript": len(rows), "description": 0}
    yield from ingest_persona(persona_id, limit=max(200, len(rows)),
                              provider=provider, post_ids=[r["id"] for r in rows])
```

Note: import `_tag_posts` and `upsert_posts` at module top (already imported for YT).

- [ ] **Step 4: Run to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_persona_teach_video.py -q`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/gapmap/persona/teach.py tests/test_persona_teach_video.py
git commit -m "feat(persona): teach_from_media — Whisper transcript path (Instagram + generic)"
```

---

### Task 4: `teach_from_video` router

**Files:**
- Modify: `src/gapmap/persona/teach.py`
- Test: `tests/test_persona_teach_video.py`

- [ ] **Step 1: Write the failing test**

```python
def test_teach_from_video_routes(monkeypatch):
    import gapmap.persona.teach as T
    monkeypatch.setattr(T, "teach_from_youtube", lambda pid, url, **k: iter([{"event": "yt"}]))
    monkeypatch.setattr(T, "teach_from_media",   lambda pid, url, **k: iter([{"event": "media"}]))
    assert list(T.teach_from_video(1, "https://youtu.be/dQw4w9WgXcQ"))[0]["event"] == "yt"
    assert list(T.teach_from_video(1, "https://www.instagram.com/reel/Cabc/"))[0]["event"] == "media"
    assert list(T.teach_from_video(1, "https://vimeo.com/9"))[0]["event"] == "media"
```

- [ ] **Step 2: Run to verify it fails** — `AttributeError: 'teach_from_video'`.

- [ ] **Step 3: Implement the router**

```python
def teach_from_video(
    persona_id: int, url: str, *, comments_limit: int = 100, provider: str | None = None,
) -> Iterator[dict]:
    """Route a shared video URL to the right teacher: YouTube → captions path,
    everything else → Whisper transcript path. Same event shape either way."""
    kind = classify_video_url(url)
    if kind == "youtube":
        yield from teach_from_youtube(persona_id, url,
                                      comments_limit=comments_limit, provider=provider)
    else:
        yield from teach_from_media(persona_id, url, provider=provider)
```

- [ ] **Step 4: Run to verify it passes** — PASS (5 tests total).

- [ ] **Step 5: Commit**

```bash
git add src/gapmap/persona/teach.py tests/test_persona_teach_video.py
git commit -m "feat(persona): teach_from_video router (YT captions / IG Whisper)"
```

---

### Task 5: CLI — `persona teach-video` accepts any URL

**Files:**
- Modify: `src/gapmap/cli/persona_cmds.py:31` (import), `:167-202` (`cmd_teach_video`)

- [ ] **Step 1:** Change the import on line ~31 from
  `teach_from_youtube as _teach_yt` to also import the router:
  `from ..persona.teach import teach_from_video as _teach_video`.
- [ ] **Step 2:** In `cmd_teach_video` (line 178) replace
  `_teach_yt(persona_id, url, comments_limit=..., provider=...)` with
  `_teach_video(persona_id, url, comments_limit=..., provider=...)`.
  Update the argument help to "YouTube or Instagram URL". Keep all event
  printing as-is (event shapes are identical).
- [ ] **Step 3: Manual smoke (YT, offline-safe metadata only is fine)**

Run: `.venv/bin/python -m gapmap.cli.main persona teach-video 1 "https://youtu.be/dQw4w9WgXcQ" --json 2>&1 | head`
Expected: `teach:start` then `teach:fetched`/`teach:error`/`done` NDJSON (no traceback).

- [ ] **Step 4: Commit**

```bash
git add src/gapmap/cli/persona_cmds.py
git commit -m "feat(cli): persona teach-video accepts YouTube + Instagram URLs"
```

---

### Task 6: Rust streaming command `persona_teach_media`

**Files:**
- Read first: grep existing persona command + a streaming command to copy the pattern:
  `grep -rn "persona" app-tauri/src-tauri/src/commands.rs` and
  `grep -rn "run_cli_streaming\|start_collect" app-tauri/src-tauri/src/{commands,cli}.rs`
- Modify: `app-tauri/src-tauri/src/commands.rs` (add command), `main.rs` (register in `generate_handler!`)

- [ ] **Step 1:** Add a streaming Tauri command that runs
  `["persona", "teach-video", &persona_id.to_string(), &url, "--json"]` via the
  existing streaming helper (`run_cli_streaming` or the persona equivalent),
  emitting `persona:teach:progress` (per stdout line) + `persona:teach:done`.
  Follow the EXACT shape of the nearest existing streaming command in this file
  (collect/chat) — same state-slot discipline (its own slot if long-running;
  Whisper is 30-90s).
- [ ] **Step 2:** Register the fn in `main.rs` `tauri::generate_handler![ … ]`.
- [ ] **Step 3: Verify Rust compiles**

Run: `cd app-tauri/src-tauri && cargo check`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add app-tauri/src-tauri/src/commands.rs app-tauri/src-tauri/src/main.rs
git commit -m "feat(tauri): persona_teach_media streaming command"
```

---

### Task 7: `api.js` wrapper

**Files:**
- Modify: `app-tauri/src/api.js` (follow existing `onCollectProgress`/streaming pattern)

- [ ] **Step 1:** Add `personaTeachMedia(personaId, url)` → `invoke('persona_teach_media', { personaId, url })`
  (camelCase keys — Tauri auto-snake_cases) + `onPersonaTeachProgress(cb)` /
  `onPersonaTeachDone(cb)` listeners mirroring the collect ones.
- [ ] **Step 2: Verify JS parses**

Run: `cd app-tauri && node --input-type=module -e "import('./src/api.js').then(()=>console.log('OK'))"`
Expected: `OK`.

- [ ] **Step 3: Commit**

```bash
git add app-tauri/src/api.js
git commit -m "feat(api): personaTeachMedia + teach progress listeners"
```

---

### Task 8: UI — "Teach from a video" box on the personas screen

**Files:**
- Read first: `app-tauri/src/screens/personas.js` (find the persona-detail render + existing chat UI)
- Modify: `app-tauri/src/screens/personas.js`

- [ ] **Step 1:** In the persona-detail view, add a "Teach from a video"
  section: a URL `<input>` (placeholder "Paste a YouTube or Instagram link") +
  a "Teach" button. On submit: call `api.personaTeachMedia(id, url)`, mount the
  shared alive-loader (`lib/analyzingLoader.js` `renderAnalyzingState` with a
  `runKey: 'teach:'+id`), append `persona:teach:progress` lines to a small log,
  and on `persona:teach:done` clear the loader + refresh the persona's memories
  list. Guard DOM writes with the routeGen `alive()` pattern.
- [ ] **Step 2:** Add a tiny hint line: "YouTube uses captions · Instagram is
  transcribed on-device (first run downloads the model)".
- [ ] **Step 3: Verify build**

Run: `cd app-tauri && npm run build`
Expected: builds; no error.

- [ ] **Step 4: Commit**

```bash
git add app-tauri/src/screens/personas.js
git commit -m "feat(ui): teach a persona from a YouTube/Instagram video"
```

---

### Task 9: Rebuild sidecar + end-to-end smoke

**Files:** none (build + manual verify)

- [ ] **Step 1:** Rebuild the sidecar so the bundled app has the new CLI:
  `bash scripts/build-pyinstaller.sh` → copy to `src-tauri/binaries/` →
  `codesign --force --deep --sign -`.
- [ ] **Step 2:** In dev (`npm run tauri:dev`): create a persona, paste a public
  YouTube URL → teach → confirm memories appear → chat a question → grounded
  answer. Then a public Instagram reel URL → confirm Whisper transcribes →
  memories appear → chat.
- [ ] **Step 3:** Add a changelog `changelogs/YYYY-MM-DD_NN_persona-teach-from-video.md`.
- [ ] **Step 4: Commit**

```bash
git add changelogs/
git commit -m "chore(changelog): persona teach-from-video (YT + Instagram)"
```

---

## Self-Review

- **Spec coverage:** router (T4), YT captions (T4→teach_from_youtube), IG Whisper
  (T3), CLI (T5), Rust (T6), api.js (T7), UI (T8), IG-login soft error (T3),
  no-LLM skip (inherited from `ingest_persona`), sidecar rebuild (T9). Phase-2
  fine-tune is explicitly out of scope per spec.
- **Placeholders:** none — every code step has concrete code; Rust/JS wiring
  tasks point at the exact existing pattern to copy (the codebase's persona +
  streaming-command conventions) rather than guessing private signatures.
- **Type consistency:** `teach_from_video`/`teach_from_media`/`classify_video_url`/
  `parse_instagram_url`/`_fetch_media_rows` names are used consistently across
  tasks; event shapes match `teach_from_youtube`.
- **Open confirm (Task 1 de-risks):** `fetch_video(url)` exact arg + row shape.
```
