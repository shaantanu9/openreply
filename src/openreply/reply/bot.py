"""Two-way Telegram bot — long-poll loop for OpenReply.

The notifications in `notify.py` carry inline buttons (Draft / Skip / Mark posted
/ Regenerate / Copy text / Reschedule). This poller is what makes those buttons do
something: it long-polls Telegram's `getUpdates`, and when a button is tapped it
runs the matching action against the opportunity or content store and replies with
the result.

It is also a full two-way assistant: a free-text message is answered as a
grounded agent chat (`reply.chat`, history persisted as a `telegram:<chat>`
conversation the app also lists), and a slash-command menu (`/help`, `/menu`,
`/today`, `/find`, `/draft`, `/reset`) — registered with Telegram via
`setMyCommands` — plus an inline button panel make the common actions one tap.

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


def _send_typing(token: str, chat: str) -> None:
    """Show Telegram's 'typing…' indicator while we think (best-effort)."""
    try:
        _call(token, "sendChatAction", {"chat_id": chat, "action": "typing"}, timeout=8)
    except Exception:
        pass


# ── update-offset persistence ────────────────────────────────────────────────
# The Tauri app drives this poller as `bot-poll --once` on a 4s interval, so each
# pass is a FRESH process. Without a persisted offset every process re-fetches
# (and re-handles) the same pending updates — harmless for an idempotent button
# tap, but it would double-fire (and double-bill) an LLM chat reply. We persist
# the next offset to a file and ACK BEFORE handling (at-most-once), so two
# overlapping 4s passes can never process the same update twice.

def _data_dir():
    try:
        from ..core.config import load_config
        return load_config().data_dir
    except Exception:
        return None


def _offset_path():
    d = _data_dir()
    return (d / "bot.offset") if d else None


def _load_offset():
    p = _offset_path()
    try:
        if p and p.exists():
            return int(p.read_text().strip())
    except Exception:
        pass
    return None


def _save_offset(n: int) -> None:
    p = _offset_path()
    try:
        if p:
            p.write_text(str(int(n)))
    except Exception:
        pass


# ── command menu ──────────────────────────────────────────────────────────────

_BOT_COMMANDS = [
    {"command": "help", "description": "What I can do + the quick menu"},
    {"command": "menu", "description": "Quick actions"},
    {"command": "today", "description": "Send today's Daily Update"},
    {"command": "find", "description": "Top new opportunities"},
    {"command": "draft", "description": "Draft a post: /draft <platform> <angle>"},
    {"command": "reset", "description": "Clear this chat's conversation history"},
]


def _ensure_commands_registered(token: str) -> None:
    """Register the slash-command menu with Telegram once per data dir (so it
    autocompletes under '/'). A marker file avoids re-sending it every 4s."""
    d = _data_dir()
    marker = (d / "bot.cmds") if d else None
    try:
        if marker and marker.exists():
            return
    except Exception:
        pass
    try:
        _call(token, "setMyCommands", {"commands": _BOT_COMMANDS}, timeout=10)
        if marker:
            marker.write_text("1")
    except Exception:
        pass


def _menu_buttons() -> list:
    return [
        {"text": "📰 Daily update", "data": "menu:today"},
        {"text": "🎯 Opportunities", "data": "menu:find"},
        {"text": "✍️ Draft a post", "data": "menu:draft"},
        {"text": "❓ Help", "data": "menu:help"},
    ]


def _help_text() -> str:
    return (
        "👋 <b>OpenReply assistant</b>\n"
        "I'm wired to your active agent — its goal, knowledge, and sources.\n\n"
        "<b>Just type a message</b> and I'll answer from what the agent knows, "
        "with citations.\n\n"
        "<b>Commands</b>\n"
        "• /today — today's Daily Update\n"
        "• /find — top new opportunities (with Draft / Skip)\n"
        "• /draft &lt;platform&gt; &lt;angle&gt; — draft a post\n"
        "• /menu — quick action buttons\n"
        "• /reset — clear our chat history\n"
        "• /help — this message"
    )


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

    return ("Unknown", "🤷 I don't recognize that button — it may be from an "
            "older message. Tap /menu for current actions.", [])


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
    return ("Unknown", "🤷 I don't recognize that button — it may be from an "
            "older message. Tap /menu for current actions.", [])


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


# ── free-text chat ────────────────────────────────────────────────────────────

def _conv_id(chat: str) -> str:
    """Stable conversation id so a Telegram chat persists as one thread the app
    also lists under chat history."""
    return f"telegram:{chat}"


def _chat_reply(chat: str, text: str) -> str:
    """Answer a free-text message as a grounded agent chat, persisting the thread.
    Returns Telegram-ready HTML."""
    from .chat import chat_with_agent
    from . import agent as _agent
    try:
        from ..core.db import get_chat_conversation, save_chat_conversation
    except Exception:
        get_chat_conversation = save_chat_conversation = None

    conv_id = _conv_id(chat)
    prior = None
    if get_chat_conversation:
        try:
            prior = get_chat_conversation(conv_id)
        except Exception:
            prior = None
    history = (prior.get("messages") or []) if prior else []

    res = chat_with_agent(text, history=history)
    if not res.get("ok"):
        return f"⚠️ {notify._esc(res.get('error') or 'I could not answer that.')}"
    answer = (res.get("answer") or "").strip() or "(no answer)"

    if save_chat_conversation:
        try:
            a = _agent.get_agent(res.get("agent_id"))
            topic = (a.get("topic") or a.get("name") or "") if a else ""
            messages = list(history) + [
                {"role": "user", "content": text},
                {"role": "assistant", "content": answer},
            ]
            save_chat_conversation(conv_id=conv_id, topic=topic, messages=messages,
                                   title=prior.get("title") if prior else None)
        except Exception:
            pass
    return notify._md_to_html(answer)


