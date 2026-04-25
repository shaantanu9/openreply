import { NextResponse } from "next/server";
import { verifySupabaseBearer } from "@/lib/supabaseAuthServer";
import { activateDeviceSupabaseByEmail } from "@/lib/supabaseActivationStore";
import { hasSupabaseConfig } from "@/lib/supabaseClient";

export const runtime = "nodejs";

type WebActivateRequest = {
  activation_key?: string;
  device_signature?: string;
  app?: string;
  os?: string;
  arch?: string;
};

export async function POST(req: Request) {
  if (!hasSupabaseConfig()) {
    return NextResponse.json(
      { ok: false, error: "web activation requires Supabase config" },
      { status: 503 },
    );
  }

  const authHeader = req.headers.get("authorization") || "";
  const bearer = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";
  if (!bearer) {
    return NextResponse.json(
      { ok: false, error: "missing bearer token" },
      { status: 401 },
    );
  }

  let user;
  try {
    user = await verifySupabaseBearer(bearer);
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "invalid session",
      },
      { status: 401 },
    );
  }

  if (!user.email) {
    return NextResponse.json(
      { ok: false, error: "session has no email" },
      { status: 401 },
    );
  }

  let body: WebActivateRequest;
  try {
    body = (await req.json()) as WebActivateRequest;
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid json body" },
      { status: 400 },
    );
  }

  const activationKey = (body.activation_key || "").trim();
  const deviceSignature = (body.device_signature || "").trim();
  if (!activationKey || !deviceSignature) {
    return NextResponse.json(
      { ok: false, error: "activation_key and device_signature are required" },
      { status: 400 },
    );
  }

  const result = await activateDeviceSupabaseByEmail({
    email: user.email,
    activationKey,
    deviceSignature,
    os: body.os || "web",
    arch: body.arch || "web",
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
    access_token: result.token,
    license_id: result.licenseId,
    user_id: result.userId,
    expires_at: result.expiresAt,
    devices_used: result.devicesUsed,
    max_devices: result.maxDevices,
  });
}
