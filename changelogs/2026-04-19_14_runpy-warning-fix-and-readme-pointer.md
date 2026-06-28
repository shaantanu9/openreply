# Fix runpy RuntimeWarning + README points at HOW_TO_USE

**Date:** 2026-04-19
**Type:** Fix / Documentation

## Summary

Running the sidecar via `python -m reddit_research.cli.main` printed:

```
<frozen runpy>:128: RuntimeWarning: 'reddit_research.cli.main' found in
sys.modules after import of package 'reddit_research.cli', but prior to
execution of 'reddit_research.cli.main'; this may result in unpredictable
behaviour
```

Cause: `src/reddit_research/cli/__init__.py` eagerly imported `.main`. When
runpy later tried to execute `reddit_research.cli.main` as `__main__`, the
module was already in `sys.modules` from that package-import, so runpy
emitted the warning — and technically risks executing module-level code a
second time under the new `__main__` name (Typer command registration,
dataclass validation, etc.).

Nothing in the codebase actually imported `app` from
`reddit_research.cli`; every caller uses the full path
`reddit_research.cli.main:app`. So removing the preload is the clean fix.

Also added a `> **New:**` pointer at the top of the root `README.md` so the
recently-added `docs/HOW_TO_USE.md` walk-through is discoverable from the
project homepage.

## Changes

- `src/reddit_research/cli/__init__.py` — removed `from .main import app` and
  `__all__ = ["app"]`. Replaced with a module docstring explaining why the
  preload is intentionally absent, citing the exact RuntimeWarning.
- `src/reddit_research/cli/main.py` — updated the ingest Typer subcommand's
  `help=` string from `"CSV / JSON / TXT / VTT / SRT / MD"` to
  `"CSV / JSON / TXT / VTT / SRT / MD / PDF"` so the help output matches
  reality after the earlier PDF-ingest bundle.
- `README.md` — new blockquote pointing readers at `docs/HOW_TO_USE.md`.

## Verification

```
$ .venv/bin/python -W default -m reddit_research.cli.main --help
Usage: python -m reddit_research.cli.main [OPTIONS] COMMAND [ARGS]...
…
```

No `<frozen runpy>` RuntimeWarning. Before the fix the warning appeared on
every sidecar spawn (and therefore on every Tauri command that invoked the
CLI). Now the `-W default` run is clean.

Sidecar behavior is unchanged — Tauri spawns `python -m
reddit_research.cli.main <args>` exactly as before; removing the preload
only changes *when* `main.py` is executed (once, as `__main__`), not
*whether*.

## Files Modified

- `src/reddit_research/cli/__init__.py`
- `src/reddit_research/cli/main.py`
- `README.md`
