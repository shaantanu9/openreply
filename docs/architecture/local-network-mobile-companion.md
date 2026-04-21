# Local-Network Mobile Companion — Architecture & Feasibility

**Date:** 2026-04-21
**Question asked:** can we ship a mobile app on the App Store that auto-
discovers and connects to the user's desktop Gap Map on the same
Wi-Fi / LAN, browses + controls everything from the phone, and works
async (cache-then-sync) when on the go?

**Answer: Yes. This is a proven pattern** (Plex, Transmission, Home
Assistant, Photosync, Syncthing). It neatly solves the mobile problem
without a cloud backend. Here's the full architecture.

---

## 1. The pattern, in one sketch

```
Home / office Wi-Fi
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║  ┌──────────────────┐            ┌───────────────────────┐  ║
║  │ Desktop Gap Map  │            │ Mobile Gap Map        │  ║
║  │ (Tauri + Python) │            │ (Flutter iOS/Android) │  ║
║  ├──────────────────┤            ├───────────────────────┤  ║
║  │ FastAPI :8732    │            │ scan mDNS             │  ║
║  │ + pairing token  │            │ ╭────────── QR scan ──▶│   
║  │ + mDNS broadcast ├──── announce (_gapmap._tcp) ──────▶│ list desktops│  
║  │ "Alex's Mac"     │            │ pick + pair           │  ║
║  │                  │            │                       │  ║
║  │ SQLite + palace  │◄── HTTPS + WebSocket (LAN) ───────▶│ Drift cache  │  
║  │ (source of truth)│            │ (local, no cloud)     │  ║
║  └──────────────────┘            └───────────────────────┘  ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝

On the go (coffee shop, airplane):
   ┌───────────────────────┐
   │ Mobile — offline mode │
   │ reads Drift cache     │
   │ queues writes         │
   │ replays on reconnect  │
   └───────────────────────┘
```

**Desktop = source of truth.** Mobile = a paired viewer / controller
that caches what it fetched so it still works on the go.

---

## 2. Every piece of the puzzle, one layer at a time

### Layer 1 — Transport

| Choice | Rationale |
|---|---|
| HTTP / WebSocket over LAN | Standard, tooling mature, no special drivers. |
| Not raw TCP | Debuggable, replayable, tools exist. |
| **HTTPS (self-signed)** optional | iOS ATS (App Transport Security) lets you whitelist per-domain exceptions. For LAN: plain HTTP is allowed with `NSAllowsLocalNetworking` in `Info.plist`. |
| Port 8732 | Arbitrary high port, unlikely to collide. |

### Layer 2 — Discovery

**Primary: mDNS / Bonjour / Zeroconf.**

Desktop publishes `_gapmap._tcp` service with its hostname, IP, port,
and a stable per-install UUID:

```
_gapmap._tcp.local.
  host: alex-macbook.local.
  port: 8732
  TXT:
    id=7f3a9e-b2c1
    name=Alex's Gap Map
    version=2.0.4
```

Mobile browses `_gapmap._tcp` on the current LAN and displays every
Gap Map instance found. One-tap to select + pair.

**Fallback: QR-code pairing.**
When discovery fails (router blocks mDNS, Guest Wi-Fi, VPN, etc.) —
Desktop shows a QR containing:

```json
{ "addr": "192.168.1.42:8732", "token": "ephemeral-60s-pairing-code" }
```

Mobile camera scans → pairs → stores the permanent token locally.
Always-available fallback. The QR is the minimum viable path and is
what ships first; mDNS is the polish layer.

**Apple-platform specifics:**

- iOS 14+ requires `Local Network Usage` permission. First Bonjour
  browse triggers the system prompt: *"Gap Map wants to find and
  connect to devices on your local network."* Write clear usage
  text in `Info.plist`:
  ```xml
  <key>NSLocalNetworkUsageDescription</key>
  <string>Gap Map uses your local network to discover and connect
    to your desktop so your research is available on this phone.</string>
  <key>NSBonjourServices</key>
  <array>
    <string>_gapmap._tcp</string>
  </array>
  ```
- User denies → fall back to QR pairing.
- App must still be functional without pairing (see App Store
  approval section below).

**Android:** no permission needed for LAN discovery.
`flutter_nsd` / `multicast_dns` handle both platforms.

### Layer 3 — Authentication & security

**Pairing token + LAN-only enforcement.**

1. Desktop generates a 32-byte random token on first launch,
   stores in `<data_dir>/peer-auth.json`.
