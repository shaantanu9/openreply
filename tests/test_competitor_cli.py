import json
from typer.testing import CliRunner
from openreply.cli.competitor_cmds import competitor_app

runner = CliRunner()

def test_add_and_list_json():
    r = runner.invoke(competitor_app, ["add", "--product-id", "cliP",
                                       "--name", "Notion", "--json"])
    assert r.exit_code == 0
    data = json.loads(r.stdout.strip().splitlines()[-1])
    assert data["competitor_name"] == "Notion"

    r2 = runner.invoke(competitor_app, ["list", "--product-id", "cliP", "--json"])
    assert r2.exit_code == 0
    rows = json.loads(r2.stdout.strip().splitlines()[-1])
    assert any(x["competitor_name"] == "Notion" for x in rows)
