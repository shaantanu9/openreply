"""Autonomous learning loop for an OpenReply agent.

Closes the self-learning cycle the components already support:

    collect (posts)  →  ingest_persona  →  memories (LLM-distilled, with
    evolves_from lineage)  →  embed_and_link (semantic graph edges, automatic)
    →  synthesize_conclusions  →  beliefs  →  knowledge blend  →  content/replies

`ingest_persona` and `synthesize_conclusions` are generators that already dedup
(NOT-EXISTS on un-ingested posts; cluster-signature on conclusions), so calling
`learn_for_agent` repeatedly only learns what's new — no wasted LLM cost when
there's nothing fresh.

Every public function is best-effort: it returns a status dict and never raises,
so a learning hiccup can't break a collect / refresh / status change.
"""
from __future__ import annotations

import time

from . import agent as _agent


def ensure_learning_persona(agent: dict) -> int | None:
    """Return a persona id the agent can learn into. If the agent has no linked
    persona yet, auto-create one from the agent and link it (weight 1), so the
    loop works out-of-the-box. Returns None only if creation fails."""
    aid = agent.get("id")
    if not aid:
        return None
    links = _agent.list_linked_personas(aid)
    if links:
        return int(links[0]["persona_id"])
    # Auto-provision a niche-expert persona for this agent.
    try:
        from ..persona.store import create_persona
        topic = agent.get("topic") or agent.get("name") or "this niche"
        name = f"{agent.get('name') or 'Agent'} — niche brain"
        res = create_persona(
            name=name,
            goal=(f"Become a genuine expert on {topic} so I can write authentic, "
                  f"value-first replies and content for {agent.get('name') or 'the brand'}."),
            lens="niche-expert",
            system_prompt=(agent.get("persona") or "").strip() or None,
            icon="brain",
        )
        if not res.get("ok"):
            # Name collision (persona already exists) — link the existing one.
            from ..persona.store import list_personas
            existing = next((p for p in list_personas() if p["name"] == name), None)
            if not existing:
                return None
            pid = int(existing["id"])
        else:
            pid = int(res["id"])
        _agent.link_persona(aid, pid, weight=1.0)
        return pid
    except Exception:
        return None


def _drain(gen) -> dict:
    """Run a persona generator (ingest / synthesize) to completion and return
    its terminal `done` event (or {} if it errored out)."""
    done: dict = {}
    try:
        for ev in gen:
            if isinstance(ev, dict) and ev.get("event") == "done":
                done = ev
    except Exception as e:
        return {"error": str(e)}
    return done


def learn_for_agent(
    agent_id: str | None = None,
    *,
    ingest_limit: int = 30,
    synthesize: bool = True,
    provider: str | None = None,
    progress=None,
) -> dict:
    """Run one learning pass for an agent across its linked personas:
    ingest new posts → (if new memories) synthesize beliefs. Caps cost via
    `ingest_limit` and the built-in NOT-EXISTS dedup. Never raises."""
    a = _agent.get_agent(agent_id)
    if not a:
        return {"error": "no such agent"}

    pid = ensure_learning_persona(a)
    links = _agent.list_linked_personas(a["id"])
    if not links:
        return {"agent": a["name"], "error": "no learning persona could be provisioned"}

    from ..persona.ingest import ingest_persona
    from ..persona.conclude import synthesize_conclusions

    topic = a.get("topic") or a.get("name")
    per_persona: list[dict] = []
    total_learned = 0
    total_beliefs = 0
    for ln in links:
        ppid = int(ln["persona_id"])
        if progress:
            progress(f"learning · {ln.get('name') or ppid}: reading new posts…")
        ing = _drain(ingest_persona(ppid, topic=topic, limit=ingest_limit, provider=provider))
        kept = int(ing.get("kept", 0) or 0)
        total_learned += kept
        beliefs = 0
        if synthesize and kept > 0:
            if progress:
                progress(f"learning · {ln.get('name') or ppid}: synthesizing beliefs…")
            syn = _drain(synthesize_conclusions(ppid, provider=provider, refresh=True))
            beliefs = int(syn.get("written", 0) or 0) + int(syn.get("refreshed", 0) or 0)
            total_beliefs += beliefs
        per_persona.append({
            "persona_id": ppid, "name": ln.get("name") or "",
            "learned": kept, "beliefs": beliefs,
            "ingest_error": ing.get("error"),
        })

    # Build/refresh the agent's content knowledge graph so the Knowledge page
    # reflects the brain (cheap structural pass; the LLM enrich stays on the
    # explicit "Build brain" action). Best-effort — never breaks a learn pass.
    try:
        from .brain import build_brain_for_agent
        build_brain_for_agent(a["id"], deep=False, provider=provider)
    except Exception:
        pass

    # Stamp the learn time on the agent (best-effort).
    try:
        from .schema import init_reply_schema
        init_reply_schema()["agents"].update(a["id"], {"last_learn_at": int(time.time())})
    except Exception:
        pass

    return {
        "agent": a["name"], "topic": topic,
        "learned": total_learned, "beliefs": total_beliefs,
        "personas": per_persona,
        "message": (f"Learned {total_learned} new lesson(s); "
                    f"{total_beliefs} belief(s) updated." if total_learned
                    else "Up to date — no new posts to learn from."),
    }


