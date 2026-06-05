"use client";

import { useSession } from "@/hooks/use-session";

/**
 * Conditional render gates keyed on the Supabase browser session.
 *
 * The marketing site is statically rendered (no per-request auth), so anything
 * that must differ for signed-in users is gated CLIENT-side here. Both gates
 * wait for `status === "ready"` before hiding, so the (majority) logged-out
 * marketing page paints instantly and only collapses once a real session is
 * confirmed — no flash of signed-in UI for anonymous visitors.
 */

/** Render children ONLY for confirmed signed-in users. */
export function SignedInOnly({ children }: { children: React.ReactNode }) {
  const { status, session } = useSession();
  if (status === "ready" && session) return <>{children}</>;
  return null;
}

/**
 * Render children for everyone EXCEPT confirmed signed-in users. Defaults to
 * showing while the session resolves so anonymous visitors get an instant
 * page; collapses the moment a session is confirmed.
 */
export function SignedOutOnly({ children }: { children: React.ReactNode }) {
  const { status, session } = useSession();
  if (status === "ready" && session) return null;
  return <>{children}</>;
}
