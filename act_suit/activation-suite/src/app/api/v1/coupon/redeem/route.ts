// POST /api/v1/coupon/redeem
//
// Redeem a coupon code for a free activation key. Auth is required —
// caller passes a Supabase access-token via Authorization: Bearer <jwt>.
// Email is read from the verified token (never trusted from the body).
//
// Request body:  { "coupon_code": "OPENREPLY-LAUNCH-XXXX" }
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
import { sendLicenseKeyEmail, sendWelcomeEmail } from "@/lib/email";

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

  // A successful redeem just minted a brand-new key for this user — email it
  // to them (the full key is only ever shown once in the UI). This is the beta
  // founding-member path: the dashboard auto-redeems the signup invite code,
  // so this is where "your key" + "welcome" emails are sent. Mirrors the
  // /api/v1/licence/free behaviour. Email failures never block the response.
  const email = authUser.email;
  // Name comes from the signup metadata (full_name / first_name) for a
  // personalised greeting; falls back to no greeting when absent.
  const meta = (authUser.user_metadata || {}) as Record<string, unknown>;
  const name = String(meta.full_name || meta.first_name || meta.name || "").trim();
  const mail = await sendLicenseKeyEmail(email, result.activationKey, {
    planId: result.planId,
    isTrial: result.isTrial,
    expiresAt: result.expiresAt,
    name,
  }).catch((e) => {
    console.error("[coupon/redeem] key email failed for", email, e);
    return { ok: false };
  });
  // First key issuance → also send a welcome email (fire-and-forget).
  void sendWelcomeEmail(email, name).catch((e) =>
    console.error("[coupon/redeem] welcome email failed for", email, e),
  );

  return NextResponse.json({
    ok: true,
    activation_key: result.activationKey,
    license_id: result.licenseId,
    plan_id: result.planId,
    expires_at: result.expiresAt,
    is_trial: result.isTrial,
    emailed: !!mail?.ok,
    message:
      (result.isTrial
        ? `Trial activated. Your key expires ${result.expiresAt}.`
        : `Coupon redeemed. Use this key in OpenReply to activate.`) +
      (mail?.ok ? " We also emailed it to you." : ""),
  });
}
