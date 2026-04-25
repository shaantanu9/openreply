import { NextResponse } from "next/server";
import { verifySupabaseBearer } from "@/lib/supabaseAuthServer";
import { supabaseCreateTrialForEmail } from "@/lib/supabaseActivationStore";
import { hasSupabaseConfig } from "@/lib/supabaseClient";

export const runtime = "nodejs";

function bearer(req: Request): string | null {
  const h = req.headers.get("authorization") || "";
  if (!h.toLowerCase().startsWith("bearer ")) return null;
  return h.slice(7).trim() || null;
}

/**
 * Start a Pro trial for the authenticated user.
 * Trial duration: TRIAL_DAYS env var (default 14).
 * Refuses if the caller already owns an active licence.
 */
export async function POST(req: Request) {
  if (!hasSupabaseConfig()) {
    return NextResponse.json(
      { ok: false, error: "trial requires Supabase" },
      { status: 503 },
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
  if (!user.email) return NextResponse.json({ ok: false, error: "session has no email" }, { status: 401 });

  const trialDays = Math.max(1, Math.floor(Number(process.env.TRIAL_DAYS || 14)));
  // `app_user_id` FKs into public.app_users (registration-side table), not
  // auth.users. Leaving it null keeps trial creation decoupled from that flow.
  const result = await supabaseCreateTrialForEmail({
    email: user.email,
    trialDays,
  });
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }
  return NextResponse.json({
    ok: true,
    license_id: result.licenseId,
    activation_key: result.activationKey,
    trial_ends_at: result.trialEndsAt,
    trial_days: trialDays,
  });
}
