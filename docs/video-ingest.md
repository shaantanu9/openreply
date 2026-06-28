# OpenReply — Video Ingest via yt-dlp + faster-whisper (Technical Design)

**Status:** Design complete, implementation scheduled in 5 passes.
**Last updated:** 2026-04-21
**Scope:** Lets OpenReply accept any video URL (YouTube, Vimeo, podcast MP4, conference talks, any site `yt-dlp` supports) → pull audio → transcribe locally with Whisper → land the transcript in `posts` so it flows through corpus → graph → Report like any other source. Models are user-downloaded on demand; yt-dlp auto-updates on every launch.

---

## 0. Design goals

1. **Any public video link → research row.** One input box: paste URL. Everything else is automated.
2. **Local-only transcription.** Audio never leaves the user's Mac. Whisper runs on the bundled Python sidecar.
3. **Minimal DMG size.** Don't bundle 3 GB of model weights — let the user pick tier, download on first use. `yt-dlp` + `ffmpeg` + `faster-whisper` library code are bundled (non-negotiable); **model weights are not.**
4. **Always-current yt-dlp.** YouTube breaks yt-dlp roughly monthly. Auto-update on every app launch (24h cooldown), gracefully fall back to bundled version if update fails.
5. **Quality-tunable.** Default to `small.en` (balance); user can escalate to `medium.en` or `large-v3` for accents / noisy audio.
6. **Auto language detection.** No language picker required — Whisper detects from the first 30 s of audio.
7. **Re-ingestible.** Same video URL → cached transcript → instant re-use (no re-download, no re-transcribe).
8. **Pro feature.** Gated by the offline licensing system (`docs/licensing.md`). Trial users get 3 videos; expired trial = disabled.

---

## 1. Architecture at a glance

```
 ┌──────────────────────────────────────────────────────────┐
 │  INGEST SCREEN / VIDEO TAB  (webview)                    │
 │                                                          │
 │  [ paste URL ] → preview (title, duration, thumbnail,    │
 │                   detected lang, est transcription time) │
 │     │                                                    │
 │     ▼ user picks model (or auto) + confirms topic       │
 │  invoke('ingest_video', { url, topic, model, language }) │
 └──────────────────────────────────────────────────────────┘
                            │
                            ▼
 ┌──────────────────────────────────────────────────────────┐
 │  RUST COMMAND  commands::ingest_video                    │
 │                                                          │
 │   run_cli_streaming(['ingest','video','--url',...])      │
 │   emits events:  video:progress  /  video:done           │
 └──────────────────────────────────────────────────────────┘
                            │
                            ▼
 ┌──────────────────────────────────────────────────────────┐
 │  PYTHON SIDECAR  reddit_research.sources.video           │
 │                                                          │
 │   ┌─ ensure_latest_ytdlp()  (24h cooldown)               │
 │   │    → pip install --target ytdlp-overlay/  if newer    │
 │   │                                                      │
 │   ┌─ yt_dlp.extract_info(url)    ─ metadata              │
 │   │                                                      │
 │   ┌─ yt_dlp.download(url)        ─ .m4a into audio-cache/│
 │   │       (uses BUNDLED ffmpeg via --ffmpeg-location)    │
 │   │                                                      │
 │   ┌─ faster_whisper.transcribe(audio,                    │
 │   │        model_path=whisper-models/<tier>/,            │
 │   │        vad_filter=True, language=None(=auto))        │
 │   │                                                      │
 │   ┌─ write transcripts/<video_id>.json + .srt            │
 │   │                                                      │
 │   ┌─ chunk transcript → 500-char segments w/ timestamps  │
 │   │                                                      │
 │   ┌─ INSERT into posts  (source_type='video')            │
 │   ┌─ INSERT into topic_posts                             │
 │   ┌─ INSERT into graph_nodes (kind='post')               │
 │   └─ emit progress events back to Tauri                  │
 └──────────────────────────────────────────────────────────┘
                            │
                            ▼
 ┌──────────────────────────────────────────────────────────┐
 │  DOWNSTREAM (unchanged)                                  │
 │   → research/collect merging                             │
 │   → graph/build structural                               │
 │   → graph/semantic enrichment (LLM painpoints etc.)      │
 │   → Evidence tab shows transcript quote + timestamp      │
 │   → "Jump to quote" opens URL?t=<seconds>                │
 └──────────────────────────────────────────────────────────┘
```

---

## 2. What's bundled vs downloaded

| Component | Bundled? | Size | Why |
|---|---|---|---|
| `yt-dlp` Python wheel | ✅ fallback-only | ~2 MB | fallback; real version lives in user-writable overlay |
| `ffmpeg` static binary (arm64 + x86_64 universal) | ✅ | ~30 MB | required by yt-dlp for audio extraction; not asking users to `brew install` |
| `faster-whisper` library code | ✅ | ~10 MB | CT2 runtime + Python bindings |
| `huggingface_hub` | ✅ | ~1 MB | model snapshot downloader |
| **Whisper model weights** | ❌ **user-downloaded** | 75 MB → 2.9 GB | bundling would quadruple DMG; user picks the tier they need |

**DMG delta:** +~40 MB (ffmpeg + whisper libs). Acceptable for the value add.

---

## 3. Model tiers (HuggingFace direct — `Systran/faster-whisper-*`)

| Tier | Size | M1 realtime factor | Quality | When to recommend |
|---|---|---|---|---|
| `tiny.en` | 75 MB | ~0.1× | low | throwaway draft / 1-hour podcast |
| `base.en` | 145 MB | ~0.2× | decent | casual notes |
| **`small.en`** ⭐ | **480 MB** | **~0.5×** | **good** | **default — recommended in-app** |
| `medium.en` | 1.5 GB | ~1× | great | accents / jargon |
| `large-v3` | 2.9 GB | ~2× | best, multilingual | serious research, non-English audio |

All model repos are public on HuggingFace (`Systran/faster-whisper-<tier>`). No token required.

Rationale for defaulting to `small.en`:
- On M1/M2 MacBook Air (CPU-only), transcribes a 60-min talk in ~30 min — tolerable.
- Quality indistinguishable from `medium.en` for clear English audio.
- Heavy-lift users can escalate to `medium.en` / `large-v3` from the Settings card.

---

## 4. Storage layout

