"""Local-file ingest — private-signal gap closer.

Addresses three CHRONIC painpoints from the UX-research corpus:
  - "Customer signal in Slack/tickets never reaches the research repo"
  - "No single source of truth across CRM/Slack/calls/tickets"
  - The DIY workaround of "#customer-voice Slack channel IS our research repo"

By letting users drop their own exports (CSV of interviews, TXT of Slack
messages, VTT/SRT of call transcripts), private-signal flows into the graph
alongside Reddit/HN/App Store data — triangulation finally includes what
your users actually said to you.

Supported formats:
  .csv        — expects columns: text (required); optionally title, author, score, created_at, url
  .json       — list of dicts with the same keys
  .txt        — each blank-line-separated paragraph becomes a row
  .vtt / .srt — subtitle formats (call transcripts); each caption becomes a row
  .md         — top-level headers become titles, each block becomes a row
"""
from __future__ import annotations

import csv
import hashlib
import json
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _hash_id(prefix: str, content: str) -> str:
    h = hashlib.sha1(content.encode("utf-8", errors="ignore")).hexdigest()[:12]
    return f"{prefix}_{h}"


def _row(
    *,
    source_type: str,
    sub: str,
    text: str,
    title: str | None = None,
    author: str | None = None,
    score: int | None = None,
    url: str | None = None,
    created_utc: float | None = None,
) -> dict[str, Any]:
    """Build a post row in the canonical shape."""
    content_key = f"{source_type}|{sub}|{(title or '')}|{text[:200]}"
    return {
        "id": _hash_id(source_type, content_key),
        "sub": sub,
        "source_type": source_type,
        "author": author or "[local]",
        "title": (title or "")[:300],
        "selftext": (text or "")[:5000],
        "url": url or "",
        "score": int(score) if score is not None else 0,
        "upvote_ratio": None,
        "num_comments": 0,
        "created_utc": float(created_utc) if created_utc is not None else 0.0,
        "is_self": 1,
        "over_18": 0,
        "flair": None,
        "permalink": url,
        "fetched_at": _now_iso(),
    }


def _extract_doc_elements(parsed_json: Any) -> list[dict[str, Any]]:
    """Flatten opendataloader JSON into canonical element rows."""
    out: list[dict[str, Any]] = []

    def _walk(node: Any) -> None:
        if isinstance(node, list):
            for child in node:
                _walk(child)
            return
        if not isinstance(node, dict):
            return

        typ = (node.get("type") or node.get("element_type") or "").strip()
        content = (node.get("content") or node.get("text") or "").strip()
        page = node.get("page number") or node.get("page") or node.get("page_number")
        bbox = node.get("bounding box") or node.get("bbox")
        elem_id = str(node.get("id") or node.get("element_id") or "")
        if typ and (content or bbox is not None):
            try:
                page_num = int(page) if page is not None else 0
            except Exception:
                page_num = 0
            out.append(
                {
                    "element_id": elem_id,
                    "element_type": typ,
                    "content": content[:8000],
                    "page_number": page_num,
                    "bbox_json": json.dumps(bbox) if bbox is not None else None,
                }
            )
        children = node.get("children")
        if children is not None:
            _walk(children)

    _walk(parsed_json)
    return out


