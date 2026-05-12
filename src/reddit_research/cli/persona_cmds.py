"""Persona CLI commands. Registered into the main `app` from cli/main.py.

Designed as a self-contained module so the entire persona feature can be
toggled by adding/removing the two lines that import + register this Typer
sub-app in main.py.
"""
from __future__ import annotations

import json
import sys
from typing import Optional

import typer

from ..persona import (
    backfill_persona as _backfill,
    chat_persona,
    create_persona as _create,
    delete_persona as _delete,
    get_persona,
    graph_payload,
    ingest_all_personas,
    ingest_persona,
    list_conclusions,
    list_memories,
    list_personas,
    share_memory as _share,
    synthesize_conclusions,
    update_persona as _update,
)

persona_app = typer.Typer(
    help="Persona learning agents — single-lens auto-ingest + chat.",
)


def _emit(obj) -> None:
    """Print JSON line — used for streaming events the sidecar consumes."""
    sys.stdout.write(json.dumps(obj, default=str, ensure_ascii=False) + "\n")
    sys.stdout.flush()


@persona_app.command("list")
def cmd_list(
    active_only: bool = typer.Option(False, "--active-only"),
    as_json: bool = typer.Option(False, "--json"),
):
    """List all personas with memory/edge/conclusion counts."""
    rows = list_personas(active_only=active_only)
    if as_json:
        _emit({"ok": True, "personas": rows})
        return
    if not rows:
        typer.echo("(no personas yet)")
        return
    for p in rows:
        s = p["stats"]
        typer.echo(
            f"#{p['id']} {p['name']:<14} lens={p['lens']:<14} "
            f"mem={s['memories']:>3}  topics={s['topics_seen']:>2}  "
            f"active={'yes' if p['active'] else 'no'}"
        )
        typer.echo(f"    goal: {p['goal']}")


@persona_app.command("create")
def cmd_create(
    name: str = typer.Option(..., "--name", "-n"),
    goal: str = typer.Option(..., "--goal", "-g"),
    lens: str = typer.Option(..., "--lens", "-l"),
    system_prompt: Optional[str] = typer.Option(None, "--system-prompt"),
    color: Optional[str] = typer.Option(None, "--color"),
    icon: Optional[str] = typer.Option(None, "--icon"),
    as_json: bool = typer.Option(False, "--json"),
):
    """Create a new persona."""
    r = _create(name=name, goal=goal, lens=lens, system_prompt=system_prompt,
                color=color, icon=icon)
    if as_json:
        _emit(r)
    elif r.get("ok"):
        typer.echo(f"created persona #{r['id']} '{r['name']}'")
    else:
        typer.echo(f"error: {r.get('error')}", err=True)
        raise typer.Exit(2)


@persona_app.command("delete")
def cmd_delete(
    persona_id: int = typer.Argument(...),
    as_json: bool = typer.Option(False, "--json"),
):
    """Delete a persona AND all its memories/edges/conclusions."""
    r = _delete(persona_id)
    if as_json:
        _emit(r)
    else:
        typer.echo(f"deleted persona #{persona_id}")


@persona_app.command("update")
def cmd_update(
    persona_id: int = typer.Argument(...),
    name: Optional[str] = typer.Option(None, "--name"),
    goal: Optional[str] = typer.Option(None, "--goal"),
    lens: Optional[str] = typer.Option(None, "--lens"),
    system_prompt: Optional[str] = typer.Option(None, "--system-prompt"),
    color: Optional[str] = typer.Option(None, "--color"),
    icon: Optional[str] = typer.Option(None, "--icon"),
    active: Optional[bool] = typer.Option(None, "--active/--inactive"),
    as_json: bool = typer.Option(False, "--json"),
):
    """Update a persona's mutable fields."""
    fields = {
        "name": name, "goal": goal, "lens": lens, "system_prompt": system_prompt,
        "color": color, "icon": icon,
        "active": (1 if active else 0) if active is not None else None,
    }
    r = _update(persona_id, **fields)
    if as_json:
        _emit(r)
    elif r.get("ok"):
        typer.echo(f"updated #{persona_id}")
    else:
        typer.echo(f"error: {r.get('error')}", err=True)
        raise typer.Exit(2)


