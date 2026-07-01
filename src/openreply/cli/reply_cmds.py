"""`openreply reply ...` — OpenReply co-pilot CLI.

Thin Typer surface over `openreply.reply.*`. Every command supports `--json` so the
Tauri Rust layer (and scripts) can consume structured output, matching the rest of
the CLI.
"""
from __future__ import annotations

import json
from typing import Optional

import typer

from ..reply import alerts as _alerts
from ..reply import brand as _brand
from ..reply import feedback as _fb
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
    _out(_brand.get_brand() or {"error": "no brand set — run `openreply reply brand-set`"}, json_)


@reply_app.command("find")
def find_cmd(
    platforms: str = typer.Option("", help="Override brand platforms (comma-separated)"),
    limit: int = typer.Option(15, help="Candidates per platform"),
    no_score: bool = typer.Option(False, "--no-score", help="Skip LLM scoring (faster, ranks 0)"),
    provider: str = typer.Option(None, help="Pin an LLM provider (else auto-resolved)"),
    stream: bool = typer.Option(False, "--stream", help="Emit NDJSON progress events to stdout (one per line) for the live scan UI"),
    json_: bool = typer.Option(True, "--json/--no-json"),
):
    """Scan picked platforms for opportunities and score them."""
    pfs = [p.strip() for p in platforms.split(",") if p.strip()] or None
    if stream:
        # NDJSON progress to stdout (run_cli_streaming re-emits each line as a
        # `reply_find:progress` Tauri event). The frontend reloads the
        # authoritative list from the DB on `reply_find:done`, so we only stream
        # progress + a final lightweight `result` event — never the full blob.
        def _emit(m):
            try:
                line = json.dumps(m, default=str) if isinstance(m, (dict, list)) \
                    else json.dumps({"event": "log", "msg": str(m)})
                typer.echo(line)
            except Exception:
                pass
        res = _opp.find_opportunities(
            platforms=pfs, limit_per_platform=limit, score=not no_score,
            provider=provider, progress=_emit,
        )
        _emit({"event": "result", "found": res.get("found", 0), "error": res.get("error")})
        return
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
    total = _opp.count_opportunities(status=status, min_score=min_score, query=q, platform=platform or None)
    _out({"opportunities": items, "total": total, "offset": offset, "limit": limit}, json_)


@reply_app.command("source-counts")
def source_counts_cmd(json_: bool = typer.Option(True, "--json/--no-json")):
    """Per-source opportunity + fetched-post counts for the active agent."""
    _out(_opp.source_counts(), json_)


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


@reply_app.command("learn-dismissals")
def learn_dismissals_cmd(
    limit: int = typer.Option(8, help="Max dismissals to reason about per call (bounds LLM cost)"),
    provider: str = typer.Option(None),
    json_: bool = typer.Option(True, "--json/--no-json"),
):
    """Infer a short reason for recently-skipped opportunities that don't have one
    yet — the agent 'learning' from your skips. Batched + capped."""
    from ..reply.agent import active_id
    _out(_fb.learn_pending_dismissals(active_id(), limit=limit, provider=provider or None), json_)


@reply_app.command("set-dismiss-reason")
def set_dismiss_reason_cmd(
    opportunity: str = typer.Option(..., "--opportunity", "-o", help="Dismissed opportunity id"),
    reason: str = typer.Option(..., "--reason", help="Your corrected 'why I skipped this' reason"),
    json_: bool = typer.Option(True, "--json/--no-json"),
):
    """Correct/improve the learned dismiss reason (the strongest teaching signal —
    triggers a playbook re-distill)."""
    _out(_fb.set_dismiss_reason(opportunity, reason), json_)


@reply_app.command("restore")
def restore_cmd(
    opportunity: str = typer.Option(..., "--opportunity", "-o", help="Dismissed opportunity id"),
    json_: bool = typer.Option(True, "--json/--no-json"),
):
    """Un-skip a dismissed opportunity: clears the dismissal (so it's no longer
    suppressed or teaching 'avoid') and moves it back to `new`."""
    _fb.un_dismiss(opportunity)
    _out(_opp.set_status(opportunity, "new"), json_)


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


