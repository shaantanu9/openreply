// Shared helpers, icons, and types for the Activate page tabs.
// Keep purely presentational/derivation logic here so the tab components and
// the ActivatePanel orchestrator stay focused.

import type { LicenceSummary } from "@/lib/licenceClient";

export type Alert = { msg: string; type: "error" | "info" | "success" } | null;

export type TabKey = "activate" | "devices" | "billing";

export type DeviceRow = {
  key: string;
  name: string;
  meta: string;
  status: "current" | "active";
  signatureHash: string;
};

export function formatExpiryDate(value: string | null): string {
  if (!value) return "never";
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleDateString(undefined, {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return value;
  }
}

export function devicesFromLicence(lic: LicenceSummary | null): DeviceRow[] {
  if (!lic) return [];
  return lic.devices.map((d, idx) => ({
    key: d.signatureHash || `${idx}`,
    name: `${d.os || "unknown"} · ${d.arch || "unknown"}`,
    meta: `Activated ${formatExpiryDate(d.activatedAt)} · last seen ${formatExpiryDate(d.lastSeenAt)}`,
    status: idx === 0 ? "current" : "active",
    signatureHash: d.signatureHash,
  }));
}

export function planLabel(lic: LicenceSummary | null): string {
  if (!lic) return "No licence yet";
  if (lic.status === "revoked") return "Licence revoked";
  if (lic.status === "expired") return "Licence expired";
  if (lic.isTrial) return "Pro — trial active";
  if (lic.planId === "team") return "Team plan";
  if (lic.livePassActive || lic.planId === "live_pass") return "Pro + Live Pass";
  if (lic.planId === "pro") return "Pro — perpetual licence";
  if (lic.planId === "free") return "Free plan";
  return "Active licence";
}

/** Plain-text plan meta line (no HTML — rendered as text). */
export function planMetaText(lic: LicenceSummary | null): string {
  if (!lic) {
    return "Start a 14-day trial or enter your key to unlock the desktop app.";
  }
  const used = `${lic.devices.length} of ${lic.maxDevices} device${
    lic.maxDevices === 1 ? "" : "s"
  } used`;
  if (lic.isTrial && lic.trialEndsAt) {
    return `Trial ends ${formatExpiryDate(lic.trialEndsAt)} · ${used}`;
  }
  if (lic.expiresAt) {
    return `Renews ${formatExpiryDate(lic.expiresAt)} · ${used}`;
  }
  return used;
}

export function trialDaysLeft(lic: LicenceSummary | null): number {
  if (!lic?.isTrial || !lic.trialEndsAt) return 0;
  const ms = new Date(lic.trialEndsAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

// ── Icons ──────────────────────────────────────────────────────────────────

export function ShieldIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden>
      <path d="M11 3L5 6v6c0 4 3 7.5 6 8.5 3-1 6-4.5 6-8.5V6L11 3Z" stroke="#E07B3C" strokeWidth="1.4" />
      <path d="M8 11l2.5 2.5L15 8.5" stroke="#E07B3C" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function DeviceIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="2" y="3" width="12" height="9" rx="1.5" stroke="#6B6259" strokeWidth="1.2" />
      <path d="M5 14h6M8 12v2" stroke="#6B6259" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

export function CheckIcon({ color = "#fff" }: { color?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M3 7.5L6 10.5L11 4.5" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── Status banner ────────────────────────────────────────────────────────────

export function AlertBox({ alert }: { alert: Alert }) {
  if (!alert) return null;
  const cls =
    alert.type === "error"
      ? "border-[#F5C5C0] bg-[#FDF0EF] text-[#C0392B]"
      : alert.type === "success"
      ? "border-[#9FE1CB] bg-[#EDF8F1] text-[#0F6E56]"
      : "border-[rgba(224,123,60,0.2)] bg-[var(--orange-pale)] text-[var(--orange)]";
  return (
    <div role="status" className={`rounded-[10px] border px-[14px] py-[11px] text-[13px] ${cls}`}>
      {alert.msg}
    </div>
  );
}
