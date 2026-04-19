"""CLI subpackage.

Do NOT eager-import `main` here. The Tauri sidecar launches this CLI via
`python -m reddit_research.cli.main`, and runpy refuses to run a module as
`__main__` cleanly if it already sits in `sys.modules` from a package
import. Eager-importing `main` here triggered:

    RuntimeWarning: 'reddit_research.cli.main' found in sys.modules after
    import of package 'reddit_research.cli', but prior to execution of
    'reddit_research.cli.main'; this may result in unpredictable behaviour

Callers that want the Typer app should import it explicitly:

    from reddit_research.cli.main import app

Keeping this module intentionally empty preserves that invariant.
"""