def _persist_artifacts_and_meta(
    *,
    path: Path,
    rows: list[dict[str, Any]],
    source_type: str,
    sub: str,
    parser: str,
    parser_mode: str,
    prebuilt_elements: list[dict[str, Any]] | None = None,
    existing_artifacts: dict[str, str | None] | None = None,
) -> dict[str, Any]:
    """Persist normalized artifacts for any local file parser.

    For PDF+opendataloader callers, `existing_artifacts` and `prebuilt_elements`
    can be supplied from parser-native outputs. For non-PDF formats, this helper
    emits markdown/json/html wrappers so every source gets a consistent artifact
    footprint and evidence-link metadata.
    """
    from ..core.config import load_config

    data_dir = load_config().data_dir
    source_hash = hashlib.sha1(str(path.resolve()).encode("utf-8")).hexdigest()[:12]
    artifact_dir = data_dir / "artifacts" / "documents" / source_hash
    artifact_dir.mkdir(parents=True, exist_ok=True)

    md_out = artifact_dir / f"{path.stem}.md"
    json_out = artifact_dir / f"{path.stem}.json"
    html_out = artifact_dir / f"{path.stem}.html"

    artifacts = dict(existing_artifacts or {})
    if not artifacts.get("markdown"):
        parts: list[str] = []
        for i, r in enumerate(rows, start=1):
            t = (r.get("title") or "").strip()
            body = (r.get("selftext") or "").strip()
            if t:
                parts.append(f"## {t}")
            else:
                parts.append(f"## Block {i}")
            if body:
                parts.append(body)
            parts.append("")
        md_out.write_text("\n".join(parts).strip() + "\n", encoding="utf-8")
        artifacts["markdown"] = str(md_out)

    if not artifacts.get("json"):
        payload = {
            "source_path": str(path.resolve()),
            "source_type": source_type,
            "sub": sub,
            "parser": parser,
            "rows": [
                {
                    "id": r.get("id"),
                    "title": r.get("title"),
                    "content": r.get("selftext"),
                    "author": r.get("author"),
                    "score": r.get("score"),
                    "created_utc": r.get("created_utc"),
                }
                for r in rows
            ],
        }
        json_out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        artifacts["json"] = str(json_out)

    if not artifacts.get("html"):
        blocks: list[str] = []
        for r in rows:
            t = (r.get("title") or "").strip()
            body = (r.get("selftext") or "").strip()
            blocks.append(
                "<section>"
                + (f"<h2>{t}</h2>" if t else "")
                + (f"<p>{body}</p>" if body else "")
                + "</section>"
            )
        html_out.write_text(
            "<!doctype html><html><body>" + "".join(blocks) + "</body></html>",
            encoding="utf-8",
        )
        artifacts["html"] = str(html_out)

    doc_elements = list(prebuilt_elements or [])
    if not doc_elements:
        for i, r in enumerate(rows, start=1):
            body = (r.get("selftext") or "").strip()
            if not body:
                continue
            doc_elements.append(
                {
                    "element_id": str(i),
                    "element_type": "paragraph",
                    "content": body[:8000],
                    "page_number": 0,
                    "bbox_json": None,
                }
            )

    return {
        "source_path": str(path.resolve()),
        "source_hash": source_hash,
        "parser": parser,
        "parser_mode": parser_mode,
        "artifact_dir": str(artifact_dir),
        "artifacts": {
            "markdown": artifacts.get("markdown"),
            "json": artifacts.get("json"),
            "html": artifacts.get("html"),
        },
        "doc_elements": doc_elements,
        "source_type": source_type,
        "sub": sub,
    }


# ── format parsers ──────────────────────────────────────────────────────────

def _parse_csv(path: Path, source_type: str, sub: str) -> list[dict]:
    rows: list[dict] = []
    with path.open(encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        for r in reader:
            text = (r.get("text") or r.get("body") or r.get("message") or "").strip()
            if not text:
                continue
            ts_str = r.get("created_at") or r.get("date") or r.get("timestamp")
            created = 0.0
            if ts_str:
                try:
                    created = datetime.fromisoformat(str(ts_str).replace("Z", "+00:00")).timestamp()
                except (ValueError, TypeError):
                    try:
                        created = float(ts_str)
                    except (ValueError, TypeError):
                        pass
            rows.append(_row(
                source_type=source_type, sub=sub,
                text=text,
                title=r.get("title") or r.get("subject"),
                author=r.get("author") or r.get("user") or r.get("username"),
                score=r.get("score") or r.get("rating") or 0,
                url=r.get("url") or r.get("link") or r.get("permalink"),
                created_utc=created,
            ))
    return rows


def _parse_json(path: Path, source_type: str, sub: str) -> list[dict]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, dict):
        data = data.get("messages") or data.get("rows") or data.get("data") or [data]
    rows: list[dict] = []
    for d in data or []:
        if not isinstance(d, dict):
            continue
        text = (d.get("text") or d.get("body") or d.get("message") or "").strip()
        if not text:
            continue
        rows.append(_row(
            source_type=source_type, sub=sub, text=text,
            title=d.get("title"), author=d.get("author") or d.get("user"),
            score=d.get("score") or 0,
            url=d.get("url") or d.get("link"),
            created_utc=d.get("created_utc") or 0,
        ))
    return rows