2. Pairing flow:
   - Mobile scans QR → gets `addr + token`.
   - Mobile POSTs `/pair` with the token + device name ("Alex's iPhone").
   - Desktop stores the mobile's generated device-ID + a derived
     per-device token in `peer-auth.json`.
3. Every subsequent request carries `Authorization: Bearer <token>`.
4. **Desktop binds the HTTP server to 0.0.0.0 (or the LAN interface,
   not the VPN interface), but refuses any request whose source IP is
   public** — belt-and-braces against misconfiguration. RFC 1918
   ranges only: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`,
   `169.254.0.0/16`.
5. Rate limiting on the pair endpoint: 10 attempts / 5 min / IP.

**What we deliberately don't do in v1:**

- No end-to-end encryption (relies on LAN trust; threat model = your
  home Wi-Fi, not hostile public networks). HTTPS self-signed is a
  v2 nice-to-have.
- No accounts / no cloud auth. Pairing is machine-to-machine, local.

**When mobile should NOT connect over LAN:**

- Mobile on cellular data / foreign Wi-Fi → local connection fails
  → falls back to cache → shows offline banner.
- Desktop behind a corporate VPN with split-tunnel that routes LAN
  traffic over the tunnel → same as above.

### Layer 4 — API surface

We already shipped this for Path B of the Flutter feasibility plan.
Exact same FastAPI server:

```
GET    /health                          → {status, data_dir, version}
POST   /pair                            → mutual auth handshake
GET    /topics                          → list topics
GET    /topic/{topic}                   → topic metadata + stats
GET    /topic/{topic}/insights          → cached synthesis JSON
POST   /topic/{topic}/synthesize        → trigger a new synthesis
GET    /topic/{topic}/bets              → hypothesis_tests for topic
POST   /topic/{topic}/bets              → create / update bet state
GET    /topic/{topic}/findings          → findings list
POST   /feedback                        → 👎 a finding
GET    /products                        → list products
GET    /product/{id}/dashboard          → 5-section dashboard payload
POST   /product/{id}/sweep              → trigger a sweep
WS     /topic/{topic}/stream            → collect log + chat streaming
WS     /mcp                             → proxy the 73 MCP tools
```

Mobile calls these with `package:dio` (or `http` package). Every
endpoint already has a CLI + Tauri + MCP surface — this just adds a
fourth (HTTP).

### Layer 5 — Offline / async

Mobile keeps a local SQLite cache via `drift`:

```dart
// mobile/lib/cache/schema.dart
class CachedTopic {
  String topic;
  String cachedJson;       // whole topic metadata response
  DateTime fetchedAt;
  String etag;             // from desktop response
}
class QueuedMutation {
  int id;
  String method;           // POST / PUT / DELETE
  String path;             // /topic/foo/bets
  String bodyJson;
  DateTime queuedAt;
  int retries;
}
```

### Read path

```
app startup
  → try fetch from desktop (3 s timeout)
    → OK: return fresh data, update cache, set fetchedAt
    → FAIL: return cached data, flag "offline, last synced N min ago"
```

Staleness banner shows on every screen: *"Viewing cached data from
12 min ago · Tap to retry."*

### Write path (bet state, feedback, trash, etc.)

```
user changes something
  → optimistic UI update
  → append to QueuedMutation
  → try POST to desktop
    → OK: remove from queue, refresh cache, dismiss pending chip
    → FAIL: keep in queue, show "pending sync" chip on the item