```
~/Library/Application Support/com.shantanu.openreply/reddit-myind/
    whisper-models/
        small.en/                   ← user-downloaded; from Systran/faster-whisper-small.en
            model.bin
            tokenizer.json
            vocabulary.txt
            config.json
            .downloaded_at          ← ISO timestamp + SHA record
        medium.en/                  ← later, when user picks it

    transcripts/
        <video_id>.json             ← list of {start, end, text, chunk_idx}
        <video_id>.srt              ← SubRip for UI timestamp display

    audio-cache/
        <video_id>.m4a              ← intermediate; purged after transcription

    ytdlp-overlay/
        yt_dlp/                     ← user-writable pip target; prepended to sys.path
        yt_dlp-2026.4.20.dist-info/
        .last-check                 ← epoch seconds; 24h cooldown

    video-meta/
        <video_id>.json             ← cached {title, duration, channel, uploaded,
                                        thumbnail_url, language_detected, model_used}
```

**Permissions:** every new file `chmod 600` where privacy-relevant (transcripts potentially contain sensitive speech).

**Video ID:** normalized — for YouTube use the `v=` param; for other sites use the SHA-1 of the canonical URL. Guarantees the same link never re-downloads.

---

## 5. End-to-end flow (data + control)

### 5.1 User pastes URL → preview

```
URL pasted → webview calls api.videoPreview(url)
             → Rust ingest_video_preview → sidecar:
                 • ensure_latest_ytdlp()    (non-blocking bg if > 24h)
                 • yt_dlp.extract_info(url, download=False)
                 • returns {title, duration_s, channel, upload_date,
                           thumbnail_url, est_time_by_tier[], detected_lang}
             → webview renders preview card
```

`est_time_by_tier` is `duration_s × realtime_factor` for each tier the user has installed — so "This 47-min talk will take ~24 min with small.en, ~47 min with medium.en." is shown up front. No surprise waits.

### 5.2 User confirms → transcription pipeline

```
invoke('ingest_video', { url, topic, model:'small.en'|'auto', language:'auto' })
   │
   ▼ Rust spawns sidecar streaming command
   │
┌──▼────────────────────────────────────────────────────────────┐
│ 1. check Whisper model exists                                 │
│    missing → emit {stage:'error', reason:'model_not_installed',│
│                     action:'open_settings'}                   │
│                                                               │
│ 2. yt_dlp.download(url, format='bestaudio[ext=m4a]',          │
│                    ffmpeg_location=<bundled>)                 │
│    emit video:progress {stage:'download', pct}                │
│                                                               │
│ 3. faster_whisper.WhisperModel(                               │
│       model_path, device='cpu', compute_type='int8')          │
│    segments, info = model.transcribe(                         │
│       audio_path, beam_size=1, vad_filter=True,               │
│       language=None if lang=='auto' else lang)                │
│    emit video:progress {stage:'transcribe', pct}  per segment │
│                                                               │
│ 4. write transcripts/<id>.json + .srt                         │
│                                                               │
│ 5. chunk transcript → N segments of ≤500 chars, breaking on   │
│    sentence boundaries, preserving {start_ts, end_ts}         │
│                                                               │
│ 6. INSERT into posts for each chunk:                          │
│    id          = 'video:<video_id>:<chunk_idx>'               │
│    source_type = 'video'                                      │
│    sub         = <normalized channel name>                    │
│    title       = <video title>                                │
│    selftext    = <chunk text>                                 │
│    url         = <canonical URL>#t=<start_ts>                 │
│    created_utc = <upload_date epoch>                          │
│    metadata_json = {                                          │
│       duration_s, language, timestamp_start, timestamp_end,   │
│       model_used, chunk_idx, chunk_total                      │
│    }                                                          │
│                                                               │
│ 7. INSERT into topic_posts (if topic given)                   │
│ 8. INSERT into graph_nodes (kind='post') per chunk            │
│                                                               │
│ 9. purge audio-cache/<video_id>.m4a (keep transcript + meta)  │
│                                                               │
│ emit video:done {chunks_added, transcript_path,               │
│                  model_used, elapsed_s}                       │
└───────────────────────────────────────────────────────────────┘
```

### 5.3 Re-ingest of a known URL

```
URL pasted → video_id normalized → transcripts/<id>.json exists?
  └─ yes:  read cached chunks → INSERT (idempotent via id PK) → done in <1s
  └─ no:   run full pipeline from step 2
```

### 5.4 Evidence tab "Jump to quote"

Each post row's `url` field is `https://youtu.be/<id>?t=<start_ts>` so clicking it in the Evidence panel opens the video at the quoted timestamp directly.

---

## 6. yt-dlp auto-update mechanism

### 6.1 Why

YouTube's DASH / cipher rotations break yt-dlp's signature extractor roughly every 2–4 weeks. A 30-day-old yt-dlp starts failing with `Unable to extract sig`. We cannot ship a new DMG that fast. Solution: pip-install the latest stable into a user-writable dir, prepend to `sys.path`.

### 6.2 The overlay trick

```
┌─────────────────────────────────────────────────────────────┐
│ sidecar Python startup                                      │
│                                                             │
│   import sys                                                │
│   sys.path.insert(0, OVERLAY_DIR)   # user-writable         │
│   import yt_dlp                     # picks overlay > bundled│
│                                                             │
│   ensure_latest_ytdlp()  # bg thread, fire-and-forget       │
└─────────────────────────────────────────────────────────────┘
```

Bundled wheel lives inside the PyInstaller binary (read-only, codesigned, cannot modify). Overlay dir is in user Application Support — writable, not part of the signed bundle → updating it doesn't invalidate the codesignature.

### 6.3 Update check pseudocode

```python
# src/reddit_research/transcribe/ytdlp_client.py
import json, os, subprocess, sys, time, urllib.request
from pathlib import Path

OVERLAY_DIR = Path(os.environ["REDDIT_MYIND_DATA_DIR"]) / "ytdlp-overlay"
COOLDOWN_S  = 24 * 3600

def ensure_latest_ytdlp() -> dict:
    OVERLAY_DIR.mkdir(parents=True, exist_ok=True)
    if OVERLAY_DIR / "yt_dlp" not in sys.path:
        sys.path.insert(0, str(OVERLAY_DIR))

    stamp = OVERLAY_DIR / ".last-check"
    if stamp.exists() and (time.time() - stamp.stat().st_mtime < COOLDOWN_S):
        return {"ok": True, "skipped": True, "reason": "cooldown"}

    try:
        import yt_dlp
        installed = yt_dlp.version.__version__
    except Exception:
        installed = "0"

    try:
        with urllib.request.urlopen(
            "https://pypi.org/pypi/yt-dlp/json", timeout=5
        ) as r:
            latest = json.load(r)["info"]["version"]
    except Exception as e:
        return {"ok": False, "reason": f"pypi_unreachable: {e}"}

    if _is_newer(latest, installed):
        try:
            subprocess.check_call([
                sys.executable, "-m", "pip", "install",
                "--upgrade", "--target", str(OVERLAY_DIR),
                "--no-deps", "yt-dlp",
            ], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
            stamp.touch()
            return {"ok": True, "updated": True,
                    "from": installed, "to": latest}
        except Exception as e:
            return {"ok": False, "reason": f"pip_install_failed: {e}"}

    stamp.touch()
    return {"ok": True, "updated": False, "installed": installed}
```

