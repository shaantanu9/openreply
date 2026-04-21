"""reddit-cli — Typer app. Every command supports --json for machine output."""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Optional

import typer
from rich.console import Console
from rich.table import Table

from ..core.config import load_config
from ..core.db import get_db
from ..core.exporters import export_rows

app = typer.Typer(
    help="Reddit research toolkit — PRAW fetch, SQLite store, optional LLM analysis.",
    no_args_is_help=True,
    add_completion=False,
)
fetch_app = typer.Typer(help="Fetch data from Reddit (persists to SQLite).")
analyze_app = typer.Typer(help="LLM-assisted analysis over stored data.")
mcp_app = typer.Typer(help="MCP server for Claude Code.")
auth_app = typer.Typer(help="Reddit API credential setup.")
research_app = typer.Typer(help="Topic/app gap-finding: discover → collect → extract → report.")

graph_app = typer.Typer(help="Knowledge graph: build / enrich / query / export.")
research_app.add_typer(graph_app, name="graph")

ingest_app = typer.Typer(help="Ingest local files (CSV / JSON / TXT / VTT / SRT / MD / PDF) into a topic.")
app.add_typer(ingest_app, name="ingest")


@ingest_app.command("file")
def cmd_ingest_file(
    path: Path = typer.Option(..., "--path", "-p"),
    topic: str = typer.Option(..., "--topic", "-t"),
    source_type: str = typer.Option("local", "--source-type", "-s",
        help="e.g. slack_export, interviews, gong_calls, intercom_tickets"),
    sub: Optional[str] = typer.Option(None, "--sub"),
) -> None:
    """Parse a local file + upsert into a topic's corpus.

    Formats: .csv .json .txt .vtt .srt .md .pdf

    Example:
      reddit-cli ingest file --path ./slack-export.csv --topic "my product" --source-type slack_export
    """
    from ..sources.local_file import ingest_and_persist

    n = ingest_and_persist(path=path, topic=topic, source_type=source_type, sub=sub)
    console.print(f"[green]ingested {n} rows[/green] from {path} as source_type={source_type!r}")


# ── AG-D: CSV ingest ──
@research_app.command("ingest-csv")
def cmd_research_ingest_csv(
    path: Path = typer.Option(..., "--path", "-p", help="CSV file: post_id,title,body,author,url,created_utc,source_type"),
    topic: str = typer.Option(..., "--topic", "-t"),
    source: str = typer.Option("csv", "--source", "-s", help="Default source_type for rows missing one"),
    dry_run: bool = typer.Option(False, "--dry-run", help="Parse + count only, no DB writes"),
    as_json: bool = typer.Option(False, "--json"),
) -> None:
    """Bulk-ingest a structured CSV into a topic corpus.

    Required column: `title`. Everything else is tolerated. Existing post
    IDs are preserved when `post_id` is provided; otherwise a content-
    hashed ID is synthesised so re-imports deduplicate.

    Example:
      reddit-cli research ingest-csv --path corpus.csv --topic "my topic"
    """
    from ..research.ingest import ingest_csv

    result = ingest_csv(path=path, topic=topic, source_type_default=source, dry_run=dry_run)
    _emit(result, as_json=as_json)
    if not as_json:
        mode = "dry-run" if dry_run else "ingested"
        console.print(
            f"[green]{mode}[/green]: parsed {result['parsed']} row(s), "
            f"skipped {result['skipped']}, tagged {result['tagged']} into topic '{topic}'"
        )


app.add_typer(fetch_app, name="fetch")
app.add_typer(analyze_app, name="analyze")
app.add_typer(mcp_app, name="mcp")
app.add_typer(auth_app, name="auth")
app.add_typer(research_app, name="research")

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


# ── auth ─────────────────────────────────────────────────────────────────────

@auth_app.command("login")
def auth_login(
    client_id: Optional[str] = typer.Option(None, "--client-id"),
    client_secret: Optional[str] = typer.Option(None, "--client-secret"),
    port: int = typer.Option(8080, "--port"),
) -> None:
    """OAuth browser login. Writes REDDIT_REFRESH_TOKEN to ~/.config/reddit-myind/.env.

    One-time setup before running this:
      1. Go to https://www.reddit.com/prefs/apps → "create another app"
      2. Type: WEB APP
      3. Name: reddit-myind  (or anything)
      4. Redirect URI: http://localhost:8080
      5. Copy the client ID (under the name) and secret.
    """
    cfg_dir = Path.home() / ".config" / "reddit-myind"
    cfg_dir.mkdir(parents=True, exist_ok=True)
    env_path = cfg_dir / ".env"

    console.print("[bold]Reddit OAuth setup[/bold]\n")
    console.print(
        "If you haven't yet:\n"
        "  1. Open https://www.reddit.com/prefs/apps\n"
        "  2. 'create another app' → choose [bold]web app[/bold]\n"
        f"  3. Redirect URI must be exactly: [cyan]http://localhost:{port}[/cyan]\n"
    )
    client_id = client_id or typer.prompt("Client ID (under the app name)")
    client_secret = client_secret or typer.prompt("Client secret", hide_input=True)
    user_agent = typer.prompt("User agent", default="reddit-myind/0.1")

    # Pre-populate env so get_reddit_unauthed() can read them
    os.environ["REDDIT_CLIENT_ID"] = client_id
    os.environ["REDDIT_CLIENT_SECRET"] = client_secret
    os.environ["REDDIT_USER_AGENT"] = user_agent
    os.environ["REDDIT_REDIRECT_URI"] = f"http://localhost:{port}"

    from ..core.oauth import run_oauth_flow

    console.print("[dim]Opening browser… approve access when prompted.[/dim]")
    refresh_token = run_oauth_flow(port=port)

    env_path.write_text(
        "\n".join(
            [
                f"REDDIT_CLIENT_ID={client_id}",
                f"REDDIT_CLIENT_SECRET={client_secret}",
                f"REDDIT_REFRESH_TOKEN={refresh_token}",
                f"REDDIT_USER_AGENT={user_agent}",
                f"REDDIT_REDIRECT_URI=http://localhost:{port}",
                "",
            ]
        ),
        encoding="utf-8",
    )
    os.chmod(env_path, 0o600)
    console.print(f"[green]Saved refresh token → {env_path} (chmod 600).[/green]")
    console.print("Run [cyan]reddit-cli auth check[/cyan] to verify.")


@auth_app.command("check")
def auth_check() -> None:
    """Verify credentials by calling the Reddit API."""
    from ..core.client import get_reddit

    reddit = get_reddit()
    me = reddit.user.me()
    if me is None:
        console.print("[green]OK[/green] authenticated (read-only scopes, no identity).")
    else:
        console.print(f"[green]OK[/green] authenticated as u/{me}")


# ── fetch ────────────────────────────────────────────────────────────────────

@fetch_app.command("posts")
def cmd_fetch_posts(
    sub: str = typer.Option(..., "--sub", "-s"),
    sort: str = typer.Option("hot", "--sort", help="hot|new|top|rising|controversial"),
    limit: int = typer.Option(50, "--limit", "-n"),
    time_filter: str = typer.Option("day", "--time", help="hour|day|week|month|year|all"),
    as_json: bool = typer.Option(False, "--json"),
) -> None:
    """Fetch posts from r/<sub>."""
    from ..fetch.posts import fetch_posts

    rows = fetch_posts(sub=sub, sort=sort, limit=limit, time_filter=time_filter)  # type: ignore[arg-type]
    _emit(rows, as_json, table_title=f"r/{sub} · {sort} · {len(rows)}")


@fetch_app.command("comments")
def cmd_fetch_comments(
    post: str = typer.Option(..., "--post", "-p"),
    depth: Optional[int] = typer.Option(None, "--depth", "-d"),
    limit: Optional[int] = typer.Option(None, "--limit", "-n", help="replace_more limit"),
    as_json: bool = typer.Option(False, "--json"),
) -> None:
    """Fetch the comment tree for a post."""
    from ..fetch.comments import fetch_comments

    rows = fetch_comments(post_id=post, depth=depth, limit=limit)
    _emit(rows, as_json, table_title=f"post {post} · {len(rows)} comments")


@fetch_app.command("sub-comments")
def cmd_fetch_sub_comments(
    sub: str = typer.Option(..., "--sub", "-s"),
    limit: int = typer.Option(100, "--limit", "-n"),
    save: bool = typer.Option(True, "--save/--no-save"),
    as_json: bool = typer.Option(False, "--json"),
) -> None:
    """Firehose of a sub's recent comments (public .json, no auth). Pain quotes live here."""
    from ..core.public_client import public_get_sub_comments
    from ..core.db import upsert_comments, log_fetch_start, log_fetch_end

    fid = log_fetch_start("sub_comments", {"sub": sub, "limit": limit})
    try:
        rows = public_get_sub_comments(sub=sub, limit=limit)
        if save and rows:
            upsert_comments(rows)
        log_fetch_end(fid, rows=len(rows))
        _emit(rows, as_json, table_title=f"r/{sub} · {len(rows)} comments")
    except Exception as e:
        log_fetch_end(fid, rows=0, error=str(e))
        raise


@fetch_app.command("historical")
def cmd_fetch_historical(
    sub: str = typer.Option(..., "--sub", "-s"),
    kind: str = typer.Option("submission", "--kind", help="submission|comment"),
    days: int = typer.Option(365, "--days", "-d", help="how far back from cutoff/now"),
    limit: int = typer.Option(1000, "--limit", "-n"),
    as_json: bool = typer.Option(False, "--json"),
) -> None:
    """Fetch historical posts/comments via pullpush (pre-May-2025 archive)."""
    from ..fetch.historical import fetch_historical

    rows = fetch_historical(sub=sub, kind=kind, days=days, limit=limit)  # type: ignore[arg-type]
    _emit(
        rows,
        as_json,
        table_title=f"r/{sub} historical {kind}s · last {days}d pre-cutoff · {len(rows)}",
    )


