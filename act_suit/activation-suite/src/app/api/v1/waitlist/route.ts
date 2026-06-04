// POST /api/v1/waitlist — public. Code-less visitors request beta access.
// Body: { email, name?, role?, reason? }  →  { ok, already? }
import { NextResponse } from "next/server";
import { hasSupabaseConfig } from "@/lib/supabaseClient";
import { addToWaitlist } from "@/lib/betaAdminStore";
import { checkRateLimit, clientIp } from "@/lib/rateLimit";

export const runtime = "nodejs";

type Body = { email?: string; name?: string; role?: string; reason?: string };

export async function POST(req: Request) {
  if (!hasSupabaseConfig()) {
    return NextResponse.json({ ok: false, error: "supabase_required" }, { status: 503 });
  }
  const rl = checkRateLimit(`waitlist:${clientIp(req)}`, 8, 600_000);
  if (!rl.ok) return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  let body: Body = {};
  try {
    const raw = await req.text();
    body = raw ? (JSON.parse(raw) as Body) : {};
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }
  const email = (body.email || "").trim();
  if (!email) return NextResponse.json({ ok: false, error: "email_required" }, { status: 400 });

  const r = await addToWaitlist({ email, name: body.name, role: body.role, reason: body.reason });
  if (!r.ok) {
    return NextResponse.json({ ok: false, error: r.reason || "failed" }, { status: r.reason === "invalid_email" ? 400 : 500 });
  }
  return NextResponse.json({ ok: true, already: !!r.already });
}
