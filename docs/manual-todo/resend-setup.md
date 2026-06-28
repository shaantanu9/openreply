# Resend SMTP for Supabase auth emails — operator runbook

**Status**: 3 manual pre-reqs + 1 script call. ~10 min total.

**Why**: Supabase's built-in mailer is hard-capped at 2 emails/hour and
lands in Promotions. Without Resend, password reset, magic links, and
email-change confirmations are effectively broken at any real scale.
Today (`smtp_host: null` on the project), **zero emails are flowing**.

This runbook is the operator side of the
`supabase-resend-smtp` skill — battle-tested on Unmute 2026-05-04.

---

## Pre-req 1 — Resend account (3 min) — YOU

- [ ] Sign up at https://resend.com (Google / GitHub OAuth fine)
- [ ] Verify owner email
- [ ] Skip the "send a test email" onboarding screen — not needed yet

## Pre-req 2 — Domain DNS (5 min + propagation) — YOU

In Resend dashboard → **Domains** → **Add Domain**:

- [ ] Domain: `openreply.myind.ai`
- [ ] Region: closest to your users (US East is fine)
- [ ] Click **Add**

Resend will show 4 DNS records. Copy them into your DNS provider
(Cloudflare for `myind.ai`):

| Type | Name | Content |
|---|---|---|
| MX | `send.openreply.myind.ai` | `feedback-smtp.us-east-1.amazonses.com` priority 10 |
| TXT | `send.openreply.myind.ai` | `v=spf1 include:amazonses.com ~all` |
| TXT | `resend._domainkey.openreply.myind.ai` | (long DKIM key — copy verbatim, one line) |
| TXT | `_dmarc.openreply.myind.ai` | `v=DMARC1; p=none;` |

⚠️ **DO NOT skip DMARC.** Without it, Gmail/Apple Mail demote you to
Promotions even with valid SPF+DKIM.

⚠️ In Cloudflare, set **Proxy status: DNS only** (gray cloud) for all 4
records. Orange-cloud proxy breaks email DNS records.

⚠️ DKIM key is long. Paste it **verbatim as one line** — Cloudflare's
UI sometimes wraps it; that breaks the signature.

- [ ] Domain shows "Verified" in Resend Dashboard (1-15 min on Cloudflare;
      up to 24h on slower registrars)

## Pre-req 3 — Resend API key (1 min) — YOU

In Resend → **API Keys** → **Create API Key**:

- [ ] Name: `OpenReply Supabase SMTP`
- [ ] Permission: **Sending access** → restrict to `openreply.myind.ai`
- [ ] **Copy the key immediately** (`re_…`) — Resend shows it once only
- [ ] Save it in 1Password as `OpenReply / Resend SMTP`

## Push step — ME (or you with one command)

```bash
RESEND_API_KEY='re_PASTE_HERE' \
SUPABASE_PAT="$(grep ^PAT_TOKEN .env.publish | cut -d= -f2)" \
  python3 supabase/email_templates/_smtp_resend.py
```

That file lives in the website repo (`shaantanu9/openreply_web`). To run it from
this main repo:

```bash
cd /tmp && gh repo clone shaantanu9/openreply_web /tmp/openreply_web_resend 2>/dev/null
cd /tmp/openreply_web_resend
RESEND_API_KEY='re_…' SUPABASE_PAT="$(grep ^PAT_TOKEN $OLDPWD/.env.publish | cut -d= -f2)" \
  python3 supabase/email_templates/_smtp_resend.py
```

Expected output:
```
OK status=200
  host=smtp.resend.com:465  user=resend
  from='OpenReply <auth@openreply.myind.ai>'
  rate_limit_email_sent=30/hr
```

## Smoke-test (MANDATORY before next step) — YOU

Get the anon key from the website's `.env` and trigger a recovery email
to your inbox:

```bash
SUPABASE_ANON_KEY=$(grep ^NEXT_PUBLIC_SUPABASE_ANON_KEY act_suit/activation-suite/.env | cut -d= -f2-)
PROJECT_REF=tjikcnsfaaqihgegecpi
curl -X POST "https://${PROJECT_REF}.supabase.co/auth/v1/recover" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"<your-test-inbox@gmail.com>"}'
```

Verify in inbox:
- [ ] Lands in **Inbox** (not Promotions or Spam)
- [ ] From: `OpenReply <auth@openreply.myind.ai>`
- [ ] Subject + body look right (branded — not the default Supabase blob)
- [ ] The CTA in the email opens https://openreply.myind.ai/auth/v1/verify... and
      redirects back

If it lands in Promotions:
- Re-check the DMARC TXT record
- Tone-check the body — keep it transactional, no marketing-tone phrasing
- Wait an hour for sender warmup

If it never arrives:
- Check Resend → Logs. If it's not there, Supabase didn't send (auth-check
  failed / sender domain mismatch / SMTP creds wrong)
- If it IS in Resend logs but not in your inbox, it's deliverability
  (Gmail/Apple Mail rules)

## (Optional) Enforce email confirmation on signup — YOU

Today `mailer_autoconfirm: true` — signups skip email verification. Many
apps want to flip this on once SMTP is reliable. Only do it AFTER the
smoke test passes:

```bash
RESEND_API_KEY='re_…' \
SUPABASE_PAT="$(grep ^PAT_TOKEN .env.publish | cut -d= -f2)" \
  python3 supabase/email_templates/_smtp_resend.py --enforce-confirmation
```

To revert if signups start failing:

```bash
curl -X PATCH \
  -H "Authorization: Bearer $SUPABASE_PAT" \
  -H "User-Agent: supabase-cli/2.48.3" \
  -H "Content-Type: application/json" \
  -d '{"mailer_autoconfirm": true}' \
  "https://api.supabase.com/v1/projects/tjikcnsfaaqihgegecpi/config/auth"
```

## What stays the same after this lands

| Change | App release? |
|---|---|
| Rotate Resend API key | No |
| Change sender email or name | No |
| Edit email templates | No |
| Switch Resend → Postmark / SES | No |
| Switch back to Supabase built-in | No |

The DMG and the website both pick up Resend automatically — it's a
server-side SMTP swap, invisible to clients.

## Multi-app extension (for later)

Once OpenReply is on Resend, you can add other apps under the same Resend
account. Each app verifies its own subdomain (e.g. `unmute.myind.ai`) and
gets its own API key + DKIM. One DMARC record at the apex
(`_dmarc.myind.ai`) applies to all. Free-tier 3k/mo is shared across all
domains in the account.

## Done?

When all checkboxes above are checked and the smoke-test passes, move
this file to `docs/manual-todo/done/resend-setup.md`.
