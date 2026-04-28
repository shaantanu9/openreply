import { NextResponse } from "next/server";
import { verifySupabaseBearer } from "@/lib/supabaseAuthServer";
import { hasSupabaseConfig } from "@/lib/supabaseClient";
import { ensureProfile } from "@/lib/community/workspaces";
import type { Profile } from "@/lib/community/types";
import { supabaseLicenceForEmail } from "@/lib/supabaseActivationStore";
import type { PlanId } from "@/lib/features";

export type AuthResult =
  | {
      ok: true;
      userId: string;
      email: string;
      profile: Profile;
      planId: PlanId;
      isPaidPlan: boolean;
    }
  | { ok: false; response: NextResponse };

function isPaidPlan(planId: PlanId): boolean {
  return planId === "pro" || planId === "live_pass" || planId === "team";
}

export async function requireSession(req: Request): Promise<AuthResult> {
  if (!hasSupabaseConfig()) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: "Supabase config required" },
        { status: 503 },
      ),
    };
  }
  const h = req.headers.get("authorization") || "";
  if (!h.toLowerCase().startsWith("bearer ")) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: "missing bearer token" },
        { status: 401 },
      ),
    };
  }
  const token = h.slice(7).trim();
  try {
    const user = await verifySupabaseBearer(token);
    if (!user.email) {
      return {
        ok: false,
        response: NextResponse.json(
          { ok: false, error: "session has no email" },
          { status: 401 },
        ),
      };
    }
    const meta = (user.user_metadata || {}) as Record<string, unknown>;
    const fullName =
      (typeof meta.full_name === "string" && meta.full_name) ||
      (typeof meta.name === "string" && meta.name) ||
      null;
    const profile = await ensureProfile(user.id, user.email, fullName);
    const licence = await supabaseLicenceForEmail(user.email);
    const planId: PlanId = licence?.planId || "free";
    return {
      ok: true,
      userId: user.id,
      email: user.email,
      profile,
      planId,
      isPaidPlan: isPaidPlan(planId),
    };
  } catch (err) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: err instanceof Error ? err.message : "invalid session" },
        { status: 401 },
      ),
    };
  }
}
