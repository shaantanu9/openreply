"use client";

import Link from "next/link";
import { useSession, getUserDisplayName } from "@/hooks/use-session";
import { DownloadLink } from "@/components/shell/DownloadLink";
import { ROUTES } from "@/lib/constants";

/**
 * Logged-in home header — a compact app-launcher that replaces the marketing
 * funnel's invite/urgency noise for users who have already converted. Gives the
 * four things a returning user actually wants: open their dashboard, download
 * the desktop app, jump to workspaces, or browse public research.
 *
 * Renders nothing for logged-out visitors (they get the full marketing page).
 * It owns its own top padding to clear the fixed 60px nav, since the marketing
 * hero it stands in for (InviteHero) is hidden when signed in.
 */
export function SignedInWelcome() {
  const { status, session, user } = useSession();
  if (status !== "ready" || !session) return null;

  const first = getUserDisplayName(user).trim().split(/\s+/)[0] || "there";

  return (
    <section className="border-b border-[var(--border)] bg-[var(--cream)] px-4 pt-[92px] pb-14 sm:px-8">
      <div className="mx-auto max-w-[1000px]">
        <p className="text-[12.5px] font-semibold uppercase tracking-[1.3px] text-[var(--orange)]">
          Welcome back
        </p>
        <h1 className="mt-2 font-serif text-[30px] leading-[1.12] text-[var(--dark)] sm:text-[40px]">
          Hi {first} — your Gap&nbsp;Map workspace
        </h1>
        <p className="mt-3 max-w-[580px] text-[15px] leading-[1.6] text-[var(--muted)]">
          Pick up your research, grab the desktop app, or manage your licence and
          devices.
        </p>
        <div className="mt-7 flex flex-wrap gap-3">
          <Link href={ROUTES.dashboard} className="btn btn-primary">
            Open dashboard
          </Link>
          <DownloadLink className="btn btn-ghost">
            <span className="sm:hidden">Download app</span>
            <span className="hidden sm:inline">Download for Mac</span>
          </DownloadLink>
          <Link href={ROUTES.workspaces} className="btn btn-ghost">
            Workspaces
          </Link>
          <Link href={ROUTES.explore} className="btn btn-ghost">
            Explore research
          </Link>
        </div>
      </div>
    </section>
  );
}
