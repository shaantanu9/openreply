import { NextResponse } from "next/server";
import {
  ADMIN_COOKIE,
  adminConfigured,
  adminSessionToken,
  checkSecret,
  isAdminAuthed,
} from "@/lib/adminAuth";

export const runtime = "nodejs";

// GET → current admin session state.
export async function GET(req: Request) {
  return NextResponse.json({
    ok: true,
    configured: adminConfigured(),
    authed: isAdminAuthed(req),
  });
}

// POST {action:"login"|"logout", secret?} → set / clear the admin cookie.
export async function POST(req: Request) {
  if (!adminConfigured()) {
    return NextResponse.json(
      { ok: false, error: "admin_disabled", message: "Set ADMIN_SECRET in the server env." },
      { status: 503 },
    );
  }
  let body: { action?: string; secret?: string } = {};
  try {
    const raw = await req.text();
    body = raw ? JSON.parse(raw) : {};
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  if (body.action === "logout") {
    const res = NextResponse.json({ ok: true, authed: false });
    res.cookies.set(ADMIN_COOKIE, "", { httpOnly: true, sameSite: "strict", path: "/", maxAge: 0 });
    return res;
  }

  if (!checkSecret(body.secret || "")) {
    return NextResponse.json({ ok: false, error: "bad_secret" }, { status: 403 });
  }
  const res = NextResponse.json({ ok: true, authed: true });
  res.cookies.set(ADMIN_COOKIE, adminSessionToken(), {
    httpOnly: true,
    sameSite: "strict",
    path: "/",
    maxAge: 60 * 60 * 8, // 8h
  });
  return res;
}
