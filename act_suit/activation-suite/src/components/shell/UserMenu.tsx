"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabaseBrowser";
import {
  getUserDisplayName,
  getUserInitials,
  useSession,
} from "@/hooks/use-session";
import { openLemonSqueezyCustomerPortal } from "@/lib/lemonSqueezy";
import { ROUTES } from "@/lib/constants";

export function UserMenu() {
  const router = useRouter();
  const { user, status } = useSession();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  if (status !== "ready" || !user) return null;

  const name = getUserDisplayName(user) || "Account";
  const initials = getUserInitials(name);

  async function handleSignOut() {
    try {
      await getSupabaseBrowserClient().auth.signOut();
    } catch {
      /* ignore */
    }
    router.push(ROUTES.signIn);
    router.refresh();
  }

  function handlePortal() {
    if (!openLemonSqueezyCustomerPortal()) {
      alert(
        "Customer portal is not configured. Set NEXT_PUBLIC_LEMONSQUEEZY_CUSTOMER_PORTAL in env.",
      );
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-expanded={open}
        className="inline-flex items-center gap-2 rounded-full border border-transparent px-2 py-[3px] hover:border-[var(--border)] hover:bg-[var(--cream-mid)] data-[open=true]:border-[var(--border)] data-[open=true]:bg-[var(--cream-mid)]"
        data-open={open ? "true" : "false"}
      >
        <span
          className="inline-flex h-[26px] w-[26px] items-center justify-center rounded-full border border-[rgba(224,123,60,0.3)] bg-[var(--orange-pale)] text-[11px] font-semibold text-[var(--orange)]"
        >
          {initials}
        </span>
        <span className="hidden max-w-[110px] overflow-hidden text-ellipsis whitespace-nowrap text-[12.5px] text-[var(--muted)] sm:inline">
          {name}
        </span>
        <span className="text-[11px] text-[var(--muted-light)]">▾</span>
      </button>
      {open ? (
        <div
          role="menu"
          aria-label="Account menu"
          className="absolute right-0 top-[calc(100%+8px)] z-[120] min-w-[220px] rounded-[10px] border border-[var(--border-strong)] bg-white p-2 shadow-[0_10px_22px_rgba(28,23,16,0.12)]"
        >
          <Link
            href={ROUTES.workspaces}
            role="menuitem"
            className="block rounded-[8px] px-[10px] py-2 text-[13px] text-[var(--text)] hover:bg-[var(--cream-mid)]"
            onClick={() => setOpen(false)}
          >
            Workspaces
          </Link>
          <Link
            href={ROUTES.explore}
            role="menuitem"
            className="block rounded-[8px] px-[10px] py-2 text-[13px] text-[var(--text)] hover:bg-[var(--cream-mid)]"
            onClick={() => setOpen(false)}
          >
            Explore public research
          </Link>
          <Link
            href={ROUTES.dashboard}
            role="menuitem"
            className="block rounded-[8px] px-[10px] py-2 text-[13px] text-[var(--text)] hover:bg-[var(--cream-mid)]"
            onClick={() => setOpen(false)}
          >
            Licence &amp; devices
          </Link>
          <Link
            href={ROUTES.activate}
            role="menuitem"
            className="block rounded-[8px] px-[10px] py-2 text-[13px] text-[var(--text)] hover:bg-[var(--cream-mid)]"
            onClick={() => setOpen(false)}
          >
            Activate new device
          </Link>
          <Link
            href={ROUTES.settingsByok}
            role="menuitem"
            className="block rounded-[8px] px-[10px] py-2 text-[13px] text-[var(--text)] hover:bg-[var(--cream-mid)]"
            onClick={() => setOpen(false)}
          >
            BYOK keys
          </Link>
          <Link
            href={ROUTES.settingsProfile}
            role="menuitem"
            className="block rounded-[8px] px-[10px] py-2 text-[13px] text-[var(--text)] hover:bg-[var(--cream-mid)]"
            onClick={() => setOpen(false)}
          >
            Edit profile
          </Link>
          <Link
            href={ROUTES.activationHelp}
            role="menuitem"
            className="block rounded-[8px] px-[10px] py-2 text-[13px] text-[var(--text)] hover:bg-[var(--cream-mid)]"
            onClick={() => setOpen(false)}
          >
            Activation help
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              handlePortal();
            }}
            className="block w-full rounded-[8px] px-[10px] py-2 text-left text-[13px] text-[var(--text)] hover:bg-[var(--cream-mid)]"
          >
            Customer portal
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={handleSignOut}
            className="block w-full rounded-[8px] px-[10px] py-2 text-left text-[13px] text-[#B54747] hover:bg-[var(--cream-mid)]"
          >
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
