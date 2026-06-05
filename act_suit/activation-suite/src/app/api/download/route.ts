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

  let release = await fetchLatestRelease();
  if (!release) {
    return NextResponse.redirect(RELEASES_PAGE_URL, { status: 302 });
  }

  let assetUrl = assetUrlForPlatform(release, platform);
  // Per-platform installers append to a release minutes apart as each
  // platform's CI finishes, so the cached release snapshot can lag a
  // just-published asset (e.g. Linux landing after the Data Cache last
  // refreshed). Before falling back to the release page, retry ONCE uncached
  // so a freshly uploaded installer resolves immediately instead of waiting
  // for the revalidate window to roll over.
  if (!assetUrl) {
    const fresh = await fetchLatestRelease({ noStore: true });
    if (fresh) {
      release = fresh;
      assetUrl = assetUrlForPlatform(fresh, platform);
    }
  }
  // Fall back to that release's page if the specific asset is still missing.
  return NextResponse.redirect(assetUrl || release.pageUrl, { status: 302 });
}
