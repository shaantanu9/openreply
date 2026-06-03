import { Resend } from "resend";

// Transactional email via Resend. No-ops gracefully when RESEND_API_KEY is
// unset so local dev / unconfigured deploys never break the license flow.
//
// Branded, email-client-safe HTML (table layout, inline styles) lives inline
// below so it ships with the serverless bundle on Vercel (no fs reads). The
// SOURCE OF TRUTH for the design is supabase/email_templates/{license_key,
// welcome}.html — if you edit those, re-sync here. Auth emails (OTP / recovery
// / confirmation) are served by Supabase from its own template config, pushed
// separately via the Management API.

// Read BOTH the API key and the sender at send-time (never cached) so rotating
// RESEND_API_KEY or changing the sending domain (EMAIL_FROM) takes effect with
// just an env-var change + redeploy — no code change, no app release.
function apiKey(): string {
  // Accept either name — the project env uses RESEND_API_KEY_TOOL_MAIL.
  return (process.env.RESEND_API_KEY || process.env.RESEND_API_KEY_TOOL_MAIL || "").trim();
}
function fromAddress(): string {
  return (process.env.EMAIL_FROM || "Gap Map <noreply@tool.myind.ai>").trim();
}

export function emailEnabled(): boolean {
  return apiKey().length > 0;
}

type SendResult = { ok: boolean; skipped?: boolean; id?: string; error?: string };