@reply_app.command("content-due")
def content_due_cmd(
    notify: bool = typer.Option(False, "--notify", help="Fire a desktop reminder for due content"),
    json_: bool = typer.Option(True, "--json/--no-json"),
):
    """Process scheduled content_items whose time is due — auto-post where a
    publisher + creds exist, otherwise surface a Telegram reminder (used by the
    scheduler)."""
    from ..reply import content_poster as _content_poster
    _out(_content_poster.process_due_content(notify=notify), json_)


@reply_app.command("growth-plan")
def growth_plan_cmd(
    id: str = typer.Option(None, help="Agent id (default: active)"),
    provider: str = typer.Option(None),
    json_: bool = typer.Option(True, "--json/--no-json"),
):
    """Generate + save a Reddit-first growth plan from the agent's goal/product."""
    from ..reply import growth as _growth
    _out(_growth.generate_growth_plan(agent_id=id, provider=provider), json_)


@reply_app.command("growth-get")
def growth_get_cmd(
    id: str = typer.Option(None, help="Agent id (default: active)"),
    json_: bool = typer.Option(True, "--json/--no-json"),
):
    """Show the last-saved growth plan for the agent."""
    from ..reply import growth as _growth
    _out(_growth.get_growth_plan(agent_id=id), json_)


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


@reply_app.command("digest")
def digest_cmd(
    id: str = typer.Option(None, help="Agent id (default: active)"),
    rebuild: bool = typer.Option(False, "--rebuild", help="Force a fresh build"),
    no_collect: bool = typer.Option(False, "--no-collect", help="Skip the news fetch"),
    no_learn: bool = typer.Option(False, "--no-learn", help="Skip the corpus→brain learn pass"),
    n: int = typer.Option(40, "--n", help="Max feed items"),
    provider: str = typer.Option(None),
    json_: bool = typer.Option(True, "--json/--no-json"),
):
    """Today's Daily Update digest (goal-framed briefing + categorized feed); builds + caches if missing."""
    from ..reply import digest as _digest
    _out(_digest.build_digest(agent_id=id, rebuild=rebuild,
                              collect_fresh=not no_collect, learn=not no_learn,
                              n=n, provider=provider,
                              progress=lambda m: typer.echo(m, err=True)), json_)


@reply_app.command("digest-quick")
def digest_quick_cmd(
    id: str = typer.Option(None, help="Agent id (default: active)"),
    n: int = typer.Option(40, "--n", help="Max feed items"),
    json_: bool = typer.Option(True, "--json/--no-json"),
):
    """Instant read-only digest for first paint: ranks the feed from the corpus
    already on disk (no news fetch, no learn pass, no LLM). Returns fast so the
    UI paints real content while the full `digest` build runs in the background."""
    from ..reply import digest as _digest
    _out(_digest.quick_digest(agent_id=id, n=n), json_)


@reply_app.command("digest-search")
def digest_search_cmd(
    query: str = typer.Argument(..., help="Search query"),
    id: str = typer.Option(None, help="Agent id (default: active)"),
    n: int = typer.Option(20, "--n", help="Max results"),
    json_: bool = typer.Option(True, "--json/--no-json"),
):
    """On-demand news search over free sources (Google News + DuckDuckGo)."""
    from ..reply import digest as _digest
    _out(_digest.search_news(agent_id=id, query=query, n=n), json_)


# ---- Tasks (knowledge → action → sections) --------------------------------

def _parse_payload(s: str | None) -> dict:
    if not s:
        return {}
    import json as _json
    try:
        v = _json.loads(s)
        return v if isinstance(v, dict) else {}
    except Exception:
        return {}


@reply_app.command("task-list")
def task_list_cmd(
    id: str = typer.Option(None, help="Agent id (default: active)"),
    status: str = typer.Option(None, help="Filter: todo|in_progress|done"),
    json_: bool = typer.Option(True, "--json/--no-json"),
):
    """List the agent's tasks (optionally filtered by status)."""
    from ..reply import tasks as _tasks
    _out(_tasks.list_tasks(agent_id=id, status=status), json_)


