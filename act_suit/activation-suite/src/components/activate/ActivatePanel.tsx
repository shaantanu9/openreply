"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatActivationKey } from "@/lib/activationKey";
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
  getFreeKey,
  startTrial,
  type LicenceSummary,
} from "@/lib/licenceClient";
import {
  ShieldIcon,
  planLabel,
  planMetaText,
  trialDaysLeft,
  type Alert,
  type TabKey,
} from "./activateShared";
import { ActivateTab } from "./ActivateTab";
import { DevicesTab } from "./DevicesTab";
import { BillingTab } from "./BillingTab";

const TRIAL_TOTAL_DAYS = 14;

// We remember the full licence key in localStorage so the user can re-copy it
// later. The server only returns the full key once (it's hashed at rest), so
// this client-side memory is what makes "copy it again" actually work.
const LS_LICENCE_KEY = "gapmap.licence.key";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "activate", label: "Activate" },
  { key: "devices", label: "Devices" },
  { key: "billing", label: "Billing" },
];

export function ActivatePanel() {
  const router = useRouter();
  const { user, status } = useSession();

  const [tab, setTab] = useState<TabKey>("activate");
  const [alert, setAlert] = useState<Alert>(null);
  const [licence, setLicence] = useState<LicenceSummary | null>(null);
  const [licenceLoading, setLicenceLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [licenceKey, setLicenceKey] = useState(""); // full key, for re-copy
  const [keyCopied, setKeyCopied] = useState(false);

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

  // Restore a previously-issued key so the user can copy it again.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(LS_LICENCE_KEY);
      if (saved) setLicenceKey(formatActivationKey(saved));
    } catch {
      /* localStorage unavailable — non-fatal */
    }
  }, []);

  // Persist the full key (called after a trial/free key is issued).
  const rememberKey = useCallback((raw: string) => {
    const formatted = formatActivationKey(raw);
    setLicenceKey(formatted);
    try {
      localStorage.setItem(LS_LICENCE_KEY, formatted);
    } catch {
      /* non-fatal */
    }
  }, []);

  const desktopLinks = useMemo(() => {
    const env = getPublicEnv();
    return {
      deepLink: (env.appDeepLinkUrl || "gapmap://dashboard").trim(),
      // Prefer the env override; otherwise use the canonical /api/download
      // route, which redirects to the latest GitHub release for the visitor's
      // OS. This is always populated, so the download button never dead-ends.
      downloadUrl: env.appDownloadUrl.trim() || "/api/download",
    };
  }, []);

  const name = getUserDisplayName(user) || "";
  const email = user?.email || "";
  const hasLicence = Boolean(licence);

  function showAlert(msg: string, type: "error" | "info" | "success") {
    setAlert({ msg, type });
  }

  function copyKey() {
    if (!licenceKey) return;
    navigator.clipboard.writeText(licenceKey).catch(() => {});
    setKeyCopied(true);
    setTimeout(() => setKeyCopied(false), 1500);
  }

  async function handleStartTrial() {
    setActing("trial");
    try {
      const res = await startTrial();
      rememberKey(res.activation_key);
      showAlert(
        `Trial started — ${res.trial_days} days. Your key is shown below. Copy it, then open the app (step 3).`,
        "success",
      );
      await reloadLicence();
    } catch (err) {
      showAlert(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setActing(null);
    }
  }

  async function handleGetFreeKey() {
    setActing("free");
    try {
      const res = await getFreeKey();
      if (res.activation_key) {
        rememberKey(res.activation_key);
        showAlert("Free key issued — shown below. Copy it, then open the app (step 3).", "success");
      } else {
        showAlert(
          res.message ||
            "You already have a free licence. Your key is in your email — copy it from there.",
          "info",
        );
      }
      await reloadLicence();
    } catch (err) {
      showAlert(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setActing(null);
    }
  }

  async function handleDeactivate(signatureHash: string, deviceName: string) {
    if (!window.confirm(`Deactivate ${deviceName}?`)) return;
    setActing(signatureHash);
    try {
      await deactivateDeviceWeb(signatureHash);
      showAlert("Device deactivated.", "success");
      await reloadLicence();
    } catch (err) {
      showAlert(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setActing(null);
    }
  }

  function handleUpgrade() {
    if (!openLemonSqueezyCheckout("pro")) {
      showAlert(
        "Set NEXT_PUBLIC_LEMONSQUEEZY_CHECKOUT_PRO (Lemon Squeezy checkout link for Pro).",
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

  function openDesktopApp() {
    if (!desktopLinks.deepLink) {
      showAlert("Desktop deep-link not configured. Use Download the app instead.", "info");
      return;
    }
    // Standard web→desktop "open vs download" pattern (Slack/Linear/VS Code):
    // a website can't detect whether the app is installed, so we fire the deep
    // link and watch for the tab losing focus. If the OS hands off to the app,
    // the page is hidden/blurred → stay silent. If we're still in the
    // foreground after the timeout, the app likely isn't installed → prompt a
    // download instead of leaving the user stuck.
    let handedOff = false;
    const markHandoff = () => {
      if (document.visibilityState === "hidden") handedOff = true;
    };
    const onBlur = () => {
      handedOff = true;
    };
    document.addEventListener("visibilitychange", markHandoff);
    window.addEventListener("blur", onBlur);

    try {
      window.location.href = desktopLinks.deepLink;
    } catch {
      showAlert("Could not open the desktop app link.", "error");
    }

    window.setTimeout(() => {
      document.removeEventListener("visibilitychange", markHandoff);
      window.removeEventListener("blur", onBlur);
      if (!handedOff) {
        showAlert(
          'Gap Map didn’t open — it may not be installed yet. Use "Download the app" below, then try again.',
          "info",
        );
      }
    }, 1500);
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
    const subject = encodeURIComponent("Gap Map activation key help");
    const body = encodeURIComponent(
      `Hi Gap Map support,\n\nI need help with my activation key.\nAccount email: ${
        email || "[your email]"
      }\nIssue: [did not receive key / key not working]\n\nThanks.`,
    );
    window.location.href = `mailto:support@gapmap.app?subject=${subject}&body=${body}`;
  }

  // Trial banner data
  const daysLeft = trialDaysLeft(licence);
  const showTrial = Boolean(licence?.isTrial && licence.trialEndsAt);
  const trialPct = Math.min(100, Math.max(0, Math.round((daysLeft / TRIAL_TOTAL_DAYS) * 100)));
  const deviceCount = licence?.devices.length ?? 0;

  return (
    <div className="min-h-screen bg-[var(--cream)]">
      <main className="mx-auto max-w-[820px] px-6 py-12 md:px-8">
        {/* Heading */}
        <div className="mb-8">
          <h1 className="font-serif text-[32px] font-normal leading-tight tracking-[-1px] text-[var(--dark)]">
            Activate <em className="italic text-[var(--orange)]">Gap Map</em>
          </h1>
          <p className="mt-2 max-w-[540px] text-[14px] font-light text-[var(--muted)]">
            Just 3 steps: you&rsquo;re signed in, you get a licence key here, then you paste that key
            into the desktop app. Everything runs locally on your Mac.
          </p>
        </div>

        {/* Plan status strip */}
        <section className="mb-5 flex flex-col gap-4 rounded-[18px] border border-[var(--border-strong)] bg-white px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[rgba(224,123,60,0.2)] bg-[var(--orange-pale)]">
              <ShieldIcon />
            </span>
            <div>
              <div className="text-[16px] font-medium text-[var(--dark)]">
                {licenceLoading ? "Loading licence…" : planLabel(licence)}
              </div>
              <div className="text-[12.5px] text-[var(--muted)]">{planMetaText(licence)}</div>
              {name || email ? (
                <div className="mt-[2px] text-[12px] text-[var(--muted-light)]">
                  Signed in as {name || email}
                </div>
              ) : null}
            </div>
          </div>
          {showTrial ? (
            <div className="min-w-[180px] sm:text-right">
              <div className="mb-[6px] text-[12.5px] font-medium text-[var(--orange)]">
                {daysLeft} / {TRIAL_TOTAL_DAYS} trial days left
              </div>
              <div className="h-[6px] rounded-full bg-[rgba(224,123,60,0.15)]">
                <div
                  className="h-[6px] rounded-full bg-[var(--orange)] transition-all duration-500"
                  style={{ width: `${trialPct}%` }}
                />
              </div>
            </div>
          ) : null}
        </section>

        {/* Tab nav */}
        <div className="mb-6 flex gap-1 rounded-[12px] border border-[var(--border)] bg-white p-1">
          {TABS.map((t) => {
            const isActive = tab === t.key;
            const count = t.key === "devices" && licence ? licence.devices.length : null;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={`flex-1 rounded-[9px] px-3 py-2 text-[13px] font-medium transition-colors ${
                  isActive
                    ? "bg-[var(--dark)] text-white"
                    : "text-[var(--muted)] hover:bg-[var(--cream-mid)] hover:text-[var(--text)]"
                }`}
              >
                {t.label}
                {count !== null ? (
                  <span
                    className={`ml-[6px] rounded-full px-[6px] py-[1px] text-[11px] ${
                      isActive ? "bg-white/20 text-white" : "bg-[var(--cream-dark)] text-[var(--muted)]"
                    }`}
                  >
                    {count}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        {/* Tab content */}
        {tab === "activate" ? (
          <ActivateTab
            email={email}
            licenceLoading={licenceLoading}
            hasLicence={hasLicence}
            licenceKey={licenceKey}
            keyPreview={licence?.activationKeyPreview ?? null}
            keyCopied={keyCopied}
            deviceCount={deviceCount}
            acting={acting}
            alert={alert}
            onCopyKey={copyKey}
            onStartTrial={handleStartTrial}
            onGetFreeKey={handleGetFreeKey}
            onUpgrade={handleUpgrade}
            onResendHelp={resendKeyHelp}
            openDesktopApp={openDesktopApp}
            downloadDesktopApp={downloadDesktopApp}
          />
        ) : null}

        {tab === "devices" ? (
          <DevicesTab
            licence={licence}
            licenceLoading={licenceLoading}
            acting={acting}
            onDeactivate={handleDeactivate}
            onLivePass={handleLivePass}
          />
        ) : null}

        {tab === "billing" ? (
          <BillingTab
            licence={licence}
            licenceLoading={licenceLoading}
            onUpgrade={handleUpgrade}
            onLivePass={handleLivePass}
            onPortal={handlePortal}
          />
        ) : null}
      </main>
    </div>
  );
}
