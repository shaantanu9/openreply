"""LinkedIn outbound adapter — post a single text update via UGC Posts API v2.

Auth: OAuth 2 user access token with `w_member_social` scope, plus the author's
LinkedIn URN (e.g. `urn:li:person:abc123`). Store both via
`openreply publish set-creds-linkedin` into source_credentials["linkedin_publish"].

LinkedIn does not support native threaded posts through this API, so a long body
is posted as a single text share. The content engine should already emit
LinkedIn-shaped prose (short paragraphs with line breaks) via the
`_PLATFORM_HINTS["linkedin"]` prompt.
"""
from __future__ import annotations

from ..core.credentials import get_credential
from .base import PublishResult

API_URL = "https://api.linkedin.com/v2/ugcPosts"
SOURCE = "linkedin_publish"
REQUIRED = ("access_token", "author_urn")


def _creds() -> dict | None:
    c = get_credential(SOURCE)
    if not c:
        return None
    keys = c.get("cookies") or {}
    return keys if all(keys.get(k) for k in REQUIRED) else None


def _share_urn_to_url(urn: str) -> str:
    """Best-effort canonical LinkedIn feed URL from a share URN."""
    if not urn:
        return ""
    # urn:li:share:123456789 -> https://www.linkedin.com/feed/update/urn:li:share:123456789
    if urn.startswith("urn:li:share:"):
        return f"https://www.linkedin.com/feed/update/{urn}"
    return ""


def plan(body: str) -> dict:
    """Preview the LinkedIn post without posting (used by `--dry-run`)."""
    return {
        "platform": "linkedin",
        "parts": 1,
        "body": (body or "").strip(),
        "has_creds": _creds() is not None,
    }


def publish(body: str, *, dry_run: bool = False) -> PublishResult:
    body = (body or "").strip()
    if not body:
        return PublishResult(ok=False, platform="linkedin", error="empty content")
    if dry_run:
        return PublishResult(ok=True, platform="linkedin", parts=1)

    creds = _creds()
    if not creds:
        return PublishResult(
            ok=False,
            platform="linkedin",
            error=(
                "no LinkedIn credentials — run `openreply publish set-creds-linkedin` "
                "(needs an access token with w_member_social and your author URN)"
            ),
        )

    try:
        import requests
    except Exception as e:  # pragma: no cover - dep guard
        return PublishResult(ok=False, platform="linkedin", error=f"missing dependency: {e}")

    payload = {
        "author": creds["author_urn"],
        "lifecycleState": "PUBLISHED",
        "specificContent": {
            "com.linkedin.ugc.ShareContent": {
                "shareCommentary": {"text": body},
                "shareMediaCategory": "NONE",
            }
        },
        "visibility": {"com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC"},
    }
    headers = {
        "Authorization": f"Bearer {creds['access_token']}",
        "Content-Type": "application/json",
        "X-Restli-Protocol-Version": "2.0.0",
    }

    try:
        r = requests.post(API_URL, json=payload, headers=headers, timeout=30)
    except Exception as e:
        return PublishResult(ok=False, platform="linkedin", error=f"network error: {e}")

    if r.status_code >= 300:
        detail = r.text[:300]
        return PublishResult(
            ok=False,
            platform="linkedin",
            error=f"LinkedIn API {r.status_code}: {detail}",
        )

    # LinkedIn returns 201 with the URN in the X-RestLi-Id header.
    urn = r.headers.get("X-RestLi-Id") or r.headers.get("x-restli-id") or ""
    if not urn:
        try:
            urn = (r.json() or {}).get("id") or ""
        except Exception:
            pass
    remote_id = urn
    url = _share_urn_to_url(urn)
    return PublishResult(ok=True, platform="linkedin", url=url, ids=[remote_id] if remote_id else [], parts=1)
