"""ProductHunt via their GraphQL API v2. Free developer tier.

Three ways to authenticate, tried in order (first that works wins):

1. A ready-made bearer token — set ``PH_TOKEN`` in the env, OR paste it into the
   in-app Connections card (stored as the ``producthunt`` api_key credential).
   Get one at https://api.producthunt.com/v2/oauth/applications → your app →
   "Developer Token" (no expiry, simplest for a single user).
2. Client credentials — set ``PH_CLIENT_ID`` + ``PH_CLIENT_SECRET`` (env or the
   Connections login-pair). We mint an app-only bearer token via the OAuth
   ``client_credentials`` grant and cache it in-process. This is the proper
   programmatic path (no manual token copy, auto-refreshes on expiry).

Without any of these, degrades gracefully to an empty list with a hint.
"""
from __future__ import annotations

import os
import time
from datetime import datetime, timezone
from typing import Any

import httpx

from ._http import DEFAULT_HEADERS

_API = "https://api.producthunt.com/v2/api/graphql"
_OAUTH_TOKEN_URL = "https://api.producthunt.com/v2/oauth/token"

# In-process cache for a minted client_credentials token: (token, expires_at_ts).
_MINTED: dict[str, tuple[str, float]] = {}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _stored(source: str) -> str:
    """Read a stored connected credential (Connections UI), or '' if none/unavailable."""
    try:
        from ..core import credentials as _creds
    except Exception:
        return ""
    try:
        return _creds.api_key(source) or ""
    except Exception:
        return ""


def _client_pair() -> tuple[str, str]:
    """Resolve (client_id, client_secret) from env or the stored login-pair.

    The Connections login-pair stores the two fields as cookies
    {"client_id": ..., "client_secret": ...} under the ``producthunt`` source.
    """
    cid = os.getenv("PH_CLIENT_ID") or ""
    csec = os.getenv("PH_CLIENT_SECRET") or ""
    if cid and csec:
        return cid, csec
    try:
        from ..core import credentials as _creds
        cred = _creds.get_credential("producthunt") or {}
        cookies = cred.get("cookies") or {}
        return (cid or str(cookies.get("client_id") or ""),
                csec or str(cookies.get("client_secret") or ""))
    except Exception:
        return cid, csec


def _mint_client_credentials_token() -> str | None:
    """Mint (and cache) an app-only bearer token via client_credentials.

    Returns the token, or None if credentials are absent / the mint fails.
    Product Hunt app-only tokens are long-lived; we cache until ~60s before
    the reported expiry and re-mint transparently after that.
    """
    cid, csec = _client_pair()
    if not (cid and csec):
        return None
    cached = _MINTED.get(cid)
    if cached and cached[1] > time.time() + 60:
        return cached[0]
    try:
        r = httpx.post(
            _OAUTH_TOKEN_URL,
            headers={**DEFAULT_HEADERS, "Content-Type": "application/json"},
            json={
                "client_id": cid,
                "client_secret": csec,
                "grant_type": "client_credentials",
            },
            timeout=20,
        )
        r.raise_for_status()
        data = r.json() or {}
    except (httpx.HTTPError, ValueError):
        return None
    tok = str(data.get("access_token") or "")
    if not tok:
        return None
    # PH returns seconds-since-epoch-ish `expires_in` is not always present;
    # default to 2h if absent (tokens are typically much longer-lived).
    try:
        ttl = float(data.get("expires_in") or 7200)
    except (TypeError, ValueError):
        ttl = 7200.0
    _MINTED[cid] = (tok, time.time() + ttl)
    return tok


def _token() -> str | None:
    """Resolve a usable bearer token: env → stored key → minted client_credentials."""
    return (
        os.getenv("PH_TOKEN")
        or _stored("producthunt")
        or _mint_client_credentials_token()
        or None
    )


