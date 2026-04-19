# -*- mode: python ; coding: utf-8 -*-
import os
import urllib.request
from pathlib import Path
from PyInstaller.utils.hooks import collect_submodules
from PyInstaller.utils.hooks import collect_all


# ─── Pre-download + bundle the ONNX embedding model ────────────────────────
#
# ChromaDB's default embedder fetches `all-MiniLM-L6-v2/onnx.tar.gz` (79 MB)
# on first embed() call, from a slow S3 bucket that frequently times out.
# That's unacceptable UX for a fresh DMG install — user would wait minutes
# on first semantic search. Pre-download during spec evaluation and bake
# the tar.gz into the sidecar bundle; at runtime we copy it to
# `~/.cache/chroma/onnx_models/all-MiniLM-L6-v2/` so chromadb finds it
# without ever touching the network.
#
# Controlled by GAPMAP_BUNDLE_ONNX env var (default: 1). Set to 0 to ship
# a lean binary without the model — users then download via Settings.
_ONNX_URL = "https://chroma-onnx-models.s3.amazonaws.com/all-MiniLM-L6-v2/onnx.tar.gz"
_ONNX_DIR = Path("scripts/onnx-model-cache/all-MiniLM-L6-v2")
_ONNX_TAR = _ONNX_DIR / "onnx.tar.gz"

if os.getenv("GAPMAP_BUNDLE_ONNX", "1") not in ("0", "false", "no"):
    _ONNX_DIR.mkdir(parents=True, exist_ok=True)
    if not _ONNX_TAR.exists() or _ONNX_TAR.stat().st_size < 70_000_000:
        print(f"[spec] downloading ONNX model → {_ONNX_TAR} (~79 MB, one-time per build host)")
        try:
            # Simple urllib retry loop — S3 CDN throttles aggressively.
            for attempt in range(3):
                try:
                    urllib.request.urlretrieve(_ONNX_URL, _ONNX_TAR)
                    break
                except Exception as e:
                    if attempt == 2:
                        raise
                    print(f"[spec] download attempt {attempt+1} failed: {e}; retrying")
        except Exception as e:
            print(f"[spec] WARN: ONNX bundle download failed ({e}). "
                  f"Bundle will ship without the model; users will download on first Enable.")
    else:
        print(f"[spec] ONNX model already cached at {_ONNX_TAR} ({_ONNX_TAR.stat().st_size} bytes)")


datas = [('prompts', 'prompts')]
# Ship the pre-downloaded ONNX model alongside the binary when the file
# exists. Path inside the bundle: `bundled_onnx/onnx.tar.gz`. At runtime
# `palace.ensure_model()` copies from this path into the user's chroma
# cache dir on first use.
if _ONNX_TAR.exists() and _ONNX_TAR.stat().st_size > 70_000_000:
    datas.append((str(_ONNX_TAR), 'bundled_onnx'))
    print(f"[spec] bundling {_ONNX_TAR.stat().st_size} bytes of ONNX model into sidecar")
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

# ─── Semantic-search palace (ChromaDB) ─────────────────────────────────────
# collect_all pulls data files (the bundled ONNX model), binaries (the
# C-ext SQLite + onnxruntime shared libs), and every submodule path. Wrapped
# in try/except so builds still work if the `retrieval` extras group isn't
# installed (e.g. CI that wants a slim binary).
for _pkg in ('chromadb', 'chromadb.utils', 'onnxruntime', 'tokenizers',
             'rank_bm25', 'sentence_transformers'):
    try:
        _d, _b, _h = collect_all(_pkg)
        datas += _d; binaries += _b; hiddenimports += _h
    except Exception:
        pass
hiddenimports += collect_submodules('chromadb')


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
