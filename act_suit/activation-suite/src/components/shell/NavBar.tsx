"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
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
 *
 * Below the `md` breakpoint the primary links collapse into a hamburger menu
 * so phone users keep full navigation (previously the links were simply
 * `hidden md:flex` with no fallback).
 */
export function NavBar({ variant = "marketing" }: Props) {
  const { session, status } = useSession();
  const isSignedIn = status === "ready" && Boolean(session);
  const [menuOpen, setMenuOpen] = useState(false);

  // Lock body scroll while the mobile menu is open, and close on Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  if (variant === "compact") {
    return (
      <div className="sticky top-0 z-10 flex min-h-[56px] flex-wrap items-center gap-y-2 border-b border-[var(--border)] bg-[rgba(244,239,230,0.9)] px-4 backdrop-blur-md sm:px-8">
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
    <nav className="fixed left-0 right-0 top-0 z-[100] flex h-[60px] items-center border-b border-[var(--border)] bg-[rgba(244,239,230,0.88)] px-4 backdrop-blur-md sm:px-6 md:px-8">
      <div className="mx-auto flex w-full max-w-[1200px] items-center justify-between gap-3">
        <Logo />

        {/* Desktop primary links */}
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

        {/* Right-side actions */}
        <div className="flex items-center gap-2 sm:gap-[10px]">
          <UserMenu />
          <Link href={ROUTES.signIn} className="btn btn-ghost hidden sm:inline-flex">
            Get beta access
          </Link>
          <Link href={ROUTES.pricing} className="btn btn-ghost hidden lg:inline-flex">
            Pricing
          </Link>
          <DownloadLink className="btn btn-primary whitespace-nowrap">
            <span className="sm:hidden">Download</span>
            <span className="hidden sm:inline">Download for Mac</span>
          </DownloadLink>

          {/* Hamburger — phones/tablets only */}
          <button
            type="button"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-[10px] border border-[var(--border-strong)] text-[var(--dark)] md:hidden"
          >
            {menuOpen ? (
              <X size={18} strokeWidth={2} />
            ) : (
              <Menu size={18} strokeWidth={2} />
            )}
          </button>
        </div>
      </div>

      {/* Mobile dropdown panel */}
      {menuOpen ? (
        <>
          {/* click-catcher so tapping outside closes the menu */}
          <button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            onClick={() => setMenuOpen(false)}
            className="fixed inset-0 top-[60px] z-[90] cursor-default bg-[rgba(28,23,16,0.25)] md:hidden"
          />
          <div className="fixed left-0 right-0 top-[60px] z-[95] border-b border-[var(--border)] bg-[var(--cream)] px-4 py-3 shadow-[0_12px_28px_rgba(28,23,16,0.12)] md:hidden">
            <nav aria-label="Mobile" className="flex flex-col">
              {NAV_LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setMenuOpen(false)}
                  className="rounded-[8px] px-2 py-2.5 text-[15px] text-[var(--dark)] hover:bg-[var(--cream-dark)]"
                >
                  {link.label}
                </Link>
              ))}
              {!isSignedIn ? (
                <Link
                  href={ROUTES.signIn}
                  onClick={() => setMenuOpen(false)}
                  className="rounded-[8px] px-2 py-2.5 text-[15px] text-[var(--dark)] hover:bg-[var(--cream-dark)]"
                >
                  Sign in
                </Link>
              ) : null}
              <Link
                href={ROUTES.signIn}
                onClick={() => setMenuOpen(false)}
                className="mt-2 btn btn-ghost w-full justify-center"
              >
                Get beta access
              </Link>
            </nav>
          </div>
        </>
      ) : null}
    </nav>
  );
}
