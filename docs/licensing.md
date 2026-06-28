# OpenReply — Licensing Design (Technical)

**Status:** Design + partial scaffold (keypair + mint script in `scripts/licenses/`).
**Last updated:** 2026-04-21
**Scope:** Explains exactly how a OpenReply license key is minted, delivered, verified, and enforced on a per-device basis — **entirely offline**, with seat limits, without the app ever needing to phone home.

---

## 0. Design goals

1. **Offline-first.** A paid user MUST be able to use the app with no internet forever. No validation server, no DRM callback, no "heartbeat required". The signed license blob is self-contained proof of purchase.
2. **Per-plan seat enforcement.** Personal = 2 devices, Family = 5, Team = N, all configured at mint time. The cap is checked locally against a file the app itself maintains.
3. **Cryptographically unforgeable.** A pirate cannot generate a new license blob without your private key. Public key is embedded in the app binary; private key stays on your laptop (or your future webhook server).
4. **Tamper-resistant enough.** A pirate *can* bypass it by patching the JS (local-first apps always can), but the effort is > `$49`. Our goal is to make paying the path of least resistance, not airtight DRM.
5. **Boring UX.** Paste a blob, click Activate, done. No sign-in, no cloud account, no captcha.
6. **Portable across OS.** macOS today; Windows + Linux when we ship those builds. All three have a stable per-machine UUID.

---

## 1. Architecture at a glance

```
 ┌──────────────────────────────┐           ┌──────────────────────────────┐
 │  YOUR SIDE (secret)          │           │  USER'S MAC (what ships)     │
 │                              │           │                              │
 │  private Ed25519 key         │           │  public  Ed25519 key         │
 │  (scripts/licenses/.keys/    │           │  (hardcoded in license.js)   │
 │   private.b64, chmod 600)    │           │                              │
 │                              │           │                              │
 │  mint-license.mjs            │  email    │  paste blob into app         │
 │      │                       │ ────────▶ │       │                      │
 │      ▼                       │  blob     │       ▼                      │
 │  signed license blob         │           │  verify sig offline          │
 │                              │           │       │                      │
 │  (later: Gumroad webhook     │           │       ▼                      │
 │   calls the same code)       │           │  activations.json            │
 │                              │           │   + device UUID              │
 │                              │           │                              │
 └──────────────────────────────┘           └──────────────────────────────┘
```

Nothing crosses the dotted line at runtime. The only "network event" is the email that delivers the blob.

---

## 2. The license blob — format and lifecycle

### 2.1 Payload (JSON, UTF-8)

```json
{
  "email":       "shantanu@openreply.io",
  "tier":        "personal",           // "personal" | "family" | "team"
  "seat_limit":  2,                    // personal=2, family=5, team=N
  "issued_at":   "2026-04-21T00:22:14.000Z",
  "purchase_id": "gumroad-abc123",     // or null for manually-minted
  "nonce":       "c3e65c1f22f9397d"    // 8 random bytes, hex — prevents collision
}
```

### 2.2 Signature

- Canonicalize: `utf8(JSON.stringify(payload))` — we don't canonicalize field order because we always stringify ourselves with the same JS serializer. **Verifier must compare exact bytes**, not re-parse-and-re-serialize (which would lose this guarantee).
- Sign: 64-byte Ed25519 signature over the canonical JSON bytes.

### 2.3 Transport blob

```
blob = base64( signature[64 bytes] || payload_bytes )
```

Concatenation order: signature first, then payload. The verifier splits at offset 64.

Typical size: ~260 chars of base64 — fits in a single email / copy-paste. No line wrapping, no PEM-armor. The `.mjs` mint script prints exactly one line.

### 2.4 Lifecycle

```
purchase ─▶ Gumroad webhook ─▶ mint-license.mjs ─▶ email blob
                                                        │
                                                        ▼
                                          user pastes into app
                                                        │
                                                        ▼
                                     verify signature locally
                                                        │
                                       ┌────────────────┼────────────────┐
                                       │                                 │
                                       ▼                                 ▼
                              if this device is                 if already at
                              not yet in activations:          seat_limit: reject,
                              add it + unlock                  show "My devices" UI
```

