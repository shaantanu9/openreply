"""Subreddit Intelligence — know a subreddit before you post.

Combines, per agent:
  - discovery of relevant subreddits (reuses research.discover.discover_subs),
  - live `about.json` stats (subscribers, description, nsfw, submission type, age),
  - rules (`about/rules.json`) + a derived self-promo policy & strictness read,
  - the connected Reddit account's status (from the Reach credential store),
  - a draft compliance check (LLM vs the sub's rules),
  - a tracked-subs list cached in `reply_subreddits`.

Everything is fail-soft: Reddit blocks anonymous JSON, so without a connected
`reddit` cookie some fields come back empty rather than erroring.
"""
from __future__ import annotations

import time

import httpx

from ..core import credentials as _creds
from ..core.public_client import _proxy
from .agent import active_id, get_agent
from .rules import check_compliance, fetch_sub_rules
from .schema import init_reply_schema

_BASE = "https://www.reddit.com"
_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
# Phrases that signal a sub's self-promotion stance, scanned over the rules text.
_NO_PROMO = ("no self-promo", "no self promotion", "no advertis", "no promotion", "self-promotion is not")
_RATIO = ("9:1", "10:1", "1:9", "rule of thumb", "90/10")
_NO_LINKS = ("no links", "no direct links", "link in comment", "no urls")
_DISCLOSE = ("disclose", "affiliation", "transparent about")


def _ensure(db):
    if "reply_subreddits" not in set(db.table_names()):
        db["reply_subreddits"].create(
            {
                "agent_id": str, "sub": str, "subscribers": int, "fit": float,
                "description": str, "self_promo": str, "strictness": str,
                "best_time": str, "rules_json": str, "tracked": int, "intel_at": int,
            },
            pk=("agent_id", "sub"),
        )
        db["reply_subreddits"].create_index(["agent_id"])
    return db


def _about(sub: str) -> dict:
    """Public about.json — subscribers, description, nsfw, submission type, age."""
    try:
        headers = {"User-Agent": _UA, "Accept": "application/json"}
        cookie = _creds.cookie_header("reddit")
        if cookie:
            headers["Cookie"] = cookie
        with httpx.Client(proxy=_proxy(), timeout=20.0, follow_redirects=True) as c:
            r = c.get(f"{_BASE}/r/{sub}/about.json", headers=headers)
            r.raise_for_status()
            d = (r.json() or {}).get("data", {}) or {}
        return {
            "subscribers": int(d.get("subscribers") or 0),
            "active": int(d.get("active_user_count") or 0),
            "description": (d.get("public_description") or "")[:300],
            "over18": bool(d.get("over18")),
            "submission_type": d.get("submission_type") or "any",
            "created_utc": float(d.get("created_utc") or 0),
        }
    except Exception:
        return {}


def _derive(rules: list[dict], about: dict) -> dict:
    """Heuristic self-promo policy + strictness + a best-time suggestion."""
    text = " ".join(f"{r.get('name','')} {r.get('desc','')}" for r in rules).lower()
    if any(p in text for p in _NO_PROMO) and not any(x in text for x in _RATIO):
        self_promo = "no self-promo"
    elif any(x in text for x in _RATIO):
        self_promo = "9:1 rule"
    elif any(x in text for x in _NO_LINKS):
        self_promo = "no top-level links"
    elif any(x in text for x in _DISCLOSE):
        self_promo = "disclose affiliation"
    else:
        self_promo = "no explicit rule"
    n = len(rules)
    strictness = "high" if (n >= 6 or "no self-promo" == self_promo) else "medium" if n >= 3 else "low"
    # Best-time heuristic: large subs peak weekday mornings ET; niche subs anytime.
    best_time = "Weekday 8–11am ET" if about.get("subscribers", 0) > 200_000 else "Anytime (small sub)"
    return {"self_promo": self_promo, "strictness": strictness, "best_time": best_time}


def _account_karma() -> dict:
    """Connected reddit account status from the credential store (+ username if present)."""
    cred = _creds.get_credential("reddit")
    if not cred:
        return {"connected": False}
    return {
        "connected": True,
        "username": cred.get("username") or "",
        "verified_at": cred.get("last_verified_at") or "",
    }


# ---- public API ----------------------------------------------------------

def account_status() -> dict:
    return _account_karma()


