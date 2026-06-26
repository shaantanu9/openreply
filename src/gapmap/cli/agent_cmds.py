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
content_app = typer.Typer(help="OpenReply content: generate posts / threads / scripts / articles.")


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


@agent_app.command("refresh")
def refresh_cmd(
    id: str = typer.Option(None, help="Agent id (default: active)"),
    deep: bool = typer.Option(False, help="Aggressive sweep instead of light"),
    json_: bool = typer.Option(True, "--json/--no-json"),
):
    """Re-fetch the latest niche knowledge (reuses research.collect)."""
    res = _agent.refresh_agent(id, light=not deep, progress=lambda m: typer.echo(m, err=True))
    _out(res, json_)


# ---- content --------------------------------------------------------------

@content_app.command("generate")
def gen_cmd(
    kind: str = typer.Argument(..., help="post | thread | script | article"),
    platform: str = typer.Option(None, help="Target platform (default: agent's first)"),
    angle: str = typer.Option("", help="Optional angle/hook to write toward"),
    agent_id: str = typer.Option(None, "--agent", help="Agent id (default: active)"),
    provider: str = typer.Option(None),
    json_: bool = typer.Option(True, "--json/--no-json"),
):
    """Generate a content draft from the agent's knowledge."""
    _out(_content.generate_content(kind, agent_id=agent_id, platform=platform, angle=angle, provider=provider), json_)


@content_app.command("list")
def content_list_cmd(
    kind: str = typer.Option(None), status: str = typer.Option(None),
    agent_id: str = typer.Option(None, "--agent"), limit: int = typer.Option(30),
    json_: bool = typer.Option(True, "--json/--no-json"),
):
    """List generated content drafts."""
    _out({"content": _content.list_content(agent_id=agent_id, kind=kind, status=status, limit=limit)}, json_)