```

On reconnect, mobile drains the queue in order. Conflicts are rare
because the desktop is the single source of truth; if a conflict does
arise (user edited the same bet on desktop + mobile), last-write-wins
with a toast: *"Note: this bet was also updated on your desktop. Your
mobile change was applied on top."*

No CRDTs in v1. Last-write-wins + server authoritative is enough.

### Layer 6 — Multi-desktop + peer sharing

**Multi-desktop (same user, two machines):**

The pairing flow already supports N desktops. Mobile shows a picker:
"Which Gap Map? *Alex's MacBook* / *Office iMac*". Each desktop has
its own token + cache namespace locally. Switching is instant.

**Peer sharing (user A → user B):**

If we want user-to-user handoff (e.g. "Alex shares his meditation
topic with his cofounder Sam"):

- Desktop exports a topic as a sealed bundle: SQLite subset + graph
  + report JSON, encrypted with a one-time passphrase.
- Upload to a transient store (Fly Files, Cloudflare R2, or use
  AirDrop / iMessage file share — desktop-side).
- Receiver's desktop / mobile imports → re-populates locally.

This is asynchronous, one-way, share-specific. Scope for v2. Not
needed for v1 local-network MVP.

---

## 3. App Store approval — will Apple ship this?

### Review risk

Apple occasionally rejects apps that "depend on external hardware" or
"offer limited functionality without a paired device." The standard
mitigations:

1. **Demo mode.** First launch shows a "Try with demo data" option
   that loads a bundled read-only topic (pre-exported JSON) so the
   reviewer can exercise the UI without any desktop.
2. **Clear paired-device flow.** `Settings → Paired desktops → Add new`
   with screenshots in your App Store listing.
3. **Fall-back copy.** When no desktop is found: *"Open Gap Map on
   your laptop on the same Wi-Fi, then come back and tap Pair."*

Apps that do this and pass review: Plex, Roon Remote, Transmission,
Home Assistant Companion, iSCSI Initiator, Overkast, Unraid.net.

### Required disclosures

- `NSLocalNetworkUsageDescription` (iOS 14+)
- `NSBonjourServices` (if using mDNS)
- App Privacy: "no data collected" is the honest answer — all data
  flows LAN-local between paired devices.
- Clear description: "A companion app for Gap Map on desktop.
  Discovers your Mac / Windows Gap Map on your home Wi-Fi and gives
  you the full research UI on your phone."

### Play Store

Simpler. No local-network permission. Straightforward approval.

---

## 4. Effort estimate

Assumes Path B (FastAPI server) is already live on desktop. If not,
add 3 days for that.

### Phase 1 — MVP (3 weeks, mobile read-only)

| Day | Task |
|---|---|
| 1-2 | Flutter scaffold (iOS + Android), Drift SQLite schema for cache |
| 3 | `package:dio` client wrapper + pairing-token storage (`flutter_secure_storage`) |
| 4-5 | Pairing UX: QR scanner + settings → paired-desktops list |
| 6-7 | `multicast_dns` Bonjour browser + "Select desktop" UI |
| 8 | iOS Info.plist + Android manifest permissions |
| 9-11 | Topic list + detail (read-only) screens — reuse the prototype layout from `topic-detail-proto-v2.html` |
| 12-13 | Insights tab: Minto + findings grid |
| 14-15 | Offline mode: cache-first reads + staleness banner |
| 16 | "Demo data" bundle for App Review |
| 17-18 | iOS + Android packaging, signing, TestFlight build |
| 19-21 | QA + App Store submission + Play Store submission |

### Phase 2 — Writes + Bets (1 wk)

- Optimistic UI on bet state changes
- Queued mutations on offline
- Sync status chips
- Push-on-reconnect

### Phase 3 — Product Mode + streaming (1 wk)

- WebSocket for collect log tailing
- Product dashboard on mobile
- Signal action (dismiss/snooze/act/hypothesis) from mobile

### Phase 4 — Polish + App Store iteration (ongoing)

- Handle reviewer feedback
- Build-numbers, crash-reporting, telemetry opt-in
- App Store Connect release flow via `asc` CLI

**Total MVP to App Store: ~5-6 weeks with one engineer.** Desktop side
is unchanged beyond the FastAPI layer (which also gives us Path B's
benefits).

---

## 5. What this gives us vs. the alternatives

| Concern | Cloud backend (Dual-Mode D/E/G) | LAN companion (this doc) |
|---|---|---|
| Mobile support | ✅ (but needs hosted infra) | ✅ (peer-to-peer, no infra) |
| Requires cloud servers | Yes — Fly, Railway, etc. | **No.** LAN only. |
| Monthly cost | $50-500+ hosting | **$0.** |
| Onboarding friction | account + login + billing | scan QR once |
| Offline story | mobile caches cloud data | mobile caches desktop data |
| Privacy | data on someone's server | **data never leaves your LAN** |
| Scales to multi-user teams | Natural (that's the point) | **Not really** — each user has their own desktop |
| Works without wi-fi | yes (cellular → cloud) | no (cellular → offline cache only) |
| App Store review risk | low (ordinary SaaS) | medium (companion-app pattern is known, but need Demo mode) |
| Develops our hosted SaaS muscle | yes | no |

### The honest pitch

**The LAN-companion model is the ideal v1 for a local-first founder
tool.** It gets Gap Map on your phone without:

- Building a hosted backend
- Paying monthly infra
- Asking users to create accounts
- Breaking our "100% local, your data never leaves your machine"
  promise

**The cloud model (Dual-Mode D/E/G) is the ideal v2 for teams.** You
add it when:

- Multiple people need to share a topic's data
- Users want mobile on cellular for real
- You've validated users will pay $50-500/mo

Ship both. They're complementary, not competing. LAN first because
it's cheaper and preserves the local-first positioning.

---

## 6. Concrete 3-day proof-of-concept

Before committing to 5-6 weeks, validate the core loop:

### Day 1 — Desktop FastAPI + mDNS broadcast

```python
# src/reddit_research/server.py (new)
import secrets
from pathlib import Path
from fastapi import FastAPI, Header, HTTPException
from zeroconf import ServiceInfo, Zeroconf
import socket