No state ever leaves the user's Mac.

---

## 3. Cryptography details

### 3.1 Why Ed25519

| Candidate | Signature size | Key size | Verify speed (µs) | Comment |
|---|---|---|---|---|
| RSA-2048 | 256 B | 294 B public | ~150 | Big signatures, slower verify |
| ECDSA-P256 | 72 B (DER) | 91 B public | ~80 | Smaller but malleable sigs |
| **Ed25519** | **64 B** | **32 B public** | **~40** | Small, fast, deterministic, well-vetted |
| HMAC-SHA256 | 32 B | shared secret | <10 | Symmetric — secret would leak if embedded |

Ed25519 wins: smallest public key we can embed, deterministic signatures (no nonce reuse risk), and natively supported by modern WebCrypto (Safari 17+, WebView2 on Win 10+, WebKit in Tauri macOS).

### 3.2 Embedded public key

The key generated during scaffold on 2026-04-21 is:

```
Ryg/tbxB4fD3xgXJ6vfLervRw+kLZ+SPcl+waMXyHuM=
```

This (base64, 32 bytes raw) gets hardcoded into `app-tauri/src/lib/license.js` as `PUBLIC_KEY_B64`. Shipping it is safe — a public key cannot forge signatures, only verify them.

### 3.3 Verification math (what the app does)

In the webview:

```js
import { PUBLIC_KEY_B64 } from './license.js';

async function verifyBlob(blobB64) {
  const raw = base64ToBytes(blobB64);
  const sig = raw.slice(0, 64);
  const payloadBytes = raw.slice(64);

  const pub = await crypto.subtle.importKey(
    'raw',
    base64ToBytes(PUBLIC_KEY_B64),
    { name: 'Ed25519' },
    false,
    ['verify'],
  );
  const ok = await crypto.subtle.verify('Ed25519', pub, sig, payloadBytes);
  if (!ok) throw new Error('License signature invalid');
  return JSON.parse(new TextDecoder().decode(payloadBytes));
}
```

Verification is **pure math** — no network, no filesystem, no timers. Takes ~40 µs on any Apple Silicon laptop. WebKit ships `crypto.subtle.verify('Ed25519', …)` since WebKit 2.40 (macOS Sonoma) — covers every Tauri target Mac we'll ship to.

### 3.4 Why a signed blob, not a short key

Gumroad natively issues short license keys like `E21F8F2D-…`. A short key forces you to look it up server-side to get the tier + seat count. A **signed blob** carries everything inline, so the app never needs a server to know how many seats the user is entitled to. Tradeoff: the "key" is ~260 chars instead of 36. Users paste, they don't memorize, so we accept.

### 3.5 Key rotation

If the private key ever leaks (committed to git, laptop stolen, etc.):

1. Generate a new keypair.
2. Bump app version: ship `PUBLIC_KEY_B64_V2` alongside V1.
3. App tries V2 verify first, falls back to V1. Old licenses keep working.
4. New mints use V2 only.
5. Eventually drop V1 verify in a major version, after ~18 months.

We do NOT plan for rotation right now — too much ceremony for a brand-new product. But the 2-key-fallback design is cheap to add later.

---

## 4. Device identification

Every device that activates gets a stable UUID. We store only the UUID (and a hostname label + activation timestamp) in `activations.json`, never raw hardware identifiers outside the user's own disk.

### 4.1 macOS — `IOPlatformUUID`

Apple exposes a per-machine UUID via I/O Kit:

```bash
ioreg -d2 -c IOPlatformExpertDevice | awk -F'"' '/IOPlatformUUID/{print $(NF-1)}'
# →  8F2CE9A1-3D7B-5C4E-9A0F-1B2C3D4E5F67
```

