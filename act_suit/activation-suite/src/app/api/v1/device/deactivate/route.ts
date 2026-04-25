import { NextResponse } from "next/server";
import { verifyActivationToken } from "@/lib/token";
import { hasSupabaseConfig } from "@/lib/supabaseClient";
import { supabaseRemoveDevice } from "@/lib/supabaseActivationStore";
import { removeDevice } from "@/lib/activationStore";

export const runtime = "nodejs";

type DeactivateBody = {
  device_fingerprint?: string;
};

function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization") || "";
  if (!header.toLowerCase().startsWith("bearer ")) return null;
  return header.slice(7).trim() || null;
}

export async function POST(req: Request) {
  const token = bearerToken(req);
  if (!token) {
    return NextResponse.json({ ok: false, error: "missing bearer token" }, { status: 401 });
  }

  let claims;
  try {
    claims = verifyActivationToken(token);
  } catch {
    return NextResponse.json({ ok: false, error: "invalid token" }, { status: 401 });
  }

  let body: DeactivateBody = {};
  try {
    const raw = await req.text();
    body = raw ? (JSON.parse(raw) as DeactivateBody) : {};
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }

  // Prefer the fingerprint from the body (matches the current machine at the
  // moment the desktop calls deactivate). Fall back to the JWT claim so older
  // desktop builds that don't send a body still work.
  const fingerprint = (body.device_fingerprint || claims.device_fingerprint || "")
    .trim()
    .toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) {
    return NextResponse.json(
      { ok: false, error: "device_fingerprint must be a sha256 hex digest" },
      { status: 400 },
    );
  }

  try {
    const removed = hasSupabaseConfig()
      ? await supabaseRemoveDevice(claims.sub, fingerprint)
      : await removeDevice(claims.sub, fingerprint);
    return NextResponse.json({ ok: true, removed });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "deactivate failed" },
      { status: 500 },
    );
  }
}
