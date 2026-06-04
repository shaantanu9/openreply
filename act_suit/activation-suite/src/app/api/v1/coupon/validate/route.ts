// POST /api/v1/coupon/validate — non-consuming invite-code check for the
// beta sign-up gate. Public (no auth): runs BEFORE the account exists.
//
// Body:    { "coupon_code": "GAPMAP-BETA-2026" }
// 200:     { ok: true, valid, reason, plan_id, seats_total, seats_left, seats_claimed }
//
// Does NOT increment the coupon — that happens later at key issuance
// (redeem_coupon via /api/v1/coupon/redeem). See couponService.ts.

import { NextResponse } from "next/server";
import { getSupabaseServerClient, hasSupabaseConfig } from "@/lib/supabaseClient";
import { checkRateLimit, clientIp } from "@/lib/rateLimit";

export const runtime = "nodejs";

type Body = { coupon_code?: string };

export async function POST(req: Request) {
  if (!hasSupabaseConfig()) {
    return NextResponse.json({ ok: false, error: "supabase_required" }, { status: 503 });
  }
  // Throttle — this is hit on keystroke (debounced) from the sign-up gate.
  const rl = checkRateLimit(`validate:${clientIp(req)}`, 40, 60_000);
  if (!rl.ok) return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  let body: Body = {};
  try {
    const raw = await req.text();
    body = raw ? (JSON.parse(raw) as Body) : {};
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }
  const code = (body.coupon_code || "").trim().toUpperCase();
  if (!code) {
    return NextResponse.json({ ok: true, valid: false, reason: "not_found" });
  }
  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase.rpc("validate_coupon", { p_code: code });
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
    const v = (data as Record<string, unknown>) ?? { valid: false, reason: "not_found" };
    return NextResponse.json({ ok: true, ...v });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "validate failed" },
      { status: 500 },
    );
  }
}