@fetch_app.command("user")
def cmd_fetch_user(
    name: str = typer.Option(..., "--name", "-u"),
    kind: str = typer.Option("both", "--kind", help="posts|comments|both"),
    limit: int = typer.Option(100, "--limit", "-n"),
    as_json: bool = typer.Option(False, "--json"),
) -> None:
    """Fetch a user's posts + comments."""
    from ..fetch.users import fetch_user

    out = fetch_user(name=name, kind=kind, limit=limit)  # type: ignore[arg-type]
    _emit(out, as_json)


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
      reddit-cli query "SELECT * FROM topic_posts WHERE topic = :topic" --topic "my app"
      reddit-cli query "SELECT * FROM graph_nodes WHERE topic=:topic AND kind=:k" --topic X --param k=painpoint
    """
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
        rows = list(db.query(sql))
    else:
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


# ── analyze ──────────────────────────────────────────────────────────────────

def _since_to_days(since: str | None) -> int | None:
    if not since:
        return None
    unit = since[-1].lower()
    n = int(since[:-1])
    if unit == "d":
        return n
    if unit == "w":
        return n * 7
    if unit == "h":
        # treat sub-day as 1 day for painpoints/themes
        return max(1, n // 24)
    raise typer.BadParameter(f"--since '{since}' — use e.g. 7d, 24h, 2w")


@analyze_app.command("themes")
def cmd_themes(
    sub: Optional[str] = typer.Option(None, "--sub", "-s"),
    since: Optional[str] = typer.Option(None, "--since"),
    limit: int = typer.Option(100, "--limit", "-n"),
    provider: Optional[str] = typer.Option(
        None, "--provider",
        help="anthropic|openai|ollama|… (omit → use LLM_PROVIDER from Settings)",
    ),
    as_json: bool = typer.Option(False, "--json"),
) -> None:
    """Cluster stored posts into themes via LLM."""
    from ..analyze.themes import analyze_themes

    result = analyze_themes(sub=sub, since_days=_since_to_days(since), limit=limit, provider=provider)
    _emit(result, as_json)


@analyze_app.command("summarize")
def cmd_summarize(
    post: str = typer.Option(..., "--post", "-p"),
    provider: Optional[str] = typer.Option(
        None, "--provider",
        help="omit → use the default from Settings → BYOK (LLM_PROVIDER env)",
    ),
) -> None:
    """Summarize a single thread (post + top comments)."""
    from ..analyze.summarize import summarize_thread

    typer.echo(summarize_thread(post_id=post, provider=provider))


@analyze_app.command("painpoints")
def cmd_painpoints(
    sub: Optional[str] = typer.Option(None, "--sub", "-s"),
    since: Optional[str] = typer.Option(None, "--since"),
    top: int = typer.Option(50, "--top"),
    provider: Optional[str] = typer.Option(
        None, "--provider",
        help="omit → use Settings → BYOK default (LLM_PROVIDER env)",
    ),
    as_json: bool = typer.Option(False, "--json"),
) -> None:
    """Extract user pain points from stored posts (product research)."""
    from ..analyze.painpoints import extract_painpoints

    result = extract_painpoints(
        sub=sub, since_days=_since_to_days(since), top=top, provider=provider
    )
    _emit(result, as_json)


# ── mcp ──────────────────────────────────────────────────────────────────────

@mcp_app.command("serve")
def cmd_mcp_serve() -> None:
    """Run the MCP server (stdio transport)."""
    try:
        from ..mcp.server import run
    except ImportError as e:
        console.print(
            "[red]MCP extra not installed.[/red] "
            "Run: pip install -e '.[mcp]'"
        )
        raise typer.Exit(1) from e
    run()


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
        help="Data dir to align Claude with (default: REDDIT_MYIND_DATA_DIR or CWD/data).",
    ),
    project_dir: Optional[Path] = typer.Option(
        None, "--project-dir",
        help="Repo dir for `uv run` invocation (dev mode). Mutually exclusive with --bin.",
    ),
    bin_path: Optional[Path] = typer.Option(
        None, "--bin",
        help="Bundled reddit-cli binary path (prod mode). Mutually exclusive with --project-dir.",
    ),
    server_name: str = typer.Option("reddit-myind", "--name"),
    rotate_token: bool = typer.Option(
        False, "--rotate-token", help="Generate a fresh token even if one already exists.",
    ),
    as_json: bool = typer.Option(False, "--json"),
) -> None:
    """Connect (or re-sync) Gap Map's MCP entry in Claude Code's config.

    Aligns REDDIT_MYIND_DATA_DIR so MCP tools write to the same SQLite the
    desktop app reads. Generates a token (kept under <data_dir>/mcp_token)
    and injects it into the entry's env block for future v2 gating.

    Idempotent: re-running after the app moves just rewrites command/args/env
    without rotating the token (use --rotate-token to force a new one).
    """
    from ..mcp.install import install as do_install

    if project_dir and (project_dir / "pyproject.toml").exists() is False and not bin_path:
        console.print(f"[red]{project_dir} doesn't look like the reddit-myind repo.[/red]")
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


@mcp_app.command("uninstall")
def cmd_mcp_uninstall(
    claude_config: Optional[Path] = typer.Option(None, "--config"),
    client: Optional[str] = typer.Option(None, "--client"),
    data_dir: Optional[Path] = typer.Option(None, "--data-dir"),
    server_name: str = typer.Option("reddit-myind", "--name"),
    keep_token: bool = typer.Option(False, "--keep-token", help="Don't delete <data_dir>/mcp_token."),
    as_json: bool = typer.Option(False, "--json"),
) -> None:
    """Remove Gap Map's MCP entry. Other mcpServers entries stay untouched."""
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
    server_name: str = typer.Option("reddit-myind", "--name"),
    as_json: bool = typer.Option(False, "--json"),
) -> None:
    """Report whether Gap Map is connected to the chosen MCP client and DB-aligned."""
    from ..mcp.install import status as do_status

    try:
        result = do_status(
            config_path=claude_config,
            client=client,
            data_dir=data_dir,
            server_name=server_name,
        )
    except Exception as e:  # noqa: BLE001
        result = {"ok": False, "reason": f"status failed: {e}"}

    if as_json:
        typer.echo(json.dumps(result, default=str))
        return

    typer.echo(f"config:        {result['config_path']}")
    typer.echo(f"data_dir:      {result['data_dir']}")
    typer.echo(f"connected:     {result.get('connected')}")
    typer.echo(f"db_aligned:    {result.get('db_aligned')}")
    typer.echo(f"has_token:     {result.get('has_token')}")
    typer.echo(f"token_in_env:  {result.get('token_in_env')}")
    if result.get("reason"):
        typer.echo(f"note: {result['reason']}")


# ── info ─────────────────────────────────────────────────────────────────────

# ── research ─────────────────────────────────────────────────────────────────

@research_app.command("discover")
def cmd_research_discover(
    topic: str = typer.Option(..., "--topic", "-t"),
    limit: int = typer.Option(10, "--limit", "-n"),
    as_json: bool = typer.Option(False, "--json"),
) -> None:
    """List the most relevant subreddits for a topic."""
    from ..research import discover_subs

    result = discover_subs(topic, limit=limit)
    rows = result["subs"] if isinstance(result, dict) else result
    conf = result.get("confirmation") if isinstance(result, dict) else None
    if conf and conf.get("auto_corrected") and not as_json:
        typer.echo(
            f"Note: corrected '{conf['original_topic']}' → '{conf['canonical_topic']}'",
            err=True,
        )
    if conf and conf.get("needs_confirmation") and not as_json:
        typer.echo(
            f"Warning: weak match for '{conf['canonical_topic']}'. "
            f"Suggested variants: {', '.join(conf.get('suggested_variants') or [])}",
            err=True,
        )
    if as_json:
        _emit(result, as_json, table_title=f"subs for '{topic}'")
    else:
        _emit(rows, as_json, table_title=f"subs for '{topic}'")


@research_app.command("schedule-enable")
def cmd_schedule_enable(
    topic: str = typer.Option(..., "--topic", "-t"),
    enabled: bool = typer.Option(True, "--enabled/--disabled"),
) -> None:
    """Flag a topic to be included in scheduled re-runs (schedule-tick)."""
    from datetime import datetime, timezone
    from ..core.db import get_db

    db = get_db()
    db["topic_prefs"].upsert(
        {
            "topic": topic,
            "scheduled": 1 if enabled else 0,
            "last_run_seen": (
                list(db.query("SELECT last_run_seen FROM topic_prefs WHERE topic=?", [topic]))
                or [{}]
            )[0].get("last_run_seen") or "",
            "last_run_ts": (
                list(db.query("SELECT last_run_ts FROM topic_prefs WHERE topic=?", [topic]))
                or [{}]
            )[0].get("last_run_ts") or "",
        },
        pk="topic",
    )
    typer.echo(
        f"topic '{topic}' scheduled={'yes' if enabled else 'no'} "
        f"at {datetime.now(timezone.utc).isoformat(timespec='seconds')}"
    )


@research_app.command("schedule-seen")
def cmd_schedule_seen(
    topic: str = typer.Option(..., "--topic", "-t"),
) -> None:
    """Mark the user's most-recent view of this topic.

    Called by the frontend when the user opens the Map tab, so that the
    'new since last viewed' banner only highlights changes since THEN."""
    from datetime import datetime, timezone
    from ..core.db import get_db

    db = get_db()
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    existing = list(db.query("SELECT * FROM topic_prefs WHERE topic=?", [topic]))
    row = existing[0] if existing else {}
    db["topic_prefs"].upsert(
        {
            "topic": topic,
            "scheduled": int(row.get("scheduled") or 0),
            "last_run_seen": now,
            "last_run_ts": row.get("last_run_ts") or "",
        },
        pk="topic",
    )
    typer.echo(now)


