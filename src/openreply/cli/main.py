"""openreply — Typer app. Every command supports --json for machine output."""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path
from typing import Any, Optional

import typer
from rich.console import Console
from rich.table import Table

from ..core.config import load_config
from ..core.db import get_db
from ..core.exporters import export_rows

app = typer.Typer(
    help="OpenReply — multi-source product gap finder. Fuse Reddit, HN, arXiv, GitHub, and 10+ sources into one searchable corpus, then surface gaps via LLM analysis.",
    no_args_is_help=True,
    add_completion=False,
)
mcp_app = typer.Typer(help="MCP server for Claude Code.")


feeds_app = typer.Typer(help="Manage user-added custom RSS feeds (swept on every collect).")
app.add_typer(feeds_app, name="feeds")


@feeds_app.command("list")
def cmd_feeds_list(as_json: bool = typer.Option(False, "--json", hidden=True)) -> None:
    """List the user's saved custom RSS feeds."""
    _ = as_json
    from ..core.db import list_user_feeds
    console.print_json(data={"ok": True, "feeds": list_user_feeds()})


@feeds_app.command("validate")
def cmd_feeds_validate(
    url: str = typer.Option(..., "--url", help="Feed URL to check."),
    as_json: bool = typer.Option(False, "--json", hidden=True),
) -> None:
    """Validate a feed URL (scheme/SSRF guard → fetch → parse) WITHOUT saving."""
    _ = as_json
    from ..sources.rss import validate_feed
    console.print_json(data=validate_feed(url))


@feeds_app.command("add")
def cmd_feeds_add(
    url: str = typer.Option(..., "--url", help="Feed URL to add."),
    name: str = typer.Option("", "--name", help="Display name (defaults to feed title)."),
    skip_validate: bool = typer.Option(False, "--skip-validate", hidden=True),
    as_json: bool = typer.Option(False, "--json", hidden=True),
) -> None:
    """Validate then save a custom RSS feed. Rejects non-feed / blocked URLs."""
    _ = as_json
    from ..sources.rss import validate_feed
    from ..core.db import add_user_feed
    if not skip_validate:
        v = validate_feed(url)
        if not v.get("ok"):
            console.print_json(data={"ok": False, "error": v.get("error"), "url": url})
            return
        if not name:
            name = v.get("title") or ""
    row = add_user_feed(url, name)
    console.print_json(data={"ok": True, "feed": row})


@feeds_app.command("remove")
def cmd_feeds_remove(
    url: str = typer.Option(..., "--url", help="Feed URL to remove."),
    as_json: bool = typer.Option(False, "--json", hidden=True),
) -> None:
    """Remove a saved custom RSS feed."""
    _ = as_json
    from ..core.db import remove_user_feed
    console.print_json(data={"ok": remove_user_feed(url), "url": url})


@feeds_app.command("enable")
def cmd_feeds_enable(
    url: str = typer.Option(..., "--url", help="Feed URL."),
    enabled: bool = typer.Option(True, "--enabled/--disabled", help="Pause/resume a feed."),
    as_json: bool = typer.Option(False, "--json", hidden=True),
) -> None:
    """Enable or disable (pause) a saved feed. Paused feeds aren't swept."""
    _ = as_json
    from ..core.db import set_user_feed_enabled
    console.print_json(data={"ok": set_user_feed_enabled(url, enabled),
                             "url": url, "enabled": enabled})


def _reload_user_env_for_daemon() -> None:
    """Refresh Settings/BYOK values for the warm dev daemon.

    The one-shot CLI imports ``core.config`` for every process, but the daemon
    imports it once and then lives across Settings edits. Reloading the user
    config file here lets newly saved LLM keys/defaults apply without forcing
    an app restart.
    """
    from dotenv import load_dotenv

    load_dotenv(Path.home() / ".config" / "openreply" / ".env", override=True)


app.add_typer(mcp_app, name="mcp")

# OpenReply — social marketing reply co-pilot (find → score → draft).
from .reply_cmds import reply_app  # noqa: E402
app.add_typer(reply_app, name="reply")

# OpenReply Agents (personas) + content generation.
from .agent_cmds import agent_app, content_app  # noqa: E402
app.add_typer(agent_app, name="agent")
app.add_typer(content_app, name="content")

# Outbound publishing (X / social) — credential-gated, opt-in.
from .publish_cmds import publish_app  # noqa: E402
app.add_typer(publish_app, name="publish")

# Minimal X-account worktree (account store + fetch posts).
from ..x_account.cli import app as x_account_app  # noqa: E402
app.add_typer(x_account_app, name="x-account")

console = Console()


def _emit(data, as_json: bool, table_title: str | None = None) -> None:
    """Print JSON if asked, else a pretty table (falling back to JSON for non-row data)."""
    if as_json:
        typer.echo(json.dumps(data, default=str, ensure_ascii=False, indent=2))
        return

    if isinstance(data, list) and data and isinstance(data[0], dict):
        cols = list(data[0].keys())[:6]  # first 6 cols fit most terminals
        table = Table(title=table_title, show_lines=False)
        for c in cols:
            table.add_column(c, overflow="fold", max_width=40)
        for row in data:
            table.add_row(*[str(row.get(c, ""))[:200] for c in cols])
        console.print(table)
        console.print(f"[dim]{len(data)} row(s)[/dim]")
        return

    console.print_json(data=data if not isinstance(data, str) else {"text": data})


@app.command("search")
def cmd_search(
    query: str = typer.Argument(..., help="Search query"),
    sub: Optional[str] = typer.Option(None, "--sub", "-s"),
    sort: str = typer.Option("relevance", "--sort", help="relevance|hot|new|top|comments"),
    time_filter: str = typer.Option("all", "--time"),
    limit: int = typer.Option(50, "--limit", "-n"),
    as_json: bool = typer.Option(False, "--json"),
) -> None:
    """Search Reddit, optionally scoped to a sub."""
    from ..fetch.search import search_reddit

    rows = search_reddit(query=query, sub=sub, sort=sort, time_filter=time_filter, limit=limit)  # type: ignore[arg-type]
    _emit(rows, as_json, table_title=f'search "{query}" · {len(rows)}')


