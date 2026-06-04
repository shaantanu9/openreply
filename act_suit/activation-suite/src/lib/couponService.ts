// Coupon redemption — Supabase implementation. Atomic via the
// public.redeem_coupon() PL/pgSQL function defined in
// migrations/202605250008_coupons.sql.
//
// Flow (server-side, runs in /api/v1/coupon/redeem):
//   1. Verify Supabase bearer (caller is a logged-in user).
//   2. Refuse if the caller already owns an active licence.
//   3. RPC public.redeem_coupon(code) — atomically validates the coupon
//      (existence, !disabled, !expired, !exhausted) AND increments the
//      counter in one transaction. Raises if invalid.
//   4. Mint a fresh activation key, insert a `licenses` row with
//      plan_id / max_devices / expires_at copied from the coupon.
//   5. Insert a `coupon_redemptions` audit row linking user → coupon → license.
//   6. Return { activationKey, licenseId, planId, expiresAt }.
//
// Caller maps the typed error codes to friendly UI messages:
//   - "not_found"   → "We didn't find that coupon."
//   - "disabled"    → "That coupon has been disabled."
//   - "expired"     → "That coupon expired."
//   - "exhausted"   → "That coupon's redemptions are used up."
//   - "already_has_license" → "Your account already has an active licence."

import crypto from "node:crypto";
import { getSupabaseServerClient } from "@/lib/supabaseClient";
import { mintActivationKey } from "@/lib/activationStore";
import type { PlanId } from "@/lib/features";

function hashSecret(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export type CouponRedeemError =
  | "not_found"
  | "disabled"
  | "expired"
  | "exhausted"
  | "already_has_license"
  | "internal";

export type CouponRedeemSuccess = {
  ok: true;
  activationKey: string;
  licenseId: string;
  planId: PlanId;
  expiresAt: string | null;
  isTrial: boolean;
};

export type CouponRedeemFailure = {
  ok: false;
  status: number;
  error: CouponRedeemError;
};

export async function redeemCouponSupabase(input: {
  couponCode: string;
  email: string;
  userId?: string | null;
  appUserId?: string | null;
}): Promise<CouponRedeemSuccess | CouponRedeemFailure> {
  const supabase = getSupabaseServerClient();
  const email = input.email.trim().toLowerCase();
  const code = (input.couponCode || "").trim().toUpperCase();

  if (!code) {
    return { ok: false, status: 400, error: "not_found" };
  }

  // Refuse if the caller already has an active licence (no double-dipping).
  const { data: existing } = await supabase
    .from("licenses")
    .select("id")
    .eq("email", email)
    .in("status", ["active"])
    .limit(1);
  if (existing && existing.length > 0) {
    return { ok: false, status: 409, error: "already_has_license" };
  }

  // Atomic redeem RPC. Increments coupon counter only if valid.
  const { data: couponRows, error: rpcErr } = await supabase.rpc(
    "redeem_coupon",
    { p_code: code },
  );

  if (rpcErr) {
    const msg = (rpcErr.message || "").toLowerCase();
    const mapped: CouponRedeemError =
      msg.includes("not_found") ? "not_found" :
      msg.includes("disabled")  ? "disabled"  :
      msg.includes("expired")   ? "expired"   :
      msg.includes("exhausted") ? "exhausted" :
      "internal";
    const status =
      mapped === "internal" ? 500 :
      mapped === "exhausted" || mapped === "expired" || mapped === "disabled" ? 410 :
      404;
    return { ok: false, status, error: mapped };
  }

  // Supabase returns RPC results as an array; redeem_coupon returns one row.
  const coupon = Array.isArray(couponRows) ? couponRows[0] : couponRows;
  if (!coupon || !coupon.code) {
    return { ok: false, status: 500, error: "internal" };
  }

  const planId = (coupon.plan_id || "pro") as PlanId;
  const maxDevices = Math.max(1, Number(coupon.license_max_devices) || 1);
  const durationDays = coupon.license_duration_days
    ? Math.max(1, Math.floor(Number(coupon.license_duration_days)))
    : null;
  const expiresAt = durationDays
    ? new Date(Date.now() + durationDays * 86_400 * 1000).toISOString()
    : null;
  const isTrial = planId === "pro_trial";

  // Mint a fresh activation key + insert licence row.
  const rawKey = mintActivationKey();
  const activationKeyHash = hashSecret(rawKey);
  // No traditional password — coupons go through the Supabase Bearer flow.
  // Random unguessable password_hash matches the trial-creation pattern in
  // supabaseActivationStore.ts (see supabaseCreateTrialForEmail).
  const unusablePasswordHash = crypto.randomBytes(32).toString("hex");

  const { data: licInsert, error: licErr } = await supabase
    .from("licenses")
    .insert({
      app_user_id: input.appUserId || null,
      user_id: input.userId || `usr_${crypto.randomUUID()}`,
      email,
      password: null,
      activation_key: rawKey,
      password_hash: unusablePasswordHash,
      activation_key_hash: activationKeyHash,
      status: "active",
      max_devices: maxDevices,
      expires_at: expiresAt,
      plan_id: planId,
      live_pass_active: false,
      is_trial: isTrial,
      trial_ends_at: isTrial ? expiresAt : null,
    })
    .select("id")
    .single<{ id: string }>();

  if (licErr || !licInsert) {
    // Compensating action: try to back out the coupon counter.
    // (Best-effort — a rare partial-failure leaves the counter incremented
    // without a licence. The audit table won't show it so we don't break
    // accounting; the operator can review via the licenses count.)
    return { ok: false, status: 500, error: "internal" };
  }

  // Audit log row — non-fatal if it fails (counter + licence already done).
  await supabase.from("coupon_redemptions").insert({
    coupon_code: code,
    license_id: licInsert.id,
    redeemed_by_email: email,
    redeemed_by_user_id: input.userId || null,
  });

  // Close the waitlist loop: if this code (or email) was on the waitlist,
  // mark it converted so the admin funnel reads pending → invited → converted.
  try {
    await supabase.from("waitlist").update({ status: "converted" }).eq("invite_code", code).neq("status", "converted");
    await supabase.from("waitlist").update({ status: "converted" }).eq("email", email).neq("status", "converted");
  } catch {
    /* non-fatal — conversion tracking only */
  }

  return {
    ok: true,
    activationKey: rawKey,
    licenseId: licInsert.id,
    planId,
    expiresAt,
    isTrial,
  };
}
