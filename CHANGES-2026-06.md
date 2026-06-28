# OpenReply — Changes (June 2026 session)

> Comprehensive log of everything shipped in the 2026-06-05 → 06 session, across
> the desktop app (`app-tauri` + Python sidecar), the website
> (`act_suit/activation-suite`), and the licence/activation backend.
> Per-area changelogs also live in `changelogs/`.

---

## 1. Licence activation (the big debugging arc)

| Area | Change |
|---|---|
| **Key-hash bug** | `couponService` / trial / webhook create paths hashed the raw key; activation re-normalizes. Aligned all create sites to `hashSecret(normalizeActivationKey(rawKey))`. *(Later confirmed the normalizer re-adds dashes, so the original was correct — net: create paths made explicit, no behavior change.)* |
| **Signing secret** | Server `TOKEN_SIGNING_SECRET` ↔ DMG `JWT_DESKTOP_SECRET` rotated + verified (`signing_fp = 6713fd9ce909`); CI drift-guard refuses to build on mismatch. |
| **Dev-app drift** | "works in dev, fails on install" root-caused to the file-watcher rebuilding the dev app **without** the prod base/secret. Relaunch pinned to `openreply.myind.ai` + baked secret fixed it. |
| **Old DMGs** | Any DMG built before the secret rotation fails with `InvalidSignature` — must use **v0.1.21+**. |

### Delete → recreate → activate cycle (made bulletproof)
- Added DB trigger `cleanup_email_keyed_on_auth_delete` on `auth.users` → deleting a user by **any** path (app hard-delete, Supabase dashboard, API) cleans licences/devices/coupons/app_users/attempts. No orphans.
- **End-to-end verified live:** issue licence → activate (200) → hard-delete (all rows = 0) → recreate → activate (200) → old key correctly rejected (401). All test data cleaned.

---

## 2. Reddit collection (Reddit's 2026 API lockdown)

Reddit now **403-blocks all non-OAuth `.json`** (confirmed across www/old/search/sub
endpoints, any User-Agent; even anonymous-cookie priming fails — only a logged-in
session works). Official policy: API keys now require **pre-approval** (~2–4 weeks),
commercial use needs written approval.

| Mode | Creds | Data |
|---|---|---|
| **RSS** (no key) | none | titles/authors/dates/bodies/subreddits (no scores; ~25/feed) — **works today, no approval** |
| **Read-only OAuth** | `REDDIT_CLIENT_ID` + `SECRET` | **full JSON** (scores, comments, deep search), 100 req/min, no browser login |
| Full OAuth | + refresh token | also acts as the user |

- `core/public_client.py` rewritten `.json` → **RSS** (feedparser); same row shapes.
- `config.has_reddit_app` + `get_reddit()` read-only PRAW (`client_credentials`) — `id+secret` alone flips to auth mode.
- BYOK: id/secret written to `~/.config/openreply/.env`, loaded by the sidecar → live.
- Historical (3-yr) Reddit via **PullPush** (existing; archive cutoff ~May 2025).

---

## 3. Sources — expanded + fixed

**Added**
- **Stack Exchange network** — 8 no-auth communities in one source (superuser, serverfault, softwareengineering, ux, webmasters, softwarerecs, devops, security). Default-on.
- **Europe PMC** — biomedical + life-science + **preprints** (bioRxiv/medRxiv) + agricola. Free, no key. Default-on.
- **DBLP** — computer-science bibliography (6M+ pubs). Free, no key. Opt-in.
- Surfaced wired-but-hidden: **Crossref · Semantic Scholar · Wikipedia · Bluesky**.

**Fixed**
- **Bluesky** — anon search 403'd → now app-password auth (`BSKY_HANDLE` + `BSKY_APP_PASSWORD`, free/instant, no approval) via BYOK; graceful empty without creds.
- **Lemmy** + **GitHub Issues** — flipped **default-on** (reliable no-gate Reddit alternatives).

**Reliability**
- Per-source error isolation: any one source failing (Reddit, PullPush, AlternativeTo) can't break a run — everything else keeps collecting.
- **Proven-live no-auth backbone:** Hacker News · Stack Overflow · Stack Exchange ×8 · Lemmy · GitHub Issues · Product Hunt · arXiv/PubMed/OpenAlex/Europe PMC · App/Play Store/Trustpilot · Google News/Trends · RSS bundles + Reddit-RSS = **~40 data streams**.

**Known gated** (honest): AlternativeTo (Cloudflare), Dev.to (misses broad queries), Reddit full JSON (needs Reddit approval).

---

## 4. Website (`act_suit/activation-suite`, deployed to openreply.myind.ai)

- Mobile-responsive navbar (hamburger) + download-button contrast fix.
- **Login-aware navbar** on every page (compact variant was showing "Sign in" while logged in) + Download CTA everywhere.
- **No duplicate nav items** (Pricing/Dashboard were doubled).
- **Clean logged-in home** — "Welcome back" app-launcher; conversion-only sections (urgency/invite/get-beta) hidden when signed in. New `SignedInOnly`/`SignedOutOnly` gates.
- `/api/download` retries **uncached** when a just-published asset isn't in the cached release (fixes per-platform "serves old version").
- Multi-platform email copy ("Download for Mac" → "Download OpenReply").

---

## 5. Release v0.1.21 (chat decomposition + more)

Tag `v0.1.21` (myind-ai/openreply) — signed + notarized, all platforms:
- Chat backend decomposed into a tested 7-module package + reusable `chatPanel`
  (topic tab + sidebar inline) + `chat doctor` / in-app Diagnose.
- Custom RSS feeds; collect-skips-Reddit fix.

**Pending:** **v0.1.22** to ship June-06 work (Reddit RSS/OAuth + all source
additions). PullPush reliability hardening (timeout/retries/mirror) optional.

---

## 6. Frontend tooling (to stop UI regressions)

Installed: Playwright MCP (visual verify), Context7 MCP (live Tailwind/Next docs),
Tailwind v4 skill, UI/UX Pro Max (7 skills), and a project `openreply-design-system`
skill capturing real tokens + the `@layer` rule (the black-on-black-button cause)
+ navbar/login patterns.

---

## Source-of-truth commits (this session)

```
689f4af surface Crossref/Semantic Scholar/Wikipedia
550560d Bluesky app-password + BYOK
02c12d9 Stack Exchange network (8 communities)
7b6c1bd Lemmy + GitHub Issues default-on
aa1470c BYOK Reddit help text
96713c0 Reddit read-only OAuth (id+secret)
40817c3 Reddit RSS no-auth
eaf545f activation key-hash create paths
4a83a55 navbar dedupe (Pricing/Dashboard)
6b966eb /api/download uncached retry
cac9b98 login-aware navbar + clean home
0bd515f responsive navbar + email copy
a794d07 release v0.1.21
27aeb42 collect: rerun no longer skips Reddit
```