@app.command("stream")
def cmd_stream(
    sub: str = typer.Option(..., "--sub", "-s"),
    keywords: str = typer.Option("", "--keywords", "-k", help="comma-separated regex patterns. Empty = firehose mode (every post/comment)."),
    watch: str = typer.Option("both", "--watch", help="posts|comments|both"),
    name: Optional[str] = typer.Option(None, "--name"),
    as_json: bool = typer.Option(False, "--json", help="Emit one JSON object per line (NDJSON) instead of rich text. For UI consumption."),
) -> None:
    """Blocking keyword stream. Prints hits + writes to SQLite. Ctrl+C to stop."""
    from ..fetch.stream import start_stream

    kws = [k.strip() for k in keywords.split(",") if k.strip()]
    if not as_json:
        mode = f"keywords={kws}" if kws else "firehose (no filter)"
        console.print(f"[bold]streaming r/{sub}[/bold] · {mode}. Ctrl+C to stop.")

    def _on_hit(hit: dict) -> None:
        if as_json:
            # NDJSON for the UI to parse; flush so the frontend sees each hit immediately.
            print(json.dumps(hit, default=str), flush=True)
        else:
            body = hit.get('title') or hit.get('body', '')
            tags = ', '.join(hit.get('keywords') or []) or 'firehose'
            console.print(
                f"[green]HIT[/green] [{hit['kind']}] {body} [dim]({tags})[/dim]\n  {hit.get('permalink', '')}"
            )

    try:
        # Pass empty list when no keywords → firehose mode (all posts/comments)
        start_stream(sub=sub, keywords=kws, name=name, watch=watch, on_hit=_on_hit)
    except KeyboardInterrupt:
        if not as_json:
            console.print("\n[yellow]stopped.[/yellow]")


_READONLY_SQL = re.compile(r"^\s*(?:select|with|explain|pragma\s+table_info)\b", re.IGNORECASE)
_WRITE_SQL = re.compile(
    r"\b(?:insert|update|delete|drop|alter|create|replace|truncate|attach|detach|reindex|vacuum)\b",
    re.IGNORECASE,
)


def _assert_readonly_sql(sql: str) -> None:
    """Reject anything that isn't a single read-only statement.

    The `query` / `export --sql` paths run caller-supplied SQL against the
    local store. They're meant for SELECTs only — refuse write/DDL verbs and
    multi-statement payloads so a stray (or injected) call can't mutate or
    drop the corpus."""
    body = (sql or "").strip().rstrip(";")
    if ";" in body:
        raise typer.BadParameter("only a single statement is allowed")
    if not _READONLY_SQL.match(body) or _WRITE_SQL.search(body):
        raise typer.BadParameter("only read-only SELECT/WITH queries are allowed")


@app.command("query")
def cmd_query(
    sql: str = typer.Argument(..., help="SQL query against the SQLite store"),
    as_json: bool = typer.Option(False, "--json"),
    topic: Optional[str] = typer.Option(
        None, "--topic",
        help="Bind this value as :topic placeholder in the SQL (safe param substitution, no injection).",
    ),
    param: list[str] = typer.Option(
        [], "--param",
        help="Additional named params as name=value. Multiple allowed. Referenced as :name in SQL.",
    ),
) -> None:
    """Run a raw SQL query. Tables: posts, comments, users, subreddits, fetches, streams, stream_hits, topic_posts, graph_nodes, graph_edges.

    Safe param substitution (prevents SQL injection on topic names etc.):
      openreply query "SELECT * FROM topic_posts WHERE topic = :topic" --topic "my app"
      openreply query "SELECT * FROM graph_nodes WHERE topic=:topic AND kind=:k" --topic X --param k=painpoint
    """
    _assert_readonly_sql(sql)
    db = get_db()
    params: dict[str, str] = {}
    if topic is not None:
        params["topic"] = topic
    for p in param:
        if "=" not in p:
            continue
        k, _, v = p.partition("=")
        params[k.strip()] = v
    rows = list(db.query(sql, params) if params else db.query(sql))
    _emit(rows, as_json, table_title=f"{len(rows)} row(s)")


@app.command("export")
def cmd_export(
    table: str = typer.Argument(..., help="posts|comments|users|custom"),
    sub: Optional[str] = typer.Option(None, "--sub", "-s"),
    since: Optional[str] = typer.Option(None, "--since", help='e.g. "7d", "30d", "24h"'),
    fmt: str = typer.Option("json", "--format", "-f"),
    out: Optional[Path] = typer.Option(None, "--out", "-o"),
    sql: Optional[str] = typer.Option(None, "--sql", help="Custom SELECT (overrides table/sub/since)"),
) -> None:
    """Export rows to JSON / CSV / Parquet."""
    db = get_db()
    if sql:
        _assert_readonly_sql(sql)
        rows = list(db.query(sql))
    else:
        # `table` is interpolated into the SQL (identifiers can't be bound as
        # params), so it MUST be a real table name — validate against the live
        # schema to close the injection vector.
        if table not in set(db.table_names()):
            raise typer.BadParameter(
                f"unknown table '{table}'. Use --sql for a custom SELECT."
            )
        where, params = [], []
        if sub and table in ("posts",):
            where.append("sub = ?")
            params.append(sub.lower())
        if since and table in ("posts", "comments"):
            unit = since[-1].lower()
            n = int(since[:-1])
            secs = {"h": 3600, "d": 86400, "w": 604800}[unit] * n
            where.append("created_utc >= strftime('%s','now') - ?")
            params.append(secs)
        q = f"SELECT * FROM {table}"
        if where:
            q += " WHERE " + " AND ".join(where)
        rows = list(db.query(q, params))

    result = export_rows(rows, out, fmt=fmt)
    if out:
        console.print(f"[green]wrote {len(rows)} rows → {result}[/green]")
    else:
        typer.echo(result)


