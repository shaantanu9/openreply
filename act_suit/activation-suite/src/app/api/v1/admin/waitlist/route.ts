// Admin waitlist management (owner-only).
//   GET  → { ok, waitlist }
//   POST → { action: "invite" | "reject", email }
//          invite: generates a single-use coupon, marks the row invited,
//          and emails the code (best-effort).
import { NextResponse } from "next/server";
import { adminConfigured, isAdminAuthed } from "@/lib/adminAuth";
import { hasSupabaseConfig } from "@/lib/supabaseClient";
import { listWaitlist, inviteFromWaitlist, setWaitlistStatus } from "@/lib/betaAdminStore";
import { sendBetaInviteEmail } from "@/lib/email";

export const runtime = "nodejs";

function guard(req: Request): NextResponse | null {
  if (!adminConfigured()) return NextResponse.json({ ok: false, error: "admin_disabled" }, { status: 503 });
  if (!isAdminAuthed(req)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  if (!hasSupabaseConfig()) return NextResponse.json({ ok: false, error: "supabase_only" }, { status: 400 });
  return null;
}

export async function GET(req: Request) {
  const bad = guard(req);
  if (bad) return bad;
  try {
    const status = new URL(req.url).searchParams.get("status") || undefined;
    const waitlist = await listWaitlist(status);
    return NextResponse.json({ ok: true, waitlist });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "list failed" }, { status: 500 });
  }
}

type Body = { action?: "invite" | "reject"; email?: string; name?: string };

export async function POST(req: Request) {
  const bad = guard(req);
  if (bad) return bad;

  let body: Body = {};
  try {
    const raw = await req.text();
    body = raw ? (JSON.parse(raw) as Body) : {};
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }

  const email = (body.email || "").trim().toLowerCase();
  if (!email) return NextResponse.json({ ok: false, error: "email_required" }, { status: 400 });

  if (body.action === "reject") {
    const ok = await setWaitlistStatus(email, "rejected");
    return NextResponse.json({ ok, action: "reject", email });
  }

  // default: invite
  const r = await inviteFromWaitlist(email);
  if (!r.ok || !r.code) {
    return NextResponse.json({ ok: false, error: r.reason || "invite_failed" }, { status: 500 });
  }
  const mail = await sendBetaInviteEmail(email, r.code, body.name);
  return NextResponse.json({
    ok: true,
    action: "invite",
    email,
    code: r.code,
    emailed: mail.ok,
    email_skipped: mail.skipped || false,
  });
}
