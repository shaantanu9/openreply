"""`openreply agent ...` and `openreply content ...` — OpenReply Agent + content CLI.

An Agent is a brand/niche persona with its own knowledge scope. These commands
manage agents and generate content (posts/threads/scripts/articles) from an agent's
live knowledge. All commands support `--json` for the Tauri layer.
"""
from __future__ import annotations

import json

import typer

from ..reply import agent as _agent
from ..reply import content as _content

agent_app = typer.Typer(help="OpenReply Agents (personas): create / list / use / refresh.")
content_app = typer.Typer(
    help="OpenReply content: posts / threads / shorts / youtube / articles / follow-ups."
)


def _out(obj, as_json: bool) -> None:
    typer.echo(json.dumps(obj, default=str, indent=2) if as_json else obj)


def _csv(s: str) -> list[str]:
    return [x.strip() for x in (s or "").split(",") if x.strip()]


# ---- agent ----------------------------------------------------------------

@agent_app.command("create")
def create_cmd(
    name: str = typer.Option(..., help="Agent / persona name"),
    brand: str = typer.Option("", help="Brand or product (defaults to name)"),
    niche: str = typer.Option("", help="The niche / space this agent operates in"),
    website: str = typer.Option("", help="Brand website/domain (for AI-visibility citation detection)"),
    goal: str = typer.Option("", help="Why this agent exists / what to grow (drives drafts + growth plan)"),
    product: str = typer.Option("", help="What you offer — the value the agent can genuinely recommend"),
    persona: str = typer.Option("", help="Background / expertise = the voice"),
    tone: str = typer.Option("helpful, concise, non-salesy"),
    audience: str = typer.Option("", help="Who you're talking to"),
    keywords: str = typer.Option("", help="Comma-separated topics to track"),
    platforms: str = typer.Option("", help="Comma-separated source keys (blank = sensible multi-source default)"),
    cadence: str = typer.Option("off", help="Knowledge refresh: off | daily | weekly"),
    json_: bool = typer.Option(True, "--json/--no-json"),
):
    """Create a new agent (becomes the active agent)."""
    a = _agent.create_agent(
        name=name, brand=brand, niche=niche, website=website, goal=goal, product=product,
        persona=persona, tone=tone,
        audience=audience, keywords=_csv(keywords) or None,
        platforms=_csv(platforms) or None, refresh_cadence=cadence,
    )
    _out(a, json_)


@agent_app.command("list")
def list_cmd(json_: bool = typer.Option(True, "--json/--no-json")):
    """List all agents (active flagged)."""
    _out({"agents": _agent.list_agents()}, json_)


@agent_app.command("get")
def get_cmd(id: str = typer.Option(None, help="Agent id (default: active)"), json_: bool = typer.Option(True, "--json/--no-json")):
    """Show an agent (default: the active one)."""
    _out(_agent.get_agent(id) or {"error": "no agent — run `openreply agent create`"}, json_)


@agent_app.command("use")
def use_cmd(id: str = typer.Argument(..., help="Agent id to make active"), json_: bool = typer.Option(True, "--json/--no-json")):
    """Switch the active agent."""
    if not _agent.get_agent(id):
        _out({"error": f"no agent '{id}'"}, json_)
        raise typer.Exit(1)
    _agent.set_active(id)
    _out(_agent.get_agent(id), json_)


@agent_app.command("update")
def update_cmd(
    id: str = typer.Option(None, help="Agent id (default: active)"),
    name: str = typer.Option(None), niche: str = typer.Option(None),
    website: str = typer.Option(None), goal: str = typer.Option(None), product: str = typer.Option(None),
    persona: str = typer.Option(None), tone: str = typer.Option(None),
    audience: str = typer.Option(None), keywords: str = typer.Option(None),
    platforms: str = typer.Option(None), cadence: str = typer.Option(None),
    style_rules: str = typer.Option(None, "--style-rules",
                                    help="Free-text writing-style rules (the agent's voice)"),
    json_: bool = typer.Option(True, "--json/--no-json"),
):
    """Update fields on an agent."""
    aid = id or _agent.active_id()
    a = _agent.update_agent(
        aid, name=name, niche=niche, website=website, goal=goal, product=product,
        persona=persona, tone=tone, audience=audience, style_rules=style_rules,
        keywords=_csv(keywords) if keywords is not None else None,
        platforms=_csv(platforms) if platforms is not None else None,
        refresh_cadence=cadence,
    )
    _out(a or {"error": "no such agent"}, json_)


