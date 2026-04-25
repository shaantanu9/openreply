import { NextResponse } from "next/server";
import { registerUser } from "@/lib/registrationBillingService";

export const runtime = "nodejs";

type RegisterRequest = {
  full_name?: string;
  email?: string;
  password?: string;
  role?: string;
};

export async function POST(req: Request) {
  let body: RegisterRequest;
  try {
    body = (await req.json()) as RegisterRequest;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }

  const fullName = (body.full_name || "").trim();
  const email = (body.email || "").trim().toLowerCase();
  const password = (body.password || "").trim();
  const role = (body.role || "researcher").trim();

  if (!fullName || !email || !password) {
    return NextResponse.json(
      { ok: false, error: "full_name, email and password are required" },
      { status: 400 },
    );
  }

  try {
    const user = await registerUser({ fullName, email, password, role });
    return NextResponse.json({
      ok: true,
      user_id: user.userId,
      full_name: user.fullName,
      email: user.email,
      role: user.role,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "unable to register user" },
      { status: 409 },
    );
  }
}
