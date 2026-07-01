"""Test competitor_tools MCP sub-server registration."""
import openreply.mcp.tools.competitor_tools as CT


def test_competitor_server_registers_tools():
    """Verify all 10 competitor tools are defined and callable."""
    assert CT.competitor_server is not None
    expected = [
        "openreply_competitor_add",
        "openreply_competitor_list",
        "openreply_competitor_get",
        "openreply_competitor_enrich",
        "openreply_competitor_run",
        "openreply_competitor_findings",
        "openreply_competitor_opportunities",
        "openreply_competitor_compare",
        "openreply_competitor_set_action",
        "openreply_competitor_remove",
    ]
    for name in expected:
        assert callable(getattr(CT, name, None)), f"missing tool {name}"