def _parse_txt(path: Path, source_type: str, sub: str) -> list[dict]:
    raw = path.read_text(encoding="utf-8", errors="replace")
    paragraphs = [p.strip() for p in re.split(r"\n{2,}", raw) if p.strip()]
    return [
        _row(source_type=source_type, sub=sub, text=p, title=p.splitlines()[0][:100])
        for p in paragraphs
    ]


def _parse_vtt(path: Path, source_type: str, sub: str) -> list[dict]:
    """WebVTT / SRT transcript parser — each caption is a row."""
    raw = path.read_text(encoding="utf-8", errors="replace")
    # Both VTT and SRT: blocks separated by blank lines, first line cue id or
    # start-->end timestamp. Caption text follows.
    blocks = re.split(r"\n{2,}", raw.strip())
    rows: list[dict] = []
    for b in blocks:
        lines = [line.strip() for line in b.splitlines() if line.strip()]
        if not lines or lines[0].upper() in ("WEBVTT",) or lines[0].startswith("NOTE "):
            continue
        # Skip numeric cue id
        if lines[0].isdigit():
            lines = lines[1:]
        # Skip timestamp line
        if lines and "-->" in lines[0]:
            ts_line = lines[0]
            lines = lines[1:]
        else:
            ts_line = ""
        if not lines:
            continue
        text = " ".join(lines)
        rows.append(_row(
            source_type=source_type, sub=sub, text=text, title=ts_line[:60] or None,
        ))
    return rows


def _parse_md(path: Path, source_type: str, sub: str) -> list[dict]:
    raw = path.read_text(encoding="utf-8", errors="replace")
    # Split on top-level headers (# or ##)
    chunks = re.split(r"\n(?=#{1,2} )", raw)
    rows: list[dict] = []
    for chunk in chunks:
        chunk = chunk.strip()
        if not chunk:
            continue
        m = re.match(r"^(#{1,2})\s+(.+?)\n", chunk)
        title = m.group(2).strip() if m else None
        text = chunk[m.end():].strip() if m else chunk
        if not text:
            continue
        rows.append(_row(source_type=source_type, sub=sub, text=text, title=title))
    return rows


def _parse_pdf_opendataloader(
    path: Path, source_type: str, sub: str
) -> tuple[str | None, str, str | None, dict[str, Any] | None]:
    """Try opendataloader-pdf (Java-backed, structure-aware).

    Returns (title, markdown_body, author) when successful — the markdown
    preserves headings (Abstract, Methods, Results, …), tables, and list
    structure, which dramatically improves LLM extraction quality on
    scientific papers. Returns None-tuple if opendataloader isn't available
    or Java can't be found; caller should fall back to pypdf.

    Why two extractors: opendataloader needs a Java 11+ runtime installed
    on the machine. pypdf is pure Python and always works. Preferring the
    richer one when present costs nothing and yields markdown the LLM can
    actually reason over (vs flat text).
    """
    try:
        import opendataloader_pdf  # noqa: F401
    except Exception:
        return None, "", None, None

    # opendataloader writes to a directory; use a temp dir so we don't
    # pollute CWD. It emits one `.md` + one `.json` per input PDF.
    import tempfile
    try:
        with tempfile.TemporaryDirectory() as tmp:
            opendataloader_pdf.convert(
                input_path=[str(path)],
                output_dir=tmp,
                format="markdown,json,html",
            )
            # The emitted filenames mirror the input stem.
            stem = path.stem
            md_path = Path(tmp) / f"{stem}.md"
            json_path = Path(tmp) / f"{stem}.json"
            html_path = Path(tmp) / f"{stem}.html"

            body_md = ""
            if md_path.exists():
                body_md = md_path.read_text(encoding="utf-8", errors="ignore").strip()

            title: str | None = None
            author: str | None = None
            doc_elements: list[dict[str, Any]] = []
            if json_path.exists():
                try:
                    meta = json.loads(json_path.read_text(encoding="utf-8"))
                    doc_elements = _extract_doc_elements(meta)
                    # opendataloader's JSON is an element tree; the first
                    # H1 is usually the paper title. Grab the first non-empty
                    # heading at depth 1 or 2 as title fallback.
                    def _walk(node, depth=0):
                        nonlocal title
                        if title:
                            return
                        elements = node if isinstance(node, list) else node.get("children", []) if isinstance(node, dict) else []
                        for child in elements:
                            if not isinstance(child, dict):
                                continue
                            typ = child.get("type") or child.get("element_type") or ""
                            if typ.lower() in ("h1", "h2", "title") and not title:
                                text = (child.get("text") or child.get("content") or "").strip()
                                if text:
                                    title = text[:300]
                                    return
                            _walk(child, depth + 1)
                    _walk(meta)
                    # Author / metadata block if present.
                    md = meta if isinstance(meta, dict) else {}
                    props = md.get("metadata") or md.get("properties") or {}
                    if isinstance(props, dict):
                        author = (props.get("author") or props.get("Author") or None)
                        if author:
                            author = str(author)[:80]
                except Exception:
                    pass

            if not body_md:
                return None, "", None, None

            # Persist opendataloader artifacts under canonical app data dir.
            from ..core.config import load_config
            data_dir = load_config().data_dir
            source_hash = hashlib.sha1(str(path.resolve()).encode("utf-8")).hexdigest()[:12]
            artifact_dir = data_dir / "artifacts" / "documents" / source_hash
            artifact_dir.mkdir(parents=True, exist_ok=True)
            md_out = artifact_dir / f"{path.stem}.md"
            json_out = artifact_dir / f"{path.stem}.json"
            html_out = artifact_dir / f"{path.stem}.html"
            shutil.copy2(md_path, md_out)
            if json_path.exists():
                shutil.copy2(json_path, json_out)
            if html_path.exists():
                shutil.copy2(html_path, html_out)

            metadata = _persist_artifacts_and_meta(
                path=path,
                rows=[],
                source_type=source_type,
                sub=sub,
                parser="opendataloader-pdf",
                parser_mode="local",
                prebuilt_elements=doc_elements,
                existing_artifacts={
                    "markdown": str(md_out),
                    "json": str(json_out) if json_out.exists() else None,
                    "html": str(html_out) if html_out.exists() else None,
                },
            )
            return title, body_md, author, metadata
    except Exception:
        # Any pypdf-triggered fallback is strictly better than a crash —
        # surface nothing, caller falls back.
        return None, "", None, None


