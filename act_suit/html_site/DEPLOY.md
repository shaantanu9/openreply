# Deploying the static site (Vercel or similar)

## What the build does

`npm run build` runs `generate-env-config.mjs`, which **writes** `env.config.js` with **only** the keys in `PUBLIC_ENV_KEYS` (see that file). Browsers only ever load that public bundle.

**Secrets** (Supabase service role, Lemon Squeezy API key, webhook signing secrets, LLM keys, etc.) must **not** be in `PUBLIC_ENV_KEYS`. Put them in server-side env (Edge Functions, backend, webhook) — they are **never** embedded by this script.

## Vercel

1. Create a project with **root directory** = `act_suit/html_site` (or the folder that contains this `package.json` and `index.html`).

2. **Framework Preset:** Other, or N/A for static.

3. **Build Command:** `npm run build` (default if `package.json` has a `build` script).

4. **Output directory:** `.` (current directory). This is set in `vercel.json` as `outputDirectory: "."`

5. **Environment Variables** (Project → Settings → Environment Variables) — add **only** these names for **Production** (and **Preview** if you want), and make sure they are **available at build time** (Vercel exposes them to `process.env` during `npm run build`):

   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY` (this is a **public** client key; RLS is what secures your data)
   - `LICENSE_API_BASE` (if your API is meant to be called from the browser with the user JWT)
   - `APP_DOWNLOAD_URL` (optional, direct DMG/App download URL for marketing CTAs)
   - `APP_DEEP_LINK_URL` (optional desktop deep-link for post-activation "Open app" button, e.g. `openreply://dashboard`)
   - `LEMONSQUEEZY_CHECKOUT_PRO`
   - `LEMONSQUEEZY_CHECKOUT_LIVE_PASS`
   - `LEMONSQUEEZY_CUSTOMER_PORTAL`

6. **Do not** add `SUPABASE_SERVICE_ROLE_KEY` or other server-only names expecting them to “hide” in the app — the static site cannot use them safely; if you add them in Vercel for other (server) projects, this generator **ignores** them for `env.config.js` (and will log a warning if it sees they are set in `process.env`).

7. Redeploy after changing environment variables so `env.config.js` is regenerated on the build.

## Local

Use `.env` (gitignored) and run `npm run build` or `node generate-env-config.mjs`. File-based values are used when `process.env` does not override them (except in `OPENREPLY_ENV_SAMPLE_ONLY=1` for placeholder builds).

## Other hosts (Netlify, Cloudflare Pages, etc.)

Same idea: set the public keys as **build** environment variables and run `npm run build` before serving the folder. The host must run the build with those variables present.

## Security: licences and “should we use a framework?”

**What actually secures licensing**

- The **browser is not trusted** for anything secret. This site only sends a **user JWT (Supabase)** and an **activation key** to **your** `LICENSE_API_BASE`; it must not mint licences or hold signing keys.
- **Mints, HMAC, webhook verification, Lemon Squeezy API calls** belong on a **server** you control (dedicated API, Supabase **Edge Function**, Tauri’s Rust, etc.) with **service / signing env** never in `PUBLIC_ENV_KEYS`.
- Harden the **licence API**: auth required, **rate limits**, one-time or bounded use of keys, log suspicious attempts. That matters more than React vs static HTML.
- The generated **`env.config.js`** is still a **public** bundle (anon key, public URLs). **RLS** and **server checks** protect data, not “hiding” the front-end file.

**What we added in this folder**

- `vercel.json` **HTTP security headers** (CSP, frame options, `nosniff`, `Referrer-Policy`, etc.) to cut XSS/clickjacking and tighten defaults. If something breaks in preview (e.g. a new external script), narrow or adjust the CSP in `vercel.json`.

**When a framework helps (Next.js, Astro, SvelteKit, etc.)**

- You want **server-only routes** (e.g. `POST /api/activate` on the same deploy) with secrets only on the server, **CSP nonces** without `'unsafe-inline'`, or a single typed codebase.
- You **do not** need a framework just for “safety” if the **licence service** is already a proper backend. Migrating is a product/architecture choice, not a requirement for a secure licence design.

**Optional next steps (backend-side)**

- Move activation to a **Supabase Edge Function** (validates key + user, returns token) so the browser never talks to a long-lived licence API with the same power as a misconfigured public endpoint.
- **Never** return the **service role** to the client; use short-lived, scoped tokens after activation.
