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

// Shared <head> with a mobile media query. Desktop clients use the inline
// styles; phones (≤600px) tighten padding and shrink the big type via the
// gm-* classes. Gmail/Apple Mail/iOS Mail honour <style> media queries;
// Outlook ignores them and falls back to the desktop inline styles — which is
// why every element still carries its full inline style too.
const HEAD = `<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting"><meta name="color-scheme" content="light"><style>
@media only screen and (max-width:600px){
  .gm-pad{padding:22px 12px !important}
  .gm-card{padding:24px 20px !important;border-radius:14px !important}
  .gm-h1{font-size:20px !important;line-height:1.25 !important}
  .gm-lead{font-size:14px !important}
  .gm-key{font-size:16px !important;letter-spacing:2px !important}
  .gm-btn{font-size:15px !important;padding:14px 20px !important}
  .gm-stat{font-size:18px !important}
}
</style></head>`;

// HTML-escape user-supplied text (names) before interpolating into templates.
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// First name only, escaped — "" when we have no usable name.
function firstName(name?: string): string {
  const n = (name || "").trim().split(/\s+/)[0] || "";
  return n ? esc(n) : "";
}

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

// Optional licence facts to render in the key email. All fields are optional
// so the function stays a drop-in for callers that only have the key.
export type LicenceDetails = {
  planId?: string; // "pro" | "pro_trial" | "live_pass" | "team" | "free"
  isTrial?: boolean;
  expiresAt?: string | null; // ISO date/time; null = no expiry (keeps for the beta)
  maxDevices?: number; // device seats; defaults to 2 when unknown
  name?: string; // recipient's name, for a personalised greeting
};

const PLAN_LABELS: Record<string, string> = {
  pro: "Pro",
  pro_trial: "Pro · Trial",
  live_pass: "Pro · Live Pass",
  team: "Team",
  free: "Free",
};

function planLabel(planId?: string, isTrial?: boolean): string {
  const base = (planId && PLAN_LABELS[planId]) || (planId ? planId : "Pro");
  return isTrial && planId !== "pro_trial" ? `${base} · Trial` : base;
}

