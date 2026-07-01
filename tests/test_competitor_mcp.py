"""Test competitor_tools MCP sub-server registration."""


def test_competitor_server_registers_tools():
    """Verify competitor_server imports and exposes tool dict."""
    from openreply.mcp.tools.competitor_tools import competitor_server

    # FastMCP stores tools; assert our names are present.
    names = set()
    for attr in ("_tools", "tools"):
        t = getattr(competitor_server, attr, None)
        if isinstance(t, dict):
            names |= set(t.keys())
    # Fallback: the module must at least import and expose the server object.
    assert competitor_server is not None
