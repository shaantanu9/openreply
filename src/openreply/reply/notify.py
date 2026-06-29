"""Telegram + Slack delivery for OpenReply events.

Three modules already produce user-facing events but only ever fired a native
macOS notification (`poster._notify`): a new high-value opportunity is found, the
auto-pilot drafts a new article/post, and a queued reply comes due. This module
is the **transport** they were missing — it pushes a rich message (what to post,
the draft, the link, why it matters) to Telegram and/or Slack.

Design:
  - Config (tokens, chat id, webhook, per-event toggles) lives in a singleton
    `reply_notify` row in the app-data DB — same place Reddit creds live, never
    in a URL/query string.
  - Transport is **stdlib `urllib`** only, so nothing new has to be bundled into
    the PyInstaller sidecar.
  - Every send is **best-effort**: a network/credential failure returns a reason
    and never raises into the scheduler tick.
  - Telegram messages carry inline buttons (Approve / Regenerate / Skip) that the
    two-way poller in `bot.py` acts on. Slack is notify-only (its interactive
    buttons need a public request URL / Socket Mode, which a local PC can't host
    without a tunnel) — so Slack gets the same text without the buttons.
"""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.request

from .schema import init_reply_schema

_TG_API = "https://api.telegram.org/bot{token}/{method}"

# event keys → the config column that gates them
_EVENT_FLAG = {
    "opportunity": "ev_opportunity",
    "article": "ev_article",
    "reply": "ev_reply",
    "digest": "ev_digest",
    "geo": "ev_geo",
}

_DEFAULTS = {
    "id": "config",
    "enabled": 0,
    "telegram_token": "",
    "telegram_chat": "",
    "slack_webhook": "",
    "two_way": 1,
    "ev_opportunity": 1,
    "ev_article": 1,
    "ev_reply": 1,
    "ev_digest": 0,
    "ev_geo": 0,
    "min_score": 0.0,
    "updated_at": 0,
}


# ───────────────────────── config store ─────────────────────────

def _ensure(db):
    if "reply_notify" not in set(db.table_names()):
        db["reply_notify"].create(
            {
                "id": str, "enabled": int, "telegram_token": str,
                "telegram_chat": str, "slack_webhook": str, "two_way": int,
                "ev_opportunity": int, "ev_article": int, "ev_reply": int,
                "ev_digest": int, "ev_geo": int, "min_score": float,
                "updated_at": int,
            },
            pk="id",
        )
    return db


def _raw_config() -> dict:
    """Full config including secrets — for internal senders only."""
    db = _ensure(init_reply_schema())
    try:
        row = dict(db["reply_notify"].get("config"))
    except Exception:
        row = {}
    cfg = dict(_DEFAULTS)
    cfg.update({k: v for k, v in row.items() if v is not None})
    return cfg


def get_config() -> dict:
    """Public config for the UI — secrets masked to presence + last 4 chars."""
    c = _raw_config()
    tok = c.get("telegram_token") or ""
    hook = c.get("slack_webhook") or ""
    return {
        "enabled": bool(c["enabled"]),
        "two_way": bool(c["two_way"]),
        "telegram_chat": c.get("telegram_chat") or "",
        "has_telegram": bool(tok),
        "telegram_hint": ("…" + tok[-4:]) if tok else "",
        "has_slack": bool(hook),
        "slack_hint": ("…" + hook[-6:]) if hook else "",
        "events": {
            "opportunity": bool(c["ev_opportunity"]),
            "article": bool(c["ev_article"]),
            "reply": bool(c["ev_reply"]),
            "digest": bool(c["ev_digest"]),
            "geo": bool(c["ev_geo"]),
        },
        "min_score": float(c.get("min_score") or 0.0),
    }


def set_config(**fields) -> dict:
    """Upsert config. Only known columns are written. Empty-string tokens are
    kept as-is (caller passes them explicitly to clear); pass None to leave a
    field unchanged."""
    db = _ensure(init_reply_schema())
    cur = _raw_config()
    patch = {"id": "config", "updated_at": int(time.time())}
    cols = set(_DEFAULTS) - {"id"}
    for k, v in fields.items():
        if k == "events" and isinstance(v, dict):
            for ek, flag in _EVENT_FLAG.items():
                if ek in v:
                    patch[flag] = 1 if v[ek] else 0
            continue
        if k in cols and v is not None:
            if k in ("enabled", "two_way"):
                patch[k] = 1 if v else 0
            elif k == "min_score":
                patch[k] = float(v)
            else:
                patch[k] = v
    merged = {**cur, **patch}
    db["reply_notify"].upsert(merged, pk="id")
    return get_config()


def is_configured() -> bool:
    c = _raw_config()
    return bool(c["enabled"]) and bool(c.get("telegram_token") or c.get("slack_webhook"))


