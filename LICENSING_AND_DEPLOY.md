# Gap Map — Licensing & Deployment Tracker

> **Updated:** 2026-06-03 · Single source of truth for the licence/activation system
> (desktop app ↔ website) and the Vercel deployment. Read this before touching
> licensing, the activation UI, the `/v1/*` endpoints, or deploying the website.

---

## 0. TL;DR (current state)

- **Licence gate is ON by default.** No valid key → the desktop app locks to the
  activation screen (data is NEVER touched). Dev bypass: `GAPMAP_LICENSE_GATE_ENABLED=0`.
- **Activation UI** (onboarding Step 6 **and** Settings → Licence card) asks for only
  **email + activation key** (password optional, server URL auto-resolved & read-only).
- **Production website** = `https://gapmap.myind.ai`, served by the **`gapmap-web`**
  Vercel project (NOT "activation-suite" — see §4). Latest code is deployed & verified.
- **Renewals/revocations auto-sync** via `license_revalidate` (boot + every 6 h);
  it only locks on an explicit revocation signal, never on a 404/5xx.

---

## 1. The two repos

| Repo | Path | Git remote | What it is |
|---|---|---|---|
| **App (Tauri)** | `app-tauri/` (inside `reddit-myind`) | `origin` = `github.com/shaantanu9/gap-map-pro` (branch `multi-source`) | The desktop app (Rust + vanilla-JS webview + Python sidecar) |
| **Website** | `act_suit/activation-suite/` (nested git repo) | `origin` = `github.com/shaantanu9/gapmap_web` (branch `main`) | Next.js licence server + marketing/activation site |

The website (`activation-suite`) is its **own** git repo nested inside `reddit-myind`.
Commit/push each repo separately.

---

## 2. Architecture & the critical secret invariant

```
Website (Next.js / Supabase)            Desktop app (Tauri)
────────────────────────────            ────────────────────────────
licenses + license_devices (Supabase)   local SQLite (research data)
signs JWT with                          verifies JWT with
TOKEN_SIGNING_SECRET   ── MUST EQUAL ──► JWT_DESKTOP_SECRET (baked at build)
```

- **Invariant:** `TOKEN_SIGNING_SECRET` (website runtime env) **must equal**
  `JWT_DESKTOP_SECRET` (baked into the app at build time via `build.rs`).
  Drift → every activation fails with `InvalidSignature`.
- The app's licence server URL: `DEFAULT_LICENSE_API_BASE = "https://gapmap.myind.ai"`
  (`app-tauri/src-tauri/src/commands.rs`). Override for dev with
  `GAPMAP_LICENSE_API_BASE` (or `LICENSE_API_BASE`).
- Auth model: activation authenticates on **(email, activation_key)** only. The
  password field is accepted but **ignored** server-side (kept for legacy/back-compat),
  which is why the UI makes it optional and sends a placeholder when blank.

---

## 3. The full licence flow

1. **Get a key** — website `/activate`: Start 14-day trial / Get free key / Buy Pro
   (Lemon Squeezy). Key is bound to the user's **email**, stored as `sha256(key)`.
2. **Activate a device** — desktop app (onboarding Step 6 or Settings → Licence):
   enter email + key → app adds the machine **device fingerprint** → `POST {base}/v1/device/activate`
   → server checks key↔email, device limit, expiry → returns a signed **JWT**.
   App verifies signature + issuer (`gapmap-activation-suite`) + audience
   (`gapmap-desktop`) + device-fp locally, stores token (file/Keychain) + state.
3. **Stay valid / renew / revoke** — `license_revalidate` (Rust) `POST {base}/v1/licence/validate`
   on boot + every 6 h:
   - valid → sync latest `expires_at` (+ refreshed token), clear `revoked` → **renewal unlocks itself**
   - 401 / `{revoked:true}` / 200+`{valid:false}` → set `revoked` → app locks
   - 404 / 5xx / offline → **inconclusive, state untouched** (never locks on server trouble)
