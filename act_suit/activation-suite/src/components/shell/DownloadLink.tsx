"use client";

import { useDownloadHref } from "@/hooks/use-download-href";

type Props = {
  className?: string;
  children: React.ReactNode;
  /**
   * Force a specific build (mac-arm, mac-intel, windows, windows-msi, linux,
   * linux-deb). Omit to let the server pick the best asset for the visitor's
   * OS from the latest GitHub release.
   */
  platform?: string;
};

/**
 * Every "Download" CTA routes through here so the destination is consistent.
 * Resolves to the latest GitHub release asset for the visitor's OS (or the
 * forced `platform`). Replaces the old `a[href="#download"]` rewriting.
 */
export function DownloadLink({ className, children, platform }: Props) {
  const { href, external } = useDownloadHref(platform);
  const extraProps = external
    ? { target: "_blank", rel: "noopener noreferrer" }
    : {};
  return (
    <a href={href} className={className} {...extraProps}>
      {children}
    </a>
  );
}
