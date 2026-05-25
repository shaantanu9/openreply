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

# Phase 15 — explicit collect_all for every lazy-imported dep in
# src/gapmap/. PyInstaller's static analysis usually finds these via
# `collect_all('gapmap')`, but belt-and-suspenders matters: a single
# `from pkg import …` inside a function body that gets missed = silent
# 0-result failure for that source in the DMG. Verified bundled on
# 2026-05-25.
for _pkg in (
    # Source adapters
    'google_play_scraper', 'pytrends', 'feedparser', 'sgmllib3k',
    'lxml', 'markdownify', 'bs4',
    # Document / paper pipeline
    'pypdf', 'opendataloader_pdf', 'docx', 'pptx', 'pypandoc',
    # Graph + science
    'networkx', 'scipy', 'sklearn', 'pandas',
    # Retrieval palace
    'chromadb', 'rank_bm25',
    # Video / transcription
    'yt_dlp', 'faster_whisper', 'huggingface_hub', 'packaging',
    # MCP
    'fastmcp',
    # Misc that may be lazy
    'psutil', 'dotenv', 'yaml',
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
