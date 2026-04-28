"use client";

import { useEffect, useState } from "react";
import { DownloadLink } from "@/components/shell/DownloadLink";
import { DownloadArrow } from "@/components/marketing/DownloadArrow";

/**
 * Slim sticky CTA that appears once the user scrolls past the hero.
 * Repeats the primary action without occluding the page on initial
 * paint. Hidden on mobile (the existing CTAs already render full-width
 * stacked there — a sticky bar on small screens steals tap area).
 */
const SHOW_AFTER_PX = 720;

export function StickyDownloadBar() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      setVisible(window.scrollY > SHOW_AFTER_PX);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div
      aria-hidden={!visible}
      className={`pointer-events-none fixed inset-x-0 bottom-6 z-30 hidden justify-center transition-all duration-300 md:flex ${
        visible
          ? "translate-y-0 opacity-100"
          : "pointer-events-none translate-y-4 opacity-0"
      }`}
    >
      <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-[var(--border-strong)] bg-[var(--dark)] px-5 py-2 text-white shadow-[0_20px_60px_rgba(0,0,0,0.25)]">
        <span className="hidden text-[12.5px] text-white/65 md:inline">
          Free during launch · Mac · Apple Silicon &amp; Intel
        </span>
        <DownloadLink className="btn btn-sm orange">
          <DownloadArrow />
          Download for Mac
        </DownloadLink>
        <a
          href="#pricing"
          className="text-[12.5px] font-medium text-white/70 transition-colors hover:text-white"
        >
          See plans →
        </a>
      </div>
    </div>
  );
}