### 6.4 When it runs

- **On every sidecar cold-start** — non-blocking background thread (`threading.Thread(daemon=True)`).
- Enforces 24h cooldown via `.last-check` stamp so we don't hammer PyPI on every sidecar spawn (the Tauri app can invoke several per session).
- **Manual trigger:** `reddit-cli ytdlp update` bypasses the cooldown.

### 6.5 Failure modes — graceful fallback matrix

| Failure | Effect |
|---|---|
| PyPI unreachable (offline) | falls back to bundled yt-dlp, no error |
| pip install fails (permissions, disk full) | falls back to bundled, logs warning |
| Overlay yt-dlp import crashes (new version incompatible) | `sys.path` rollback: remove overlay → re-import bundled |
| yt-dlp itself fails on a URL | surfaces error class `ytdlp_failed` to UI, suggests `reddit-cli ytdlp update --force` |

---

## 7. HuggingFace model download flow

### 7.1 Catalogue (hardcoded)

```python
# src/reddit_research/transcribe/models.py
MODELS = {
    "tiny.en":   {"repo": "Systran/faster-whisper-tiny.en",    "size_mb": 75,   "rtf": 0.10},
    "base.en":   {"repo": "Systran/faster-whisper-base.en",    "size_mb": 145,  "rtf": 0.20},
    "small.en":  {"repo": "Systran/faster-whisper-small.en",   "size_mb": 480,  "rtf": 0.50},
    "medium.en": {"repo": "Systran/faster-whisper-medium.en",  "size_mb": 1500, "rtf": 1.00},
    "large-v3":  {"repo": "Systran/faster-whisper-large-v3",   "size_mb": 2900, "rtf": 2.00},
}
DEFAULT_TIER = "small.en"
```

`rtf` = realtime factor (seconds of CPU per second of audio). Used for ETA estimates in UI.

### 7.2 Download

```python
from huggingface_hub import snapshot_download

def download_model(tier: str, progress_cb=None) -> Path:
    info = MODELS[tier]
    local_dir = MODELS_ROOT / tier
    local_dir.mkdir(parents=True, exist_ok=True)
    snapshot_download(
        repo_id=info["repo"],
        local_dir=str(local_dir),
        local_dir_use_symlinks=False,
        # TQDM progress converted to stream events via a custom wrapper
        tqdm_class=_ProgressStreamTqdm(progress_cb),
    )
    (local_dir / ".downloaded_at").write_text(
        f"{datetime.now(timezone.utc).isoformat()}\ntier={tier}\n"
    )
    return local_dir
```

`huggingface_hub.snapshot_download` handles:
- resume on interrupt (pulls only missing files on retry)
- CDN fallback (HuggingFace load-balances across regions)
- integrity check via ETag

### 7.3 Progress streaming

Wrap `tqdm` to emit `whisper:download-progress` events:
```json
{ "tier": "small.en", "downloaded_bytes": 187434496, "total_bytes": 503316480, "pct": 37.2, "speed_bps": 8300000 }
```
UI renders a progress bar + ETA.

### 7.4 Integrity check

Post-download verify:
- `model.bin` file size matches `size_mb` ± 5%.
- If mismatch: delete directory, retry once, then surface error.

### 7.5 Offline mode

`HF_HUB_OFFLINE=1` set after any successful download → prevents future HuggingFace calls. Transcription reads straight from local files.

---

## 8. Python module layout

```
src/reddit_research/
    transcribe/
        __init__.py           # re-exports: transcribe_audio, download_model,
                              #             list_models, delete_model,
                              #             ensure_latest_ytdlp
        whisper.py            # faster-whisper wrapper
        models.py             # catalogue, download, list, delete
        ytdlp_client.py       # auto-update + extract_info + download audio
        chunker.py            # sentence-aware 500-char chunker

    sources/
        video.py              # fetch_video(url, topic, model, language) -> list[row]
                              # (matches the signature of every other source adapter)
```

### 8.1 `transcribe/whisper.py` contract

```python
from faster_whisper import WhisperModel
from dataclasses import dataclass

@dataclass
class Segment:
    start: float   # seconds
    end:   float
    text:  str

def transcribe_audio(
    audio_path: Path,
    model_tier: str = "small.en",
    language: str | None = None,    # None = auto-detect
    progress_cb=None,
) -> tuple[list[Segment], dict]:
    """
    Returns (segments, info) where info is
      {language, language_probability, duration, model_used, elapsed_s}
    """
    model_dir = MODELS_ROOT / model_tier
    if not model_dir.exists():
        raise FileNotFoundError(
            f"Whisper model {model_tier!r} not installed. "
            f"Run `reddit-cli whisper download {model_tier}`."
        )
    model = WhisperModel(
        str(model_dir),
        device="cpu",
        compute_type="int8",        # CT2 quantized — 4× faster, same quality
        num_workers=1,
    )
    seg_iter, info = model.transcribe(
        str(audio_path),
        beam_size=1,
        vad_filter=True,            # drops silence; big speedup on podcasts
        language=language,          # None → auto
    )
    segs = []
    total_dur = info.duration or 1.0
    for s in seg_iter:
        segs.append(Segment(s.start, s.end, s.text.strip()))
        if progress_cb:
            progress_cb(s.end / total_dur)
    return segs, {
        "language": info.language,
        "language_probability": round(info.language_probability, 3),
        "duration": info.duration,
        "model_used": model_tier,
    }
```

### 8.2 `transcribe/chunker.py` contract

```python
def chunk_segments(segments: list[Segment], max_chars: int = 500) -> list[dict]:
    """Group consecutive segments into ≤max_chars chunks.
    Breaks on sentence boundaries where possible. Preserves first segment's
    start_ts + last segment's end_ts so 'jump to quote' links stay accurate.

    Returns list of {chunk_idx, text, timestamp_start, timestamp_end}.
    """
```

### 8.3 `sources/video.py` contract

```python
def fetch_video(
    url: str,
    topic: str | None = None,
    model: str = "auto",              # 'auto' → read default from disk
    language: str | None = None,      # None → auto-detect
    progress_cb=None,
) -> list[dict]:
    """
    Returns rows in the canonical `posts`-table shape, same as every other
    source adapter. Caller (CLI / MCP / Tauri) handles the INSERT.
    """
```

---

## 9. CLI surface