@persona_app.command("ingest")
def cmd_ingest(
    persona_id: Optional[int] = typer.Option(None, "--persona", "-p",
        help="Specific persona id, or omit to fan out across all active personas."),
    topic: Optional[str] = typer.Option(None, "--topic", "-t",
        help="Limit ingest to one topic. Omit to scan all posts not yet ingested."),
    limit: int = typer.Option(50, "--limit", "-n"),
    provider: Optional[str] = typer.Option(None, "--provider"),
    as_json: bool = typer.Option(False, "--json"),
):
    """Run a persona over candidate posts. Streams NDJSON events on stdout."""
    if persona_id is None:
        stream = ingest_all_personas(topic=topic, limit=limit, provider=provider)
    else:
        stream = ingest_persona(persona_id, topic=topic, limit=limit, provider=provider)
    for ev in stream:
        if as_json:
            _emit(ev)
            continue
        kind = ev.get("event")
        if kind == "start":
            typer.echo(f"[{ev.get('persona_name')}] start — {ev['candidates']} candidates")
        elif kind == "memory":
            typer.echo(f"  ✓ mem#{ev['memory_id']}: {(ev.get('lesson') or '')[:120]}")
        elif kind == "skip":
            typer.echo(f"  · skip: {ev.get('reason')}")
        elif kind == "error":
            typer.echo(f"  ✗ {ev.get('error', '')[:160]}", err=True)
        elif kind == "done":
            typer.echo(
                f"[{ev.get('persona_name')}] done — "
                f"kept={ev['kept']} dropped={ev['dropped']} errors={ev['errors']}"
            )


@persona_app.command("memories")
def cmd_memories(
    persona_id: int = typer.Argument(...),
    topic: Optional[str] = typer.Option(None, "--topic", "-t"),
    limit: int = typer.Option(50, "--limit", "-n"),
    as_json: bool = typer.Option(False, "--json"),
):
    """List a persona's memories (newest first)."""
    rows = list_memories(persona_id, topic=topic, limit=limit)
    if as_json:
        _emit({"ok": True, "memories": rows})
        return
    if not rows:
        typer.echo("(no memories)")
        return
    for m in rows:
        typer.echo(f"#{m['id']} [{m.get('topic') or '—'}] (imp={m.get('importance'):.2f})")
        typer.echo(f"   {m.get('lesson')}")
        if m.get("excerpt"):
            typer.echo(f"   evidence: \"{m['excerpt'][:160]}\"")


@persona_app.command("graph")
def cmd_graph(
    persona_id: int = typer.Argument(...),
    edge_limit: int = typer.Option(500, "--edge-limit"),
    as_json: bool = typer.Option(False, "--json"),
):
    """Dump persona's memory→memory graph as JSON (nodes + edges)."""
    g = graph_payload(persona_id, edge_limit=edge_limit)
    if as_json:
        _emit({"ok": True, "graph": g})
        return
    typer.echo(f"nodes: {len(g['nodes'])}, edges: {len(g['edges'])}")
    for e in g["edges"][:20]:
        typer.echo(f"  {e['from_memory_id']:>3} -- {e['to_memory_id']:<3} "
                   f"(w={e.get('weight') or 0:.3f})")


@persona_app.command("backfill")
def cmd_backfill(
    persona_id: int = typer.Argument(...),
    as_json: bool = typer.Option(False, "--json"),
):
    """Re-embed every memory and recompute the full edge graph from scratch."""
    r = _backfill(persona_id)
    if as_json:
        _emit(r)
    else:
        typer.echo(f"backfill: {r}")


