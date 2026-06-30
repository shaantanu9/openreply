"""Auto-pilot — daily content + opportunity reply, drawn from the brain.

Gives the app standing daily value: on the scheduled tick it (1) generates the
configured content (default: 1 post/day) from the agent's blended knowledge +
brain, saved as a reviewable draft, and (2) finds fresh opportunities and drafts
the top reply (default: 1/day). Config lives per-agent in `reply_state`
(`autopilot:<agent_id>`); both default ON at daily-1 so usage is built in, but
nothing runs until the OS scheduler is installed (the Compose toggle does that).
Throttled by a per-feature `last_run` stamp so a frequent tick can't over-spend.
"""
from __future__ import annotations

import json
import time

from .agent import get_agent
from .schema import init_reply_schema

_CADENCE_HOURS = {"daily": 20.0, "weekly": 24.0 * 6.5}
_CONTENT_KINDS = ("post", "thread", "article", "youtube", "script")


def _notify_article(rec: dict) -> None:
    """Push a 'new <kind> drafted' alert (Telegram/Slack). Best-effort, deduped
    per content id, event-toggle gated."""
    try:
        from . import notify as _n
        if not _n.is_configured() or not _n.get_config()["events"].get("article"):
            return
        _n.notify_once(
            f"art:{rec.get('id')}", "article",
            {"art": {"kind": rec.get("kind"), "title": rec.get("title"),
                     "preview": rec.get("body") or ""}},
        )
    except Exception:
        pass

DEFAULTS = {
    "content": {"enabled": True, "cadence": "daily", "count": 1, "kinds": ["post"]},
    "opportunity": {"enabled": True, "cadence": "daily", "count": 1},
    "content_last": 0,
    "opp_last": 0,
}


def _key(agent_id: str) -> str:
    return f"autopilot:{agent_id}"


def get_autopilot(agent_id: str | None = None) -> dict:
    a = get_agent(agent_id)
    if not a:
        return {"error": "no active agent"}
    db = init_reply_schema()
    cfg = json.loads(json.dumps(DEFAULTS))  # deep copy
    try:
        row = db["reply_state"].get(_key(a["id"]))
        saved = json.loads(dict(row)["value"]) if row else {}
        for k in ("content", "opportunity"):
            if isinstance(saved.get(k), dict):
                cfg[k].update(saved[k])
        for k in ("content_last", "opp_last"):
            if k in saved:
                cfg[k] = saved[k]
    except Exception:
        pass
    cfg["agent_id"] = a["id"]
    return cfg


def set_autopilot(agent_id: str | None = None, *, content: dict | None = None,
                  opportunity: dict | None = None) -> dict:
    cfg = get_autopilot(agent_id)
    if cfg.get("error"):
        return cfg
    if content:
        cfg["content"].update({k: v for k, v in content.items() if k in ("enabled", "cadence", "count", "kinds")})
        cfg["content"]["kinds"] = [k for k in (cfg["content"].get("kinds") or ["post"]) if k in _CONTENT_KINDS] or ["post"]
        cfg["content"]["count"] = max(1, min(5, int(cfg["content"].get("count") or 1)))
    if opportunity:
        cfg["opportunity"].update({k: v for k, v in opportunity.items() if k in ("enabled", "cadence", "count")})
        cfg["opportunity"]["count"] = max(1, min(5, int(cfg["opportunity"].get("count") or 1)))
    _save(cfg)
    return cfg


def _save(cfg: dict) -> None:
    db = init_reply_schema()
    aid = cfg["agent_id"]
    store = {k: cfg[k] for k in ("content", "opportunity", "content_last", "opp_last")}
    db["reply_state"].upsert({"key": _key(aid), "value": json.dumps(store)}, pk="key")


def _due(last: int, cadence: str) -> bool:
    hrs = _CADENCE_HOURS.get((cadence or "daily").lower(), 20.0)
    return (int(time.time()) - int(last or 0)) >= int(hrs * 3600)


def run_autopilot_if_due(agent_id: str | None = None, provider: str | None = None,
                         force: bool = False) -> dict:
    """Generate due content + draft the due opportunity reply. Throttled per-feature
    unless `force` (the manual "Run now"). Best-effort: each leg is independently
    guarded so one failure can't block the other."""
    cfg = get_autopilot(agent_id)
    if cfg.get("error"):
        return {"skipped": True, "reason": cfg["error"]}
    aid = cfg["agent_id"]
    now = int(time.time())
    out: dict = {"agent_id": aid, "content": None, "opportunity": None}

    # 1) Daily content from the brain/knowledge (generate_content already blends
    #    beliefs + memories + graph neighbors + corpus).
    c = cfg["content"]
    if c.get("enabled") and (force or _due(cfg.get("content_last", 0), c.get("cadence"))):
        made = []
        try:
            from . import content as _content
            kinds = c.get("kinds") or ["post"]
            per = max(1, int(c.get("count") or 1))  # items of EACH selected kind
            for kind in kinds:
                for _ in range(per):
                    r = _content.generate_content(kind, agent_id=aid, provider=provider)
                    made.append({"kind": kind, "id": r.get("id"), "error": r.get("error")})
                    if not r.get("error"):
                        _notify_article(r)
            cfg["content_last"] = now
        except Exception as e:
            made.append({"error": str(e)})
        out["content"] = {"generated": made}

    # 2) Daily opportunity: find fresh ones, then draft the top reply(ies).
    o = cfg["opportunity"]
    if o.get("enabled") and _due(cfg.get("opp_last", 0), o.get("cadence")):
        drafted = []
        try:
            from . import opportunity as _opp
            from . import generate as _gen
            _opp.find_if_due(provider=provider)
            top = _opp.list_opportunities(status="new", limit=max(1, int(o.get("count") or 1)), min_score=0)
            for op in top:
                try:
                    res = _gen.generate_reply(op["id"], provider=provider)
                    drafted.append({"opportunity": op["id"], "ok": not res.get("error"), "error": res.get("error")})
                except Exception as e:
                    drafted.append({"opportunity": op.get("id"), "error": str(e)})
            cfg["opp_last"] = now
        except Exception as e:
            drafted.append({"error": str(e)})
        out["opportunity"] = {"drafted": drafted}

    _save(cfg)

    # 3) Fire any scheduled Compose drafts whose time has come. Runs every tick
    #    (not throttled) so scheduled posts publish on time. notify=True so an
    #    item that can't auto-post surfaces a Telegram reminder.
    try:
        from . import content_poster as _content_poster
        out["scheduled_content"] = _content_poster.process_due_content(now=now, notify=True)
    except Exception as e:
        out["scheduled_content"] = {"error": str(e)}

    return out


