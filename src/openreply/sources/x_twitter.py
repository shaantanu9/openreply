"""X / Twitter search via a backend resolution chain:
  1. cookie-extract -> populate AUTH_TOKEN/CT0 from a logged-in browser
  2. bird (vendored Node client) if AUTH_TOKEN/CT0 + Node present
  3. xAI live search if XAI_API_KEY present
  4. Xquik if XQUIK_API_KEY present
First backend returning rows wins. Ported from last30days
lib/{bird_x,xai_x,xquik,cookie_extract}.py.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote

import httpx

from . import _cookie_extract as ce

_BIRD_MJS = Path(__file__).parent / "vendor" / "bird-search" / "bird-search.mjs"

# xAI endpoint (Agent Tools / Responses API)
_XAI_URL = "https://api.x.ai/v1/responses"

# Default model for xAI live search
_XAI_MODEL = "grok-3"

# Xquik REST base
_XQUIK_BASE = "https://xquik.com/api/v1"

_XAI_PROMPT = (
    "You have access to real-time X (Twitter) data. Search for posts about: {topic}\n\n"
    "Find up to {limit} high-quality, relevant posts.\n\n"
    "IMPORTANT: Return ONLY valid JSON in this exact format, no other text:\n"
    "{{\n"
    '  "items": [\n'
    "    {{\n"
    '      "text": "Post text content",\n'
    '      "url": "https://x.com/user/status/...",\n'
    '      "author_handle": "username",\n'
    '      "date": "YYYY-MM-DD or null",\n'
    '      "engagement": {{"likes": 100, "reposts": 25, "replies": 15}}\n'
    "    }}\n"
    "  ]\n"
    "}}\n\n"
    "Rules:\n"
    "- date must be YYYY-MM-DD or null\n"
    "- engagement can be null if unknown\n"
    "- Prefer posts with substantive content"
)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _row(t: dict[str, Any]) -> dict[str, Any]:
    handle = str(t.get("author_handle") or "").lstrip("@") or "[anon]"
    text = (t.get("text") or "").strip()
    return {
        "id": f"x_{t.get('id')}",
        "sub": "x",
        "source_type": "x",
        "author": handle,
        "title": text[:200] or f"X post by @{handle}",
        "selftext": text,
        "url": t.get("url") or "",
        "score": int(t.get("likes") or 0),
        "upvote_ratio": None,
        "num_comments": int(t.get("replies") or 0),
        "created_utc": float(t.get("created_utc") or 0),
        "is_self": 1,
        "over_18": 0,
        "flair": "",
        "permalink": t.get("url") or "",
        "fetched_at": _now_iso(),
    }


def _parse_bird_tweet(tweet: dict, index: int) -> dict[str, Any] | None:
    """Normalise a raw Bird/Twitter tweet dict to intermediate shape."""
    # Prefer permanent_url; fall back to constructing from author + id
    url = tweet.get("permanent_url") or tweet.get("url", "")
    if not url:
        tweet_id = str(tweet.get("id", ""))
        author = tweet.get("author") or tweet.get("user") or {}
        screen = author.get("username") or author.get("screen_name", "")
        if screen and tweet_id:
            url = f"https://x.com/{screen}/status/{tweet_id}"
    if not url:
        return None

    created_at = tweet.get("createdAt") or tweet.get("created_at", "")
    created_utc = 0.0
    if created_at:
        try:
            if len(created_at) > 10 and created_at[10] == "T":
                dt = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
            else:
                dt = datetime.strptime(created_at, "%a %b %d %H:%M:%S %z %Y")
            created_utc = dt.timestamp()
        except (ValueError, TypeError):
            pass

    author = tweet.get("author") or tweet.get("user") or {}
    handle = (
        author.get("username") or author.get("screen_name") or
        tweet.get("author_handle", "")
    ).lstrip("@")

    def _first(*vals):
        for v in vals:
            if v is not None:
                try:
                    return int(v)
                except (ValueError, TypeError):
                    pass
        return 0

    likes = _first(tweet.get("likeCount"), tweet.get("like_count"), tweet.get("favorite_count"))
    replies = _first(tweet.get("replyCount"), tweet.get("reply_count"))

    return {
        "id": str(tweet.get("id") or f"bird{index}"),
        "author_handle": handle,
        "text": str(tweet.get("text") or tweet.get("full_text") or "").strip()[:500],
        "url": url,
        "likes": likes,
        "replies": replies,
        "created_utc": created_utc,
    }


def _fetch_bird(query: str, limit: int) -> list[dict]:
    """Vendored bird-search.mjs Node client. Returns [] if Node/client/keys absent.
    Ported subprocess + JSON parse from last30days lib/bird_x.py."""
    if not (os.getenv("AUTH_TOKEN") and shutil.which("node") and _BIRD_MJS.exists()):
        return []
    try:
        env = os.environ.copy()
        env["BIRD_DISABLE_BROWSER_COOKIES"] = "1"
        result = subprocess.run(
            ["node", str(_BIRD_MJS), query, "--count", str(limit), "--json"],
            capture_output=True,
            text=True,
            timeout=45,
            env=env,
        )
        if result.returncode != 0:
            return []
        output = (result.stdout or "").strip()
        if not output:
            return []
        parsed = json.loads(output)
        # bird-search.mjs returns a JSON array of tweets directly, or
        # an object with "items" / "tweets" key, or {"error":...,"items":[]}
        if isinstance(parsed, list):
            raw_tweets = parsed
        elif isinstance(parsed, dict):
            if parsed.get("error"):
                return []
            raw_tweets = parsed.get("items") or parsed.get("tweets") or []
        else:
            return []
        items = []
        for i, tweet in enumerate(raw_tweets):
            if not isinstance(tweet, dict):
                continue
            norm = _parse_bird_tweet(tweet, i)
            if norm:
                items.append(norm)
        return items
    except Exception:
        return []


def _parse_xai_output(output_text: str) -> list[dict]:
    """Extract tweet items from xAI response text → intermediate dicts."""
    json_match = re.search(r'\{[\s\S]*"items"[\s\S]*\}', output_text)
    if not json_match:
        return []
    try:
        data = json.loads(json_match.group())
    except json.JSONDecodeError:
        return []

    items = []
    for i, item in enumerate(data.get("items") or []):
        if not isinstance(item, dict):
            continue
        url = item.get("url") or ""
        if not url:
            continue
        engagement = item.get("engagement") or {}
        likes = 0
        replies = 0
        if isinstance(engagement, dict):
            try:
                likes = int(engagement.get("likes") or 0)
            except (ValueError, TypeError):
                pass
            try:
                replies = int(engagement.get("replies") or 0)
            except (ValueError, TypeError):
                pass

        # Parse date string -> unix timestamp
        date_str = item.get("date") or ""
        created_utc = 0.0
        if date_str and re.match(r"^\d{4}-\d{2}-\d{2}$", date_str):
            try:
                created_utc = datetime.strptime(date_str, "%Y-%m-%d").replace(
                    tzinfo=timezone.utc
                ).timestamp()
            except (ValueError, TypeError):
                pass

        handle = str(item.get("author_handle") or "").lstrip("@")
        # Extract tweet ID from URL if possible
        tweet_id = f"xai{i}"
        id_match = re.search(r"/status/(\d+)", url)
        if id_match:
            tweet_id = id_match.group(1)

        items.append({
            "id": tweet_id,
            "author_handle": handle,
            "text": str(item.get("text") or "").strip()[:500],
            "url": url,
            "likes": likes,
            "replies": replies,
            "created_utc": created_utc,
        })
    return items


def _fetch_xai(query: str, limit: int) -> list[dict]:
    """xAI live X search via the Responses API.
    Ported request + parse from last30days lib/xai_x.py. Returns [] on error."""
    key = os.getenv("XAI_API_KEY")
    if not key:
        return []
    try:
        from datetime import date
        today = date.today().isoformat()
        # Use a 30-day window for live search
        from_date = date.fromtimestamp(
            datetime.now(timezone.utc).timestamp() - 30 * 86400
        ).isoformat()

        payload = {
            "model": _XAI_MODEL,
            "tools": [
                {"type": "x_search", "from_date": from_date, "to_date": today}
            ],
            "input": [
                {
                    "role": "user",
                    "content": _XAI_PROMPT.format(topic=query, limit=limit),
                }
            ],
        }
        headers = {
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        }
        r = httpx.post(_XAI_URL, json=payload, headers=headers, timeout=120)
        r.raise_for_status()
        resp = r.json()
    except Exception:
        return []

    # Extract output text from the Responses API format
    output_text = ""
    try:
        output = resp.get("output") or []
        if isinstance(output, str):
            output_text = output
        elif isinstance(output, list):
            for item in output:
                if not isinstance(item, dict):
                    continue
                if item.get("type") == "message":
                    for c in item.get("content") or []:
                        if isinstance(c, dict) and c.get("type") == "output_text":
                            output_text = c.get("text") or ""
                            break
                elif "text" in item:
                    output_text = item["text"]
                if output_text:
                    break
        # Fallback: OpenAI-style choices
        if not output_text:
            for choice in resp.get("choices") or []:
                if isinstance(choice, dict) and "message" in choice:
                    output_text = choice["message"].get("content") or ""
                    break
    except Exception:
        return []

    if not output_text:
        return []

    return _parse_xai_output(output_text)


def _parse_xquik_tweet(tweet: dict, index: int) -> dict[str, Any] | None:
    """Normalise a Xquik tweet dict to intermediate shape."""
    author = tweet.get("author") or {}
    username = str(author.get("username") or "").lstrip("@")
    tweet_id = str(tweet.get("id") or "")

    url = ""
    if username and tweet_id:
        url = f"https://x.com/{username}/status/{tweet_id}"
    if not url:
        return None

    created_at = tweet.get("createdAt") or ""
    created_utc = 0.0
    if created_at:
        try:
            if len(created_at) > 10 and created_at[10] == "T":
                dt = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
            else:
                dt = datetime.strptime(created_at, "%a %b %d %H:%M:%S %z %Y")
            created_utc = dt.timestamp()
        except (ValueError, TypeError):
            pass

    def _sint(val):
        if val is None:
            return 0
        try:
            return int(val)
        except (ValueError, TypeError):
            return 0

    return {
        "id": tweet_id or f"xq{index}",
        "author_handle": username,
        "text": str(tweet.get("text") or "").strip()[:500],
        "url": url,
        "likes": _sint(tweet.get("likeCount")),
        "replies": _sint(tweet.get("replyCount")),
        "created_utc": created_utc,
    }


def _fetch_xquik(query: str, limit: int) -> list[dict]:
    """Xquik REST search.
    Ported GET request + parse from last30days lib/xquik.py. Returns [] on error."""
    key = os.getenv("XQUIK_API_KEY")
    if not key:
        return []
    try:
        url = f"{_XQUIK_BASE}/x/tweets/search"
        q_encoded = quote(f"{query}", safe="")
        full_url = f"{url}?q={q_encoded}&queryType=Top&limit={limit}"
        r = httpx.get(
            full_url,
            headers={"X-Api-Key": key},
            timeout=30,
        )
        r.raise_for_status()
        resp = r.json()
    except Exception:
        return []

    tweets = resp.get("tweets") or []
    if not isinstance(tweets, list):
        return []

    items = []
    for i, tweet in enumerate(tweets):
        if not isinstance(tweet, dict):
            continue
        norm = _parse_xquik_tweet(tweet, i)
        if norm:
            items.append(norm)
    return items


def fetch_x(query: str, limit: int = 20) -> list[dict]:
    """Fetch X/Twitter posts via the backend resolution chain.

    Priority: cookie+bird → xAI → Xquik.
    Returns posts-row dicts on success, or [{"_error": "..."}] when all
    backends are unavailable / unconfigured.
    """
    if not os.getenv("AUTH_TOKEN"):
        # Prefer a credential stored via Reach Connections (browser-login →
        # import), then fall back to live browser-cookie extraction.
        pair = None
        try:
            from ..core import credentials as _creds

            cred = _creds.get_credential("twitter")
            if cred and cred["cookies"].get("auth_token") and cred["cookies"].get("ct0"):
                pair = {"auth_token": cred["cookies"]["auth_token"],
                        "ct0": cred["cookies"]["ct0"]}
        except Exception:
            pair = None
        if pair is None:
            pair = ce.x_auth_from_browsers()
        if pair:
            os.environ.setdefault("AUTH_TOKEN", pair["auth_token"])
            os.environ.setdefault("CT0", pair["ct0"])

    for backend in (_fetch_bird, _fetch_xai, _fetch_xquik):
        try:
            items = backend(query, limit)
        except Exception:
            items = []
        if items:
            return [_row(t) for t in items[:limit]]

    return [{"_error": (
        "no X backend available — log into x.com in a browser, "
        "or set XAI_API_KEY or XQUIK_API_KEY in Settings"
    )}]


def _ensure_x_env() -> None:
    """Populate AUTH_TOKEN/CT0 from a stored Reach credential (then live browser),
    mirroring fetch_x's resolution. Best-effort."""
    if os.getenv("AUTH_TOKEN") and os.getenv("CT0"):
        return
    pair = None
    try:
        from ..core import credentials as _creds
        cred = _creds.get_credential("twitter")
        if cred and cred["cookies"].get("auth_token") and cred["cookies"].get("ct0"):
            pair = {"auth_token": cred["cookies"]["auth_token"],
                    "ct0": cred["cookies"]["ct0"]}
    except Exception:
        pair = None
    if pair is None:
        try:
            pair = ce.x_auth_from_browsers()
        except Exception:
            pair = None
    if pair:
        os.environ.setdefault("AUTH_TOKEN", pair["auth_token"])
        os.environ.setdefault("CT0", pair["ct0"])


