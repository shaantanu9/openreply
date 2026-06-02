import { NextResponse } from "next/server";
import { activateLicenseForDevice } from "@/lib/licenseService";
import { isMasterKey, masterSignature } from "@/lib/masterKey";
import { issueMasterToken, defaultActivationExpiryIso } from "@/lib/token";
import { saveOnboarding } from "@/lib/onboardingStore";

export const runtime = "nodejs";

type ActivateRequest = {
  email?: string;
  password?: string;
  activation_key?: string;
  device_signature?: string;
  app?: string;
  os?: string;
  arch?: string;
  onboarding?: Record<string, unknown>;
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

  // Capture onboarding answers the app sends with activation (best-effort).
  if (email && body.onboarding && typeof body.onboarding === "object") {
    try { await saveOnboarding(email, body.onboarding); } catch { /* non-fatal */ }
  }

  // Master beta key — activates ANY device for ANY email, no password, no
  // device limit. Revoked/rotated by changing MASTER_KEY in the server env.
  if (isMasterKey(activationKey)) {
    if (!/^[a-f0-9]{64}$/.test(deviceSignature.toLowerCase())) {
      return NextResponse.json(
        { ok: false, error: "device_signature must be a sha256 hex digest" },
        { status: 400 },
      );
    }
    const fp = deviceSignature.toLowerCase();
    return NextResponse.json({
      ok: true,
      master: true,
      token: issueMasterToken(fp, email, masterSignature()),
      license_id: "lic_master",
      user_id: "usr_master",
      expires_at: defaultActivationExpiryIso(),
      devices_used: 1,
      max_devices: 999999,
    });
  }

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
    devices_used: result.devicesUsed,
    max_devices: result.maxDevices,
  });
}
