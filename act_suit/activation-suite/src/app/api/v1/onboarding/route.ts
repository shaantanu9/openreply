import { NextResponse } from "next/server";
import { saveOnboarding, getOnboarding } from "@/lib/onboardingStore";
import { isAdminAuthed } from "@/lib/adminAuth";

export const runtime = "nodejs";

type OnboardingBody = { email?: string; data?: Record<string, unknown> };

// POST {email, data} — store the onboarding answers the app/website collected.
export async function POST(req: Request) {
  let body: OnboardingBody = {};
  try {
    const raw = await req.text();
    body = raw ? (JSON.parse(raw) as OnboardingBody) : {};
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }
  const email = (body.email || "").trim().toLowerCase();
  if (!email) return NextResponse.json({ ok: false, error: "email required" }, { status: 400 });
  const data = body.data && typeof body.data === "object" ? body.data : {};
  const res = await saveOnboarding(email, data);
  return NextResponse.json(res, { status: res.ok ? 200 : 200 });
}

// GET ?email= — admin only (used by the dashboard later).
export async function GET(req: Request) {
  if (!isAdminAuthed(req)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  const email = new URL(req.url).searchParams.get("email") || "";
  const data = await getOnboarding(email);
  return NextResponse.json({ ok: true, email: email.toLowerCase(), data });
}
