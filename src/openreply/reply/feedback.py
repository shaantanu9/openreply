"""Opportunity-lifecycle feedback → learning signal.

The lifecycle the UI drives (Save / Reply / Dismiss) is the cheapest, truest
signal of what's worth engaging. We close it back into the system:

  - **engaged** (Saved or Replied): the underlying post is upserted into `posts`
    and tagged to the agent's topic, so the next learning pass distills it into a
    (high-value) memory — engaging *is* the "learn from this" vote.
  - **dismissed** (Skipped): recorded so `find_opportunities` stops resurfacing
    that exact post.

Best-effort: every function returns a status/value and never raises, so a
feedback write can't break a status change or a find.
"""
from __future__ import annotations

import time

from .schema import init_reply_schema


def _opp(db, opportunity_id: str) -> dict | None:
    try:
        return dict(db["reply_opportunities"].get(opportunity_id))
    except Exception:
        return None


def record_opportunity_feedback(opportunity_id: str, signal: str) -> dict:
    """Record an `engaged` | `dismissed` signal for an opportunity. Never raises."""
    signal = (signal or "").strip().lower()
    if signal not in ("engaged", "dismissed"):
        return {"ok": False, "error": f"bad signal '{signal}'"}
    db = init_reply_schema()
    opp = _opp(db, opportunity_id)
    if not opp:
        return {"ok": False, "error": "no such opportunity"}

    excerpt = (opp.get("body") or opp.get("title") or "")[:500]
    row = {
        "opportunity_id": opportunity_id,
        "agent_id": opp.get("brand_id") or "default",
        "post_id": opp.get("post_id") or "",
        "platform": opp.get("platform") or "",
        "signal": signal,
        "title": (opp.get("title") or "")[:300],
        "excerpt": excerpt,
        "sub": opp.get("sub") or "",
        "author": opp.get("author") or "",
        # reason is filled lazily by `learn_pending_dismissals` (an LLM pass) so
        # a Skip click stays instant — we never block the UI on an LLM round-trip.
        "reason": "",
        "reason_source": "",
        "created_at": int(time.time()),
    }
    try:
        # Preserve any reason already learned/edited for this opportunity across
        # re-signals (e.g. a re-dismiss after an accidental restore).
        old = None
        try:
            old = dict(db["reply_feedback"].get(opportunity_id))
        except Exception:
            old = None
        if old and old.get("reason"):
            row["reason"] = old.get("reason") or ""
            row["reason_source"] = old.get("reason_source") or ""
        db["reply_feedback"].upsert(row, pk="opportunity_id")
    except Exception:
        pass

    if signal == "engaged":
        _seed_corpus(opp)

    # Self-evolution: count feedback toward the agent and, past a threshold,
    # re-distill its Goal Playbook so it learns from what you save / dismiss.
    try:
        from .agent import get_agent
        aid = opp.get("brand_id")
        a = get_agent(aid) if aid else get_agent(None)
        if a:
            n = int(a.get("feedback_since_evolve") or 0) + 1
            db["agents"].update(a["id"], {"feedback_since_evolve": n})
            if n >= 5 and (a.get("objective") or a.get("goal")):
                from .playbook import evolve_playbook
                evolve_playbook(a["id"], reason="feedback")
    except Exception:
        pass

    return {"ok": True, "opportunity_id": opportunity_id, "signal": signal}


def _seed_corpus(opp: dict) -> None:
    """Upsert an engaged opportunity's post into `posts` + tag it to the agent's
    topic so the next ingest learns from it. Idempotent; never raises."""
    try:
        from ..core.db import upsert_posts
        from ..research.collect import _tag_posts
        from .agent import get_agent

        pid = str(opp.get("post_id") or "").strip()
        if not pid:
            return
        platform = opp.get("platform") or "reply"
        now = int(time.time())
        post = {
            "id": pid,
            "sub": opp.get("sub") or platform,
            "source_type": platform,
            "author": opp.get("author") or "",
            "title": opp.get("title") or "",
            "selftext": opp.get("body") or "",
            "url": opp.get("url") or "",
            "score": int(opp.get("engagement") or 0) if str(opp.get("engagement") or "").replace(".", "").isdigit() else 0,
            "upvote_ratio": None,
            "num_comments": 0,
            "created_utc": float(opp.get("found_at") or now),
            "is_self": 1,
            "over_18": 0,
            "flair": "engaged",
            "permalink": opp.get("url") or "",
            "fetched_at": now,
        }
        upsert_posts([post])
        agent = get_agent(opp.get("brand_id"))
        topic = (agent or {}).get("topic")
        if topic:
            _tag_posts(topic, [pid], f"feedback:{platform}")
    except Exception:
        pass