@reply_app.command("task-create")
def task_create_cmd(
    title: str = typer.Option(..., help="Task title"),
    kind: str = typer.Option("custom", help="draft_post|draft_article|draft_thread|find_replies|whats_new|custom"),
    target: str = typer.Option("", help="Section to seed: compose|inbox|queue"),
    payload: str = typer.Option(None, help="JSON seed for the target section"),
    source: str = typer.Option("manual", help="graph|digest|manual"),
    source_ref: str = typer.Option("", "--source-ref", help="Origin id (node/digest day)"),
    note: str = typer.Option("", help="Optional note"),
    id: str = typer.Option(None, help="Agent id (default: active)"),
    json_: bool = typer.Option(True, "--json/--no-json"),
):
    """Create a task for the agent."""
    from ..reply import tasks as _tasks
    _out(_tasks.create_task(id, title, kind, target=target,
                            payload=_parse_payload(payload), source=source,
                            source_ref=source_ref, note=note), json_)


@reply_app.command("task-update")
def task_update_cmd(
    task: str = typer.Option(..., help="Task id"),
    status: str = typer.Option(None, help="todo|in_progress|done"),
    title: str = typer.Option(None, help="New title"),
    note: str = typer.Option(None, help="New note"),
    payload: str = typer.Option(None, help="New JSON payload"),
    json_: bool = typer.Option(True, "--json/--no-json"),
):
    """Update a task (status / title / note / payload)."""
    from ..reply import tasks as _tasks
    pl = _parse_payload(payload) if payload is not None else None
    _out(_tasks.update_task(task, status=status, title=title, note=note, payload=pl), json_)


@reply_app.command("task-delete")
def task_delete_cmd(
    task: str = typer.Option(..., help="Task id"),
    json_: bool = typer.Option(True, "--json/--no-json"),
):
    """Delete a task."""
    from ..reply import tasks as _tasks
    _out(_tasks.delete_task(task), json_)


# ---- Subreddit Intelligence -----------------------------------------------

@reply_app.command("account-status")
def account_status_cmd(json_: bool = typer.Option(True, "--json/--no-json")):
    """Connected Reddit account status (for posting safety)."""
    _out(_sub.account_status(), json_)


@reply_app.command("sub-discover")
def sub_discover_cmd(
    limit: int = typer.Option(8),
    auto_track_top: int = typer.Option(0, "--auto-track-top",
                                       help="Auto-link (track) the top N by fit"),
    json_: bool = typer.Option(True, "--json/--no-json"),
):
    """Discover relevant subreddits for the active agent (across all its keywords + niche)."""
    _out(_sub.discover_for_agent(limit=limit, auto_track_top=auto_track_top), json_)


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


# ── Goal + self-evolving playbook + idea synthesis ──────────────────────────

@reply_app.command("goal-set")
def goal_set_cmd(
    objective: str = typer.Option("", "--objective"),
    audience: str = typer.Option("", "--audience"),
    win_signal: str = typer.Option("", "--win-signal"),
    guardrails: str = typer.Option("", "--guardrails"),
    json_: bool = typer.Option(True, "--json/--no-json"),
):
    """Set the active agent's structured goal (drives the self-evolving engine)."""
    from ..reply.agent import get_active_agent, update_agent
    a = get_active_agent()
    if not a:
        _out({"error": "no active agent"}, json_)
        return
    _out(update_agent(a["id"], objective=objective, audience=audience,
                      win_signal=win_signal, guardrails=guardrails), json_)


@reply_app.command("playbook")
def playbook_cmd(json_: bool = typer.Option(True, "--json/--no-json")):
    """Show the active agent's current Goal Playbook."""
    from ..reply.playbook import current_playbook
    _out(current_playbook() or {"playbook": None}, json_)


@reply_app.command("evolve")
def evolve_cmd(json_: bool = typer.Option(True, "--json/--no-json")):
    """Re-distill the active agent's Goal Playbook from memory + feedback."""
    from ..reply.playbook import evolve_playbook
    _out(evolve_playbook(reason="manual"), json_)


@reply_app.command("ideas")
def ideas_cmd(
    n: int = typer.Option(5, "--n"),
    suggest: bool = typer.Option(False, "--suggest"),
    json_: bool = typer.Option(True, "--json/--no-json"),
):
    """List suggested content ideas, or --suggest to synthesize fresh ones."""
    from ..reply.ideas import suggest_ideas, list_ideas
    if suggest:
        _out(suggest_ideas(n=n), json_)
    else:
        _out({"ideas": list_ideas(status="suggested")}, json_)


