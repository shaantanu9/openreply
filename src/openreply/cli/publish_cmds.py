"""`openreply publish ...` — post generated content_items to social platforms.

Outbound, opt-in, and credential-gated: nothing is posted without stored
credentials, and `--dry-run` previews the exact post first. On success the
content_items row is flipped to `posted` with its remote URL recorded.
"""
from __future__ import annotations

import json
import time

import typer

from ..core.credentials import delete_credential, get_credential, set_credential
from ..publish import linkedin as _linkedin
from ..publish import x as _x

publish_app = typer.Typer(help="Publish content to social platforms (X, LinkedIn, …).")


def _out(obj, as_json: bool) -> None:
    typer.echo(json.dumps(obj, default=str, indent=2) if as_json else obj)


def _load_content(content_id: str) -> dict | None:
    from ..reply.schema import init_reply_schema

    db = init_reply_schema()
    rows = list(db["content_items"].rows_where("id = ?", [content_id], limit=1))
    return rows[0] if rows else None


@publish_app.command("status")
def status_cmd(json_: bool = typer.Option(True, "--json/--no-json")):
    """Which platforms have publish credentials stored."""
    _out({
        "x": get_credential("x_publish") is not None,
        "linkedin": get_credential("linkedin_publish") is not None,
    }, json_)


@publish_app.command("set-creds")
def set_creds_cmd(
    api_key: str = typer.Option(..., help="X API key (consumer key)"),
    api_secret: str = typer.Option(..., help="X API secret (consumer secret)"),
    access_token: str = typer.Option(..., help="X access token (write-enabled)"),
    access_secret: str = typer.Option(..., help="X access token secret"),
    json_: bool = typer.Option(True, "--json/--no-json"),
):
    """Store X (Twitter) OAuth 1.0a write credentials (4 keys)."""
    set_credential(
        "x_publish",
        {
            "api_key": api_key, "api_secret": api_secret,
            "access_token": access_token, "access_secret": access_secret,
        },
        kind="api_key",
    )
    _out({"ok": True, "source": "x_publish", "stored": True}, json_)


@publish_app.command("set-creds-linkedin")
def set_creds_linkedin_cmd(
    access_token: str = typer.Option(..., help="LinkedIn OAuth 2 access token (w_member_social)"),
    author_urn: str = typer.Option(..., help="Author URN, e.g. urn:li:person:abc123"),
    json_: bool = typer.Option(True, "--json/--no-json"),
):
    """Store LinkedIn OAuth 2 write credentials (access token + author URN)."""
    set_credential(
        "linkedin_publish",
        {"access_token": access_token, "author_urn": author_urn},
        kind="api_key",
    )
    _out({"ok": True, "source": "linkedin_publish", "stored": True}, json_)


@publish_app.command("clear-creds")
def clear_creds_cmd(
    platform: str = typer.Argument("x", help="Platform: x | linkedin"),
    json_: bool = typer.Option(True, "--json/--no-json"),
):
    """Remove stored publish credentials for a platform."""
    delete_credential(f"{platform}_publish")
    _out({"ok": True, "cleared": f"{platform}_publish"}, json_)


@publish_app.command("x")
def x_cmd(
    content_id: str = typer.Option(..., "--content-id", help="content_items id to post"),
    dry_run: bool = typer.Option(False, "--dry-run", help="Preview the tweets without posting"),
    json_: bool = typer.Option(True, "--json/--no-json"),
):
    """Post a content_items draft to X as a tweet or thread."""
    item = _load_content(content_id)
    if not item:
        _out({"error": f"no content '{content_id}'"}, json_)
        raise typer.Exit(1)
    body = item.get("body") or ""
    if dry_run:
        _out({**_x.plan(body), "dry_run": True}, json_)
        return
    res = _x.publish(body, dry_run=False).to_dict()
    if res.get("ok"):
        from ..reply.schema import init_reply_schema

        db = init_reply_schema()
        now = int(time.time())
        try:
            db["content_items"].update(
                content_id,
                {"status": "posted", "posted_at": now,
                 "remote_url": res.get("url", ""), "updated_at": now},
            )
        except Exception:
            pass
    _out(res, json_)


@publish_app.command("x-reply")
def x_reply_cmd(
    reply_to_tweet_id: str = typer.Argument(..., help="Tweet id or x.com status URL to reply to"),
    content_id: str = typer.Option(None, "--content-id", help="content_items id to post as reply"),
    text: str = typer.Option(None, "--text", help="Raw reply text (alternative to --content-id)"),
    dry_run: bool = typer.Option(False, "--dry-run", help="Preview without posting"),
    json_: bool = typer.Option(True, "--json/--no-json"),
):
    """Post a reply to an existing X tweet. Provide either --content-id or --text."""
    body = ""
    if content_id:
        item = _load_content(content_id)
        if not item:
            _out({"error": f"no content '{content_id}'"}, json_)
            raise typer.Exit(1)
        body = item.get("body") or ""
    elif text:
        body = text
    else:
        _out({"error": "Provide --content-id or --text"}, json_)
        raise typer.Exit(1)

    # Extract tweet id from URL if needed.
    tweet_id = reply_to_tweet_id
    if "/status/" in tweet_id:
        import re
        m = re.search(r"/status/(\d+)", tweet_id)
        if m:
            tweet_id = m.group(1)

    if dry_run:
        _out({**_x.plan(body), "reply_to_tweet_id": tweet_id, "dry_run": True}, json_)
        return
    res = _x.publish_reply(body, tweet_id, dry_run=False).to_dict()
    _out(res, json_)


@publish_app.command("linkedin")
def linkedin_cmd(
    content_id: str = typer.Option(..., "--content-id", help="content_items id to post"),
    dry_run: bool = typer.Option(False, "--dry-run", help="Preview the LinkedIn post without posting"),
    json_: bool = typer.Option(True, "--json/--no-json"),
):
    """Post a content_items draft to LinkedIn as a text share."""
    item = _load_content(content_id)
    if not item:
        _out({"error": f"no content '{content_id}'"}, json_)
        raise typer.Exit(1)
    body = item.get("body") or ""
    if dry_run:
        _out({**_linkedin.plan(body), "dry_run": True}, json_)
        return
    res = _linkedin.publish(body, dry_run=False).to_dict()
    if res.get("ok"):
        from ..reply.schema import init_reply_schema

        db = init_reply_schema()
        now = int(time.time())
        try:
            db["content_items"].update(
                content_id,
                {"status": "posted", "posted_at": now,
                 "remote_url": res.get("url", ""), "updated_at": now},
            )
        except Exception:
            pass
    _out(res, json_)
