"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatActivationKey, isValidActivationKey, normalizeActivationKey } from "@/lib/activationKey";
import { activateLicenseWeb, checkActivationService } from "@/lib/activateClient";
import { mapActivationError } from "@/lib/activationErrors";
import {
  openLemonSqueezyCheckout,
  openLemonSqueezyCustomerPortal,
} from "@/lib/lemonSqueezy";
import { getPublicEnv } from "@/lib/publicEnv";
import { getUserDisplayName, useSession } from "@/hooks/use-session";
import { ROUTES } from "@/lib/constants";
import {
  deactivateDeviceWeb,
  fetchLicenceMe,
  startTrial,
  type LicenceSummary,
} from "@/lib/licenceClient";

type Alert = { msg: string; type: "error" | "info" | "success" } | null;

type DeviceRow = {
  key: string;
  name: string;
  meta: string;
  status: "current" | "active";
  signatureHash: string;
};

function formatExpiryDate(expiresAt: string | null): string {
  if (!expiresAt) return "never";
  try {
    const d = new Date(expiresAt);
    return d.toLocaleDateString(undefined, {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return expiresAt;
  }
}

function DeviceIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="2" y="3" width="12" height="9" rx="1.5" stroke="#6B6259" strokeWidth="1.2" />
      <path d="M5 14h6M8 12v2" stroke="#6B6259" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden>
      <path
        d="M11 3L5 6v6c0 4 3 7.5 6 8.5 3-1 6-4.5 6-8.5V6L11 3Z"
        stroke="#E07B3C"
        strokeWidth="1.4"
      />
      <path
        d="M8 11l2.5 2.5L15 8.5"
        stroke="#E07B3C"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function devicesFromLicence(lic: LicenceSummary | null): DeviceRow[] {
  if (!lic) return [];
  return lic.devices.map((d, idx) => ({
    key: d.signatureHash || `${idx}`,
    name: `${d.os || "unknown"} · ${d.arch || "unknown"}`,
    meta: `Activated ${formatExpiryDate(d.activatedAt)} · last seen ${formatExpiryDate(d.lastSeenAt)}`,
    status: idx === 0 ? "current" : "active",
    signatureHash: d.signatureHash,
  }));
}

function planLabel(lic: LicenceSummary | null): string {
  if (!lic) return "Free — no licence yet";
  if (lic.isTrial) return "Pro — trial active";
  if (lic.planId === "team") return "Team plan";
  if (lic.livePassActive || lic.planId === "live_pass") return "Pro + Live Pass";
  if (lic.planId === "pro") return "Pro — perpetual licence";
  return "Free";
}

function planMetaHtml(lic: LicenceSummary | null): string {
  if (!lic) return "Activate a key or start a 14-day trial to unlock the desktop app.";
  const used = `${lic.devices.length} of ${lic.maxDevices} device${lic.maxDevices === 1 ? "" : "s"} used`;
  if (lic.isTrial && lic.trialEndsAt) {
    return `Trial expires <strong>${formatExpiryDate(lic.trialEndsAt)}</strong> · ${used}`;
  }
  if (lic.expiresAt) {
    return `Renews <strong>${formatExpiryDate(lic.expiresAt)}</strong> · ${used}`;
  }
  return `${used}`;
}

export function ActivatePanel() {
  const router = useRouter();
  const { user, status } = useSession();
  const [keyInput, setKeyInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<Alert>({
    msg: "Flow: sign in → buy/start trial → enter activation key → open desktop app.",
    type: "info",
  });
  const [activated, setActivated] = useState(false);
  const [jwt, setJwt] = useState("");
  const [copied, setCopied] = useState(false);
  const [licence, setLicence] = useState<LicenceSummary | null>(null);
  const [licenceLoading, setLicenceLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);

  const reloadLicence = useCallback(async () => {
    setLicenceLoading(true);
    try {
      const res = await fetchLicenceMe();
      setLicence(res.licence);
    } catch {
      /* leave licence null; happens when user isn't signed in yet */
    } finally {
      setLicenceLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === "ready" && !user) {
      router.replace(ROUTES.signIn);
      return;
    }
    if (status === "ready" && user) {
      reloadLicence().catch(() => undefined);
    }
  }, [status, user, router, reloadLicence]);

  const desktopLinks = useMemo(() => {
    const env = getPublicEnv();
    return {
      deepLink: (env.appDeepLinkUrl || "gapmap://dashboard").trim(),
      downloadUrl: env.appDownloadUrl.trim(),
    };
  }, []);

  const normalized = normalizeActivationKey(keyInput);
  const keyReady = normalized.length === 16;

  function showAlert(msg: string, type: "error" | "info" | "success") {
    setAlert({ msg, type });
  }

  function onKeyChange(e: React.ChangeEvent<HTMLInputElement>) {
    setKeyInput(formatActivationKey(e.target.value));
  }

  async function pasteKey() {
    try {
      const t = await navigator.clipboard.readText();
      setKeyInput(formatActivationKey(t));
    } catch {
      /* ignore */
    }
  }

  async function handleActivate() {
    if (!isValidActivationKey(keyInput)) {
      showAlert("Use key format XXXX-XXXX-XXXX-XXXX (A-Z and 2-9).", "error");
      return;
    }
    setBusy(true);
    showAlert("Activating…", "info");
    try {
      const result = await activateLicenseWeb(keyInput);
      setJwt(result.token);
      setActivated(true);
      showAlert("Licence activated. Open Gap Map desktop app now.", "success");
      await reloadLicence();
    } catch (err) {
      showAlert(mapActivationError(err instanceof Error ? err.message : String(err)), "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleStartTrial() {
    setActing("trial");
    try {
      const res = await startTrial();
      showAlert(
        `Trial started — ${res.trial_days} days. Your activation key is ${res.activation_key}. Paste it above to activate this browser.`,
        "success",
      );
      setKeyInput(formatActivationKey(res.activation_key));
      await reloadLicence();
    } catch (err) {
      showAlert(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setActing(null);
    }
  }

  async function handleDeactivate(device: DeviceRow) {
    if (!window.confirm(`Deactivate ${device.name}?`)) return;
    setActing(device.signatureHash);
    try {
      await deactivateDeviceWeb(device.signatureHash);
      showAlert("Device deactivated.", "success");
      await reloadLicence();
    } catch (err) {
      showAlert(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setActing(null);
    }
  }

  async function handleCheckService() {
    try {
      const ok = await checkActivationService();
      if (ok) {
        showAlert("Activation service is reachable. You can activate now.", "info");
      } else {
        showAlert(
          "Activation service check failed. Verify NEXT_PUBLIC_LICENSE_API_BASE + API uptime + CORS.",
          "error",
        );
      }
    } catch (err) {
      showAlert(mapActivationError(err instanceof Error ? err.message : String(err)), "error");
    }
  }

  function handleUpgrade() {
    if (!openLemonSqueezyCheckout("pro")) {
      showAlert(
        "Set NEXT_PUBLIC_LEMONSQUEEZY_CHECKOUT_PRO (full Lemon Squeezy checkout link for Pro).",
        "info",
      );
    }
  }

  function handleLivePass() {
    if (!openLemonSqueezyCheckout("live_pass")) {
      showAlert(
        "Set NEXT_PUBLIC_LEMONSQUEEZY_CHECKOUT_LIVE_PASS (Live Pass checkout link).",
        "info",
      );
    }
  }

  function handlePortal() {
    if (!openLemonSqueezyCustomerPortal()) {
      showAlert(
        "Set NEXT_PUBLIC_LEMONSQUEEZY_CUSTOMER_PORTAL (Lemon Squeezy customer portal URL).",
        "info",
      );
    }
  }

  function copyToken() {
    if (!jwt) return;
    navigator.clipboard.writeText(jwt).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function openDesktopApp() {
    if (!desktopLinks.deepLink) {
      showAlert(
        "Desktop deep-link not configured. Use Download desktop app instead.",
        "info",
      );
      return;
    }
    try {
      window.location.href = desktopLinks.deepLink;
      setTimeout(() => {
        if (desktopLinks.downloadUrl) {
          showAlert(
            "If app did not open, install/update desktop app from the download link.",
            "info",
          );
        } else {
          showAlert(
            "If app did not open, install Gap Map desktop app and retry.",
            "info",
          );
        }
      }, 1200);
    } catch {
      showAlert("Could not trigger desktop app link.", "error");
    }
  }

  function downloadDesktopApp() {
    if (!desktopLinks.downloadUrl) {
      showAlert(
        "NEXT_PUBLIC_APP_DOWNLOAD_URL is not set. Ask support for the latest desktop download link.",
        "info",
      );
      return;
    }
    window.open(desktopLinks.downloadUrl, "_blank", "noopener,noreferrer");
  }

  function resendKeyHelp() {
    const email = user?.email || "";
    const subject = encodeURIComponent("Gap Map activation key help");
    const body = encodeURIComponent(
      `Hi Gap Map support,\n\nI need help with activation key delivery/resend.\nAccount email: ${
        email || "[your email]"
      }\nIssue: [did not receive key / key not working]\n\nThanks.`,
    );
    window.location.href = `mailto:support@gapmap.app?subject=${subject}&body=${body}`;
  }

  const name = getUserDisplayName(user) || "Gap Map user";
  const devices = devicesFromLicence(licence);
  const maxDevices = licence?.maxDevices ?? 1;
  const slotsUsed = devices.length;
  const slots = Array.from({ length: Math.max(maxDevices, 1) }, (_, i) => i < slotsUsed);

  // Trial banner
  const trialMs =
    licence?.isTrial && licence.trialEndsAt
      ? new Date(licence.trialEndsAt).getTime() - Date.now()
      : 0;
  const trialDaysLeft = Math.max(0, Math.ceil(trialMs / (1000 * 60 * 60 * 24)));
  const trialTotal = 14;
  const trialPct = Math.min(100, Math.max(0, Math.round((trialDaysLeft / trialTotal) * 100)));
  const showTrialBanner = Boolean(licence?.isTrial && licence.trialEndsAt);
  const showStartTrialCta = !licenceLoading && !licence;

  return (
    <div className="min-h-screen bg-[var(--cream)]">
      <main className="mx-auto max-w-[960px] px-8 py-14">
        <div className="mb-12">
          <h1 className="font-serif text-[36px] font-normal leading-tight tracking-[-1px] text-[var(--dark)]">
            Licence &amp; <em className="italic text-[var(--orange)]">activation</em>
          </h1>
          <p className="mt-2 max-w-[480px] text-[15px] font-light text-[var(--muted)]">
            Manage your plan, activate devices, and set up your BYOK API keys.
            All processing happens locally on your machine.
          </p>
        </div>

        {/* Plan Status */}
        <section className="mb-8 flex flex-col items-start gap-6 rounded-[24px] border border-[var(--border-strong)] bg-white px-8 py-7 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-5">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-[rgba(224,123,60,0.2)] bg-[var(--orange-pale)]">
              <ShieldIcon />
            </span>
            <div>
              <div className="text-[18px] font-medium text-[var(--dark)]">
                {licenceLoading ? "Loading licence…" : planLabel(licence)}
              </div>
              <div
                className="text-[13px] text-[var(--muted)]"
                dangerouslySetInnerHTML={{ __html: planMetaHtml(licence) }}
              />
              {name ? (
                <div className="mt-[2px] text-[12px] text-[var(--muted-light)]">
                  Signed in as {name}
                </div>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap gap-[10px]">
            <Link href="/#pricing" className="btn-sm">
              View plans
            </Link>
            {showStartTrialCta ? (
              <button
                type="button"
                className="btn-sm primary"
                onClick={handleStartTrial}
                disabled={acting === "trial"}
              >
                {acting === "trial" ? "Starting…" : "Start 14-day trial"}
              </button>
            ) : null}
            <button type="button" className="btn-sm orange" onClick={handleUpgrade}>
              Upgrade to Pro — $69
            </button>
          </div>
        </section>

        {showTrialBanner ? (
          <section className="mb-8 rounded-[16px] border border-[rgba(224,123,60,0.2)] bg-[var(--orange-pale)] px-6 py-4">
            <div className="mb-[10px] flex items-center justify-between">
              <p className="text-[13.5px] font-medium text-[var(--dark)]">
                Pro trial active — {trialDaysLeft} day{trialDaysLeft === 1 ? "" : "s"} remaining
              </p>
              <span className="text-[13px] font-medium text-[var(--orange)]">
                {trialDaysLeft} / {trialTotal} days left
              </span>
            </div>
            <div className="h-[6px] rounded-full bg-[rgba(224,123,60,0.15)]">
              <div
                className="h-[6px] rounded-full bg-[var(--orange)] transition-all duration-500"
                style={{ width: `${trialPct}%` }}
              />
            </div>
            <p className="mt-2 text-[12px] text-[var(--muted)]">
              Your trial includes all Pro features: unlimited workspaces, all 13
              sources, PDF export, and 1-year history. Upgrade before it ends
              to keep access.
            </p>
          </section>
        ) : null}

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {/* Activate key card */}
          <section className="rounded-[24px] border border-[var(--border-strong)] bg-white p-7">
            <div className="mb-1 text-[14px] font-medium text-[var(--dark)]">
              Activate a licence key
            </div>
            <div className="mb-5 text-[13px] leading-[1.5] text-[var(--muted)]">
              Activation is required before using Gap Map desktop. Enter your
              key from Lemon Squeezy email/portal. Keys are in the format{" "}
              <code className="rounded bg-[var(--cream-dark)] px-[5px] font-mono text-[11px]">
                XXXX-XXXX-XXXX-XXXX
              </code>
              .
            </div>
            <div className="relative mb-3">
              <input
                type="text"
                value={keyInput}
                onChange={onKeyChange}
                spellCheck={false}
                maxLength={19}
                placeholder="ABCD-EF23-4567-89JK"
                className="w-full rounded-[10px] border border-[var(--border-strong)] bg-[var(--cream-mid)] px-[14px] py-3 pr-16 font-mono text-[15px] uppercase tracking-[1px] text-[var(--dark)] outline-none transition-shadow focus:border-[var(--orange)] focus:shadow-[0_0_0_3px_rgba(224,123,60,0.12)]"
              />
              <button
                type="button"
                onClick={pasteKey}
                className="absolute right-3 top-1/2 -translate-y-1/2 bg-transparent text-[11.5px] font-medium text-[var(--orange)] hover:opacity-70"
              >
                Paste
              </button>
            </div>
            <p className="mb-4 text-[12px] text-[var(--muted-light)]">
              Format:{" "}
              <code className="rounded bg-[var(--cream-dark)] px-[5px] font-mono text-[11px]">
                XXXX-XXXX-XXXX-XXXX
              </code>{" "}
              — check your purchase email
            </p>
            <div className="mb-4 flex flex-wrap gap-x-4 gap-y-[6px] text-[12px]">
              <Link href={ROUTES.signIn} className="text-[var(--orange)] hover:underline">
                Sign in / create account
              </Link>
              <Link
                href={ROUTES.activationHelp}
                className="text-[var(--orange)] hover:underline"
              >
                Activation help
              </Link>
              <button
                type="button"
                onClick={handleCheckService}
                className="text-[var(--orange)] hover:underline"
              >
                Check activation service
              </button>
              <button
                type="button"
                onClick={handleUpgrade}
                className="text-[var(--orange)] hover:underline"
              >
                Buy Pro key
              </button>
              <button
                type="button"
                onClick={handlePortal}
                className="text-[var(--orange)] hover:underline"
              >
                Open customer portal
              </button>
              <button
                type="button"
                onClick={resendKeyHelp}
                className="text-[var(--orange)] hover:underline"
              >
                Didn&rsquo;t get key?
              </button>
            </div>
            <div className="mb-3 rounded-[10px] border border-[var(--border)] bg-[var(--cream-mid)] px-3 py-[10px]">
              <p className="mb-[6px] text-[12px] text-[var(--muted)]">After activation:</p>
              <ol className="ml-4 grid list-decimal gap-1 text-[12.5px] text-[var(--text)]">
                <li>Open Gap Map desktop app.</li>
                <li>Sign in with the same email.</li>
                <li>Your licence unlocks automatically on this device.</li>
              </ol>
            </div>
            <button
              type="button"
              onClick={handleActivate}
              disabled={!keyReady || busy}
              className={`flex w-full items-center justify-center gap-2 rounded-[10px] px-4 py-3 text-[14px] font-medium text-white transition-all ${
                activated
                  ? "bg-[var(--green)]"
                  : "bg-[var(--dark)] hover:bg-[var(--dark-mid)]"
              } disabled:pointer-events-none disabled:opacity-50`}
            >
              {activated
                ? "Activated ✓"
                : busy
                ? "Activating…"
                : "Activate licence"}
            </button>
            {alert ? (
              <div
                role="status"
                className={`mt-3 rounded-[10px] border px-[14px] py-[11px] text-[13px] ${
                  alert.type === "error"
                    ? "border-[#F5C5C0] bg-[#FDF0EF] text-[#C0392B]"
                    : alert.type === "success"
                    ? "border-[#9FE1CB] bg-[#EDF8F1] text-[#0F6E56]"
                    : "border-[rgba(224,123,60,0.2)] bg-[var(--orange-pale)] text-[var(--orange)]"
                }`}
              >
                {alert.msg}
              </div>
            ) : null}
            {activated ? (
              <div className="mt-4 rounded-[16px] border border-[rgba(29,158,117,0.25)] bg-[var(--green-pale)] px-6 py-5">
                <div className="mb-1 text-[14px] font-medium text-[#0F6E56]">
                  Licence activated successfully
                </div>
                <p className="text-[12.5px] leading-[1.5] text-[#0F6E56]">
                  Your device is now authorised. Open Gap Map desktop app — it
                  will pick up the activation automatically.
                </p>
                <div className="mt-2 break-all rounded-[6px] bg-[rgba(29,158,117,0.08)] px-[10px] py-2 font-mono text-[11px] text-[#0F6E56]">
                  {jwt || "—"}
                </div>
                <button
                  type="button"
                  onClick={copyToken}
                  className="mt-2 inline-block text-[11.5px] text-[var(--green)]"
                >
                  {copied ? "Copied!" : "Copy JWT token"}
                </button>
                <div className="mt-3 flex flex-wrap gap-[10px]">
                  <button
                    type="button"
                    onClick={openDesktopApp}
                    className="inline-flex items-center gap-2 rounded-[9px] border border-[var(--orange)] bg-[var(--orange)] px-3 py-2 text-[12.5px] font-medium text-white"
                  >
                    Open desktop app
                  </button>
                  <button
                    type="button"
                    onClick={downloadDesktopApp}
                    className="inline-flex items-center gap-2 rounded-[9px] border border-[var(--border-strong)] bg-white px-3 py-2 text-[12.5px] font-medium text-[var(--text)]"
                  >
                    Download desktop app
                  </button>
                </div>
              </div>
            ) : null}
          </section>

          {/* Devices */}
          <section className="rounded-[24px] border border-[var(--border-strong)] bg-white p-7">
            <div className="mb-1 text-[14px] font-medium text-[var(--dark)]">
              Activated devices
            </div>
            <div className="mb-5 text-[13px] leading-[1.5] text-[var(--muted)]">
              Your plan allows 1 device (Pro) or 2 devices (Pro + Live Pass).
              Deactivate to free a slot.
            </div>
            <div className="flex flex-col gap-2">
              {devices.length === 0 ? (
                <p className="rounded-[10px] border border-dashed border-[var(--border)] bg-[var(--cream-mid)] px-[14px] py-4 text-[13px] text-[var(--muted)]">
                  {licenceLoading
                    ? "Loading devices…"
                    : "No devices activated yet. Enter a key above to activate this browser."}
                </p>
              ) : (
                devices.map((d) => (
                  <div
                    key={d.key}
                    className="flex items-center justify-between rounded-[10px] border border-[var(--border)] bg-[var(--cream-mid)] px-[14px] py-3"
                  >
                    <div className="flex items-center gap-[10px]">
                      <span className="flex h-[30px] w-[30px] items-center justify-center rounded-[6px] bg-[var(--cream-dark)]">
                        <DeviceIcon />
                      </span>
                      <div>
                        <div className="text-[13px] font-medium text-[var(--dark)]">
                          {d.name}
                        </div>
                        <div className="text-[11px] text-[var(--muted-light)]">
                          {d.meta}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded-full px-[9px] py-[2px] text-[11px] font-medium ${
                          d.status === "current"
                            ? "bg-[var(--orange-pale)] text-[var(--orange)]"
                            : "bg-[var(--green-pale)] text-[var(--green)]"
                        }`}
                      >
                        {d.status === "current" ? "This device" : "Active"}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleDeactivate(d)}
                        disabled={acting === d.signatureHash}
                        className="text-[11.5px] font-medium text-[var(--muted)] hover:text-[var(--red)] disabled:opacity-50"
                      >
                        {acting === d.signatureHash ? "Removing…" : "Deactivate"}
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="mt-4 flex gap-2">
              {slots.map((used, i) => (
                <span
                  key={i}
                  className={
                    used
                      ? "h-2 w-7 rounded-full bg-[var(--orange)]"
                      : "h-2 w-7 rounded-full border border-dashed border-[rgba(30,20,10,0.15)] bg-[var(--cream-dark)]"
                  }
                />
              ))}
            </div>
            <p className="mt-[6px] text-[12px] text-[var(--muted-light)]">
              {slotsUsed} of {maxDevices} device slot
              {maxDevices === 1 ? "" : "s"} used
              {maxDevices <= 1 ? " · Upgrade to Live Pass for +1 slot" : ""}
            </p>
            <div className="mt-4 border-t border-[var(--border)] pt-4">
              <div className="mb-[10px] text-[14px] font-medium text-[var(--dark)]">
                Add Live Pass
              </div>
              <p className="mb-3 text-[12.5px] leading-[1.5] text-[var(--muted)]">
                $39/year — adds daily brief scheduler, competitor monitors, new
                source updates, and +1 device slot.
              </p>
              <button
                type="button"
                onClick={handleLivePass}
                className="btn-sm orange w-full justify-center"
              >
                Add Live Pass — $39/yr
              </button>
            </div>
          </section>

          {/* BYOK */}
          <section className="rounded-[24px] border border-[var(--border-strong)] bg-white p-7">
            <div className="mb-1 text-[14px] font-medium text-[var(--dark)]">
              BYOK — API keys
            </div>
            <div className="mb-5 text-[13px] leading-[1.5] text-[var(--muted)]">
              Your keys are stored locally in your Keychain and never sent to
              Gap Map servers.
            </div>
            {[
              { label: "Anthropic Claude", sub: "Used for AI extraction sweeps", set: true },
              { label: "OpenAI", sub: "Optional GPT-4o fallback", set: false },
              { label: "Gemini", sub: "Optional free-tier extraction", set: false },
            ].map((row) => (
              <div
                key={row.label}
                className="flex items-center justify-between border-b border-[var(--border)] py-[10px] last:border-b-0"
              >
                <div>
                  <div className="text-[13px] font-medium text-[var(--dark)]">
                    {row.label}
                  </div>
                  <div className="text-[11.5px] text-[var(--muted-light)]">
                    {row.sub}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-[6px] border border-[var(--border)] bg-[var(--cream-mid)] px-2 py-1 font-mono text-[11px] ${
                      row.set ? "text-[var(--muted-light)]" : "text-[var(--muted-light)]"
                    }`}
                  >
                    {row.set ? "sk-ant-••••••8f3a" : "Not set"}
                  </span>
                  <span className="text-[11.5px] font-medium text-[var(--orange)]">
                    {row.set ? "Change" : "Add"}
                  </span>
                </div>
              </div>
            ))}
            <p className="mt-4 rounded-[10px] bg-[var(--cream-mid)] px-3 py-3 text-[12px] leading-[1.5] text-[var(--muted)]">
              Keys are stored in macOS Keychain via{" "}
              <code className="rounded bg-[var(--cream-dark)] px-1 py-[1px] font-mono text-[10.5px]">
                Security.framework
              </code>
              . Gap Map never transmits them.
            </p>
          </section>

          {/* Purchase history */}
          <section className="rounded-[24px] border border-[var(--border-strong)] bg-white p-7">
            <div className="mb-1 text-[14px] font-medium text-[var(--dark)]">
              Purchase history
            </div>
            <div className="mb-5 text-[13px] leading-[1.5] text-[var(--muted)]">
              All transactions via Lemon Squeezy. Download invoices directly
              from your LS portal.
            </div>
            <div className="flex flex-col">
              <div className="flex items-center justify-between border-b border-[var(--border)] py-3">
                <div>
                  <div className="text-[13.5px] font-medium text-[var(--dark)]">
                    Pro Trial (14 days)
                  </div>
                  <div className="mt-[2px] text-[12px] text-[var(--muted-light)]">
                    3 Apr 2026
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[14px] font-medium text-[var(--dark)]">
                    $0.00
                  </div>
                  <span className="mt-[2px] inline-block rounded-full bg-[var(--green-pale)] px-[9px] py-[2px] text-[11px] text-[var(--green)]">
                    Active
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-between py-3 opacity-50">
                <div>
                  <div className="text-[13.5px] font-medium text-[var(--dark)]">
                    Pro — perpetual licence
                  </div>
                  <div className="mt-[2px] text-[12px] text-[var(--muted-light)]">
                    Pending upgrade
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[14px] font-medium text-[var(--dark)]">
                    $69.00
                  </div>
                  <span className="text-[11px] text-[var(--muted-light)]">
                    Not purchased
                  </span>
                </div>
              </div>
            </div>
            <div className="mt-4 border-t border-[var(--border)] pt-4">
              <button
                type="button"
                onClick={handlePortal}
                className="text-[13px] text-[var(--orange)] hover:underline"
              >
                Open Lemon Squeezy portal →
              </button>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
