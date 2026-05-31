"""teach-from-video: URL routing + Instagram (Whisper) teach path.

YouTube → existing captions path; Instagram/other → Whisper transcript path.
Both converge on the same upsert_posts → _tag_posts → ingest_persona tail, so
persona memory + the mirofish (per-persona ChromaDB) learning are identical
regardless of source. See docs/superpowers/specs/2026-05-31-persona-video-teach-design.md
"""
import gapmap.persona.teach as T


# ── URL parsing + routing ────────────────────────────────────────────────

def test_parse_instagram_url():
    assert T.parse_instagram_url("https://www.instagram.com/reel/Cabc123/") == "Cabc123"
    assert T.parse_instagram_url("https://instagram.com/p/XyZ_9/?igshid=1") == "XyZ_9"
    assert T.parse_instagram_url("https://www.instagram.com/tv/Q-1/") == "Q-1"
    assert T.parse_instagram_url("https://youtu.be/dQw4w9WgXcQ") is None
    assert T.parse_instagram_url("") is None


def test_classify_video_url():
    assert T.classify_video_url("https://youtu.be/dQw4w9WgXcQ") == "youtube"
    assert T.classify_video_url("dQw4w9WgXcQ") == "youtube"            # bare id
    assert T.classify_video_url("https://www.instagram.com/reel/Cabc123/") == "instagram"
    assert T.classify_video_url("https://vimeo.com/12345") == "other"


# ── teach_from_media (Whisper path) ────────────────────────────────────────

def _stub_persona(monkeypatch):
    monkeypatch.setattr(T, "get_persona", lambda pid: {"name": "X", "lens": "x", "active": 1})


def test_teach_from_media_streams_and_ingests(monkeypatch):
    _stub_persona(monkeypatch)
    rows = [{"id": "video:ig1:0", "source_type": "video",
             "title": "", "selftext": "hello world transcript", "permalink": "", "url": "u"}]
    monkeypatch.setattr(T, "_fetch_media_rows", lambda url, **k: rows)
    monkeypatch.setattr(T, "upsert_posts", lambda r: None)
    monkeypatch.setattr(T, "_tag_posts", lambda *a, **k: None)
    monkeypatch.setattr(T, "ingest_persona",
                        lambda pid, **k: iter([{"event": "done", "kept": 1, "dropped": 0, "errors": 0}]))
    kinds = [e.get("event") for e in T.teach_from_media(7, "https://www.instagram.com/reel/Cabc123/")]
    assert "teach:start" in kinds
    assert "teach:fetched" in kinds
    assert "done" in kinds


def test_teach_from_media_ig_login_error_is_soft(monkeypatch):
    _stub_persona(monkeypatch)
    def boom(url, **k):
        raise RuntimeError("login required")
    monkeypatch.setattr(T, "_fetch_media_rows", boom)
    evs = list(T.teach_from_media(7, "https://www.instagram.com/reel/Cabc123/"))
    assert any(e.get("event") == "teach:error" for e in evs)   # surfaced, not raised
    assert evs[-1].get("event") == "done"                       # stream closes cleanly
    assert evs[-1].get("errors") == 1


def test_teach_from_media_empty_transcript(monkeypatch):
    _stub_persona(monkeypatch)
    monkeypatch.setattr(T, "_fetch_media_rows", lambda url, **k: [])
    evs = list(T.teach_from_media(7, "https://www.instagram.com/reel/Cabc123/"))
    assert evs[-1] == {"event": "done", "kept": 0, "dropped": 0, "errors": 0}


# ── router ──────────────────────────────────────────────────────────────────

def test_teach_from_video_routes(monkeypatch):
    monkeypatch.setattr(T, "teach_from_youtube", lambda pid, url, **k: iter([{"event": "yt"}]))
    monkeypatch.setattr(T, "teach_from_media",   lambda pid, url, **k: iter([{"event": "media"}]))
    assert list(T.teach_from_video(1, "https://youtu.be/dQw4w9WgXcQ"))[0]["event"] == "yt"
    assert list(T.teach_from_video(1, "https://www.instagram.com/reel/Cabc/"))[0]["event"] == "media"
    assert list(T.teach_from_video(1, "https://vimeo.com/9"))[0]["event"] == "media"
