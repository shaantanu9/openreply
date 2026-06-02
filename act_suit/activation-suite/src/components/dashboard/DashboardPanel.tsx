"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { getUserDisplayName, useSession } from "@/hooks/use-session";
import { ROUTES } from "@/lib/constants";
import {
  deactivateDeviceWeb,
  fetchLicenceMe,
  getFreeKey,
  openBillingPortal,
  startTrial,
  type DeviceSummary,
  type LicenceSummary,
} from "@/lib/licenceClient";
import { openLemonSqueezyCheckout } from "@/lib/lemonSqueezy";
import type { Features } from "@/lib/features";

// Free mode (default): hide paid buttons, show the free-key flow. Flip
// NEXT_PUBLIC_BILLING_ENABLED=1 to turn paid billing UI back on.
const BILLING_ON = ["1", "true", "yes", "on"].includes(
  (process.env.NEXT_PUBLIC_BILLING_ENABLED || "").trim().toLowerCase(),
);

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
  const [freeKey, setFreeKey] = useState<string | null>(null); // full key, shown once
  const [copied, setCopied] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchLicenceMe();
      setLicence(res.licence);
      setFeatures(res.features);
      // Free mode: auto-issue a key the first time a logged-in user with no
      // licence lands here, and show it once so they can copy it.
      if (!BILLING_ON && !res.licence) {
        try {
          const free = await getFreeKey();
          if (free.activation_key) setFreeKey(free.activation_key);
          const after = await fetchLicenceMe();
          setLicence(after.licence);
          setFeatures(after.features);
        } catch {
          /* surfaced via the manual button */
        }
      }
    } catch (err) {
      setBanner({ kind: "error", msg: err instanceof Error ? err.message : String(err) });
    } finally {
      setLoading(false);
    }
  }, []);

  async function handleGetKey() {
    setActing("free");
    setBanner(null);
    try {
      const free = await getFreeKey();
      if (free.activation_key) {
        setFreeKey(free.activation_key);
        setBanner({ kind: "success", msg: "Here's your key — copy it and paste it into the desktop app." });
      } else {
        setBanner({
          kind: "info",
          msg: free.message || "You already have a key (shown once at sign-up). Reissue if you've lost it.",
        });
      }
      await reload();
    } catch (err) {
      setBanner({ kind: "error", msg: err instanceof Error ? err.message : String(err) });
    } finally {
      setActing(null);
    }
  }

  async function copyKey(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setBanner({ kind: "info", msg: "Copy failed — select the key and copy manually." });
    }
  }

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
      const res = await startTrial();
      setBanner({
        kind: "success",
        msg: `Trial started — ${res.trial_days} days. Your activation key is ${res.activation_key}. Open the desktop app to activate.`,
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
              Manage your plan, devices, and billing here.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={ROUTES.activate} className="btn-sm">
              Activate another device
            </Link>
            <Link href={ROUTES.activationHelp} className="btn-sm">
              Help
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

        {/* License key (free mode) */}
        {!BILLING_ON ? (
          <section className="mb-8 rounded-[24px] border border-[var(--border-strong)] bg-white px-8 py-7">
            <div className="text-[13px] uppercase tracking-[0.08em] text-[var(--muted-light)]">
              Your license key
            </div>
            {freeKey ? (
              <>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <code className="select-all rounded-[10px] border border-[var(--border)] bg-[var(--cream-mid)] px-4 py-3 font-mono text-[18px] tracking-[2px] text-[var(--dark)]">
                    {freeKey}
                  </code>
                  <button type="button" onClick={() => copyKey(freeKey)} className="btn-sm orange">
                    {copied ? "Copied ✓" : "Copy key"}
                  </button>
                </div>
                <p className="mt-3 text-[13px] text-[var(--muted)]">
                  We show the full key only once — keep it safe.
                </p>
              </>
            ) : licence ? (
              <div className="mt-2 text-[15px] text-[var(--dark)]">
                Active — key ends in{" "}
                <code className="font-mono">{licence.activationKeyPreview ?? "••••"}</code>
                <p className="mt-2 text-[13px] font-normal text-[var(--muted)]">
                  Your full key was shown once at issue. Activate the desktop app with it + your sign-in email.
                </p>
              </div>
            ) : (
              <>
                <p className="mt-2 text-[13px] text-[var(--muted)]">
                  Get your free key, then paste it into the desktop app to activate this machine.
                </p>
                <button
                  type="button"
                  onClick={handleGetKey}
                  disabled={acting === "free"}
                  className="btn-sm orange mt-3"
                >
                  {acting === "free" ? "Getting…" : "Get my free key"}
                </button>
              </>
            )}
            <ol className="mt-5 grid list-decimal gap-1 pl-5 text-[13px] text-[var(--muted)]">
              <li>Download &amp; open the Gap Map desktop app.</li>
              <li>On the activation screen, paste your key + the email you signed in with.</li>
              <li>The machine then appears under “Activated devices” below.</li>
            </ol>
          </section>
        ) : null}

        {/* Plan summary */}
        <section className="mb-8 flex flex-col items-start gap-6 rounded-[24px] border border-[var(--border-strong)] bg-white px-8 py-7 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-[13px] uppercase tracking-[0.08em] text-[var(--muted-light)]">
              Current plan
            </div>
            <div className="mt-1 text-[22px] font-medium text-[var(--dark)]">
              {loading
                ? "Loading…"
                : licence
                ? prettyPlan(licence.planId, licence.livePassActive, licence.isTrial)
                : "Free — no licence"}
            </div>
            <div className="mt-1 text-[13px] text-[var(--muted)]">
              {licence ? (
                <>
                  {licence.devices.length} of {licence.maxDevices} device
                  {licence.maxDevices === 1 ? "" : "s"} used
                  {licence.activationKeyPreview
                    ? <> · key ends in <code className="font-mono text-[12px]">{licence.activationKeyPreview}</code></>
                    : null}
                </>
              ) : features ? (
                `Upgrade to unlock ${features.max_workspaces === null ? "unlimited" : features.max_workspaces + ""} workspaces, PDF/CSV export, and the scheduler.`
              ) : null}
            </div>
          </div>
          {BILLING_ON ? (
            <div className="flex flex-wrap gap-2">
              {licence && !licence.isTrial ? null : (
                <button
                  type="button"
                  onClick={handleStartTrial}
                  disabled={acting === "trial" || (licence?.isTrial ?? false)}
                  className="btn-sm"
                >
                  {licence?.isTrial ? "Trial active" : acting === "trial" ? "Starting…" : "Start Pro trial"}
                </button>
              )}
              <button
                type="button"
                onClick={() => openLemonSqueezyCheckout("pro")}
                className="btn-sm orange"
              >
                Upgrade to Pro
              </button>
              <button
                type="button"
                onClick={() => openLemonSqueezyCheckout("live_pass")}
                className="btn-sm"
              >
                Add Live Pass
              </button>
            </div>
          ) : (
            <span className="rounded-full bg-[var(--orange-pale)] px-3 py-1 text-[12px] font-medium text-[var(--orange)]">
              Free while in beta
            </span>
          )}
        </section>

        {trial ? (
          <section className="mb-8 rounded-[16px] border border-[rgba(224,123,60,0.2)] bg-[var(--orange-pale)] px-6 py-4">
            <div className="mb-[10px] flex items-center justify-between">
              <p className="text-[13.5px] font-medium text-[var(--dark)]">
                Pro trial active — {trial.daysLeft} day{trial.daysLeft === 1 ? "" : "s"} remaining
              </p>
              <span className="text-[13px] font-medium text-[var(--orange)]">
                Ends {formatDate(licence?.trialEndsAt ?? null)}
              </span>
            </div>
            <div className="h-[6px] rounded-full bg-[rgba(224,123,60,0.15)]">
              <div
                className="h-[6px] rounded-full bg-[var(--orange)] transition-all duration-500"
                style={{ width: `${Math.max(5, trial.pct)}%` }}
              />
            </div>
          </section>
        ) : null}

        {/* Devices */}
        <section className="mb-8 rounded-[24px] border border-[var(--border-strong)] bg-white p-7">
          <div className="mb-1 flex items-center justify-between">
            <div className="text-[14px] font-medium text-[var(--dark)]">
              Activated devices
            </div>
            <span className="text-[12px] text-[var(--muted-light)]">
              {licence ? `${licence.devices.length} / ${licence.maxDevices}` : ""}
            </span>
          </div>
          <div className="mb-5 text-[13px] leading-[1.5] text-[var(--muted)]">
            Deactivate here to free a slot. Device slots replenish immediately.
          </div>
          {loading ? (
            <div className="rounded-[10px] border border-dashed border-[var(--border)] bg-[var(--cream-mid)] px-4 py-6 text-center text-[13px] text-[var(--muted)]">
              Loading…
            </div>
          ) : !licence || licence.devices.length === 0 ? (
            <div className="rounded-[10px] border border-dashed border-[var(--border)] bg-[var(--cream-mid)] px-4 py-6 text-center text-[13px] text-[var(--muted)]">
              No devices activated yet. Open the desktop app and paste your key to activate this machine.
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

        {/* Billing + feature summary */}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {BILLING_ON ? (
            <section className="rounded-[24px] border border-[var(--border-strong)] bg-white p-7">
              <div className="mb-1 text-[14px] font-medium text-[var(--dark)]">
                Billing
              </div>
              <div className="mb-5 text-[13px] leading-[1.5] text-[var(--muted)]">
                Manage your subscription, download invoices, and update your payment method via the Lemon Squeezy customer portal.
              </div>
              <button
                type="button"
                onClick={handleBillingPortal}
                disabled={acting === "billing"}
                className="btn-sm orange w-full justify-center"
              >
                {acting === "billing" ? "Opening…" : "Open billing portal →"}
              </button>
              {licence?.expiresAt ? (
                <p className="mt-3 text-[12px] text-[var(--muted-light)]">
                  Subscription renews on <strong>{formatDate(licence.expiresAt)}</strong>.
                </p>
              ) : null}
            </section>
          ) : null}

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
      </main>
    </div>
  );
}
