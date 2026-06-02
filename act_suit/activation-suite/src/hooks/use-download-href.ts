"use client";

import { useMemo } from "react";
import { getPublicEnv } from "@/lib/publicEnv";

type DownloadHref = {
  href: string;
  external: boolean;
};

/**
 * The canonical download endpoint. It resolves the latest GitHub release and
 * 302-redirects to the right asset for the visitor's OS, so every "Download"
 * CTA on the site just downloads the app — on any device.
 *
 * `NEXT_PUBLIC_APP_DOWNLOAD_URL`, if set, still overrides this (e.g. to point
 * at a CDN-hosted build instead of GitHub Releases).
 */
export const DOWNLOAD_ROUTE = "/api/download";

/**
 * @param platform optional explicit platform (mac-arm, mac-intel, windows,
 *   windows-msi, linux, linux-deb). Omit to let the server detect from the
 *   request User-Agent.
 */
export function useDownloadHref(platform?: string): DownloadHref {
  return useMemo(() => {
    const { appDownloadUrl } = getPublicEnv();
    if (appDownloadUrl) return { href: appDownloadUrl, external: true };
    const href = platform
      ? `${DOWNLOAD_ROUTE}?platform=${encodeURIComponent(platform)}`
      : DOWNLOAD_ROUTE;
    return { href, external: false };
  }, [platform]);
}
