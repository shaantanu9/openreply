"""Long-running keyword stream. Blocks foreground; Ctrl+C to stop."""
from __future__ import annotations

import re
from datetime import datetime, timezone

from ..core.client import get_reddit
from ..core.db import get_db, upsert_comments, upsert_posts
from ._shape import comment_row, post_row


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _match(text: str, patterns: list[re.Pattern[str]]) -> list[str]:
    hits = [p.pattern for p in patterns if p.search(text or "")]
    return hits


def start_stream(
    sub: str,
    keywords: list[str],
    name: str | None = None,
    watch: str = "both",  # posts | comments | both
    on_hit=None,  # optional callback(hit_dict)
) -> None:
    """Blocks. Appends hits to stream_hits. `on_hit` called for each match (e.g. to print)."""
    db = get_db()
    patterns = [re.compile(k, re.IGNORECASE) for k in keywords]

    # Create stream row
    row = db["streams"].insert(
        {
            "name": name or f"{sub}-{','.join(keywords)}",
            "sub": sub,
            "keywords": ",".join(keywords),
            "started_at": _now(),
            "active": 1,
        }
    )
    stream_id = row.last_pk

    reddit = get_reddit()
    subreddit = reddit.subreddit(sub)

    try:
        if watch in ("posts", "both"):
            for submission in subreddit.stream.submissions(skip_existing=True, pause_after=0):
                if submission is None:
                    if watch == "both":
                        # fall through to comment stream on pause
                        break
                    continue
                text = f"{submission.title}\n{getattr(submission, 'selftext', '')}"
                matched = _match(text, patterns)
                if matched:
                    upsert_posts([post_row(submission)])
                    db["stream_hits"].insert(
                        {
                            "stream_id": stream_id,
                            "item_type": "post",
                            "item_id": submission.id,
                            "matched_at": _now(),
                            "keywords_matched": ",".join(matched),
                        },
                        replace=True,
                    )
                    if on_hit:
                        on_hit(
                            {
                                "kind": "post",
                                "id": submission.id,
                                "title": submission.title,
                                "keywords": matched,
                                "permalink": f"https://reddit.com{submission.permalink}",
                            }
                        )

        if watch in ("comments", "both"):
            for c in subreddit.stream.comments(skip_existing=True):
                matched = _match(c.body or "", patterns)
                if matched:
                    upsert_comments([comment_row(c, post_id=c.submission.id, depth=0)])
                    db["stream_hits"].insert(
                        {
                            "stream_id": stream_id,
                            "item_type": "comment",
                            "item_id": c.id,
                            "matched_at": _now(),
                            "keywords_matched": ",".join(matched),
                        },
                        replace=True,
                    )
                    if on_hit:
                        on_hit(
                            {
                                "kind": "comment",
                                "id": c.id,
                                "body": (c.body or "")[:200],
                                "keywords": matched,
                                "permalink": f"https://reddit.com{c.permalink}",
                            }
                        )
    finally:
        db["streams"].update(stream_id, {"active": 0})