@agent_app.command("style-get")
def style_get_cmd(json_: bool = typer.Option(True, "--json/--no-json")):
    """Get the global writing-style rules (the default applied to every agent)."""
    _out({"style_rules": _agent.get_global_style_rules()}, json_)


@agent_app.command("style-set")
def style_set_cmd(
    text: str = typer.Option("", "--text", help="Global writing-style rules"),
    json_: bool = typer.Option(True, "--json/--no-json"),
):
    """Set the global writing-style rules (used when an agent has no own rules)."""
    saved = _agent.set_global_style_rules(text)
    _out({"ok": True, "style_rules": saved}, json_)


@agent_app.command("delete")
def delete_cmd(id: str = typer.Argument(...), json_: bool = typer.Option(True, "--json/--no-json")):
    """Delete an agent."""
    _out({"deleted": _agent.delete_agent(id), "id": id}, json_)


@agent_app.command("knowledge")
def knowledge_cmd(id: str = typer.Option(None), json_: bool = typer.Option(True, "--json/--no-json")):
    """Knowledge summary (posts / graph nodes / findings) for an agent."""
    _out(_agent.knowledge_summary(id), json_)


@agent_app.command("learn")
def learn_cmd(
    id: str = typer.Option(None, help="Agent id (default: active)"),
    limit: int = typer.Option(30, help="Max new posts to ingest this pass"),
    no_synthesize: bool = typer.Option(False, "--no-synthesize", help="Ingest only; skip belief synthesis"),
    provider: str = typer.Option(None, help="Pin an LLM provider (else auto-resolved)"),
    json_: bool = typer.Option(True, "--json/--no-json"),
):
    """Run one learning pass: distill new posts into memories + beliefs."""
    from ..reply.learn import learn_for_agent
    _out(learn_for_agent(id, ingest_limit=limit, synthesize=not no_synthesize,
                         provider=provider, progress=lambda m: typer.echo(m, err=True)), json_)


@agent_app.command("learn-status")
def learn_status_cmd(id: str = typer.Option(None), json_: bool = typer.Option(True, "--json/--no-json")):
    """What the agent has learned — memories, beliefs, feedback, recent lessons."""
    from ..reply.learn import learning_summary
    _out(learning_summary(id), json_)


@agent_app.command("corpus")
def corpus_cmd(
    id: str = typer.Option(None, help="Agent id (default: active)"),
    source: str = typer.Option("", help="Filter to one source (hn, gnews, reddit_free, ...)"),
    query: str = typer.Option("", help="Text search over title/body"),
    relevance: str = typer.Option("", help="Filter by relevance: on | off | unchecked"),
    limit: int = typer.Option(60),
    offset: int = typer.Option(0),
    json_: bool = typer.Option(True, "--json/--no-json"),
):
    """Browse the agent's collected multi-source corpus (read & learn from all sources)."""
    from ..reply.library import list_corpus
    _out(list_corpus(id, source=source or None, query=query or None,
                     relevance=relevance or None, limit=limit, offset=offset), json_)


@agent_app.command("corpus-check")
def corpus_check_cmd(
    id: str = typer.Option(None, help="Agent id (default: active)"),
    limit: int = typer.Option(60, help="Max not-yet-checked posts to classify this pass"),
    provider: str = typer.Option(None),
    json_: bool = typer.Option(True, "--json/--no-json"),
):
    """LLM relevance check on fetched corpus posts → tag on-topic / off-topic."""
    from ..reply.relevance import check_relevance
    _out(check_relevance(id, limit=limit, provider=provider), json_)


@agent_app.command("autopilot")
def autopilot_cmd(id: str = typer.Option(None), json_: bool = typer.Option(True, "--json/--no-json")):
    """Get the agent's auto-pilot schedule (daily content + opportunity reply)."""
    from ..reply.scheduler import get_autopilot
    _out(get_autopilot(id), json_)


