// Admin coupon management (owner-only).
//   GET  → { ok, coupons, redemptions }       (recent redemptions across all)
//   POST → { action: "create" | "disable" | "enable", ... }
import { NextResponse } from "next/server";
import { adminConfigured, isAdminAuthed } from "@/lib/adminAuth";
import { hasSupabaseConfig } from "@/lib/supabaseClient";
import {
  listCoupons,
  listRedemptions,
  createCoupon,
  setCouponDisabled,
  type CouponPlan,
} from "@/lib/betaAdminStore";

export const runtime = "nodejs";

function guard(req: Request): NextResponse | null {
  if (!adminConfigured()) return NextResponse.json({ ok: false, error: "admin_disabled" }, { status: 503 });
  if (!isAdminAuthed(req)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  if (!hasSupabaseConfig()) return NextResponse.json({ ok: false, error: "supabase_only" }, { status: 400 });
  return null;
}

export async function GET(req: Request) {
  const bad = guard(req);
  if (bad) return bad;
  try {
    const [coupons, redemptions] = await Promise.all([listCoupons(), listRedemptions()]);
    return NextResponse.json({ ok: true, coupons, redemptions });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "list failed" }, { status: 500 });
  }
}

type CreateBody = {
  action?: "create" | "disable" | "enable";
  code?: string;
  plan_id?: CouponPlan;
  max_redemptions?: number | null;
  expires_in_days?: number | null;
  license_max_devices?: number;
  license_duration_days?: number | null;
  note?: string | null;
};

export async function POST(req: Request) {
  const bad = guard(req);
  if (bad) return bad;

  let body: CreateBody = {};
  try {
    const raw = await req.text();
    body = raw ? (JSON.parse(raw) as CreateBody) : {};
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }

  const action = body.action || "create";

  if (action === "disable" || action === "enable") {
    const code = (body.code || "").trim();
    if (!code) return NextResponse.json({ ok: false, error: "code_required" }, { status: 400 });
    const ok = await setCouponDisabled(code, action === "disable");
    return NextResponse.json({ ok, action, code });
  }

  if (action === "create") {
    const r = await createCoupon({
      code: body.code?.trim() || undefined,
      planId: body.plan_id,
      maxRedemptions: body.max_redemptions ?? null,
      expiresInDays: body.expires_in_days ?? null,
      licenseMaxDevices: body.license_max_devices,
      licenseDurationDays: body.license_duration_days ?? null,
      note: body.note ?? null,
    });
    if (!r.ok) {
      const status = r.reason === "code_exists" ? 409 : 500;
      return NextResponse.json({ ok: false, error: r.reason }, { status });
    }
    return NextResponse.json({ ok: true, coupon: r.coupon });
  }

  return NextResponse.json({ ok: false, error: "bad_action" }, { status: 400 });
}
