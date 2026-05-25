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
    return praw.Reddit(
        client_id=cfg.reddit_client_id,
        client_secret=cfg.reddit_client_secret,
        refresh_token=cfg.reddit_refresh_token,
        user_agent=cfg.reddit_user_agent,
    )


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