@research_app.command("schedule-tick")
def cmd_schedule_tick(
    as_json: bool = typer.Option(False, "--json"),
) -> None:
    """Walk every topic with scheduled=1 and re-run its collect.

    This is what the launchd plist calls on its interval. Skips any topic
    whose active collect is already running (cheap check: a fresh fetches
    row with ended_at NULL for the topic within the last 5 minutes).
    """
    from datetime import datetime, timezone, timedelta
    from ..core.db import get_db
    from ..research.collect import collect as run_collect

    db = get_db()
    now = datetime.now(timezone.utc)
    five_min_ago = (now - timedelta(minutes=5)).isoformat(timespec="seconds")

    scheduled = [
        r["topic"]
        for r in db.query("SELECT topic FROM topic_prefs WHERE scheduled=1")
    ]
    ran: list[str] = []
    skipped: list[dict] = []
    errored: list[dict] = []

    for topic in scheduled:
        # Skip if a collect is already in-flight for this topic.
        try:
            busy = list(db.query(
                "SELECT id FROM fetches "
                "WHERE kind LIKE 'source:%' AND ended_at IS NULL "
                "AND started_at >= ? AND params_json LIKE ?",
                [five_min_ago, f'%"{topic}"%'],
            ))
        except Exception:
            busy = []
        if busy:
            skipped.append({"topic": topic, "reason": "collect-in-flight"})
            continue
        try:
            run_collect(topic=topic, aggressive=True)
            ran.append(topic)
            db["topic_prefs"].upsert(
                {
                    "topic": topic,
                    "scheduled": 1,
                    "last_run_seen": (
                        list(db.query(
                            "SELECT last_run_seen FROM topic_prefs WHERE topic=?",
                            [topic],
                        )) or [{}]
                    )[0].get("last_run_seen") or "",
                    "last_run_ts": now.isoformat(timespec="seconds"),
                },
                pk="topic",
            )
        except Exception as e:
            errored.append({"topic": topic, "error": str(e)})

    result = {
        "ran_at": now.isoformat(timespec="seconds"),
        "ran": ran, "skipped": skipped, "errored": errored,
        "n_scheduled": len(scheduled),
    }
    _emit(result, as_json, table_title="schedule-tick")


@research_app.command("analyze-papers")
def cmd_research_analyze_papers(
    topic: str = typer.Option(..., "--topic", "-t"),
    limit: Optional[int] = typer.Option(None, "--limit"),
    force: bool = typer.Option(False, "--force"),
    post_id: Optional[str] = typer.Option(None, "--post-id"),
    as_json: bool = typer.Option(False, "--json"),
) -> None:
    """Run LLM analysis (summary / relevance / builder-takeaway) per paper."""
    from ..research.paper_analyze import analyze_paper, analyze_papers_bulk

    if post_id:
        r = analyze_paper(topic, post_id, force=force)
        _emit(r, as_json, table_title=f"analyze {post_id}")
        return

    def _log(msg: str) -> None:
        typer.echo(msg, err=True)

    r = analyze_papers_bulk(topic, limit=limit, force=force, progress=_log)
    _emit(r, as_json, table_title=f"analyze-papers '{topic}'")


@research_app.command("diff")
def cmd_research_diff(
    topic: str = typer.Option(..., "--topic", "-t"),
    window: int = typer.Option(7, "--window", help="Days in the 'recent' window"),
    as_json: bool = typer.Option(False, "--json"),
) -> None:
    """Show what findings appeared in the last N days vs the prior window.

    recent: added in the last --window days.
    prior:  added between --window and 4× --window days ago.
    stable: older than that OR pre-2026-04-19 rows without a timestamp.
    """
    from ..graph.diff import diff_findings

    r = diff_findings(topic, window_days=window)
    if as_json:
        _emit(r, as_json, table_title=f"diff for '{topic}' (±{window}d)")
        return
    s = r["summary"]
    typer.echo(
        f"'{topic}' — last {window} days:\n"
        f"  +{s['new_painpoints']} painpoints  "
        f"+{s['new_workarounds']} workarounds  "
        f"+{s['new_products']} products  "
        f"+{s['new_feature_wishes']} feature wishes"
    )
    for node in r["recent"]:
        typer.echo(f"  NEW [{node['kind']}] {node['label']}  ({node['ts']})")


@research_app.command("collect")
def cmd_research_collect(
    topic: str = typer.Option(..., "--topic", "-t"),
    subs: Optional[str] = typer.Option(None, "--subs", help="Comma-separated, overrides discovery"),
    limit_per_sub: int = typer.Option(50, "--per-sub"),
    limit_per_query: int = typer.Option(25, "--per-query"),
    categories: Optional[str] = typer.Option(
        None, "--categories", help="Comma-separated: pain,features,complaints,diy (default: all)"
    ),
    scope_to_subs: bool = typer.Option(
        True, "--scope-to-subs/--search-all-reddit",
        help="Restrict search queries to discovered subs (higher signal) or search all Reddit.",
    ),
    historical: bool = typer.Option(
        False, "--historical/--no-historical",
        help="Also pull pre-May-2025 posts via pullpush archive.",
    ),
    historical_days: int = typer.Option(730, "--historical-days"),
    historical_per_sub: int = typer.Option(500, "--historical-per-sub"),
    sources: Optional[str] = typer.Option(
        None, "--sources",
        help=(
            "Comma-separated free sources. Options: hn, appstore, playstore, "
            "arxiv, openalex, pubmed, gnews, devto, stackoverflow, github, "
            "trends, scholar, github_issues, lemmy, mastodon. Omit → aggressive "
            "uses the safe 11-source default."
        ),
    ),
    aggressive: bool = typer.Option(
        False, "--aggressive", "-A",
        help=(
            "Max limits + all categories + historical + 3-year depth + the "
            "full 11-source free sweep (HN, App Store, Play Store, arXiv, "
            "OpenAlex, PubMed, Google News, Dev.to, Stack Overflow, GitHub, "
            "Google Trends)."
        ),
    ),
    skip_reddit: bool = typer.Option(
        False, "--skip-reddit/--no-skip-reddit",
        help="Skip the Reddit fetch stages entirely. Useful for topping up an existing topic with only external sources (HN, arxiv, etc.).",
    ),
) -> None:
    """Build a topic-scoped corpus in SQLite (discover + fetch + search [+ history])."""
    from ..research import collect

    sub_list = [s.strip() for s in subs.split(",")] if subs else None
    cats = [c.strip() for c in categories.split(",")] if categories else None
    src_list = [s.strip() for s in sources.split(",")] if sources else None

    result = collect(
        topic=topic,
        subs=sub_list,
        limit_per_sub=limit_per_sub,
        limit_per_query=limit_per_query,
        query_categories=cats,
        sub_scope_search=scope_to_subs,
        include_historical=historical,
        historical_days=historical_days,
        historical_limit_per_sub=historical_per_sub,
        sources=src_list,
        aggressive=aggressive,
        skip_reddit=skip_reddit,
        progress=lambda m: console.print(f"[dim]• {m}[/dim]"),
    )
    console.print(
        f"\n[green]done[/green] — [bold]{result.posts_fetched}[/bold] posts "
        f"tagged under [cyan]{result.topic}[/cyan] across {len(result.subs)} subs. "
        f"{len(result.errors)} error(s)."
    )
    if result.errors:
        console.print("[yellow]errors:[/yellow]")
        for e in result.errors[:5]:
            console.print(f"  ! {e}")


@research_app.command("gaps")
def cmd_research_gaps(
    topic: str = typer.Option(..., "--topic", "-t"),
    provider: Optional[str] = typer.Option(
        None, "--provider",
        help="omit → use Settings → BYOK default (LLM_PROVIDER env)",
    ),
    corpus_limit: int = typer.Option(120, "--limit", "-n"),
    min_score: int = typer.Option(1, "--min-score"),
    as_json: bool = typer.Option(False, "--json"),
    extractor: Optional[str] = typer.Option(
        None, "--only", help="Run one extractor: painpoints|features|complaints|diy"
    ),
) -> None:
    """Extract gap signals from a collected corpus via LLM."""
    from ..research import find_gaps, run_extractor

    if extractor:
        result = run_extractor(
            extractor, topic, provider=provider, corpus_limit=corpus_limit, min_score=min_score
        )
        _emit(result, as_json)
    else:
        report = find_gaps(
            topic, provider=provider, corpus_limit=corpus_limit, min_score=min_score
        )
        _emit(report, as_json)


@research_app.command("top-opportunities")
def cmd_top_opportunities(
    limit: int = typer.Option(20, "--limit", "-n"),
    min_score: float = typer.Option(0.0, "--min-score"),
    as_json: bool = typer.Option(True, "--json"),
) -> None:
    """Phase-5 — cross-topic leaderboard of opportunities."""
    from ..research.cross_topic import top_opportunities_across_topics
    _emit(top_opportunities_across_topics(limit=limit, min_score=min_score), as_json)


@research_app.command("search-findings")
def cmd_search_findings(
    query: str = typer.Option(..., "--query", "-q"),
    topic: Optional[str] = typer.Option(None, "--topic", "-t"),
    limit: int = typer.Option(30, "--limit", "-n"),
    as_json: bool = typer.Option(True, "--json"),
) -> None:
    """Phase-5 — global substring search across all findings."""
    from ..research.cross_topic import search_findings
    _emit(search_findings(query=query, topic_filter=topic, limit=limit), as_json)


@research_app.command("related-topics")
def cmd_related_topics(
    topic: str = typer.Option(..., "--topic", "-t"),
    limit: int = typer.Option(5, "--limit", "-n"),
    as_json: bool = typer.Option(True, "--json"),
) -> None:
    """Phase-5 — topics with overlapping painpoints."""
    from ..research.cross_topic import related_topics
    _emit(related_topics(topic=topic, limit=limit), as_json)


@research_app.command("export-brief")
def cmd_export_brief(
    topic: str = typer.Option(..., "--topic", "-t"),
    format: str = typer.Option("markdown", "--format", "-f",
        help="markdown | hypotheses | slack"),
    out: Optional[str] = typer.Option(None, "--out", "-o",
        help="Write to file; default is stdout"),
) -> None:
    """Phase-7 — Export a shareable brief (markdown for Notion/Linear)."""
    from ..research.export_brief import export_markdown, export_hypothesis_cards, export_slack_summary
    if format == "markdown":
        content = export_markdown(topic)
    elif format == "hypotheses":
        content = export_hypothesis_cards(topic)
    elif format == "slack":
        content = export_slack_summary(topic)
    else:
        typer.echo(f"Unknown format: {format}. Use markdown | hypotheses | slack.", err=True)
        raise typer.Exit(1)
    if out:
        from pathlib import Path
        Path(out).write_text(content, encoding="utf-8")
        typer.echo(f"Wrote {len(content)} chars to {out}")
    else:
        typer.echo(content)


@research_app.command("competitor-matrix")
def cmd_competitor_matrix(
    topic: str = typer.Option(..., "--topic", "-t"),
    as_json: bool = typer.Option(True, "--json"),
) -> None:
    """Phase-9 — feature × competitor matrix from the synthesis report."""
    from ..research.competitors import build_matrix
    _emit(build_matrix(topic=topic), as_json)