# ───────────────────────── dedup ─────────────────────────
# An opportunity stays "new"/"queued" across many scheduler ticks, so without a
# guard the same event would push every tick. We record a per-event key once sent.

def _seen_table(db):
    if "reply_notified" not in set(db.table_names()):
        db["reply_notified"].create({"key": str, "at": int}, pk="key")
    return db


def was_notified(key: str) -> bool:
    db = _seen_table(init_reply_schema())
    try:
        return db["reply_notified"].get(key) is not None
    except Exception:
        return False


def mark_notified(key: str) -> None:
    db = _seen_table(init_reply_schema())
    try:
        db["reply_notified"].upsert({"key": key, "at": int(time.time())}, pk="key")
    except Exception:
        pass


def notify_once(key: str, event: str, payload: dict) -> dict:
    """dispatch() guarded by a one-time key — no-op if already sent for `key`."""
    if was_notified(key):
        return {"skipped": "already notified"}
    res = dispatch(event, payload)
    # Record the key on any real attempt. The one exception is a globally
    # disabled config: leave it unmarked so the first item after the user turns
    # notifications on is still delivered (the next fresh event, not a backlog).
    if res.get("skipped") != "disabled":
        mark_notified(key)
    return res


# ───────────────────────── transport ─────────────────────────

def _post_json(url: str, payload: dict, timeout: int = 12) -> tuple[bool, str]:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url, data=data, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8", "replace")
            return True, body
    except urllib.error.HTTPError as e:
        detail = ""
        try:
            detail = e.read().decode("utf-8", "replace")[:200]
        except Exception:
            pass
        return False, f"HTTP {e.code}: {detail or e.reason}"
    except Exception as e:  # URLError, timeout, etc.
        return False, str(e)


def send_telegram(text: str, buttons: list | None = None,
                  token: str | None = None, chat: str | None = None) -> tuple[bool, str]:
    """Send an HTML message to Telegram. `buttons` is a list of
    [{"text","data"}] rows rendered as a one-per-row inline keyboard."""
    c = _raw_config()
    token = token or c.get("telegram_token") or ""
    chat = chat or c.get("telegram_chat") or ""
    if not token or not chat:
        return False, "telegram not configured (token + chat id)"
    payload: dict = {
        "chat_id": chat, "text": text,
        "parse_mode": "HTML", "disable_web_page_preview": False,
    }
    if buttons:
        payload["reply_markup"] = {
            "inline_keyboard": [[{"text": b["text"], "callback_data": b["data"]}] for b in buttons]
        }
    ok, body = _post_json(_TG_API.format(token=token, method="sendMessage"), payload)
    if ok:
        try:
            if not json.loads(body).get("ok", False):
                return False, body[:200]
        except Exception:
            pass
    return ok, body[:200]


def send_slack(text: str, webhook: str | None = None) -> tuple[bool, str]:
    """Post mrkdwn text to a Slack incoming webhook."""
    c = _raw_config()
    webhook = webhook or c.get("slack_webhook") or ""
    if not webhook:
        return False, "slack not configured (incoming webhook)"
    return _post_json(webhook, {"text": text, "mrkdwn": True})


# ───────────────────────── formatters ─────────────────────────

