"""Lazy-initialized PRAW client.

Uses OAuth refresh-token flow — no username/password stored. PRAW handles
access-token refresh automatically. Rate limiting stays on (default behavior).
"""
from __future__ import annotations

from functools import lru_cache

import praw

from .config import load_config


@lru_cache(maxsize=1)
def get_reddit() -> praw.Reddit:
    cfg = load_config()
    cfg.require_reddit()
    kwargs = dict(
        client_id=cfg.reddit_client_id,
        client_secret=cfg.reddit_client_secret,
        user_agent=cfg.reddit_user_agent,
    )
    if cfg.reddit_refresh_token:
        # Full user-scoped OAuth (can act as the user).
        kwargs["refresh_token"] = cfg.reddit_refresh_token
        return praw.Reddit(**kwargs)
    # No refresh token → application-only / read-only OAuth. Reddit's 2026 free
    # tier: 100 req/min, full JSON data, no browser login. Perfect for search +
    # collection (we never act as a user). Set read_only explicitly so PRAW uses
    # the client_credentials grant instead of attempting a user flow.
    reddit = praw.Reddit(**kwargs)
    reddit.read_only = True
    return reddit


def get_reddit_unauthed() -> praw.Reddit:
    """For the OAuth bootstrap dance only — no refresh token yet."""
    cfg = load_config()
    if not (cfg.reddit_client_id and cfg.reddit_client_secret):
        raise RuntimeError(
            "Set REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET before running `auth login`."
        )
    return praw.Reddit(
        client_id=cfg.reddit_client_id,
        client_secret=cfg.reddit_client_secret,
        redirect_uri=cfg.reddit_redirect_uri,
        user_agent=cfg.reddit_user_agent,
    )