```
reddit-cli ingest video \
    --url "https://youtu.be/dQw4w9WgXcQ" \
    --topic "music streaming" \
    [--model small.en|auto] \
    [--language auto|en|es|...] \
    [--json]

reddit-cli whisper list                      # JSON with installed tiers + sizes
reddit-cli whisper download <tier>           # snapshot_download with progress
reddit-cli whisper delete <tier>
reddit-cli whisper default <tier>            # set the 'auto' resolver
reddit-cli whisper info                      # catalogue + installed state

reddit-cli ytdlp version                     # prints installed + latest
reddit-cli ytdlp update                      # force update, ignoring cooldown
```

All support `--json` for Rust invocation.

---

## 10. Rust commands

### 10.1 New commands

```rust
// app-tauri/src-tauri/src/commands.rs

#[tauri::command]
pub async fn ingest_video_preview(url: String) -> Result<Value, String> {
    run_cli(&app_handle, vec![
        "ingest", "video", "--url", &url, "--preview", "--json",
    ]).await.map_err(err_to_string)
}

#[tauri::command]
pub async fn ingest_video(
    app: AppHandle,
    url: String,
    topic: Option<String>,
    model: Option<String>,       // "auto" | "small.en" | ...
    language: Option<String>,    // "auto" | "en" | ...
) -> Result<(), String> {
    let mut args = vec!["ingest", "video", "--url", &url];
    if let Some(t) = topic.as_deref()    { args.push("--topic");    args.push(t); }
    if let Some(m) = model.as_deref()    { args.push("--model");    args.push(m); }
    if let Some(l) = language.as_deref() { args.push("--language"); args.push(l); }
    run_cli_streaming(&app, args, "video:progress", "video:done")
        .await.map_err(err_to_string)
}

#[tauri::command]
pub async fn whisper_list() -> Result<Value, String> { /* ... */ }

#[tauri::command]
pub async fn whisper_download(
    app: AppHandle, tier: String,
) -> Result<(), String> {
    run_cli_streaming(&app,
        vec!["whisper", "download", &tier],
        "whisper:download-progress", "whisper:download-done"
    ).await.map_err(err_to_string)
}

#[tauri::command]
pub async fn whisper_delete(tier: String) -> Result<Value, String> { /* ... */ }

#[tauri::command]
pub async fn whisper_set_default(tier: String) -> Result<Value, String> { /* ... */ }

#[tauri::command]
pub async fn ytdlp_version() -> Result<Value, String> { /* ... */ }

#[tauri::command]
pub async fn ytdlp_update(app: AppHandle) -> Result<Value, String> { /* ... */ }
```

### 10.2 Registration (main.rs — the "command triangle")

```rust
.invoke_handler(tauri::generate_handler![
    /* ...existing... */
    commands::ingest_video_preview,
    commands::ingest_video,
    commands::whisper_list,
    commands::whisper_download,
    commands::whisper_delete,
    commands::whisper_set_default,
    commands::ytdlp_version,
    commands::ytdlp_update,
])
```

### 10.3 JS bindings (api.js)

```js
// app-tauri/src/api.js
videoPreview:   (url)                              => invoke('ingest_video_preview', { url }),
ingestVideo:    (url, topic, model, language)      => {
  invalidate('list_topics', 'overview_stats', 'get_findings', 'run_query');
  return invoke('ingest_video', { url, topic, model, language });
},
whisperList:    ()           => cachedInvoke('whisper_list', null, 10_000),
whisperDownload: (tier)      => invoke('whisper_download', { tier }),
whisperDelete:  (tier)       => { invalidate('whisper_list'); return invoke('whisper_delete', { tier }); },
whisperSetDefault: (tier)    => { invalidate('whisper_list'); return invoke('whisper_set_default', { tier }); },
ytdlpVersion:   ()           => cachedInvoke('ytdlp_version', null, 60_000),
ytdlpUpdate:    ()           => invoke('ytdlp_update'),
```

---

## 11. UI — Ingest screen Video tab

### 11.1 Layout

```
┌──────────────────────────────────────────────────────────────┐
│ Ingest                                                       │
│  [ PDF ]  [ CSV / JSON ]  [ Video URL ]  [ Plain text ]     │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  Video URL                                             │ │
│  │  [ https://youtu.be/...                             ]  │ │
│  │  [ Preview ]                                           │ │
│  │                                                        │ │
│  │  ─── once preview loads ─────────────────────────────  │ │
│  │  🎬 "How we built our ATS checker"  · 47:32 · by       │ │
│  │     Channel X · uploaded 2025-11-04                    │ │
│  │  Detected language: en (0.99)                          │ │
│  │                                                        │ │
│  │  Model: [small.en ▼]  Language: [auto ▼]               │ │
│  │  ETA: ~24 min                                          │ │
│  │                                                        │ │
│  │  Topic: [ freelance invoicing ▼ ]                      │ │
│  │  [ Transcribe & Ingest ]                               │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  ── progress log (appears after Transcribe click) ─────────  │
│  [========           ] 38% · downloading audio …            │
│  [===                ]  5% · transcribing with small.en …   │
└──────────────────────────────────────────────────────────────┘
```

### 11.2 Model dropdown contents

