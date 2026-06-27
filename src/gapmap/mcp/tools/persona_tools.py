"""Persona sub-server — single-lens learning agents exposed as MCP tools.

Mounted into the main server without a namespace prefix so all tools
keep the `gapmap_persona_*` naming convention consistent with the rest
of the surface.
"""
from __future__ import annotations

import concurrent.futures as _fut
from typing import Any

from fastmcp import FastMCP

persona_server = FastMCP("PersonaTools")

_TIMEOUT_S = 90.0


def _run(fn, *, timeout: float = _TIMEOUT_S, args=(), kwargs=None):
    """Run fn on a thread; return result or a structured timeout dict."""
    kwargs = kwargs or {}
    with _fut.ThreadPoolExecutor(max_workers=1) as ex:
        fut = ex.submit(fn, *args, **kwargs)
        try:
            return fut.result(timeout=timeout)
        except _fut.TimeoutError:
            return {
                "ok": False,
                "timed_out": True,
                "timeout_seconds": timeout,
                "error": f"Tool exceeded {timeout:.0f}s ceiling.",
            }


def _drain_generator(gen) -> dict:
    """Drain an Iterator[dict] into a summary dict."""
    events: list[dict] = []
    done: dict | None = None
    try:
        for ev in gen:
            events.append(ev)
            if ev.get("event") == "done":
                done = ev
    except Exception as e:
        events.append({"event": "error", "error": str(e)[:300]})
    if done:
        return {**done, "ok": True, "events": events}
    # Fallback summary from events
    errors = [e for e in events if e.get("event") == "error"]
    return {
        "ok": not errors,
        "events": events,
        "error": errors[-1].get("error") if errors else None,
    }


# ── CRUD ──────────────────────────────────────────────────────────────


@persona_server.tool()
def gapmap_persona_create(
    name: str,
    goal: str,
    lens: str,
    system_prompt: str | None = None,
    color: str | None = None,
    icon: str | None = None,
) -> dict:
    """Create a new persona (single-lens learning agent).

    A persona reads posts through its `lens` and distills lessons into
    `persona_memories`. Use `gapmap_persona_ingest` to run it over
    collected posts.

    Returns `{ok, id, name}` or `{ok:false, error}`.
    """
    from ...persona.store import create_persona
    return create_persona(
        name=name, goal=goal, lens=lens,
        system_prompt=system_prompt, color=color, icon=icon,
    )


@persona_server.tool()
def gapmap_persona_list(active_only: bool = False) -> list[dict]:
    """List all personas with their memory/conclusion stats.

    Returns `[{id, name, goal, lens, active, stats: {memories, conclusions}}, ...]`.
    """
    from ...persona.store import list_personas
    return list_personas(active_only=active_only)


@persona_server.tool()
def gapmap_persona_get(persona_id: int) -> dict | None:
    """Get a single persona by ID including its stats.

    Returns the persona dict or null if not found.
    """
    from ...persona.store import get_persona
    return get_persona(persona_id)


@persona_server.tool()
def gapmap_persona_update(
    persona_id: int,
    name: str | None = None,
    goal: str | None = None,
    lens: str | None = None,
    system_prompt: str | None = None,
    color: str | None = None,
    icon: str | None = None,
    active: bool | None = None,
) -> dict:
    """Update fields on an existing persona.

    Only supplied (non-null) fields are changed. Returns `{ok, id}`.
    """
    from ...persona.store import update_persona
    kwargs: dict[str, Any] = {}
    if name is not None: kwargs["name"] = name
    if goal is not None: kwargs["goal"] = goal
    if lens is not None: kwargs["lens"] = lens
    if system_prompt is not None: kwargs["system_prompt"] = system_prompt
    if color is not None: kwargs["color"] = color
    if icon is not None: kwargs["icon"] = icon
    if active is not None: kwargs["active"] = active
    return update_persona(persona_id, **kwargs)


@persona_server.tool()
def gapmap_persona_delete(persona_id: int) -> dict:
    """Delete a persona and all its memories, edges, and conclusions.

    Returns `{ok, id}`.
    """
    from ...persona.store import delete_persona
    return delete_persona(persona_id)


# ── Memory listing ────────────────────────────────────────────────────