@app.command("collect-growth")
def cmd_collect_growth(
    topic: str = typer.Argument(..., help="Topic / keyword to collect growth content for."),
    bundle: str = typer.Option(
        "content",
        "--bundle", "-b",
        help="content | social | opensource | web",
    ),
    limit: int = typer.Option(20, "--limit", "-n", help="Rows per source."),
    include: Optional[str] = typer.Option(
        None, "--include",
        help="Comma-separated source ids (overrides the bundle).",
    ),
    exclude: Optional[str] = typer.Option(
        None, "--exclude",
        help="Comma-separated source ids to skip.",
    ),
    max_workers: int = typer.Option(8, "--max-workers", help="Parallel source width."),
    drafts: bool = typer.Option(False, "--drafts", "-d", help="Generate queue drafts from top posts via LLM."),
    draft_count: int = typer.Option(3, "--draft-count", help="How many drafts to generate."),
    draft_platform: str = typer.Option("x", "--draft-platform", help="x | linkedin | reddit"),
    draft_type: str = typer.Option("post", "--draft-type", help="post | thread | article"),
    provider: Optional[str] = typer.Option(None, "--provider", help="LLM provider override."),
    as_json: bool = typer.Option(False, "--json", help="Emit JSON instead of a table."),
) -> None:
    """Fetch social + open-source + web content for a topic and persist to SQLite.

    Example:
      openreply collect-growth "note taking app" --bundle content --limit 10
      openreply collect-growth "note taking app" --bundle opensource --limit 5
      openreply collect-growth "note taking app" --include github_trending,hn,producthunt
      openreply collect-growth "note taking app" --drafts --draft-count 3 --draft-platform x
    """
    from ..sources.collect_adapter import (
        CONTENT_GROWTH_SOURCES,
        OPEN_SOURCE_GROWTH_SOURCES,
        SOCIAL_GROWTH_SOURCES,
        WEB_GROWTH_SOURCES,
        run_content_growth,
        run_opensource_growth,
        run_social_growth,
        run_web_growth,
    )

    bundles = {
        "social": (SOCIAL_GROWTH_SOURCES, run_social_growth),
        "opensource": (OPEN_SOURCE_GROWTH_SOURCES, run_opensource_growth),
        "web": (WEB_GROWTH_SOURCES, run_web_growth),
        "content": (CONTENT_GROWTH_SOURCES, run_content_growth),
    }
    if bundle not in bundles:
        _emit({"ok": False, "error": f"unknown bundle '{bundle}'"}, as_json=True)
        raise typer.Exit(2)

    _, runner = bundles[bundle]
    kwargs: dict[str, Any] = {"limit": limit, "max_workers": max_workers}
    if include:
        kwargs["include"] = tuple(s.strip() for s in include.split(",") if s.strip())
    if exclude:
        kwargs["exclude"] = tuple(s.strip() for s in exclude.split(",") if s.strip())

    results = runner(topic, **kwargs)
    total = sum(results.values())
    summary: dict[str, Any] = {
        "ok": True,
        "topic": topic,
        "bundle": bundle,
        "limit": limit,
        "total_rows": total,
        "sources": results,
    }

    generated_drafts: list[dict] = []
    if drafts:
        from ..content.drafts import generate_drafts_from_posts
        from ..core.db import get_db

        db = get_db()
        cur = db.execute(
            "SELECT p.* FROM posts p "
            "JOIN topic_posts tp ON p.id = tp.post_id "
            "WHERE tp.topic = ? ORDER BY p.score DESC LIMIT ?",
            [topic, draft_count * 3],
        )
        cols = [d[0] for d in cur.description]
        posts = [dict(zip(cols, row)) for row in cur.fetchall()]
        generated_drafts = generate_drafts_from_posts(
            topic=topic,
            posts=posts,
            count=draft_count,
            platform=draft_platform,
            content_type=draft_type,
            provider=provider,
            persist=True,
        )
        summary["drafts_generated"] = len(generated_drafts)
        summary["draft_ids"] = [d["id"] for d in generated_drafts]

    _emit(summary, as_json=as_json, table_title=f"collect-growth · {topic} · {total} rows")
    if not as_json:
        console.print(f"[green]done[/green] — {total} rows persisted for '{topic}'")
        if drafts:
            console.print(f"[green]drafts[/green] — {len(generated_drafts)} generated and saved to queue")


# ── mcp ──────────────────────────────────────────────────────────────────────

@mcp_app.command("serve")
def cmd_mcp_serve(
    transport: str = typer.Option(
        "stdio",
        "--transport",
        help="stdio (default, for Claude Code / Desktop) or http / streamable-http / sse "
             "(daemon-style — recommended for Cursor, which cycles stdio servers "
             "every ~5 min and kills in-flight long calls).",
    ),
    host: str = typer.Option("127.0.0.1", "--host", help="bind host for HTTP transport"),
    port: int = typer.Option(8765, "--port", help="bind port for HTTP transport"),
) -> None:
    """Run the MCP server.

    Default stdio mode is for Claude Code, Claude Desktop, and Cursor's
    legacy MCP integration. Use ``--transport http --port 8765`` to run
    a long-lived daemon — Cursor 0.45+ can connect to ``http://127.0.0.1:8765/mcp``
    via a ``url`` entry in mcp.json, which avoids the 5-min stdio cycling
    that drops in-flight tool calls.
    """
    try:
        from ..mcp.server import run
    except ImportError as e:
        console.print(
            "[red]MCP extra not installed.[/red] "
            "Run: pip install -e '.[mcp]'"
        )
        raise typer.Exit(1) from e
    run(transport=transport, host=host, port=port)


@mcp_app.command("clients")
def cmd_mcp_clients(as_json: bool = typer.Option(False, "--json")) -> None:
    """List known MCP clients (Claude Code, Cursor, Cline, …) and which configs exist."""
    from ..mcp.install import list_clients

    rows = list_clients()
    if as_json:
        typer.echo(json.dumps(rows))
        return
    for r in rows:
        marker = "✓" if r["present"] else "·"
        typer.echo(f"  {marker} {r['key']:<16} {r['label']:<30} {r['path']}")