// "June 12, 2026" — null on missing/invalid input so callers can omit the row.
function fmtDate(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

/** Email the user their license key (it's shown once in the UI). */
export async function sendLicenseKeyEmail(
  to: string,
  key: string,
  details: LicenceDetails = {},
): Promise<SendResult> {
  const plan = planLabel(details.planId, details.isTrial);
  const expDate = fmtDate(details.expiresAt);
  const expLabel = details.isTrial ? "Trial ends" : "Renews on";
  const devices = Math.max(1, Math.trunc(details.maxDevices || 2));
  const fn = firstName(details.name);
  const greetHtml = fn ? `Hi ${fn}, your` : "Your";
  const greetText = fn ? `Hi ${fn}, your` : "Your";

  // Two-column "facts" rows (label muted, value bold). Each row only renders
  // when we actually have the value, so the block never shows blanks.
  const row = (label: string, value: string) =>
    `<tr><td style="padding:7px 0;border-bottom:1px solid #F0EADF;font-family:Arial,sans-serif;font-size:12.5px;color:#8A8278">${label}</td><td align="right" style="padding:7px 0;border-bottom:1px solid #F0EADF;font-family:Arial,sans-serif;font-size:13px;font-weight:700;color:#1A1614">${value}</td></tr>`;
  const factRows =
    row("Plan", plan) +
    (expDate ? row(expLabel, expDate) : row("Expires", "No expiry · yours for the beta")) +
    row("Devices", `Up to ${devices}`) +
    row("Tied to", to);
  const factsBlock = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:10px 0 14px;background:#FBF8F2;border:1px solid #ECE6DC;border-radius:12px;padding:4px 16px"><tbody>${factRows}</tbody></table>`;

  const html = `<!DOCTYPE html><html>${HEAD}
<body style="margin:0;padding:0;background:#F6F3EE;-webkit-font-smoothing:antialiased">
<span style="display:none;max-height:0;overflow:hidden;opacity:0">Your Gap Map license key — ${plan}, shown once</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6F3EE"><tr><td align="center" class="gm-pad" style="padding:34px 16px">
 <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%">
  <tr><td style="padding:2px 6px 20px"><table role="presentation" cellpadding="0" cellspacing="0"><tr>
   <td style="vertical-align:middle"><div style="width:32px;height:32px;border-radius:9px;background:#FF8C42;text-align:center;font-family:Arial,sans-serif;font-weight:800;font-size:17px;line-height:32px;color:#fff">G</div></td>
   <td style="vertical-align:middle;padding-left:11px;font-family:Georgia,serif;font-weight:700;font-size:18px;color:#1A1614">Gap&nbsp;Map</td></tr></table></td></tr>
  <tr><td class="gm-card" style="background:#fff;border:1px solid #ECE6DC;border-radius:18px;padding:32px 30px;box-shadow:0 8px 28px rgba(26,22,20,0.05)"><div style="font-family:Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#FF8C42;margin:0 0 8px">You are in</div><h1 class="gm-h1" style="font-family:Georgia,serif;font-size:23px;line-height:1.22;color:#1A1614;margin:0 0 10px;font-weight:600">Your key to <span style="font-family:Georgia,serif;font-style:italic;color:#FF8C42">the gaps</span></h1><p class="gm-lead" style="font-family:Arial,sans-serif;font-size:14.5px;line-height:1.65;color:#4A4339;margin:0 0 12px">${greetHtml} <b>${plan}</b> license key &mdash; shown once, so keep it safe.</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0"><tr><td align="center" style="background:#FBF8F2;border:1px dashed #E0C2A2;border-radius:12px;padding:16px"><div class="gm-key" style="font-family:ui-monospace,Menlo,monospace;font-size:21px;font-weight:700;letter-spacing:3px;color:#1A1614;word-break:break-all">${key}</div></td></tr></table>${factsBlock}<table role="presentation" cellpadding="0" cellspacing="0" style="margin:2px 0 12px"><tr><td style="font-family:Arial,sans-serif;font-size:13px;line-height:1.9;color:#4A4339"><b>Activate in 60 seconds:</b><br>1. Download &amp; open the Gap Map desktop app<br>2. <b>Settings &rarr; Licence</b> (or onboarding &rarr; Activate)<br>3. Paste the key + your email <b>${to}</b></td></tr></table><table role="presentation" width=100% cellpadding="0" cellspacing="0" style="margin:8px 0 4px"><tr><td style="border-radius:11px;background:#FF8C42;width:100%;text-align:center;"><a href="https://gapmap.myind.ai/download" class="gm-btn" style="display:inline-block;padding:13px 30px;font-family:Arial,sans-serif;font-size:15px;font-weight:700;color:#fff;text-decoration:none;border-radius:11px">Download Gap Map &rarr;</a></td></tr></table><p style="font-family:Arial,sans-serif;font-size:12.5px;line-height:1.55;color:#8A8278;margin:10px 0 0">Activates on up to ${devices} device${devices === 1 ? "" : "s"}. Lost the key later? Reissue it anytime from your <a href="https://gapmap.myind.ai/dashboard" style="color:#FF8C42;text-decoration:none">dashboard</a>.</p></td></tr>
  <tr><td style="padding:16px 12px 0;font-family:Arial,sans-serif;font-size:12px;line-height:1.7;color:#8A8278;text-align:center">Gap&nbsp;Map · research intelligence for product teams<br><span style="color:#b8b0a6">Local-first · BYOK · your data stays on your machine</span></td></tr>
 </table></td></tr></table></body></html>`;
  const text = `${greetText} Gap Map ${plan} license key: ${key}

Plan:    ${plan}
${expDate ? `${expLabel}: ${expDate}` : "Expires: No expiry — yours for the beta"}
Devices: Up to ${devices}
Tied to: ${to}

Activate in 60 seconds:
1. Download & open the Gap Map desktop app
2. Settings -> Licence (or onboarding -> Activate)
3. Paste the key + your email (${to})

Download (Mac · Windows · Linux): https://gapmap.myind.ai/download
Lost the key later? Reissue it anytime from https://gapmap.myind.ai/dashboard`;
  return send(to, `Your Gap Map ${plan} license key`, html, text);
}

/** Welcome email (optional, fired on first key issuance). */
export async function sendWelcomeEmail(to: string, name?: string): Promise<SendResult> {
  const fn = firstName(name);
  const welcomeLead = fn
    ? `Welcome, ${fn} — you just joined the teams who decide what to build from <b>evidence</b>, not guesswork.`
    : `You just joined the teams who decide what to build from <b>evidence</b>, not guesswork.`;
  const html = `<!DOCTYPE html><html>${HEAD}
<body style="margin:0;padding:0;background:#F6F3EE;-webkit-font-smoothing:antialiased">
<span style="display:none;max-height:0;overflow:hidden;opacity:0">Welcome to Gap Map</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6F3EE"><tr><td align="center" class="gm-pad" style="padding:34px 16px">
 <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%">
  <tr><td style="padding:2px 6px 20px"><table role="presentation" cellpadding="0" cellspacing="0"><tr>
   <td style="vertical-align:middle"><div style="width:32px;height:32px;border-radius:9px;background:#FF8C42;text-align:center;font-family:Arial,sans-serif;font-weight:800;font-size:17px;line-height:32px;color:#fff">G</div></td>
   <td style="vertical-align:middle;padding-left:11px;font-family:Georgia,serif;font-weight:700;font-size:18px;color:#1A1614">Gap&nbsp;Map</td></tr></table></td></tr>
  <tr><td class="gm-card" style="background:#fff;border:1px solid #ECE6DC;border-radius:18px;padding:32px 30px;box-shadow:0 8px 28px rgba(26,22,20,0.05)"><div style="font-family:Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#FF8C42;margin:0 0 8px">Welcome aboard</div><h1 class="gm-h1" style="font-family:Georgia,serif;font-size:23px;line-height:1.22;color:#1A1614;margin:0 0 10px;font-weight:600">Turn 40k posts of noise<br>into <span style="font-family:Georgia,serif;font-style:italic;color:#FF8C42">your next feature</span></h1><p class="gm-lead" style="font-family:Arial,sans-serif;font-size:14.5px;line-height:1.65;color:#4A4339;margin:0 0 12px">${welcomeLead} Gap Map sweeps Reddit, app reviews, HN, papers and 9 more sources, then hands you ranked pain points, DIY workarounds, and unsolved gaps &mdash; each traceable to the post behind it.</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 14px;background:#FBF8F2;border:1px solid #ECE6DC;border-radius:12px"><tr><td align="center" style="padding:9px 4px"><div class="gm-stat" style="font-family:Georgia,serif;font-size:21px;font-weight:700;color:#FF8C42">40k</div><div style="font-family:Arial,sans-serif;font-size:10px;color:#8A8278">posts / sweep</div></td><td align="center" style="padding:9px 4px"><div class="gm-stat" style="font-family:Georgia,serif;font-size:21px;font-weight:700;color:#FF8C42">13</div><div style="font-family:Arial,sans-serif;font-size:10px;color:#8A8278">sources</div></td><td align="center" style="padding:9px 4px"><div class="gm-stat" style="font-family:Georgia,serif;font-size:21px;font-weight:700;color:#FF8C42">10x</div><div style="font-family:Arial,sans-serif;font-size:10px;color:#8A8278">faster</div></td></tr></table><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 11px"><tr><td width="34" style="vertical-align:top"><div style="width:26px;height:26px;border-radius:7px;background:#FFE9D6;text-align:center;font-size:14px;line-height:26px">&#128202;</div></td><td style="vertical-align:top;padding-left:8px"><div style="font-family:Arial,sans-serif;font-size:13.5px;font-weight:700;color:#1A1614">Multi-source sweep</div><div style="font-family:Arial,sans-serif;font-size:12.5px;line-height:1.5;color:#8A8278">13 sources, one timeline, one sweep.</div></td></tr></table><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 11px"><tr><td width="34" style="vertical-align:top"><div style="width:26px;height:26px;border-radius:7px;background:#FFE9D6;text-align:center;font-size:14px;line-height:26px">&#128506;</div></td><td style="vertical-align:top;padding-left:8px"><div style="font-family:Arial,sans-serif;font-size:13.5px;font-weight:700;color:#1A1614">The gap map</div><div style="font-family:Arial,sans-serif;font-size:12.5px;line-height:1.5;color:#8A8278">Pain &harr; products &harr; evidence as a graph.</div></td></tr></table><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 11px"><tr><td width="34" style="vertical-align:top"><div style="width:26px;height:26px;border-radius:7px;background:#FFE9D6;text-align:center;font-size:14px;line-height:26px">&#128196;</div></td><td style="vertical-align:top;padding-left:8px"><div style="font-family:Arial,sans-serif;font-size:13.5px;font-weight:700;color:#1A1614">Decision-ready</div><div style="font-family:Arial,sans-serif;font-size:12.5px;line-height:1.5;color:#8A8278">Sourced briefs your CEO can click into.</div></td></tr></table><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 14px"><tr><td style="border-left:3px solid #FF8C42;padding:2px 0 2px 14px"><div style="font-family:Georgia,serif;font-style:italic;font-size:13.5px;line-height:1.55;color:#4A4339">Cut two weeks of research synthesis to two days, with better source coverage than before.</div><div style="font-family:Arial,sans-serif;font-size:11.5px;color:#8A8278;margin-top:5px">&mdash; Shreya R., Head of Product</div></td></tr></table><table role="presentation" width=100% cellpadding="0" cellspacing="0" style="margin:8px 0 4px"><tr><td style="border-radius:11px;background:#FF8C42;width:100%;text-align:center;"><a href="https://gapmap.myind.ai/download" class="gm-btn" style="display:inline-block;padding:13px 30px;font-family:Arial,sans-serif;font-size:15px;font-weight:700;color:#fff;text-decoration:none;border-radius:11px">Download Gap Map &rarr;</a></td></tr></table><p style="font-family:Arial,sans-serif;font-size:13px;margin:8px 0 0;text-align:center"><a href="https://gapmap.myind.ai/explore" style="color:#FF8C42;font-weight:700;text-decoration:none">Or explore live gap maps from real markets &rarr;</a></p></td></tr>
  <tr><td style="padding:16px 12px 0;font-family:Arial,sans-serif;font-size:12px;line-height:1.7;color:#8A8278;text-align:center">Gap&nbsp;Map · research intelligence for product teams<br><span style="color:#b8b0a6">Local-first · BYOK · your data stays on your machine</span></td></tr>
 </table></td></tr></table></body></html>`;
  const text = `${fn ? `Welcome, ${fn}!` : "Welcome to Gap Map."}

Turn 40k posts of noise into your next feature. Gap Map sweeps Reddit, app reviews, HN, papers and 9 more sources, then hands you ranked pain points, DIY workarounds, and unsolved gaps - each traceable to the post behind it.

Download (Mac · Windows · Linux): https://gapmap.myind.ai/download
Explore live gap maps: https://gapmap.myind.ai/explore`;
  return send(to, "Welcome to Gap Map", html, text);
}

/** Beta invite — sent when the operator invites someone off the waitlist. */
export async function sendBetaInviteEmail(to: string, code: string, name?: string): Promise<SendResult> {
  const hi = name && name.trim() ? `${name.trim()}, ` : "";
  const signUp = `https://gapmap.myind.ai/sign-in`;
  const html = `<!DOCTYPE html><html>${HEAD}
<body style="margin:0;padding:0;background:#F6F3EE;-webkit-font-smoothing:antialiased">
<span style="display:none;max-height:0;overflow:hidden;opacity:0">You're off the waitlist — your Gap Map beta invite is inside</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6F3EE"><tr><td align="center" class="gm-pad" style="padding:34px 16px">
 <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%">
  <tr><td style="padding:2px 6px 20px"><table role="presentation" cellpadding="0" cellspacing="0"><tr>
   <td style="vertical-align:middle"><div style="width:32px;height:32px;border-radius:9px;background:#FF8C42;text-align:center;font-family:Arial,sans-serif;font-weight:800;font-size:17px;line-height:32px;color:#fff">G</div></td>
   <td style="vertical-align:middle;padding-left:11px;font-family:Georgia,serif;font-weight:700;font-size:18px;color:#1A1614">Gap&nbsp;Map</td></tr></table></td></tr>
  <tr><td class="gm-card" style="background:#fff;border:1px solid #ECE6DC;border-radius:18px;padding:32px 30px;box-shadow:0 8px 28px rgba(26,22,20,0.05)"><div style="font-family:Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#FF8C42;margin:0 0 8px">You&rsquo;re off the waitlist</div><h1 class="gm-h1" style="font-family:Georgia,serif;font-size:23px;line-height:1.22;color:#1A1614;margin:0 0 10px;font-weight:600">${hi}you&rsquo;re <span style="font-family:Georgia,serif;font-style:italic;color:#FF8C42">invited</span> to the beta</h1><p style="font-family:Arial,sans-serif;font-size:14.5px;line-height:1.65;color:#4A4339;margin:0 0 12px">We saved you a founding-member spot. Use this single-use invite code when you create your account &mdash; it unlocks Pro, free, for the beta.</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0"><tr><td align="center" style="background:#FFF4EA;border:1px solid #FFE0C2;border-radius:14px;padding:18px"><div style="font-family:ui-monospace,Menlo,monospace;font-size:24px;font-weight:800;letter-spacing:4px;color:#9a4a12">${code}</div></td></tr></table><table role="presentation" width=100% cellpadding="0" cellspacing="0" style="margin:12px 0 4px"><tr><td style="border-radius:11px;background:#FF8C42;width:100%;text-align:center;"><a href="${signUp}" class="gm-btn" style="display:inline-block;padding:13px 30px;font-family:Arial,sans-serif;font-size:15px;font-weight:700;color:#fff;text-decoration:none;border-radius:11px">Claim my founding spot &rarr;</a></td></tr></table><p style="font-family:Arial,sans-serif;font-size:12.5px;line-height:1.55;color:#8A8278;margin:10px 0 0">This invite is tied to <b>${to}</b> and works once. Seats are limited &mdash; claim it before it&rsquo;s gone.</p></td></tr>
  <tr><td style="padding:16px 12px 0;font-family:Arial,sans-serif;font-size:12px;line-height:1.7;color:#8A8278;text-align:center">Gap&nbsp;Map · research intelligence for product teams<br><span style="color:#b8b0a6">Local-first · BYOK · your data stays on your machine</span></td></tr>
 </table></td></tr></table></body></html>`;
  const text = `${hi}you're invited to the Gap Map beta.

Your single-use invite code: ${code}

Create your account and enter the code: ${signUp}
Tied to ${to}. Seats are limited.`;
  return send(to, "You're in — your Gap Map beta invite 🎉", html, text);
}