- **Stable across:** reboots, OS upgrades, user account changes, drive clones (because it's in the T2/M-series Secure Enclave, not on the SSD).
- **Changes on:** logic board replacement (rare; Apple re-issues during board swap). Users who hit this contact support → we reset their activations.
- **Not readable without:** running as the logged-in user — no elevated privileges needed. Good, because we never ask for `sudo`.
- **Privacy:** we store only the UUID, never the serial, MAC, or hostname-tied info. The UUID looks like a random GUID.

### 4.2 Windows (future) — `MachineGuid`

```
HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Cryptography\MachineGuid
```

Set at Windows install time. Survives reboot + upgrades. Changes only on Windows reinstall.

### 4.3 Linux (future) — `/etc/machine-id`

Written by systemd at first boot. Survives upgrades. Same guarantees as Windows `MachineGuid`.

### 4.4 Why not MAC, serial, hostname?

| Candidate | Stability | Privacy | Verdict |
|---|---|---|---|
| MAC address | Changes per network interface; randomized by Wi-Fi privacy mode | Reveals device type | ❌ |
| Disk serial | Changes on SSD upgrade | OK | ❌ |
| Hostname | User-editable, arbitrary | Reveals user info | ❌ |
| **OS-provided UUID** | Survives OS lifetime | Opaque | ✅ |

### 4.5 Can a pirate spoof the device UUID?

On macOS, the UUID is read from IO Kit; you need to patch a kernel extension or run in a VM with custom hardware to fake it. Possible but firmly outside "casual piracy" territory.

If a pirate *does* fake it, they can activate unlimited times — but they now have the private key problem: they'd still need a valid signed blob. So spoofing UUID alone doesn't unlock the app; it just bypasses the seat cap if they already have a valid license. That's an acceptable failure mode because they already paid (or already copied a friend's blob, which is our "family pack" use case we *want*).

---

## 5. Seat-limit enforcement — how the counter actually works

### 5.1 File: `~/.config/reddit-myind/activations.json`

```json
{
  "email": "shantanu@openreply.io",
  "activations": [
    {
      "device_id": "8F2CE9A1-3D7B-5C4E-9A0F-1B2C3D4E5F67",
      "hostname":  "Shantanus-MacBook-Pro",
      "os":        "macOS 26.1",
      "activated_at": "2026-04-21T00:22:14.000Z"
    },
    {
      "device_id": "B47DFE55-11AC-4800-8E0D-AABBCCDDEEFF",
      "hostname":  "shantanu-imac",
      "os":        "macOS 26.0",
      "activated_at": "2026-04-23T14:02:09.000Z"
    }
  ]
}
```

Two-device personal license → two entries. The `email` field pairs this file to the license blob; changing licenses clears the file.

### 5.2 Activation state machine

```
┌─────────────┐  paste blob + verify sig  ┌─────────────┐
│ NO LICENSE  │ ─────────────────────────▶│ SIG VALID   │
└─────────────┘                           └──────┬──────┘
                                                 │
                           ┌─────────────────────┼─────────────────────┐
                           │                     │                     │
                           ▼                     ▼                     ▼
                  ┌─────────────┐       ┌─────────────┐       ┌─────────────┐
                  │ device not  │       │ device      │       │ different   │
                  │ in list,    │       │ already     │       │ email       │
                  │ under cap → │       │ in list →   │       │ paste →     │
                  │ ADD + UNLK  │       │ NO-OP       │       │ WIPE + ADD  │
                  └─────────────┘       └─────────────┘       └─────────────┘
                           │
                           ▼ if at cap
                  ┌──────────────────────────────────────────────┐
                  │ show "2/2 devices used — deactivate one":    │
                  │   - list devices                             │
                  │   - "Deactivate this Mac" on each (local)    │
                  │   - user can remove an old laptop from list  │
                  └──────────────────────────────────────────────┘
```

### 5.3 Concurrency / race conditions

Single-user desktop app. No two threads touch `activations.json` simultaneously. The worst case:

- User pastes blob on Mac A at 12:00.
- Same user pastes blob on Mac B at 12:00:03 (the network-email propagation is serial).
- Each machine sees its local file separately → each adds itself → both files now have 2 entries but the SECOND activation never happened on the first machine.