async function send(to: string, subject: string, html: string, text: string): Promise<SendResult> {
  if (!emailEnabled()) return { ok: false, skipped: true };
  try {
    const resend = new Resend(apiKey());
    const { data, error } = await resend.emails.send({ from: fromAddress(), to, subject, html, text });
    if (error) throw new Error(typeof error === "string" ? error : error.message || "resend error");
    return { ok: true, id: data?.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Email the user their license key (it's shown once in the UI). */
export async function sendLicenseKeyEmail(to: string, key: string): Promise<SendResult> {
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F6F3EE;-webkit-font-smoothing:antialiased">
<span style="display:none;max-height:0;overflow:hidden;opacity:0">Your Gap Map license key</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6F3EE"><tr><td align="center" style="padding:34px 16px">
 <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%">
  <tr><td style="padding:2px 6px 20px"><table role="presentation" cellpadding="0" cellspacing="0"><tr>
   <td style="vertical-align:middle"><div style="width:32px;height:32px;border-radius:9px;background:#FF8C42;text-align:center;font-family:Arial,sans-serif;font-weight:800;font-size:17px;line-height:32px;color:#fff">G</div></td>
   <td style="vertical-align:middle;padding-left:11px;font-family:Georgia,serif;font-weight:700;font-size:18px;color:#1A1614">Gap&nbsp;Map</td></tr></table></td></tr>
  <tr><td style="background:#fff;border:1px solid #ECE6DC;border-radius:18px;padding:32px 30px;box-shadow:0 8px 28px rgba(26,22,20,0.05)"><div style="font-family:Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#FF8C42;margin:0 0 8px">You are in</div><h1 style="font-family:Georgia,serif;font-size:23px;line-height:1.22;color:#1A1614;margin:0 0 10px;font-weight:600">Your key to <span style="font-family:Georgia,serif;font-style:italic;color:#FF8C42">the gaps</span></h1><p style="font-family:Arial,sans-serif;font-size:14.5px;line-height:1.65;color:#4A4339;margin:0 0 12px">Your license key &mdash; shown once, so keep it safe.</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0"><tr><td align="center" style="background:#FBF8F2;border:1px dashed #E0C2A2;border-radius:12px;padding:16px"><div style="font-family:ui-monospace,Menlo,monospace;font-size:22px;font-weight:700;letter-spacing:4px;color:#1A1614">${key}</div></td></tr></table><table role="presentation" cellpadding="0" cellspacing="0" style="margin:2px 0 12px"><tr><td style="font-family:Arial,sans-serif;font-size:13px;line-height:1.9;color:#4A4339"><b>Activate in 60 seconds:</b><br>1. Open the Gap Map desktop app<br>2. <b>Settings &rarr; Licence</b> (or onboarding &rarr; Activate)<br>3. Paste the key + your email <b>${to}</b></td></tr></table><table role="presentation" width=100% cellpadding="0" cellspacing="0" style="margin:8px 0 4px"><tr><td style="border-radius:11px;background:#FF8C42;width:100%;text-align:center;"><a href="https://gapmap.myind.ai/download" style="display:inline-block;padding:13px 30px;font-family:Arial,sans-serif;font-size:15px;font-weight:700;color:#fff;text-decoration:none;border-radius:11px">Download for Mac &rarr;</a></td></tr></table><p style="font-family:Arial,sans-serif;font-size:12.5px;line-height:1.55;color:#8A8278;margin:10px 0 0">Activates up to 2 devices. Lost the key later? Reissue it anytime from your dashboard.</p></td></tr>
  <tr><td style="padding:16px 12px 0;font-family:Arial,sans-serif;font-size:12px;line-height:1.7;color:#8A8278;text-align:center">Gap&nbsp;Map · research intelligence for product teams<br><span style="color:#b8b0a6">Local-first · BYOK · your data stays on your machine</span></td></tr>
 </table></td></tr></table></body></html>`;
  const text = `Your Gap Map license key: ${key}

Activate in 60 seconds:
1. Open the Gap Map desktop app
2. Settings -> Licence (or onboarding -> Activate)
3. Paste the key + your email (${to})

Download for Mac: https://gapmap.myind.ai/download
Activates up to 2 devices. Reissue anytime from your dashboard.`;
  return send(to, "Your Gap Map license key", html, text);
}

/** Welcome email (optional, fired on first key issuance). */
export async function sendWelcomeEmail(to: string): Promise<SendResult> {
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F6F3EE;-webkit-font-smoothing:antialiased">
<span style="display:none;max-height:0;overflow:hidden;opacity:0">Welcome to Gap Map</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6F3EE"><tr><td align="center" style="padding:34px 16px">
 <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%">
  <tr><td style="padding:2px 6px 20px"><table role="presentation" cellpadding="0" cellspacing="0"><tr>
   <td style="vertical-align:middle"><div style="width:32px;height:32px;border-radius:9px;background:#FF8C42;text-align:center;font-family:Arial,sans-serif;font-weight:800;font-size:17px;line-height:32px;color:#fff">G</div></td>
   <td style="vertical-align:middle;padding-left:11px;font-family:Georgia,serif;font-weight:700;font-size:18px;color:#1A1614">Gap&nbsp;Map</td></tr></table></td></tr>
  <tr><td style="background:#fff;border:1px solid #ECE6DC;border-radius:18px;padding:32px 30px;box-shadow:0 8px 28px rgba(26,22,20,0.05)"><div style="font-family:Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#FF8C42;margin:0 0 8px">Welcome aboard</div><h1 style="font-family:Georgia,serif;font-size:23px;line-height:1.22;color:#1A1614;margin:0 0 10px;font-weight:600">Turn 40k posts of noise<br>into <span style="font-family:Georgia,serif;font-style:italic;color:#FF8C42">your next feature</span></h1><p style="font-family:Arial,sans-serif;font-size:14.5px;line-height:1.65;color:#4A4339;margin:0 0 12px">You just joined the teams who decide what to build from <b>evidence</b>, not guesswork. Gap Map sweeps Reddit, app reviews, HN, papers and 9 more sources, then hands you ranked pain points, DIY workarounds, and unsolved gaps &mdash; each traceable to the post behind it.</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 14px;background:#FBF8F2;border:1px solid #ECE6DC;border-radius:12px"><tr><td align="center" style="padding:9px 4px"><div style="font-family:Georgia,serif;font-size:21px;font-weight:700;color:#FF8C42">40k</div><div style="font-family:Arial,sans-serif;font-size:10px;color:#8A8278">posts / sweep</div></td><td align="center" style="padding:9px 4px"><div style="font-family:Georgia,serif;font-size:21px;font-weight:700;color:#FF8C42">13</div><div style="font-family:Arial,sans-serif;font-size:10px;color:#8A8278">sources</div></td><td align="center" style="padding:9px 4px"><div style="font-family:Georgia,serif;font-size:21px;font-weight:700;color:#FF8C42">10x</div><div style="font-family:Arial,sans-serif;font-size:10px;color:#8A8278">faster</div></td></tr></table><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 11px"><tr><td width="34" style="vertical-align:top"><div style="width:26px;height:26px;border-radius:7px;background:#FFE9D6;text-align:center;font-size:14px;line-height:26px">&#128202;</div></td><td style="vertical-align:top;padding-left:8px"><div style="font-family:Arial,sans-serif;font-size:13.5px;font-weight:700;color:#1A1614">Multi-source sweep</div><div style="font-family:Arial,sans-serif;font-size:12.5px;line-height:1.5;color:#8A8278">13 sources, one timeline, one sweep.</div></td></tr></table><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 11px"><tr><td width="34" style="vertical-align:top"><div style="width:26px;height:26px;border-radius:7px;background:#FFE9D6;text-align:center;font-size:14px;line-height:26px">&#128506;</div></td><td style="vertical-align:top;padding-left:8px"><div style="font-family:Arial,sans-serif;font-size:13.5px;font-weight:700;color:#1A1614">The gap map</div><div style="font-family:Arial,sans-serif;font-size:12.5px;line-height:1.5;color:#8A8278">Pain &harr; products &harr; evidence as a graph.</div></td></tr></table><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 11px"><tr><td width="34" style="vertical-align:top"><div style="width:26px;height:26px;border-radius:7px;background:#FFE9D6;text-align:center;font-size:14px;line-height:26px">&#128196;</div></td><td style="vertical-align:top;padding-left:8px"><div style="font-family:Arial,sans-serif;font-size:13.5px;font-weight:700;color:#1A1614">Decision-ready</div><div style="font-family:Arial,sans-serif;font-size:12.5px;line-height:1.5;color:#8A8278">Sourced briefs your CEO can click into.</div></td></tr></table><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 14px"><tr><td style="border-left:3px solid #FF8C42;padding:2px 0 2px 14px"><div style="font-family:Georgia,serif;font-style:italic;font-size:13.5px;line-height:1.55;color:#4A4339">Cut two weeks of research synthesis to two days, with better source coverage than before.</div><div style="font-family:Arial,sans-serif;font-size:11.5px;color:#8A8278;margin-top:5px">&mdash; Shreya R., Head of Product</div></td></tr></table><table role="presentation" width=100% cellpadding="0" cellspacing="0" style="margin:8px 0 4px"><tr><td style="border-radius:11px;background:#FF8C42;width:100%;text-align:center;"><a href="https://gapmap.myind.ai/download" style="display:inline-block;padding:13px 30px;font-family:Arial,sans-serif;font-size:15px;font-weight:700;color:#fff;text-decoration:none;border-radius:11px">Download for Mac &rarr;</a></td></tr></table><p style="font-family:Arial,sans-serif;font-size:13px;margin:8px 0 0;text-align:center"><a href="https://gapmap.myind.ai/explore" style="color:#FF8C42;font-weight:700;text-decoration:none">Or explore live gap maps from real markets &rarr;</a></p></td></tr>
  <tr><td style="padding:16px 12px 0;font-family:Arial,sans-serif;font-size:12px;line-height:1.7;color:#8A8278;text-align:center">Gap&nbsp;Map · research intelligence for product teams<br><span style="color:#b8b0a6">Local-first · BYOK · your data stays on your machine</span></td></tr>
 </table></td></tr></table></body></html>`;
  const text = `Welcome to Gap Map.

Turn 40k posts of noise into your next feature. Gap Map sweeps Reddit, app reviews, HN, papers and 9 more sources, then hands you ranked pain points, DIY workarounds, and unsolved gaps - each traceable to the post behind it.

Download for Mac: https://gapmap.myind.ai/download
Explore live gap maps: https://gapmap.myind.ai/explore`;
  return send(to, "Welcome to Gap Map", html, text);
}
