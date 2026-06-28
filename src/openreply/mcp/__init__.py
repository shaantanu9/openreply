# Lazy re-export so importing siblings (mcp.install) doesn't pull in fastmcp,
# which is an optional extra. `from openreply.mcp.install import ...`
# now works even when the `[mcp]` extra isn't installed.
__all__ = ["run"]


def __getattr__(name):
    if name == "run":
        from .server import run as _run
        return _run
    raise AttributeError(name)