@mcp_app.command("install")
def cmd_mcp_install(
    claude_config: Optional[Path] = typer.Option(
        None, "--config", help="Override config path (else --client default; else ~/.claude.json)"
    ),
    client: Optional[str] = typer.Option(
        None, "--client",
        help="MCP client preset: claude-code | claude-desktop | cursor | windsurf | cline. "
             "Default: claude-code. Same install flow works for any client; only the config path differs.",
    ),
    data_dir: Optional[Path] = typer.Option(
        None, "--data-dir",
        help="Data dir to align Claude with (default: OPENREPLY_DATA_DIR or CWD/data).",
    ),
    project_dir: Optional[Path] = typer.Option(
        None, "--project-dir",
        help="Repo dir for `uv run` invocation (dev mode). Mutually exclusive with --bin.",
    ),
    bin_path: Optional[Path] = typer.Option(
        None, "--bin",
        help="Bundled openreply binary path (prod mode). Mutually exclusive with --project-dir.",
    ),
    server_name: str = typer.Option("openreply", "--name"),
    rotate_token: bool = typer.Option(
        False, "--rotate-token", help="Generate a fresh token even if one already exists.",
    ),
    as_json: bool = typer.Option(False, "--json"),
) -> None:
    """Connect (or re-sync) OpenReply's MCP entry in Claude Code's config.

    Aligns OPENREPLY_DATA_DIR so MCP tools write to the same SQLite the
    desktop app reads. Generates a token (kept under <data_dir>/mcp_token)
    and injects it into the entry's env block for future v2 gating.

    Idempotent: re-running after the app moves just rewrites command/args/env
    without rotating the token (use --rotate-token to force a new one).
    """
    from ..mcp.install import install as do_install

    if project_dir and (project_dir / "pyproject.toml").exists() is False and not bin_path:
        console.print(f"[red]{project_dir} doesn't look like the openreply repo.[/red]")
        raise typer.Exit(1)

    try:
        result = do_install(
            config_path=claude_config,
            client=client,
            data_dir=data_dir,
            bin_path=bin_path,
            project_dir=project_dir,
            server_name=server_name,
            rotate_token=rotate_token,
        )
    except Exception as e:  # noqa: BLE001 — surface anything as a clean error
        result = {"ok": False, "reason": f"install failed: {e}"}

    if as_json:
        typer.echo(json.dumps(result, default=str))
        raise typer.Exit(0 if result.get("ok") else 1)

    if not result.get("ok"):
        console.print(f"[red]{result.get('reason', 'install failed')}[/red]")
        raise typer.Exit(1)

    console.print(f"[green]connected[/green] → {result['config_path']}")
    console.print_json(data=result["entry"])
    console.print(f"\n[dim]{result['message']}[/dim]")


@mcp_app.command("config")
def cmd_mcp_config(
    claude_config: Optional[Path] = typer.Option(None, "--config"),
    client: Optional[str] = typer.Option(
        None, "--client",
        help="MCP client preset (only changes the suggested config path).",
    ),
    data_dir: Optional[Path] = typer.Option(None, "--data-dir"),
    project_dir: Optional[Path] = typer.Option(None, "--project-dir"),
    bin_path: Optional[Path] = typer.Option(None, "--bin"),
    server_name: str = typer.Option("openreply", "--name"),
    as_json: bool = typer.Option(False, "--json"),
) -> None:
    """Print the mcpServers entry Connect WOULD write — WITHOUT writing it.

    For copy-pasting OpenReply's MCP config into a client by hand (or one we
    don't auto-write). Does not create a token or touch any file.
    """
    from ..mcp.install import config_snippet

    try:
        result = config_snippet(
            config_path=claude_config,
            client=client,
            data_dir=data_dir,
            bin_path=bin_path,
            project_dir=project_dir,
            server_name=server_name,
        )
    except Exception as e:  # noqa: BLE001
        result = {"ok": False, "reason": f"config build failed: {e}"}

    if as_json:
        typer.echo(json.dumps(result, default=str))
        raise typer.Exit(0 if result.get("ok") else 1)

    if not result.get("ok"):
        console.print(f"[red]{result.get('reason', 'config build failed')}[/red]")
        raise typer.Exit(1)
    console.print(f"[dim]Paste into {result['config_path']}:[/dim]")
    console.print_json(data=result["snippet"])


@mcp_app.command("uninstall")
def cmd_mcp_uninstall(
    claude_config: Optional[Path] = typer.Option(None, "--config"),
    client: Optional[str] = typer.Option(None, "--client"),
    data_dir: Optional[Path] = typer.Option(None, "--data-dir"),
    server_name: str = typer.Option("openreply", "--name"),
    keep_token: bool = typer.Option(False, "--keep-token", help="Don't delete <data_dir>/mcp_token."),
    as_json: bool = typer.Option(False, "--json"),
) -> None:
    """Remove OpenReply's MCP entry. Other mcpServers entries stay untouched."""
    from ..mcp.install import uninstall as do_uninstall

    try:
        result = do_uninstall(
            config_path=claude_config,
            client=client,
            data_dir=data_dir,
            server_name=server_name,
            delete_token=not keep_token,
        )
    except Exception as e:  # noqa: BLE001
        result = {"ok": False, "reason": f"uninstall failed: {e}"}

    if as_json:
        typer.echo(json.dumps(result, default=str))
        raise typer.Exit(0 if result.get("ok") else 1)

    if not result.get("ok"):
        console.print(f"[red]{result.get('reason', 'uninstall failed')}[/red]")
        raise typer.Exit(1)
    style = "green" if result.get("removed") else "yellow"
    console.print(f"[{style}]{result['message']}[/{style}]")


