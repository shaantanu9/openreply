"""CLI for the minimal X-account worktree."""
from __future__ import annotations

import json

import typer

from .fetch import fetch_posts, fetch_profile, fetch_thread, import_browser_cookies
from .store import add_account, get_account, list_accounts, remove_account

app = typer.Typer(help="X/Twitter account worktree (MVP).")


def _print_json(data: object) -> None:
    print(json.dumps(data, indent=2, default=str))


@app.command("add")
def cmd_add(
    handle: str = typer.Argument(..., help="X handle without @."),
    auth_token: str = typer.Argument(..., help="auth_token cookie value."),
    ct0: str = typer.Argument(..., help="ct0 cookie value (CSRF)."),
    as_json: bool = typer.Option(False, "--json", hidden=True),
) -> None:
    """Add an X account to the local worktree."""
    account = add_account(handle, auth_token, ct0)
    _print_json({"ok": True, "account": account.to_dict()})


@app.command("import-browser")
def cmd_import_browser(
    handle: str = typer.Argument(..., help="X handle without @."),
    as_json: bool = typer.Option(False, "--json", hidden=True),
) -> None:
    """Add an X account by importing auth_token + ct0 from the default browser."""
    cookies = import_browser_cookies()
    if not cookies:
        _print_json({"ok": False, "error": "No X login cookies found in any browser. Log in to x.com and retry."})
        raise typer.Exit(1)
    account = add_account(handle, cookies["auth_token"], cookies["ct0"])
    _print_json({"ok": True, "account": account.to_dict(), "source": "browser"})


@app.command("list")
def cmd_list(
    as_json: bool = typer.Option(False, "--json", hidden=True),
) -> None:
    """List stored X accounts."""
    accounts = [a.to_dict() for a in list_accounts()]
    _print_json({"ok": True, "accounts": accounts})


@app.command("remove")
def cmd_remove(
    handle: str = typer.Argument(..., help="X handle without @."),
    as_json: bool = typer.Option(False, "--json", hidden=True),
) -> None:
    """Remove an X account."""
    ok = remove_account(handle)
    _print_json({"ok": ok})


@app.command("profile")
def cmd_profile(
    handle: str = typer.Argument(..., help="X handle without @."),
    as_json: bool = typer.Option(False, "--json", hidden=True),
) -> None:
    """Fetch profile info for a stored account."""
    account = get_account(handle)
    if not account:
        _print_json({"ok": False, "error": f"Account @{handle} not found"})
        raise typer.Exit(1)
    try:
        profile = fetch_profile(account)
        _print_json({"ok": True, "profile": profile})
    except Exception as e:
        _print_json({"ok": False, "error": f"Fetch failed: {e}"})
        raise typer.Exit(1)


@app.command("fetch-posts")
def cmd_fetch_posts(
    handle: str = typer.Argument(..., help="X handle without @."),
    count: int = typer.Option(10, "--count", "-n", help="Number of tweets to fetch."),
    with_threads: bool = typer.Option(False, "--with-threads", help="Also fetch reply threads for reply tweets."),
    as_json: bool = typer.Option(False, "--json", hidden=True),
) -> None:
    """Fetch recent posts for a stored account."""
    account = get_account(handle)
    if not account:
        _print_json({"ok": False, "error": f"Account @{handle} not found"})
        raise typer.Exit(1)
    try:
        posts = fetch_posts(account, count=count, with_threads=with_threads)
        _print_json({"ok": True, "count": len(posts), "posts": posts})
    except Exception as e:
        _print_json({"ok": False, "error": f"Fetch failed: {e}"})
        raise typer.Exit(1)


@app.command("fetch-thread")
def cmd_fetch_thread(
    handle: str = typer.Argument(..., help="X handle of a stored account (for cookies)."),
    tweet_id_or_url: str = typer.Argument(..., help="Tweet id or x.com status URL."),
    limit: int = typer.Option(50, "--limit", "-l", help="Max replies to fetch."),
    as_json: bool = typer.Option(False, "--json", hidden=True),
) -> None:
    """Fetch a conversation thread for a tweet."""
    account = get_account(handle)
    if not account:
        _print_json({"ok": False, "error": f"Account @{handle} not found"})
        raise typer.Exit(1)
    try:
        thread = fetch_thread(account, tweet_id_or_url, limit=limit)
        _print_json({"ok": True, "count": len(thread), "thread": thread})
    except Exception as e:
        _print_json({"ok": False, "error": f"Fetch failed: {e}"})
        raise typer.Exit(1)