def fetch_x_user(handle: str, limit: int = 50) -> list[dict]:
    """Fetch a user's full timeline via the bird `--user` mode (UserTweets, with a
    deep `from:<handle>` search fallback inside the JS). Falls back to keyword
    `from:` search via :func:`fetch_x` when Node/bird aren't available. Returns
    posts-row dicts; never raises."""
    h = (handle or "").lstrip("@").strip()
    if not h:
        return []
    _ensure_x_env()
    if not (os.getenv("AUTH_TOKEN") and shutil.which("node") and _BIRD_MJS.exists()):
        return fetch_x(f"from:{h}", limit)
    try:
        env = os.environ.copy()
        env["BIRD_DISABLE_BROWSER_COOKIES"] = "1"
        result = subprocess.run(
            ["node", str(_BIRD_MJS), "--user", h, "--count", str(limit), "--json"],
            capture_output=True, text=True, timeout=90, env=env,
        )
        if result.returncode != 0:
            return fetch_x(f"from:{h}", limit)
        parsed = json.loads((result.stdout or "").strip() or "[]")
        if isinstance(parsed, dict):
            if parsed.get("error"):
                return fetch_x(f"from:{h}", limit)
            raw = parsed.get("items") or parsed.get("tweets") or []
        elif isinstance(parsed, list):
            raw = parsed
        else:
            raw = []
        items = []
        for i, t in enumerate(raw):
            if isinstance(t, dict):
                n = _parse_bird_tweet(t, i)
                if n:
                    items.append(n)
        rows = [_row(t) for t in items[:limit]]
        return rows if rows else fetch_x(f"from:{h}", limit)
    except Exception:
        return fetch_x(f"from:{h}", limit)
