import { NextResponse } from "next/server";

export const runtime = "nodejs";

// Mirror of /v1/health (some callers use the /api prefix). Returns the same
// env-driven version-gate fields so the desktop force-update check works on
// either path. See src/app/v1/health/route.ts for the env-var contract.
export async function GET() {
  return NextResponse.json({
    ok: true,
    min_app_version: process.env.MIN_APP_VERSION || null,
    latest_app_version: process.env.LATEST_APP_VERSION || null,
    app_download_url:
      process.env.APP_DOWNLOAD_URL ||
      process.env.NEXT_PUBLIC_APP_DOWNLOAD_URL ||
      "https://gapmap.myind.ai/download",
  });
}