def dismissed_post_ids(agent_id: str | None = None) -> set[str]:
    """Post ids the user dismissed — `find_opportunities` skips these so a
    dismissed conversation never resurfaces. Never raises."""
    db = init_reply_schema()
    try:
        if agent_id:
            rows = db["reply_feedback"].rows_where("signal = ? AND agent_id = ?",
                                                   ["dismissed", agent_id])
        else:
            rows = db["reply_feedback"].rows_where("signal = ?", ["dismissed"])
        return {str(r["post_id"]) for r in rows if r.get("post_id")}
    except Exception:
        return set()


def feedback_counts(agent_id: str | None = None) -> dict:
    """{'engaged': n, 'dismissed': m} for the Learning UI. Never raises."""
    db = init_reply_schema()
    out = {"engaged": 0, "dismissed": 0}
    try:
        where = "agent_id = ?" if agent_id else "1=1"
        args = [agent_id] if agent_id else []
        for r in db["reply_feedback"].rows_where(where, args):
            s = r.get("signal")
            if s in out:
                out[s] += 1
    except Exception:
        pass
    return out


# --- dismiss-reason learning ------------------------------------------------
# A Skip is a one-click "no". The agent then *learns* from it: it infers a short,
# generalized reason ("low-intent price-speculation thread, off-goal") the user
# can see in the Dismissed view and correct. Corrected reasons (reason_source=
# 'user') are the strongest signal — weighted higher when the playbook distills
# and when future opportunities are re-ranked.

_REASON_SYS = (
    "You explain, in ONE short sentence (max 18 words), the GENERALIZABLE reason a "
    "brand's outreach agent was right to skip a social post — a pattern it should "
    "avoid next time, not a description of this one post. Output ONLY the sentence."
)


def infer_dismiss_reason(opp: dict, goal: str = "", provider: str | None = None) -> str:
    """LLM: one-line, pattern-level reason this post was worth skipping. Falls
    back to a cheap heuristic when no LLM is configured. Never raises."""
    title = (opp.get("title") or "").strip()
    body = (opp.get("body") or opp.get("excerpt") or "").strip()[:600]
    sub = (opp.get("sub") or "").strip()
    plat = (opp.get("platform") or "").strip()
    try:
        from ..analyze.providers.base import get_provider
        prompt = (
            (f"The agent's goal: {goal}\n" if goal else "")
            + f"Skipped post — platform={plat} community={sub or '-'}\n"
            + f"Title: {title}\nBody: {body or '(none)'}\n\n"
            + "Why should the agent avoid posts like this going forward?"
        )
        out = get_provider(provider).complete(
            prompt, system=_REASON_SYS, max_tokens=60, temperature=0.2)
        out = (out or "").strip().strip('"').split("\n")[0][:200]
        if out:
            return out
    except Exception:
        pass
    # Heuristic fallback — still gives the user something to edit.
    where = f" in {sub}" if sub else (f" on {plat}" if plat else "")
    return f"Off-goal or low-intent conversation{where}."


def learn_pending_dismissals(agent_id: str | None = None, limit: int = 8,
                             provider: str | None = None) -> dict:
    """Fill in inferred reasons for dismissed rows that don't have one yet — the
    agent 'learning' from recent skips. Batched + capped so a Dismissed-view open
    costs at most `limit` LLM calls. Never raises."""
    db = init_reply_schema()
    goal = ""
    try:
        from .agent import get_agent
        a = get_agent(agent_id)
        if a:
            goal = (a.get("objective") or a.get("goal") or "").strip()
    except Exception:
        a = None
    learned = 0
    try:
        if agent_id:
            rows = db["reply_feedback"].rows_where(
                "signal = ? AND agent_id = ? AND (reason IS NULL OR reason = '')",
                ["dismissed", agent_id], order_by="created_at desc", limit=limit)
        else:
            rows = db["reply_feedback"].rows_where(
                "signal = ? AND (reason IS NULL OR reason = '')",
                ["dismissed"], order_by="created_at desc", limit=limit)
        for r in list(rows):
            reason = infer_dismiss_reason(
                {"title": r.get("title"), "body": r.get("excerpt"),
                 "sub": r.get("sub"), "platform": r.get("platform")},
                goal=goal, provider=provider)
            try:
                db["reply_feedback"].update(
                    r["opportunity_id"],
                    {"reason": reason, "reason_source": "inferred"})
                learned += 1
            except Exception:
                pass
    except Exception:
        pass
    return {"ok": True, "learned": learned}


def set_dismiss_reason(opportunity_id: str, reason: str) -> dict:
    """User corrects/improves the learned reason → the strongest teaching signal.
    Recorded as reason_source='user' and nudges the agent toward re-evolving its
    playbook. Never raises."""
    reason = (reason or "").strip()[:300]
    db = init_reply_schema()
    try:
        db["reply_feedback"].update(
            opportunity_id, {"reason": reason, "reason_source": "user"})
    except Exception as e:
        return {"ok": False, "error": f"no dismissal '{opportunity_id}': {e}"}
    # A human-corrected reason is worth re-distilling the playbook sooner.
    try:
        row = dict(db["reply_feedback"].get(opportunity_id))
        from .agent import get_agent
        a = get_agent(row.get("agent_id"))
        if a and (a.get("objective") or a.get("goal")):
            from .playbook import evolve_playbook
            evolve_playbook(a["id"], reason="reason_edit")
    except Exception:
        pass
    return {"ok": True, "opportunity_id": opportunity_id, "reason": reason}