def _esc(s: str) -> str:
    return (s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _pct(x) -> str:
    try:
        return f"{round(float(x) * 100)}%"
    except Exception:
        return "—"


def _fmt_opportunity(opp: dict) -> tuple[str, str, list]:
    """Returns (telegram_html, slack_text, telegram_buttons)."""
    title = _esc((opp.get("title") or "(untitled)")[:200])
    sub = _esc(opp.get("sub") or opp.get("platform") or "")
    url = opp.get("url") or ""
    score = _pct(opp.get("score"))
    reason = _esc((opp.get("reason") or "")[:240])
    where = f"r/{sub}" if (opp.get("platform") or "").startswith("reddit") and sub else (sub or "post")
    tg = (
        f"🎯 <b>New opportunity</b> · {where}\n"
        f"<b>{title}</b>\n\n"
        f"Match: <b>{score}</b>\n"
        + (f"Why: {reason}\n" if reason else "")
        + (f'\n🔗 <a href="{_esc(url)}">Open the thread</a>' if url else "")
    )
    sk = (
        f"🎯 *New opportunity* · {where}\n*{opp.get('title','')[:200]}*\n"
        f"Match: {score}" + (f"\nWhy: {opp.get('reason','')[:240]}" if reason else "")
        + (f"\n<{url}|Open the thread>" if url else "")
    )
    oid = opp.get("id") or ""
    buttons = [
        {"text": "✍️ Draft a reply", "data": f"draft:{oid}"},
        {"text": "⏭ Skip", "data": f"skip:{oid}"},
    ]
    return tg, sk, buttons


def _fmt_article(art: dict) -> tuple[str, str, list]:
    kind = _esc(art.get("kind") or "post")
    title = _esc((art.get("title") or art.get("preview") or "New draft")[:200])
    body = _esc((art.get("preview") or art.get("text") or "")[:400])
    tg = (
        f"📝 <b>New {kind} drafted</b>\n"
        f"<b>{title}</b>\n\n"
        + (f"{body}…\n" if body else "")
        + "\nReview &amp; edit it in OpenReply → Compose."
    )
    sk = (
        f"📝 *New {kind} drafted*\n*{art.get('title') or 'New draft'}*\n"
        + ((art.get("preview") or "")[:400] + "…\n" if body else "")
        + "Review & edit it in OpenReply → Compose."
    )
    return tg, sk, []


def _fmt_reply(opp: dict, draft_text: str) -> tuple[str, str, list]:
    title = _esc((opp.get("title") or "(untitled)")[:200])
    url = opp.get("url") or ""
    draft = _esc((draft_text or "").strip()[:1200])
    where = _esc(opp.get("sub") or opp.get("platform") or "")
    where = f"r/{where}" if (opp.get("platform") or "").startswith("reddit") and where else (where or "post")
    tg = (
        f"🔔 <b>Reply due</b> · {where}\n"
        f"<b>{title}</b>\n\n"
        f"<b>Draft</b> (tap to copy):\n<code>{draft}</code>\n"
        + (f'\n🔗 <a href="{_esc(url)}">Open to post</a>' if url else "")
    )
    sk = (
        f"🔔 *Reply due* · {where}\n*{opp.get('title','')[:200]}*\n\n"
        f"*Draft:*\n```{(draft_text or '').strip()[:1200]}```"
        + (f"\n<{url}|Open to post>" if url else "")
    )
    oid = opp.get("id") or ""
    buttons = [
        {"text": "✅ Mark posted", "data": f"posted:{oid}"},
        {"text": "🔄 Regenerate", "data": f"regen:{oid}"},
        {"text": "⏭ Skip", "data": f"skip:{oid}"},
    ]
    return tg, sk, buttons


_FORMATTERS = {
    "opportunity": lambda p: _fmt_opportunity(p["opp"]),
    "article": lambda p: _fmt_article(p["art"]),
    "reply": lambda p: _fmt_reply(p["opp"], p.get("draft", "")),
    "digest": lambda p: (p.get("text", ""), p.get("text", ""), []),
    "geo": lambda p: (p.get("text", ""), p.get("text", ""), []),
}


# ───────────────────────── dispatch ─────────────────────────

def dispatch(event: str, payload: dict) -> dict:
    """Format `event` and push to every configured channel. Best-effort: returns
    a per-channel result and never raises. Skips silently if notifications are
    off or this event type is toggled off."""
    c = _raw_config()
    if not c["enabled"]:
        return {"skipped": "disabled"}
    flag = _EVENT_FLAG.get(event)
    if flag and not c.get(flag):
        return {"skipped": f"event '{event}' off"}
    fmt = _FORMATTERS.get(event)
    if not fmt:
        return {"skipped": f"unknown event '{event}'"}
    try:
        tg_text, sk_text, buttons = fmt(payload)
    except Exception as e:
        return {"error": f"format failed: {e}"}

    out: dict = {}
    if c.get("telegram_token") and c.get("telegram_chat"):
        ok, msg = send_telegram(tg_text, buttons if c.get("two_way") else None)
        out["telegram"] = {"ok": ok, "msg": msg}
    if c.get("slack_webhook"):
        ok, msg = send_slack(sk_text)
        out["slack"] = {"ok": ok, "msg": msg}
    return out or {"skipped": "no channels"}


def send_test() -> dict:
    """Fire a test message to every configured channel (ignores enabled/toggles
    so the user can verify creds before turning it on)."""
    c = _raw_config()
    tg = sk = None
    text_tg = ("✅ <b>OpenReply connected</b>\nYou'll get new opportunities, "
               "drafted posts, and reply reminders here.")
    text_sk = ("✅ *OpenReply connected*\nYou'll get new opportunities, drafted "
               "posts, and reply reminders here.")
    if c.get("telegram_token") and c.get("telegram_chat"):
        ok, msg = send_telegram(text_tg)
        tg = {"ok": ok, "msg": msg}
    if c.get("slack_webhook"):
        ok, msg = send_slack(text_sk)
        sk = {"ok": ok, "msg": msg}
    if tg is None and sk is None:
        return {"error": "no channel configured — add a Telegram token + chat id or a Slack webhook"}
    return {"telegram": tg, "slack": sk}


# convenience wrappers used by the event sites
def notify_opportunity(opp: dict) -> dict:
    return dispatch("opportunity", {"opp": opp})


def notify_article(art: dict) -> dict:
    return dispatch("article", {"art": art})


def notify_reply_due(opp: dict, draft_text: str) -> dict:
    return dispatch("reply", {"opp": opp, "draft": draft_text})
