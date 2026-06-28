// Admin-side coupon + waitlist management (service-role; called only from
// owner-authed /api/v1/admin/* routes). Reuses the coupons / coupon_redemptions
// tables (migration 202605250008) and the waitlist table (20260603_03).
import crypto from "node:crypto";
import { getSupabaseServerClient } from "@/lib/supabaseClient";

export type CouponPlan = "free" | "pro" | "live_pass" | "pro_trial";

export type AdminCoupon = {
  code: string;
  planId: string;
  maxRedemptions: number | null;
  currentRedemptions: number;
  seatsLeft: number | null;
  expiresAt: string | null;
  licenseMaxDevices: number;
  licenseDurationDays: number | null;
  disabled: boolean;
  note: string | null;
  createdAt: string | null;
};

function rowToCoupon(r: Record<string, unknown>): AdminCoupon {
  const max = r.max_redemptions == null ? null : Number(r.max_redemptions);
  const cur = Number(r.current_redemptions || 0);
  return {
    code: String(r.code),
    planId: String(r.plan_id || "pro"),
    maxRedemptions: max,
    currentRedemptions: cur,
    seatsLeft: max == null ? null : Math.max(0, max - cur),
    expiresAt: (r.expires_at as string) ?? null,
    licenseMaxDevices: Number(r.license_max_devices || 1),
    licenseDurationDays: r.license_duration_days == null ? null : Number(r.license_duration_days),
    disabled: Boolean(r.disabled),
    note: (r.note as string) ?? null,
    createdAt: (r.created_at as string) ?? null,
  };
}

export async function listCoupons(): Promise<AdminCoupon[]> {
  const supabase = getSupabaseServerClient();
  const { data } = await supabase
    .from("coupons")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(500);
  return ((data as Array<Record<string, unknown>>) || []).map(rowToCoupon);
}

/** Generate an unguessable, human-readable invite code: OPENREPLY-XXXX-XXXX. */
export function generateCouponCode(prefix = "OPENREPLY"): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1 ambiguity
  const block = () =>
    Array.from({ length: 4 }, () => alphabet[crypto.randomInt(alphabet.length)]).join("");
  return `${prefix}-${block()}-${block()}`;
}

export async function createCoupon(input: {
  code?: string;
  planId?: CouponPlan;
  maxRedemptions?: number | null;
  expiresInDays?: number | null;
  licenseMaxDevices?: number;
  licenseDurationDays?: number | null;
  note?: string | null;
  createdBy?: string | null;
}): Promise<{ ok: boolean; coupon?: AdminCoupon; reason?: string }> {
  const supabase = getSupabaseServerClient();
  const code = (input.code?.trim().toUpperCase() || generateCouponCode());
  const expiresAt = input.expiresInDays
    ? new Date(Date.now() + input.expiresInDays * 86_400_000).toISOString()
    : null;
  const { data, error } = await supabase
    .from("coupons")
    .insert({
      code,
      plan_id: input.planId || "pro",
      max_redemptions: input.maxRedemptions ?? null,
      expires_at: expiresAt,
      license_max_devices: Math.max(1, input.licenseMaxDevices || 2),
      license_duration_days: input.licenseDurationDays ?? null,
      note: input.note ?? null,
      created_by: input.createdBy ?? "admin",
    })
    .select("*")
    .single<Record<string, unknown>>();
  if (error || !data) {
    const dup = (error?.message || "").includes("duplicate") || error?.code === "23505";
    return { ok: false, reason: dup ? "code_exists" : error?.message || "create_failed" };
  }
  return { ok: true, coupon: rowToCoupon(data) };
}

export async function setCouponDisabled(code: string, disabled: boolean): Promise<boolean> {
  const supabase = getSupabaseServerClient();
  const { error } = await supabase
    .from("coupons")
    .update({ disabled })
    .eq("code", code.trim().toUpperCase());
  return !error;
}

export type CouponRedemption = {
  couponCode: string;
  email: string;
  redeemedAt: string | null;
};

export async function listRedemptions(code?: string): Promise<CouponRedemption[]> {
  const supabase = getSupabaseServerClient();
  let q = supabase
    .from("coupon_redemptions")
    .select("coupon_code, redeemed_by_email, redeemed_at")
    .order("redeemed_at", { ascending: false })
    .limit(500);
  if (code) q = q.eq("coupon_code", code.trim().toUpperCase());
  const { data } = await q;
  return ((data as Array<Record<string, unknown>>) || []).map((r) => ({
    couponCode: String(r.coupon_code),
    email: String(r.redeemed_by_email || ""),
    redeemedAt: (r.redeemed_at as string) ?? null,
  }));
}