# ── AG-C: global-competitors (T2.5) + feedback-record (T2.4) ───────────


@research_app.command("global-competitors")
def cmd_global_competitors(
    min_topics: int = typer.Option(
        2, "--min-topics",
        help="Only return clusters appearing in at least this many topics",
    ),
    threshold: float = typer.Option(
        0.80, "--threshold",
        help="Cosine similarity floor for clustering product labels",
    ),
    as_json: bool = typer.Option(True, "--json"),
) -> None:
    """T2.5 — Cluster competitor products across all topics by label similarity."""
    from ..research.competitors import global_competitors
    _emit(global_competitors(min_topics=min_topics, threshold=threshold), as_json)


@research_app.command("feedback-record")
def cmd_feedback_record(
    topic: str = typer.Option(..., "--topic", "-t"),
    title: str = typer.Option(..., "--title", help="Exact finding title"),
    kind: str = typer.Option(
        "painpoint", "--kind",
        help="painpoint | feature_wish | workaround | product",
    ),
    verdict: str = typer.Option(
        "wrong", "--verdict",
        help="wrong | off_topic | spam | ok",
    ),
    note: str = typer.Option("", "--note", help="Optional free-text note"),
    as_json: bool = typer.Option(True, "--json"),
) -> None:
    """T2.4 — Record user feedback on a finding; feeds next synthesize prompt."""
    from ..research.feedback import record_feedback
    _emit(
        record_feedback(topic=topic, title=title, kind=kind,
                        verdict=verdict, note=note),
        as_json,
    )


@research_app.command("link-research")
def cmd_link_research(
    topic: str = typer.Option(..., "--topic", "-t"),
    k: int = typer.Option(3, "--k", help="Papers per finding"),
    as_json: bool = typer.Option(True, "--json"),
) -> None:
    """Phase-10 — Match findings to academic papers via the semantic palace."""
    from ..research.research_linker import link_findings_for_topic
    _emit(link_findings_for_topic(topic=topic, k=k), as_json)


@research_app.command("research-links")
def cmd_research_links(
    topic: str = typer.Option(..., "--topic", "-t"),
    finding: Optional[str] = typer.Option(None, "--finding",
        help="Finding title (case-insensitive); omit for per-finding count summary"),
    as_json: bool = typer.Option(True, "--json"),
) -> None:
    """Phase-10 — Get linked papers for a finding, or count summary."""
    from ..research.research_linker import get_links_for_finding, get_links_summary
    if finding:
        _emit(get_links_for_finding(topic=topic, finding_title=finding), as_json)
    else:
        _emit(get_links_summary(topic=topic), as_json)


@research_app.command("monitor-run")
def cmd_monitor_run(
    topic: str = typer.Option(..., "--topic", "-t"),
    skip_collect: bool = typer.Option(True, "--skip-collect/--with-collect",
        help="Default skips collect (reuses existing corpus). --with-collect re-fetches."),
    trigger: str = typer.Option("manual", "--trigger",
        help="manual | scheduled | post-collect"),
    as_json: bool = typer.Option(True, "--json"),
) -> None:
    """Phase-4 — Re-run synthesize + record delta for a single topic."""
    from ..research.monitor import run_topic_refresh
    out = run_topic_refresh(topic=topic, trigger=trigger, skip_collect=skip_collect)
    _emit(out, as_json)


@research_app.command("monitor-tick")
def cmd_monitor_tick(
    skip_collect: bool = typer.Option(True, "--skip-collect/--with-collect"),
    as_json: bool = typer.Option(True, "--json"),
) -> None:
    """Phase-4 — Process ALL scheduled topics. Called by launchd cron."""
    from ..research.monitor import tick
    out = tick(skip_collect=skip_collect)
    _emit(out, as_json)


@research_app.command("monitor-deltas")
def cmd_monitor_deltas(
    topic: Optional[str] = typer.Option(None, "--topic", "-t",
        help="List a single topic's deltas; omit for dashboard view across all topics"),
    limit: int = typer.Option(10, "--limit", "-n"),
    since_days: int = typer.Option(7, "--since-days",
        help="Dashboard-mode only: window size for recent deltas"),
    as_json: bool = typer.Option(True, "--json"),
) -> None:
    """Phase-4 — Recent monitoring runs + deltas."""
    from ..research.monitor import list_recent_runs, dashboard_deltas
    if topic:
        out = list_recent_runs(topic=topic, limit=limit)
    else:
        out = dashboard_deltas(limit=limit, since_days=since_days)
    _emit(out, as_json)


@research_app.command("hypothesis-create")
def cmd_hypothesis_create(
    topic: str = typer.Option(..., "--topic", "-t"),
    card_json: str = typer.Option(..., "--card", help="JSON of the hypothesis card to freeze"),
    status: str = typer.Option("draft", "--status", help="draft | running | paused"),
    as_json: bool = typer.Option(True, "--json"),
) -> None:
    """Promote an Insight Engine hypothesis card to a tracked bet."""
    from ..research.hypothesis_tracker import create_hypothesis_test
    try:
        card = json.loads(card_json)
    except json.JSONDecodeError as e:
        _emit({"ok": False, "error": f"invalid card JSON: {e}"}, as_json)
        raise typer.Exit(1)
    try:
        row = create_hypothesis_test(topic=topic, card=card, status=status)
    except ValueError as e:
        _emit({"ok": False, "error": str(e)}, as_json)
        raise typer.Exit(1)
    _emit({"ok": True, **row}, as_json)


@research_app.command("hypothesis-update")
def cmd_hypothesis_update(
    hypothesis_id: str = typer.Option(..., "--id"),
    status: str = typer.Option(..., "--status",
        help="draft | running | validated | invalidated | paused | archived"),
    notes: Optional[str] = typer.Option(None, "--notes"),
    as_json: bool = typer.Option(True, "--json"),
) -> None:
    """Update a tracked bet's status. Notes are appended to the journal."""
    from ..research.hypothesis_tracker import update_status
    try:
        row = update_status(hypothesis_id, status, notes=notes)
    except ValueError as e:
        _emit({"ok": False, "error": str(e)}, as_json)
        raise typer.Exit(1)
    _emit({"ok": True, **row}, as_json)


@research_app.command("hypothesis-list")
def cmd_hypothesis_list(
    topic: Optional[str] = typer.Option(None, "--topic", "-t"),
    status: Optional[str] = typer.Option(None, "--status"),
    include_archived: bool = typer.Option(False, "--include-archived"),
    as_json: bool = typer.Option(True, "--json"),
) -> None:
    """List tracked bets. Default excludes archived."""
    from ..research.hypothesis_tracker import list_hypotheses
    rows = list_hypotheses(topic=topic, status=status, include_archived=include_archived)
    _emit(rows, as_json)


@research_app.command("hypothesis-delete")
def cmd_hypothesis_delete(
    hypothesis_id: str = typer.Option(..., "--id"),
    as_json: bool = typer.Option(True, "--json"),
) -> None:
    """Soft-delete (archive) a tracked bet."""
    from ..research.hypothesis_tracker import delete_hypothesis
    row = delete_hypothesis(hypothesis_id)
    _emit({"ok": True, **row}, as_json)


@research_app.command("hypothesis-stats")
def cmd_hypothesis_stats(
    topic: Optional[str] = typer.Option(None, "--topic", "-t",
        help="Per-topic counts; omit for global across all topics"),
    as_json: bool = typer.Option(True, "--json"),
) -> None:
    """Status-bucket counts for the dashboard 'My bets' card."""
    from ..research.hypothesis_tracker import stats_by_topic, global_stats
    stats = stats_by_topic(topic) if topic else global_stats()
    _emit({"ok": True, "topic": topic, "stats": stats}, as_json)


@research_app.command("find-existing-topic")
def cmd_find_existing_topic(
    user_input: str = typer.Option(..., "--input", "-i"),
    as_json: bool = typer.Option(True, "--json"),
) -> None:
    """Pre-check before starting a collect: does a semantically-identical
    topic already exist in the DB? Returns {existing_topic, posts} or null.
    UI uses this to prompt 'Open existing with N posts?' vs 'New topic'."""
    from ..research.topic_resolver import find_existing_topic
    out = find_existing_topic(user_input) or {}
    _emit({"ok": True, "user_input": user_input, "match": out or None}, as_json)


# ─── FG: T1.3 soft-delete / restore / purge ───────────────────────────────
@research_app.command("topic-soft-delete")
def cmd_topic_soft_delete(
    topic: str = typer.Option(..., "--topic", "-t"),
    as_json: bool = typer.Option(True, "--json"),
) -> None:
    """Soft-delete a topic. Hidden from list_topics; recoverable for 7 days."""
    from ..research.trash import soft_delete
    _emit(soft_delete(topic), as_json)


@research_app.command("topic-restore")
def cmd_topic_restore(
    topic: str = typer.Option(..., "--topic", "-t"),
    as_json: bool = typer.Option(True, "--json"),
) -> None:
    """Restore a soft-deleted topic."""
    from ..research.trash import restore
    _emit(restore(topic), as_json)


@research_app.command("topic-trash-list")
def cmd_topic_trash_list(
    as_json: bool = typer.Option(True, "--json"),
) -> None:
    """List soft-deleted topics + age + post count."""
    from ..research.trash import list_trash
    _emit({"ok": True, "trash": list_trash()}, as_json)


@research_app.command("topic-trash-purge")
def cmd_topic_trash_purge(
    min_age_days: int = typer.Option(7, "--min-age-days"),
    as_json: bool = typer.Option(True, "--json"),
) -> None:
    """Hard-delete soft-deleted topics older than N days. Default 7."""
    from ..research.trash import purge_older_than
    _emit(purge_older_than(min_age_days=min_age_days), as_json)


@research_app.command("merge-duplicate-topics")
def cmd_merge_duplicate_topics(
    apply: bool = typer.Option(False, "--apply",
        help="Actually merge. Default dry-run shows what would merge."),
    as_json: bool = typer.Option(True, "--json"),
) -> None:
    """Merge topic_prefs / topic_posts / graph_nodes / graph_edges rows that
    are case-only or slug-only variants of the same topic.

    Fixes the "3 rows for one search" problem — e.g. 'Indian student exam
    stress' + 'indian student exam stress' + 'indian-student-exam-pain' all
    collapse onto the variant with the most posts. Winner chosen by post
    count (ties broken lexicographically). Dry-run by default.
    """
    from ..research.topic_resolver import merge_duplicate_topics
    out = merge_duplicate_topics(dry_run=not apply)
    _emit(out, as_json)


