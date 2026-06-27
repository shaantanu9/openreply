"""`gapmap reply ...` — OpenReply co-pilot CLI.

Thin Typer surface over `gapmap.reply.*`. Every command supports `--json` so the
Tauri Rust layer (and scripts) can consume structured output, matching the rest of
the CLI.
"""
from __future__ import annotations

import json

import typer

from ..reply import alerts as _alerts
from ..reply import brand as _brand
from ..reply import generate as _gen
from ..reply import geo as _geo
from ..reply import opportunity as _opp
from ..reply import rules as _rules
from ..reply import subreddit as _sub
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
    status: str = typer.Option(None, help="Filter: new/saved/drafted/ready/queued/posted/skipped"),
    limit: int = typer.Option(30),
    min_score: float = typer.Option(0.0, help="Only show opportunities at/above this score"),
    query: str = typer.Option("", help="Text search over title/body/author/sub"),
    sort: str = typer.Option("score", help="score | recent | engagement"),
    offset: int = typer.Option(0, help="Pagination offset"),
    platform: str = typer.Option("", help="Filter by source/platform (e.g. reddit_free, hn, x)"),
    json_: bool = typer.Option(True, "--json/--no-json"),
):
    """List stored opportunities with search, sort, and pagination."""
    q = query or None
    items = _opp.list_opportunities(
        status=status, limit=limit, min_score=min_score,
        query=q, sort=sort, offset=offset, platform=platform or None,
    )
    total = _opp.count_opportunities(status=status, min_score=min_score, query=q)
    _out({"opportunities": items, "total": total, "offset": offset, "limit": limit}, json_)


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


@reply_app.command("set-status")
def set_status_cmd(
    opportunity: str = typer.Option(..., "--opportunity", "-o", help="Opportunity id (from `reply list`)"),
    status: str = typer.Option(..., "--status", help="new|saved|drafted|ready|queued|posted|skipped|snoozed"),
    json_: bool = typer.Option(True, "--json/--no-json"),
):
    """Move an opportunity through its lifecycle (save / dismiss / mark replied)."""
    _out(_opp.set_status(opportunity, status), json_)


@reply_app.command("save-draft")
def save_draft_cmd(
    opportunity: str = typer.Option(..., "--opportunity", "-o", help="Opportunity id"),
    text: str = typer.Option(..., "--text", help="Edited reply text to persist"),
    provider: str = typer.Option(None),
    json_: bool = typer.Option(True, "--json/--no-json"),
):
    """Persist a user-edited reply as a new draft version (+ compliance re-check)."""
    _out(_gen.save_draft(opportunity, text, provider=provider), json_)


@reply_app.command("drafts")
def drafts_cmd(
    opportunity: str = typer.Option(..., "--opportunity", "-o", help="Opportunity id"),
    json_: bool = typer.Option(True, "--json/--no-json"),
):
    """List all draft versions for an opportunity (newest first)."""
    _out({"drafts": _gen.list_drafts(opportunity)}, json_)


@reply_app.command("approve")
def approve_cmd(
    opportunity: str = typer.Option(..., "--opportunity", "-o", help="Opportunity id"),
    json_: bool = typer.Option(True, "--json/--no-json"),
):
    """Approve the current draft → moves the opportunity to `ready`."""
    _out(_opp.approve(opportunity), json_)


@reply_app.command("queue")
def queue_cmd(
    opportunity: str = typer.Option(..., "--opportunity", "-o", help="Opportunity id"),
    at: int = typer.Option(0, "--at", help="Schedule epoch seconds (0 = next cycle)"),
    json_: bool = typer.Option(True, "--json/--no-json"),
):
    """Queue an approved reply for posting (optionally scheduled)."""
    _out(_opp.queue(opportunity, scheduled_at=at or None), json_)


@reply_app.command("snooze")
def snooze_cmd(
    opportunity: str = typer.Option(..., "--opportunity", "-o", help="Opportunity id"),
    hours: float = typer.Option(24.0, "--hours", help="Defer for N hours, then resurface"),
    json_: bool = typer.Option(True, "--json/--no-json"),
):
    """Snooze an opportunity — it auto-resurfaces to `new` after `hours`."""
    _out(_opp.snooze(opportunity, hours=hours), json_)


@reply_app.command("post-due")
def post_due_cmd(
    notify: bool = typer.Option(False, "--notify", help="Fire a desktop reminder for due replies"),
    json_: bool = typer.Option(True, "--json/--no-json"),
):
    """Process queued replies whose schedule is due — auto-post where a write
    account exists, otherwise surface a reminder (used by the scheduler)."""
    from ..reply import poster as _poster
    _out(_poster.process_due(notify=notify), json_)


@reply_app.command("rules")
def rules_cmd(
    sub: str = typer.Option(..., "--sub", help="Subreddit name (no r/)"),
    refresh: bool = typer.Option(False, help="Bypass cache and re-fetch"),
    json_: bool = typer.Option(True, "--json/--no-json"),
):
    """Fetch + cache a subreddit's rules (used for ban-proof compliance)."""
    _out(_rules.fetch_sub_rules(sub, refresh=refresh), json_)


# ---- alerts ---------------------------------------------------------------

@reply_app.command("alert-list")
def alert_list_cmd(json_: bool = typer.Option(True, "--json/--no-json")):
    """List alert rules for the active agent."""
    _out({"alerts": _alerts.list_alerts()}, json_)