@mcp_app.command("status")
def cmd_mcp_status(
    claude_config: Optional[Path] = typer.Option(None, "--config"),
    client: Optional[str] = typer.Option(None, "--client"),
    data_dir: Optional[Path] = typer.Option(None, "--data-dir"),
    server_name: str = typer.Option("openreply", "--name"),
    probe: bool = typer.Option(
        False, "--probe",
        help="Spawn the configured command and do a real MCP handshake "
             "(detects an entry that's written but hangs on startup).",
    ),
    probe_timeout: float = typer.Option(
        60.0, "--probe-timeout",
        help="Seconds to wait for the handshake (bundled cold-start can be 30-50s).",
    ),
    as_json: bool = typer.Option(False, "--json"),
) -> None:
    """Report whether OpenReply is connected to the chosen MCP client and DB-aligned."""
    from ..mcp.install import status as do_status

    try:
        result = do_status(
            config_path=claude_config,
            client=client,
            data_dir=data_dir,
            server_name=server_name,
            probe=probe,
            probe_timeout=probe_timeout,
        )
    except Exception as e:  # noqa: BLE001
        result = {"ok": False, "reason": f"status failed: {e}"}

    if as_json:
        typer.echo(json.dumps(result, default=str))
        return

    typer.echo(f"config:        {result['config_path']}")
    typer.echo(f"data_dir:      {result['data_dir']}")
    typer.echo(f"connected:     {result.get('connected')}")
    if probe:
        typer.echo(f"live:          {result.get('live')}")
        if result.get("handshake_ms") is not None:
            typer.echo(f"handshake_ms:  {result.get('handshake_ms')}")
        if result.get("probe_error"):
            typer.echo(f"probe_error:   {result.get('probe_error')}")
    typer.echo(f"db_aligned:    {result.get('db_aligned')}")
    typer.echo(f"has_token:     {result.get('has_token')}")
    typer.echo(f"token_in_env:  {result.get('token_in_env')}")
    if result.get("reason"):
        typer.echo(f"note: {result['reason']}")


def _parse_since(s: str | None) -> int | None:
    """Parse a `--since` arg like ``24h`` / ``30m`` / ``2d`` / ``900`` → seconds.
    None / empty → return None (no filter)."""
    if not s:
        return None
    s = s.strip().lower()
    try:
        if s.endswith("d"): return int(float(s[:-1]) * 86400)
        if s.endswith("h"): return int(float(s[:-1]) * 3600)
        if s.endswith("m"): return int(float(s[:-1]) * 60)
        if s.endswith("s"): return int(float(s[:-1]))
        return int(float(s))
    except ValueError:
        return None


@mcp_app.command("logs")
def cmd_mcp_logs(
    tail: int = typer.Option(50, "--tail", "-n", help="Last N events to print."),
    severity: Optional[str] = typer.Option(
        None, "--severity", "-s",
        help="Minimum severity: debug|info|warn|error|fatal. error → also includes fatal.",
    ),
    kind: Optional[str] = typer.Option(
        None, "--kind", "-k",
        help="Filter to one event kind. Wildcards: 'startup:*', 'tool_*'.",
    ),
    tool: Optional[str] = typer.Option(
        None, "--tool", "-t", help="Filter to one tool name (e.g. openreply_query_db).",
    ),
    since: Optional[str] = typer.Option(
        None, "--since",
        help="Only events newer than this. e.g. 24h, 30m, 2d, or seconds.",
    ),
    as_json: bool = typer.Option(False, "--json"),
) -> None:
    """Show recent MCP server events from the structured log.

    The MCP server writes every startup, lock acquisition, tool call, and
    crash into the `mcp_events` SQLite table + a NDJSON file at
    `<data_dir>/logs/mcp-server.log`. This command reads from the table
    so filtering is fast even with 100k+ rows.

    Examples:
      openreply mcp logs --severity error --since 24h
      openreply mcp logs --kind 'startup:*' --tail 20
      openreply mcp logs --tool openreply_query_db --since 1h
    """
    from ..mcp.logger import query_events

    kind_arg, kind_prefix = None, None
    if kind:
        if "*" in kind or "%" in kind:
            kind_prefix = kind
        else:
            kind_arg = kind

    rows = query_events(
        kind=kind_arg, kind_prefix=kind_prefix,
        severity=severity, tool_name=tool,
        since_seconds=_parse_since(since), limit=tail,
    )
    if as_json:
        typer.echo(json.dumps(rows, default=str, indent=2))
        return

    if not rows:
        typer.echo("(no matching events)")
        return

    sev_color = {
        "debug": "dim", "info": "cyan", "warn": "yellow",
        "error": "red", "fatal": "bold red",
    }
    for r in reversed(rows):  # oldest-first reads more naturally
        ts = (r.get("ts") or "")[:19].replace("T", " ")
        sev = (r.get("severity") or "info").lower()
        color = sev_color.get(sev, "white")
        kindstr = (r.get("kind") or "").ljust(22)
        toolstr = f"  [{r.get('tool_name')}]" if r.get("tool_name") else ""
        durstr = f"  ({r['duration_ms']} ms)" if r.get("duration_ms") is not None else ""
        msg = (r.get("message") or "").replace("\n", " ")
        console.print(
            f"[dim]{ts}[/dim]  [{color}]{sev.upper():<5}[/{color}]  "
            f"{kindstr}{toolstr}{durstr}  {msg}"
        )


@mcp_app.command("stats")
def cmd_mcp_stats(
    since: Optional[str] = typer.Option(
        "24h", "--since",
        help="Window for aggregation. e.g. 24h, 7d, 1h. Default 24h. Pass 'all' for no filter.",
    ),
    as_json: bool = typer.Option(False, "--json"),
) -> None:
    """Aggregate MCP server health: events by kind, severity, top errors, slowest tools.

    Lets you spot recurring failure modes — e.g. ``openreply_synthesize_insights``
    timing out 30× in 24h points at LLM-key issues; ``startup:lock_failed``
    repeating means a client is reconnecting without `MCP_TAKEOVER_STALE_LOCK=1`.
    """
    from ..mcp.logger import aggregate_stats

    secs = None if (since or "").lower() in ("", "all", "0") else _parse_since(since)
    stats = aggregate_stats(since_seconds=secs)
    if as_json:
        typer.echo(json.dumps(stats, default=str, indent=2))
        return

    if not stats:
        typer.echo("(no stats — log is empty or DB unreachable)")
        return

    label = since if since and since.lower() not in ("", "all", "0") else "all time"
    console.print(f"[bold]MCP server stats — last {label}[/bold]  ([dim]{stats.get('log_file','')}[/dim])\n")

    if stats.get("by_severity"):
        console.print("[bold]By severity[/bold]")
        for r in stats["by_severity"]:
            console.print(f"  {r['severity']:<6}  {r['n']:>6}")

    if stats.get("by_kind"):
        console.print("\n[bold]By kind (top 15)[/bold]")
        for r in stats["by_kind"][:15]:
            console.print(f"  {r['kind']:<28}  {r['n']:>6}")

    if stats.get("top_tool_errors"):
        console.print("\n[bold red]Top tools by error count[/bold red]")
        for r in stats["top_tool_errors"]:
            console.print(f"  {r['tool_name']:<40}  {r['n']:>4}")

    if stats.get("slow_tools"):
        console.print("\n[bold yellow]Slowest tools (max ms)[/bold yellow]")
        for r in stats["slow_tools"]:
            console.print(
                f"  {r['tool_name']:<40}  avg={r['p50_ms']:>5} ms  max={r['p95_ms']:>6} ms  ({r['n']} calls)"
            )


