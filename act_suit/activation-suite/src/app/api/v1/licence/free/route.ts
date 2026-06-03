import { NextResponse } from "next/server";
import { verifySupabaseBearer } from "@/lib/supabaseAuthServer";
import { hasSupabaseConfig } from "@/lib/supabaseClient";
import { billingEnabled, FREE_PLAN_ID, FREE_MAX_DEVICES } from "@/lib/billing";
import { createLicenseRecord } from "@/lib/licenseService";
import { supabaseLicenceForEmail } from "@/lib/supabaseActivationStore";
import { findLicenseByEmail } from "@/lib/activationStore";
import { sendLicenseKeyEmail } from "@/lib/email";

export const runtime = "nodejs";

function bearer(req: Request): string | null {
  const h = req.headers.get("authorization") || "";
  if (!h.toLowerCase().startsWith("bearer ")) return null;
  return h.slice(7).trim() || null;
}

/**
 * Free license issuance for the logged-in user (no payment).
 * Idempotent: returns the user's existing key if they already have one,
 * otherwise mints a fresh free license. Disabled once BILLING_ENABLED=1
 * (then users buy a key via checkout instead).
 */
export async function POST(req: Request) {
  if (billingEnabled()) {
    return NextResponse.json(
      { ok: false, error: "billing_enabled", message: "Free keys are off — purchase a plan." },
      { status: 403 },
    );
  }

  const token = bearer(req);
  if (!token) return NextResponse.json({ ok: false, error: "missing bearer token" }, { status: 401 });
  let user;
  try {
    user = await verifySupabaseBearer(token);
  } catch {
    return NextResponse.json({ ok: false, error: "invalid session" }, { status: 401 });
  }
  const email = (user.email || "").trim().toLowerCase();
  if (!email) return NextResponse.json({ ok: false, error: "session has no email" }, { status: 401 });

  try {
    if (hasSupabaseConfig()) {
      const existing = await supabaseLicenceForEmail(email);
      if (existing && existing.status !== "revoked") {
        // Supabase stores only a hash of the key, so the full key can't be
        // re-shown — surface the preview + a hint to regenerate if lost.
        return NextResponse.json({
          ok: true,
          already: true,
          license_id: existing.licenseId,
          activation_key: null,
          activation_key_preview: existing.activationKeyPreview,
          status: existing.status,
          max_devices: existing.maxDevices,
          message: "You already have a license. Your full key was shown once at sign-up.",
        });
      }
      const created = await createLicenseRecord({
        email,
        password: "",
        planId: FREE_PLAN_ID,
        maxDevices: FREE_MAX_DEVICES,
      });
      const mail = await sendLicenseKeyEmail(email, created.activationKey).catch(() => ({ ok: false }));
      return NextResponse.json({
        ok: true,
        already: false,
        license_id: created.licenseId,
        activation_key: created.activationKey,
        status: "active",
        max_devices: created.maxDevices,
        emailed: !!mail?.ok,
        message: "Your license key — copy it now and paste it into the desktop app." + (mail?.ok ? " We also emailed it to you." : ""),
      });
    }

    // File-store (local/dev) — full key is always recoverable.
    const existing = await findLicenseByEmail(email);
    if (existing && existing.status !== "revoked") {
      return NextResponse.json({
        ok: true,
        already: true,
        license_id: existing.licenseId,
        activation_key: existing.activationKey,
        status: existing.status,
        max_devices: existing.maxDevices,
      });
    }
    const created = await createLicenseRecord({
      email,
      password: "",
      planId: FREE_PLAN_ID,
      maxDevices: FREE_MAX_DEVICES,
    });
    const mail = await sendLicenseKeyEmail(email, created.activationKey).catch(() => ({ ok: false }));
    return NextResponse.json({
      ok: true,
      already: false,
      license_id: created.licenseId,
      activation_key: created.activationKey,
      status: "active",
      max_devices: created.maxDevices,
      emailed: !!mail?.ok,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "free issuance failed" },
      { status: 500 },
    );
  }
}
