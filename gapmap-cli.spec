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
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
