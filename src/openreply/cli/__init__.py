"""CLI subpackage.

Do NOT eager-import `main` here. The Tauri sidecar launches this CLI via
`python -m openreply.cli.main`, and runpy refuses to run a module as
`__main__` cleanly if it already sits in `sys.modules` from a package
import. Eager-importing `main` here triggered:

    RuntimeWarning: 'openreply.cli.main' found in sys.modules after
    import of package 'openreply.cli', but prior to execution of
    'openreply.cli.main'; this may result in unpredictable behaviour

Callers that want the Typer app should import it explicitly:

    from openreply.cli.main import app

Keeping this module intentionally empty preserves that invariant.
"""
