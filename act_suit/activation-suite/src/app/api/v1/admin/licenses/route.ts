import { NextResponse } from "next/server";
import { adminConfigured, isAdminAuthed } from "@/lib/adminAuth";
import { hasSupabaseConfig } from "@/lib/supabaseClient";
import { supabaseListLicenses } from "@/lib/supabaseActivationStore";
import { listAllLicenses } from "@/lib/activationStore";
import { masterKeyEnabled } from "@/lib/masterKey";

export const runtime = "nodejs";

export async function GET(req: Request) {
  if (!adminConfigured()) {
    return NextResponse.json({ ok: false, error: "admin_disabled" }, { status: 503 });
  }
  if (!isAdminAuthed(req)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  try {
    const licenses = hasSupabaseConfig() ? await supabaseListLicenses() : await listAllLicenses();
    return NextResponse.json({
      ok: true,
      master_key_enabled: masterKeyEnabled(),
      licenses,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "list failed" },
      { status: 500 },
    );
  }
}