# ── info / health ─────────────────────────────────────────────────────────────

_EXPECTED_TABLES = (
    "posts", "comments", "fetches", "streams", "stream_hits", "subreddits",
    "users", "topic_posts", "topic_canonicalizations", "topic_prefs",
    "paper_analyses", "graph_nodes", "graph_edges", "trend_series",
    # Reply engine (OpenReply) — created in core.db.init_schema since 2026-06-29.
    # Listed here so `health` flags a regression if init ever stops creating them.
    "reply_brands", "reply_opportunities", "reply_drafts", "reply_sub_rules",
    "reply_feedback", "reply_playbook", "reply_ideas",
)


@app.command("health")
def cmd_health(
    as_json: bool = typer.Option(False, "--json", hidden=True,
                                 help="Accept --json from Rust wrapper (no-op)."),
) -> None:
    """Diagnostics: data dir, DB schema, ONNX model, LLM provider.

    Returns JSON with per-check status. Exit code is always 0 so the Rust
    wrapper can parse the payload regardless of whether individual checks
    passed."""
    _ = as_json
    import time
    checks: list[dict] = []

    cfg = load_config()

    # 1. Data dir writable --------------------------------------------------
    t0 = time.time()
    try:
        cfg.data_dir.mkdir(parents=True, exist_ok=True)
        probe = cfg.data_dir / ".health-probe"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink()
        checks.append({"id": "data_dir", "ok": True,
                       "detail": str(cfg.data_dir), "ms": int((time.time()-t0)*1000)})
    except Exception as e:
        checks.append({"id": "data_dir", "ok": False,
                       "detail": f"{cfg.data_dir}: {e}", "ms": int((time.time()-t0)*1000)})

    # 2. DB opens + all expected tables present -----------------------------
    t0 = time.time()
    try:
        db = get_db()
        present = set(db.table_names())
        missing = [t for t in _EXPECTED_TABLES if t not in present]
        if missing:
            checks.append({"id": "db", "ok": False,
                           "detail": f"missing tables: {', '.join(missing)}",
                           "ms": int((time.time()-t0)*1000)})
        else:
            checks.append({"id": "db", "ok": True,
                           "detail": f"{len(present)} tables at {cfg.db_path}",
                           "ms": int((time.time()-t0)*1000)})
    except Exception as e:
        checks.append({"id": "db", "ok": False,
                       "detail": str(e), "ms": int((time.time()-t0)*1000)})

    # 3. Palace (ONNX) model ------------------------------------------------
    t0 = time.time()
    try:
        from ..retrieval import palace
        ms = palace.model_status()
        if not ms.get("installed"):
            checks.append({"id": "palace", "ok": False, "level": "warn",
                           "detail": "retrieval extras not installed in sidecar",
                           "ms": int((time.time()-t0)*1000)})
        elif ms.get("ready"):
            checks.append({"id": "palace", "ok": True,
                           "detail": f"ONNX ready at {ms.get('cache_dir')}",
                           "ms": int((time.time()-t0)*1000)})
        else:
            checks.append({"id": "palace", "ok": False, "level": "warn",
                           "detail": "ONNX not cached — run research palace-warmup",
                           "ms": int((time.time()-t0)*1000)})
    except Exception as e:
        checks.append({"id": "palace", "ok": False, "level": "warn",
                       "detail": str(e), "ms": int((time.time()-t0)*1000)})

    # 4. LLM provider -------------------------------------------------------
    t0 = time.time()
    try:
        from ..analyze.providers.base import resolve_provider
        provider = resolve_provider()
        checks.append({"id": "llm", "ok": True,
                       "detail": f"provider={provider} model={os.getenv('LLM_MODEL') or '(default)'}",
                       "ms": int((time.time()-t0)*1000)})
    except Exception as e:
        checks.append({"id": "llm", "ok": False, "level": "warn",
                       "detail": str(e), "ms": int((time.time()-t0)*1000)})

    # 5. Reddit OAuth (informational) --------------------------------------
    t0 = time.time()
    checks.append({"id": "reddit", "ok": cfg.has_oauth,
                   "level": "info",
                   "detail": "OAuth token present" if cfg.has_oauth
                             else "no OAuth — public JSON fallback used",
                   "ms": int((time.time()-t0)*1000)})

    blockers = [c for c in checks if not c.get("ok") and c.get("level") not in ("warn", "info")]
    payload = {
        "ok": not blockers,
        "data_dir": str(cfg.data_dir),
        "db_path": str(cfg.db_path),
        "checks": checks,
    }
    console.print_json(data=payload)


@app.command("info")
def cmd_info(
    as_json: bool = typer.Option(False, "--json", help="Output JSON (default is pretty-print JSON)."),
) -> None:
    """Show config + DB stats + which backend mode is active."""
    cfg = load_config()
    db = get_db()
    stats = {
        "mode": cfg.mode,  # 'auth' (PRAW/OAuth) or 'public' (no-auth JSON)
        "data_dir": str(cfg.data_dir),
        "db_path": str(cfg.db_path),
        "oauth_ready": cfg.has_oauth,
        "anthropic_key": bool(cfg.anthropic_api_key),
        "openai_key": bool(cfg.openai_api_key),
        "tables": {name: db[name].count for name in db.table_names()},
    }
    # `--json` is a no-op here (we always emit JSON via console.print_json),
    # but accepting the flag avoids typer errors from the Rust wrapper that
    # auto-appends --json to every sidecar call.
    _ = as_json
    console.print_json(data=stats)


# ── whisper models + yt-dlp ──────────────────────────────────────────────────
#
# Gated by the `video` pyproject extra (yt-dlp / faster-whisper / huggingface_hub).
# All emit structured JSON when --json is passed so the Tauri sidecar can
# stream progress into the webview via run_cli_streaming events.

