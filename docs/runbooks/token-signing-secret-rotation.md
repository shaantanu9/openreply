# Runbook — Rotating `TOKEN_SIGNING_SECRET` / `JWT_DESKTOP_SECRET`

> **Severity:** HIGH · **Type:** coordinated website + app change · **Last reviewed:** 2026-06-03
> This is NOT a simple env swap. The licence JWT is signed with a **symmetric** secret
> shared by the website and the desktop app — rotating it wrong locks every user out
> with no recovery path. Read the whole runbook before starting.

---

## 1. Why this is special

```
Website (Next.js)                         Desktop app (Tauri)
  signs JWT with                            verifies JWT with
  TOKEN_SIGNING_SECRET   ── must equal ──►   JWT_DESKTOP_SECRET (baked at build time)
```

- Website: `act_suit/activation-suite/src/lib/token.ts`
  - `signingSecret()` → `process.env.TOKEN_SIGNING_SECRET` (HS256)
  - `issueActivationToken()` signs; `verifyActivationToken()` verifies (also the master-token path)
  - Used by `POST /v1/device/activate` (issue) and `POST /v1/licence/validate` (verify)
- App: `app-tauri/src-tauri/build.rs` bakes `JWT_DESKTOP_SECRET` into the binary
  (`cargo:rustc-env`); `verify_license_token()` in `commands.rs` reads it via
  `env!("JWT_DESKTOP_SECRET")`. **Debug fallback = `dev-local-jwt-secret-change-before-release-0123456789`**
  (this is the len-53 placeholder flagged in the audit — verify prod isn't using it).

**The trap:** the two sides must hold the *same* secret at the same time. With my
periodic-validation fix, a signature mismatch on `/v1/licence/validate` returns **401**,
which the app treats as an explicit revocation → **the app locks**. So if you change the
website secret without also shipping an app built with the matching secret, **every
installed app locks on its next re-validation** (boot / every 6 h), and re-activating
won't help (the new token won't verify under the old baked secret).

## 2. What breaks vs. what does NOT

- **Breaks:** every previously-issued JWT (signature no longer matches). Apps lock; the
  in-app re-validation returns 401.
- **Does NOT break:** the licences/keys themselves. `licenses` + `license_devices` in
  Supabase are untouched — keys are stored as `sha256(key)`, independent of the JWT secret.
  **Users re-activate with the SAME key** once they're on an app build with the new secret.

---

## 3. Pre-flight checklist (do these first)

- [ ] Generate the new secret: `openssl rand -hex 32` (≥32 chars; keep it out of stdout/logs).
- [ ] Confirm the CURRENT prod value in Vercel → `openreply-web` → Settings → Env Vars →
      `TOKEN_SIGNING_SECRET` (Production). Note it as `OLD` for the dual-secret window.
- [ ] Confirm you can build + sign + ship a desktop release (you need this for either option).
- [ ] Decide the option below based on how many live activated users you have.
- [ ] Announce a maintenance window if using Option B.

---

## Option A — Graceful dual-secret rotation (RECOMMENDED if you have live users)

Goal: **zero forced lockouts.** Make both sides accept OLD **and** NEW during a transition,
flip signing to NEW, let users update over time, then drop OLD. Requires small code changes.

### A1. Code: website verifies BOTH secrets, signs with NEW
In `act_suit/activation-suite/src/lib/token.ts`, add a fallback verify against
`TOKEN_SIGNING_SECRET_PREVIOUS`:

```ts
// signing stays on the primary:
function signingSecret(): Secret { /* uses TOKEN_SIGNING_SECRET (NEW after the flip) */ }

export function verifyActivationToken(token: string): VerifiedClaims {
  const opts = { algorithms: ["HS256"] as const, issuer: "...", audience: "..." };
  try {
    return jwt.verify(token, process.env.TOKEN_SIGNING_SECRET!, opts) as VerifiedClaims;
  } catch (e) {
    const prev = process.env.TOKEN_SIGNING_SECRET_PREVIOUS;
    if (prev && prev.length >= 32) {
      return jwt.verify(token, prev, opts) as VerifiedClaims;   // accept OLD-signed tokens
    }
    throw e;
  }
}
```
Apply the same try/fallback to the **master-token verify** path (the other `jwt.verify`
in this file) if master keys are in use.

### A2. Code: app verifies BOTH baked secrets
In `app-tauri/src-tauri/build.rs`, also bake an optional previous secret:
```rust
if let Ok(prev) = std::env::var("JWT_DESKTOP_SECRET_PREVIOUS") {
    println!("cargo:rustc-env=JWT_DESKTOP_SECRET_PREVIOUS={}", prev);
} else {
    println!("cargo:rustc-env=JWT_DESKTOP_SECRET_PREVIOUS=");
}
println!("cargo:rerun-if-env-changed=JWT_DESKTOP_SECRET_PREVIOUS");
```
In `commands.rs::verify_license_token`, try primary then previous:
```rust
fn verify_license_token(token: &str) -> Result<VerifiedTokenClaims, String> {
    let primary = env!("JWT_DESKTOP_SECRET");
    let previous = env!("JWT_DESKTOP_SECRET_PREVIOUS"); // "" when unset
    for secret in [primary, previous] {
        if secret.is_empty() { continue; }
        let key = DecodingKey::from_secret(secret.as_bytes());
        let mut v = Validation::new(Algorithm::HS256);
        v.validate_exp = false;
        v.set_issuer(&["openreply-activation-suite"]);
        v.set_audience(&["openreply-desktop"]);
        if let Ok(d) = decode::<VerifiedTokenClaims>(token, &key, &v) { return Ok(d.claims); }
    }
    Err("invalid activation token: InvalidSignature".into())
}
```