@agent_app.command("autopilot-set")
def autopilot_set_cmd(
    id: str = typer.Option(None),
    content: bool = typer.Option(None, "--content/--no-content", help="Auto-generate daily content"),
    content_kinds: str = typer.Option(None, help="Comma-separated kinds (post,thread,article,youtube,script)"),
    content_count: int = typer.Option(None, help="Items per run (1-5)"),
    content_cadence: str = typer.Option(None, help="daily | weekly"),
    opportunity: bool = typer.Option(None, "--opportunity/--no-opportunity", help="Auto-draft daily reply"),
    opp_count: int = typer.Option(None, help="Replies to draft per run (1-5)"),
    opp_cadence: str = typer.Option(None, help="daily | weekly"),
    json_: bool = typer.Option(True, "--json/--no-json"),
):
    """Configure the agent's auto-pilot (daily content + opportunity reply)."""
    from ..reply.scheduler import set_autopilot
    c, o = {}, {}
    if content is not None: c["enabled"] = content
    if content_kinds is not None: c["kinds"] = _csv(content_kinds)
    if content_count is not None: c["count"] = content_count
    if content_cadence: c["cadence"] = content_cadence
    if opportunity is not None: o["enabled"] = opportunity
    if opp_count is not None: o["count"] = opp_count
    if opp_cadence: o["cadence"] = opp_cadence
    _out(set_autopilot(id, content=c or None, opportunity=o or None), json_)


@agent_app.command("autopilot-run")
def autopilot_run_cmd(id: str = typer.Option(None), provider: str = typer.Option(None),
                      json_: bool = typer.Option(True, "--json/--no-json")):
    """Run the auto-pilot now (manual trigger — bypasses the daily throttle)."""
    from ..reply.scheduler import run_autopilot_if_due
    _out(run_autopilot_if_due(id, provider=provider, force=True), json_)


@agent_app.command("build-graph")
def build_graph_cmd(
    id: str = typer.Option(None, help="Agent id (default: active)"),
    deep: bool = typer.Option(False, "--deep", help="Also LLM-mine painpoints/wishes/workarounds (slower)"),
    provider: str = typer.Option(None, help="Pin an LLM provider (else auto-resolved)"),
    json_: bool = typer.Option(True, "--json/--no-json"),
):
    """Build the agent's knowledge graph (brain) over its collected content + connections."""
    from ..reply.brain import build_brain_for_agent
    _out(build_brain_for_agent(id, deep=deep, provider=provider,
                               progress=lambda m: typer.echo(m, err=True)), json_)


@agent_app.command("graph")
def graph_cmd(id: str = typer.Option(None), json_: bool = typer.Option(True, "--json/--no-json")):
    """Knowledge-graph overview for the agent: counts by kind, hubs, connections."""
    from ..reply.brain import graph_overview
    _out(graph_overview(id), json_)


@agent_app.command("brain")
def brain_cmd(id: str = typer.Option(None), json_: bool = typer.Option(True, "--json/--no-json")):
    """Unified brain: structural graph + persona memories + beliefs merged into one
    graph + tree (for the Brain visualization)."""
    from ..reply.brain_unified import unified_brain
    _out(unified_brain(id), json_)


@agent_app.command("brain-relink")
def brain_relink_cmd(
    id: str = typer.Option(None),
    no_semantic: bool = typer.Option(False, "--no-semantic", help="Skip embedding cross-links (exact only)"),
    json_: bool = typer.Option(True, "--json/--no-json"),
):
    """(Re)build the cross-links that merge persona brains into the structural graph."""
    from ..reply.brain_unified import relink
    _out(relink(id, semantic=not no_semantic), json_)


@agent_app.command("teach-video")
def teach_video_cmd(
    url: str = typer.Argument(..., help="YouTube/Instagram/video URL (or 11-char YT id)"),
    id: str = typer.Option(None, help="Agent id (default: active)"),
    comments: int = typer.Option(100, "--comments", "-c", help="Top comments to fetch (YouTube only)"),
    provider: str = typer.Option(None, help="Pin an LLM provider (else auto-resolved)"),
    json_: bool = typer.Option(True, "--json/--no-json"),
):
    """Teach the agent from ONE video: yt-dlp captions/transcript -> memories + beliefs."""
    from ..reply.learn import teach_for_agent
    _out(teach_for_agent(id, url=url, comments_limit=comments,
                         provider=provider, progress=lambda m: typer.echo(m, err=True)), json_)


