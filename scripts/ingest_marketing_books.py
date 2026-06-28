#!/usr/bin/env python3
"""One-shot ingest for public-domain marketing books.

Creates `posts` rows with `source_type='marketing_book'`, stores extracted
plain text in `paper_cache/marketing_book/*.txt`, records `paper_full_texts`
status rows, and chunks into `paper_chunks` (+ embeddings when enabled).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from openreply.core.db import get_db
from openreply.research.paper_chunks import chunk_paper
from openreply.research.paper_fulltext import _cache_path, _extract_text, _record_status


BOOKS: list[dict[str, Any]] = [
    {
        "slug": "scientific-advertising",
        "title": "Scientific Advertising",
        "author": "Claude Hopkins",
        "reference_url": "https://www.gutenberg.org/ebooks/11103",
        "urls": [
            "https://www.gutenberg.org/cache/epub/11103/pg11103.txt",
            "https://archive.org/download/scientificadve00hopk/scientificadve00hopk_djvu.txt",
        ],
    },
    {
        "slug": "my-life-in-advertising",
        "title": "My Life in Advertising",
        "author": "Claude Hopkins",
        "reference_url": "https://archive.org/search?query=My+Life+in+Advertising+Claude+Hopkins",
        "urls": [
            "https://archive.org/download/mylifeinadvertis00hopkrich/mylifeinadvertis00hopkrich_djvu.txt",
            "https://archive.org/download/mylifeinadvertis00hopk/mylifeinadvertis00hopk_djvu.txt",
        ],
    },
    {
        "slug": "psychology-of-advertising",
        "title": "The Psychology of Advertising (1908)",
        "author": "Walter Dill Scott",
        "reference_url": "https://archive.org/search?query=The+Psychology+of+Advertising+Walter+Dill+Scott",
        "urls": [
            "https://archive.org/download/psychologyofadve00scotuoft/psychologyofadve00scotuoft_djvu.txt",
            "https://archive.org/download/psychologyofadve00scot/psychologyofadve00scot_djvu.txt",
        ],
    },
    {
        "slug": "advertising-and-selling",
        "title": "Advertising and Selling",
        "author": "H. L. Hollingworth",
        "reference_url": "https://archive.org/search?query=Advertising+and+Selling+H.+L.+Hollingworth",
        "urls": [
            "https://archive.org/download/advertisingselli00hollrich/advertisingselli00hollrich_djvu.txt",
            "https://archive.org/download/advertisingselling00holl/advertisingselling00holl_djvu.txt",
        ],
    },
    {
        "slug": "psychology-of-salesmanship",
        "title": "The Psychology of Salesmanship",
        "author": "W. W. Atkinson",
        "reference_url": "https://www.gutenberg.org/ebooks/17829",
        "urls": [
            "https://www.gutenberg.org/cache/epub/17829/pg17829.txt",
        ],
    },
    {
        "slug": "principles-of-advertising",
        "title": "Principles of Advertising",
        "author": "Daniel Starch",
        "reference_url": "https://archive.org/search?query=Principles+of+Advertising+Daniel+Starch",
        "urls": [
            "https://archive.org/download/principlesofadve00staruoft/principlesofadve00staruoft_djvu.txt",
            "https://archive.org/download/principlesofadvert00star/principlesofadvert00star_djvu.txt",
        ],
    },
    {
        "slug": "robert-collier-letter-book",
        "title": "The Robert Collier Letter Book",
        "author": "Robert Collier",
        "reference_url": "https://archive.org/search?query=Robert+Collier+Letter+Book",
        "urls": [
            "https://archive.org/download/robertcollierlet00coll/robertcollierlet00coll_djvu.txt",
        ],
    },
]


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _post_id(slug: str) -> str:
    return f"pdbook_{slug}"


def _download_text(url: str, timeout_s: int = 40) -> str:
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; openreply/1.0; +https://github.com/shantanubombatkar)",
        "Accept": "text/plain,application/pdf,text/html,*/*",
    }
    last_error: str | None = None
    with httpx.Client(follow_redirects=True, timeout=timeout_s, headers=headers) as client:
        for _ in range(3):
            try:
                r = client.get(url)
                r.raise_for_status()
                ctype = (r.headers.get("content-type") or "").lower()
                if "pdf" in ctype or url.lower().endswith(".pdf"):
                    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
                        tmp.write(r.content)
                        pdf_path = Path(tmp.name)
                    text, err = _extract_text(pdf_path)
                    try:
                        pdf_path.unlink(missing_ok=True)
                    except Exception:
                        pass
                    if not text and err:
                        raise RuntimeError(f"PDF extraction failed: {err}")
                    return text
                r.encoding = r.encoding or "utf-8"
                return r.text
            except Exception as e:
                last_error = str(e)
                continue
    raise RuntimeError(last_error or f"download failed: {url}")


def _upsert_book_post(book: dict[str, str]) -> None:
    db = get_db()
    pid = _post_id(book["slug"])
    db["posts"].upsert(
        {
            "id": pid,
            "source_type": "marketing_book",
            "author": book["author"],
            "title": book["title"],
            "selftext": "",
            "url": (book.get("reference_url") or (book.get("urls") or [""])[0]),
            "score": 0,
            "num_comments": 0,
            "created_utc": 0,
            "fetched_at": _utc_now(),
        },
        pk="id",
        alter=True,
    )


def ingest_book(
    book: dict[str, Any], *, force: bool = False, embed: bool = True, allow_placeholder: bool = True
) -> dict[str, Any]:
    pid = _post_id(book["slug"])
    _upsert_book_post(book)
    out_path = _cache_path("marketing_book", pid)
    used_url = ""
    used_placeholder = False
    if out_path.exists() and not force:
        text = out_path.read_text(encoding="utf-8", errors="ignore")
    else:
        text = ""
        last_err = None
        for candidate in (book.get("urls") or []):
            try:
                text = _download_text(str(candidate))
                used_url = str(candidate)
                break
            except Exception as e:
                last_err = str(e)
                continue
        if not text and allow_placeholder:
            used_placeholder = True
            text = (
                f"{book['title']}\n"
                f"Author: {book['author']}\n\n"
                "Source text could not be fetched from remote mirrors at ingest time. "
                "This placeholder keeps the topic graph and tactic pipeline functional; "
                "rerun with --force when the source URL is reachable.\n"
            )
        elif not text:
            raise RuntimeError(last_err or f"unable to download any mirror for {book['slug']}")
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(text, encoding="utf-8")
    char_count = len(text or "")
    _record_status(
        pid,
        source="marketing_book",
        status="ok" if char_count > 0 else "empty",
        # Persist the stable human-openable URL in paper_full_texts as well.
        # download_url is still returned in script output for debugging.
        pdf_url=(book.get("reference_url") or used_url or (book.get("urls") or [""])[0]),
        char_count=char_count,
        cache_path=str(out_path),
        error="placeholder" if used_placeholder else ("" if char_count > 0 else "empty text"),
    )
    chunk_res = chunk_paper(pid, force=force, embed=embed) if char_count > 0 else {"ok": False, "error": "empty text"}
    return {
        "post_id": pid,
        "title": book["title"],
        "chars": char_count,
        "cache_path": str(out_path),
        "chunk": chunk_res,
        "hash": hashlib.sha1((text or "").encode("utf-8", errors="ignore")).hexdigest()[:12] if text else "",
        "placeholder": used_placeholder,
        "url": (book.get("reference_url") or used_url or (book.get("urls") or [""])[0]),
        "download_url": used_url or "",
    }


def main() -> None:
    ap = argparse.ArgumentParser(description="Ingest public-domain marketing books into paper cache + chunks.")
    ap.add_argument("--dry-run", action="store_true", help="Print what would be ingested.")
    ap.add_argument("--force", action="store_true", help="Redownload + rechunk even if cache exists.")
    ap.add_argument("--no-embed", action="store_true", help="Chunk papers without embedding into Chroma.")
    ap.add_argument(
        "--no-placeholder",
        action="store_true",
        help="Fail a book if all mirrors are unavailable instead of writing placeholder text.",
    )
    args = ap.parse_args()

    if args.dry_run:
        print(json.dumps({"ok": True, "dry_run": True, "books": BOOKS}, ensure_ascii=False, indent=2))
        return

    results = []
    for book in BOOKS:
        try:
            results.append(
                ingest_book(
                    book,
                    force=args.force,
                    embed=not args.no_embed,
                    allow_placeholder=not args.no_placeholder,
                )
            )
        except Exception as e:
            results.append({"post_id": _post_id(book["slug"]), "title": book["title"], "error": str(e)})
    print(json.dumps({"ok": True, "count": len(results), "results": results}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
