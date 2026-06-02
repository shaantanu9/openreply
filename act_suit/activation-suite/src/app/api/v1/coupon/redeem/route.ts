// POST /api/v1/coupon/redeem
//
// Redeem a coupon code for a free activation key. Auth is required —
// caller passes a Supabase access-token via Authorization: Bearer <jwt>.
// Email is read from the verified token (never trusted from the body).
//
// Request body:  { "coupon_code": "GAPMAP-LAUNCH-XXXX" }
// Success (200): { ok: true, activation_key, license_id, plan_id,
//                   expires_at, is_trial, message }
// Failure (4xx): { ok: false, error: <CouponRedeemError> }
//
// Maps to friendly UI copy in /redeem; see lib/couponService.ts for the
// taxonomy of error codes.

import { NextResponse } from "next/server";
import { verifySupabaseBearer } from "@/lib/supabaseAuthServer";
import { redeemCouponSupabase } from "@/lib/couponService";
import { hasSupabaseConfig } from "@/lib/supabaseClient";

export const runtime = "nodejs";

function bearer(req: Request): string | null {
  const h = req.headers.get("authorization") || "";
  if (!h.toLowerCase().startsWith("bearer ")) return null;
  return h.slice(7).trim() || null;
}

type RedeemRequest = { coupon_code?: string };

export async function POST(req: Request) {
  if (!hasSupabaseConfig()) {
    return NextResponse.json(
      { ok: false, error: "coupons require Supabase configuration" },
      { status: 503 },
    );
  }

  const token = bearer(req);
  if (!token) {
    return NextResponse.json(
      { ok: false, error: "missing bearer token" },
      { status: 401 },
    );
  }

  let authUser;
  try {
    authUser = await verifySupabaseBearer(token);
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid session" },
      { status: 401 },
    );
  }
  if (!authUser.email) {
    return NextResponse.json(
      { ok: false, error: "session has no email" },
      { status: 401 },
    );
  }

  let body: RedeemRequest;
  try {
    body = (await req.json()) as RedeemRequest;
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid json body" },
      { status: 400 },
    );
  }

  const couponCode = (body.coupon_code || "").trim();
  if (!couponCode) {
    return NextResponse.json(
      { ok: false, error: "coupon_code is required" },
      { status: 400 },
    );
  }

  const result = await redeemCouponSupabase({
    couponCode,
    email: authUser.email,
    userId: authUser.id,
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: result.status },
    );
  }

  return NextResponse.json({
    ok: true,
    activation_key: result.activationKey,
    license_id: result.licenseId,
    plan_id: result.planId,
    expires_at: result.expiresAt,
    is_trial: result.isTrial,
    message: result.isTrial
      ? `Trial activated. Your key expires ${result.expiresAt}.`
      : `Coupon redeemed. Use this key in Gap Map to activate.`,
  });
}