# ───────────────────────── daily update (digest) push ─────────────────────────

def _format_digest_md(res: dict) -> str:
    """Render a built digest into lightweight markdown for Telegram/Slack.

    Uses the LLM briefing (summary + themes + per-theme source links) when one
    exists; falls back to the top feed links when no LLM is configured. The
    notify `digest` formatter runs this through `_md_to_html`, so `**bold**` and
    `[title](url)` render correctly on Telegram."""
    b = (res.get("briefing") or {}) if isinstance(res.get("briefing"), dict) else {}
    lines: list[str] = ["📰 **Daily Update** — what's new for your goal"]
    summary = (b.get("summary") or "").strip()
    if summary:
        lines += ["", summary]
    sections = b.get("sections") or []
    for s in sections[:4]:
        if not isinstance(s, dict):
            continue
        head = (s.get("headline") or "").strip()
        why = (s.get("why") or "").strip()
        lines.append("")
        if head:
            lines.append(f"**{head}**")
        if why:
            lines.append(why)
        for lk in (s.get("links") or [])[:3]:
            t = (lk.get("title") or "link").strip()[:120]
            u = (lk.get("url") or "").strip()
            if u:
                lines.append(f"• [{t}]({u})")
    # No briefing (no LLM / synth failed) → fall back to the freshest feed items.
    if not sections:
        feed = res.get("feed") or []
        if feed:
            lines += ["", "**Top items today**"]
            for it in feed[:8]:
                t = (it.get("title") or "link").strip()[:120]
                u = (it.get("url") or "").strip()
                if u:
                    lines.append(f"• [{t}]({u})")
    return "\n".join(lines)


def send_daily_update_if_enabled(agent_id: str | None = None,
                                 provider: str | None = None) -> dict:
    """Build today's daily update and push it to Telegram/Slack — once per
    agent per day. Gated on notifications being configured + the `digest` event
    toggle being on (opt-in; default off). Best-effort: never raises.

    The build is cached one row/agent/day, so the first tick of the day does the
    ~10-20s fetch+synthesis and later ticks return the cached row instantly;
    `notify_once` then guarantees a single delivery per day regardless of how
    many ticks fire."""
    try:
        from . import notify as _n
    except Exception as e:
        return {"skipped": f"notify import failed: {e}"}
    if not _n.is_configured():
        return {"skipped": "notifications not configured"}
    if not _n.get_config()["events"].get("digest"):
        return {"skipped": "daily-update event off"}

    a = get_agent(agent_id)
    if not a:
        return {"skipped": "no active agent"}
    try:
        from . import digest as _digest
        res = _digest.build_digest(agent_id=a["id"], provider=provider)
    except Exception as e:
        return {"error": f"build_digest failed: {e}"}
    if not res or not res.get("ok"):
        return {"skipped": "digest unavailable", "detail": res}
    if not (res.get("briefing") or res.get("feed")):
        return {"skipped": "digest empty (nothing fresh)"}

    text = _format_digest_md(res)
    key = f"digest:{a['id']}:{res.get('day') or ''}"
    return _n.notify_once(key, "digest", {"text": text})


# ───────────────────────── OS scheduler heartbeat ─────────────────────────

def run_scheduled_tick(provider: str | None = None) -> dict:
    """The full daily heartbeat the OS scheduler (launchd) fires on its interval.

    One entry point that runs the whole hands-free product, each leg independently
    guarded so one failure can't block the rest:
      1. autopilot — daily content + opportunity discovery/drafting (this is what
         fires the new-opportunity / new-draft Telegram alerts),
      2. due reply reminders (auto-post where possible, else Telegram reminder),
      3. AI-visibility (geo) checks, throttled to their own cadence,
      4. the daily update digest → Telegram/Slack (opt-in).
    """
    out: dict = {"ran": True}

    try:
        out["autopilot"] = run_autopilot_if_due(provider=provider)
    except Exception as e:
        out["autopilot"] = {"error": str(e)}

    try:
        from . import poster as _poster
        out["due_replies"] = _poster.process_due(notify=True)
    except Exception as e:
        out["due_replies"] = {"error": str(e)}

    try:
        from . import geo as _geo
        out["geo"] = _geo.check_all_if_due(provider=provider)
    except Exception as e:
        out["geo"] = {"error": str(e)}

    try:
        out["daily_update"] = send_daily_update_if_enabled(provider=provider)
    except Exception as e:
        out["daily_update"] = {"error": str(e)}

    return out