@persona_server.tool()
def gapmap_persona_memories(
    persona_id: int,
    topic: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[dict]:
    """List lessons a persona has distilled from posts.

    Optionally filter by `topic`. Returns `[{id, topic, lesson, excerpt,
    importance, tags, created_at}, ...]` sorted by importance desc.
    """
    from ...persona.store import list_memories
    return list_memories(persona_id, topic=topic, limit=limit, offset=offset)


# ── Ingest ────────────────────────────────────────────────────────────


@persona_server.tool()
def gapmap_persona_ingest(
    persona_id: int,
    topic: str | None = None,
    limit: int = 50,
    provider: str | None = None,
) -> dict:
    """Run the persona's LLM distillation over collected posts.

    Reads posts for `topic` (or all topics if None), filters by the
    persona's lens, and writes new lessons to `persona_memories`. Skips
    posts the persona already processed (idempotent).

    Returns `{ok, kept, dropped, errors, events[]}`.
    Use `gapmap_persona_memories` to read the resulting lessons.
    """
    from ...persona.ingest import ingest_persona

    def _run_ingest():
        return _drain_generator(
            ingest_persona(persona_id, topic=topic, limit=limit, provider=provider)
        )

    res = _run(_run_ingest)
    res.setdefault("persona_id", persona_id)
    return res


# ── Chat ──────────────────────────────────────────────────────────────


@persona_server.tool()
def gapmap_persona_chat(
    persona_id: int,
    question: str,
    k: int = 8,
    provider: str | None = None,
) -> dict:
    """Ask a persona a question. It answers from its own memories only.

    Returns `{ok, answer, citations: [{memory_id, lesson, excerpt}]}`.
    The persona cites specific memories rather than hallucinating —
    if its memories don't cover the question, it says so.
    """
    from ...persona.chat import chat_persona
    return _run(chat_persona, kwargs={
        "persona_id": persona_id, "question": question,
        "k": k, "provider": provider,
    })


# ── Conclusions ───────────────────────────────────────────────────────


@persona_server.tool()
def gapmap_persona_conclusions_build(
    persona_id: int,
    provider: str | None = None,
    refresh: bool = True,
) -> dict:
    """Synthesize (or refresh) high-confidence conclusions for a persona.

    Clusters the persona's memories by semantic similarity, runs one
    LLM call per cluster to produce a generalised belief statement with
    a confidence score, and persists to `persona_conclusions`.

    Returns `{ok, written, refreshed, skipped, errors, events[]}`.
    Use `gapmap_persona_conclusions_get` for cached reads.
    """
    from ...persona.conclude import synthesize_conclusions

    def _run_conclude():
        return _drain_generator(
            synthesize_conclusions(persona_id, provider=provider, refresh=refresh)
        )

    res = _run(_run_conclude)
    res.setdefault("persona_id", persona_id)
    return res


@persona_server.tool()
def gapmap_persona_conclusions_get(
    persona_id: int,
    limit: int = 50,
) -> list[dict]:
    """Read cached conclusions for a persona.

    Returns `[{id, statement, confidence, evidence: [memory_ids],
    created_at}]` sorted by confidence desc.
    Call `gapmap_persona_conclusions_build` first if the list is empty.
    """
    from ...persona.conclude import list_conclusions
    return list_conclusions(persona_id, limit=limit)


# ── Memory graph ──────────────────────────────────────────────────────


@persona_server.tool()
def gapmap_persona_graph(
    persona_id: int,
    edge_limit: int = 500,
) -> dict:
    """Dump a persona's memory→memory similarity graph.

    Returns `{nodes: [{id, topic, lesson, importance}], edges:
    [{from_memory_id, to_memory_id, weight}]}`. Edges are built from
    embedding similarity between distilled lessons.
    Run `gapmap_persona_graph_backfill` first if the graph looks sparse.
    """
    from ...persona.graph import graph_payload
    return {"ok": True, "graph": graph_payload(persona_id, edge_limit=edge_limit)}


@persona_server.tool()
def gapmap_persona_graph_backfill(persona_id: int) -> dict:
    """Re-embed every memory and recompute the full edge graph from scratch.

    Use after bulk ingest, or when embeddings/edges are stale. Returns
    `{ok, embedded, edges}`.
    """
    from ...persona.graph import backfill_persona
    return _run(backfill_persona, args=(persona_id,))


# ── Teach from YouTube ────────────────────────────────────────────────


@persona_server.tool()
def gapmap_persona_teach_youtube(
    persona_id: int,
    url_or_id: str,
    comments_limit: int = 100,
    provider: str | None = None,
) -> dict:
    """Teach a persona from a single YouTube video.

    Fetches the video's description, transcript, and top comments, then
    runs the persona's distillation over them — new lessons land in
    `persona_memories`. `url_or_id` accepts a full URL or 11-char id.

    Returns `{ok, kept, dropped, errors, events[]}`.
    """
    from ...persona.teach import teach_from_youtube

    def _run_teach():
        return _drain_generator(
            teach_from_youtube(
                persona_id, url_or_id,
                comments_limit=comments_limit, provider=provider,
            )
        )

    res = _run(_run_teach)
    res.setdefault("persona_id", persona_id)
    return res


# ── Peer learning (persona-of-personas) ───────────────────────────────


@persona_server.tool()
def gapmap_persona_ingest_peers(
    persona_id: int,
    limit: int = 50,
    provider: str | None = None,
) -> dict:
    """Distill other personas' conclusions through this persona's lens.

    Reads every OTHER active persona's conclusions and runs the
    receiver's filter+distill over them — output memories are
    meta-insights (this lens applied to a peer's belief).

    Returns `{ok, kept, dropped, errors, events[]}`.
    """
    from ...persona.ingest import ingest_from_peers

    def _run_peers():
        return _drain_generator(
            ingest_from_peers(persona_id, limit=limit, provider=provider)
        )

    res = _run(_run_peers)
    res.setdefault("persona_id", persona_id)
    return res


# ── Cross-persona sharing ─────────────────────────────────────────────


@persona_server.tool()
def gapmap_persona_share(
    from_persona_id: int,
    memory_id: int,
    to_persona_id: int,
    provider: str | None = None,
) -> dict:
    """Re-frame one persona's memory through another persona's lens.

    The receiver re-interprets the donor's lesson; if it contradicts the
    receiver's lens the share is rejected and logged (see
    `gapmap_persona_rejections`).

    Returns `{ok, new_memory_id, lesson, importance}` or
    `{ok:false, error, existing_lesson?}`.
    """
    from ...persona.share import share_memory
    return _run(share_memory, args=(from_persona_id, memory_id, to_persona_id),
                kwargs={"provider": provider})


@persona_server.tool()
def gapmap_persona_rejections(
    persona_id: int,
    direction: str = "involving",
    limit: int = 50,
) -> list[dict]:
    """List share-rejections involving a persona (lens contradictions).

    `direction` is `involving` | `as_donor` | `as_receiver`. Each row
    records why a peer's memory was rejected by a receiving lens.
    Returns `[{id, from_name, from_lens, to_name, to_lens, donor_lesson,
    reason, created_at}, ...]`.
    """
    from ...persona.share import list_rejections
    return list_rejections(persona_id, direction=direction, limit=limit)


# ── Agent ↔ Persona links (blend a persona's knowledge into replies) ──


@persona_server.tool()
def gapmap_agent_link_persona(
    agent_id: str,
    persona_id: int,
    weight: float = 1.0,
) -> dict:
    """Link a learning persona to a product/brand agent.

    After linking, the agent's reply + content blend draws on that persona's
    own beliefs (conclusions), memories, and semantic graph — weighted by
    `weight` for proportional slot allocation across multiple linked personas.
    Returns `{linked, agent_id, persona_id, weight}` or `{error}`.
    """
    from ...reply.agent import link_persona
    return link_persona(agent_id, persona_id, weight=weight)


@persona_server.tool()
def gapmap_agent_unlink_persona(agent_id: str, persona_id: int) -> dict:
    """Remove a persona link from an agent. Returns `{unlinked, ...}`."""
    from ...reply.agent import unlink_persona
    return unlink_persona(agent_id, persona_id)


@persona_server.tool()
def gapmap_agent_personas(agent_id: str) -> dict:
    """List personas linked to an agent.

    Returns `{agent_id, personas: [{persona_id, weight, name, lens}]}`.
    """
    from ...reply.agent import list_linked_personas
    return {"agent_id": agent_id, "personas": list_linked_personas(agent_id)}
