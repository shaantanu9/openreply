"""Subreddit rules fetch + compliance check — the "ban-proof" guardrail.

Pulls `/r/<sub>/about/rules.json` (cookie-authenticated when connected, via the
same proxy/UA as `reddit_free`), caches it, and uses the BYOK LLM to check a draft
reply against those rules before you post. Fail-soft: if rules can't be fetched or
no LLM is configured, it returns compliant=True with a cautionary note rather than
blocking.
"""
from __future__ import annotations

import json
import time

import httpx

from ..analyze.providers.base import get_provider
from ..core import credentials as _creds
from ..core.public_client import _proxy
from .schema import init_reply_schema
from .util import loads_json

_BASE = "https://www.reddit.com"
_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)


def fetch_sub_rules(sub: str, refresh: bool = False) -> dict:
    db = init_reply_schema()
    if not refresh:
        try:
            row = dict(db["reply_sub_rules"].get(sub))
            return {"sub": sub, "rules": json.loads(row.get("rules_json") or "[]"), "summary": row.get("summary", "")}
        except Exception:
            pass

    rules: list[dict] = []
    try:
        headers = {"User-Agent": _UA, "Accept": "application/json"}
        cookie = _creds.cookie_header("reddit")
        if cookie:
            headers["Cookie"] = cookie
        with httpx.Client(proxy=_proxy(), timeout=20.0, follow_redirects=True) as c:
            r = c.get(f"{_BASE}/r/{sub}/about/rules.json", headers=headers)
            r.raise_for_status()
            data = r.json()
        for it in data.get("rules", []):
            rules.append(
                {
                    "name": it.get("short_name") or it.get("violation_reason") or "",
                    "desc": (it.get("description") or "")[:500],
                }
            )
    except Exception as e:
        return {"sub": sub, "rules": [], "summary": "", "error": str(e)}

    summary = "; ".join(r["name"] for r in rules if r.get("name"))[:1000]
    db["reply_sub_rules"].upsert(
        {"sub": sub, "rules_json": json.dumps(rules), "summary": summary, "fetched_at": int(time.time())},
        pk="sub",
    )
    return {"sub": sub, "rules": rules, "summary": summary}


def check_compliance(sub: str, draft_text: str, provider: str | None = None) -> dict:
    info = fetch_sub_rules(sub)
    rules = info.get("rules") or []
    if not rules:
        return {"compliant": True, "notes": "No rules fetched — post with care (avoid self-promo)."}

    rules_txt = "\n".join(f"- {r['name']}: {r['desc']}" for r in rules)
    prompt = (
        f"Subreddit r/{sub} rules:\n{rules_txt}\n\n"
        f'Proposed reply:\n"""{draft_text}"""\n\n'
        "Does the reply violate any rule (especially self-promotion / spam / low-effort)? "
        'Return JSON: {"compliant":true/false,"notes":"short reason and a fix if not compliant"}'
    )
    try:
        raw = get_provider(provider).complete(prompt, system="Output ONLY JSON.", max_tokens=200, temperature=0.0)
        data = loads_json(raw)
        return {"compliant": bool(data.get("compliant", True)), "notes": str(data.get("notes", ""))[:400]}
    except Exception:
        return {"compliant": True, "notes": "compliance check unavailable (no LLM)"}