def _parse_pdf_pypdf(path: Path) -> tuple[str | None, str, str | None]:
    """Fallback extractor: pypdf (pure Python, no external deps)."""
    try:
        from pypdf import PdfReader
    except ImportError as e:
        raise RuntimeError(
            "pypdf not installed — run: pip install pypdf. "
            "Needed to ingest .pdf files when opendataloader is unavailable."
        ) from e

    reader = PdfReader(str(path))
    meta_title = None
    try:
        meta_title = (reader.metadata.title or "").strip() if reader.metadata else None
    except Exception:
        meta_title = None

    pages_text: list[str] = []
    for page in reader.pages:
        try:
            txt = page.extract_text() or ""
        except Exception:
            txt = ""
        if txt.strip():
            pages_text.append(txt.strip())
    body = "\n\n".join(pages_text).strip()

    author: str | None = None
    try:
        if reader.metadata and reader.metadata.author:
            author = str(reader.metadata.author)[:80]
    except Exception:
        pass
    return meta_title, body, author


def _parse_pdf(path: Path, source_type: str, sub: str) -> list[dict]:
    """Extract text from a PDF → one row per PDF.

    Prefers opendataloader-pdf (preserves headings + tables via Java PDF
    parser) when available; falls back to pypdf (flat text) otherwise.
    Fails loudly only if *both* extractors produce empty output — usually
    a sign the PDF is scanned images and needs OCR (e.g. `ocrmypdf`).
    """
    title, body, author, pdf_meta = _parse_pdf_opendataloader(path, source_type, sub)
    if not body:
        title, body, author = _parse_pdf_pypdf(path)
        pdf_meta = None

    if not body:
        raise ValueError(
            f"PDF {path.name} yielded no extractable text. Likely a scanned "
            "image — run through OCR first (e.g. `ocrmypdf in.pdf out.pdf`) "
            "and re-ingest."
        )

    row = _row(
            source_type=source_type,
            sub=sub,
            text=body,
            title=(title or path.stem)[:300],
            author=author or "[pdf]",
        )
    if pdf_meta is None:
        pdf_meta = _persist_artifacts_and_meta(
            path=path,
            rows=[row],
            source_type=source_type,
            sub=sub,
            parser="pypdf",
            parser_mode="fallback",
        )
    row["__doc_meta"] = pdf_meta
    return [row]