4. **Device limit** — Pro = 1 device, Pro+Live Pass = 2. Extra device → 409. Deactivate
   frees a slot.

### Endpoints (the app uses the `/v1/*` aliases)
| Path | Purpose |
|---|---|
| `POST /v1/device/activate` (alias of `/api/v1/device/activate`) | activate this device |
| `POST /v1/licence/validate` (alias of `/api/v1/licence/validate`) | revalidate (renew/revoke sync) — **returns `expires_at/trial_ends_at/is_trial/plan_id/status`** |
| `POST /api/v1/device/deactivate` | free a device slot |
| `POST /api/v1/trial/start` · `POST /api/v1/licence/free` | issue trial / free key (bearer-authed) |
| `POST /api/v1/admin/license` | owner revoke / reactivate / expire (`x-admin-secret`) |

---

## 4. ⚠️ Vercel deployment — USE THE `gapmap-web` PROJECT

**`gapmap.myind.ai` is served by the Vercel project `gapmap-web`** (`prj_ztaztsE6lqisTHVpg4aXwDodZXFR`,
org `shantanu-bombatkars-projects`, git `gapmap_web`).
Dashboard: https://vercel.com/shantanu-bombatkars-projects/gapmap-web

### Correct deploy procedure
```bash
cd act_suit/activation-suite
# 1. Make sure local main == origin/main (commit + push your changes first)
# 2. Link to the RIGHT project (do NOT use bare `vercel link --yes` — it creates
#    a new project named after the folder!)
vercel link --yes --project gapmap-web
# 3. Deploy to production (aliases gapmap.myind.ai)
vercel --prod --yes
# 4. Verify
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://gapmap.myind.ai/v1/licence/validate   # expect 401 (live)
```

### Gotcha that bit us (2026-06-03)
- `vercel link --yes` (no `--project`) **created a stray project "activation-suite"**
  from the folder name and connected the `gapmap_web` repo to it. That deploy only
  updated `activation-suite.vercel.app`, NOT `gapmap.myind.ai`.
- **Fix:** always link with `--project gapmap-web`. The stray `activation-suite`
  project should be removed: `vercel remove activation-suite` (and disconnect its git)
  to avoid double-deploys on future pushes. *(TODO — see §8.)*

### Auto-deploy note
The prod deploy was **9 days stale** before 2026-06-03 — pushing to `gapmap_web/main`
did not auto-deploy to production (production branch may differ, or auto-deploy is off).
Until that's confirmed, **deploy via the CLI procedure above** after pushing.

---

## 5. Local dev bring-up

```bash
# Website (licence server) on :3939
cd act_suit/activation-suite
node_modules/.bin/next dev -p 3939        # health: curl localhost:3939/api/v1/health -> {"ok":true}

# Desktop app — secret MUST match the website's TOKEN_SIGNING_SECRET
cd app-tauri
set -a; source ../act_suit/activation-suite/.env; set +a
export JWT_DESKTOP_SECRET="$TOKEN_SIGNING_SECRET"
export GAPMAP_LICENSE_API_BASE="http://127.0.0.1:3939"
# (gate is ON by default; bypass in dev with: export GAPMAP_LICENSE_GATE_ENABLED=0)
npm run tauri:dev                          # verify: grep -c "JWT_DESKTOP_SECRET missing" /tmp/tauri-dev.log  == 0
```

---

## 6. Shipping the desktop app (needs your machine/keys)
A signed release build is the one step that can't be automated here:
```bash
cd app-tauri
set -a; source ../act_suit/activation-suite/.env; set +a
export JWT_DESKTOP_SECRET="$TOKEN_SIGNING_SECRET"   # MUST match prod TOKEN_SIGNING_SECRET
npm run tauri build                                  # + code-signing / notarization identity
```

---

## 7. Session change log (2026-06-03)

