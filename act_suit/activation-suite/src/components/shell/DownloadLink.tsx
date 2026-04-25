"use client";

import { useDownloadHref } from "@/hooks/use-download-href";

type Props = {
  className?: string;
  children: React.ReactNode;
};

/**
 * Every "Download" CTA routes through here so the destination is consistent
 * with session state + env config. Replaces the old `a[href="#download"]`
 * rewriting in site-auth.js.
 */
export function DownloadLink({ className, children }: Props) {
  const { href, external } = useDownloadHref();
  const extraProps = external
    ? { target: "_blank", rel: "noopener noreferrer" }
    : {};
  return (
    <a href={href} className={className} {...extraProps}>
      {children}
    </a>
  );
}
