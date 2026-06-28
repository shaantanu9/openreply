"""X (Twitter) outbound adapter — post a tweet or a thread via API v2.

Auth: OAuth 1.0a user context. An X developer app with **Write** permission
yields four secrets — api_key, api_secret, access_token, access_secret —
stored via `openreply publish set-creds` into source_credentials["x_publish"].

A draft's body is split into tweets on blank lines (the numbered "1/5 …"
thread format the content engine emits), each hard-wrapped to 280 chars.
The first tweet is posted, then each subsequent tweet replies to the previous
one to form a native thread.
"""
from __future__ import annotations

import re

from ..core.credentials import get_credential
from .base import PublishResult

API_URL = "https://api.twitter.com/2/tweets"
LIMIT = 280
SOURCE = "x_publish"
REQUIRED = ("api_key", "api_secret", "access_token", "access_secret")


def _creds() -> dict | None:
    c = get_credential(SOURCE)
    if not c:
        return None
    keys = c.get("cookies") or {}
    return keys if all(keys.get(k) for k in REQUIRED) else None


def split_thread(body: str) -> list[str]:
    """Split a draft body into ≤280-char tweets. Blank lines separate parts
    (matches the 'N/M …' thread format); long parts are word-wrapped."""
    body = (body or "").strip()
    if not body:
        return []
    parts = [p.strip() for p in re.split(r"\n\s*\n", body) if p.strip()] or [body]
    out: list[str] = []
    for p in parts:
        while len(p) > LIMIT:
            cut = p.rfind(" ", 0, LIMIT)
            if cut <= 0:
                cut = LIMIT
            out.append(p[:cut].strip())
            p = p[cut:].strip()
        if p:
            out.append(p)
    return out


def plan(body: str) -> dict:
    """Preview the tweets without posting (used by `--dry-run`)."""
    tweets = split_thread(body)
    return {
        "platform": "x",
        "parts": len(tweets),
        "tweets": tweets,
        "has_creds": _creds() is not None,
    }


def publish(body: str, *, dry_run: bool = False) -> PublishResult:
    tweets = split_thread(body)
    if not tweets:
        return PublishResult(ok=False, platform="x", error="empty content")
    if dry_run:
        return PublishResult(ok=True, platform="x", parts=len(tweets))

    creds = _creds()
    if not creds:
        return PublishResult(
            ok=False, platform="x",
            error="no X credentials — run `openreply publish set-creds` "
                  "(needs an X developer app with Write access)",
        )
    try:
        import requests
        from requests_oauthlib import OAuth1
    except Exception as e:  # pragma: no cover - dep guard
        return PublishResult(ok=False, platform="x", error=f"missing dependency: {e}")

    auth = OAuth1(creds["api_key"], creds["api_secret"],
                  creds["access_token"], creds["access_secret"])
    ids: list[str] = []
    reply_to: str | None = None
    for t in tweets:
        payload: dict = {"text": t}
        if reply_to:
            payload["reply"] = {"in_reply_to_tweet_id": reply_to}
        try:
            r = requests.post(API_URL, json=payload, auth=auth, timeout=30)
        except Exception as e:
            return PublishResult(ok=False, platform="x", ids=ids, parts=len(ids),
                                 error=f"network error: {e}")
        if r.status_code >= 300:
            return PublishResult(ok=False, platform="x", ids=ids, parts=len(ids),
                                 error=f"X API {r.status_code}: {r.text[:200]}")
        tid = ((r.json() or {}).get("data") or {}).get("id")
        if not tid:
            return PublishResult(ok=False, platform="x", ids=ids, parts=len(ids),
                                 error="X API returned no tweet id")
        ids.append(str(tid))
        reply_to = str(tid)

    url = f"https://x.com/i/web/status/{ids[0]}" if ids else ""
    return PublishResult(ok=True, platform="x", url=url, ids=ids, parts=len(ids))