whisper_app = typer.Typer(help="Manage Whisper models for video transcription.")
app.add_typer(whisper_app, name="whisper")

ytdlp_app = typer.Typer(help="yt-dlp version + overlay auto-updater controls.")
app.add_typer(ytdlp_app, name="ytdlp")

# ── persona learning agents ─────────────────────────────────────────────────
# Self-contained Typer sub-app — the whole persona CLI is toggled by these
# two lines (see cli/persona_cmds.py module docstring).
from .persona_cmds import persona_app  # noqa: E402
app.add_typer(persona_app, name="persona")

# ── reach connections (per-source cookie/key credentials) ────────────────────
# Backs the in-app Reach Connections flow; also usable from the CLI. All
# subcommands emit JSON so the Tauri sidecar can parse them directly.
creds_app = typer.Typer(help="Per-source cookie/key credentials (Reddit, Xueqiu, XHS, Exa, …).")
app.add_typer(creds_app, name="creds")


@creds_app.command("list")
def cmd_creds_list(as_json: bool = typer.Option(True, "--json")) -> None:
    """Status of every cookie/key-gated source."""
    from ..research.reach_connections import list_connections
    _emit(list_connections(), as_json, table_title="Reach Connections")


@creds_app.command("import")
def cmd_creds_import(
    source: str = typer.Option(..., "--source", "-s"),
    browser: Optional[str] = typer.Option(None, "--browser", "-b",
                                          help="chrome|brave|firefox|safari"),
    as_json: bool = typer.Option(True, "--json"),
) -> None:
    """Extract a source's session cookie from the local browser, store + verify."""
    from ..research.reach_connections import import_browser
    _emit([import_browser(source, browser)], as_json, table_title=f"import {source}")


@creds_app.command("save")
def cmd_creds_save(
    source: str = typer.Option(..., "--source", "-s"),
    value: str = typer.Option(..., "--value", "-v",
                              help="'name=value; ...' cookie string, JSON map, or API key"),
    as_json: bool = typer.Option(True, "--json"),
) -> None:
    """Store a manually-pasted cookie/key for a source, then verify."""
    from ..research.reach_connections import save_manual
    _emit([save_manual(source, value)], as_json, table_title=f"save {source}")


@creds_app.command("verify")
def cmd_creds_verify(
    source: str = typer.Option(..., "--source", "-s"),
    as_json: bool = typer.Option(True, "--json"),
) -> None:
    """Live-test a source's stored credential."""
    from ..research.reach_connections import verify_connection
    _emit([verify_connection(source)], as_json, table_title=f"verify {source}")


@creds_app.command("delete")
def cmd_creds_delete(
    source: str = typer.Option(..., "--source", "-s"),
    as_json: bool = typer.Option(True, "--json"),
) -> None:
    """Disconnect a source (delete its stored credential)."""
    from ..research.reach_connections import delete_connection
    _emit([delete_connection(source)], as_json, table_title=f"delete {source}")


@creds_app.command("toggle")
def cmd_creds_toggle(
    source: str = typer.Option(..., "--source", "-s"),
    enabled: bool = typer.Option(True, "--enabled/--disabled",
                                 help="Include this source in collection runs."),
    as_json: bool = typer.Option(True, "--json"),
) -> None:
    """Set whether a connected source is used in collection runs."""
    from ..research.reach_connections import toggle_connection
    _emit([toggle_connection(source, enabled)], as_json, table_title=f"toggle {source}")


@creds_app.command("preview")
def cmd_creds_preview(
    source: str = typer.Option(..., "--source", "-s"),
    query: Optional[str] = typer.Option(None, "--query", "-q", help="Override the probe query"),
    limit: int = typer.Option(6, "--limit", "-l"),
    as_json: bool = typer.Option(True, "--json"),
) -> None:
    """Live-fetch a SAMPLE of content from a source (titles + links) to confirm it works."""
    from ..research.reach_connections import preview_source
    _emit(preview_source(source, query=query, limit=limit), as_json, table_title=f"preview {source}")


@whisper_app.command("list")
def cmd_whisper_list(
    as_json: bool = typer.Option(False, "--json"),
) -> None:
    """List installed Whisper model tiers + sizes."""
    from ..transcribe import list_installed
    _emit(list_installed(), as_json=as_json, table_title="whisper models")


@whisper_app.command("catalogue")
def cmd_whisper_catalogue(
    as_json: bool = typer.Option(False, "--json"),
) -> None:
    """Show every known tier with an `installed` flag — used by Settings UI."""
    from ..transcribe.models import catalogue
    _emit(catalogue(), as_json=as_json, table_title="whisper catalogue")


@whisper_app.command("download")
def cmd_whisper_download(
    tier: str = typer.Argument(..., help="tiny.en | base.en | small.en | medium.en | large-v3"),
    as_json: bool = typer.Option(False, "--json"),
) -> None:
    """Download a Whisper tier — or reuse an existing install.

    Before hitting HuggingFace we scan known locations (HF hub cache,
    ``OPENREPLY_WHISPER_MODELS_DIR``, common system dirs). If the tier is
    already present there, we skip the download and reuse it in place.
    Exit code 0 either way — the UI renders the ``skipped`` / ``source``
    fields so the user knows what happened.
    """
    from ..transcribe import download_model

    def _progress(evt: dict) -> None:
        typer.echo(json.dumps({"_progress": evt}, ensure_ascii=False), err=False)

    cb = _progress if as_json else None
    try:
        result = download_model(tier, progress_cb=cb)
        if not as_json and result.get("skipped"):
            typer.echo(
                f"✓ reusing existing {tier} at {result['path']} "
                f"(source={result.get('source','?')}) — skipping download"
            )
        _emit(result, as_json=as_json, table_title=f"whisper download: {tier}")
    except Exception as e:
        _emit({"ok": False, "tier": tier, "error": str(e)}, as_json=as_json,
              table_title=f"whisper download: {tier}")
        raise typer.Exit(code=1)


