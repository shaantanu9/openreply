"use client";

import type { LicenceSummary } from "@/lib/licenceClient";
import { formatExpiryDate, planLabel } from "./activateShared";

export function BillingTab(props: {
  licence: LicenceSummary | null;
  licenceLoading: boolean;
  onUpgrade: () => void;
  onLivePass: () => void;
  onPortal: () => void;
}) {
  const { licence, licenceLoading } = props;

  const rows: Array<{ label: string; value: string }> = [];
  if (licence) {
    rows.push({ label: "Current plan", value: planLabel(licence) });
    if (licence.isTrial && licence.trialEndsAt) {
      rows.push({ label: "Trial ends", value: formatExpiryDate(licence.trialEndsAt) });
    } else if (licence.expiresAt) {
      rows.push({ label: "Renews", value: formatExpiryDate(licence.expiresAt) });
    } else if (licence.planId === "pro") {
      rows.push({ label: "Term", value: "Perpetual — no renewal" });
    }
    rows.push({
      label: "Devices",
      value: `${licence.devices.length} of ${licence.maxDevices}`,
    });
    if (licence.activationKeyPreview) {
      rows.push({ label: "Key", value: licence.activationKeyPreview });
    }
  }

  return (
    <section className="rounded-[24px] border border-[var(--border-strong)] bg-white p-7 md:p-9">
      <div className="mb-1 text-[15px] font-medium text-[var(--dark)]">Plan &amp; billing</div>
      <p className="mb-5 text-[13px] leading-[1.5] text-[var(--muted)]">
        Payments and invoices are handled by Lemon Squeezy. Open the customer portal to download
        invoices, update your card, or cancel.
      </p>

      <div className="rounded-[12px] border border-[var(--border)] bg-[var(--cream-mid)] p-1">
        {licenceLoading ? (
          <p className="px-3 py-4 text-[13px] text-[var(--muted)]">Loading plan…</p>
        ) : rows.length === 0 ? (
          <p className="px-3 py-4 text-[13px] text-[var(--muted)]">
            No active plan yet. Start a trial or buy Pro from the Activate tab.
          </p>
        ) : (
          rows.map((r) => (
            <div
              key={r.label}
              className="flex items-center justify-between border-b border-[var(--border)] px-3 py-[11px] last:border-b-0"
            >
              <span className="text-[12.5px] text-[var(--muted)]">{r.label}</span>
              <span className="text-[13px] font-medium text-[var(--dark)]">{r.value}</span>
            </div>
          ))
        )}
      </div>

      <div className="mt-5 flex flex-wrap gap-[10px]">
        <button type="button" onClick={props.onUpgrade} className="btn-sm orange">
          Upgrade to Pro — $69
        </button>
        <button type="button" onClick={props.onLivePass} className="btn-sm">
          Add Live Pass — $39/yr
        </button>
        <button type="button" onClick={props.onPortal} className="btn-sm">
          Manage billing &amp; invoices
        </button>
      </div>
    </section>
  );
}
