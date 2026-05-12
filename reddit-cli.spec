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
tmp_ret = collect_all('reddit_research')
datas += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]


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
    name='reddit-cli',
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
