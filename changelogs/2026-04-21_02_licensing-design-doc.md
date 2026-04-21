# Licensing — technical design doc + keypair + mint scripts

**Date:** 2026-04-21
**Type:** Infrastructure + Documentation

## Summary

Scaffolded Gap Map's offline-first licensing system and wrote the full technical design doc. The Ed25519 keypair is generated, mint + keygen scripts work, and `docs/licensing.md` documents every detail of how licenses work without the app ever going online.

## Changes

- Generated a live Ed25519 keypair for license signing.
  - Private: `scripts/licenses/.keys/private.b64` (chmod 600, gitignored).
  - Public: embedded base64 (`Ryg/tbxB4fD3xgXJ6vfLervRw+kLZ+SPcl+waMXyHuM=`), will be hardcoded into `app-tauri/src/lib/license.js` during the implementation pass.
- `scripts/licenses/generate-keys.mjs` — one-time keypair generator with an overwrite guard that refuses to re-run on an existing key (would invalidate every already-issued license).
- `scripts/licenses/mint-license.mjs` — CLI mint tool. Takes `--email`, `--tier` (personal|family|team), optional `--seats`, `--purchase-id`. Emits a single base64 blob (`signature[64] || payload_json`). Smoke-tested.
- `.gitignore` — added `scripts/licenses/.keys/` so the private key cannot leak into history.
- `docs/licensing.md` — 14-section technical design covering: Ed25519 rationale, blob format, device-UUID strategy per OS, seat-limit state machine, concurrency semantics, offline-first guarantees, attack surface, trial mechanics, file layouts, operational flows (manual + Gumroad webhook), implementation contract, test plan, and a summary of guarantees.

## Files Created

- `scripts/licenses/generate-keys.mjs`
- `scripts/licenses/mint-license.mjs`
- `scripts/licenses/.keys/private.b64` (gitignored)
- `scripts/licenses/.keys/public.b64`
- `docs/licensing.md`
- `changelogs/2026-04-21_02_licensing-design-doc.md`

## Files Modified

- `.gitignore` — added `scripts/licenses/.keys/`.

## Verification

- `node scripts/licenses/mint-license.mjs --email test@gap.map --tier personal` emits a valid base64 blob.
- Re-running `generate-keys.mjs` refuses to overwrite (tested manually).
- Public key (32-byte base64, 44 chars) documented so it can be embedded verbatim in the app.

## Not yet done (deliberately)

Implementation of the app-side verifier + UI is the next pass. This commit is intentionally docs + tooling only so the licensing design can be reviewed/iterated before code locks it in.
