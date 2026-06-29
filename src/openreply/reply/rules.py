"""Subreddit rules fetch + compliance check — the "ban-proof" guardrail.

Pulls a subreddit's rules, caches them, and uses the BYOK LLM to check a draft
reply against those rules before you post. Fail-soft: if rules can't be fetched or
no LLM is configured, it returns compliant=True with a cautionary note rather than
blocking.

Reddit 403-blocks the unauthenticated `/about/rules.json` endpoint (same policy
that blocks every `www.reddit.com/*.json` request as of 2025). So we read the
`old.reddit.com/r/<sub>/about/rules` HTML page instead — it still serves 200 with
clean, structured `.subreddit-rule-item` markup carrying `data-violation-reason`,
`data-description`, and `data-kind` attributes. The `.json` endpoint is still
attempted first as a best effort (it works if OAuth/PRAW is ever configured),
then we fall back to the HTML scrape.
"""
from __future__ import annotations

import html as _html
import json
import re
import time

import httpx

from ..analyze.providers.base import get_provider
from ..core import credentials as _creds
from ..core.public_client import _headers, _proxy
from .schema import init_reply_schema
from .util import loads_json

_BASE = "https://www.reddit.com"
_OLD = "https://old.reddit.com"
_RULE_ITEM_RE = re.compile(r'<div class="subreddit-rule-item"([^>]*)>')


def _reddit_headers() -> dict:
    """Browser-grade headers (rotating UA + Sec-Fetch-*) plus the connected cookie."""
    h = _headers()
    cookie = _creds.cookie_header("reddit")
    if cookie:
        h["Cookie"] = cookie
    return h


def _parse_html_rules(text: str) -> list[dict]:
    """Extract rules from an old.reddit `/about/rules` HTML page."""
    rules: list[dict] = []
    for m in _RULE_ITEM_RE.finditer(text):
        attrs = m.group(1)

        def _attr(name: str) -> str:
            mm = re.search(name + r'="(.*?)"', attrs, re.DOTALL)
            if not mm:
                return ""
            # old.reddit encodes spaces as &#32; inside data-* attributes
            return _html.unescape(mm.group(1).replace("&#32;", " ")).strip()

        name = _attr("data-violation-reason")
        if not name:
            continue
        rules.append({"name": name, "desc": _attr("data-description")[:500]})
    return rules


def _fetch_json_rules(c: httpx.Client, sub: str, headers: dict) -> list[dict]:
    """Best-effort `.json` fetch (works only with OAuth/PRAW auth; 403 otherwise)."""
    r = c.get(f"{_BASE}/r/{sub}/about/rules.json", headers={**headers, "Accept": "application/json"})
    r.raise_for_status()
    data = r.json()
    out = []
    for it in data.get("rules", []):
        out.append(
            {
                "name": it.get("short_name") or it.get("violation_reason") or "",
                "desc": (it.get("description") or "")[:500],
            }
        )
    return out


def _fetch_html_rules(c: httpx.Client, sub: str, headers: dict) -> list[dict]:
    """Scrape the 200-returning old.reddit `/about/rules` HTML page."""
    r = c.get(f"{_OLD}/r/{sub}/about/rules", headers=headers)
    r.raise_for_status()
    return _parse_html_rules(r.text)


def fetch_sub_rules(sub: str, refresh: bool = False) -> dict:
    db = init_reply_schema()
    if not refresh:
        try:
            row = dict(db["reply_sub_rules"].get(sub))
            return {"sub": sub, "rules": json.loads(row.get("rules_json") or "[]"), "summary": row.get("summary", "")}
        except Exception:
            pass

    rules: list[dict] = []
    last_err = ""
    headers = _reddit_headers()
    try:
        with httpx.Client(proxy=_proxy(), timeout=20.0, follow_redirects=True) as c:
            # 1) Best effort: the official .json endpoint (only succeeds with OAuth).
            try:
                rules = _fetch_json_rules(c, sub, headers)
            except Exception as e:
                last_err = str(e)
            # 2) Fallback: old.reddit HTML (works unauthenticated, the common path).
            if not rules:
                rules = _fetch_html_rules(c, sub, headers)
    except Exception as e:
        return {"sub": sub, "rules": [], "summary": "", "error": str(e) or last_err}

    if not rules:
        return {"sub": sub, "rules": [], "summary": "", "error": last_err or "no rules found"}

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
