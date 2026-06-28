# Audience clustering no longer requires scikit-learn (numpy fallback)

**Date:** 2026-05-31
**Type:** Fix (bug)

## Summary

The Audience tab failed with **"clustering failed: sklearn unavailable: No
module named 'sklearn'"** (shown twice — the "Try offline mode" button hits the
same clustering path, so it failed identically).

Root cause: `src/openreply/research/_clustering.py` was written assuming
scikit-learn was transitively present ("Sklearn's k-means is already in the
sidecar's tree … we never add it as a new requirement"). That assumption is
false — `scikit-learn` is **not declared anywhere in `pyproject.toml`** and is
**not installed in the dev venv nor collected in `openreply-cli.spec`** (chromadb
1.5+ doesn't pull it in). `kmeans_with_silhouette()` lazy-imported sklearn,
caught the ImportError, and returned `{ok: False, reason: "sklearn
unavailable"}`, which `build_audience_personas()` surfaced as the UI error with
no fallback.

## Fix

Added a pure-numpy k-means++ + silhouette fallback (`_np_kmeans` /
`_np_silhouette`) inside `kmeans_with_silhouette()`. sklearn stays the
preferred backend when installed; otherwise clustering runs on numpy, which is
**always present whenever clustering runs** (the chromadb MiniLM embedder that
produces the author vectors pulls numpy). This honors the module's original
"zero extra deps" design goal and fixes both the dev venv and the bundled DMG
with **no new dependency, no spec change, no DMG size increase.**

- numpy-only k-means with deterministic k-means++ seeding (pinned seed → stable
  labels across runs), memory-efficient assignment via the
  ‖x-c‖² = ‖x‖²+‖c‖²−2x·c identity.
- numpy silhouette over the O(n²) pairwise distance matrix (fine for the
  tens-to-low-hundreds of authors audience clustering produces).
- Reordered the guards so a too-small/empty input returns its accurate reason
  instead of the (now-irrelevant) sklearn message.
- Result carries `backend: "sklearn" | "numpy"` for observability.
- Corrected the misleading module docstring that caused the original
  assumption.

Verified: `kmeans_with_silhouette` on 3 separated blobs → `ok=True, k=3,
backend=numpy, silhouette=0.987`; `per_cluster_tightness` (audience.py's next
step) consumes the numpy output unchanged.

## Files Modified

- `src/openreply/research/_clustering.py` — `_np_kmeans` + `_np_silhouette`
  helpers; `kmeans_with_silhouette` falls back to numpy when sklearn is
  absent; docstring corrected.

## Files Created

- `tests/test_clustering_fallback.py` — 4 regression tests (clusters without
  sklearn, too-few-samples rejected, empty rejected, deterministic labels).

## Verification

- `pytest tests/test_clustering_fallback.py` — 4/4 pass (was 3 failing before
  the fix).
- `pytest --collect-only` — 102 tests collected, no import regressions.

## Notes

- **Dev mode** (`.venv/bin/python` against source) gets the fix immediately on
  the next CLI spawn — no rebuild needed.
- **Bundled DMG**: requires a sidecar rebuild
  (`pyinstaller openreply-cli.spec` → copy → `codesign --force --deep --sign -`)
  to ship the fix. numpy is already in the bundle, so no spec change is needed.
- Power users who `pip install scikit-learn` still get the (marginally
  better-tested) sklearn path automatically — it's preferred when present.