@research_app.command("clean-corpus")
def cmd_clean_corpus(
    topic: str = typer.Option(..., "--topic", "-t"),
    threshold: float = typer.Option(0.30, "--threshold",
        help="Min cosine-to-topic to keep. 0.30 = recall, 0.40 = precision"),
    apply: bool = typer.Option(False, "--apply",
        help="Actually delete. Default is dry-run (shows what WOULD be dropped)."),
    min_keep: int = typer.Option(20, "--min-keep",
        help="Never drop below this many posts (safety floor)"),
    as_json: bool = typer.Option(True, "--json"),
) -> None:
    """Retroactively drop off-topic posts from topic_posts for a topic.

    Use when a past collect over-matched (e.g. "meditation app" pulled
    r/politics threads). Dry-run by default — inspect sample_dropped,
    then re-run with --apply.
    """
    from ..research.relevance import filter_topic_posts
    out = filter_topic_posts(topic=topic, threshold=threshold, apply=apply,
                             min_keep=min_keep)
    _emit(out, as_json)


@research_app.command("collect-quality-check")
def cmd_collect_quality_check(
    topic: str = typer.Option(..., "--topic", "-t"),
    as_json: bool = typer.Option(True, "--json"),
) -> None:
    """Report how many currently-tagged posts would fail the quality gate.

    Does NOT modify the corpus — it just scores every post already tagged
    to the topic against the lenient and strict gates and returns counts.

    Use this to decide whether to re-collect with GAPMAP_STRICT_QUALITY=1:
    if the strict-drop share is high, your corpus has a lot of noise and
    strict mode is worth enabling on the next collect.
    """
    from ..research.quality_gate import passes_quality

    db = get_db()
    rows = list(db.query(
        "SELECT p.id, p.title, p.selftext, p.score, p.author "
        "FROM posts p JOIN topic_posts tp ON tp.post_id = p.id "
        "WHERE tp.topic = ?",
        [topic],
    ))
    total = len(rows)
    lenient_pass = 0
    strict_pass = 0
    lenient_fail_ids: list[str] = []
    strict_fail_ids: list[str] = []
    for r in rows:
        row = dict(r)
        if passes_quality(row, strict=False):
            lenient_pass += 1
        else:
            lenient_fail_ids.append(row["id"])
        if passes_quality(row, strict=True):
            strict_pass += 1
        else:
            strict_fail_ids.append(row["id"])

    out = {
        "ok": True,
        "topic": topic,
        "total": total,
        "lenient": {
            "passed": lenient_pass,
            "failed": total - lenient_pass,
            "sample_failed_ids": lenient_fail_ids[:20],
        },
        "strict": {
            "passed": strict_pass,
            "failed": total - strict_pass,
            "sample_failed_ids": strict_fail_ids[:20],
        },
    }
    _emit(out, as_json)


# ─── Dual-Mode Pivot — Product Mode commands ─────────────────────────────
@research_app.command("product-create")
def cmd_product_create(
    name: str = typer.Option(..., "--name", "-n"),
    one_liner: str = typer.Option("", "--one-liner"),
    category: str = typer.Option("", "--category"),
    topic: str = typer.Option("", "--topic",
        help="Existing topic slug to link (shares corpus). Default: slugified name."),
    competitors_json: str = typer.Option("[]", "--competitors",
        help="JSON list of {name, urls, category}"),
    monitoring_cadence: str = typer.Option("daily", "--cadence"),
    as_json: bool = typer.Option(True, "--json"),
) -> None:
    """Phase-A — register a Product (your app + competitors)."""
    import json as _json
    from ..research.product import create_product
    try:
        competitors = _json.loads(competitors_json or "[]")
    except Exception:
        competitors = []
    out = create_product(
        name=name, one_liner=one_liner, category=category, topic=topic,
        competitors=competitors, monitoring_cadence=monitoring_cadence,
    )
    _emit(out, as_json)


@research_app.command("product-list")
def cmd_product_list(
    active_only: bool = typer.Option(True, "--active-only/--all"),
    as_json: bool = typer.Option(True, "--json"),
) -> None:
    from ..research.product import list_products
    _emit({"ok": True, "products": list_products(active_only=active_only)}, as_json)


@research_app.command("product-get")
def cmd_product_get(
    product_id: str = typer.Option(..., "--id"),
    as_json: bool = typer.Option(True, "--json"),
) -> None:
    from ..research.product import get_product
    _emit(get_product(product_id), as_json)


@research_app.command("product-update")
def cmd_product_update(
    product_id: str = typer.Option(..., "--id"),
    fields_json: str = typer.Option("{}", "--fields"),
    as_json: bool = typer.Option(True, "--json"),
) -> None:
    import json as _json
    from ..research.product import update_product
    try:
        fields = _json.loads(fields_json or "{}")
    except Exception:
        fields = {}
    _emit(update_product(product_id, fields), as_json)


@research_app.command("product-add-competitor")
def cmd_product_add_competitor(
    product_id: str = typer.Option(..., "--id"),
    name: str = typer.Option(..., "--name"),
    urls_json: str = typer.Option("{}", "--urls"),
    category: str = typer.Option("", "--category"),
    as_json: bool = typer.Option(True, "--json"),
) -> None:
    import json as _json
    from ..research.product import add_competitor
    try:
        urls = _json.loads(urls_json or "{}")
    except Exception:
        urls = {}
    _emit(add_competitor(product_id, name, urls, category), as_json)


@research_app.command("product-remove-competitor")
def cmd_product_remove_competitor(
    product_id: str = typer.Option(..., "--id"),
    name: str = typer.Option(..., "--name"),
    as_json: bool = typer.Option(True, "--json"),
) -> None:
    from ..research.product import remove_competitor
    _emit(remove_competitor(product_id, name), as_json)


@research_app.command("product-delete")
def cmd_product_delete(
    product_id: str = typer.Option(..., "--id"),
    as_json: bool = typer.Option(True, "--json"),
) -> None:
    from ..research.product import delete_product
    _emit(delete_product(product_id), as_json)


@research_app.command("product-sweep")
def cmd_product_sweep(
    product_id: str = typer.Option(..., "--id"),
    trigger: str = typer.Option("manual", "--trigger"),
    skip_collect: bool = typer.Option(True, "--skip-collect/--with-collect"),
    as_json: bool = typer.Option(True, "--json"),
) -> None:
    """Phase-B — run a daily sweep for a product. Generates typed signals."""
    from ..research.product_sweep import run_product_sweep
    _emit(run_product_sweep(product_id, trigger=trigger, skip_collect=skip_collect), as_json)


@research_app.command("product-signals")
def cmd_product_signals(
    product_id: str = typer.Option(..., "--id"),
    since_days: Optional[int] = typer.Option(None, "--since-days"),
    include_resolved: bool = typer.Option(False, "--include-resolved"),
    limit: int = typer.Option(100, "--limit"),
    as_json: bool = typer.Option(True, "--json"),
) -> None:
    from ..research.product_sweep import list_signals
    _emit({"ok": True, "signals": list_signals(product_id, since_days, include_resolved, limit)}, as_json)


@research_app.command("product-signal-action")
def cmd_product_signal_action(
    signal_id: str = typer.Option(..., "--id"),
    action: str = typer.Option(..., "--action",
        help="dismissed | acted | snoozed | hypothesis"),
    notes: str = typer.Option("", "--notes"),
    snooze_days: int = typer.Option(7, "--snooze-days"),
    as_json: bool = typer.Option(True, "--json"),
) -> None:
    from ..research.product_sweep import signal_action
    _emit(signal_action(signal_id, action, notes, snooze_days), as_json)


@research_app.command("product-digest")
def cmd_product_digest(
    product_id: str = typer.Option(..., "--id"),
    days: int = typer.Option(7, "--days"),
    as_json: bool = typer.Option(False, "--json", hidden=True,
        help="Digest is plain markdown; --json accepted for wrapper compat."),
) -> None:
    """Phase-C — weekly markdown digest for Slack/Notion paste."""
    from ..research.product_digest import build_digest
    md = build_digest(product_id, days=days)
    # Print as plain stdout; Rust tolerates non-JSON.
    typer.echo(md)


@research_app.command("product-dashboard")
def cmd_product_dashboard(
    product_id: str = typer.Option(..., "--id"),
    days: int = typer.Option(7, "--days"),
    as_json: bool = typer.Option(True, "--json"),
) -> None:
    """One-call fetch for the Product Dashboard — mirror + lens + field + signals."""
    from ..research.product import get_product
    from ..research.product_digest import (
        build_mirror_section, build_lens_section, build_field_section,
    )
    from ..research.product_sweep import list_signals
    pinfo = get_product(product_id)
    if not pinfo.get("ok"):
        _emit(pinfo, as_json)
        return
    out = {
        "ok": True,
        "product": pinfo["product"],
        "competitors": pinfo["competitors"],
        "recent_sweeps": pinfo["recent_sweeps"],
        "mirror": build_mirror_section(product_id, days=days),
        "lens": build_lens_section(product_id, days=days),
        "field": build_field_section(product_id, days=days),
        "signals": list_signals(product_id, since_days=days, include_resolved=False, limit=50),
    }
    _emit(out, as_json)


@research_app.command("product-convert-topic")
def cmd_product_convert_topic(
    topic: str = typer.Option(..., "--topic", "-t"),
    name: Optional[str] = typer.Option(None, "--name"),
    one_liner: str = typer.Option("", "--one-liner"),
    as_json: bool = typer.Option(True, "--json"),
) -> None:
    """Phase-F — seed a Product from an existing Topic's graph.
    Auto-suggests competitors from graph_nodes kind in (product, company, competitor)."""
    from ..research.product import convert_topic_to_product
    _emit(convert_topic_to_product(topic, name=name, one_liner=one_liner), as_json)


