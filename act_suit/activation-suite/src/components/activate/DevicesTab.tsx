"use client";

import type { LicenceSummary } from "@/lib/licenceClient";
import { DeviceIcon, devicesFromLicence } from "./activateShared";

export function DevicesTab(props: {
  licence: LicenceSummary | null;
  licenceLoading: boolean;
  acting: string | null;
  onDeactivate: (signatureHash: string, name: string) => void;
  onLivePass: () => void;
}) {
  const { licence, licenceLoading, acting } = props;
  const devices = devicesFromLicence(licence);
  const maxDevices = licence?.maxDevices ?? 1;
  const slotsUsed = devices.length;
  const slots = Array.from({ length: Math.max(maxDevices, 1) }, (_, i) => i < slotsUsed);

  return (
    <section className="rounded-[24px] border border-[var(--border-strong)] bg-white p-7 md:p-9">
      <div className="mb-1 text-[15px] font-medium text-[var(--dark)]">Activated devices</div>
      <p className="mb-5 text-[13px] leading-[1.5] text-[var(--muted)]">
        Pro allows 1 device; Pro + Live Pass allows 2. Deactivate one to free a slot.
      </p>

      <div className="flex flex-col gap-2">
        {devices.length === 0 ? (
          <p className="rounded-[10px] border border-dashed border-[var(--border)] bg-[var(--cream-mid)] px-[14px] py-4 text-[13px] text-[var(--muted)]">
            {licenceLoading
              ? "Loading devices…"
              : "No devices activated yet. Activate a key on the Activate tab to register this browser."}
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
                  <div className="text-[13px] font-medium text-[var(--dark)]">{d.name}</div>
                  <div className="text-[11px] text-[var(--muted-light)]">{d.meta}</div>
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
                  onClick={() => props.onDeactivate(d.signatureHash, d.name)}
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
        {slotsUsed} of {maxDevices} device slot{maxDevices === 1 ? "" : "s"} used
        {maxDevices <= 1 ? " · Upgrade to Live Pass for +1 slot" : ""}
      </p>

      <div className="mt-6 border-t border-[var(--border)] pt-5">
        <div className="mb-[10px] text-[14px] font-medium text-[var(--dark)]">Add Live Pass</div>
        <p className="mb-3 text-[12.5px] leading-[1.5] text-[var(--muted)]">
          $39/year — daily brief scheduler, competitor monitors, new source updates, and +1 device slot.
        </p>
        <button type="button" onClick={props.onLivePass} className="btn-sm orange">
          Add Live Pass — $39/yr
        </button>
      </div>
    </section>
  );
}
