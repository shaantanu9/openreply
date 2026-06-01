# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_submodules
from PyInstaller.utils.hooks import collect_all

datas = [('prompts', 'prompts')]
binaries = []
hiddenimports = ['openai', 'anthropic']
hiddenimports += collect_submodules('praw')
hiddenimports += collect_submodules('prawcore')
hiddenimports += collect_submodules('sqlite_utils')
hiddenimports += collect_submodules('openai')
hiddenimports += collect_submodules('anthropic')
hiddenimports += collect_submodules('httpx')
tmp_ret = collect_all('gapmap')
datas += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]

# Phase 15 — explicit collect_all for deps that PyInstaller's static
# analysis genuinely misses. `collect_all('gapmap')` walks source files
# and resolves most function-body imports, but a handful of deps have
# data files (datasets, ONNX models, locale bundles) PyInstaller can't
# infer. Add only those here — adding everything balloons DMG size by
# ~100 MB without buying coverage.
#
# Verified on 2026-05-25 that without this block, PYZ already contains:
#   google_play_scraper, feedparser, chromadb, lxml, faster_whisper,
#   opendataloader_pdf, docx, pptx, pypandoc, markdownify, bs4, pytrends
# So they don't need to be listed.
for _pkg in (
    'fastmcp',         # MCP framework — non-pkg sub-imports load lazily
    'rank_bm25',       # transitive multiprocessing import that PyInstaller
                       # warns about (missing module named multiprocessing.Pool)
    'psutil',          # used by stale-MCP zombie cleanup; gracefully degrades
                       # via try/except, but explicit collect keeps the path
                       # available so users see clean shutdowns
    # Audience clustering (research/_clustering.py). sklearn is LAZY-imported
    # inside `_lazy_sklearn()`, so collect_all('gapmap') static analysis never
    # sees it — without these the bundled binary ImportErrors and the tab
    # silently degrades to the slower pure-numpy fallback. scipy/joblib/
    # threadpoolctl are sklearn's runtime deps; sklearn also ships compiled
    # .so extension modules + small data files collect_all picks up.
    'sklearn',
    'scipy',
    'joblib',
    'threadpoolctl',
    # chromadb (palace RAG store) imports its telemetry backend DYNAMICALLY
    # via importlib — `collect_all('gapmap')` static analysis reaches chromadb's
    # top level but NOT `chromadb.telemetry.product.posthog`, so the bundled
    # binary raised `ModuleNotFoundError: No module named
    # 'chromadb.telemetry.product.posthog'` the moment any palace-grounded chat
    # / RAG query ran — surfacing in the app as a chat that starts then dies
    # (empty reply → "Provider may be unreachable" 5-min timeout). collect_all
    # pulls in all 128 chromadb submodules so the dynamic import resolves.
    # Verified 2026-06-01 via collect_submodules('chromadb').
    'chromadb',
):
    try:
        _d, _b, _h = collect_all(_pkg)
        datas += _d; binaries += _b; hiddenimports += _h
    except Exception:
        pass  # survive slim CI envs without the extras group installed


a = Analysis(
    ['scripts/pyinstaller-entrypoint.py'],
    pathex=['src'],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='gapmap-cli',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    # UPX corrupts compiled extension modules (.so/.dylib) on macOS arm64 —
    # the PyInstaller bootloader then fails at runtime with
    # "decompression resulted in return code -1!" on entries like
    # __mypyc.cpython-311-darwin.so and hf_xet/hf_xet.abi3.so, which 255-exits
    # the sidecar and breaks every data/LLM/MCP feature on a fresh install.
    # Keep UPX OFF. (Larger binary is the price; correctness wins.)
    upx=False,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