app = FastAPI()
TOKEN_FILE = Path("...").expanduser() / "peer-auth.json"

def _ensure_token() -> str:
    if TOKEN_FILE.exists():
        return json.loads(TOKEN_FILE.read_text())["token"]
    tok = secrets.token_urlsafe(32)
    TOKEN_FILE.write_text(json.dumps({"token": tok, "paired": []}))
    return tok

@app.get("/health")
def health():
    return {"status": "ok", "name": socket.gethostname(), "version": "2.0"}

@app.get("/topics")
def topics(authorization: str = Header(None)):
    tok = _ensure_token()
    if authorization != f"Bearer {tok}":
        raise HTTPException(401, "unauthorized")
    from reddit_research.core.db import get_db
    return list(get_db().query("SELECT DISTINCT topic FROM topic_posts"))

def announce_mdns():
    zc = Zeroconf()
    info = ServiceInfo(
        "_gapmap._tcp.local.",
        f"{socket.gethostname()}._gapmap._tcp.local.",
        addresses=[socket.inet_aton(socket.gethostbyname(socket.gethostname()))],
        port=8732,
        properties={"id": _ensure_token()[:8], "version": "2.0"},
    )
    zc.register_service(info)
```

### Day 2 — Flutter desktop Bonjour browser + pair

Skip iOS / Android for day 2 — use Flutter desktop to prove the loop:

- `pubspec.yaml`: `multicast_dns` + `dio` + `flutter_secure_storage`
- Scan for `_gapmap._tcp` → list all instances
- "Pair" button → POST `/pair` with a QR-received token
- Store token via `flutter_secure_storage`
- Fetch `/topics` → render plain list

### Day 3 — iOS / Android platform smoke test

- Build iOS to TestFlight, verify `NSLocalNetworkUsageDescription`
  prompt appears and mDNS browse works.
- Build Android APK, verify LAN browse works.
- Test offline mode: kill desktop → mobile should show cached list.

After day 3: we know whether the primitives work end-to-end. Commit
to phase 1 at that point.

---

## 7. Risks + mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| mDNS blocked by home router (Ubiquiti, corp Wi-Fi) | Medium | QR fallback (v1 ships it anyway) |
| iOS user denies Local Network permission | Low-Medium | QR fallback + clear re-request UX |
| User behind double NAT / VPN | Low | QR with explicit IP works |
| Desktop on Wi-Fi, mobile on cellular | Medium | Offline cache + banner |
| iOS App Review rejection | Low-Medium | Demo data bundle + clear companion-app messaging |
| Token leakage (QR photographed) | Low | Tokens expire after pairing; per-device tokens |
| Multiple Gap Map instances on the LAN (laptop + desktop) | Expected | Multi-desktop picker, per-instance token |
| Desktop crashes mid-sync | Low | Queued mutations persist in Drift; replay on reconnect |

---

## 8. TL;DR and decision

**Yes, this can absolutely work.**

- Pattern is proven (Plex / Transmission / Home Assistant).
- Fits our local-first positioning perfectly — no cloud, no accounts,
  no monthly infra.
- Gets us on the App Store in 5-6 weeks with one engineer.
- Preserves 100% of the Python backend we've invested in.
- Demo-data bundle handles Apple's "works without external device"
  review concern.
- Future cloud-mobile path (Dual-Mode D/E/G) is additive, not
  replacement.

### Recommendation

1. Commit to the **3-day POC** first — validate FastAPI + mDNS +
   Flutter Bonjour browse work end-to-end.
2. If green → 3-week phase 1 (read-only mobile) → submit to App Store
   + Play Store.
3. If approved → phase 2 (writes) + phase 3 (streaming) over the
   following 2 weeks.
4. Keep cloud-mode (D/E/G) roadmap untouched; revisit when we have
   paid-team demand.

**Total commitment for a shippable mobile app: 5-6 weeks + App Store
review time. No recurring infra cost. Feature parity with desktop for
the read-and-act loop.**

This is the best mobile path we have. Cheaper than cloud, preserves
everything we've built, ships in a sprint.