### Website (`activation-suite`, repo `gapmap_web/main`)
- `f5e92ad` — add `/v1/licence/validate` alias (the app's validate path)
- enriched `/api/v1/licence/validate` to return `expires_at/trial_ends_at/is_trial/plan_id/status`
- `/activate` page rewrite (guided 3-step desktop-only flow; removed browser
  activation, fake BYOK/purchase data, raw JWT; Devices + Billing tabs)
- **Deployed to production** (gapmap-web) and verified 2026-06-03.

### App (`app-tauri`, repo `gap-map-pro/multi-source`)
- `f07fe9b` — `license_revalidate` command + boot/6h timer + `revoked` field + gate sync
- `4eea92d` — in-app activation flow fixes (`#/activate` route → Settings licence card,
  optional password, dynamic API base, Billing copy, `revoked` gate entry)
- `1de9c0e` — **gate ON by default** + dialog `confirm/ask/message` permissions
  (fixes signout crash) + simplify licence card (remove API-base input)
- `441008d` — await every control-flow `confirm()` dialog (Tauri async dialog)
- `635d001` — remove API-base input from the **onboarding** activation step
- `76ec2a4` — periodic re-validation only locks on **explicit** revocation
  (404/5xx no longer wrongly lock the app)
- `6a9ab5a` — guard onboarding Step-6 against detached DOM

---

## 8. Known follow-ups / manual TODO

- [x] ✅ **DONE 2026-06-03 — rotated `ADMIN_SECRET`.** Set a strong `openssl rand -hex 32`
      in Vercel `gapmap-web` Production + redeployed. Verified: old placeholder → `bad_secret`/403,
      new secret → `authed:true`/200. New value saved (gitignored) in `.admin-creds.local.md`.
- [ ] 🚨 **Verify/rotate `TOKEN_SIGNING_SECRET` (HIGH).** The **local `.env`**
      `TOKEN_SIGNING_SECRET` is **placeholder-like** (len 53 — looks like the dev fallback
      `dev-local-jwt-secret-change-before-release-…`). A weak value lets anyone forge licence
      tokens. **Check the Vercel `gapmap-web` Production value.** If weak, rotation is a
      *coordinated* change: set a strong value in Vercel **and** ship the next app release
      built with the matching `JWT_DESKTOP_SECRET` — this invalidates all existing
      activations (users must re-activate). `DEV_MINT_SECRET` + `MASTER_KEY` looked random.
- [x] ✅ **DONE 2026-06-03 — removed the stray `activation-suite` Vercel project**
      (created by mistake during the first wrong deploy).
- [ ] **Confirm prod auto-deploy** for `gapmap-web` (which branch is production? is
      git auto-deploy on?). If off, document that releases deploy via the CLI (§4).
- [ ] **Set `NEXT_PUBLIC_APP_DOWNLOAD_URL`** in the website env (currently empty;
      falls back to `/api/download` → GitHub latest release redirect).
- [ ] **Ship a signed desktop release** with the matching `JWT_DESKTOP_SECRET` (§6).
- [x] ✅ **DONE 2026-06-03 — deleted the throwaway demo Supabase account**
      `trydemo+1780458870@gapmap-test.local` + its licence rows.
- [x] ✅ **DONE 2026-06-03 — removed dead `isValidHttpsUrl`** in `welcome.js` (commit `3c18536`).

---

## 9. Test scripts (local, self-cleaning) used this session
- Full live e2e (signin→trial→activate→validate→device-limit→deactivate→revoke→reactivate): **12/12**
- File-store loop (no shared infra): **5/5**
- Cross-app secret match (server token verifies under app secret): **4/4**
- App JS suite: **50/50** · Rust `cargo check`/`build`: **0 errors**

> Test pattern: create a throwaway confirmed Supabase user via the admin API,
> run the flow against `localhost:3939`, delete the user + licence rows on exit.
> dev/mint is gated by `ALLOW_DEV_MINT=true` (off in prod).
