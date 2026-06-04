import { NextResponse } from "next/server";
import { adminConfigured, isAdminAuthed } from "@/lib/adminAuth";
import { hasSupabaseConfig } from "@/lib/supabaseClient";
import {
  supabaseGetLicenceDetailByEmail,
  supabaseDeleteUser,
  supabaseAdminSetPassword,
  supabaseAdminSendPasswordReset,
} from "@/lib/supabaseActivationStore";

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

type UserActionBody = {
  action?: "soft_delete" | "restore" | "hard_delete" | "send_reset" | "set_password";
  email?: string;
  confirm?: string; // hard_delete requires confirm === the email
  new_password?: string; // set_password
};

/**
 * POST /api/v1/admin/user — destructive user actions (owner-only).
 *   - soft_delete  → disable + ban (recoverable via restore); keeps all data
 *   - restore      → undo a soft delete
 *   - hard_delete  → PERMANENT: removes the auth user (cascades community data)
 *                    and all email-keyed activation/billing rows, freeing the
 *                    email for reuse. Requires `confirm` to equal the email.
 */
export async function POST(req: Request) {
  if (!adminConfigured()) {
    return NextResponse.json({ ok: false, error: "admin_disabled" }, { status: 503 });
  }
  if (!isAdminAuthed(req)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  if (!hasSupabaseConfig()) {
    return NextResponse.json({ ok: false, error: "supabase_only" }, { status: 400 });
  }

  let body: UserActionBody = {};
  try {
    const raw = await req.text();
    body = raw ? (JSON.parse(raw) as UserActionBody) : {};
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }

  const email = (body.email || "").trim().toLowerCase();
  const action = body.action;
  if (!email) return NextResponse.json({ ok: false, error: "email_required" }, { status: 400 });
  const known = ["soft_delete", "restore", "hard_delete", "send_reset", "set_password"];
  if (!action || !known.includes(action)) {
    return NextResponse.json({ ok: false, error: "bad_action" }, { status: 400 });
  }
  if (action === "hard_delete" && (body.confirm || "").trim().toLowerCase() !== email) {
    return NextResponse.json(
      { ok: false, error: "confirm_mismatch", message: "Type the exact email to confirm permanent deletion." },
      { status: 400 },
    );
  }

  try {
    if (action === "send_reset") {
      const r = await supabaseAdminSendPasswordReset(email);
      return NextResponse.json({ ok: r.ok, action, email, error: r.ok ? undefined : r.reason }, { status: r.ok ? 200 : 500 });
    }
    if (action === "set_password") {
      const r = await supabaseAdminSetPassword(email, body.new_password || "");
      if (!r.ok) {
        const status = r.reason === "weak_password" || r.reason === "no_auth_user" ? 400 : 500;
        return NextResponse.json({ ok: false, action, email, error: r.reason }, { status });
      }
      return NextResponse.json({ ok: true, action, email });
    }

    const mode = action === "hard_delete" ? "hard" : action === "restore" ? "restore" : "soft";
    const r = await supabaseDeleteUser(email, mode);
    if (!r.ok) {
      return NextResponse.json({ ok: false, error: r.reason || "action_failed" }, { status: 500 });
    }
    return NextResponse.json({ ok: true, action, email, result: r.result });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "action failed" },
      { status: 500 },
    );
  }
}
