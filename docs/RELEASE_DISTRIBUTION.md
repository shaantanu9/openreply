# OpenReply — Distribution & Bundle Identity (decision doc)

**Date:** 2026-06-28 · **Status:** decision pending (bundle id confirmation)

This is the "advise me" write-up for how to register + launch OpenReply, and the
plan to move off the legacy `com.shantanu.gapmap` bundle id.

---

## 1. Distribution: DMG vs Mac App Store

OpenReply is a **Tauri app that spawns a bundled PyInstaller `gapmap-cli`
sidecar** (network + file I/O + subprocess). That one fact drives everything:

| Path | Uses ASC? | Sidecar OK? | Effort | Verdict |
|---|---|---|---|---|
| **Developer ID + notarized DMG** (current) | No | ✅ Yes | Low (already built) | **Recommended** |
| **Mac App Store** (App Store Connect) | Yes | ⚠️ Very risky | High | Only if MAS is a hard business requirement |

### Why the Mac App Store is risky here
MAS requires the **App Sandbox** + hardened runtime. The sidecar pattern
conflicts with sandbox rules in several ways that typically fail review:
- Executing a bundled standalone binary (`gapmap-cli`) that isn't a normal
  XPC/helper — sandbox restricts arbitrary process execution.
- Open network access + writing outside the container — needs entitlements and
  still trips review for a "scraper/automation" tool.
- PyInstaller extracts to a temp dir at launch — sandbox temp/exec constraints.

To ship on MAS you'd realistically need to **re-architect the sidecar** (embed
Python as an in-process/XPC helper, declare every entitlement, move all writes
into the container). That's a project, not a config change.

### Recommendation
**Stay on Developer ID + notarized DMG** (your existing `release-mac.yml`). It
already works with the sidecar, ships from GitHub Releases, and needs **no ASC
app record**. Notarization uses `notarytool` + a Developer ID cert — *not* ASC.

> If you still want App Store presence later, the right move is a thin separate
> "lite" build or the sidecar re-architecture above — tracked as future scope.

### What "ASC" actually buys you (if you insist on MAS)
- An **App Store Connect app record** (name, bundle id, category, privacy).
- TestFlight for macOS + App Store review + listing.
- Requires: Apple Developer Program, an **App Store provisioning profile**, a
  **Mac App Distribution** cert, sandbox entitlements, and a passing review.

---

## 2. Bundle identifier migration

Current id `com.shantanu.gapmap` is a dev-era name. A "proper" id should be a
reverse-domain you **own** (ASC verifies nothing, but it must be unique + stable
forever). Given the `myind-ai` org / myind.ai, the recommendation is:

**Recommended:** `ai.myind.openreply`  *(alt: `com.shantanu.openreply`)*

### The cascade (everywhere the id is wired)
| Where | What it controls | File |
|---|---|---|
| `identifier` | the bundle id | `tauri.conf.json` |
| `_TAURI_BUNDLE_ID` | Python data-dir resolution | `src/gapmap/core/config.py` |
| data dir | `~/Library/Application Support/<id>/gapmap` | derived |
| launchd label | `<id>.schedule` plist | `src-tauri/src/schedule.rs` |
| licence | device-binding + JWT `aud` (`gapmap-desktop`) | `commands.rs` activation |
| MCP id | the server id installed into Claude clients | mcp install |

### Migration plan (no user loses data/licence)
`config.py` already migrates the older `reddit-myind` → `gapmap` layout. We
extend the same idea: on first launch under the **new** id, if the new app-data
dir is empty and the old `com.shantanu.gapmap/gapmap` dir exists, **move/copy it
over** (DB + palace + exports + `license_*`). Steps:
1. `tauri.conf.json` `identifier` → new id.
2. `config.py` `_TAURI_BUNDLE_ID` → new id + add `com.shantanu.gapmap` to the
   legacy-migration chain.
3. `schedule.rs` — uninstall the old `com.shantanu.gapmap.schedule` plist, install
   under the new label (handle the rename so we don't leave an orphan).
4. Licence: the JWT **audience stays `gapmap-desktop`** (server-side constant) —
   only the device-dir path moves, so existing tokens keep validating. Confirm
   with the activation-suite before flipping.
5. MCP: re-install writes the new server id; old entry pruned.
6. Bump version, rebuild, re-notarize.

**Risk note:** because the licence is device-bound via the data dir, the
migration must copy `license_token` + `license_state.json` into the new dir in
the same pass, or users must re-activate. The migration handles this.

---

## 3. What I need from you to proceed

1. **Confirm the bundle id** — `ai.myind.openreply`, `com.shantanu.openreply`, or
   your own. (I won't flip it until you confirm — it's effectively permanent.)
2. **Distribution choice** — stay DMG (recommended) or pursue MAS (I'll scope the
   sidecar re-architecture first).
3. **For any ASC step** (only if MAS): Apple **Team ID** + an **ASC API key**
   (Issuer ID + Key ID + .p8). I will not register/upload without these + your
   explicit go-ahead.

## 4. Next actions once you confirm the id
- [ ] Implement the bundle-id migration (steps 1–5 above) behind one commit.
- [ ] Verify: fresh install lands new dir; upgrade install migrates old data +
      licence; scheduler re-registers; MCP re-installs.
- [ ] Rebuild + notarize a DMG under the new id; smoke-test activation.
- [ ] (If MAS) scope the sandbox/sidecar work as a separate spec.
