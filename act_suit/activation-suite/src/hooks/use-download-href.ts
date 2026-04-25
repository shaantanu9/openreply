"use client";

import { useMemo } from "react";
import { getPublicEnv } from "@/lib/publicEnv";
import { ROUTES } from "@/lib/constants";
import { useSession } from "@/hooks/use-session";

type DownloadHref = {
  href: string;
  external: boolean;
};

/**
 * If APP_DOWNLOAD_URL is configured, every "#download" link opens the real
 * desktop download. Otherwise signed-out users go to /sign-in and signed-in
 * users go to /activate.
 */
export function useDownloadHref(): DownloadHref {
  const { session, status } = useSession();
  return useMemo(() => {
    const { appDownloadUrl } = getPublicEnv();
    if (appDownloadUrl) return { href: appDownloadUrl, external: true };
    if (status !== "ready") return { href: ROUTES.signIn, external: false };
    return {
      href: session ? ROUTES.activate : ROUTES.signIn,
      external: false,
    };
  }, [session, status]);
}