@research_app.command("insights")
def cmd_research_insights(
    topic: str = typer.Option(..., "--topic", "-t", help="Topic name (must be collected first)."),
    provider: str | None = typer.Option(None, "--provider", help="Override LLM provider; Claude recommended for best synthesis."),
    cached: bool = typer.Option(False, "--cached", help="Return the last cached report instead of re-running the LLM."),
    chunked: bool = typer.Option(False, "--chunked", help="Use map-reduce chunked synth — N small LLM calls instead of one big one. Works when the provider is low on credits."),
    chunk_size: int = typer.Option(40, "--chunk-size", help="Rows per chunk (chunked mode only)."),
    max_workers: int | None = typer.Option(None, "--max-workers", help="Chunk parallelism. 1 = sequential. None = auto per provider (Ollama=1, Groq=2, others=4)."),
    max_tokens_per_chunk: int = typer.Option(800, "--max-tokens-per-chunk", help="Output budget per chunk. Keep small (300-800) for low-credit providers."),
    as_json: bool = typer.Option(False, "--json"),
) -> None:
    """Phase-1 Insight Engine — one-shot long-context synthesis across all sources.

    Produces a structured market report: opportunity-scored findings,
    competitor landscape, greenfield quadrant, citation-grounded narrative.
    See docs/specs/2026-04-20-insight-engine.md for the schema.

    `--chunked` switches to map-reduce mode: the corpus is split into
    `--chunk-size` chunks, each chunk goes through a small LLM call
    (bounded by `--max-tokens-per-chunk`), and findings are merged
    deterministically. This sidesteps the 402/credit errors that the
    single-call path hits on low-budget providers.
    """
    from ..research.insights import (
        load_insights,
        synthesize_insights,
        synthesize_insights_chunked,
    )

    if cached:
        report = load_insights(topic)
        if report is None:
            out = {"ok": False, "topic": topic, "error": "No cached insight — run without --cached to generate."}
        else:
            out = report
    elif chunked:
        def _p(msg: str) -> None:
            # In non-JSON mode print progress; in --json mode stay silent.
            if not as_json:
                typer.echo(msg)
        out = synthesize_insights_chunked(
            topic=topic,
            provider=provider,
            chunk_size=chunk_size,
            max_workers=max_workers,
            max_tokens_per_chunk=max_tokens_per_chunk,
            progress=_p,
        )
    else:
        out = synthesize_insights(topic=topic, provider=provider)
    _emit(out, as_json)


@research_app.command("solutions")
def cmd_research_solutions(
    topic: str = typer.Option(..., "--topic", "-t", help="Topic name (must already have painpoints in the graph)."),
    provider: str | None = typer.Option(None, "--provider", help="Override LLM provider (anthropic/openai/ollama)."),
    papers_per_painpoint: int = typer.Option(5, "--papers", help="Max papers per painpoint."),
    as_json: bool = typer.Option(False, "--json", help="Emit summary as JSON."),
) -> None:
    """Run the Problem -> Why -> Science -> Solution loop for a topic."""
    from ..analyze.providers.base import resolve_provider
    from ..research import solutions_pipeline

    # Resolve provider once so we get a clear error if no LLM configured,
    # rather than failing inside the per-painpoint loop.
    try:
        resolved = resolve_provider(provider)
    except Exception as e:  # noqa: BLE001 — surface the reason cleanly
        out = {"ok": False, "skipped": True, "reason": f"no_llm_provider: {e}"}
        if as_json:
            typer.echo(json.dumps(out))
        else:
            typer.echo(f"Skipped: {out['reason']}")
        raise typer.Exit(0)

    summary = solutions_pipeline(
        topic=topic, provider=resolved, papers_per_painpoint=papers_per_painpoint
    )
    if as_json:
        typer.echo(json.dumps(summary))
    else:
        for k, v in summary.items():
            typer.echo(f"{k}: {v}")


@research_app.command("sentiment-by-source")
def cmd_research_sentiment_by_source(
    topic: str = typer.Option(..., "--topic", "-t", help="Topic name (must have a corpus collected)."),
    provider: str | None = typer.Option(None, "--provider", help="Override LLM provider."),
    as_json: bool = typer.Option(False, "--json", help="Emit summary as JSON."),
) -> None:
    """Aggregate sentiment + dominant emotions per source for a topic."""
    from ..analyze.providers.base import resolve_provider
    from ..research.sentiment_by_source import sentiment_for_topic

    try:
        resolved = resolve_provider(provider)
    except Exception as e:  # noqa: BLE001
        out = {"ok": False, "skipped": True, "reason": f"no_llm_provider: {e}"}
        if as_json:
            typer.echo(json.dumps(out))
        else:
            typer.echo(f"Skipped: {out['reason']}")
        raise typer.Exit(0)

    result = sentiment_for_topic(topic=topic, provider=resolved)
    if as_json:
        typer.echo(json.dumps(result, default=str))
    else:
        typer.echo(f"persisted={result.get('persisted', 0)}  skipped={result.get('skipped', 0)}")
        for s in result.get("sources", []):
            label = s.get("source_label") or s.get("source")
            if s.get("_skipped"):
                typer.echo(f"  - {label}: skipped — {s.get('reason')}")
            else:
                emos = ", ".join(s.get("dominant_emotions") or []) or "—"
                typer.echo(f"  - {label} ({s.get('n_posts')}): {s.get('label')} · {emos}")


@research_app.command("concepts")
def cmd_research_concepts(
    topic: str = typer.Option(..., "--topic", "-t", help="Topic name (must already have painpoints in the graph)."),
    provider: str | None = typer.Option(None, "--provider", help="Override LLM provider."),
    max_concepts: int = typer.Option(5, "--max", help="Cap number of concepts returned (3-5 recommended)."),
    as_json: bool = typer.Option(False, "--json", help="Emit concepts as JSON."),
) -> None:
    """Generate 3-5 evidence-backed product concepts from a topic's painpoints.

    Reads painpoints + sentiment + workarounds, runs one LLM call, persists
    each concept as a graph node with 'has_concept' and 'based_on' edges so
    the UI can render citations back to the source painpoints.
    """
    from ..analyze.providers.base import resolve_provider
    from ..research.concept import concepts_for_topic

    try:
        resolved = resolve_provider(provider)
    except Exception as e:  # noqa: BLE001
        out = {"ok": False, "skipped": True, "reason": f"no_llm_provider: {e}"}
        if as_json:
            typer.echo(json.dumps(out))
        else:
            typer.echo(f"Skipped: {out['reason']}")
        raise typer.Exit(0)

    result = concepts_for_topic(topic=topic, provider=resolved, max_concepts=max_concepts)
    if as_json:
        typer.echo(json.dumps(result, default=str))
    else:
        if result.get("reason"):
            typer.echo(f"Skipped: {result['reason']}")
            return
        typer.echo(f"persisted={result.get('persisted', 0)} concepts for topic={topic}")
        for c in result.get("concepts", []):
            typer.echo(f"  • {c.get('title')} — {c.get('headline')}")


@research_app.command("temporal-gaps")
def cmd_research_temporal(
    topic: str = typer.Option(..., "--topic", "-t"),
    provider: Optional[str] = typer.Option(
        None, "--provider",
        help="omit → use Settings → BYOK default (LLM_PROVIDER env)",
    ),
    per_bucket: int = typer.Option(80, "--per-bucket"),
    force: bool = typer.Option(
        False, "--force",
        help="Ignore the graph_nodes cache and re-call the LLM.",
    ),
    as_json: bool = typer.Option(False, "--json"),
) -> None:
    """Classify pain points as CHRONIC / EMERGING / FADING via pre/post-May-2025 split.

    Results are cached in graph_nodes (kind='temporal_gap'). Re-running
    without --force returns the cached rows in under 100 ms instead of the
    30–90 s LLM pass. Pass --force to invalidate and re-run.
    """
    from ..research.gaps import find_temporal_gaps, clear_temporal_gaps

    if force:
        clear_temporal_gaps(topic)
    result = find_temporal_gaps(
        topic=topic, provider=provider, per_bucket=per_bucket, force=force,
    )
    _emit(result, as_json)


@research_app.command("report-pro")
def cmd_research_report_pro(
    topic: str = typer.Option(..., "--topic", "-t"),
    out: Optional[Path] = typer.Option(None, "--out", "-o"),
    as_json: bool = typer.Option(False, "--json", hidden=True,
                                 help="Accept --json from Rust wrapper (no-op; output is always markdown)."),
) -> None:
    """Premium citation-rich report: painpoints + evidence + build plan + users-to-DM."""
    from ..research.report_pro import render_citations_md

    _ = as_json  # flag accepted for wrapper compat
    md = render_citations_md(topic)
    if out:
        out.write_text(md, encoding="utf-8")
        console.print(f"[green]wrote premium report → {out}[/green]")
    else:
        typer.echo(md)


@research_app.command("findings")
def cmd_research_findings(
    topic: str = typer.Option(..., "--topic", "-t"),
    top_n: int = typer.Option(5, "--top"),
    out: Optional[Path] = typer.Option(None, "--out", "-o"),
    tweet: bool = typer.Option(False, "--tweet", help="Render terse 3-finding tweet summary"),
    as_json: bool = typer.Option(False, "--json", hidden=True,
                                 help="Accept --json from Rust wrapper (no-op; output is always markdown)."),
) -> None:
    """Plain markdown findings report — no LLM required, reads from graph."""
    from ..research.text_report import render_text_report, render_tweet

    _ = as_json
    md = render_tweet(topic) if tweet else render_text_report(topic, top_n=top_n)
    if out:
        out.write_text(md, encoding="utf-8")
        console.print(f"[green]wrote findings → {out}[/green]")
    else:
        typer.echo(md)


@research_app.command("report")
def cmd_research_report(
    topic: str = typer.Option(..., "--topic", "-t"),
    provider: Optional[str] = typer.Option(
        None, "--provider",
        help="omit → use Settings → BYOK default (LLM_PROVIDER env)",
    ),
    corpus_limit: int = typer.Option(120, "--limit", "-n"),
    out: Optional[Path] = typer.Option(None, "--out", "-o", help="Write markdown to file"),
) -> None:
    """Run all extractors and produce a human-readable markdown gap report."""
    from ..research import find_gaps, render_markdown

    report = find_gaps(topic, provider=provider, corpus_limit=corpus_limit)
    md = render_markdown(report)
    if out:
        out.write_text(md, encoding="utf-8")
        console.print(f"[green]wrote report → {out}[/green]")
    else:
        console.print(md)


