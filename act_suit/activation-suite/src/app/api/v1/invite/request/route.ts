// POST /api/v1/invite/request — public homepage invite capture.
//
// Hybrid auto-invite: while founding seats remain, instantly generate a
// single-use code and email it (the "invitation with license key" — the code
// becomes their licence key on signup). Once the cap is hit, the email is kept
// on the waitlist for admin approval.
//
// Seat cap: env BETA_AUTO_INVITE_SEATS (default 100). Set to 0 to disable
// auto-send entirely (every request just joins the waitlist).
//
// Body: { email, name?, reason? }
// 200:  { ok, sent, waitlisted, resent?, seats_left }
import { NextResponse } from "next/server";
import { hasSupabaseConfig } from "@/lib/supabaseClient";
import {
  addToWaitlist,
  getWaitlistEntry,
  countActiveInvites,
  inviteFromWaitlist,
  bumpWaitlistSend,
} from "@/lib/betaAdminStore";
import { sendBetaInviteEmail } from "@/lib/email";
import { checkRateLimit, clientIp } from "@/lib/rateLimit";

export const runtime = "nodejs";

type Body = { email?: string; name?: string; reason?: string };

// Hard cap: never email one address more than this many invites (anti-spam).
const MAX_SENDS_PER_EMAIL = 2;

function seatCap(): number {
  const n = parseInt((process.env.BETA_AUTO_INVITE_SEATS || "100").trim(), 10);
  return Number.isFinite(n) && n >= 0 ? n : 100;
}

export async function POST(req: Request) {
  if (!hasSupabaseConfig()) {
    return NextResponse.json({ ok: false, error: "supabase_required" }, { status: 503 });
  }

  // Throttle: cap requests per IP so the endpoint can't be blasted to enumerate
  // addresses / drain our email quota. 8 requests / 10 min / IP.
  const rl = checkRateLimit(`invite:${clientIp(req)}`, 8, 600_000);
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, error: "rate_limited", retry_after: rl.retryAfter },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  let body: Body = {};
  try {
    const raw = await req.text();
    body = raw ? (JSON.parse(raw) as Body) : {};
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }
  const email = (body.email || "").trim().toLowerCase();
  const name = body.name?.trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ ok: false, error: "invalid_email" }, { status: 400 });
  }

  try {
    // Always record the request (idempotent).
    await addToWaitlist({ email, name, reason: body.reason });

    const cap = seatCap();
    const existing = await getWaitlistEntry(email);
    const sends = existing?.inviteSends ?? 0;

    // Per-recipient anti-spam cap — never email one address more than twice.
    if (sends >= MAX_SENDS_PER_EMAIL) {
      return NextResponse.json({ ok: true, sent: false, alreadyRequested: true, waitlisted: false });
    }

    // Already invited/converted → re-send the existing code (no new seat used).
    if (existing && (existing.status === "invited" || existing.status === "converted") && existing.inviteCode) {
      const mail = await sendBetaInviteEmail(email, existing.inviteCode, name);
      await bumpWaitlistSend(email);
      return NextResponse.json({ ok: true, sent: true, resent: true, emailed: mail.ok, waitlisted: false });
    }

    const used = await countActiveInvites();
    if (cap === 0 || used >= cap) {
      // Cap reached (or auto-send off) → stay on the waitlist for admin approval.
      return NextResponse.json({ ok: true, sent: false, waitlisted: true, seats_left: 0 });
    }

    // Seat available → generate a single-use code, mark invited, email it.
    const r = await inviteFromWaitlist(email);
    if (!r.ok || !r.code) {
      return NextResponse.json({ ok: false, error: r.reason || "invite_failed" }, { status: 500 });
    }
    const mail = await sendBetaInviteEmail(email, r.code, name);
    await bumpWaitlistSend(email);
    return NextResponse.json({
      ok: true, sent: true, waitlisted: false, emailed: mail.ok,
      seats_left: Math.max(0, cap - used - 1),
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "request_failed" },
      { status: 500 },
    );
  }
}
