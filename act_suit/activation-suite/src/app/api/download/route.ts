import { NextResponse } from "next/server";
import {
  fetchLatestRelease,
  assetUrlForPlatform,
  isPlatform,
  platformFromUserAgent,
  RELEASES_PAGE_URL,
} from "@/lib/releases";

export const runtime = "nodejs";

/**
 * Canonical "download the app" endpoint.
 *
 *   GET /api/download                 → best asset for the visitor's OS
 *   GET /api/download?platform=mac-arm|mac-intel|windows|windows-msi|linux|linux-deb
 *
 * Always resolves to the *latest* GitHub release (no hard-coded version) and
 * 302-redirects to the asset. If anything fails, it falls back to the public
 * releases page so the user is never left at a dead link.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const requested = url.searchParams.get("platform");
  const platform = isPlatform(requested)
    ? requested
    : platformFromUserAgent(req.headers.get("user-agent"));

  const release = await fetchLatestRelease();
  if (!release) {
    return NextResponse.redirect(RELEASES_PAGE_URL, { status: 302 });
  }

  const assetUrl = assetUrlForPlatform(release, platform);
  // Fall back to that release's page if the specific asset is missing.
  return NextResponse.redirect(assetUrl || release.pageUrl, { status: 302 });
}
