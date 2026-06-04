import { NextResponse } from "next/server";
import { getVersionGate } from "@/lib/appConfig";

export const runtime = "nodejs";

// Mirror of /v1/health (some callers use the /api prefix). Returns the same
// DB-driven version-gate fields so the desktop force-update check works on
// either path. See src/lib/appConfig.ts for the source of truth.
export async function GET() {
  const gate = await getVersionGate();
  return NextResponse.json({ ok: true, ...gate });
}
