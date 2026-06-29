"""Two-way Telegram bot — long-poll loop for OpenReply.

The notifications in `notify.py` carry inline buttons (Draft / Skip / Mark posted
/ Regenerate / Copy text / Reschedule). This poller is what makes those buttons do
something: it long-polls Telegram's `getUpdates`, and when a button is tapped it
runs the matching action against the opportunity or content store and replies with
the result.

It also handles the `/draft` command so a user can chat-style generate a platform
native post from Telegram.

It is meant to run **only while the desktop app is open** — the Tauri side spawns
`openreply reply bot-poll` on launch and kills it on quit, so there's no always-on
server or public webhook to host. Slack's interactive buttons would need exactly
that (a public request URL / Socket Mode), so Slack stays notify-only.

Robustness: the loop swallows transient network errors and backs off; a SIGTERM
(how Tauri stops a sidecar) breaks the loop cleanly; a `bot.stop` sentinel file in
the data dir is an additional manual stop.
"""
from __future__ import annotations

import json
import signal
import time
import urllib.error
import urllib.request

from . import notify

_API = "https://api.telegram.org/bot{token}/{method}"
_stop = False


def _stop_handler(*_a):
    global _stop
    _stop = True


def _call(token: str, method: str, params: dict, timeout: int = 30) -> dict:
    url = _API.format(token=token, method=method)
    data = json.dumps(params).encode("utf-8")
    req = urllib.request.Request(
        url, data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8", "replace"))


def _answer(token: str, callback_id: str, text: str = "") -> None:
    try:
        _call(token, "answerCallbackQuery",
              {"callback_query_id": callback_id, "text": text[:180]}, timeout=10)
    except Exception:
        pass


def _send(token: str, chat: str, text: str, buttons: list | None = None) -> None:
    payload: dict = {"chat_id": chat, "text": text, "parse_mode": "HTML",
                     "disable_web_page_preview": False}
    if buttons:
        payload["reply_markup"] = {
            "inline_keyboard": [[{"text": b["text"], "callback_data": b["data"]}] for b in buttons]}
    try:
        _call(token, "sendMessage", payload, timeout=15)
    except Exception:
        pass


def _load_content_item(cid: str) -> dict | None:
    """Fetch a content_items row by id, or None."""
    try:
        row = notify.init_reply_schema()["content_items"].get(cid)
        return dict(row) if row else None
    except Exception:
        return None


def _handle_content_action(action: str, cid: str, platform: str) -> tuple[str, str, list]:
    """Run a content_items button action. Returns (toast, message_html, buttons)."""
    from . import content as _content
    item = _load_content_item(cid)
    if not item:
        return "Not found", f"⚠️ No draft found for <code>{notify._esc(cid)}</code>.", []

    if action == "copy":
        body = (item.get("body") or "").strip()
        return "Copied 📋", f"<code>{notify._esc(body[:3000])}</code>", []

    if action == "posted":
        _content.update_content(cid, status="posted")
        return "Marked posted ✅", "✅ <b>Marked as posted.</b>", []

    if action == "schedule":
        import time
        # Default: schedule 1 hour from now.
        at = int(time.time()) + 3600
        _content.update_content(cid, status="scheduled", scheduled_at=at)
        when = time.strftime("%H:%M", time.localtime(at))
        return f"Scheduled 🗓 {when}", f"🗓 <b>Scheduled for {when}</b>.", []

    if action == "regen":
        try:
            res = _content.generate_content(
                item.get("kind") or "post",
                agent_id=item.get("agent_id"),
                platform=platform or item.get("platform"),
                angle=item.get("angle") or "",
            )
        except Exception as e:
            return "Couldn't regenerate", f"⚠️ {notify._esc(str(e))}", []
        if res.get("error"):
            return "Couldn't regenerate", f"⚠️ {notify._esc(res['error'])}", []
        new_item = _load_content_item(res.get("id")) or res
        tg, _sk, buttons = notify._fmt_content_item(new_item, platform or item.get("platform"))
        return "Regenerated 🔄", tg, buttons

    return "Unknown", "🤷 Unknown action.", []


def _handle_opportunity_action(action: str, oid: str) -> tuple[str, str, list]:
    """Run a reply_opportunity button action. Returns (toast, message_html, buttons)."""
    from . import opportunity as _opp
    if action == "skip":
        _opp.set_status(oid, "skipped")
        return "Skipped", "⏭ <b>Skipped.</b> It won't resurface.", []
    if action == "posted":
        _opp.set_status(oid, "posted")
        return "Marked posted ✅", "✅ <b>Marked as posted.</b> Nice.", []
    if action in ("draft", "regen"):
        from . import generate as _gen
        try:
            res = _gen.generate_reply(oid)
        except Exception as e:
            return "Couldn't draft", f"⚠️ Couldn't draft a reply: {notify._esc(str(e))}", []
        if res.get("error"):
            return "Couldn't draft", f"⚠️ {notify._esc(res['error'])}", []
        text = (_gen.current_draft(oid) or {}).get("text", "") or res.get("text", "")
        try:
            opp = dict(notify.init_reply_schema()["reply_opportunities"].get(oid))
        except Exception:
            opp = {"id": oid, "title": "your post"}
        tg, _sk, buttons = notify._fmt_reply(opp, text)
        toast = "Drafted ✍️" if action == "draft" else "Regenerated 🔄"
        return toast, tg, buttons
    return "Unknown", "🤷 Unknown action.", []


def _handle_action(action: str, oid: str) -> tuple[str, str, list]:
    """Run a button action. Returns (toast, message_html, buttons).

    Callback data is `action:oid` or `action:oid:platform`. Content-item actions
    (copy, schedule) and shared actions (posted, regen) are tried on content_items
    first; if the id isn't a content item we fall back to reply_opportunities.
    """
    raw = oid
    platform = ""
    if ":" in raw:
        oid, platform = raw.split(":", 1)

    # Content-item-first actions always hit content_items.
    if action in ("copy", "schedule"):
        return _handle_content_action(action, oid, platform)

    # Shared actions: try content item first, then opportunity.
    if action in ("posted", "regen"):
        if _load_content_item(oid):
            return _handle_content_action(action, oid, platform)
        return _handle_opportunity_action(action, oid)

    # Opportunity-only actions.
    return _handle_opportunity_action(action, oid)


def _handle_draft_command(text: str) -> tuple[str, list]:
    """Parse `/draft <platform> <angle>` and generate a content draft.

    Returns (message_html, buttons). Platform defaults to linkedin.
    """
    from . import content as _content
    parts = text.strip().split(None, 2)
    if len(parts) < 2:
        return (
            "<b>Usage:</b> <code>/draft &lt;platform&gt; &lt;angle&gt;</code>\n"
            "Example: <code>/draft linkedin Why manual tagging fails for students</code>",
            [],
        )
    platform = parts[1].lower()
    angle = parts[2] if len(parts) > 2 else ""
    kind = "post"
    try:
        res = _content.generate_content(kind, platform=platform, angle=angle)
    except Exception as e:
        return f"⚠️ Couldn't draft: {notify._esc(str(e))}", []
    if res.get("error"):
        return f"⚠️ {notify._esc(res['error'])}", []
    item = _load_content_item(res.get("id")) or res
    tg, _sk, buttons = notify._fmt_content_item(item, platform)
    return tg, buttons


def poll(once: bool = False) -> dict:
    """Long-poll Telegram until stopped. `once` drains pending updates and returns
    (used by tests / a single manual pass)."""
    signal.signal(signal.SIGTERM, _stop_handler)
    signal.signal(signal.SIGINT, _stop_handler)

    c = notify._raw_config()
    token = c.get("telegram_token") or ""
    if not token:
        return {"error": "telegram not configured"}
    if not c.get("two_way"):
        return {"error": "two-way control is off"}

    stop_file = None
    try:
        from ..core.config import load_config
        stop_file = load_config().data_dir / "bot.stop"
        if stop_file.exists():
            stop_file.unlink()
    except Exception:
        pass

    offset = None
    handled = 0
    backoff = 1
    while not _stop:
        if stop_file is not None and stop_file.exists():
            break
        try:
            params = {"timeout": 0 if once else 25, "allowed_updates": ["callback_query", "message"]}
            if offset is not None:
                params["offset"] = offset
            resp = _call(token, "getUpdates", params, timeout=(10 if once else 35))
            backoff = 1
        except Exception:
            if once:
                break
            time.sleep(min(backoff, 30))
            backoff = min(backoff * 2, 30)
            continue

        for upd in resp.get("result", []):
            offset = upd["update_id"] + 1
            cq = upd.get("callback_query")
            msg_obj = upd.get("message")

            if cq:
                data = cq.get("data") or ""
                chat = str((cq.get("message") or {}).get("chat", {}).get("id") or c.get("telegram_chat") or "")
                cb_id = cq.get("id") or ""
                if ":" not in data:
                    _answer(token, cb_id)
                    continue
                action, oid = data.split(":", 1)
                try:
                    toast, msg_html, buttons = _handle_action(action, oid)
                except Exception as e:
                    toast, msg_html, buttons = "Error", f"⚠️ {notify._esc(str(e))}", []
                _answer(token, cb_id, toast)
                if chat and msg_html:
                    _send(token, chat, msg_html, buttons)
                handled += 1
                continue

            if msg_obj:
                chat = str(msg_obj.get("chat", {}).get("id") or c.get("telegram_chat") or "")
                text = msg_obj.get("text") or ""
                if text.strip().lower().startswith("/draft"):
                    try:
                        msg_html, buttons = _handle_draft_command(text)
                    except Exception as e:
                        msg_html, buttons = f"⚠️ {notify._esc(str(e))}", []
                    if chat and msg_html:
                        _send(token, chat, msg_html, buttons)
                    handled += 1
                continue

        if once:
            break

    return {"stopped": True, "handled": handled}