@persona_app.command("conclude")
def cmd_conclude(
    persona_id: int = typer.Argument(...),
    provider: Optional[str] = typer.Option(None, "--provider"),
    no_refresh: bool = typer.Option(False, "--no-refresh",
        help="Skip clusters that already have a conclusion."),
    as_json: bool = typer.Option(False, "--json"),
):
    """Cluster the edge graph + LLM-synthesise one belief per cluster."""
    refresh = not no_refresh
    for ev in synthesize_conclusions(persona_id, provider=provider, refresh=refresh):
        if as_json:
            _emit(ev)
            continue
        kind = ev.get("event")
        if kind == "start":
            typer.echo(f"start — {ev['clusters']} clusters")
        elif kind == "concluded":
            flag = "refreshed" if ev.get("refreshed") else "new"
            typer.echo(f"  ✓ {flag} #{ev['conclusion_id']} "
                       f"(conf={ev['confidence']:.2f}, ev={ev['evidence']}):")
            typer.echo(f"    {ev['statement']}")
        elif kind == "skip":
            typer.echo(f"  · skip {ev.get('reason')}")
        elif kind == "error":
            typer.echo(f"  ✗ {ev.get('error','')[:160]}", err=True)
        elif kind == "done":
            typer.echo(f"done — written={ev['written']} refreshed={ev['refreshed']} "
                       f"skipped={ev['skipped']} errors={ev['errors']}")


@persona_app.command("conclusions")
def cmd_conclusions(
    persona_id: int = typer.Argument(...),
    limit: int = typer.Option(100, "--limit"),
    as_json: bool = typer.Option(False, "--json"),
):
    """List persona conclusions (synthesised beliefs)."""
    rows = list_conclusions(persona_id, limit=limit)
    if as_json:
        _emit({"ok": True, "conclusions": rows})
        return
    if not rows:
        typer.echo("(no conclusions yet — run `persona conclude <id>` first)")
        return
    for c in rows:
        typer.echo(f"#{c['id']}  conf={c['confidence']:.2f}  evidence={c['evidence']}")
        typer.echo(f"   {c['statement']}")


@persona_app.command("share")
def cmd_share(
    from_persona_id: int = typer.Option(..., "--from", "-f"),
    memory_id: int = typer.Option(..., "--memory", "-m"),
    to_persona_id: int = typer.Option(..., "--to", "-t"),
    provider: Optional[str] = typer.Option(None, "--provider"),
    as_json: bool = typer.Option(False, "--json"),
):
    """Re-frame a memory from one persona through another's lens."""
    r = _share(from_persona_id, memory_id, to_persona_id, provider=provider)
    if as_json:
        _emit(r)
        return
    if not r.get("ok"):
        typer.echo(f"error: {r.get('error')}", err=True)
        if r.get("existing_lesson"):
            typer.echo(f"  receiver already had: {r['existing_lesson']}")
        raise typer.Exit(2)
    typer.echo(f"shared mem#{memory_id} from {r['from_persona_name']} → "
               f"{r['to_persona_name']} as mem#{r['new_memory_id']}")
    typer.echo(f"  new lesson: {r['lesson']}")
    if r.get("edges_added"):
        typer.echo(f"  + {r['edges_added']} new edges in receiver's graph")


@persona_app.command("chat")
def cmd_chat(
    persona_id: int = typer.Argument(...),
    question: str = typer.Argument(...),
    k: int = typer.Option(8, "--k", help="Memories to retrieve as context."),
    provider: Optional[str] = typer.Option(None, "--provider"),
    as_json: bool = typer.Option(False, "--json"),
):
    """Ask a persona a question. Answers from its own memories with (M#) citations."""
    r = chat_persona(persona_id, question, k=k, provider=provider)
    if as_json:
        _emit(r)
        return
    if not r.get("ok"):
        typer.echo(f"error: {r.get('error')}", err=True)
        raise typer.Exit(2)
    p = get_persona(persona_id)
    typer.echo(f"--- {p['name']} answers ---\n{r['answer']}\n")
    typer.echo("--- citations ---")
    for c in r.get("citations") or []:
        typer.echo(f"  {c['tag']} mem#{c['memory_id']} (topic={c.get('topic') or '—'})")
        typer.echo(f"     {c.get('lesson', '')[:140]}")
