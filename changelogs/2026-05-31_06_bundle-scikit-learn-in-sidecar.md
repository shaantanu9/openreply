# Ship scikit-learn with the app (declared dep + bundled in sidecar)

**Date:** 2026-05-31
**Type:** Fix (build / packaging)

## Summary

Follow-up to `2026-05-31_05` (numpy clustering fallback): make the **preferred**
scikit-learn path actually available in the installed app instead of always
degrading to the numpy fallback. scikit-learn is now a declared dependency
(installed by `uv sync` / on `pip install`) and is explicitly bundled into the
PyInstaller sidecar so the DMG ships it.

## Changes

- **`pyproject.toml`** — added `scikit-learn>=1.4` to base `dependencies` (not
  an extra): Audience is a first-class feature and the old "sklearn is a
  transitive dep of chromadb" assumption was false. `uv add` pulled in
  `scikit-learn 1.8.0` + `joblib` + `threadpoolctl` and updated `uv.lock`.
- **`uv.lock`** — regenerated with scikit-learn / joblib / threadpoolctl pinned.
- **`gapmap-cli.spec`** — added `sklearn`, `scipy`, `joblib`, `threadpoolctl`
  to the explicit `collect_all` loop. sklearn is lazy-imported inside
  `_lazy_sklearn()`, so `collect_all('gapmap')` static analysis never saw it
  (Phase 15 of the tauri-python-sidecar-app skill) — without this the bundled
  binary would still miss sklearn and silently use the numpy fallback.
- **Sidecar binary rebuilt** (`scripts/build-pyinstaller.sh`) so the local
  `src-tauri/binaries/gapmap-cli-aarch64-apple-darwin` ships sklearn, then
  ad-hoc re-codesigned. (Binary is gitignored — not committed. CI / x86_64
  builds pick up sklearn automatically from the spec + lock.)

## Behaviour

- Dev (`.venv`) and the rebuilt bundle now report `backend=sklearn` from
  `kmeans_with_silhouette`.
- The numpy fallback from `_05` remains for slim installs that omit sklearn —
  belt-and-braces, no longer the default.

## Files Modified

- `pyproject.toml` — `scikit-learn>=1.4` base dependency + rationale comment.
- `uv.lock` — scikit-learn / joblib / threadpoolctl.
- `gapmap-cli.spec` — bundle sklearn + scipy + joblib + threadpoolctl.

## Verification

- `kmeans_with_silhouette` on separated blobs → `ok=True, backend=sklearn`.
- `pytest tests/test_clustering_fallback.py` — 4/4 pass.
- Sidecar rebuild smoke-tested (`gapmap-cli info` + clustering uses sklearn).

## Notes

- The committed change set (pyproject + uv.lock + spec) is what makes EVERY
  future build/DMG include sklearn. The binary itself is gitignored; the local
  rebuild + codesign is so the developer's local `tauri build` is correct now.