def un_dismiss(opportunity_id: str) -> dict:
    """Undo a dismissal — drops the feedback row so the post is no longer
    suppressed from finds and no longer teaches 'avoid'. Used by Restore. Never
    raises."""
    db = init_reply_schema()
    try:
        db["reply_feedback"].delete(opportunity_id)
    except Exception:
        pass
    return {"ok": True, "opportunity_id": opportunity_id}


def dismissed_reasons(agent_id: str | None = None) -> dict:
    """{opportunity_id: {reason, reason_source}} for the Dismissed view. Never
    raises."""
    db = init_reply_schema()
    out: dict = {}
    try:
        if agent_id:
            rows = db["reply_feedback"].rows_where(
                "signal = ? AND agent_id = ?", ["dismissed", agent_id])
        else:
            rows = db["reply_feedback"].rows_where("signal = ?", ["dismissed"])
        for r in rows:
            out[r["opportunity_id"]] = {
                "reason": r.get("reason") or "",
                "reason_source": r.get("reason_source") or "",
            }
    except Exception:
        pass
    return out


def learned_examples(agent_id: str, per_signal: int = 6) -> dict:
    """The freshest engaged/dismissed examples (title + reason) to feed the
    playbook distiller so it generalizes patterns instead of seeing only counts.
    User-corrected dismiss reasons are surfaced first (strongest signal)."""
    db = init_reply_schema()
    eng: list[dict] = []
    dis: list[dict] = []
    try:
        rows = list(db["reply_feedback"].rows_where(
            "agent_id = ?", [agent_id], order_by="created_at desc", limit=200))
        for r in rows:
            item = {"title": (r.get("title") or "")[:140],
                    "sub": r.get("sub") or "", "reason": r.get("reason") or "",
                    "src": r.get("reason_source") or ""}
            if r.get("signal") == "engaged" and len(eng) < per_signal:
                eng.append(item)
            elif r.get("signal") == "dismissed":
                dis.append(item)
        # user-corrected reasons first, then most recent
        dis.sort(key=lambda x: 0 if x.get("src") == "user" else 1)
        dis = dis[:per_signal]
    except Exception:
        pass
    return {"engaged": eng, "dismissed": dis}


def learned_preferences(agent_id: str) -> dict:
    """Aggregate feedback into lightweight taste signals used to RE-RANK future
    finds: communities/authors the user repeatedly engages (bonus) vs dismisses
    (penalty). A user-corrected dismissal counts double. Never raises."""
    db = init_reply_schema()
    pref = {"eng_sub": {}, "dis_sub": {}, "eng_author": {}, "dis_author": {}}
    try:
        rows = db["reply_feedback"].rows_where("agent_id = ?", [agent_id])
        for r in rows:
            sig = r.get("signal")
            w = 2 if (sig == "dismissed" and r.get("reason_source") == "user") else 1
            sub = (r.get("sub") or "").strip().lower()
            au = (r.get("author") or "").strip().lower()
            if sig == "engaged":
                if sub:
                    pref["eng_sub"][sub] = pref["eng_sub"].get(sub, 0) + w
                if au:
                    pref["eng_author"][au] = pref["eng_author"].get(au, 0) + w
            elif sig == "dismissed":
                if sub:
                    pref["dis_sub"][sub] = pref["dis_sub"].get(sub, 0) + w
                if au:
                    pref["dis_author"][au] = pref["dis_author"].get(au, 0) + w
    except Exception:
        pass
    return pref


def preference_delta(post: dict, pref: dict) -> float:
    """A bounded score multiplier-adjustment in [-0.35, +0.20] for one candidate,
    from the learned taste signals. Only kicks in once a community/author has ≥2
    weighted signals, so one skip doesn't nuke a whole community."""
    if not pref:
        return 0.0
    sub = (post.get("sub") or "").strip().lower()
    au = (post.get("author") or "").strip().lower()
    delta = 0.0
    dis_sub = pref.get("dis_sub", {}).get(sub, 0)
    eng_sub = pref.get("eng_sub", {}).get(sub, 0)
    if dis_sub >= 2 and dis_sub > eng_sub:
        delta -= min(0.25, 0.08 * dis_sub)
    elif eng_sub >= 2 and eng_sub > dis_sub:
        delta += min(0.15, 0.05 * eng_sub)
    if au:
        if pref.get("dis_author", {}).get(au, 0) >= 2:
            delta -= 0.10
        elif pref.get("eng_author", {}).get(au, 0) >= 2:
            delta += 0.05
    return max(-0.35, min(0.20, delta))