def teach_for_agent(
    agent_id: str | None = None,
    *,
    url: str,
    comments_limit: int = 100,
    synthesize: bool = True,
    provider: str | None = None,
    progress=None,
) -> dict:
    """Teach an agent from ONE video — the explicit, user-curated learning path.

    Resolves (or auto-provisions) the agent's learning persona, then feeds it the
    video via :func:`persona.teach.teach_from_video`:

        YouTube  -> yt-dlp auto-captions (subtitles) + transcript + top comments
        other    -> yt-dlp audio -> faster-whisper transcript

    The transcript rows flow through the SAME ingest pipeline `learn_for_agent`
    uses (memories -> embed_and_link -> ChromaDB), and any new memories are
    synthesized into beliefs — so what the agent learns from the video blends
    straight into its replies & content. Never raises.
    """
    a = _agent.get_agent(agent_id)
    if not a:
        return {"error": "no such agent"}
    if not (url or "").strip():
        return {"error": "a video URL is required"}

    pid = ensure_learning_persona(a)
    if not pid:
        return {"agent": a["name"], "error": "no learning persona could be provisioned"}

    from ..persona.teach import teach_from_video

    fetched = {"rows": 0, "comments": 0, "transcript": 0, "description": 0}
    teach_errors: list[str] = []
    done: dict = {}
    video_id = None
    try:
        for ev in teach_from_video(pid, url, comments_limit=comments_limit, provider=provider):
            kind = ev.get("event")
            if kind == "teach:start":
                video_id = ev.get("video_id")
                if progress:
                    progress(f"fetching video {video_id or url}\u2026")
            elif kind == "teach:fetched":
                fetched = {k: int(ev.get(k, 0) or 0) for k in fetched}
                if progress:
                    progress(f"fetched {fetched['rows']} rows ({fetched['transcript']} transcript chunks); learning\u2026")
            elif kind in ("teach:error", "error"):
                teach_errors.append(str(ev.get("error") or "")[:200])
            elif kind == "done":
                done = ev
    except Exception as e:
        return {"agent": a["name"], "video": video_id or url,
                "error": f"teach failed: {e}", "errors": teach_errors}

    kept = int(done.get("kept", 0) or 0)
    beliefs = 0
    if synthesize and kept > 0:
        from ..persona.conclude import synthesize_conclusions
        if progress:
            progress("synthesizing beliefs\u2026")
        syn = _drain(synthesize_conclusions(pid, provider=provider, refresh=True))
        beliefs = int(syn.get("written", 0) or 0) + int(syn.get("refreshed", 0) or 0)

    try:
        from .schema import init_reply_schema
        init_reply_schema()["agents"].update(a["id"], {"last_learn_at": int(time.time())})
    except Exception:
        pass

    if kept:
        msg = f"Learned {kept} lesson(s) from the video; {beliefs} belief(s) updated."
    elif fetched["rows"]:
        msg = "Fetched the video but found nothing new to learn (already known)."
    elif teach_errors:
        msg = "Couldn't learn from this video — " + teach_errors[0]
    else:
        msg = "No transcript/captions available for this video."

    return {
        "agent": a["name"], "persona_id": pid,
        "video": video_id or url, "fetched": fetched,
        "learned": kept, "beliefs": beliefs,
        "errors": teach_errors, "message": msg,
    }


def learning_summary(agent_id: str | None = None) -> dict:
    """Snapshot of what an agent has learned — counts + recent lessons/beliefs —
    for the Learning UI. Never raises."""
    a = _agent.get_agent(agent_id)
    if not a:
        return {"error": "no such agent"}
    links = _agent.list_linked_personas(a["id"])
    from ..persona.store import list_memories
    from ..persona.conclude import list_conclusions

    memories: list[dict] = []
    beliefs: list[dict] = []
    for ln in links:
        ppid = int(ln["persona_id"])
        try:
            memories += [dict(m, _persona=ln.get("name")) for m in list_memories(ppid, limit=200)]
        except Exception:
            pass
        try:
            beliefs += [dict(b, _persona=ln.get("name")) for b in list_conclusions(ppid, limit=50)]
        except Exception:
            pass

    fb = {}
    try:
        from .feedback import feedback_counts
        fb = feedback_counts(a["id"])
    except Exception:
        fb = {}

    def _recent(rows, key, n=6):
        rows = sorted(rows, key=lambda r: r.get("created_at") or "", reverse=True)
        return [{"text": str(r.get(key) or "")[:240], "persona": r.get("_persona") or ""}
                for r in rows[:n] if r.get(key)]

    return {
        "agent": a["name"], "topic": a.get("topic"),
        "linked_personas": len(links),
        "memories": len(memories), "beliefs": len(beliefs),
        "last_learn_at": a.get("last_learn_at"),
        "feedback": fb,
        "recent_lessons": _recent(memories, "lesson"),
        "recent_beliefs": _recent(beliefs, "statement"),
    }
