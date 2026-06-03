import { NextResponse } from "next/server";
import { hasSupabaseConfig } from "@/lib/supabaseClient";
import {
  supabaseMarkLicenceFromWebhook,
  supabaseAdminPatchLicenceByEmail,
  supabaseClearDevicesByEmail,
} from "@/lib/supabaseActivationStore";
import { setLicenseStatusBySelector } from "@/lib/activationStore";
import { adminConfigured, isAdminAuthed } from "@/lib/adminAuth";

export const runtime = "nodejs";

type AdminAction =
  | "revoke"
  | "reactivate"
  | "expire"
  | "extend_trial"
  | "extend_expiry"
  | "reset_devices"
  | "set_max_devices";

type AdminBody = {
  action?: AdminAction;
  email?: string;
  license_id?: string;
  activation_key?: string;
  days?: number;
  max_devices?: number;
};

const STATUS_FOR: Record<string, "active" | "revoked" | "expired"> = {
  revoke: "revoked",
  reactivate: "active",
  expire: "expired",
};

/**
 * Owner-only licence management. Auth: admin session cookie (set via
 * /api/v1/admin/auth) OR header `x-admin-secret` == env ADMIN_SECRET.
 *
 * Actions (POST body):
 *   - revoke | reactivate | expire           → set licence status
 *   - extend_trial   { email, days }         → trial_ends_at += days (renews from today if expired)
 *   - extend_expiry  { email, days }         → expires_at  += days
 *   - set_max_devices{ email, max_devices }  → change the device-seat limit
 *   - reset_devices  { email }               → clear all activated devices (frees seats)
 *
 * After a revoke/expire, the desktop app locks on its next periodic validate.
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

  const action = (body.action || "revoke") as AdminAction;
  const email = (body.email || "").trim().toLowerCase();
  if (!email && !body.license_id && !body.activation_key) {
    return NextResponse.json(
      { ok: false, error: "no_selector", message: "Provide email, license_id, or activation_key." },
      { status: 400 },
    );
  }

  try {
    if (hasSupabaseConfig()) {
      if (!email) {
        return NextResponse.json(
          { ok: false, error: "email_required", message: "On the hosted store, act by email." },
          { status: 400 },
        );
      }

      // Status changes.
      if (action in STATUS_FOR) {
        const status = STATUS_FOR[action];
        const ok = await supabaseMarkLicenceFromWebhook({ email, status });
        return NextResponse.json({ ok, action, status, email });
      }

      if (action === "extend_trial" || action === "extend_expiry") {
        const days = Math.trunc(Number(body.days || 0));
        if (!days) {
          return NextResponse.json(
            { ok: false, error: "days_required", message: "Provide a non-zero `days` value." },
            { status: 400 },
          );
        }
        const r = await supabaseAdminPatchLicenceByEmail({
          email,
          addTrialDays: action === "extend_trial" ? days : undefined,
          addExpiryDays: action === "extend_expiry" ? days : undefined,
        });
        return NextResponse.json({
          ok: r.ok,
          action,
          email,
          days,
          trial_ends_at: r.trialEndsAt,
          expires_at: r.expiresAt,
          error: r.reason,
        });
      }

      if (action === "set_max_devices") {
        const md = Math.trunc(Number(body.max_devices || 0));
        if (!md) {
          return NextResponse.json(
            { ok: false, error: "max_devices_required", message: "Provide max_devices >= 1." },
            { status: 400 },
          );
        }
        const r = await supabaseAdminPatchLicenceByEmail({ email, maxDevices: md });
        return NextResponse.json({ ok: r.ok, action, email, max_devices: md, error: r.reason });
      }

      if (action === "reset_devices") {
        const r = await supabaseClearDevicesByEmail(email);
        return NextResponse.json({ ok: r.ok, action, email, removed: r.removed, error: r.reason });
      }

      return NextResponse.json(
        { ok: false, error: "bad_action", message: `unknown action '${action}'` },
        { status: 400 },
      );
    }

    // File-store (dev/local) — status changes only.
    const status = STATUS_FOR[action];
    if (!status) {
      return NextResponse.json(
        { ok: false, error: "not_supported", message: `'${action}' is only supported on the hosted (Supabase) store.` },
        { status: 400 },
      );
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
