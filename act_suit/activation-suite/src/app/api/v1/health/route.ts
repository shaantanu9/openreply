import { NextResponse } from "next/server";
import { getVersionGate } from "@/lib/appConfig";
import { tokenSecretFingerprint } from "@/lib/token";

export const runtime = "nodejs";

// Mirror of /v1/health (some callers use the /api prefix). Returns the same
// DB-driven version-gate fields so the desktop force-update check works on
// either path. See src/lib/appConfig.ts for the source of truth.
// `signing_fp` is an irreversible fingerprint of TOKEN_SIGNING_SECRET — the
// release pipeline checks it matches the DMG's JWT_DESKTOP_SECRET before build.
export async function GET() {
  const gate = await getVersionGate();
  return NextResponse.json({ ok: true, signing_fp: tokenSecretFingerprint(), ...gate });
}
