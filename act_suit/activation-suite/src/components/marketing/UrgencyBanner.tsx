import { URGENCY_BANNER } from "@/lib/constants";

/**
 * Thin promotional bar pinned above the main nav. Reinforces scarcity
 * (paid tier ships Q3) without resorting to a countdown timer. Sticky-
 * adjacent: lives on the page, not on a fixed overlay, so it doesn't
 * fight the SiteShell's own sticky header.
 */
export function UrgencyBanner() {
  return (
    <div
      role="region"
      aria-label="Launch promotion"
      className="bg-[var(--dark)] text-white"
    >
      <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-4 px-8 py-2.5 text-[12.5px] leading-tight">
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="inline-flex h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--orange)]"
          />
          <p className="text-white/85">{URGENCY_BANNER.message}</p>
        </div>
        <a
          href={URGENCY_BANNER.cta.href}
          className="hidden shrink-0 rounded-full border border-white/20 px-3 py-1 text-[11.5px] font-medium text-white transition-colors hover:border-[var(--orange)] hover:text-[var(--orange-light)] sm:inline-flex"
        >
          {URGENCY_BANNER.cta.label} →
        </a>
      </div>
    </div>
  );
}