@reply_app.command("idea-draft")
def idea_draft_cmd(
    idea: str = typer.Option(..., "--idea"),
    kind: str = typer.Option("", "--kind"),
    platform: str = typer.Option("", "--platform"),
    json_: bool = typer.Option(True, "--json/--no-json"),
):
    """Turn a suggested idea into a real content draft."""
    from ..reply.ideas import draft_from_idea
    _out(draft_from_idea(idea, kind=kind or None, platform=platform or None), json_)


@reply_app.command("idea-status")
def idea_status_cmd(
    idea: str = typer.Option(..., "--idea"),
    status: str = typer.Option(..., "--status"),
    json_: bool = typer.Option(True, "--json/--no-json"),
):
    """Mark a suggested idea used / dismissed."""
    from ..reply.ideas import set_idea_status
    _out(set_idea_status(idea, status), json_)


# ───────────────────────── Telegram / Slack notifications ─────────────────────

@reply_app.command("notify-get")
def notify_get_cmd(json_: bool = typer.Option(True, "--json/--no-json")):
    """Current notification config (tokens masked)."""
    from ..reply import notify as _n
    _out(_n.get_config(), json_)


@reply_app.command("notify-set")
def notify_set_cmd(
    enabled: Optional[bool] = typer.Option(None, "--enabled/--disabled"),
    two_way: Optional[bool] = typer.Option(None, "--two-way/--one-way"),
    telegram_token: Optional[str] = typer.Option(None, "--telegram-token"),
    telegram_chat: Optional[str] = typer.Option(None, "--telegram-chat"),
    slack_webhook: Optional[str] = typer.Option(None, "--slack-webhook"),
    min_score: Optional[float] = typer.Option(None, "--min-score"),
    ev_opportunity: Optional[bool] = typer.Option(None, "--opp/--no-opp"),
    ev_article: Optional[bool] = typer.Option(None, "--article/--no-article"),
    ev_reply: Optional[bool] = typer.Option(None, "--reply/--no-reply"),
    ev_content_item: Optional[bool] = typer.Option(None, "--content/--no-content", help="Compose draft notifications"),
    ev_digest: Optional[bool] = typer.Option(None, "--digest/--no-digest"),
    ev_geo: Optional[bool] = typer.Option(None, "--geo/--no-geo"),
    json_: bool = typer.Option(True, "--json/--no-json"),
):
    """Update notification config. Only passed flags change; pass --telegram-token ''
    to clear a secret."""
    from ..reply import notify as _n
    events = {}
    for key, val in (("opportunity", ev_opportunity), ("article", ev_article),
                     ("reply", ev_reply), ("content_item", ev_content_item),
                     ("digest", ev_digest), ("geo", ev_geo)):
        if val is not None:
            events[key] = val
    fields: dict = {}
    if enabled is not None:
        fields["enabled"] = enabled
    if two_way is not None:
        fields["two_way"] = two_way
    if telegram_token is not None:
        fields["telegram_token"] = telegram_token
    if telegram_chat is not None:
        fields["telegram_chat"] = telegram_chat
    if slack_webhook is not None:
        fields["slack_webhook"] = slack_webhook
    if min_score is not None:
        fields["min_score"] = min_score
    if events:
        fields["events"] = events
    _out(_n.set_config(**fields), json_)


@reply_app.command("notify-test")
def notify_test_cmd(json_: bool = typer.Option(True, "--json/--no-json")):
    """Send a test message to every configured channel (ignores on/off toggles)."""
    from ..reply import notify as _n
    _out(_n.send_test(), json_)


@reply_app.command("bot-poll")
def bot_poll_cmd(
    once: bool = typer.Option(False, "--once", help="Drain pending updates and exit"),
    json_: bool = typer.Option(True, "--json/--no-json"),
):
    """Run the two-way Telegram poller (Approve / Regenerate / Skip buttons).
    Long-running — the desktop app spawns this on launch and kills it on quit."""
    from ..reply import bot as _bot
    _out(_bot.poll(once=once), json_)