@research_app.command("chat")
def cmd_research_chat(
    topic: str = typer.Option(..., "--topic", "-t"),
    question: str = typer.Option("", "--question", "-q", help="User question. If empty, the mode's default instruction runs."),
    mode: str = typer.Option("ask", "--mode", "-m", help="ask | plan | features | sources | bullets"),
    agent: bool = typer.Option(False, "--agent", help="Run as an agent with tool-use — LLM can call list_topics / run_query / get_findings / source_breakdown / sample_posts."),
    provider: Optional[str] = typer.Option(None, "--provider"),
    max_tokens: int = typer.Option(1800, "--max-tokens"),
    as_json: bool = typer.Option(False, "--json", help="Emit streaming JSON events (one per line)"),
) -> None:
    """Chat with the collected gap data — streams tokens (or tool-use events in --agent mode)."""
    import sys
    from ..research.chat import chat_stream, chat_meta, agent_stream_anthropic

    try:
        meta = chat_meta(topic, provider=provider)
    except Exception as e:
        if as_json:
            typer.echo(json.dumps({"event": "error", "error": str(e)}))
        else:
            typer.echo(f"ERROR: {e}", err=True)
        raise typer.Exit(code=1)

    if as_json:
        typer.echo(json.dumps({"event": "start", **meta, "agent": agent}))
    else:
        label = "agent" if agent else meta["provider"]
        typer.echo(f"→ {label} · model={meta['model']} · {meta['posts']} posts in corpus\n")
    sys.stdout.flush()

    try:
        if agent:
            # Agent mode = tool-use loop. Emits structured events.
            for ev in agent_stream_anthropic(topic, question, max_tokens=max_tokens):
                if as_json:
                    typer.echo(json.dumps(ev, default=str))
                else:
                    if ev.get("event") == "text":
                        sys.stdout.write(ev["text"])
                    elif ev.get("event") == "tool_call":
                        sys.stdout.write(f"\n  ⚙ {ev['name']}({json.dumps(ev['input'])[:100]})\n")
                    elif ev.get("event") == "tool_result":
                        sys.stdout.write(f"  ← {json.dumps(ev['output'], default=str)[:140]}\n")
                    elif ev.get("event") == "error":
                        sys.stdout.write(f"\nERROR: {ev['error']}\n")
                sys.stdout.flush()
        else:
            for chunk in chat_stream(
                topic, question, mode=mode, provider=provider, max_tokens=max_tokens,
            ):
                if as_json:
                    typer.echo(json.dumps({"event": "token", "text": chunk}))
                else:
                    sys.stdout.write(chunk)
                sys.stdout.flush()
    except Exception as e:
        if as_json:
            typer.echo(json.dumps({"event": "error", "error": str(e)}))
        else:
            typer.echo(f"\nERROR: {e}", err=True)
        raise typer.Exit(code=1)

    if as_json:
        typer.echo(json.dumps({"event": "done"}))
    else:
        typer.echo("")


@research_app.command("semantic-search")
def cmd_research_semantic_search(
    query: str = typer.Option(..., "--query", "-q"),
    topic: Optional[str] = typer.Option(None, "--topic", "-t",
        help="Restrict results to this topic. Omit = search all topics."),
    source: Optional[str] = typer.Option(None, "--source", "-s",
        help="Restrict to source_type (reddit/hn/arxiv/…)."),
    k: int = typer.Option(10, "--k", "-n"),
    no_rerank: bool = typer.Option(False, "--no-rerank",
        help="Skip BM25 rerank (pure vector). Faster, usually worse recall."),
    as_json: bool = typer.Option(True, "--json", hidden=True,
        help="Flag kept for Rust wrapper compat — CLI always emits JSON."),
) -> None:
    """Semantic + BM25 hybrid search over the posts corpus. Offline, local."""
    _ = as_json
    from ..retrieval.palace import is_available, search_posts
    if not is_available():
        typer.echo(json.dumps({
            "ok": False, "skipped": True,
            "reason": "retrieval extras not installed — `uv sync --extra retrieval`",
            "results": [],
        }))
        return
    result = search_posts(
        query=query, topic=topic, source_type=source,
        k=k, rerank=not no_rerank,
    )
    typer.echo(json.dumps(result, default=str, ensure_ascii=False))


@research_app.command("related-posts")
def cmd_research_related_posts(
    post_id: str = typer.Option(..., "--post-id", "-p"),
    k: int = typer.Option(10, "--k", "-n"),
    topic: Optional[str] = typer.Option(None, "--topic", "-t"),
    as_json: bool = typer.Option(True, "--json", hidden=True),
) -> None:
    """Find posts semantically closest to --post-id."""
    _ = as_json
    from ..retrieval.palace import is_available, related_posts
    if not is_available():
        typer.echo(json.dumps({"ok": False, "skipped": True, "results": []}))
        return
    typer.echo(json.dumps(related_posts(post_id, k=k, topic=topic), default=str))


@research_app.command("reindex-palace")
def cmd_research_reindex_palace(
    batch_size: int = typer.Option(200, "--batch"),
    as_json: bool = typer.Option(False, "--json"),
) -> None:
    """Re-embed every row in `posts` into the semantic-search palace.
    Run once after enabling the retrieval extras on an existing corpus."""
    from ..retrieval.palace import is_available, reindex_all
    if not is_available():
        msg = {"ok": False, "skipped": True,
               "reason": "retrieval extras not installed — `uv sync --extra retrieval`"}
        if as_json: typer.echo(json.dumps(msg))
        else: typer.echo(msg["reason"])
        return
    def _log(m: str) -> None: typer.echo(m)
    result = reindex_all(batch_size=batch_size, progress=_log)
    if as_json: typer.echo(json.dumps(result))
    else: typer.echo(f"✓ upserted {result.get('upserted', 0)} posts "
                     f"(skipped {result.get('skipped', 0)})")


@research_app.command("palace-stats")
def cmd_research_palace_stats(
    as_json: bool = typer.Option(True, "--json", hidden=True),
) -> None:
    """Return the palace's doc count + path."""
    _ = as_json
    from ..retrieval.palace import stats
    typer.echo(json.dumps(stats(), default=str))


@research_app.command("palace-model-status")
def cmd_research_palace_model_status() -> None:
    """Report whether the semantic-search ONNX model has been downloaded.
    Returns {installed, ready, archive_bytes, expected_bytes, cache_dir}."""
    import sys as _sys
    from ..retrieval.palace import model_status
    typer.echo(json.dumps(model_status(), default=str))
    _sys.stdout.flush()


@research_app.command("gap-discovery")
def cmd_gap_discovery(
    topic: str = typer.Option(..., "--topic", "-t"),
    provider: str | None = typer.Option(None, "--provider"),
    chunk_size: int | None = typer.Option(None, "--chunk-size"),
    max_workers: int | None = typer.Option(None, "--max-workers"),
    papers_per_painpoint: int = typer.Option(5, "--papers"),
    no_experiments: bool = typer.Option(False, "--no-experiments"),
    as_json: bool = typer.Option(True, "--json/--no-json"),
) -> None:
    """End-to-end: chunked LLM synth → palace cross-source evidence attach
    → science fetch → solutions (why + interventions) → experiment
    proposals. Every step persists to SQLite so Map / Insights / Research
    / Solutions tabs pick up the new nodes."""
    from ..research.gap_discovery import run_gap_discovery

    def _p(msg: str) -> None:
        if not as_json:
            typer.echo(msg)

    out = run_gap_discovery(
        topic=topic, provider=provider,
        chunk_size=chunk_size, max_workers=max_workers,
        papers_per_painpoint=papers_per_painpoint,
        propose_experiments=not no_experiments,
        progress=_p,
    )
    _emit(out, as_json)


@research_app.command("experiments-list")
def cmd_experiments_list(
    topic: str = typer.Option(..., "--topic", "-t"),
    as_json: bool = typer.Option(True, "--json/--no-json"),
) -> None:
    """List persisted experiment proposals for a topic."""
    from ..research.gap_discovery import list_experiments
    _emit({"topic": topic, "experiments": list_experiments(topic)}, as_json)


@research_app.command("persona-view")
def cmd_persona_view(
    topic: str = typer.Option(..., "--topic", "-t"),
    persona: str = typer.Option(..., "--persona",
        help="designer / ceo / cto / cfo / pm / marketer"),
    provider: str | None = typer.Option(None, "--provider"),
    as_json: bool = typer.Option(True, "--json/--no-json"),
) -> None:
    """Re-view existing findings + experiments through a role-specific lens.
    Run `research gap-discovery` first so there's something to re-view."""
    from ..research.gap_discovery import apply_persona
    _emit(apply_persona(topic=topic, persona=persona, provider=provider), as_json)


@research_app.command("palace-warmup")
def cmd_research_palace_warmup() -> None:
    """Download the all-MiniLM-L6-v2 ONNX model (~80 MB, one-time, cached).

    Streams progress as JSON events, one per line:
      {"event":"progress","bytes":N,"total":T,"pct":P}
      {"event":"done","ok":true}               # success
      {"event":"error","ok":false,"error":...} # failure
    """
    import sys as _sys
    from ..retrieval.palace import warmup_model

    def emit(ev: dict) -> None:
        typer.echo(json.dumps(ev, default=str))
        _sys.stdout.flush()

    warmup_model(progress=emit)


@research_app.command("test-llm")
def cmd_research_test_llm(
    provider: Optional[str] = typer.Option(None, "--provider"),
    model: Optional[str] = typer.Option(None, "--model"),
    as_json: bool = typer.Option(False, "--json"),
) -> None:
    """Ping the configured LLM and report latency + reply."""
    from ..research.chat import test_provider

    result = test_provider(provider=provider, model=model)
    if as_json:
        typer.echo(json.dumps(result, default=str))
    else:
        if result.get("ok"):
            typer.echo(f"✓ {result['provider']} · {result['model']} · {result['latency_ms']}ms")
            typer.echo(f"  reply: {result['reply']}")
        else:
            typer.echo(f"✗ {result.get('provider','?')}: {result.get('error','unknown')}")