def intel(sub: str, agent_id: str | None = None, refresh: bool = False) -> dict:
    """Full intel for one subreddit (about + rules + derived policy), cached."""
    sub = (sub or "").strip().lstrip("r/").lstrip("/")
    if not sub:
        return {"error": "no subreddit given"}
    db = _ensure(init_reply_schema())
    aid = agent_id or active_id() or "default"
    about = _about(sub)
    rr = fetch_sub_rules(sub, refresh=refresh)
    rules = rr.get("rules") or []
    derived = _derive(rules, about)
    acct = _account_karma()
    eligible = "unknown" if not acct.get("connected") else "likely"  # karma gate needs OAuth
    rec = {
        "agent_id": aid, "sub": sub, "subscribers": about.get("subscribers", 0),
        "fit": 0.0, "description": about.get("description", ""),
        "self_promo": derived["self_promo"], "strictness": derived["strictness"],
        "best_time": derived["best_time"], "rules_json": rr.get("summary", ""),
        "tracked": _is_tracked(db, aid, sub), "intel_at": int(time.time()),
    }
    db["reply_subreddits"].upsert(rec, pk=("agent_id", "sub"))
    return {
        "sub": sub, **about, **derived, "rules": rules,
        "account": acct, "eligible": eligible, "tracked": bool(rec["tracked"]),
    }


def _is_tracked(db, aid: str, sub: str) -> int:
    try:
        return int(dict(db["reply_subreddits"].get((aid, sub))).get("tracked") or 0)
    except Exception:
        return 0


def discover_for_agent(agent_id: str | None = None, limit: int = 8) -> dict:
    """Discover relevant subreddits for the agent (reuses research.discover)."""
    a = get_agent(agent_id)
    if not a:
        return {"error": "no active agent"}
    topic = (a.get("keywords") or [a.get("niche") or a.get("name")])[0]
    try:
        from ..research.discover import discover_subs

        res = discover_subs(topic, limit=limit)
        subs = res.get("subs") or res if isinstance(res, dict) else res
    except Exception as e:
        return {"error": f"discovery failed: {e}", "subs": []}
    db = _ensure(init_reply_schema())
    aid = a["id"]
    out = []
    for s in (subs or []):
        name = (s.get("name") or "").lstrip("r/")
        if not name:
            continue
        rec = {
            "agent_id": aid, "sub": name, "subscribers": int(s.get("subscribers") or 0),
            "fit": float(s.get("relevance") or 0), "description": (s.get("description") or "")[:300],
            "self_promo": "", "strictness": "", "best_time": "", "rules_json": "",
            "tracked": _is_tracked(db, aid, name), "intel_at": 0,
        }
        db["reply_subreddits"].upsert(rec, pk=("agent_id", "sub"))
        out.append({"sub": name, "subscribers": rec["subscribers"], "fit": rec["fit"],
                    "description": rec["description"], "tracked": bool(rec["tracked"])})
    out.sort(key=lambda x: x["fit"], reverse=True)
    return {"topic": topic, "subs": out}


def list_tracked(agent_id: str | None = None) -> dict:
    db = _ensure(init_reply_schema())
    aid = agent_id or active_id() or "default"
    rows = [dict(r) for r in db["reply_subreddits"].rows_where("agent_id = ?", [aid], order_by="tracked desc, fit desc")]
    return {"subreddits": rows}


def track(sub: str, on: bool = True, agent_id: str | None = None) -> dict:
    sub = (sub or "").strip().lstrip("r/")
    db = _ensure(init_reply_schema())
    aid = agent_id or active_id() or "default"
    try:
        db["reply_subreddits"].get((aid, sub))
    except Exception:
        db["reply_subreddits"].upsert(
            {"agent_id": aid, "sub": sub, "subscribers": 0, "fit": 0.0, "description": "",
             "self_promo": "", "strictness": "", "best_time": "", "rules_json": "",
             "tracked": 0, "intel_at": 0}, pk=("agent_id", "sub"))
    db["reply_subreddits"].update((aid, sub), {"tracked": 1 if on else 0})
    return {"sub": sub, "tracked": on}


def check_draft(sub: str, text: str, provider: str | None = None) -> dict:
    """Run a draft against the sub's rules (ban-proof compliance)."""
    return check_compliance((sub or "").lstrip("r/"), text, provider=provider)