@agent_app.command("watch-add")
def watch_add_cmd(
    handle: str = typer.Argument(..., help="X handle (@naval, naval, or x.com/naval)"),
    id: str = typer.Option(None, help="Agent id (default: active)"),
    note: str = typer.Option("", help="Why you're tracking them"),
    json_: bool = typer.Option(True, "--json/--no-json"),
):
    """Track an X account; its posts feed the agent's corpus + knowledge base."""
    from ..reply.accounts import track_account
    _out(track_account(handle, note=note, agent_id=id), json_)


@agent_app.command("watch-list")
def watch_list_cmd(id: str = typer.Option(None), json_: bool = typer.Option(True, "--json/--no-json")):
    """List the accounts this agent watches."""
    from ..reply.accounts import list_accounts
    _out(list_accounts(agent_id=id), json_)


@agent_app.command("watch-remove")
def watch_remove_cmd(handle: str = typer.Argument(...), id: str = typer.Option(None),
                     json_: bool = typer.Option(True, "--json/--no-json")):
    """Stop watching an account."""
    from ..reply.accounts import untrack_account
    _out(untrack_account(handle, agent_id=id), json_)


@agent_app.command("watch-fetch")
def watch_fetch_cmd(
    handle: str = typer.Option("", help="One handle (blank = all tracked)"),
    id: str = typer.Option(None, help="Agent id (default: active)"),
    limit: int = typer.Option(25),
    learn: bool = typer.Option(False, "--learn", help="Run a learn pass after fetching"),
    json_: bool = typer.Option(True, "--json/--no-json"),
):
    """Pull tracked accounts' recent posts into the corpus (optionally learn)."""
    from ..reply.accounts import fetch_account, fetch_tracked
    res = (fetch_account(handle, limit=limit, agent_id=id, learn=learn) if handle
           else fetch_tracked(limit=limit, agent_id=id, learn=learn))
    _out(res, json_)


@agent_app.command("watch-inbox")
def watch_inbox_cmd(
    handle: str = typer.Argument(..., help="X handle to fetch and save to Inbox"),
    id: str = typer.Option(None, help="Agent id (default: active)"),
    limit: int = typer.Option(25),
    post_id: str = typer.Option("", "--post-id", help="Save only the post with this id (numeric status id)."),
    json_: bool = typer.Option(True, "--json/--no-json"),
):
    """Fetch a tracked X account's recent posts and create Inbox opportunities
    for each so you can reply from the Inbox workspace."""
    from ..reply.accounts import fetch_account
    from ..reply.opportunity import save_posts_to_inbox
    res = fetch_account(handle, limit=limit, agent_id=id, learn=False)
    rows = []
    if res.get("fetched"):
        # Re-fetch full rows from the corpus we just tagged so the opportunity
        # shape has title/body/url/created_utc/etc.
        try:
            from ..core.db import get_db
            from ..reply.agent import active_id, get_agent
            aid = id or active_id() or "default"
            topic = (get_agent(aid) or {}).get("topic") or (get_agent(aid) or {}).get("name")
            if topic:
                db = get_db()
                rows = [dict(r) for r in db.execute(
                    "SELECT p.* FROM posts p JOIN topic_posts tp ON p.id = tp.post_id "
                    "WHERE tp.topic = ? AND tp.source LIKE ? ORDER BY p.created_utc DESC LIMIT ?",
                    [topic, f"watch:x:%{handle}%", limit],
                ).fetchall()]
        except Exception:
            rows = []
    if not rows and res.get("sample"):
        # Fallback: build opportunities from the returned sample.
        rows = res["sample"]
    if post_id:
        # Accept both bare tweet ids and corpus-prefixed "x_<id>" rows.
        target = post_id[2:] if post_id.startswith("x_") else post_id
        rows = [r for r in rows if (
            str(r.get("post_id") or "") == post_id
            or str(r.get("id") or "") == post_id
            or str(r.get("id") or "") == f"x_{target}"
        )]
    inbox_res = save_posts_to_inbox(rows, platform="x")
    _out({"handle": handle, "fetched": res.get("fetched", 0), **inbox_res}, json_)