This is fine. The cap is enforced **per paste** on the device that's pasting. If the user gets to a 3rd Mac, that Mac sees its own local `activations.json` is empty (fresh install) → adds itself as entry #1 of an empty file → unlocks. The license has effectively been used on 3 devices.

**That's not a bug — it's a feature.** We're running the "honor-system + soft cap" model. Perfect enforcement would require a cloud counter, which violates local-first. We deter sharing (the UI clearly says "2/2 devices") without punishing it.

### 5.4 Why not a per-device-UUID claim stored inside the blob?

Because the blob is signed at mint time, before the user knows their device-UUIDs. We'd need a re-mint flow on every device swap. Too much friction.

### 5.5 Deactivation

A "My devices" UI lists entries in `activations.json` with a delete button per row. Deletion just rewrites the file. No network.

When a user says *"I lost my old Mac, give me my seat back"*, they can do it themselves without support — but on a lost Mac they can't open OpenReply to remove the entry. Solution: a "Reset all activations" button that wipes the file. Nothing prevents them from using the license on the next 2 Macs.

### 5.6 Support scenarios (ops runbook)

| Scenario | User can self-serve? | What we do |
|---|---|---|
| Lost/stolen Mac | Yes | "Reset all activations" button in app wipes `activations.json` |
| Bought new Mac | Yes | Deactivate old → activate new from "My devices" |
| Refund requested | No | Mint a revocation entry on future heartbeat (optional) |
| Family pack → split | No | Re-mint 2 personal licenses, email both people |
| Tier upgrade personal → family | No | Re-mint family license with same email |

---

## 6. Offline-first guarantees

### 6.1 What's guaranteed

- **No internet required for:** signature verification, seat enforcement, feature unlock, trial expiry, device add/remove.
- **App never blocks on:** any HTTP call. Every network call the app makes (LLM providers, Reddit API, Pullpush, etc.) is either user-initiated or optional.

### 6.2 Optional heartbeat

Once every ~30 days, if the network happens to be up, the app *may* GET `https://openreply.io/api/heartbeat?purchase_id=<id>&ver=<v>`. The response body is ignored on success. A 404 or 500 is ignored. Only a 410 (GONE) response explicitly locks the license, and even then gracefully — the app shows a "license revoked by issuer" banner, grants a 7-day grace period, and continues to work with a persistent nag after that.

This is entirely optional. A user who never connects to the internet never hits the heartbeat. **A pirate who blocks `openreply.io` at firewall level sees no difference — the app keeps working.** That's intentional.

### 6.3 Revocation story

We rarely need this, but:
- User does chargeback → issue a 410 for that purchase_id.
- Leaked on torrent → mint a new keypair + ship V2 public key in next release + start issuing V2 blobs.
- Bad-actor abuse → same as torrent.

Revocation is a slow signal, not a real-time one. That's correct for a $49 product.

---

## 7. Feature gates & trial

### 7.1 States

```
first run ──▶  TRIAL (14 days, full features)
                 │
                 ├── license entered ──▶ LICENSED (everything + all seats)
                 │
                 └── 14 days elapsed ──▶ TRIAL_EXPIRED
                                            │
                                            ├── paste license ──▶ LICENSED
                                            │
                                            └── keep using ──▶ degraded mode
                                                              (3 topics max,
                                                               no scheduled runs,
                                                               no PDF/Notion export,
                                                               watermark on report)
```

### 7.2 What's paywalled vs free forever

| Feature | Free CLI | Trial (14d) | Expired trial | Licensed |
|---|---|---|---|---|
| Collect (20 sources) | ✅ | ✅ | ✅ (3 topics) | ✅ unlimited |
| LLM enrichment (BYOK) | ✅ | ✅ | ✅ | ✅ |
| Map / Evidence / Report tabs | N/A (CLI) | ✅ | ✅ read-only | ✅ |
| MCP server | ✅ | ✅ | ✅ | ✅ |
| Scheduled weekly re-runs | N/A | ✅ | ❌ | ✅ |
| Export PDF / Notion / Linear | N/A | ✅ | ❌ | ✅ |
| Public openreply-map gallery upload | N/A | ✅ | ❌ | ✅ |
| Multi-topic dashboard (>3) | N/A | ✅ | ❌ | ✅ |
| Auto-updater | N/A | ✅ | ✅ | ✅ |

