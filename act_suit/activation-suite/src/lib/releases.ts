/**
 * GitHub Releases resolver for the Gap Map desktop app.
 *
 * The published asset filenames embed the version (e.g.
 * `Gap-Map-0.1.18-macOS-Apple-Silicon.dmg`), so GitHub's
 * `/releases/latest/download/<file>` shortcut can't be hard-coded — the
 * filename changes every release. Instead we hit the GitHub API for the
 * latest release and match each platform by a *stable* filename suffix.
 *
 * The fetch is cached server-side (Next.js `revalidate`) so we never burn the
 * unauthenticated 60-req/hour rate limit, even under load.
 */

import { GITHUB } from "@/lib/constants";

export const RELEASE_REPO = GITHUB.repo;
export const RELEASES_PAGE_URL = GITHUB.releases;
export const LATEST_RELEASE_PAGE_URL = `${RELEASES_PAGE_URL}/latest`;

const LATEST_API_URL = `https://api.github.com/repos/${RELEASE_REPO}/releases/latest`;

// Cache the GitHub API response for 15 minutes.
const REVALIDATE_SECONDS = 900;

export type Platform =
  | "mac-arm"
  | "mac-intel"
  | "windows"
  | "windows-msi"
  | "linux"
  | "linux-deb";

/**
 * Each platform maps to the trailing part of its asset filename, which is
 * stable across versions. Matching is done with `name.endsWith(suffix)`.
 */
const ASSET_SUFFIX: Record<Platform, string> = {
  "mac-arm": "macOS-Apple-Silicon.dmg",
  "mac-intel": "macOS-Intel.dmg",
  windows: "Windows-Installer.exe",
  "windows-msi": "Windows.msi",
  linux: "Linux.AppImage",
  "linux-deb": "Linux.deb",
};

export function isPlatform(value: string | null | undefined): value is Platform {
  return !!value && value in ASSET_SUFFIX;
}

type GitHubAsset = { name: string; browser_download_url: string };
type GitHubRelease = {
  tag_name?: string;
  name?: string;
  html_url?: string;
  assets?: GitHubAsset[];
};

export type LatestRelease = {
  tag: string; // e.g. "v0.1.18"
  version: string; // e.g. "0.1.18"
  pageUrl: string; // release page on GitHub
  assets: GitHubAsset[];
};

/**
 * Fetch (and cache) the latest published release. Returns `null` on any
 * failure so callers can degrade gracefully to the releases page.
 */
export async function fetchLatestRelease(
  opts: { noStore?: boolean } = {},
): Promise<LatestRelease | null> {
  try {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "User-Agent": "gapmap-site",
    };
    // Optional: lifts the rate limit from 60 → 5,000 req/hour. Server-only.
    const token = process.env.GITHUB_TOKEN;
    if (token) headers.Authorization = `Bearer ${token}`;
    // Default path uses the shared Data Cache (revalidate window). Callers can
    // force an uncached read — used as a fallback when a just-published asset
    // hasn't propagated into the cached snapshot yet.
    const res = await fetch(LATEST_API_URL, {
      headers,
      ...(opts.noStore
        ? { cache: "no-store" as const }
        : { next: { revalidate: REVALIDATE_SECONDS } }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as GitHubRelease;
    const tag = data.tag_name || "";
    if (!tag) return null;
    return {
      tag,
      version: tag.replace(/^v/, ""),
      pageUrl: data.html_url || LATEST_RELEASE_PAGE_URL,
      assets: Array.isArray(data.assets) ? data.assets : [],
    };
  } catch {
    return null;
  }
}

/** Resolve a platform to its download URL within a given release. */
export function assetUrlForPlatform(
  release: LatestRelease,
  platform: Platform,
): string | null {
  const suffix = ASSET_SUFFIX[platform];
  const match = release.assets.find((a) => a.name.endsWith(suffix));
  return match?.browser_download_url ?? null;
}

/**
 * Guess the best platform from a browser User-Agent string. macOS can't be
 * split into arm/intel reliably from UA alone, so default Macs to Apple
 * Silicon (the common case) — the download page still offers an explicit
 * Intel build.
 */
export function platformFromUserAgent(ua: string | null | undefined): Platform {
  const s = (ua || "").toLowerCase();
  if (s.includes("windows")) return "windows";
  if (s.includes("linux") && !s.includes("android")) return "linux";
  // mac, iOS, and everything else → Apple Silicon dmg by default.
  return "mac-arm";
}