@research_app.command("list-models")
def cmd_research_list_models(
    provider: str = typer.Option("ollama", "--provider"),
    as_json: bool = typer.Option(False, "--json"),
) -> None:
    """List available models for a provider (currently Ollama only)."""
    from ..research.chat import list_ollama_models

    if provider.lower() != "ollama":
        msg = {"ok": False, "error": f"list-models is only implemented for ollama (got {provider})"}
        typer.echo(json.dumps(msg) if as_json else f"✗ {msg['error']}")
        raise typer.Exit(1)
    result = list_ollama_models()
    if as_json:
        typer.echo(json.dumps(result, default=str))
    else:
        if not result.get("ok"):
            typer.echo(f"✗ Can't reach Ollama at {result.get('url')}: {result.get('error')}")
            return
        for m in result.get("models", []):
            size = f"{m['size_mb']} MB"
            params = f" ({m['param_size']})" if m.get("param_size") else ""
            typer.echo(f"  {m['name']:<50} {size}{params}")


# ── graph subcommands ───────────────────────────────────────────────────────

@graph_app.command("build")
def cmd_graph_build(
    topic: str = typer.Option(..., "--topic", "-t"),
    as_json: bool = typer.Option(False, "--json"),
) -> None:
    """Build structural graph (topic/sub/post/comment/user nodes) — no LLM."""
    from ..graph import build_structural

    r = build_structural(topic)
    _emit(r, as_json)


@graph_app.command("enrich")
def cmd_graph_enrich(
    topic: str = typer.Option(..., "--topic", "-t"),
    provider: Optional[str] = typer.Option(
        None, "--provider",
        help="Override provider (anthropic|openai|openrouter|groq|deepseek|mistral|google|ollama). "
             "Omit to auto-detect from LLM_PROVIDER env or the first configured key.",
    ),
    corpus_limit: int = typer.Option(120, "--limit", "-n"),
    as_json: bool = typer.Option(False, "--json"),
) -> None:
    """Add semantic nodes (painpoints / products / workarounds) via LLM.

    Uses whatever the user configured in Settings. No hardcoded Anthropic fallback.
    """
    from ..graph import enrich_from_llm

    r = enrich_from_llm(topic=topic, provider=provider, corpus_limit=corpus_limit)
    _emit(r, as_json)


@graph_app.command("stats")
def cmd_graph_stats(
    topic: str = typer.Option(..., "--topic", "-t"),
    as_json: bool = typer.Option(False, "--json"),
) -> None:
    """Show node/edge counts per kind for a topic."""
    from ..graph import graph_stats

    _emit(graph_stats(topic), as_json)


@graph_app.command("neighbors")
def cmd_graph_neighbors(
    node_id: str = typer.Argument(..., help='Full node id, e.g. "topic::painpoint::forgetfulness"'),
    topic: str = typer.Option(..., "--topic", "-t"),
    kinds: Optional[str] = typer.Option(None, "--edge-kinds", help="comma-separated edge kinds"),
    direction: str = typer.Option("both", "--direction", help="in|out|both"),
    limit: int = typer.Option(30, "--limit", "-n"),
    as_json: bool = typer.Option(False, "--json"),
) -> None:
    """Show neighbors of a node."""
    from ..graph import neighbors

    kind_list = [k.strip() for k in kinds.split(",")] if kinds else None
    rows = neighbors(topic=topic, node_id=node_id, edge_kinds=kind_list, direction=direction, limit=limit)
    _emit(rows, as_json)


@graph_app.command("export")
def cmd_graph_export(
    topic: str = typer.Option(..., "--topic", "-t"),
    fmt: str = typer.Option("html", "--format", "-f", help="html|json"),
    out: Optional[Path] = typer.Option(None, "--out", "-o"),
) -> None:
    """Export the graph as a shareable HTML (D3 force-graph) or raw JSON."""
    from ..graph import export_graph_html, export_graph_json

    if fmt == "html":
        out = out or Path(f"gap-map-{topic.replace(' ', '-')}.html")
        p = export_graph_html(topic, out)
        console.print(f"[green]wrote[/green] {p}")
        console.print(f"[dim]open in a browser: file://{Path(p).resolve()}[/dim]")
    elif fmt == "json":
        data = export_graph_json(topic)
        if out:
            out.write_text(json.dumps(data, default=str, ensure_ascii=False, indent=2), encoding="utf-8")
            console.print(f"[green]wrote[/green] {out}")
        else:
            typer.echo(json.dumps(data, default=str, ensure_ascii=False, indent=2))
    else:
        console.print(f"[red]unknown format:[/red] {fmt} (use html|json)")
        raise typer.Exit(1)


@research_app.command("corpus")
def cmd_research_corpus(
    topic: str = typer.Option(..., "--topic", "-t"),
    limit: int = typer.Option(50, "--limit", "-n"),
    min_score: int = typer.Option(1, "--min-score"),
    as_json: bool = typer.Option(False, "--json"),
) -> None:
    """Show what's been collected for a topic (from SQLite)."""
    from ..research.collect import corpus_for

    rows = corpus_for(topic, limit=limit, min_score=min_score)
    _emit(rows, as_json, table_title=f"corpus for '{topic}' · {len(rows)} posts")


# ── info ─────────────────────────────────────────────────────────────────────

_EXPECTED_TABLES = (
    "posts", "comments", "fetches", "streams", "stream_hits", "subreddits",
    "users", "topic_posts", "topic_canonicalizations", "topic_prefs",
    "paper_analyses", "graph_nodes", "graph_edges", "trend_series",
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


# ── AG-E: prompt overrides (T3.7) ──────────────────────────────────────
@research_app.command("prompt-list")
def cmd_prompt_list(
    as_json: bool = typer.Option(True, "--json"),
) -> None:
    """List every known extractor/prompt key with override status + previews."""
    from ..research.prompt_store import list_prompts
    _emit({"ok": True, "prompts": list_prompts()}, as_json)


@research_app.command("prompt-get")
def cmd_prompt_get(
    key: str = typer.Option(..., "--key", "-k"),
    as_json: bool = typer.Option(True, "--json"),
) -> None:
    """Return the effective + bundled text for a single prompt key."""
    from ..research.prompt_store import list_prompts
    entry = list_prompts().get(key)
    if entry is None:
        _emit({"ok": False, "error": f"unknown prompt key: {key}"}, as_json)
        return
    _emit({"ok": True, "key": key, **entry}, as_json)


@research_app.command("prompt-set")
def cmd_prompt_set(
    key: str = typer.Option(..., "--key", "-k"),
    file: Optional[Path] = typer.Option(None, "--file", "-f",
        help="Path to a file whose contents become the override. Use --text or --file."),
    text: Optional[str] = typer.Option(None, "--text",
        help="Inline override text (alternative to --file)."),
    as_json: bool = typer.Option(True, "--json"),
) -> None:
    """Set a custom prompt override. Empty text clears the override."""
    from ..research.prompt_store import set_prompt
    payload = ""
    if file is not None:
        payload = Path(file).read_text(encoding="utf-8")
    elif text is not None:
        payload = text
    else:
        _emit({"ok": False, "error": "pass --file or --text"}, as_json)
        return
    _emit(set_prompt(key, payload), as_json)


@research_app.command("prompt-clear")
def cmd_prompt_clear(
    key: str = typer.Option(..., "--key", "-k"),
    as_json: bool = typer.Option(True, "--json"),
) -> None:
    """Clear a prompt override (revert to bundled default)."""
    from ..research.prompt_store import clear_prompt
    _emit(clear_prompt(key), as_json)


# ── AG-E: saved views (T3.1) ──────────────────────────────────────────
@research_app.command("saved-view-create")
def cmd_saved_view_create(
    scope: str = typer.Option("global", "--scope", "-s",
        help="'global' | 'topic:<slug>' | 'product:<id>'"),
    name: str = typer.Option(..., "--name", "-n"),
    filter_json: str = typer.Option("{}", "--filter",
        help="JSON filter spec (see saved_views.apply_filter)."),
    pinned: bool = typer.Option(False, "--pinned"),
    as_json: bool = typer.Option(True, "--json"),
) -> None:
    """Create a saved view (filter preset) scoped to global/topic/product."""
    from ..research.saved_views import create_view
    try:
        flt = json.loads(filter_json) if filter_json else {}
    except Exception as e:
        _emit({"ok": False, "error": f"invalid --filter JSON: {e}"}, as_json)
        return
    _emit({"ok": True, "view": create_view(scope, name, flt, pinned=pinned)}, as_json)


@research_app.command("saved-view-list")
def cmd_saved_view_list(
    scope: Optional[str] = typer.Option(None, "--scope", "-s"),
    as_json: bool = typer.Option(True, "--json"),
) -> None:
    """List saved views, optionally filtered by scope."""
    from ..research.saved_views import list_views
    _emit({"ok": True, "views": list_views(scope=scope)}, as_json)


@research_app.command("saved-view-update")
def cmd_saved_view_update(
    view_id: int = typer.Option(..., "--id"),
    name: Optional[str] = typer.Option(None, "--name", "-n"),
    scope: Optional[str] = typer.Option(None, "--scope", "-s"),
    filter_json: Optional[str] = typer.Option(None, "--filter"),
    pinned: Optional[bool] = typer.Option(None, "--pinned/--unpinned"),
    as_json: bool = typer.Option(True, "--json"),
) -> None:
    """Partially update a saved view. Only supplied fields change."""
    from ..research.saved_views import update_view
    patch: dict = {}
    if name is not None:
        patch["name"] = name
    if scope is not None:
        patch["scope"] = scope
    if filter_json is not None:
        try:
            patch["filter_json"] = json.loads(filter_json)
        except Exception as e:
            _emit({"ok": False, "error": f"invalid --filter JSON: {e}"}, as_json)
            return
    if pinned is not None:
        patch["pinned"] = pinned
    updated = update_view(view_id, **patch)
    if updated is None:
        _emit({"ok": False, "error": f"no such view id: {view_id}"}, as_json)
        return
    _emit({"ok": True, "view": updated}, as_json)


@research_app.command("saved-view-delete")
def cmd_saved_view_delete(
    view_id: int = typer.Option(..., "--id"),
    as_json: bool = typer.Option(True, "--json"),
) -> None:
    """Delete a saved view."""
    from ..research.saved_views import delete_view
    _emit(delete_view(view_id), as_json)


if __name__ == "__main__":
    app()
