"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { getUserDisplayName, useSession } from "@/hooks/use-session";
import { ROUTES } from "@/lib/constants";
import {
  deactivateDeviceWeb,
  fetchLicenceMe,
  openBillingPortal,
  startTrial,
  type DeviceSummary,
  type LicenceSummary,
} from "@/lib/licenceClient";
import { openLemonSqueezyCheckout } from "@/lib/lemonSqueezy";
import type { Features } from "@/lib/features";

type Banner =
  | { kind: "error" | "info" | "success"; msg: string }
  | null;

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function prettyPlan(planId: string, livePass: boolean, isTrial: boolean): string {
  if (isTrial) return "Pro — trial";
  switch (planId) {
    case "pro":
      return livePass ? "Pro + Live Pass" : "Pro";
    case "live_pass":
      return "Pro + Live Pass";
    case "team":
      return "Team";
    case "pro_trial":
      return "Pro — trial";
    default:
      return "Free";
  }
}

function trialBanner(lic: LicenceSummary | null): { pct: number; daysLeft: number } | null {
  if (!lic || !lic.isTrial || !lic.trialEndsAt) return null;
  const endMs = new Date(lic.trialEndsAt).getTime();
  const now = Date.now();
  if (endMs <= now) return null;
  const daysLeft = Math.max(1, Math.ceil((endMs - now) / 86_400_000));
  const startApprox = lic.createdAt ? new Date(lic.createdAt).getTime() : endMs - 14 * 86_400_000;
  const total = Math.max(1, endMs - startApprox);
  const used = Math.max(0, Math.min(total, now - startApprox));
  const pct = Math.round(((total - used) / total) * 100);
  return { pct, daysLeft };
}

