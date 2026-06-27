"""`gapmap agent ...` and `gapmap content ...` — OpenReply Agent + content CLI.

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
    persona: str = typer.Option("", help="Background / expertise = the voice"),
    tone: str = typer.Option("helpful, concise, non-salesy"),
    audience: str = typer.Option("", help="Who you're talking to"),
    keywords: str = typer.Option("", help="Comma-separated topics to track"),
    platforms: str = typer.Option("reddit_free", help="Comma-separated source keys"),
    cadence: str = typer.Option("off", help="Knowledge refresh: off | daily | weekly"),
    json_: bool = typer.Option(True, "--json/--no-json"),
):
    """Create a new agent (becomes the active agent)."""
    a = _agent.create_agent(
        name=name, brand=brand, niche=niche, persona=persona, tone=tone,
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
    _out(_agent.get_agent(id) or {"error": "no agent — run `gapmap agent create`"}, json_)


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
    persona: str = typer.Option(None), tone: str = typer.Option(None),
    audience: str = typer.Option(None), keywords: str = typer.Option(None),
    platforms: str = typer.Option(None), cadence: str = typer.Option(None),
    json_: bool = typer.Option(True, "--json/--no-json"),
):
    """Update fields on an agent."""
    aid = id or _agent.active_id()
    a = _agent.update_agent(
        aid, name=name, niche=niche, persona=persona, tone=tone, audience=audience,
        keywords=_csv(keywords) if keywords is not None else None,
        platforms=_csv(platforms) if platforms is not None else None,
        refresh_cadence=cadence,
    )
    _out(a or {"error": "no such agent"}, json_)


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
        _out({"error": "no agent — run `gapmap agent create`"}, json_)
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
