"""Fetch X/Twitter profile + posts via internal GraphQL API.

Backend priority (all are best-effort):
  1. vendored bird-search.mjs Node client — works with placeholder cookies for
     many public timelines/searches, so the account-fetch flow is usable even
     when the user has not imported real browser cookies yet.
  2. direct X GraphQL with the stored auth_token + ct0 — full fidelity when
     real cookies are available.
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

import httpx

from .store import XAccount

_BIRD_MJS = Path(__file__).parent.parent / "sources" / "vendor" / "bird-search" / "bird-search.mjs"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _to_corpus_post(tweet: dict[str, Any], handle: str) -> dict[str, Any] | None:
    """Convert a fetched X tweet into the shared `posts` table shape."""
    tid = str(tweet.get("id") or "")
    if not tid:
        return None
    text = str(tweet.get("text") or "").strip()
    url = tweet.get("url") or f"https://x.com/{handle}/status/{tid}"
    created = tweet.get("created_at") or ""
    # Parse ISO-ish created_at to unix timestamp best-effort.
    created_utc = 0.0
    try:
        if created:
            created_utc = datetime.fromisoformat(created.replace("Z", "+00:00")).timestamp()
    except Exception:
        pass
    return {
        "id": f"x_{tid}",
        "sub": "x",
        "source_type": "x",
        "author": handle,
        "title": text[:200] or f"X post by @{handle}",
        "selftext": text,
        "url": url,
        "score": int(tweet.get("likes") or 0),
        "upvote_ratio": None,
        "num_comments": int(tweet.get("replies") or 0),
        "created_utc": created_utc,
        "is_self": 1,
        "over_18": 0,
        "flair": "",
        "permalink": url,
        "fetched_at": _now_iso(),
    }


def save_posts_to_corpus(
    account: XAccount,
    posts: list[dict[str, Any]] | None = None,
    *,
    count: int = 25,
    with_threads: bool = False,
    agent_id: str | None = None,
) -> dict[str, Any]:
    """Fetch (or use provided) X-account posts and upsert them into the active
    agent's corpus so they appear in Library, Knowledge, and Compose.

    Returns {"saved": int, "tagged": int, ...}.
    """
    from ..core.db import upsert_posts
    from ..research.collect import _tag_posts
    from ..reply.agent import active_id, get_agent

    rows = posts if posts is not None else fetch_posts(account, count=count, with_threads=with_threads)
    if rows is None:
        rows = []

    handle = account.handle
    corpus_rows: list[dict[str, Any]] = []
    for t in rows:
        main = _to_corpus_post(t, handle)
        if main:
            corpus_rows.append(main)
        # Also flatten any inline reply thread into separate corpus rows.
        for reply in t.get("thread") or []:
            r = _to_corpus_post(reply, handle)
            if r:
                corpus_rows.append(r)

    if not corpus_rows:
        return {"saved": 0, "tagged": 0, "message": "No posts to save."}

    upsert_posts(corpus_rows)

    aid = agent_id or active_id() or "default"
    agent = get_agent(aid)
    topic = agent.get("topic") or agent.get("name") if agent else aid
    tagged = _tag_posts(topic, [r["id"] for r in corpus_rows], source=f"x-account:{handle}")

    return {
        "saved": len(corpus_rows),
        "tagged": tagged,
        "message": f"Saved {len(corpus_rows)} post(s) from @{handle} to Library.",
    }

BEARER_TOKEN = "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs=1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA"
USER_BY_SCREEN_NAME_QUERY_ID = "xc8f1g7BYqr6VTzTbvNlGw"
USER_TWEETS_QUERY_ID = "E3opETHurmVJflFsUBVuUQ"
TWEET_DETAIL_QUERY_ID = "zXf2g39xQjDsNI6p1R7gzA"


# The vendored bird client only needs *something* in AUTH_TOKEN/CT0 to make
# requests; real cookies improve rate limits but many public timelines work
# with placeholder values. We always prefer real cookies when present.
def _bird_env(account: XAccount) -> dict[str, str]:
    env = os.environ.copy()
    env["BIRD_DISABLE_BROWSER_COOKIES"] = "1"
    env.setdefault("AUTH_TOKEN", account.auth_token or "placeholder")
    env.setdefault("CT0", account.ct0 or "placeholder")
    return env


def _bird_available() -> bool:
    return shutil.which("node") is not None and _BIRD_MJS.exists()


def _run_bird(
    account: XAccount,
    args: list[str],
    timeout: float = 90,
) -> list[dict[str, Any]]:
    """Run bird-search.mjs with the given args and return parsed tweets."""
    if not _bird_available():
        return []
    try:
        result = subprocess.run(
            ["node", str(_BIRD_MJS), *args, "--json"],
            capture_output=True,
            text=True,
            timeout=timeout,
            env=_bird_env(account),
        )
        if result.returncode != 0:
            return []
        parsed = json.loads((result.stdout or "").strip() or "[]")
        if isinstance(parsed, dict):
            if parsed.get("error"):
                return []
            parsed = parsed.get("items") or parsed.get("tweets") or []
        if not isinstance(parsed, list):
            return []
        return [t for t in parsed if isinstance(t, dict)]
    except Exception:
        return []


def _parse_bird_tweet(t: dict[str, Any]) -> dict[str, Any] | None:
    """Convert a bird tweet dict into the x_account canonical shape."""
    tweet_id = str(t.get("id") or "")
    if not tweet_id:
        return None
    author = t.get("author") or {}
    handle = str(author.get("username") or "").lstrip("@") or "[unknown]"
    text = str(t.get("text") or "").strip()
    created = t.get("createdAt") or ""
    return {
        "id": tweet_id,
        "url": f"https://x.com/{handle}/status/{tweet_id}",
        "text": text,
        "likes": int(t.get("likeCount") or 0),
        "retweets": int(t.get("retweetCount") or 0),
        "replies": int(t.get("replyCount") or 0),
        "created_at": created,
        "is_reply": bool(t.get("inReplyToStatusId")),
        "is_retweet": text.startswith("RT @"),
        "conversation_id": str(t.get("conversationId") or tweet_id),
        "in_reply_to_status_id": str(t.get("inReplyToStatusId") or ""),
    }


def import_browser_cookies() -> dict[str, str] | None:
    """Try to extract X auth cookies from the default browser.

    Returns {"auth_token": ..., "ct0": ...} if BOTH cookies are found,
    otherwise None. Falls back to manual paste if this returns None.
    """
    try:
        from ..sources import _cookie_extract as ce

        return ce.x_auth_from_browsers()
    except Exception:
        return None


def _headers(account: XAccount) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {BEARER_TOKEN}",
        "X-Csrf-Token": account.ct0,
        "X-Twitter-Auth-Type": "OAuth2Session",
        "X-Twitter-Active-User": "yes",
        "Content-Type": "application/json",
        "Cookie": f"auth_token={account.auth_token}; ct0={account.ct0}",
    }


def _graphql_get(
    account: XAccount,
    query_id: str,
    operation: str,
    variables: dict[str, Any],
    features: dict[str, Any] | None = None,
    timeout: float = 20,
) -> dict[str, Any]:
    """Low-level GraphQL GET wrapper with standard X headers."""
    _feat = {
        "responsive_web_graphql_exclude_directive_enabled": True,
        "verified_phone_label_enabled": False,
        "creator_subscriptions_tweet_preview_api_enabled": True,
        "responsive_web_graphql_timeline_navigation_enabled": True,
        "responsive_web_graphql_skip_user_profile_image_extensions_enabled": False,
    }
    if features:
        _feat.update(features)
    url = f"https://x.com/i/api/graphql/{query_id}/{operation}"
    with httpx.Client(headers=_headers(account), timeout=timeout, follow_redirects=False) as client:
        try:
            r = client.get(
                url,
                params={"variables": json.dumps(variables), "features": json.dumps(_feat)},
            )
            r.raise_for_status()
        except httpx.HTTPStatusError as exc:
            status = exc.response.status_code
            body = exc.response.text or ""
            if status == 401:
                raise httpx.HTTPStatusError(
                    "X returned 401 Unauthorized. Your auth_token or ct0 cookie is missing, expired, or invalid. "
                    "Log in to x.com in your browser, then re-run 'openreply x-account import-browser <handle>'.",
                    request=exc.request,
                    response=exc.response,
                ) from exc
            if status == 403:
                raise httpx.HTTPStatusError(
                    "X returned 403 Forbidden. The account may be suspended or the GraphQL query id may be outdated.",
                    request=exc.request,
                    response=exc.response,
                ) from exc
            if status in (404, 429):
                raise httpx.HTTPStatusError(
                    f"X returned {status}. If 429, wait a few minutes and try again.",
                    request=exc.request,
                    response=exc.response,
                ) from exc
            raise
        return r.json()


def fetch_profile(account: XAccount) -> dict[str, Any]:
    """Resolve screen name → user profile (rest_id, name, bio, followers).

    Tries the vendored bird client first (works with placeholder cookies for
    public profiles), then falls back to direct GraphQL for full metadata.
    """
    if _bird_available():
        tweets = _run_bird(account, ["--user", account.handle, "--count", "1"])
        if tweets:
            author = tweets[0].get("author") or {}
            return {
                "id": str(tweets[0].get("authorId") or ""),
                "handle": str(author.get("username") or account.handle).lstrip("@"),
                "name": author.get("name") or "",
                "bio": "",
                "followers": 0,
                "following": 0,
                "tweets": 0,
                "verified": False,
            }

    data = _graphql_get(
        account,
        USER_BY_SCREEN_NAME_QUERY_ID,
        "UserByScreenName",
        {"screen_name": account.handle, "withSafetyModeUserFields": True},
        features={
            "hidden_profile_likes_enabled": True,
            "hidden_profile_subscriptions_enabled": True,
            "highlights_tweets_tab_ui_enabled": True,
            "responsive_web_twitter_article_notes_tab_enabled": False,
            "tweetypie_unmention_optimization_enabled": True,
            "responsive_web_edit_tweet_api_enabled": True,
            "graphql_is_translatable_rweb_tweet_is_translatable_enabled": True,
            "view_counts_everywhere_api_enabled": True,
            "longform_notetweets_consumption_enabled": True,
            "responsive_web_twitter_article_tweet_consumption_enabled": False,
            "tweet_awards_web_tipping_enabled": False,
            "freedom_of_speech_not_reach_fetch_enabled": True,
            "standardized_nudges_misinfo": True,
            "tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled": True,
            "rweb_video_timestamps_enabled": True,
            "longform_notetweets_rich_text_read_enabled": True,
            "longform_notetweets_inline_media_enabled": True,
            "responsive_web_enhance_cards_enabled": False,
        },
    )

    user = data.get("data", {}).get("user", {}).get("result", {})
    legacy = user.get("legacy", {})
    return {
        "id": user.get("rest_id"),
        "handle": account.handle,
        "name": legacy.get("name"),
        "bio": legacy.get("description"),
        "followers": legacy.get("followers_count"),
        "following": legacy.get("friends_count"),
        "tweets": legacy.get("statuses_count"),
        "verified": legacy.get("verified", False),
    }


def _parse_tweet_legacy(legacy: dict[str, Any], handle: str) -> dict[str, Any] | None:
    """Normalize a Twitter legacy tweet object into our canonical post shape."""
    tweet_id = legacy.get("id_str")
    if not tweet_id:
        return None
    text = legacy.get("full_text", "")
    return {
        "id": tweet_id,
        "url": f"https://x.com/{handle}/status/{tweet_id}",
        "text": text,
        "likes": legacy.get("favorite_count", 0),
        "retweets": legacy.get("retweet_count", 0),
        "replies": legacy.get("reply_count", 0),
        "created_at": legacy.get("created_at"),
        "is_reply": bool(legacy.get("in_reply_to_status_id_str")),
        "is_retweet": bool(legacy.get("retweeted_status_result")) or text.startswith("RT @"),
        "conversation_id": legacy.get("conversation_id_str"),
        "in_reply_to_status_id": legacy.get("in_reply_to_status_id_str"),
    }


def fetch_posts(account: XAccount, count: int = 10, with_threads: bool = False) -> list[dict[str, Any]]:
    """Fetch recent tweets from the account's own timeline.

    Tries the vendored bird client first, then falls back to direct GraphQL.
    If `with_threads` is True, also fetch the full reply thread for any tweet
    that is itself a reply.
    """
    if _bird_available():
        raw = _run_bird(account, ["--user", account.handle, "--count", str(count)])
        results = []
        for t in raw:
            parsed = _parse_bird_tweet(t)
            if not parsed:
                continue
            if with_threads and parsed.get("in_reply_to_status_id"):
                try:
                    parsed["thread"] = fetch_thread(account, parsed["in_reply_to_status_id"])
                except Exception:
                    parsed["thread"] = []
            results.append(parsed)
        if results:
            return results

    profile = fetch_profile(account)
    user_id = profile.get("id")
    if not user_id:
        raise ValueError("Could not resolve user_id for account")

    data = _graphql_get(
        account,
        USER_TWEETS_QUERY_ID,
        "UserTweets",
        {
            "userId": user_id,
            "count": count,
            "includePromotedContent": False,
            "withQuickPromoteEligibilityTweetFields": False,
            "withVoice": False,
            "withV2Timeline": True,
        },
        features={
            "tweetypie_unmention_optimization_enabled": True,
            "responsive_web_edit_tweet_api_enabled": True,
            "graphql_is_translatable_rweb_tweet_is_translatable_enabled": True,
            "view_counts_everywhere_api_enabled": True,
            "longform_notetweets_consumption_enabled": True,
            "responsive_web_twitter_article_tweet_consumption_enabled": False,
            "tweet_awards_web_tipping_enabled": False,
            "freedom_of_speech_not_reach_fetch_enabled": True,
            "standardized_nudges_misinfo": True,
            "tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled": True,
            "rweb_video_timestamps_enabled": True,
            "longform_notetweets_rich_text_read_enabled": True,
            "longform_notetweets_inline_media_enabled": True,
            "responsive_web_enhance_cards_enabled": False,
        },
    )

    instructions = (
        data.get("data", {})
        .get("user", {})
        .get("result", {})
        .get("timeline_v2", {})
        .get("timeline", {})
        .get("instructions", [])
    )

    results: list[dict[str, Any]] = []
    for instr in instructions:
        for entry in instr.get("entries", []):
            tweet = entry.get("content", {}).get("itemContent", {}).get("tweet_results", {}).get("result", {})
            legacy = tweet.get("legacy", {})
            if not legacy:
                continue
            parsed = _parse_tweet_legacy(legacy, account.handle)
            if not parsed:
                continue
            if with_threads and parsed.get("in_reply_to_status_id"):
                try:
                    parsed["thread"] = fetch_thread(account, parsed["in_reply_to_status_id"])
                except Exception:
                    parsed["thread"] = []
            results.append(parsed)
    return results


def _extract_tweet_id(value: str) -> str:
    """Extract a tweet id from a URL or raw id string."""
    value = value.strip()
    if re.fullmatch(r"\d+", value):
        return value
    m = re.search(r"/status/(\d+)", value)
    if m:
        return m.group(1)
    m = re.search(r"/(\d{10,})", value)
    if m:
        return m.group(1)
    raise ValueError(f"Cannot parse tweet id from {value!r}")


def fetch_thread(account: XAccount, tweet_id_or_url: str, limit: int = 50) -> list[dict[str, Any]]:
    """Fetch a conversation thread rooted at a given tweet id or URL.

    Tries bird search `conversation_id:<id>` first (works with placeholder
    cookies), then falls back to the X GraphQL `TweetDetail` endpoint.
    Returns all tweets in chronological order.
    """
    tweet_id = _extract_tweet_id(tweet_id_or_url)

    if _bird_available():
        raw = _run_bird(account, [f"conversation_id:{tweet_id}", "--count", str(limit)])
        results = []
        for t in raw:
            parsed = _parse_bird_tweet(t)
            if parsed:
                results.append(parsed)
        if results:
            return sorted(results, key=lambda t: t.get("created_at") or "")

    data = _graphql_get(
        account,
        TWEET_DETAIL_QUERY_ID,
        "TweetDetail",
        {
            "focalTweetId": tweet_id,
            "with_rux_injections": False,
            "includePromotedContent": False,
            "withCommunity": True,
            "withQuickPromoteEligibilityTweetFields": False,
            "withBirdwatchNotes": False,
            "withSuperFollowsUserFields": True,
            "withDownvotePerspective": False,
            "withReactionsMetadata": False,
            "withReactionsPerspective": False,
            "withSuperFollowsTweetFields": True,
            "withVoice": False,
            "withV2Timeline": True,
        },
        features={
            "rweb_lists_timeline_redesign_enabled": True,
            "responsive_web_graphql_exclude_directive_enabled": True,
            "verified_phone_label_enabled": False,
            "creator_subscriptions_tweet_preview_api_enabled": True,
            "responsive_web_graphql_timeline_navigation_enabled": True,
            "responsive_web_graphql_skip_user_profile_image_extensions_enabled": False,
            "tweetypie_unmention_optimization_enabled": True,
            "responsive_web_edit_tweet_api_enabled": True,
            "graphql_is_translatable_rweb_tweet_is_translatable_enabled": True,
            "view_counts_everywhere_api_enabled": True,
            "longform_notetweets_consumption_enabled": True,
            "responsive_web_twitter_article_tweet_consumption_enabled": False,
            "tweet_awards_web_tipping_enabled": False,
            "freedom_of_speech_not_reach_fetch_enabled": True,
            "standardized_nudges_misinfo": True,
            "tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled": True,
            "rweb_video_timestamps_enabled": True,
            "longform_notetweets_rich_text_read_enabled": True,
            "longform_notetweets_inline_media_enabled": True,
            "responsive_web_enhance_cards_enabled": False,
        },
        timeout=30,
    )

    instructions = (
        data.get("data", {})
        .get("threaded_conversation_with_injections_v2", {})
        .get("instructions", [])
    )

    seen: set[str] = set()
    results: list[dict[str, Any]] = []
    for instr in instructions:
        for entry in instr.get("entries", []):
            item = entry.get("content", {})
            # Top-level tweet or reply
            tweet = (
                item.get("itemContent", {}).get("tweet_results", {}).get("result", {})
                or item.get("tweetResult", {})
            )
            legacy = tweet.get("legacy", {})
            if not legacy:
                continue
            author = (
                tweet.get("core", {}).get("user_results", {}).get("result", {}).get("legacy", {})
                or {}
            )
            handle = author.get("screen_name") or account.handle
            parsed = _parse_tweet_legacy(legacy, handle)
            if not parsed:
                continue
            if parsed["id"] in seen:
                continue
            seen.add(parsed["id"])
            results.append(parsed)
            if len(results) >= limit:
                break
    return sorted(results, key=lambda t: t.get("created_at") or "")