### A3. Rollout order (the safe sequence)
1. **Ship the dual-verify app** built with `JWT_DESKTOP_SECRET=NEW` **and**
   `JWT_DESKTOP_SECRET_PREVIOUS=OLD`. (It accepts both → works against the OLD website.)
2. Wait for adoption (old single-secret apps still work — website still signs with OLD).
3. **Flip the website:** set Vercel prod `TOKEN_SIGNING_SECRET_PREVIOUS = OLD` and
   `TOKEN_SIGNING_SECRET = NEW`, **deploy the dual-verify website (A1)**, redeploy.
   - Now the website signs NEW, verifies OLD+NEW. New activations get NEW tokens.
   - Old single-secret apps (baked OLD) still verify locally and the website still accepts
     their OLD tokens on validate → they keep working.
   - Dual-verify apps accept NEW tokens too.
4. **Drain:** once nearly everyone is on the dual-verify app (telemetry / time-boxed, e.g.
   2–4 weeks), remove `TOKEN_SIGNING_SECRET_PREVIOUS` from Vercel + redeploy. Any remaining
   OLD-only apps will lock and prompt re-activation (they're rare by now).
5. **Optional final app build:** drop `JWT_DESKTOP_SECRET_PREVIOUS` from the next release.

> Net effect: no flag-day lockout. Stragglers re-activate (same key) after updating.

---

## Option B — Flag-day rotation (OK for beta / very few activated users)

Goal: simplest. Accept that **everyone must update the app + re-activate once.**

1. Build + sign + ship the new app release with `JWT_DESKTOP_SECRET=NEW`
   (no previous secret needed). Make it the only download.
2. Set Vercel `openreply-web` Production `TOKEN_SIGNING_SECRET = NEW`, redeploy.
3. All installed (old) apps lock on next re-validation (401 → revoked). Notify users:
   **"Update OpenReply, then re-activate with your existing key."**
4. Users download the new app → re-activate (same key) → new token signed+verified with NEW.

> Use this only when the activated-user count is small enough that a forced
> update + re-activate is acceptable. Otherwise use Option A.

---

## 4. Build the app with the secret (both options)

```bash
cd app-tauri
export JWT_DESKTOP_SECRET="<NEW 32+ char secret>"        # must equal Vercel prod TOKEN_SIGNING_SECRET
# Option A only:
export JWT_DESKTOP_SECRET_PREVIOUS="<OLD secret>"
touch src-tauri/build.rs                                  # force re-bake
npm run tauri build                                       # + code-signing / notarization
# sanity: the release build must NOT print "JWT_DESKTOP_SECRET missing; using debug fallback"
```

## 5. Verification

```bash
# After the website flip, run the prod e2e (self-cleaning) — must be 6/6:
bash /tmp/prod-e2e.sh        # key -> activate -> validate -> revoke -> reactivate

# Spot check a freshly activated token verifies under the NEW secret only
# (and, during the dual window, that an OLD-signed token still validates: expect 200).
```
- New activation → `/v1/licence/validate` returns `valid:true` ✓
- (Option A window) an OLD-secret app's token still returns `valid:true` ✓
- After dropping the previous secret, an OLD token returns `valid:false/revoked` ✓

## 6. Rollback
- **Website:** revert the Vercel env (`TOKEN_SIGNING_SECRET` back to OLD) + redeploy. Old
  apps recover immediately. (Dual-verify website tolerates this automatically.)
- **App:** keep the previous signed release available so users can downgrade if needed.
- Because keys live in Supabase untouched, no data is ever lost — worst case is
  "everyone re-activates once."

## 7. User comms (Option B / stragglers)
> **OpenReply — quick re-activation needed.** We rotated a security key. Please update OpenReply
> to the latest version, open it, go to **Settings → Licence → Activate this device**, and
> enter your **email + the same activation key** you already have. Your data stays on your
> Mac — nothing is lost. (No new purchase needed.)

---

## 8. Don't forget
- Keep the new secret out of git/stdout/logs. Store it in the gitignored `.admin-creds.local.md`
  / your secret manager, and Vercel env only.
- After rotation, update `LICENSING_AND_DEPLOY.md` §8 (mark the TOKEN_SIGNING_SECRET item done).
- The website also signs **master tokens** with the same secret — if you use `MASTER_KEY`,
  the dual-verify (A1) must cover the master path too, and master-activated devices follow
  the same re-activation rule.