export function DashboardPanel() {
  const router = useRouter();
  const { user, status } = useSession();

  const [licence, setLicence] = useState<LicenceSummary | null>(null);
  const [features, setFeatures] = useState<Features | null>(null);
  const [banner, setBanner] = useState<Banner>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchLicenceMe();
      setLicence(res.licence);
      setFeatures(res.features);
    } catch (err) {
      setBanner({ kind: "error", msg: err instanceof Error ? err.message : String(err) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === "ready" && !user) {
      router.replace(ROUTES.signIn);
      return;
    }
    if (status === "ready" && user) {
      reload().catch(() => undefined);
    }
  }, [status, user, router, reload]);

  async function handleStartTrial() {
    setActing("trial");
    setBanner(null);
    try {
      await startTrial();
      setBanner({
        kind: "success",
        msg: `Trial started. Your activation key is ready below — copy it and paste into Gap Map.`,
      });
      await reload();
    } catch (err) {
      setBanner({ kind: "error", msg: err instanceof Error ? err.message : String(err) });
    } finally {
      setActing(null);
    }
  }

  async function handleDeactivate(device: DeviceSummary) {
    if (!window.confirm(`Deactivate ${device.os}/${device.arch}? The device will need to re-activate to use Gap Map again.`))
      return;
    setActing(device.signatureHash);
    setBanner(null);
    try {
      const removed = await deactivateDeviceWeb(device.signatureHash);
      if (removed) {
        setBanner({ kind: "success", msg: "Device deactivated." });
      } else {
        setBanner({ kind: "info", msg: "Device was already detached." });
      }
      await reload();
    } catch (err) {
      setBanner({ kind: "error", msg: err instanceof Error ? err.message : String(err) });
    } finally {
      setActing(null);
    }
  }

  async function handleBillingPortal() {
    setActing("billing");
    setBanner(null);
    try {
      const url = await openBillingPortal();
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setBanner({ kind: "error", msg: err instanceof Error ? err.message : String(err) });
    } finally {
      setActing(null);
    }
  }

  async function copyKey() {
    if (!licence?.activationKey) return;
    try {
      await navigator.clipboard.writeText(licence.activationKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* select-all fallback works in the UI */
    }
  }

  const name = getUserDisplayName(user) || user?.email || "";
  const trial = trialBanner(licence);

  return (
    <div className="min-h-screen bg-[var(--cream)]">
      <main className="mx-auto max-w-[960px] px-8 py-14">
        <div className="mb-10 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="font-serif text-[36px] font-normal leading-tight tracking-[-1px] text-[var(--dark)]">
              <em className="italic text-[var(--orange)]">Dashboard</em>
            </h1>
            <p className="mt-2 max-w-[480px] text-[15px] font-light text-[var(--muted)]">
              Signed in as <strong className="font-medium text-[var(--dark)]">{name}</strong>.
              {licence
                ? " Your activation key, devices, and billing live here."
                : " Pick a path below to get your Gap Map activation key."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={ROUTES.activationHelp} className="btn-sm">
              Activation help
            </Link>
          </div>
        </div>

        {banner ? (
          <div
            role="status"
            className={`mb-6 rounded-[10px] border px-[14px] py-3 text-[13.5px] ${
              banner.kind === "error"
                ? "border-[#F5C5C0] bg-[#FDF0EF] text-[#C0392B]"
                : banner.kind === "success"
                ? "border-[#9FE1CB] bg-[#EDF8F1] text-[#0F6E56]"
                : "border-[rgba(224,123,60,0.2)] bg-[var(--orange-pale)] text-[var(--orange)]"
            }`}
          >
            {banner.msg}
          </div>
        ) : null}

        {/* ── Top: either KEY-CARD (has licence) or GET-KEY-PATHS (no licence) ── */}
        {loading ? (
          <section className="mb-8 rounded-[24px] border border-[var(--border-strong)] bg-white p-7 text-center text-[14px] text-[var(--muted)]">
            Loading your licence…
          </section>
        ) : licence ? (
          /* ─── Has licence → KEY CARD ─── */
          <section className="mb-8 overflow-hidden rounded-[24px] border-2 border-[var(--orange)] bg-white">
            <div className="bg-[var(--orange-pale)] px-7 py-3">
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-medium uppercase tracking-[0.08em] text-[var(--orange)]">
                  Your activation key
                </span>
                <span className="text-[12px] font-medium text-[var(--orange)]">
                  Plan: {prettyPlan(licence.planId, licence.livePassActive, licence.isTrial)}
                </span>
              </div>
            </div>
            <div className="px-7 py-7">
              {licence.activationKey ? (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <code className="block flex-1 select-all rounded-[10px] border border-[var(--border-strong)] bg-[var(--cream-mid)] px-4 py-3 text-center font-mono text-[18px] tracking-[0.12em] text-[var(--dark)]">
                    {licence.activationKey}
                  </code>
                  <button
                    type="button"
                    onClick={copyKey}
                    className="btn-sm orange justify-center whitespace-nowrap"
                  >
                    {copied ? "✓ Copied" : "Copy key"}
                  </button>
                </div>
              ) : (
                <div className="rounded-[10px] border border-[var(--border)] bg-[var(--cream-mid)] px-4 py-4 text-center text-[14px] text-[var(--muted)]">
                  Your key is unavailable to show here. Check the email you got when you signed
                  up, or contact support to reissue.
                </div>
              )}
              <div className="mt-5 rounded-[10px] border border-dashed border-[var(--border)] bg-[var(--cream-mid)] px-5 py-4 text-[13px] leading-[1.7] text-[var(--muted)]">
                <p className="mb-2 font-medium text-[var(--dark)]">
                  How to activate Gap Map on your computer:
                </p>
                <ol className="list-decimal space-y-1 pl-5">
                  <li>Open <strong>Gap Map.app</strong> on your Mac.</li>
                  <li>Onboarding step 6 (or Settings → Licence) opens the activation form.</li>
                  <li>Email + password are the ones you signed in with here.</li>
                  <li>Paste the key above into the <strong>Activation key</strong> field.</li>
                  <li>Click <strong>Activate &amp; continue →</strong>. Gap Map verifies the
                      key against gapmap.myind.ai and stores it on this device.</li>
                </ol>
              </div>
              <div className="mt-4 flex flex-wrap gap-3 text-[13px] text-[var(--muted)]">
                <span>
                  <strong className="text-[var(--dark)]">
                    {licence.devices.length} / {licence.maxDevices}
                  </strong>{" "}
                  device slot{licence.maxDevices === 1 ? "" : "s"} used
                </span>
                {licence.expiresAt ? (
                  <span>
                    · Renews <strong className="text-[var(--dark)]">{formatDate(licence.expiresAt)}</strong>
                  </span>
                ) : null}
                {licence.isTrial && licence.trialEndsAt ? (
                  <span>
                    · Trial ends{" "}
                    <strong className="text-[var(--dark)]">{formatDate(licence.trialEndsAt)}</strong>
                  </span>
                ) : null}
              </div>
            </div>
          </section>
        ) : (
          /* ─── No licence → THREE PATHS ─── */
          <section className="mb-8">
            <div className="mb-5 rounded-[24px] border border-[var(--border-strong)] bg-white px-7 py-6 text-center">
              <h2 className="font-serif text-[26px] font-normal leading-tight tracking-[-0.5px] text-[var(--dark)]">
                Get your Gap Map activation key
              </h2>
              <p className="mx-auto mt-2 max-w-[520px] text-[14px] text-[var(--muted)]">
                Three ways to get a key. Each issues a key bound to{" "}
                <strong className="text-[var(--dark)]">{name}</strong> that you paste into the
                desktop app.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
              {/* Trial card */}
              <div className="flex flex-col rounded-[18px] border border-[var(--border-strong)] bg-white p-6">
                <div className="mb-1 text-[12px] font-medium uppercase tracking-[0.08em] text-[var(--muted-light)]">
                  Trial
                </div>
                <h3 className="font-serif text-[18px] font-medium text-[var(--dark)]">
                  Start a 14-day Pro trial
                </h3>
                <p className="mt-2 flex-1 text-[13px] leading-[1.6] text-[var(--muted)]">
                  Full Pro features for 14 days. No credit card. One trial per email.
                </p>
                <button
                  type="button"
                  onClick={handleStartTrial}
                  disabled={acting === "trial"}
                  className="btn-sm mt-4 justify-center"
                >
                  {acting === "trial" ? "Starting…" : "Start free trial →"}
                </button>
              </div>

              {/* Buy card */}
              <div className="flex flex-col rounded-[18px] border-2 border-[var(--orange)] bg-white p-6">
                <div className="mb-1 text-[12px] font-medium uppercase tracking-[0.08em] text-[var(--orange)]">
                  Buy
                </div>
                <h3 className="font-serif text-[18px] font-medium text-[var(--dark)]">
                  Buy a Pro licence
                </h3>
                <p className="mt-2 flex-1 text-[13px] leading-[1.6] text-[var(--muted)]">
                  Pro on multiple devices, optional Live Pass for cloud sync. Lemon Squeezy checkout — instant key issuance.
                </p>
                <div className="mt-4 flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => openLemonSqueezyCheckout("pro")}
                    className="btn-sm orange justify-center"
                  >
                    Upgrade to Pro →
                  </button>
                  <button
                    type="button"
                    onClick={() => openLemonSqueezyCheckout("live_pass")}
                    className="btn-sm justify-center"
                  >
                    Add Live Pass
                  </button>
                </div>
              </div>

              {/* Coupon card */}
              <div className="flex flex-col rounded-[18px] border border-[var(--border-strong)] bg-white p-6">
                <div className="mb-1 text-[12px] font-medium uppercase tracking-[0.08em] text-[var(--muted-light)]">
                  Coupon
                </div>
                <h3 className="font-serif text-[18px] font-medium text-[var(--dark)]">
                  Redeem a coupon code
                </h3>
                <p className="mt-2 flex-1 text-[13px] leading-[1.6] text-[var(--muted)]">
                  Have an early-access or partner code? Redeem it for a free activation key.
                </p>
                <Link
                  href={ROUTES.redeem}
                  className="btn-sm mt-4 justify-center"
                >
                  Redeem coupon →
                </Link>
              </div>
            </div>
            <p className="mt-4 text-center text-[12.5px] text-[var(--muted-light)]">
              Need help picking?{" "}
              <Link href={ROUTES.pricing} className="underline hover:text-[var(--orange)]">
                Compare plans on the pricing page →
              </Link>
            </p>
          </section>
        )}

        {trial ? (
          <section className="mb-8 rounded-[16px] border border-[rgba(224,123,60,0.2)] bg-[var(--orange-pale)] px-6 py-4">
            <div className="mb-[10px] flex items-center justify-between">
              <p className="text-[13.5px] font-medium text-[var(--dark)]">
                Pro trial active — {trial.daysLeft} day{trial.daysLeft === 1 ? "" : "s"} remaining
              </p>
              <button
                type="button"
                onClick={() => openLemonSqueezyCheckout("pro")}
                className="text-[13px] font-medium text-[var(--orange)] hover:underline"
              >
                Upgrade to keep your key →
              </button>
            </div>
            <div className="h-[6px] rounded-full bg-[rgba(224,123,60,0.15)]">
              <div
                className="h-[6px] rounded-full bg-[var(--orange)] transition-all duration-500"
                style={{ width: `${Math.max(5, trial.pct)}%` }}
              />
            </div>
          </section>
        ) : null}

        {/* Devices (only shown after activation) */}
        {licence ? (
          <section className="mb-8 rounded-[24px] border border-[var(--border-strong)] bg-white p-7">
            <div className="mb-1 flex items-center justify-between">
              <div className="text-[14px] font-medium text-[var(--dark)]">
                Activated devices
              </div>
              <span className="text-[12px] text-[var(--muted-light)]">
                {licence.devices.length} / {licence.maxDevices}
              </span>
            </div>
            <div className="mb-5 text-[13px] leading-[1.5] text-[var(--muted)]">
              Deactivate here to free a slot. Device slots replenish immediately.
            </div>
            {licence.devices.length === 0 ? (
              <div className="rounded-[10px] border border-dashed border-[var(--border)] bg-[var(--cream-mid)] px-4 py-6 text-center text-[13px] text-[var(--muted)]">
                No devices activated yet. Paste the key above into the Gap Map desktop app to
                activate this machine.
              </div>
            ) : (
              <ul className="flex flex-col gap-2">
                {licence.devices.map((d) => (
                  <li
                    key={d.signatureHash}
                    className="flex items-center justify-between rounded-[10px] border border-[var(--border)] bg-[var(--cream-mid)] px-[14px] py-3"
                  >
                    <div>
                      <div className="text-[13px] font-medium text-[var(--dark)]">
                        {d.os || "unknown"} · {d.arch || "unknown"}
                      </div>
                      <div className="text-[11px] text-[var(--muted-light)]">
                        Activated {formatDate(d.activatedAt)} · last seen {formatDate(d.lastSeenAt)} · fingerprint{" "}
                        <code className="font-mono">{d.signatureHash.slice(0, 12)}…</code>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDeactivate(d)}
                      disabled={acting === d.signatureHash}
                      className="text-[12px] font-medium text-[var(--orange)] hover:underline disabled:opacity-50"
                    >
                      {acting === d.signatureHash ? "Deactivating…" : "Deactivate"}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}

        {/* Billing + features (only shown after activation) */}
        {licence ? (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <section className="rounded-[24px] border border-[var(--border-strong)] bg-white p-7">
              <div className="mb-1 text-[14px] font-medium text-[var(--dark)]">
                Billing
              </div>
              <div className="mb-5 text-[13px] leading-[1.5] text-[var(--muted)]">
                Manage your subscription, download invoices, and update your payment method via
                the Lemon Squeezy customer portal.
              </div>
              <button
                type="button"
                onClick={handleBillingPortal}
                disabled={acting === "billing"}
                className="btn-sm orange w-full justify-center"
              >
                {acting === "billing" ? "Opening…" : "Open billing portal →"}
              </button>
              {licence.expiresAt ? (
                <p className="mt-3 text-[12px] text-[var(--muted-light)]">
                  Subscription renews on <strong>{formatDate(licence.expiresAt)}</strong>.
                </p>
              ) : null}
            </section>

            <section className="rounded-[24px] border border-[var(--border-strong)] bg-white p-7">
              <div className="mb-1 text-[14px] font-medium text-[var(--dark)]">
                What&rsquo;s unlocked
              </div>
              <div className="mb-5 text-[13px] leading-[1.5] text-[var(--muted)]">
                Your current plan unlocks these capabilities in the desktop app.
              </div>
              {features ? (
                <ul className="grid grid-cols-1 gap-[6px] text-[13px]">
                  {[
                    ["Workspaces", features.max_workspaces === null ? "Unlimited" : `${features.max_workspaces}`],
                    ["Sources", features.max_sources === null ? "Unlimited" : `${features.max_sources}`],
                    ["Scheduler", features.scheduler ? "Enabled" : "—"],
                    ["Monitors", features.monitors ? "Enabled" : "—"],
                    ["PDF export", features.export_pdf ? "Enabled" : "—"],
                    ["CSV export", features.export_csv ? "Enabled" : "—"],
                    ["History", `${features.history_days} days`],
                    ["Devices", `${features.max_devices}`],
                  ].map(([k, v]) => (
                    <li
                      key={k}
                      className="flex items-center justify-between border-b border-[var(--border)] py-[6px] last:border-b-0"
                    >
                      <span className="text-[var(--muted)]">{k}</span>
                      <span className="font-medium text-[var(--dark)]">{v}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="text-[13px] text-[var(--muted)]">Loading…</div>
              )}
            </section>
          </div>
        ) : null}
      </main>
    </div>
  );
}
