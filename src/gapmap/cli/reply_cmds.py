"""`gapmap reply ...` — OpenReply co-pilot CLI.

Thin Typer surface over `gapmap.reply.*`. Every command supports `--json` so the
Tauri Rust layer (and scripts) can consume structured output, matching the rest of
the CLI.
"""
from __future__ import annotations

import json

import typer

from ..reply import brand as _brand
from ..reply import generate as _gen
from ..reply import opportunity as _opp
from ..reply import rules as _rules
from ..reply.platforms import PLATFORMS

reply_app = typer.Typer(
    help="OpenReply: find social opportunities → score → draft on-brand replies (you post manually)."
)


def _out(obj, as_json: bool) -> None:
    typer.echo(json.dumps(obj, default=str, indent=2) if as_json else obj)


@reply_app.command("platforms")
def platforms_cmd(json_: bool = typer.Option(True, "--json/--no-json")):
    """List the pickable platforms (engage vs discovery-only)."""
    _out({"platforms": PLATFORMS}, json_)


@reply_app.command("brand-set")
def brand_set(
    name: str = typer.Option("", help="Brand / product name"),
    url: str = typer.Option("", help="Website (for context)"),
    description: str = typer.Option("", help="One line: what you do / who you help"),
    keywords: str = typer.Option("", help="Comma-separated topics to scan for"),
    persona: str = typer.Option("", help="Your background / expertise (the voice)"),
    tone: str = typer.Option("helpful, concise, non-salesy"),
    platforms: str = typer.Option("reddit_free", help="Comma-separated source keys (see `reply platforms`)"),
    json_: bool = typer.Option(True, "--json/--no-json"),
):
    """Create / update the brand profile OpenReply writes as."""
    kws = [k.strip() for k in keywords.split(",") if k.strip()]
    pfs = [p.strip() for p in platforms.split(",") if p.strip()]
    b = _brand.set_brand(
        name=name or None, url=url or None, description=description or None,
        keywords=kws or None, persona=persona or None, tone=tone,
        platforms=pfs or None,
    )
    _out(b, json_)


@reply_app.command("brand-get")
def brand_get(json_: bool = typer.Option(True, "--json/--no-json")):
    """Show the current brand profile."""
    _out(_brand.get_brand() or {"error": "no brand set — run `gapmap reply brand-set`"}, json_)


@reply_app.command("find")
def find_cmd(
    platforms: str = typer.Option("", help="Override brand platforms (comma-separated)"),
    limit: int = typer.Option(15, help="Candidates per platform"),
    no_score: bool = typer.Option(False, "--no-score", help="Skip LLM scoring (faster, ranks 0)"),
    provider: str = typer.Option(None, help="Pin an LLM provider (else auto-resolved)"),
    json_: bool = typer.Option(True, "--json/--no-json"),
):
    """Scan picked platforms for opportunities and score them."""
    pfs = [p.strip() for p in platforms.split(",") if p.strip()] or None
    res = _opp.find_opportunities(
        platforms=pfs, limit_per_platform=limit, score=not no_score,
        provider=provider, progress=lambda m: typer.echo(m, err=True),
    )
    _out(res, json_)


@reply_app.command("list")
def list_cmd(
    status: str = typer.Option(None, help="Filter: new / drafted / posted / skipped"),
    limit: int = typer.Option(30),
    min_score: float = typer.Option(0.0, help="Only show opportunities at/above this score"),
    json_: bool = typer.Option(True, "--json/--no-json"),
):
    """List stored opportunities, highest-scoring first."""
    _out({"opportunities": _opp.list_opportunities(status=status, limit=limit, min_score=min_score)}, json_)


@reply_app.command("draft")
def draft_cmd(
    opportunity: str = typer.Option(..., "--opportunity", "-o", help="Opportunity id (from `reply list`)"),
    provider: str = typer.Option(None),
    tone: str = typer.Option(None, help="Override the brand tone for this draft"),
    json_: bool = typer.Option(True, "--json/--no-json"),
):
    """Generate an on-brand reply draft for an opportunity (+ Reddit rule check)."""
    try:
        result = _gen.generate_reply(opportunity, provider=provider, tone=tone)
    except Exception as e:
        result = {"error": f"could not draft for '{opportunity}': {e}"}
    _out(result, json_)


@reply_app.command("rules")
def rules_cmd(
    sub: str = typer.Option(..., "--sub", help="Subreddit name (no r/)"),
    refresh: bool = typer.Option(False, help="Bypass cache and re-fetch"),
    json_: bool = typer.Option(True, "--json/--no-json"),
):
    """Fetch + cache a subreddit's rules (used for ban-proof compliance)."""
    _out(_rules.fetch_sub_rules(sub, refresh=refresh), json_)
