"use client";

import Link from "next/link";
import { Logo } from "@/components/brand/Logo";
import { UserMenu } from "@/components/shell/UserMenu";
import { DownloadLink } from "@/components/shell/DownloadLink";
import { NAV_LINKS, ROUTES } from "@/lib/constants";
import { useSession } from "@/hooks/use-session";

type Variant = "marketing" | "compact";

type Props = {
  variant?: Variant;
};

/**
 * Fixed translucent nav used on the marketing page (variant="marketing").
 * Compact variant is slimmer with a sticky top bar for app pages like /activate.
 */
export function NavBar({ variant = "marketing" }: Props) {
  const { session, status } = useSession();
  const isSignedIn = status === "ready" && Boolean(session);

  if (variant === "compact") {
    return (
      <div className="sticky top-0 z-10 flex min-h-[56px] items-center justify-between border-b border-[var(--border)] bg-[rgba(244,239,230,0.9)] px-8 backdrop-blur-md">
        <Logo size="sm" />
        <nav
          aria-label="Site"
          className="ml-auto mr-3 flex flex-wrap justify-end gap-x-[18px] gap-y-2"
        >
          <Link
            href={ROUTES.home}
            className="text-[12.5px] font-medium text-[var(--muted)] hover:text-[var(--orange)]"
          >
            Home
          </Link>
          <Link
            href={ROUTES.signIn}
            className="text-[12.5px] font-medium text-[var(--muted)] hover:text-[var(--orange)]"
          >
            Sign in
          </Link>
          <Link
            href={ROUTES.activationHelp}
            className="text-[12.5px] font-medium text-[var(--muted)] hover:text-[var(--orange)]"
          >
            Activation help
          </Link>
        </nav>
        <UserMenu />
      </div>
    );
  }

  return (
    <nav className="fixed left-0 right-0 top-0 z-[100] flex h-[60px] items-center border-b border-[var(--border)] bg-[rgba(244,239,230,0.88)] px-8 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-[1200px] items-center justify-between">
        <Logo />
        <div className="hidden flex-wrap items-center gap-x-7 gap-y-2 md:flex">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-[14px] text-[var(--muted)] transition-colors hover:text-[var(--dark)]"
            >
              {link.label}
            </Link>
          ))}
          {!isSignedIn ? (
            <Link
              href={ROUTES.signIn}
              className="text-[14px] text-[var(--muted)] transition-colors hover:text-[var(--dark)]"
            >
              Sign in
            </Link>
          ) : null}
        </div>
        <div className="flex items-center gap-[10px]">
          <UserMenu />
          <Link href="#pricing" className="btn btn-ghost hidden sm:inline-flex">
            View plans
          </Link>
          <DownloadLink className="btn btn-primary">Download for Mac</DownloadLink>
        </div>
      </div>
    </nav>
  );
}
