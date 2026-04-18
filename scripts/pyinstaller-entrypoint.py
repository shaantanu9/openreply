"""PyInstaller entry point — uses absolute imports so the bundled binary works.

PyInstaller takes the entry script out of its package context, which breaks
relative imports like `from ..core.config import load_config`. This wrapper
imports from the top-level package so everything resolves cleanly.
"""
from reddit_research.cli.main import app

if __name__ == "__main__":
    app()