_PARSERS = {
    ".csv": _parse_csv,
    ".json": _parse_json,
    ".txt": _parse_txt,
    ".vtt": _parse_vtt,
    ".srt": _parse_vtt,
    ".md": _parse_md,
    ".pdf": _parse_pdf,
}


# ── public API ──────────────────────────────────────────────────────────────

def ingest_file(
    path: str | Path,
    source_type: str = "local",
    sub: str | None = None,
) -> list[dict]:
    """Parse a local file into post rows. Format detected by extension.

    Args:
        path: file path.
        source_type: free-form tag, e.g. 'slack_export', 'interviews', 'gong_calls'.
        sub: sub identifier (defaults to '<source_type>:<filename>').
    """
    p = Path(path).expanduser()
    if not p.exists():
        raise FileNotFoundError(p)
    ext = p.suffix.lower()
    parser = _PARSERS.get(ext)
    if not parser:
        raise ValueError(
            f"Unsupported extension {ext!r}. Supported: {list(_PARSERS.keys())}"
        )
    sub_final = sub or f"{source_type}:{p.stem}"
    return parser(p, source_type, sub_final)


def ingest_and_persist(
    path: str | Path,
    topic: str,
    source_type: str = "local",
    sub: str | None = None,
) -> int:
    """Parse + upsert + tag under topic. Returns rows tagged."""
    from ..core.db import log_fetch_end, log_fetch_start, upsert_posts
    from ..research.collect import _tag_posts

    fid = log_fetch_start(
        "local_file", {"path": str(path), "source_type": source_type, "topic": topic}
    )
    try:
        rows = ingest_file(path=path, source_type=source_type, sub=sub)
        # For non-PDF formats (or legacy rows), emit normalized artifacts so
        # all ingested documents have the same provenance footprint.
        for r in rows:
            if "__doc_meta" not in r:
                r["__doc_meta"] = _persist_artifacts_and_meta(
                    path=Path(path),
                    rows=rows,
                    source_type=source_type,
                    sub=sub or f"{source_type}:{Path(path).stem}",
                    parser=f"native:{Path(path).suffix.lower().lstrip('.') or 'unknown'}",
                    parser_mode="native",
                )
        rows_for_db = [{k: v for k, v in r.items() if not str(k).startswith("__")} for r in rows]
        if rows:
            upsert_posts(rows_for_db)
            n = _tag_posts(topic, [r["id"] for r in rows_for_db], source=f"local:{Path(path).name}")
            # Persist PDF artifact + element provenance for node/edge linking.
            from ..core.db import get_db
            db = get_db()
            now = _now_iso()
            for r in rows:
                doc_meta = r.get("__doc_meta")
                if not isinstance(doc_meta, dict):
                    continue
                doc_id = f"doc_{doc_meta.get('source_hash') or r['id']}"
                db["ingested_documents"].upsert(
                    {
                        "id": doc_id,
                        "topic": topic,
                        "post_id": r["id"],
                        "source_path": str(doc_meta.get("source_path") or path),
                        "source_hash": str(doc_meta.get("source_hash") or ""),
                        "source_type": str(doc_meta.get("source_type") or source_type),
                        "parser": str(doc_meta.get("parser") or "unknown"),
                        "parser_mode": str(doc_meta.get("parser_mode") or "unknown"),
                        "artifact_dir": str(doc_meta.get("artifact_dir") or ""),
                        "created_at": now,
                    },
                    pk="id",
                )
                elems = doc_meta.get("doc_elements") or []
                if isinstance(elems, list) and elems:
                    element_rows = []
                    for i, el in enumerate(elems):
                        if not isinstance(el, dict):
                            continue
                        eid = str(el.get("element_id") or i)
                        element_rows.append(
                            {
                                "id": f"{doc_id}:{eid}",
                                "document_id": doc_id,
                                "post_id": r["id"],
                                "topic": topic,
                                "element_id": eid,
                                "element_type": str(el.get("element_type") or "unknown"),
                                "content": str(el.get("content") or ""),
                                "page_number": int(el.get("page_number") or 0),
                                "bbox_json": el.get("bbox_json"),
                                "created_at": now,
                            }
                        )
                    if element_rows:
                        db["document_elements"].upsert_all(element_rows, pk="id")
        else:
            n = 0
        log_fetch_end(fid, rows=n)
        return n
    except Exception as e:
        log_fetch_end(fid, rows=0, error=str(e))
        raise
