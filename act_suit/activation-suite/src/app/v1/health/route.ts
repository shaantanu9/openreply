import { NextResponse } from "next/server";

export const runtime = "nodejs";

// Health + version gate. The desktop app polls this on boot (and periodically)
// to decide whether it must force the user to update. All three fields are
// env-driven so a release can be made mandatory by flipping a Vercel env var —
// no code redeploy needed:
//   MIN_APP_VERSION    — installs BELOW this are force-updated (hard gate)
//   LATEST_APP_VERSION — newest available; shown as a soft "update available"
//   APP_DOWNLOAD_URL   — where the update screen sends the user
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