def _topic_names(p: dict[str, Any]) -> list[str]:
    topics = p.get("topics") or {}
    edges = topics.get("edges") if isinstance(topics, dict) else []
    names = []
    for edge in (edges or []):
        if not isinstance(edge, dict):
            continue
        node = edge.get("node") or {}
        name = node.get("name") if isinstance(node, dict) else None
        if name:
            names.append(str(name))
    return names


def _row(p: dict[str, Any]) -> dict[str, Any]:
    try:
        ts = datetime.fromisoformat((p.get("createdAt") or "").replace("Z", "+00:00")).timestamp()
    except (ValueError, AttributeError, TypeError):
        ts = 0.0
    user = p.get("user") or {}
    tagline = (p.get("tagline") or "").strip()
    description = (p.get("description") or "").strip()
    body = (tagline + "\n\n" + description).strip() if (tagline and description) else (tagline or description)
    return {
        "id": f"ph_{p.get('id')}",
        "sub": "producthunt",
        "source_type": "producthunt",
        "author": user.get("username") or "[anon]",
        "title": (p.get("name") or "")[:200],
        "selftext": body,
        "url": p.get("website") or p.get("url") or "",
        "score": int(p.get("votesCount") or 0),
        "upvote_ratio": None,
        "num_comments": int(p.get("commentsCount") or 0),
        "created_utc": float(ts),
        "is_self": 1,
        "over_18": 0,
        "flair": ",".join(_topic_names(p)[:3]),
        "permalink": p.get("url") or "",
        "fetched_at": _now_iso(),
    }


def fetch_producthunt(query: str, limit: int = 20, days_back: int = 30) -> list[dict]:
    tok = _token()
    if not tok:
        return [{"_error": "Product Hunt not connected — set PH_TOKEN (developer token) "
                 "or PH_CLIENT_ID + PH_CLIENT_SECRET, or connect it in Settings → "
                 "Connections. Register at api.producthunt.com/v2/oauth/applications"}]

    # Product Hunt's public GraphQL schema is Relay-style: edges { node { ... } }.
    # The `posts` field does not support free-text search, so we fetch recent
    # launches and filter client-side.
    posted_after = datetime.fromtimestamp(time.time() - days_back * 86400, tz=timezone.utc).isoformat()
    q = """
    query($first:Int!, $postedAfter:DateTime!) {
      posts(first: $first, order: NEWEST, postedAfter: $postedAfter) {
        edges {
          node {
            id name tagline description votesCount commentsCount createdAt url website
            user { username }
            topics { edges { node { name } } }
          }
        }
      }
    }
    """
    try:
        r = httpx.post(
            _API,
            headers={**DEFAULT_HEADERS, "Authorization": f"Bearer {tok}", "Content-Type": "application/json"},
            json={"query": q, "variables": {"first": min(50, max(limit, 10)), "postedAfter": posted_after}},
            timeout=20,
        )
        r.raise_for_status()
    except httpx.HTTPError as e:
        return [{"_error": f"Product Hunt HTTP error: {e}"}]

    try:
        payload = r.json() or {}
    except Exception as e:
        return [{"_error": f"Product Hunt response decode error: {e}"}]
    if payload.get("errors"):
        msgs = "; ".join(str(e.get("message")) for e in payload["errors"])
        return [{"_error": f"Product Hunt GraphQL error: {msgs}"}]

    edges = ((payload.get("data") or {}).get("posts", {}).get("edges")) or []
    nodes = [e.get("node") for e in edges if isinstance(e, dict) and isinstance(e.get("node"), dict)]
    ql = (query or "").lower().strip()
    if ql:
        filtered = [
            n for n in nodes
            if ql in (n.get("name") or "").lower()
            or ql in (n.get("tagline") or "").lower()
            or ql in (n.get("description") or "").lower()
            or any(ql in t.lower() for t in _topic_names(n))
        ]
    else:
        filtered = nodes
    return [_row(n) for n in filtered[:limit]]
