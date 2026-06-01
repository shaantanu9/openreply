#!/bin/bash
# Sidecar launcher (onedir indirection) — committed so CI can stage it as the
# macOS externalBin without an in-YAML heredoc.
#
# The Python sidecar ships as a PyInstaller ONEDIR bundle (not onefile) so it
# never re-extracts ~390 MB to a /var/folders/_MEI… temp dir on every spawn
# (that was ~36 s/spawn under macOS Gatekeeper + a temp leak per crash → chat
# timeouts + disk-fill). Onedir lives under Contents/Resources/ and spawns in
# <1 s once warm.
#
# Tauri's externalBin mechanism copies THIS script to Contents/MacOS/gapmap-cli,
# so both the streaming path (`app.shell().sidecar("gapmap-cli")`) and the
# warm-daemon path (`resolve_bundled_sidecar()` → current_exe dir) keep
# resolving "gapmap-cli" unchanged. We just `exec` the real onedir exe — exec
# replaces the process image, so the PID Rust tracks for cancel and the piped
# stdin/stdout/stderr are all preserved.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"

# 1) Explicit override (Rust may set this if it resolves the path itself).
if [ -n "${GAPMAP_ONEDIR_EXE:-}" ] && [ -x "${GAPMAP_ONEDIR_EXE}" ]; then
  exec "${GAPMAP_ONEDIR_EXE}" "$@"
fi

# 2) Known candidate layouts relative to Contents/MacOS/.
for c in \
  "$HERE/../Resources/binaries/gapmap-cli-onedir/gapmap-cli" \
  "$HERE/../Resources/gapmap-cli-onedir/gapmap-cli" \
  "$HERE/../Resources/_up_/binaries/gapmap-cli-onedir/gapmap-cli" \
  "$HERE/gapmap-cli-onedir/gapmap-cli"; do
  if [ -x "$c" ]; then exec "$c" "$@"; fi
done

# 3) Bounded fallback search under Resources (handles any Tauri layout drift).
RES="$HERE/../Resources"
if [ -d "$RES" ]; then
  FOUND="$(/usr/bin/find "$RES" -maxdepth 4 -type f -name gapmap-cli -perm -111 2>/dev/null | head -1)"
  if [ -n "$FOUND" ] && [ -x "$FOUND" ]; then exec "$FOUND" "$@"; fi
fi

echo "gapmap-cli: onedir engine not found near $HERE (looked in ../Resources)" >&2
exit 127
