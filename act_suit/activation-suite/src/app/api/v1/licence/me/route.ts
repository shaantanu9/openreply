import { NextResponse } from "next/server";
import { verifySupabaseBearer } from "@/lib/supabaseAuthServer";
import { supabaseLicenceForEmail } from "@/lib/supabaseActivationStore";
import { hasSupabaseConfig } from "@/lib/supabaseClient";
import { featuresFor } from "@/lib/features";

export const runtime = "nodejs";

function bearer(req: Request): string | null {
  const h = req.headers.get("authorization") || "";
  if (!h.toLowerCase().startsWith("bearer ")) return null;
  return h.slice(7).trim() || null;
}

export async function GET(req: Request) {
  if (!hasSupabaseConfig()) {
    return NextResponse.json(
      { ok: false, error: "licence API requires Supabase config" },
      { status: 503 },
    );
  }
  const token = bearer(req);
  if (!token) {
    return NextResponse.json({ ok: false, error: "missing bearer token" }, { status: 401 });
  }
  let user;
  try {
    user = await verifySupabaseBearer(token);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "invalid session" },
      { status: 401 },
    );
  }
  if (!user.email) {
    return NextResponse.json(
      { ok: false, error: "session has no email" },
      { status: 401 },
    );
  }

  const licence = await supabaseLicenceForEmail(user.email);
  if (!licence) {
    return NextResponse.json({
      ok: true,
      licence: null,
      features: featuresFor({
        plan_id: "free",
        live_pass_active: false,
        is_trial: false,
        trial_ends_at: null,
      }),
    });
  }

  const trialEndsSec = licence.trialEndsAt
    ? Math.floor(new Date(licence.trialEndsAt).getTime() / 1000)
    : null;
  const features = featuresFor({
    plan_id: licence.planId,
    live_pass_active: licence.livePassActive,
    is_trial: licence.isTrial,
    trial_ends_at: trialEndsSec,
  });

  return NextResponse.json({
    ok: true,
    licence: {
      license_id: licence.licenseId,
      user_id: licence.userId,
      email: licence.email,
      status: licence.status,
      plan_id: licence.planId,
      live_pass_active: licence.livePassActive,
      is_trial: licence.isTrial,
      trial_ends_at: licence.trialEndsAt,
      expires_at: licence.expiresAt,
      max_devices: licence.maxDevices,
      created_at: licence.createdAt,
      // Full activation key — only returned because the caller authenticated
      // as the licence's owner via Supabase Bearer. Used by the dashboard to
      // show a Copy-friendly key card so users can paste into Gap Map.app.
      activation_key: licence.activationKey,
      activation_key_preview: licence.activationKeyPreview,
      devices: licence.devices,
    },
    features,
  });
}