@reply_app.command("alert-add")
def alert_add_cmd(
    rule: str = typer.Option(..., help="When to fire, e.g. 'keyword match · buying intent'"),
    channel: str = typer.Option("email", help="email | slack | both"),
    intent_min: str = typer.Option("any", help="any | mid | buying"),
    score_min: float = typer.Option(0.0, help="Fire when opportunity score >= this (0-1)"),
    json_: bool = typer.Option(True, "--json/--no-json"),
):
    """Add an alert rule."""
    _out(_alerts.add_alert(rule, channel=channel, intent_min=intent_min, score_min=score_min), json_)


@reply_app.command("alert-delete")
def alert_delete_cmd(id: str = typer.Argument(...), json_: bool = typer.Option(True, "--json/--no-json")):
    """Delete an alert rule."""
    _out({"deleted": _alerts.delete_alert(id), "id": id}, json_)


# ---- AI visibility (GEO) --------------------------------------------------

@reply_app.command("geo-list")
def geo_list_cmd(json_: bool = typer.Option(True, "--json/--no-json")):
    """List tracked GEO queries + citation rate for the active agent."""
    _out(_geo.list_queries(), json_)


@reply_app.command("geo-add")
def geo_add_cmd(
    query: str = typer.Option(..., help="Query to monitor in Google/LLM answers"),
    surface: str = typer.Option("ChatGPT", help="ChatGPT | Perplexity | Google"),
    json_: bool = typer.Option(True, "--json/--no-json"),
):
    """Track a GEO query."""
    _out(_geo.add_query(query, surface=surface), json_)


@reply_app.command("geo-set")
def geo_set_cmd(
    id: str = typer.Argument(...),
    status: str = typer.Option(..., help="tracking | cited | competitor | absent"),
    json_: bool = typer.Option(True, "--json/--no-json"),
):
    """Set a GEO query's citation status."""
    _out({"ok": _geo.set_status(id, status), "id": id, "status": status}, json_)


@reply_app.command("geo-delete")
def geo_delete_cmd(id: str = typer.Argument(...), json_: bool = typer.Option(True, "--json/--no-json")):
    """Delete a GEO query."""
    _out({"deleted": _geo.delete_query(id), "id": id}, json_)


@reply_app.command("geo-check")
def geo_check_cmd(
    id: str = typer.Argument(..., help="Tracked query id to check"),
    provider: str = typer.Option(None),
    json_: bool = typer.Option(True, "--json/--no-json"),
):
    """Run an automated visibility check on one query via the BYOK provider."""
    _out(_geo.check_query(id, provider=provider), json_)


@reply_app.command("geo-check-all")
def geo_check_all_cmd(
    provider: str = typer.Option(None),
    json_: bool = typer.Option(True, "--json/--no-json"),
):
    """Re-check every tracked query for the active agent."""
    _out(_geo.check_all(provider=provider), json_)


@reply_app.command("geo-history")
def geo_history_cmd(id: str = typer.Argument(...), json_: bool = typer.Option(True, "--json/--no-json")):
    """Past checks for one query (trend)."""
    _out(_geo.query_history(id), json_)


# ---- Analytics ------------------------------------------------------------

@reply_app.command("analytics")
def analytics_cmd(
    days: int = typer.Option(30, help="Time-series window in days"),
    json_: bool = typer.Option(True, "--json/--no-json"),
):
    """Aggregated analytics for the active agent (KPIs, trends, drivers)."""
    from ..reply import analytics as _an
    _out(_an.analytics_summary(days=days), json_)


# ---- Subreddit Intelligence -----------------------------------------------

@reply_app.command("account-status")
def account_status_cmd(json_: bool = typer.Option(True, "--json/--no-json")):
    """Connected Reddit account status (for posting safety)."""
    _out(_sub.account_status(), json_)


@reply_app.command("sub-discover")
def sub_discover_cmd(limit: int = typer.Option(8), json_: bool = typer.Option(True, "--json/--no-json")):
    """Discover relevant subreddits for the active agent."""
    _out(_sub.discover_for_agent(limit=limit), json_)


@reply_app.command("sub-list")
def sub_list_cmd(json_: bool = typer.Option(True, "--json/--no-json")):
    """List the agent's discovered + tracked subreddits."""
    _out(_sub.list_tracked(), json_)


@reply_app.command("sub-intel")
def sub_intel_cmd(
    sub: str = typer.Option(..., "--sub", help="Subreddit name (no r/)"),
    refresh: bool = typer.Option(False, help="Bypass rules cache"),
    json_: bool = typer.Option(True, "--json/--no-json"),
):
    """Full intel for a subreddit: stats, rules, self-promo policy, strictness, best time."""
    _out(_sub.intel(sub, refresh=refresh), json_)


@reply_app.command("sub-track")
def sub_track_cmd(
    sub: str = typer.Option(..., "--sub"),
    off: bool = typer.Option(False, "--off", help="Untrack instead of track"),
    json_: bool = typer.Option(True, "--json/--no-json"),
):
    """Track (or --off untrack) a subreddit for the active agent."""
    _out(_sub.track(sub, on=not off), json_)


@reply_app.command("sub-check")
def sub_check_cmd(
    sub: str = typer.Option(..., "--sub"),
    text: str = typer.Option(..., "--text", help="Draft to check against the sub's rules"),
    json_: bool = typer.Option(True, "--json/--no-json"),
):
    """Check a draft against a subreddit's rules (ban-proof)."""
    _out(_sub.check_draft(sub, text), json_)
