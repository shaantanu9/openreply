"use client";

import { useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabaseBrowser";

type SessionState = {
  session: Session | null;
  user: User | null;
  status: "loading" | "ready" | "error";
  error: string | null;
};

export function useSession(): SessionState {
  const [state, setState] = useState<SessionState>({
    session: null,
    user: null,
    status: "loading",
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    let sb;
    try {
      sb = getSupabaseBrowserClient();
    } catch (e) {
      setState({
        session: null,
        user: null,
        status: "error",
        error: e instanceof Error ? e.message : String(e),
      });
      return;
    }

    sb.auth
      .getSession()
      .then(({ data }) => {
        if (cancelled) return;
        setState({
          session: data.session || null,
          user: data.session?.user || null,
          status: "ready",
          error: null,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({
          session: null,
          user: null,
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        });
      });

    const { data: sub } = sb.auth.onAuthStateChange((_event, session) => {
      setState({
        session: session || null,
        user: session?.user || null,
        status: "ready",
        error: null,
      });
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  return state;
}

export function getUserDisplayName(user: User | null | undefined): string {
  if (!user) return "";
  const meta = (user.user_metadata || {}) as Record<string, unknown>;
  const full = typeof meta.full_name === "string" ? meta.full_name.trim() : "";
  if (full) return full;
  return user.email || "";
}

export function getUserInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  const letters = parts.map((p) => p[0]?.toUpperCase() || "").join("");
  return letters || "GM";
}
