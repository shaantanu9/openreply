"""Competitor Intelligence CLI. Registered into the main app from cli/main.py."""
from __future__ import annotations

import json

import typer

from ..research import competitor_intel as CI
from ..research.competitor_intel.enrich import enrich_seed

competitor_app = typer.Typer(help="Competitor Intelligence — track & analyze competitors.")


def _emit(obj, as_json: bool):
    if as_json:
        typer.echo(json.dumps(obj, default=str))
    else:
        typer.echo(obj)


@competitor_app.command("add")
def cmd_add(
    product_id: str = typer.Option(..., "--product-id"),
    name: str = typer.Option(..., "--name"),
    website: str = typer.Option("", "--website"),
    daily_fetch: bool = typer.Option(False, "--daily-fetch"),
    as_json: bool = typer.Option(False, "--json"),
):
    out = CI.add_competitor(product_id, name, website=website, daily_fetch=daily_fetch)
    _emit(out, as_json)


@competitor_app.command("list")
def cmd_list(
    product_id: str = typer.Option(..., "--product-id"),
    active_only: bool = typer.Option(False, "--active-only"),
    as_json: bool = typer.Option(False, "--json"),
):
    _emit(CI.list_competitors(product_id, active_only=active_only), as_json)


@competitor_app.command("show")
def cmd_show(
    product_id: str = typer.Option(..., "--product-id"),
    name: str = typer.Option(..., "--name"),
    as_json: bool = typer.Option(False, "--json"),
):
    _emit(CI.get_competitor(product_id, name), as_json)


@competitor_app.command("enrich")
def cmd_enrich(
    name: str = typer.Option(..., "--name"),
    website: str = typer.Option("", "--website"),
    provider: str = typer.Option(None, "--provider"),
    as_json: bool = typer.Option(False, "--json"),
):
    _emit(enrich_seed(name, website=website, provider=provider), as_json)


@competitor_app.command("run")
def cmd_run(
    product_id: str = typer.Option(..., "--product-id"),
    name: str = typer.Option(..., "--name"),
    provider: str = typer.Option(None, "--provider"),
    as_json: bool = typer.Option(False, "--json"),
):
    _emit(CI.run_competitor_sweep(product_id, name, provider=provider), as_json)


@competitor_app.command("findings")
def cmd_findings(
    product_id: str = typer.Option(..., "--product-id"),
    name: str = typer.Option(None, "--name"),
    as_json: bool = typer.Option(False, "--json"),
):
    _emit(CI.list_findings(product_id, name), as_json)


@competitor_app.command("opportunities")
def cmd_opps(
    product_id: str = typer.Option(..., "--product-id"),
    name: str = typer.Option(None, "--name"),
    as_json: bool = typer.Option(False, "--json"),
):
    _emit(CI.list_opportunities(product_id, name), as_json)


@competitor_app.command("compare")
def cmd_compare(
    product_id: str = typer.Option(..., "--product-id"),
    provider: str = typer.Option(None, "--provider"),
    as_json: bool = typer.Option(False, "--json"),
):
    _emit(CI.build_comparison(product_id, provider=provider), as_json)


@competitor_app.command("set-action")
def cmd_set_action(
    signal_id: str = typer.Option(..., "--signal-id"),
    action: str = typer.Option(..., "--action"),
    as_json: bool = typer.Option(False, "--json"),
):
    _emit(CI.set_signal_action(signal_id, action), as_json)


@competitor_app.command("remove")
def cmd_remove(
    product_id: str = typer.Option(..., "--product-id"),
    name: str = typer.Option(..., "--name"),
    as_json: bool = typer.Option(False, "--json"),
):
    _emit({"removed": CI.remove_competitor(product_id, name)}, as_json)
