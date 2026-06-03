import { NextResponse } from "next/server";
import { adminConfigured, isAdminAuthed } from "@/lib/adminAuth";
import { hasSupabaseConfig } from "@/lib/supabaseClient";
import { supabaseGetLicenceDetailByEmail } from "@/lib/supabaseActivationStore";

export const runtime = "nodejs";

// GET /api/v1/admin/user?email=... → full detail for one user's licence.
export async function GET(req: Request) {
  if (!adminConfigured()) {
    return NextResponse.json({ ok: false, error: "admin_disabled" }, { status: 503 });
  }
  if (!isAdminAuthed(req)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  const email = new URL(req.url).searchParams.get("email")?.trim().toLowerCase();
  if (!email) {
    return NextResponse.json({ ok: false, error: "email_required" }, { status: 400 });
  }
  if (!hasSupabaseConfig()) {
    return NextResponse.json({ ok: false, error: "supabase_only" }, { status: 400 });
  }
  try {
    const detail = await supabaseGetLicenceDetailByEmail(email);
    if (!detail) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    return NextResponse.json({ ok: true, ...detail });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "detail failed" },
      { status: 500 },
    );
  }
}