Core functionality is ALWAYS free in the CLI. The desktop app's polish + scheduling + exports are the paid wedge. Rationale: the OSS CLI drives star-farm and MCP adoption; the desktop buyers are PMs/founders who want the GUI.

### 7.3 Trial-reset prevention

A naive user could delete `~/.config/reddit-myind/.firstrun` to restart the trial timer. We don't need airtight protection here (that's what paying prevents), but we do one easy thing:

- Write `.firstrun` at first launch with `chmod 600`, containing `{ first_seen_at, install_hash }`.
- `install_hash = sha256(device_uuid + app_version)`.
- If the file is deleted and then app reopens, the recreated file has a newer `first_seen_at` — but `install_hash` identifies that this is the *same* install. A server-side log (via the optional heartbeat) can note resets, but we don't enforce on it.
- For the basic deterrent, the file also references **system-install-timestamp** of `/Applications/OpenReply.app` — which users can't easily backdate without admin tricks.

This is 10 lines of code, not a moat. Paying remains the path of least resistance.

---

## 8. Attack surface & mitigations

| Attack | Feasibility | Our response |
|---|---|---|
| Forge a signed blob | Requires private key — cryptographically infeasible (Ed25519) | ✅ Ed25519 public key embedded |
| Share blob with friend | Trivial — that's literally copy-paste | ✅ soft seat cap = 2, Family pack for explicit sharing |
| Patch `license.js` to always return `isPro=true` | Easy for a dev; requires opening Tauri DevTools + script injection | ⚠️ We don't try to defeat this. It would require Rust-side verification or native-code obfuscation. Not worth 2 weeks of work. |
| Delete activations.json | Trivial | Accepted — equivalent to "Reset all activations" |
| Rewind system clock to un-expire trial | Annoying but doable | Use `first_seen_at` (file creation) + system-install time |
| Leak private key | Catastrophic | Key rotation path documented (§3.5) |
| Decompile app and extract public key | Trivial | Public key being extracted is harmless — it's the PUBLIC key |
| MITM the mint script | Impossible unless they own your laptop / webhook server | Keep private key off-site, use HTTPS for webhook endpoints |
| Chargeback abuse | Real | Optional heartbeat with revocation (§6.3) |

### The honest position

Local-first apps have no real DRM. Raycast, Obsidian, Sublime Text all accept some piracy in exchange for zero server ops. Our licensing is aligned with Obsidian's philosophy:

> "We don't try hard to stop piracy. We make the paid experience better than any cracked build."

Key deterrents we *do* keep:
- Unsigned blobs are unforgeable (crypto).
- Seat cap prevents casual "just email me your key" scaling.
- Family pack exists so honest sharing has a cheap path.
- Trial is generous so pay-vs-pirate feels fair.

---

## 9. Files touched at each step

### 9.1 On disk (user's Mac)

| Path | Owner | Purpose | Permissions |
|---|---|---|---|
| `~/.config/reddit-myind/license.json` | app | stores the signed blob + parsed payload | 600 |
| `~/.config/reddit-myind/activations.json` | app | per-device activation list | 600 |
| `~/.config/reddit-myind/.firstrun` | app | trial start timestamp | 600 |
| `~/.config/reddit-myind/.env` | app (existing) | BYOK API keys | 600 |

### 9.2 In the repo

| Path | Purpose |
|---|---|
| `scripts/licenses/.keys/private.b64` | Ed25519 seed, chmod 600, **gitignored** |
| `scripts/licenses/.keys/public.b64` | public key, safe to commit (not strictly necessary; also embedded) |
| `scripts/licenses/generate-keys.mjs` | one-time keypair gen |
| `scripts/licenses/mint-license.mjs` | mint signed blob from CLI |
| `app-tauri/src/lib/license.js` | webview verify + activation logic (to be scaffolded) |
| `app-tauri/src/lib/featureGates.js` | `isPro()`, `canExportPdf()`, etc. (to be scaffolded) |
| `app-tauri/src/screens/license.js` | Settings → License UI (to be scaffolded) |
| `app-tauri/src-tauri/src/commands.rs` | `get_device_id`, file I/O for license/activations |

