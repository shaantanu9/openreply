"""`openreply chat ...` — persistent agent conversation threads.

Each conversation is a JSON message array saved to the `chat_conversations`
table. The Tauri UI is the primary consumer; these CLI commands are the
sidecar bridge that performs the actual reads and writes.
"""
from __future__ import annotations

import json

import typer

from ..core.db import (
    delete_chat_conversation,
    get_chat_conversation,
    list_chat_conversations,
    rename_chat_conversation,
    save_chat_conversation,
)
from ..reply import agent as _agent
from ..reply.chat import chat_with_agent

chat_app = typer.Typer(help="Persistent chat conversations with your agent.")


def _out(obj, as_json: bool) -> None:
    if as_json:
        typer.echo(json.dumps(obj, default=str, ensure_ascii=False, indent=2))
    else:
        typer.echo(json.dumps(obj, default=str, ensure_ascii=False, indent=2))


@chat_app.command("list")
def list_cmd(
    topic: str = typer.Option(None, help="Filter to one topic/agent topic"),
    limit: int = typer.Option(200, help="Max conversations to return"),
    as_json: bool = typer.Option(True, "--json/--no-json"),
):
    """List saved conversations, newest first."""
    rows = list_chat_conversations(topic=topic, limit=limit)
    _out({"ok": True, "conversations": rows}, as_json)


@chat_app.command("get")
def get_cmd(
    id: str = typer.Argument(..., help="Conversation id"),
    as_json: bool = typer.Option(True, "--json/--no-json"),
):
    """Fetch a single conversation with its messages."""
    conv = get_chat_conversation(id)
    if not conv:
        _out({"ok": False, "error": f"conversation '{id}' not found"}, as_json)
        raise typer.Exit(1)
    _out({"ok": True, "conversation": conv}, as_json)


@chat_app.command("save")
def save_cmd(
    id: str = typer.Argument(..., help="Conversation id (client-generated UUID)"),
    topic: str = typer.Option("", help="Topic / agent scope"),
    title: str = typer.Option("", help="Display title (auto from first user message if blank)"),
    messages: str = typer.Option(..., "--messages", help="JSON array of message objects"),
    as_json: bool = typer.Option(True, "--json/--no-json"),
):
    """Create or update a conversation."""
    try:
        msgs = json.loads(messages or "[]")
    except json.JSONDecodeError as e:
        _out({"ok": False, "error": f"invalid messages JSON: {e}"}, as_json)
        raise typer.Exit(1)
    conv = save_chat_conversation(
        conv_id=id,
        topic=topic,
        messages=msgs,
        title=title or None,
    )
    # Return metadata only to keep the payload small; caller already has messages.
    _out({
        "ok": True,
        "conversation": {
            "id": conv["id"],
            "topic": conv["topic"],
            "title": conv["title"],
            "msg_count": conv["msg_count"],
            "created_at": conv["created_at"],
            "updated_at": conv["updated_at"],
        },
    }, as_json)


@chat_app.command("rename")
def rename_cmd(
    id: str = typer.Argument(..., help="Conversation id"),
    title: str = typer.Argument(..., help="New title"),
    as_json: bool = typer.Option(True, "--json/--no-json"),
):
    """Rename a conversation."""
    conv = rename_chat_conversation(id, title)
    if not conv:
        _out({"ok": False, "error": f"conversation '{id}' not found"}, as_json)
        raise typer.Exit(1)
    _out({"ok": True, "conversation": conv}, as_json)


@chat_app.command("delete")
def delete_cmd(
    id: str = typer.Argument(..., help="Conversation id"),
    as_json: bool = typer.Option(True, "--json/--no-json"),
):
    """Delete a conversation permanently."""
    ok = delete_chat_conversation(id)
    _out({"ok": ok, "deleted": ok, "id": id}, as_json)


@chat_app.command("ask")
def ask_cmd(
    question: str = typer.Argument(..., help="Question to ask"),
    id: str = typer.Option(None, help="Conversation id to continue (creates one if omitted)"),
    agent_id: str = typer.Option(None, "--agent", help="Agent id (default: active)"),
    k_corpus: int = typer.Option(6, "--k-corpus"),
    k_graph: int = typer.Option(6, "--k-graph"),
    provider: str = typer.Option(None, "--provider"),
    as_json: bool = typer.Option(True, "--json/--no-json"),
):
    """Ask the agent a question and optionally continue an existing conversation.

    Loads the conversation history, runs the chat, appends the new turn, and
    saves the updated thread back to the database.
    """
    import uuid

    conv_id = id or str(uuid.uuid4())
    prior = get_chat_conversation(conv_id) if id else None
    history = (prior.get("messages") or []) if prior else []

    result = chat_with_agent(
        question,
        agent_id=agent_id,
        k_corpus=k_corpus,
        k_graph=k_graph,
        provider=provider,
        history=history,
    )
    if not result.get("ok"):
        _out(result, as_json)
        raise typer.Exit(1)

    agent = _agent.get_agent(result.get("agent_id"))
    topic = (agent.get("topic") or agent.get("name") or "") if agent else ""

    messages = list(history)
    messages.append({"role": "user", "content": question})
    messages.append({"role": "assistant", "content": result.get("answer") or ""})

    save_chat_conversation(
        conv_id=conv_id,
        topic=topic,
        messages=messages,
        title=prior.get("title") if prior else None,
    )

    _out({"ok": True, "conversation_id": conv_id, **result}, as_json)