// ── Waitlist ────────────────────────────────────────────────────────────────

export type WaitlistEntry = {
  email: string;
  name: string | null;
  role: string | null;
  reason: string | null;
  status: string;
  inviteCode: string | null;
  createdAt: string | null;
  invitedAt: string | null;
  inviteSends: number;
};

function rowToWaitlist(r: Record<string, unknown>): WaitlistEntry {
  return {
    email: String(r.email || ""),
    name: (r.name as string) ?? null,
    role: (r.role as string) ?? null,
    reason: (r.reason as string) ?? null,
    status: String(r.status || "pending"),
    inviteCode: (r.invite_code as string) ?? null,
    createdAt: (r.created_at as string) ?? null,
    invitedAt: (r.invited_at as string) ?? null,
    inviteSends: Number(r.invite_sends || 0),
  };
}

/** Atomically bump the per-recipient invite-email counter; returns new count. */
export async function bumpWaitlistSend(email: string): Promise<number> {
  const supabase = getSupabaseServerClient();
  const { data } = await supabase.rpc("increment_waitlist_send", { p_email: email.trim().toLowerCase() });
  return Number(data || 0);
}

/** Public join (server-side). Idempotent upsert by email; never overwrites an
 *  already-invited/converted row's status. */
export async function addToWaitlist(input: {
  email: string;
  name?: string;
  role?: string;
  reason?: string;
}): Promise<{ ok: boolean; already?: boolean; reason?: string }> {
  const supabase = getSupabaseServerClient();
  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, reason: "invalid_email" };

  const { data: existing } = await supabase
    .from("waitlist").select("email,status").eq("email", email).maybeSingle<{ email: string; status: string }>();
  if (existing) return { ok: true, already: true };

  const { error } = await supabase.from("waitlist").insert({
    email,
    name: input.name?.trim() || null,
    role: input.role?.trim() || null,
    reason: input.reason?.trim() || null,
  });
  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}

export async function listWaitlist(status?: string): Promise<WaitlistEntry[]> {
  const supabase = getSupabaseServerClient();
  let q = supabase.from("waitlist").select("*").order("created_at", { ascending: false }).limit(500);
  if (status) q = q.eq("status", status);
  const { data } = await q;
  return ((data as Array<Record<string, unknown>>) || []).map(rowToWaitlist);
}

export async function setWaitlistStatus(email: string, status: string): Promise<boolean> {
  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("waitlist").update({ status }).eq("email", email.trim().toLowerCase());
  return !error;
}

export async function getWaitlistEntry(email: string): Promise<WaitlistEntry | null> {
  const supabase = getSupabaseServerClient();
  const { data } = await supabase
    .from("waitlist").select("*").eq("email", email.trim().toLowerCase())
    .maybeSingle<Record<string, unknown>>();
  return data ? rowToWaitlist(data) : null;
}

/** Founding seats already taken (auto-invited or converted) — for the seat cap. */
export async function countActiveInvites(): Promise<number> {
  const supabase = getSupabaseServerClient();
  const { count } = await supabase
    .from("waitlist").select("*", { count: "exact", head: true })
    .in("status", ["invited", "converted"]);
  return count || 0;
}

/** Invite a waitlister: generate a single-use coupon, mark the row invited,
 *  and return the code (the route emails it). */
export async function inviteFromWaitlist(
  email: string,
  opts: { planId?: CouponPlan; licenseMaxDevices?: number } = {},
): Promise<{ ok: boolean; code?: string; reason?: string }> {
  const e = email.trim().toLowerCase();
  const made = await createCoupon({
    planId: opts.planId || "pro",
    maxRedemptions: 1,
    licenseMaxDevices: opts.licenseMaxDevices ?? 2,
    note: `Waitlist invite for ${e}`,
  });
  if (!made.ok || !made.coupon) return { ok: false, reason: made.reason || "coupon_failed" };

  const supabase = getSupabaseServerClient();
  const { error } = await supabase
    .from("waitlist")
    .update({ status: "invited", invite_code: made.coupon.code, invited_at: new Date().toISOString() })
    .eq("email", e);
  if (error) return { ok: false, reason: error.message };
  return { ok: true, code: made.coupon.code };
}
