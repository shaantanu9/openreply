import { NextResponse } from "next/server";
import { activateLicenseForDevice } from "@/lib/licenseService";

export const runtime = "nodejs";

type ActivateRequest = {
  email?: string;
  password?: string;
  activation_key?: string;
  device_signature?: string;
  app?: string;
  os?: string;
  arch?: string;
};

export async function POST(req: Request) {
  let body: ActivateRequest;
  try {
    body = (await req.json()) as ActivateRequest;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }

  const email = (body.email || "").trim();
  const password = body.password || "";
  const activationKey = (body.activation_key || "").trim();
  const deviceSignature = (body.device_signature || "").trim();

  if (!email || !password || !activationKey || !deviceSignature) {
    return NextResponse.json(
      { ok: false, error: "missing required fields" },
      { status: 400 },
    );
  }

  const result = await activateLicenseForDevice({
    email,
    password,
    activationKey,
    deviceSignature,
    os: body.os || "unknown",
    arch: body.arch || "unknown",
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: result.status },
    );
  }

  return NextResponse.json({
    ok: true,
    token: result.token,
    license_id: result.licenseId,
    user_id: result.userId,
    expires_at: result.expiresAt,
  });
}