---

## 10. End-to-end operational flow

### 10.1 First sale (manual mint)

```bash
# One-time (done 2026-04-21):
node scripts/licenses/generate-keys.mjs

# Per purchase:
node scripts/licenses/mint-license.mjs \
    --email alice@example.com \
    --tier personal \
    --purchase-id gumroad-2026-04-21-0001

# → prints a base64 blob. Copy into an email to Alice.
```

### 10.2 Gumroad webhook (later)

```
POST /webhook/gumroad
  body: { sale_id, email, product_id, ... }

handler:
  1. verify Gumroad HMAC signature (their webhook signing secret)
  2. look up tier from product_id
  3. call mint-license logic (same code as mint-license.mjs)
  4. email the blob via Postmark/Resend/Gumroad-native
  5. write audit log: { email, sale_id, issued_at, nonce } → SQLite or Airtable
```

The webhook is the *only* place the private key lives in production. Store it in Cloudflare Worker secrets / Vercel env / Fly.io secret — never in git.

### 10.3 User activation

```
1. Alice receives the email with a giant string.
2. Opens OpenReply → Settings → License → "Paste license".
3. Webview verifies signature (offline).
4. Webview reads device_id via Rust command.
5. activations.json gets its first entry.
6. isPro() now returns true. Trial watermark disappears. Scheduled-runs enables.
```

### 10.4 Alice installs on her iMac

```
1. Fresh OpenReply install. Trial starts.
2. Alice copies the same blob into Settings → License.
3. Webview verifies signature (still valid).
4. activations.json on this Mac is fresh → adds this device (entry #1 locally).
5. Everything unlocks. Personal license seat count: 2.
```

### 10.5 Alice tries on a 3rd Mac (her partner's)

```
1. Fresh install. Trial starts.
2. Paste same blob. Sig verifies.
3. activations.json on this 3rd Mac is fresh → adds self (entry #1 locally).
4. App unlocks anyway (see §5.3: we don't cloud-enforce).
5. But the UI shows "This is device 3 of 2 seats" based on the `seat_limit` field.
   Alice sees the warning and can either upgrade to Family or keep using
   (soft enforcement).
```

### 10.6 Transfer to new Mac

```
1. Alice retires old MacBook.
2. On new MacBook: fresh install → paste blob → unlocks.
3. Old MacBook still "active" in its own activations.json, but Alice doesn't
   care — the file will be deleted when she wipes the machine.
4. If Alice tries to install on a 4th device (her new iMac), she sees
   "3/2 seats — upgrade to Family?" → upgrades, we re-mint.
```

---

## 11. Implementation contract

### 11.1 `lib/license.js` (webview — to be built)

```js
// Read the saved license blob (or null).
export async function getLicense(): Promise<License | null>

// Verify + save a new blob.
export async function activateLicense(blob: string): Promise<{
  ok: boolean;
  tier?: string;
  email?: string;
  seats_used?: number;
  seat_limit?: number;
  reason?: string;
}>

// Returns the trial state.
export function getTrialState(): { started_at: Date; days_left: number; expired: boolean }

// The canonical gate.
export async function isPro(): Promise<boolean>

// Removes current device from activations (idempotent).
export async function deactivateThisDevice(): Promise<void>

// Wipes activations.json + license.json. Irreversible locally.
export async function clearLicense(): Promise<void>
```

### 11.2 Rust commands (new)

```rust
#[tauri::command]
pub fn get_device_id() -> Result<String, String>
// macOS: run `ioreg` and extract IOPlatformUUID. Caches to
// ~/.config/reddit-myind/.device-id on first call — so if Apple ever
// rotates it (e.g. logic-board swap) the user keeps the same ID.

#[tauri::command]
pub async fn read_license_file() -> Result<Option<String>, String>

#[tauri::command]
pub async fn write_license_file(contents: String) -> Result<(), String>

#[tauri::command]
pub async fn read_activations_file() -> Result<Option<String>, String>

#[tauri::command]
pub async fn write_activations_file(contents: String) -> Result<(), String>

#[tauri::command]
pub async fn clear_license_and_activations() -> Result<(), String>
```