- Shows only **installed** tiers + `auto` (which resolves to user's default).
- Below the dropdown, a link: `"Install more models →"` → routes to Settings Whisper card.
- If no model installed: dropdown disabled, replaces preview with a CTA: *"Install Whisper small.en (480 MB) to transcribe videos →"*.

### 11.3 Events listened

```js
const un1 = await listen('video:progress', (e) => appendLine(e.payload.msg));
const un2 = await listen('video:done',     (e) => {
  if (e.payload.ok) { /* success UI */ }
  else              { /* error + retry */ }
});
```

---

## 12. UI — Settings "Whisper models" card

### 12.1 Layout

```
┌──────────────────────────────────────────────────────────────┐
│ Whisper models (for video transcription)                     │
│                                                              │
│  Installed                                                   │
│    ● small.en    (480 MB, recommended)  [Set as default]     │
│                                           [Delete]           │
│                                                              │
│  Available to install                                        │
│    ○ tiny.en     (75 MB,  0.1× realtime)  [Download]         │
│    ○ base.en     (145 MB, 0.2× realtime)  [Download]         │
│    ○ medium.en   (1.5 GB, 1.0× realtime)  [Download]         │
│    ○ large-v3    (2.9 GB, 2.0× realtime)  [Download]         │
│                                                              │
│  Pick `medium.en` or `large-v3` if you need maximum accuracy │
│  on accents or noisy audio. `small.en` is fine for most      │
│  clear-English talks and podcasts.                           │
│                                                              │
│  ── yt-dlp auto-updater ──────────────────────────────────   │
│   Installed: 2026.4.19     Latest: 2026.4.20                 │
│   Auto-update on launch:  ● on                               │
│   [Check for update now]                                     │
└──────────────────────────────────────────────────────────────┘
```

### 12.2 Download UX

- Click Download → inline progress bar with % + MB/s + ETA.
- Cancellable via a Stop button.
- On success → the row moves to Installed section.
- On failure → inline error, Retry button.

---

## 13. Database + existing pipeline integration

### 13.1 `posts` schema — no migrations

Rows land in the existing table with `source_type='video'`. Every consumer already handles arbitrary source_types:
- `research/collect::corpus_for` — source-agnostic SQL.
- `graph/build::build_structural` — already routes non-reddit sources through the "source" container kind (see `source_type != 'reddit'` branch in `build.py`).
- `graph/semantic::enrich_from_llm` → `find_gaps` → `_format_corpus` — uses source-type as a prefix in the LLM prompt so video transcripts carry a `[video:<id>]` marker: the LLM can weight primary-source interview quotes higher than Reddit anecdotes.
- Evidence tab `metadata_json` rendering already handles arbitrary keys.

### 13.2 Reserved `source_type` values (existing + new)

```
reddit, hn, appstore, playstore, scholar, arxiv, pubmed, openalex,
devto, lemmy, mastodon, gnews, stackoverflow, trends, github_trending,
github_issues, discourse, wikipedia, youtube_comments, producthunt,
ingest, video           ← NEW
```

(`youtube_comments` already existed — that's the comments adapter. `video` is a full transcript row.)

### 13.3 `url` field convention

`https://youtu.be/<id>?t=<start_ts>` — the t-parameter is the chunk start timestamp in seconds, so "Jump to quote" opens the video at the right moment.

### 13.4 Evidence-panel rendering

Uses existing metadata-pill logic. New pills specific to video:
- 🎬 duration (e.g. "47:32")
- 🗣️ detected language
- ⏱️ timestamp range (e.g. "@ 12:04 – 12:19")
- Click → open URL in system browser.

---

## 14. Licensing gate

Video ingest is a **Pro feature** per `docs/licensing.md` §7.2:

| State | Video ingest |
|---|---|
| Trial (14 days) | ✅ unlimited |
| Trial expired, no license | ❌ disabled (banner: "Transcribing videos is a Pro feature. Add a license or start a trial.") |
| Licensed (any tier) | ✅ unlimited |

Gate enforced in two places:
1. Ingest screen Video tab → `canIngestVideo()` check before enabling the "Transcribe" button.
2. CLI `ingest video` → reads license.json + trial state; refuses with exit code 77 if ungated.

This does double duty: real piracy deterrent *and* matches the "serious research" positioning of Desktop Pro.

---

## 15. Error-class matrix

All errors emit `video:done` with `{ok:false, error_class, message, hint}`. UI toasts the hint with an actionable CTA.

| `error_class` | When | Hint |
|---|---|---|
| `url_unsupported` | yt-dlp can't handle the domain | "Paste a direct YouTube / Vimeo / m4a URL" |
| `url_private` | video is members-only / age-restricted | "Private or age-restricted; sign in via yt-dlp cookies (CLI only)" |
| `ytdlp_failed` | extractor broken, general yt-dlp error | "Run `reddit-cli ytdlp update --force` then retry" |
| `ffmpeg_missing` | bundled ffmpeg not resolvable | "Reinstall the app — bundled ffmpeg missing" |
| `model_not_installed` | whisper model dir missing | "Install a Whisper model in Settings" (CTA opens Settings) |
| `disk_full` | < size_mb × 1.1 free | "Free at least {size} MB" |
| `transcribe_crashed` | faster-whisper raised | "Try a smaller model (tiny.en / base.en)" |
| `license_required` | Pro gate | "Start a trial or add a license in Settings" |
| `network` | yt-dlp download failed mid-stream | "Check connection and retry" |
| `unknown` | catch-all | "Inspect the CLI log and file a bug" |

---

## 16. Performance + resource notes

- **Single-threaded transcription** — `num_workers=1` to stay nice with other sidecar work (enrichment, collect).
- **VAD filter ON by default** — skips silence, ~30% speedup on podcasts with pauses.
- **`int8` quantization** — CT2's default; indistinguishable from fp16 for English; fits in RAM on 8 GB Macs even for `medium.en`.
- **Audio format** — `bestaudio[ext=m4a]` for yt-dlp → no secondary transcoding pass by ffmpeg.
- **Audio cache purge** — kept only during the transcription run, deleted on success. Can disable purge via env `KEEP_VIDEO_AUDIO=1` for debugging.
- **Parallel videos** — out-of-scope for v1; enrichment already monopolizes the ActiveGraphOps slot. Queue behavior tracked as follow-up.

---

## 17. Attack / abuse surface

| Concern | Mitigation |
|---|---|
| Malicious video URL causes RCE via yt-dlp | yt-dlp runs in the sidecar sandbox; no shell interpolation on URL (passed as array arg) |
| yt-dlp extractor executes remote JS on YouTube | Known risk of any yt-dlp install; auto-update minimizes exposure window. No other mitigation practical. |
| HuggingFace MITM | snapshot_download uses HTTPS + ETag checks; size verification post-download; no auth tokens sent |
| 30 GB video dumped into audio-cache | `audio-cache/` is purged after each run; add a startup sweep that deletes files > 24h old in case of crashed run |
| User transcribes copyrighted material | User problem, not ours; we're a tool, same posture as yt-dlp itself |

---

## 18. Testing strategy

### 18.1 Python unit tests (`tests/transcribe/`)

- `test_models_catalogue.py` — MODELS dict integrity, tier names, rtf > 0.
- `test_chunker.py` — sentence-boundary chunking with a fixed input; 500-char cap; timestamp preservation.
- `test_ytdlp_client.py` — `_is_newer()` semver compare; `.last-check` cooldown logic; overlay path injection.
- `test_whisper.py` — mock `WhisperModel`, verify we pass `device='cpu'`, `compute_type='int8'`, `vad_filter=True`.

### 18.2 Integration (local only, requires model + net)

- `test_e2e_short_clip.py` — marked `@pytest.mark.slow`; uses a 30-second CC-licensed clip on HuggingFace; asserts transcript non-empty and contains an expected word. Skipped in CI.

### 18.3 Rust tests

- Command registration triangle — compile-time check (won't build if main.rs → commands.rs mismatch).

### 18.4 Manual smoke test

1. Fresh install → Settings → Whisper → Download `small.en` → progress bar reaches 100% → row moves to "Installed".
2. Ingest → Video URL → paste a YouTube link → Preview shows title + duration.
3. Click Transcribe → progress log shows `download 100% → transcribe 0%→100% → done`.
4. Switch to topic → Evidence tab → transcript chunks appear under Painpoints / Features per what the LLM extracts.
5. Click "Jump to quote" on a chunk → browser opens YouTube at the right timestamp.
6. Re-paste the same URL → completes in <1 s (cached).

---

## 19. Implementation passes

### Pass 1 — Python backend + CLI (no UI)
- [ ] `src/reddit_research/transcribe/` package (whisper.py, models.py, ytdlp_client.py, chunker.py, `__init__.py`).
- [ ] `src/reddit_research/sources/video.py`.
- [ ] `pyproject.toml` add: `yt-dlp`, `faster-whisper`, `huggingface_hub`.
- [ ] `reddit-cli.spec` hiddenimports update.
- [ ] CLI subcommands: `ingest video`, `whisper {list,download,delete,default,info}`, `ytdlp {version,update}`.
- [ ] Unit tests.
- [ ] Smoke: `reddit-cli whisper download tiny.en && reddit-cli ingest video --url <test>`.

### Pass 2 — Bundle ffmpeg + yt-dlp overlay
- [ ] Drop `ffmpeg-aarch64-apple-darwin` (static, from `evermeet.cx/ffmpeg/` or `osxexperts.net`) into `app-tauri/src-tauri/binaries/`.
- [ ] `tauri.conf.json` externalBin entry + capabilities.
- [ ] yt-dlp calls pass `--ffmpeg-location <resolved bundled binary path>`.
- [ ] `ensure_latest_ytdlp()` wired into sidecar cold-start (background thread).

### Pass 3 — Rust commands + events
- [ ] All 8 commands in commands.rs.
- [ ] Registration in main.rs::generate_handler.
- [ ] JS bindings in api.js.
- [ ] Progress event streaming from Python stdout → Rust → webview.

### Pass 4 — Ingest screen Video tab
- [ ] New tab in `app-tauri/src/screens/ingest.js`.
- [ ] Preview card, model dropdown, ETA estimator.
- [ ] Progress log + event listeners.
- [ ] License-gate check.

### Pass 5 — Settings Whisper card
- [ ] New card in `app-tauri/src/screens/settings.js`.
- [ ] Installed / Available sections with download / delete / set-default.
- [ ] yt-dlp auto-updater status + manual trigger.

---

## 20. Files touched summary

**New files:**
- `src/reddit_research/transcribe/__init__.py`
- `src/reddit_research/transcribe/whisper.py`
- `src/reddit_research/transcribe/models.py`
- `src/reddit_research/transcribe/ytdlp_client.py`
- `src/reddit_research/transcribe/chunker.py`
- `src/reddit_research/sources/video.py`
- `tests/transcribe/test_models_catalogue.py`
- `tests/transcribe/test_chunker.py`
- `tests/transcribe/test_ytdlp_client.py`
- `tests/transcribe/test_whisper.py`
- `app-tauri/src-tauri/binaries/ffmpeg-aarch64-apple-darwin` (binary, ~30 MB)
- `docs/video-ingest.md` (this file)
- `changelogs/2026-04-21_03_video-ingest-whisper.md` (created with Pass 1)

**Modified files:**
- `pyproject.toml` — add `yt-dlp`, `faster-whisper`, `huggingface_hub` to runtime deps.
- `uv.lock` — regenerated after pyproject change.
- `reddit-cli.spec` — PyInstaller hiddenimports.
- `app-tauri/src-tauri/tauri.conf.json` — externalBin for ffmpeg, bundle inclusion for new deps.
- `app-tauri/src-tauri/capabilities/default.json` — allow `run-shell` for ffmpeg sidecar.
- `app-tauri/src-tauri/src/commands.rs` — 8 new commands.
- `app-tauri/src-tauri/src/main.rs` — register handlers.
- `app-tauri/src/api.js` — new JS bindings.
- `app-tauri/src/screens/ingest.js` — Video tab.
- `app-tauri/src/screens/settings.js` — Whisper models card.
- `app-tauri/src/screens/topic.js::loadResearch` — Video transcripts section.
- `src/reddit_research/cli/main.py` — `ingest video` + `whisper` + `ytdlp` subcommands.
- `src/reddit_research/core/db.py::init_schema` — (defensive) no schema changes required.

---

## 21. Canonical code snippets (for Pass 1 implementation)

### 21.1 `transcribe/models.py` (full)

```python
"""Whisper model catalogue + download / list / delete.

Models are downloaded from the public `Systran/faster-whisper-*` HuggingFace
repos. Snapshots land under `$REDDIT_MYIND_DATA_DIR/whisper-models/<tier>/`.
"""
from __future__ import annotations

import os
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

MODELS: dict[str, dict] = {
    "tiny.en":   {"repo": "Systran/faster-whisper-tiny.en",   "size_mb": 75,   "rtf": 0.10},
    "base.en":   {"repo": "Systran/faster-whisper-base.en",   "size_mb": 145,  "rtf": 0.20},
    "small.en":  {"repo": "Systran/faster-whisper-small.en",  "size_mb": 480,  "rtf": 0.50},
    "medium.en": {"repo": "Systran/faster-whisper-medium.en", "size_mb": 1500, "rtf": 1.00},
    "large-v3":  {"repo": "Systran/faster-whisper-large-v3",  "size_mb": 2900, "rtf": 2.00},
}

DEFAULT_TIER = "small.en"


def models_root() -> Path:
    root = Path(os.environ.get("REDDIT_MYIND_DATA_DIR", Path.home() / ".config" / "reddit-myind"))
    return root / "whisper-models"


def list_installed() -> list[dict]:
    out = []
    root = models_root()
    if not root.exists():
        return out
    for tier_dir in sorted(root.iterdir()):
        if not tier_dir.is_dir():
            continue
        tier = tier_dir.name
        if tier not in MODELS:
            continue
        size = sum(p.stat().st_size for p in tier_dir.rglob("*") if p.is_file())
        out.append({
            "tier": tier,
            "repo": MODELS[tier]["repo"],
            "size_mb": round(size / (1024 * 1024), 1),
            "rtf": MODELS[tier]["rtf"],
            "installed": True,
            "path": str(tier_dir),
        })
    return out


def default_tier() -> str:
    marker = models_root() / ".default"
    if marker.exists():
        t = marker.read_text().strip()
        if t in MODELS and (models_root() / t).exists():
            return t
    # Fall back to first installed, else DEFAULT_TIER
    installed = list_installed()
    return installed[0]["tier"] if installed else DEFAULT_TIER


def set_default_tier(tier: str) -> None:
    if tier not in MODELS:
        raise ValueError(f"Unknown tier: {tier}")
    root = models_root()
    root.mkdir(parents=True, exist_ok=True)
    (root / ".default").write_text(tier)


def download_model(
    tier: str,
    progress_cb: Callable[[dict], None] | None = None,
) -> Path:
    if tier not in MODELS:
        raise ValueError(f"Unknown tier: {tier}")
    from huggingface_hub import snapshot_download

    info = MODELS[tier]
    target = models_root() / tier
    target.mkdir(parents=True, exist_ok=True)
    snapshot_download(
        repo_id=info["repo"],
        local_dir=str(target),
        local_dir_use_symlinks=False,
        allow_patterns=["*.bin", "*.json", "*.txt", "*.model"],
    )
    (target / ".downloaded_at").write_text(
        f"{datetime.now(timezone.utc).isoformat(timespec='seconds')}\n"
        f"tier={tier}\nrepo={info['repo']}\n"
    )
    if progress_cb:
        progress_cb({"tier": tier, "pct": 100, "done": True})
    return target


def delete_model(tier: str) -> bool:
    target = models_root() / tier
    if not target.exists():
        return False
    shutil.rmtree(target)
    return True
```

### 21.2 `transcribe/ytdlp_client.py` (full, overlay trick)

(See the pseudocode in §6.3; production version adds structured logging, stream progress for pip, and `_is_newer` semver compare using `packaging.version`.)

### 21.3 `sources/video.py` (skeleton)

```python
"""Video source — yt-dlp → faster-whisper → posts-table rows."""
from __future__ import annotations

import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

from ..transcribe.ytdlp_client import ensure_latest_ytdlp
from ..transcribe.whisper import transcribe_audio
from ..transcribe.chunker import chunk_segments
from ..transcribe.models import default_tier


def _data_root() -> Path:
    return Path(os.environ.get(
        "REDDIT_MYIND_DATA_DIR",
        Path.home() / ".config" / "reddit-myind",
    ))


def _video_id(url: str, yt_info: dict) -> str:
    vid = yt_info.get("id")
    if vid:
        return vid
    return hashlib.sha1(url.encode("utf-8")).hexdigest()[:16]


def preview_video(url: str) -> dict:
    ensure_latest_ytdlp()                           # idempotent, cached
    import yt_dlp  # noqa: E402 — post-overlay path
    with yt_dlp.YoutubeDL({"quiet": True, "skip_download": True}) as y:
        info = y.extract_info(url, download=False)
    return {
        "title": info.get("title"),
        "duration_s": info.get("duration"),
        "channel": info.get("channel") or info.get("uploader"),
        "uploaded": info.get("upload_date"),
        "thumbnail": info.get("thumbnail"),
        "video_id": _video_id(url, info),
        "canonical_url": info.get("webpage_url") or url,
    }


def fetch_video(
    url: str,
    topic: str | None = None,
    model: str = "auto",
    language: str | None = None,
    progress_cb: Callable[[dict], None] | None = None,
) -> list[dict]:
    ensure_latest_ytdlp()
    tier = default_tier() if model == "auto" else model

    # 1. metadata preview
    meta = preview_video(url)
    video_id = meta["video_id"]
    transcripts_dir = _data_root() / "reddit-myind" / "transcripts"
    transcripts_dir.mkdir(parents=True, exist_ok=True)
    cache_path = transcripts_dir / f"{video_id}.json"

    # 2. use cached transcript if present
    if cache_path.exists():
        cached = json.loads(cache_path.read_text())
        segments = cached["segments"]
        info = cached["info"]
    else:
        # 3. download audio
        audio_dir = _data_root() / "reddit-myind" / "audio-cache"
        audio_dir.mkdir(parents=True, exist_ok=True)
        audio_path = audio_dir / f"{video_id}.m4a"
        if not audio_path.exists():
            import yt_dlp
            ffmpeg = os.environ.get("OPENREPLY_FFMPEG_PATH")    # set by Rust side
            ydl_opts = {
                "format": "bestaudio[ext=m4a]/bestaudio",
                "outtmpl": str(audio_path),
                "quiet": True,
                "noprogress": False,
            }
            if ffmpeg:
                ydl_opts["ffmpeg_location"] = ffmpeg
            with yt_dlp.YoutubeDL(ydl_opts) as y:
                y.download([url])

        # 4. transcribe
        segs, info = transcribe_audio(
            audio_path, model_tier=tier, language=(None if language in (None, "auto") else language),
            progress_cb=progress_cb,
        )
        segments = [{"start": s.start, "end": s.end, "text": s.text} for s in segs]
        cache_path.write_text(json.dumps({"segments": segments, "info": info}, indent=2))
        # SRT sibling
        (transcripts_dir / f"{video_id}.srt").write_text(_to_srt(segments))
        # purge audio after success unless KEEP_VIDEO_AUDIO=1
        if not os.environ.get("KEEP_VIDEO_AUDIO"):
            try: audio_path.unlink()
            except FileNotFoundError: pass

    # 5. chunk
    chunks = chunk_segments(
        [type("S", (), s)() for s in segments],
        max_chars=500,
    )

    # 6. row shape
    created_utc = _parse_uploaded(meta["uploaded"])
    channel = (meta["channel"] or "unknown").lower().replace(" ", "-")
    rows: list[dict] = []
    for i, c in enumerate(chunks):
        rows.append({
            "id":           f"video:{video_id}:{i}",
            "sub":          channel,
            "source_type":  "video",
            "author":       meta["channel"] or "",
            "title":        meta["title"] or url,
            "selftext":     c["text"],
            "url":          f"{meta['canonical_url']}#t={int(c['timestamp_start'])}",
            "score":        0,
            "upvote_ratio": None,
            "num_comments": 0,
            "created_utc":  created_utc,
            "is_self":      True,
            "over_18":      False,
            "flair":        None,
            "permalink":    meta["canonical_url"],
            "fetched_at":   datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "metadata_json": json.dumps({
                "duration_s":        meta["duration_s"],
                "language":          info.get("language"),
                "timestamp_start":   c["timestamp_start"],
                "timestamp_end":     c["timestamp_end"],
                "model_used":        info.get("model_used") or tier,
                "chunk_idx":         i,
                "chunk_total":       len(chunks),
                "video_id":          video_id,
            }, ensure_ascii=False),
        })
    return rows


def _parse_uploaded(s: str | None) -> float:
    if not s or len(s) != 8:
        return datetime.now(timezone.utc).timestamp()
    return datetime(int(s[0:4]), int(s[4:6]), int(s[6:8]),
                    tzinfo=timezone.utc).timestamp()


def _to_srt(segments: list[dict]) -> str:
    def fmt(t: float) -> str:
        h, r = divmod(int(t), 3600); m, sec = divmod(r, 60)
        ms = int((t - int(t)) * 1000)
        return f"{h:02d}:{m:02d}:{sec:02d},{ms:03d}"
    lines = []
    for i, s in enumerate(segments, 1):
        lines.append(str(i))
        lines.append(f"{fmt(s['start'])} --> {fmt(s['end'])}")
        lines.append(s["text"])
        lines.append("")
    return "\n".join(lines)
```

---

## 21.5. Reuse already-installed Whisper models (no redundant download)

OpenReply auto-detects Whisper models the user already has on disk from other
Python projects and reuses them in place. No copy, no re-download, no
config file to edit. First run of a user who already transcribed videos
somewhere else sees everything they have.

### 21.5.1 Resolution priority (4 locations)

Per tier, the first match wins:

1. **App-managed** — `<data>/whisper-models/<tier>/` (dir the app itself populates via HuggingFace download).
2. **Env override** — `$OPENREPLY_WHISPER_MODELS_DIR/<tier>/` (power users + shared machines).
3. **HuggingFace hub cache** — `<HF_HUB_CACHE or ~/.cache/huggingface/hub>/models--Systran--faster-whisper-<tier>/snapshots/<rev>/`. Honours `HF_HOME` + `HF_HUB_CACHE` env. Prefers the snapshot pointed at by `refs/main`; falls back to the newest snapshot with valid files.
4. **Common dirs** — `~/.cache/whisper/<tier>/`, `~/whisper-models/<tier>/`, `/opt/whisper/<tier>/`.

A tier counts as installed when its directory contains both `model.bin` and
`tokenizer.json` (the two files `faster-whisper` must open to load a model).
Everything else is tolerated.

### 21.5.2 Return shape — `catalogue()` + `list_installed()`

Every row now carries a `source` field so the UI can render a badge and
decide whether to allow deletion:

```json
{
  "tier": "small.en",
  "repo": "Systran/faster-whisper-small.en",
  "size_mb": 480.0,
  "rtf": 0.5,
  "installed": true,
  "source": "hf_hub",                 // "app"|"hf_hub"|"custom"|"system"|null
  "path":   "/Users/.../snapshots/…"  // absolute path to the model dir
}
```

App-managed beats external on conflict (we keep the dir whose files the app
itself is responsible for). External tiers are never written to or deleted
by the app — they belong to whatever other tool installed them.

### 21.5.3 `download_model(tier)` short-circuits

Before hitting HuggingFace, `download_model` calls `resolve_model_path(tier)`.
If the tier resolves from any external location, it returns early with:

```json
{ "ok": true, "tier": "small.en", "path": "…", "source": "hf_hub",
  "skipped": true, "reason": "already_installed" }
```

No network call. The CLI prints `✓ reusing existing small.en at <path> — skipping download` and exits 0. The Rust streaming command treats exit-0 as success, so the UI's download-progress row switches straight to "installed".

### 21.5.4 `transcribe_audio(model_tier, …)` reads via `resolve_model_path`

The Whisper loader no longer hard-codes `<data>/whisper-models/<tier>/`. It
goes through `resolve_model_path(tier)` → whichever dir actually has the
files. Transcription works against any location transparently.

### 21.5.5 Settings UI — external-install badge + "Use it" button

Each row now shows its source:

- `Installed` — app-managed (Download button was clicked here once).
- `HuggingFace cache` — found in `~/.cache/huggingface/hub/`.
- `Custom dir` — from `$OPENREPLY_WHISPER_MODELS_DIR`.
- `System dir` — `~/.cache/whisper/` etc.

**External rows expose only a "Use it" button** (sets the `.default` marker
to that tier). The Delete button is hidden — we don't own those files.
App-managed rows keep the full Set default / Delete pair.

### 21.5.6 Onboarding — new Step 4 (before "Your first topic")

Welcome wizard expanded from 4 steps to 5. Step 4 auto-detects and, if a
suitable tier is found, shows:

```
✓ Found existing install — OpenReply can reuse 2 tiers already on your Mac.
  ○ tiny.en                                     tiny.en installed (HF)
  ● small.en (recommended)   HuggingFace cache  ← prefilled
  ○ medium.en
  ○ large-v3
  [Use selected tier]  [Download a different tier]
```

If nothing detected, the same card flips to:

```
No Whisper model detected on this Mac.
Recommended: small.en (480 MB, ~30 min for a 60-min talk on M1 CPU).
  ● small.en (recommended)      ← prefilled
  ○ tiny.en / base.en / medium.en / large-v3
  [Download selected]            (live progress)
```

User can always hit **Skip — set up later** (flag stored in
`localStorage['openreply.onboarding.whisper_skipped']`). The Settings card
picks up the same state after onboarding finishes.

### 21.5.7 Power-user override

For shared machines / fleet installs:

```bash
export OPENREPLY_WHISPER_MODELS_DIR=/opt/company-shared/whisper
```

`<OPENREPLY_WHISPER_MODELS_DIR>/<tier>/` is scanned first (ahead of HF cache
and common dirs). Every sibling app pointing the same env variable
at the same NFS/APFS share reuses the same models — no tier gets
re-downloaded per user.

### 21.5.8 Tests

`tests/transcribe/test_external_discovery.py` (6 cases):

- HF hub snapshot detected → `source='hf_hub'`.
- `OPENREPLY_WHISPER_MODELS_DIR` takes priority over HF cache.
- Nothing installed anywhere → `[]`.
- `download_model` short-circuits when external exists (must NOT call `snapshot_download`).
- `resolve_model_path` prefers the app-managed dir on conflict.
- `catalogue()` includes the `source` field + marks external tiers as installed.

---

## 22. Summary of guarantees

1. **Any public video URL → research row, hands-free.** ✅
2. **Transcription runs local, audio never leaves the Mac.** ✅
3. **Model weights are user-downloaded, DMG stays lean.** ✅
4. **yt-dlp auto-updates on every launch (24h cooldown), bundled fallback if offline.** ✅
5. **Default `small.en` balances speed + quality; user can escalate to `medium.en` / `large-v3`.** ✅
6. **Auto language detection — no picker friction.** ✅
7. **Cached transcripts make re-ingest instant.** ✅
8. **Pro feature gate via offline licensing system.** ✅
9. **Graceful error classes for every failure mode; UI shows actionable hint.** ✅
10. **Reuses any Whisper model already on disk — HF hub cache, env override, system dirs. No redundant download.** ✅
11. **Onboarding detects, reuses, or offers to download Whisper — fully skippable.** ✅