def _reset_chat(chat: str) -> str:
    try:
        from ..core.db import delete_chat_conversation
        delete_chat_conversation(_conv_id(chat))
    except Exception:
        pass
    return "🧹 <b>Cleared.</b> This chat starts fresh."


# ── on-demand surfaces (digest / opportunities) ───────────────────────────────

def _send_daily_update(token: str, chat: str) -> None:
    """Build (cached per day) + send today's Daily Update on demand."""
    _send(token, chat, "📰 Building today's update… one moment.")
    try:
        from . import digest as _digest, scheduler as _scheduler
        res = _digest.build_digest()
    except Exception as e:
        _send(token, chat, f"⚠️ Couldn't build the update: {notify._esc(str(e))}")
        return
    if not res or not res.get("ok") or not (res.get("briefing") or res.get("feed")):
        _send(token, chat, "Nothing fresh yet — try again after the next collection.")
        return
    _send(token, chat, notify._md_to_html(_scheduler._format_digest_md(res)))


def _send_opportunities(token: str, chat: str, limit: int = 5) -> None:
    """List the top new opportunities, each with Draft / Skip buttons."""
    try:
        from . import opportunity as _opp
        top = _opp.list_opportunities(status="new", limit=limit, min_score=0)
    except Exception as e:
        _send(token, chat, f"⚠️ {notify._esc(str(e))}")
        return
    if not top:
        _send(token, chat,
              "No new opportunities right now — I'll ping you when fresh ones land. "
              "Run discovery in the app or try /find later.")
        return
    _send(token, chat, f"🎯 <b>Top {len(top)} opportunities</b>")
    for opp in top:
        tg, _sk, buttons = notify._fmt_opportunity(opp)
        _send(token, chat, tg, buttons)


# ── routers ───────────────────────────────────────────────────────────────────

def _handle_menu(sub: str, token: str, chat: str) -> str:
    """Run a menu button — sends its own message(s); returns a short toast."""
    if sub in ("help", "start"):
        _send(token, chat, _help_text(), _menu_buttons())
        return "Help"
    if sub == "menu":
        _send(token, chat, "What would you like to do?", _menu_buttons())
        return "Menu"
    if sub in ("today", "digest"):
        _send_daily_update(token, chat)
        return "Daily update"
    if sub in ("find", "opps", "opportunities"):
        _send_opportunities(token, chat)
        return "Opportunities"
    if sub == "draft":
        _send(token, chat,
              "✍️ Send <code>/draft &lt;platform&gt; &lt;angle&gt;</code>\n"
              "Example: <code>/draft linkedin Why manual tagging fails for students</code>")
        return "Draft"
    return "Unknown"


def _handle_command_message(text: str, token: str, chat: str) -> None:
    """Route a /command message; sends replies directly."""
    cmd = text.split(None, 1)[0].lower().lstrip("/").split("@", 1)[0]
    if cmd in ("start", "help"):
        _send(token, chat, _help_text(), _menu_buttons())
    elif cmd == "menu":
        _send(token, chat, "What would you like to do?", _menu_buttons())
    elif cmd in ("today", "digest"):
        _send_daily_update(token, chat)
    elif cmd in ("find", "opportunities", "opps"):
        _send_opportunities(token, chat)
    elif cmd == "draft":
        msg_html, buttons = _handle_draft_command(text)
        _send(token, chat, msg_html, buttons)
    elif cmd == "reset":
        _send(token, chat, _reset_chat(chat))
    else:
        _send(token, chat, "Unknown command. Tap a button or /help.", _menu_buttons())


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

    _ensure_commands_registered(token)

    # Resume from the persisted offset so a fresh `--once` process doesn't
    # re-handle already-seen updates (passing it also acks everything prior).
    offset = _load_offset()
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
            # Ack BEFORE handling: at-most-once, so an overlapping 4s `--once`
            # pass can't double-process a slow (LLM) handler.
            _save_offset(offset)
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
                if action == "menu":
                    try:
                        toast = _handle_menu(oid, token, chat)
                    except Exception as e:
                        toast = "Error"
                        if chat:
                            _send(token, chat, f"⚠️ {notify._esc(str(e))}")
                    _answer(token, cb_id, toast)
                    handled += 1
                    continue
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
                text = (msg_obj.get("text") or "").strip()
                if not chat or not text:
                    continue
                try:
                    if text.startswith("/"):
                        _handle_command_message(text, token, chat)
                    else:
                        _send_typing(token, chat)
                        _send(token, chat, _chat_reply(chat, text))
                except Exception as e:
                    _send(token, chat, f"⚠️ {notify._esc(str(e))}")
                handled += 1
                continue

        if once:
            break

    return {"stopped": True, "handled": handled}