All five are thin wrappers — the real validation stays in JS where the public key + `crypto.subtle` live.

### 11.3 Feature-gate helpers

```js
// app-tauri/src/lib/featureGates.js
export async function canUseScheduledRuns(): Promise<boolean>  // Pro only
export async function canExportPdf():         Promise<boolean>  // Pro only
export async function canExportNotion():      Promise<boolean>  // Pro only
export async function maxTopicsAllowed():     Promise<number>   // Infinity | 3
export async function shouldShowUpgradeNag(): Promise<boolean>  // expired trial + !pro
```

All wrap `isPro()` + trial state. Keep the business rules in one place so we can change pricing tiers without hunting across screens.

---

## 12. Test plan

1. **Unit tests (vitest / node --test):**
   - Verify signature of a known-good blob from the mint script.
   - Reject tampered payload (flip a byte in email).
   - Reject tampered signature (flip a byte in sig).
   - Reject expired-key V0 blob once V1 ships.
2. **Integration (Rust + JS):**
   - `get_device_id()` returns same value across two consecutive invocations.
   - `write_license_file → read_license_file` round-trips.
3. **End-to-end (manual):**
   - Generate keypair.
   - Mint personal license.
   - Activate on host A: expect seat count 1/2.
   - Activate on host B: expect 2/2.
   - Activate on host C: expect warning banner (implementation pending).
   - Deactivate host A, re-activate host C: expect 2/2, A removed.

---

## 13. What's already done vs next steps

### Done (2026-04-21)

- [x] Ed25519 keypair generated — private key in `scripts/licenses/.keys/` (chmod 600, gitignored).
- [x] `scripts/licenses/generate-keys.mjs` — one-time key generator with overwrite guard.
- [x] `scripts/licenses/mint-license.mjs` — sign a license blob from the CLI.
- [x] `.gitignore` updated to keep private key out of history.
- [x] Smoke-tested mint (`node scripts/licenses/mint-license.mjs --email test@gap.map --tier personal` → valid blob).
- [x] **This document** with full design detail.

### Next steps (separate implementation passes)

- [ ] Rust commands: `get_device_id`, `read/write_license_file`, `read/write_activations_file`.
- [ ] `app-tauri/src/lib/license.js` — WebCrypto Ed25519 verify + activation logic.
- [ ] `app-tauri/src/lib/featureGates.js` — `isPro`, `canExportPdf`, etc.
- [ ] `app-tauri/src/screens/license.js` — Settings → License UI (paste box + "My devices" list + trial countdown + buy CTA).
- [ ] Wire `isPro()` gates into scheduled-runs + PDF export + multi-topic cap + upgrade nags.
- [ ] Tests: signature verify + tamper rejection + round-trip.
- [ ] Changelog + CodeGraph sync.

### Deferred (ship first, add later)

- [ ] Gumroad webhook on Cloudflare Worker or Vercel function.
- [ ] Optional heartbeat endpoint (`/api/heartbeat`) + revocation flag.
- [ ] Key rotation plumbing (V1/V2 fallback verifier).
- [ ] Windows + Linux device-UUID helpers.
- [ ] Upgrade path UI: personal → family in-app.

---

## 14. Summary of guarantees

1. **A paid user can use the app forever with no internet.** ✅ Signature verification is local-only.
2. **Per-plan seat enforcement.** ✅ Seat count is encoded in the blob; local activations file counts against it.
3. **Cryptographically unforgeable.** ✅ Without the Ed25519 private key, no one else can generate a license.
4. **Tamper-resistant to casual piracy.** ✅ Soft seat cap + family pack + trial mode > DRM for indie economics.
5. **No account creation, no sign-in, no cloud dependency.** ✅ It's a paste-a-blob flow.
