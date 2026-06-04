# Fix: release auto-promote left every release stuck as Draft

**Date:** 2026-06-05
**Type:** Fix (CI / release pipeline)

## Summary

The "promote release to latest if all platforms are uploaded" step in all
three release workflows (and the shared helper script) never fired — every
public release on `myind-ai/gapmap` stayed a **Draft** and the public "Latest"
pointer was stuck on an old tag. Root cause: the required-asset patterns start
with a dash (`-macOS-Apple-Silicon\.dmg$`), so `grep -qE "$pat"` parsed the
pattern as **options** — `-m` is grep's "max count" flag, producing
`grep: invalid max count` and a non-match. Both mac patterns failed, so the
gate always concluded the mac DMGs were "missing" and refused to promote.

Fix: add `--` (end-of-options) before the pattern so a leading-dash regex is
treated as the pattern, not flags: `grep -qE -- "$pat"`.

## Impact

- v0.1.19 was built + signed + notarized on all platforms but sat as a Draft;
  manually published to latest. With this fix, future tags auto-promote once
  the mac DMGs upload (mac-only gate, per the in-step comment).

## Verification

- Reproduced the `invalid max count` error with the OLD form against the real
  v0.1.19 asset names; confirmed the NEW `-- "$pat"` form matches both mac DMG
  patterns. (See session transcript.)

## Files Modified

- `.github/workflows/release-mac.yml` (promote gate grep)
- `.github/workflows/release-windows.yml` (promote gate grep)
- `.github/workflows/release-linux.yml` (promote gate grep)
- `scripts/promote-release-if-complete.sh` (same grep, line 47)
