# Distinct, branded email templates (de-duplicated engagement)

**Date:** 2026-06-03
**Type:** UI Enhancement

## Summary

Reworked the four Gap Map emails so each carries **distinct, purpose-specific
content** instead of the same repeated engagement block (the same 40k/13/10x
stats strip, the same Shreya R. testimonial, the same "Explore live gap maps"
CTA, and overlapping feature rows were previously duplicated across every
email). The full sales pitch now lives only in the Welcome email; the others
lead with their functional ask and add a small, relevant extra.

## Changes

- **OTP / verification code** (`otp_code.html` → Supabase `magic_link` +
  `recovery`): minimal and security-flavored — code pill, expiry, one-time-use
  note. No stats/testimonial/features.
- **Confirmation** (`confirmation.html` → Supabase `confirmation`): confirm
  button + fallback link, then a unique "Then, in about 5 minutes" 3-step path
  (Download → Activate key → Run first sweep).
- **License key** (`license_key.html` → wired into `email.ts`): key pill + a
  unique "Activate in 60 seconds" numbered list + Download CTA + 2-device note.
- **Welcome** (`welcome.html` → wired into `email.ts`): the only email carrying
  the full pitch — story, 40k/13/10x stats strip, three framed features,
  testimonial, Download + Explore CTAs.
- Pushed `magic_link` / `recovery` / `confirmation` to the Supabase auth config
  via the Management API (PAT), with branded subjects.
- Replaced the inline `shell()` HTML in `src/lib/email.ts` with the branded,
  email-client-safe table layout for `sendLicenseKeyEmail` + `sendWelcomeEmail`
  (HTML embedded inline so it ships with the Vercel serverless bundle; source
  of truth remains the `supabase/email_templates/*.html` files). Added proper
  plaintext `text` fallbacks. `tsc --noEmit` clean.
- Re-triggered all four to shantanubombatkar2@gmail.com to verify delivery
  (license + welcome via the real Resend path, OTP via the real Supabase send,
  confirmation as a Resend preview render).

## Files Created

- `supabase/email_templates/otp_code.html`
- `supabase/email_templates/confirmation.html`
- `supabase/email_templates/license_key.html`
- `supabase/email_templates/welcome.html`
- `changelogs/2026-06-03_01_distinct-branded-email-templates.md`

## Files Modified

- `src/lib/email.ts` — branded HTML for license-key + welcome emails,
  read fresh per send; plaintext fallbacks.
- Supabase auth config (remote, via PAT) — `mailer_templates_magic_link_content`,
  `mailer_templates_recovery_content`, `mailer_templates_confirmation_content`
  and their subjects.
