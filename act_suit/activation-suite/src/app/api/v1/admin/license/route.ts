import { NextResponse } from "next/server";
import { hasSupabaseConfig } from "@/lib/supabaseClient";
import { supabaseMarkLicenceFromWebhook } from "@/lib/supabaseActivationStore";
import { setLicenseStatusBySelector } from "@/lib/activationStore";
import { adminConfigured, isAdminAuthed } from "@/lib/adminAuth";

export const runtime = "nodejs";

type AdminBody = {
  action?: "revoke" | "reactivate" | "expire";
  email?: string;
  license_id?: string;
  activation_key?: string;
};

const STATUS_FOR: Record<string, "active" | "revoked" | "expired"> = {
  revoke: "revoked",
  reactivate: "active",
  expire: "expired",
};

/**
 * Owner-only control to disable / re-enable / expire a license.
 * Auth: header `x-admin-secret` must equal env ADMIN_SECRET (must be set).
 *
 *   curl -X POST $BASE/api/v1/admin/license \
 *     -H "x-admin-secret: $ADMIN_SECRET" -H "content-type: application/json" \
 *     -d '{"action":"revoke","email":"user@x.com"}'
 *
 * After a revoke/expire, the desktop app stops working: device activation is
 * refused, and the next periodic validate returns {revoked:true} so an
 * already-activated app locks.
 */
export async function POST(req: Request) {
  if (!adminConfigured()) {
    return NextResponse.json(
      { ok: false, error: "admin_disabled", message: "Set ADMIN_SECRET in the server env to use this." },
      { status: 503 },
    );
  }
  if (!isAdminAuthed(req)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  let body: AdminBody = {};
  try {
    const raw = await req.text();
    body = raw ? (JSON.parse(raw) as AdminBody) : {};
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }

  const action = body.action || "revoke";
  const status = STATUS_FOR[action];
  if (!status) {
    return NextResponse.json(
      { ok: false, error: "bad_action", message: "action must be revoke | reactivate | expire" },
      { status: 400 },
    );
  }
  const email = (body.email || "").trim().toLowerCase();
  if (!email && !body.license_id && !body.activation_key) {
    return NextResponse.json(
      { ok: false, error: "no_selector", message: "Provide email, license_id, or activation_key." },
      { status: 400 },
    );
  }

  try {
    if (hasSupabaseConfig()) {
      // Hosted store keys are hashed, so the selector is the user's email.
      if (!email) {
        return NextResponse.json(
          { ok: false, error: "email_required", message: "On the hosted store, disable by email." },
          { status: 400 },
        );
      }
      const ok = await supabaseMarkLicenceFromWebhook({ email, status });
      return NextResponse.json({ ok, action, status, email });
    }
    const res = await setLicenseStatusBySelector(
      { email: email || undefined, licenseId: body.license_id, activationKey: body.activation_key },
      status,
      { setExpiryNow: action === "expire" },
    );
    return NextResponse.json({ ok: res.ok, matched: res.matched, action, status });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "admin action failed" },
      { status: 500 },
    );
  }
}