@agent_app.command("refresh")
def refresh_cmd(
    id: str = typer.Option(None, help="Agent id (default: active)"),
    deep: bool = typer.Option(False, help="Aggressive sweep instead of light"),
    json_: bool = typer.Option(True, "--json/--no-json"),
):
    """Re-fetch the latest niche knowledge (reuses research.collect)."""
    res = _agent.refresh_agent(id, light=not deep, progress=lambda m: typer.echo(m, err=True))
    _out(res, json_)


# ---- persona links --------------------------------------------------------

@agent_app.command("link-persona")
def link_persona_cmd(
    persona_id: int = typer.Argument(..., help="Persona id to link"),
    id: str = typer.Option(None, "--agent", help="Agent id (default: active)"),
    weight: float = typer.Option(1.0, help="Blend weight (proportional slot allocation)"),
    json_: bool = typer.Option(True, "--json/--no-json"),
):
    """Link a learning persona's knowledge (memories + graph + beliefs) into an agent's replies."""
    aid = id or _agent.active_id()
    if not aid:
        _out({"error": "no agent — run `openreply agent create`"}, json_)
        raise typer.Exit(1)
    _out(_agent.link_persona(aid, persona_id, weight=weight), json_)


@agent_app.command("unlink-persona")
def unlink_persona_cmd(
    persona_id: int = typer.Argument(..., help="Persona id to unlink"),
    id: str = typer.Option(None, "--agent", help="Agent id (default: active)"),
    json_: bool = typer.Option(True, "--json/--no-json"),
):
    """Remove a persona link from an agent."""
    aid = id or _agent.active_id()
    _out(_agent.unlink_persona(aid, persona_id), json_)


@agent_app.command("personas")
def personas_cmd(
    id: str = typer.Option(None, "--agent", help="Agent id (default: active)"),
    json_: bool = typer.Option(True, "--json/--no-json"),
):
    """List the personas linked to an agent (with blend weights)."""
    aid = id or _agent.active_id()
    _out({"agent_id": aid, "personas": _agent.list_linked_personas(aid or "")}, json_)


# ---- content --------------------------------------------------------------

@content_app.command("generate")
def gen_cmd(
    kind: str = typer.Argument(
        ..., help="post | thread | script | youtube | article | followup_reply | followup_post"
    ),
    platform: str = typer.Option(None, help="Target platform (default: agent's first)"),
    angle: str = typer.Option("", help="Optional angle/hook to write toward"),
    context_id: str = typer.Option(
        None, "--context-id", help="followup_post: id of the prior draft to build on"
    ),
    context_text: str = typer.Option(
        "", "--context-text", help="followup_reply: thread + the reply to answer (or raw original)"
    ),
    agent_id: str = typer.Option(None, "--agent", help="Agent id (default: active)"),
    provider: str = typer.Option(None),
    json_: bool = typer.Option(True, "--json/--no-json"),
):
    """Generate a content draft from the agent's knowledge."""
    _out(
        _content.generate_content(
            kind, agent_id=agent_id, platform=platform, angle=angle,
            context_id=context_id, context_text=context_text, provider=provider,
        ),
        json_,
    )


@content_app.command("update")
def content_update_cmd(
    content_id: str = typer.Argument(..., help="content_items id to update"),
    body: str = typer.Option(None, "--body", help="New body text"),
    status: str = typer.Option(None, "--status", help="draft | scheduled | posted"),
    scheduled_at: int = typer.Option(None, "--scheduled-at", help="Epoch seconds to schedule for"),
    json_: bool = typer.Option(True, "--json/--no-json"),
):
    """Edit, save, or schedule an existing content draft."""
    _out(
        _content.update_content(
            content_id, body=body, status=status, scheduled_at=scheduled_at
        ),
        json_,
    )


@content_app.command("list")
def content_list_cmd(
    kind: str = typer.Option(None), status: str = typer.Option(None),
    agent_id: str = typer.Option(None, "--agent"), limit: int = typer.Option(30),
    json_: bool = typer.Option(True, "--json/--no-json"),
):
    """List generated content drafts."""
    _out({"content": _content.list_content(agent_id=agent_id, kind=kind, status=status, limit=limit)}, json_)


@content_app.command("delete")
def content_delete_cmd(
    content_id: str = typer.Argument(..., help="content_items id to delete"),
    json_: bool = typer.Option(True, "--json/--no-json"),
):
    """Delete a content draft."""
    _out(_content.delete_content(content_id), json_)