@whisper_app.command("delete")
def cmd_whisper_delete(
    tier: str = typer.Argument(..., help="tiny.en | base.en | small.en | medium.en | large-v3"),
    as_json: bool = typer.Option(False, "--json"),
) -> None:
    """Delete an installed Whisper model tier."""
    from ..transcribe import delete_model
    deleted = delete_model(tier)
    _emit({"ok": True, "tier": tier, "deleted": deleted}, as_json=as_json,
          table_title=f"whisper delete: {tier}")


@whisper_app.command("default")
def cmd_whisper_default(
    tier: Optional[str] = typer.Argument(None,
        help="Tier to set as default. Omit to print the current default."),
    as_json: bool = typer.Option(False, "--json"),
) -> None:
    """Get / set the default Whisper tier (picked when user passes --model auto)."""
    from ..transcribe import default_tier, set_default_tier
    if tier is None:
        _emit({"default_tier": default_tier()}, as_json=as_json,
              table_title="whisper default")
        return
    set_default_tier(tier)
    _emit({"ok": True, "default_tier": tier}, as_json=as_json,
          table_title=f"whisper default → {tier}")


@ytdlp_app.command("version")
def cmd_ytdlp_version(
    as_json: bool = typer.Option(False, "--json"),
) -> None:
    """Print installed + latest (PyPI) yt-dlp versions."""
    from ..transcribe.ytdlp_client import _pypi_latest_stable, ytdlp_current_version
    out = {
        "installed": ytdlp_current_version(),
        "latest": _pypi_latest_stable("yt-dlp"),
    }
    _emit(out, as_json=as_json, table_title="yt-dlp version")


@ytdlp_app.command("update")
def cmd_ytdlp_update(
    force: bool = typer.Option(False, "--force",
        help="Ignore the 24h cooldown stamp."),
    as_json: bool = typer.Option(False, "--json"),
) -> None:
    """Pip-install the latest yt-dlp into the user-writable overlay dir.

    Safe to run any time. Failures are graceful — bundled yt-dlp keeps working.
    """
    from ..transcribe import ensure_latest_ytdlp
    result = ensure_latest_ytdlp(force=force)
    _emit(result, as_json=as_json, table_title="yt-dlp update")


@app.command("daemon")
def cmd_daemon() -> None:
    """Long-running stdin/stdout daemon — used by the Tauri Rust shell to
    avoid paying Python interpreter / PyInstaller startup on every call.

    Protocol (line-delimited JSON, one request and one response per line):

        request:  {"id": <any>, "args": ["research", "hypothesis-stats", "--topic", "x", "--json"]}
        response: {"id": <same>, "ok": true, "result": <parsed JSON output>}
                  or {"id": <same>, "ok": false, "error": "<msg>", "stderr": "<captured>"}

    On startup the daemon writes a single handshake line so the parent
    knows imports are warm: {"_daemon_ready": true}.

    Each command runs in-process via Click's `standalone_mode=False`, with
    stdout/stderr captured and JSON-parsed back. Module imports happen
    ONCE on first call per command family (sqlite-utils, requests, llm
    providers, …) and stay warm across all subsequent calls — that's the
    speedup vs. `Command::new(py).output()`.
    """
    import io
    import traceback as _tb

    real_stdout = sys.stdout
    real_stderr = sys.stderr

    # Handshake so the parent can treat the spawn as ready.
    real_stdout.write(json.dumps({"_daemon_ready": True}) + "\n")
    real_stdout.flush()

    while True:
        try:
            line = sys.stdin.readline()
        except KeyboardInterrupt:
            break
        if not line:
            break  # parent closed stdin → exit
        line = line.strip()
        if not line:
            continue

        req_id = None
        try:
            req = json.loads(line)
            req_id = req.get("id")
            args = list(req.get("args") or [])
        except Exception as e:
            real_stdout.write(json.dumps({
                "id": req_id, "ok": False,
                "error": f"invalid daemon request: {e}",
            }) + "\n")
            real_stdout.flush()
            continue

        # Capture the command's stdout (where _emit prints JSON) and stderr
        # (where Click writes errors). Restore on exit so the daemon's own
        # protocol writes go to the real pipe.
        out_buf = io.StringIO()
        err_buf = io.StringIO()
        sys.stdout = out_buf
        sys.stderr = err_buf

        ok = True
        err_msg: Optional[str] = None
        try:
            try:
                _reload_user_env_for_daemon()
                app(args=args, standalone_mode=False)
            except SystemExit as e:
                code = e.code if isinstance(e.code, int) else (1 if e.code else 0)
                if code != 0:
                    ok = False
                    err_msg = f"command exited {code}"
            except Exception as e:
                ok = False
                err_msg = f"{type(e).__name__}: {e}"
                # Tracebacks go to err_buf so the parent can surface them.
                _tb.print_exc(file=err_buf)
        finally:
            sys.stdout = real_stdout
            sys.stderr = real_stderr

        captured_out = out_buf.getvalue()
        captured_err = err_buf.getvalue()

        result: Any = None
        if ok:
            text = captured_out.strip()
            if text:
                # Most commands emit a single JSON document. Try whole first,
                # then fall back to the last non-empty line (some commands
                # also log status banners before the JSON payload).
                try:
                    result = json.loads(text)
                except Exception:
                    last = ""
                    for ln in reversed(text.splitlines()):
                        ln = ln.strip()
                        if ln:
                            last = ln
                            break
                    try:
                        result = json.loads(last) if last else None
                    except Exception:
                        result = {
                            "_parse_error": True,
                            "_parse_error_message": "non-JSON stdout from daemon command",
                            "_raw": captured_out[:4000],
                        }

        resp: dict[str, Any] = {"id": req_id, "ok": ok}
        if ok:
            resp["result"] = result
        else:
            resp["error"] = err_msg or "unknown daemon error"
            if captured_err:
                resp["stderr"] = captured_err[:2000]
            if captured_out:
                resp["stdout"] = captured_out[:2000]
        real_stdout.write(json.dumps(resp, default=str) + "\n")
        real_stdout.flush()


# Persona subcommands (Phase 1 — 2026-05-12). Self-contained module so the
# entire persona feature can be removed by deleting these 2 lines + the
# persona_cmds.py file + the src/openreply/persona/ package.
from .persona_cmds import persona_app
app.add_typer(persona_app, name="persona")


if __name__ == "__main__":
    app()
