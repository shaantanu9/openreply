"""Competitor Intelligence sub-server — MCP tools.

Mounted into the main server without a namespace prefix so all tools
keep the `openreply_competitor_*` naming convention consistent with the rest
of the surface.
"""
from __future__ import annotations

from fastmcp import FastMCP

competitor_server = FastMCP("CompetitorTools")


@competitor_server.tool()
def openreply_competitor_add(
    product_id: str, name: str, website: str = "", daily_fetch: bool = False
) -> dict:
    """Add a competitor to track for a product."""
    from ...research import competitor_intel as CI

    return CI.add_competitor(product_id, name, website=website, daily_fetch=daily_fetch)


@competitor_server.tool()
def openreply_competitor_list(product_id: str, active_only: bool = False) -> list:
    """List tracked competitors for a product."""
    from ...research import competitor_intel as CI

    return CI.list_competitors(product_id, active_only=active_only)


@competitor_server.tool()
def openreply_competitor_get(product_id: str, name: str) -> dict:
    """Get one tracked competitor's full config."""
    from ...research import competitor_intel as CI

    return CI.get_competitor(product_id, name)


@competitor_server.tool()
def openreply_competitor_enrich(name: str, website: str = "", provider: str | None = None) -> dict:
    """Auto-suggest aliases/subreddits/URLs for a competitor name."""
    from ...research.competitor_intel.enrich import enrich_seed

    return enrich_seed(name, website=website, provider=provider)


@competitor_server.tool()
def openreply_competitor_run(product_id: str, name: str, provider: str | None = None) -> dict:
    """Run a competitor sweep (fetch + analyze + snapshot)."""
    from ...research import competitor_intel as CI

    return CI.run_competitor_sweep(product_id, name, provider=provider)


@competitor_server.tool()
def openreply_competitor_findings(product_id: str, name: str = None) -> list:
    """List competitor complaints/feature-gaps (findings)."""
    from ...research import competitor_intel as CI

    return CI.list_findings(product_id, name)


@competitor_server.tool()
def openreply_competitor_opportunities(product_id: str, name: str = None) -> list:
    """List opportunities (gaps competitors leave open)."""
    from ...research import competitor_intel as CI

    return CI.list_opportunities(product_id, name)


@competitor_server.tool()
def openreply_competitor_compare(product_id: str, provider: str | None = None) -> dict:
    """Head-to-head: your product vs each competitor."""
    from ...research import competitor_intel as CI

    return CI.build_comparison(product_id, provider=provider)


@competitor_server.tool()
def openreply_competitor_set_action(signal_id: str, action: str) -> dict:
    """Set a lifecycle action on a finding/opportunity (dismissed|acted|snoozed|hypothesis)."""
    from ...research import competitor_intel as CI

    return CI.set_signal_action(signal_id, action)


@competitor_server.tool()
def openreply_competitor_remove(product_id: str, name: str) -> dict:
    """Stop tracking a competitor."""
    from ...research import competitor_intel as CI

    return {"removed": CI.remove_competitor(product_id, name)}
