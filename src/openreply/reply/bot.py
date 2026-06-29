"""Two-way Telegram bot — long-poll loop for OpenReply.

The notifications in `notify.py` carry inline buttons (Draft / Skip / Mark posted
/ Regenerate). This poller is what makes those buttons do something: it long-polls
Telegram's `getUpdates`, and when a button is tapped it runs the matching action
against the opportunity store and replies with the result.

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


def _handle_action(action: str, oid: str) -> tuple[str, str, list]:
    """Run a button action. Returns (toast, message_html, buttons)."""
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
            params = {"timeout": 0 if once else 25, "allowed_updates": ["callback_query"]}
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
            if not cq:
                continue
            data = cq.get("data") or ""
            chat = str((cq.get("message") or {}).get("chat", {}).get("id") or c.get("telegram_chat") or "")
            cb_id = cq.get("id") or ""
            if ":" not in data:
                _answer(token, cb_id)
                continue
            action, oid = data.split(":", 1)
            try:
                toast, msg, buttons = _handle_action(action, oid)
            except Exception as e:
                toast, msg, buttons = "Error", f"⚠️ {notify._esc(str(e))}", []
            _answer(token, cb_id, toast)
            if chat and msg:
                _send(token, chat, msg, buttons)
            handled += 1

        if once:
            break

    return {"stopped": True, "handled": handled}
