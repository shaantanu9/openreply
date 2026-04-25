import { NextResponse } from "next/server";
import { verifySupabaseBearer } from "@/lib/supabaseAuthServer";
import { hasSupabaseConfig } from "@/lib/supabaseClient";
import { ensureProfile } from "@/lib/community/workspaces";
import type { Profile } from "@/lib/community/types";

export type AuthResult =
  | { ok: true; userId: string; email: string; profile: Profile }
  | { ok: false; response: NextResponse };

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
    return { ok: true, userId: user.id, email: user.email, profile };
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
