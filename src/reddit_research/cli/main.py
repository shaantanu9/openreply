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


@mcp_app.command("install")
def cmd_mcp_install(
    claude_config: Optional[Path] = typer.Option(
        None, "--config", help="Claude Code config path (default: ~/.claude.json)"
    ),
    project_dir: Optional[Path] = typer.Option(
        None, "--project-dir", help="Absolute path to this repo (default: CWD)"
    ),
    server_name: str = typer.Option("reddit-myind", "--name"),
    force: bool = typer.Option(False, "--force", help="Overwrite an existing entry"),
) -> None:
    """Register reddit-myind's MCP server in Claude Code's config.

    Adds a `mcpServers.<name>` entry that launches via `uv run` from this repo,
    so Claude Code boots the server with the right venv automatically.
    """
    import json

    cfg_path = (claude_config or (Path.home() / ".claude.json")).expanduser()
    proj = (project_dir or Path.cwd()).expanduser().resolve()

    if not (proj / "pyproject.toml").exists():
        console.print(f"[red]{proj} doesn't look like the reddit-myind repo (no pyproject.toml).[/red]")
        raise typer.Exit(1)

    entry = {
        "command": "uv",
        "args": ["--directory", str(proj), "run", "reddit-cli", "mcp", "serve"],
    }

    if cfg_path.exists():
        try:
            cfg = json.loads(cfg_path.read_text(encoding="utf-8") or "{}")
        except json.JSONDecodeError:
            console.print(f"[red]{cfg_path} is not valid JSON.[/red]")
            raise typer.Exit(1)
    else:
        cfg = {}

    servers = cfg.setdefault("mcpServers", {})
    if server_name in servers and not force:
        console.print(
            f"[yellow]{server_name!r} already registered in {cfg_path}.[/yellow] "
            "Use --force to overwrite."
        )
        console.print_json(data=servers[server_name])
        raise typer.Exit(0)

    servers[server_name] = entry
    cfg_path.write_text(json.dumps(cfg, indent=2) + "\n", encoding="utf-8")
    console.print(f"[green]registered[/green] {server_name!r} → {cfg_path}")
    console.print_json(data=entry)
    console.print(
        "\n[dim]Restart Claude Code (or your MCP-capable client) to pick up the new server.[/dim]"
    )


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


@research_app.command("temporal-gaps")
def cmd_research_temporal(
    topic: str = typer.Option(..., "--topic", "-t"),
    provider: Optional[str] = typer.Option(
        None, "--provider",
        help="omit → use Settings → BYOK default (LLM_PROVIDER env)",
    ),
    per_bucket: int = typer.Option(80, "--per-bucket"),
    as_json: bool = typer.Option(False, "--json"),
) -> None:
    """Classify pain points as CHRONIC / EMERGING / FADING via pre/post-May-2025 split."""
    from ..research import find_temporal_gaps

    result = find_temporal_gaps(topic=topic, provider=provider, per_bucket=per_bucket)
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


if __name__ == "__main__":
    app()
