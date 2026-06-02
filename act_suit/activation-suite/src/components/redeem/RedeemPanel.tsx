"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabaseBrowser";
import { useSession } from "@/hooks/use-session";
import { ROUTES } from "@/lib/constants";

type Result =
  | { kind: "idle" }
  | { kind: "loading" }
  | {
      kind: "success";
      activationKey: string;
      planId: string;
      expiresAt: string | null;
      isTrial: boolean;
    }
  | { kind: "error"; message: string };

// Map the typed server errors → friendly UI copy.
function friendlyError(code: string): string {
  switch (code) {
    case "not_found":
      return "We didn't find that coupon. Double-check the code (case-insensitive).";
    case "disabled":
      return "That coupon has been disabled.";
    case "expired":
      return "That coupon has expired.";
    case "exhausted":
      return "That coupon's redemptions are used up.";
    case "already_has_license":
      return "Your account already has an active Gap Map licence. Visit the dashboard to manage it.";
    case "missing bearer token":
    case "invalid session":
      return "Your session expired. Please sign in again.";
    default:
      return code || "Something went wrong. Please try again.";
  }
}

export function RedeemPanel() {
  const router = useRouter();
  const { session, status } = useSession();
  const [code, setCode] = useState("");
  const [result, setResult] = useState<Result>({ kind: "idle" });

  // Redirect unauthenticated visitors to sign-in with next=/redeem.
  useEffect(() => {
    if (status === "ready" && !session) {
      router.replace(`${ROUTES.signIn}?next=${encodeURIComponent(ROUTES.redeem)}`);
    }
  }, [status, session, router]);

  if (status === "loading") {
    return (
      <main className="container mx-auto py-16">
        <p className="text-muted-foreground">Checking session…</p>
      </main>
    );
  }
  if (!session) {
    // Brief — useEffect already kicked the redirect.
    return null;
  }

  async function handleRedeem(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = code.trim();
    if (!trimmed) {
      setResult({ kind: "error", message: "Enter your coupon code." });
      return;
    }
    setResult({ kind: "loading" });

    let accessToken: string;
    try {
      const sb = getSupabaseBrowserClient();
      const { data } = await sb.auth.getSession();
      accessToken = data.session?.access_token || "";
      if (!accessToken) {
        setResult({ kind: "error", message: friendlyError("invalid session") });
        return;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setResult({ kind: "error", message: msg });
      return;
    }

    try {
      const res = await fetch("/api/v1/coupon/redeem", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ coupon_code: trimmed }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        activation_key?: string;
        plan_id?: string;
        expires_at?: string | null;
        is_trial?: boolean;
      };
      if (!res.ok || !data.ok) {
        setResult({ kind: "error", message: friendlyError(data.error || `HTTP ${res.status}`) });
        return;
      }
      setResult({
        kind: "success",
        activationKey: data.activation_key || "",
        planId: data.plan_id || "pro",
        expiresAt: data.expires_at || null,
        isTrial: !!data.is_trial,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setResult({ kind: "error", message: msg });
    }
  }

  async function copyKey(key: string) {
    try {
      await navigator.clipboard.writeText(key);
    } catch {
      /* best-effort — user can select-all + copy manually */
    }
  }

  return (
    <main className="container mx-auto max-w-2xl px-4 py-12 md:py-20">
      <div className="space-y-2 text-center">
        <h1 className="text-3xl font-bold tracking-tight">Redeem a coupon</h1>
        <p className="text-muted-foreground">
          Enter a coupon code to get a free Gap Map activation key. The key works
          immediately in the desktop app.
        </p>
      </div>

      {result.kind !== "success" && (
        <form
          onSubmit={handleRedeem}
          className="mt-8 space-y-4 rounded-xl border border-border bg-card p-6 shadow-sm"
        >
          <label className="block text-sm font-medium">
            Coupon code
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="GAPMAP-LAUNCH-XXXX"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm uppercase tracking-wider shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              disabled={result.kind === "loading"}
            />
          </label>
          {result.kind === "error" && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {result.message}
            </p>
          )}
          <button
            type="submit"
            disabled={result.kind === "loading"}
            className="inline-flex w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition hover:bg-primary/90 disabled:opacity-60"
          >
            {result.kind === "loading" ? "Redeeming…" : "Redeem coupon"}
          </button>
          <p className="text-xs text-muted-foreground">
            Coupons are case-insensitive. Each coupon issues a free activation key
            that you can paste into Gap Map on the desktop app.
          </p>
        </form>
      )}

      {result.kind === "success" && (
        <div className="mt-8 space-y-6 rounded-xl border border-emerald-300/60 bg-emerald-50/60 p-6 shadow-sm dark:bg-emerald-950/30">
          <div className="space-y-1">
            <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
              Coupon redeemed
            </p>
            <h2 className="text-2xl font-bold">Your activation key</h2>
            <p className="text-sm text-muted-foreground">
              Open Gap Map → Settings → Licence (or onboarding step 6) and paste this key.
              {result.isTrial && result.expiresAt ? (
                <>
                  {" "}
                  Trial expires{" "}
                  <strong>{new Date(result.expiresAt).toLocaleDateString()}</strong>.
                </>
              ) : null}
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <code className="flex-1 select-all rounded-md border border-border bg-background px-3 py-2 font-mono text-base tracking-wider">
              {result.activationKey}
            </code>
            <button
              type="button"
              onClick={() => copyKey(result.activationKey)}
              className="inline-flex items-center justify-center rounded-md border border-input bg-background px-3 py-2 text-sm font-medium shadow-sm transition hover:bg-accent"
            >
              Copy
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href={ROUTES.dashboard}
              className="inline-flex items-center rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              View licence in dashboard
            </Link>
            <Link
              href={ROUTES.activate}
              className="inline-flex items-center rounded-md border border-input bg-background px-3 py-2 text-sm font-medium hover:bg-accent"
            >
              Open Gap Map activation help
            </Link>
          </div>
        </div>
      )}
    </main>
  );
}
