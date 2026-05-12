"""Persona agents — single-lens learning agents that auto-ingest every
post relevant to their goal across all collected topics.

Public surface re-exports the CRUD + ingest + chat entrypoints used by
the CLI, the Tauri sidecar, and the MCP server.
"""
from .store import (
    create_persona,
    list_personas,
    get_persona,
    update_persona,
    delete_persona,
    persona_stats,
    list_memories,
)
from .ingest import ingest_persona, ingest_all_personas
from .chat import chat_persona
from .graph import (
    backfill_persona,
    embed_and_link,
    graph_payload,
    is_available as graph_is_available,
    list_edges,
)

__all__ = [
    "create_persona",
    "list_personas",
    "get_persona",
    "update_persona",
    "delete_persona",
    "persona_stats",
    "list_memories",
    "ingest_persona",
    "ingest_all_personas",
    "chat_persona",
    "backfill_persona",
    "embed_and_link",
    "graph_payload",
    "graph_is_available",
    "list_edges",
]
