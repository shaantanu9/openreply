# Email (Resend) — setup, and changing the key / domain later

Transactional email (license-key delivery) goes through **Resend**. The whole
integration is driven by **two env vars**, read fresh on every send:

| Env var | Purpose |
|---|---|
| `RESEND_API_KEY` | Resend API key (`re_…`). If unset, email is skipped gracefully (the app still issues/returns keys). |
| `EMAIL_FROM` | Sender, e.g. `Gap Map <keys@gapmap.myind.ai>`. Defaults to `onboarding@resend.dev` (Resend's test sender — only delivers to your own account email). |

When a user is issued a free key (`POST /api/v1/licence/free`), the key is also
emailed to them (since the UI shows it only once). `src/lib/email.ts` is the one
place that talks to Resend.

## First-time setup (~10 min, mostly DNS)
1. Create a Resend account → https://resend.com
2. **Verify your sending domain** (e.g. `gapmap.myind.ai`): Resend → Domains →
   Add Domain → copy the 4 DNS records (MX, SPF TXT, DKIM TXT, DMARC TXT) into
   your DNS host. Cloudflare: set all 4 to **DNS only** (gray cloud). Don't skip
   **DMARC** (`v=DMARC1; p=none;`) or Gmail/Apple demote you to Promotions.
3. Create an **API key** (Sending access, scoped to that domain) → copy it once.
4. Set env on Vercel (Project → Settings → Environment Variables):
   - `RESEND_API_KEY=re_…`
   - `EMAIL_FROM="Gap Map <keys@gapmap.myind.ai>"`
5. **Redeploy.** Done.

## Changing the API key later — SIMPLE
1. Resend → API Keys → create a new key (revoke the old one).
2. Update `RESEND_API_KEY` on Vercel.
3. Redeploy. **No code change, no app release.** (The key is read at send-time.)

## Changing the sending domain later — SIMPLE
1. Verify the **new** domain in Resend (its own 4 DNS records).
2. (Recommended) create a new API key scoped to the new domain.
3. Update env: `EMAIL_FROM="Gap Map <keys@newdomain>"` (and `RESEND_API_KEY` if rotated).
4. Redeploy. **No code change.** `EMAIL_FROM` is read on every send, so the new
   sender takes effect immediately on the next deploy.

## Why it's easy
Both values are **server-side env vars read per send** — never hardcoded, never
cached at module load. The desktop app never touches email. So rotating the key
or switching domains/providers is an env edit + redeploy, nothing more.

## Optional: route Supabase *auth* emails (signup confirm / password reset)
through Resend too — that's a separate one-time SMTP config (see the
`supabase-resend-smtp` skill: PATCH the Supabase auth config with Resend SMTP
host/port/user/pass). Independent of this transactional setup.
