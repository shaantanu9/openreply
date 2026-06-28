"""PyInstaller entry point — uses absolute imports so the bundled binary works.

PyInstaller takes the entry script out of its package context, which breaks
relative imports like `from ..core.config import load_config`. This wrapper
imports from the top-level package so everything resolves cleanly.
"""
# Sweep orphaned onefile extraction dirs (_MEIxxxxxx) leaked by killed/hung
# prior launches BEFORE doing anything else. These accumulated to 29 GB and
# filled the disk to 100%, which then made the bootloader itself hang
# mid-extraction. Runs in a daemon thread (never blocks startup) and self-noops
# outside a frozen build. Best-effort: any failure is swallowed.
try:
    from openreply.core.meipass_cleanup import start_background_sweep

    start_background_sweep()
except Exception:
    pass

from openreply.cli.main import app

if __name__ == "__main__":
    app()
