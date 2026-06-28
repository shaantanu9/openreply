"use client";

import Link from "next/link";
import { ROUTES, GITHUB } from "@/lib/constants";
import { AlertBox, CheckIcon, type Alert } from "./activateShared";

type StepState = "done" | "active" | "upcoming";

function Step({
  index,
  title,
  state,
  children,
}: {
  index: number;
  title: string;
  state: StepState;
  children: React.ReactNode;
}) {
  const circle =
    state === "done"
      ? "bg-[var(--green)] text-white"
      : state === "active"
      ? "bg-[var(--orange)] text-white"
      : "bg-[var(--cream-dark)] text-[var(--muted-light)] border border-[var(--border-strong)]";
  return (
    <div className="flex gap-4">
      {/* rail */}
      <div className="flex flex-col items-center">
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold ${circle}`}
        >
          {state === "done" ? <CheckIcon /> : index}
        </span>
        {index < 3 ? <span className="mt-1 w-px flex-1 bg-[var(--border)]" aria-hidden /> : null}
      </div>
      {/* body */}
      <div className={`flex-1 pb-7 ${state === "upcoming" ? "opacity-55" : ""}`}>
        <div className="mb-3 flex items-center gap-2">
          <h3 className="text-[15px] font-medium text-[var(--dark)]">{title}</h3>
          {state === "done" ? (
            <span className="rounded-full bg-[var(--green-pale)] px-2 py-[1px] text-[11px] font-medium text-[var(--green)]">
              Done
            </span>
          ) : null}
        </div>
        {children}
      </div>
    </div>
  );
}

export function ActivateTab(props: {
  email: string;
  licenceLoading: boolean;
  hasLicence: boolean;
  licenceKey: string;
  keyPreview: string | null;
  keyCopied: boolean;
  deviceCount: number;
  acting: string | null;
  alert: Alert;
  onCopyKey: () => void;
  onStartTrial: () => void;
  onGetFreeKey: () => void;
  onUpgrade: () => void;
  onResendHelp: () => void;
  openDesktopApp: () => void;
  downloadDesktopApp: () => void;
}) {
  const {
    email,
    licenceLoading,
    hasLicence,
    licenceKey,
    keyPreview,
    keyCopied,
    deviceCount,
    acting,
    alert,
  } = props;

  const hasKey = Boolean(licenceKey) || hasLicence;

  const step1: StepState = "done";
  const step2: StepState = hasKey ? "done" : "active";
  const step3: StepState = hasKey ? "active" : "upcoming";

  return (
    <section className="rounded-[24px] border border-[var(--border-strong)] bg-white p-7 md:p-9">
      {/* STEP 1 — account */}
      <Step index={1} title="Sign in to your account" state={step1}>
        <p className="text-[13px] text-[var(--muted)]">
          Signed in as{" "}
          <strong className="font-medium text-[var(--dark)]">{email || "your account"}</strong>.
          Use this same email inside the desktop app.
        </p>
      </Step>

      {/* STEP 2 — get + copy key */}
      <Step index={2} title="Get your licence key" state={step2}>
        {/* Get-a-key buttons — only when there's no key yet */}
        {!hasKey && !licenceLoading ? (
          <div className="mb-4 rounded-[12px] border border-[var(--border)] bg-[var(--cream-mid)] p-4">
            <p className="mb-3 text-[12.5px] text-[var(--muted)]">Choose one to get a key:</p>
            <div className="flex flex-wrap gap-[10px]">
              <button
                type="button"
                className="btn-sm primary"
                onClick={props.onStartTrial}
                disabled={acting === "trial"}
              >
                {acting === "trial" ? "Starting…" : "Start free 14-day trial"}
              </button>
              <button
                type="button"
                className="btn-sm"
                onClick={props.onGetFreeKey}
                disabled={acting === "free"}
              >
                {acting === "free" ? "Getting…" : "Get free key"}
              </button>
              <button type="button" className="btn-sm orange" onClick={props.onUpgrade}>
                Buy Pro — $69
              </button>
            </div>
            <p className="mt-2 text-[12px] text-[var(--muted-light)]">
              Already bought Pro? Your key is in your purchase email — it shows up here once it&rsquo;s linked.
            </p>
            <div className="mt-3 flex flex-col gap-2 rounded-[10px] border border-[rgba(224,123,60,0.3)] bg-[var(--orange-pale)] px-[14px] py-[10px] sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[12.5px] leading-[1.5] text-[var(--text)]">
                <strong className="font-medium text-[var(--dark)]">Free key, free app.</strong>{" "}
                If OpenReply helps you, a GitHub star is the nicest way to say thanks 💛
              </p>
              <a
                href={GITHUB.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex shrink-0 items-center justify-center gap-2 rounded-[9px] border border-[var(--orange)] bg-[var(--orange)] px-4 py-2 text-[13px] font-medium text-white hover:bg-[var(--orange-hover)]"
              >
                ⭐ Star us on GitHub
              </a>
            </div>
          </div>
        ) : null}

        {licenceLoading ? (
          <p className="text-[13px] text-[var(--muted)]">Loading your licence…</p>
        ) : null}

        {/* The key box: full key (copyable) if we have it, else a masked preview */}
        {licenceKey || keyPreview ? (
          <div className="rounded-[12px] border border-[rgba(224,123,60,0.3)] bg-[var(--orange-pale)] p-4">
            <div className="mb-[6px] flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--orange)]">
                Your licence key
              </span>
              {licenceKey ? (
                <button
                  type="button"
                  onClick={props.onCopyKey}
                  className="rounded-[7px] border border-[var(--orange)] px-[10px] py-[3px] text-[11.5px] font-medium text-[var(--orange)] hover:bg-[var(--orange)] hover:text-white"
                >
                  {keyCopied ? "Copied ✓" : "Copy key"}
                </button>
              ) : null}
            </div>
            <div
              className={`break-all font-mono text-[17px] tracking-[2px] text-[var(--dark)] ${licenceKey ? "cursor-pointer" : ""}`}
              onClick={licenceKey ? props.onCopyKey : undefined}
              title={licenceKey ? "Click to copy" : undefined}
            >
              {licenceKey || keyPreview}
            </div>
            <p className="mt-2 text-[12px] leading-[1.5] text-[var(--muted)]">
              {licenceKey
                ? "Saved on this browser — press Copy anytime. You'll paste this into the desktop app in step 3."
                : "This is a preview. Your full key was emailed when it was issued — copy it from that email."}
            </p>
          </div>
        ) : null}

        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-[6px] text-[12px]">
          <Link href={ROUTES.activationHelp} className="text-[var(--orange)] hover:underline">
            Activation help
          </Link>
          <button type="button" onClick={props.onResendHelp} className="text-[var(--orange)] hover:underline">
            Didn&rsquo;t get a key?
          </button>
        </div>

        {alert ? (
          <div className="mt-3">
            <AlertBox alert={alert} />
          </div>
        ) : null}
      </Step>

      {/* STEP 3 — open the desktop app */}
      <Step index={3} title="Open the app & paste your key" state={step3}>
        <div className="rounded-[12px] border border-[var(--border)] bg-[var(--cream-mid)] p-4">
          <ol className="ml-4 grid list-decimal gap-[7px] text-[12.5px] leading-[1.5] text-[var(--text)]">
            <li>Open the OpenReply desktop app on your Mac.</li>
            <li>
              Sign in with the same email
              {email ? (
                <>
                  {" "}
                  (<strong className="font-medium text-[var(--dark)]">{email}</strong>)
                </>
              ) : null}
              .
            </li>
            <li>When it asks for a licence key, paste the key from step 2.</li>
            <li>The app checks your key and unlocks on this Mac. That&rsquo;s it. 🎉</li>
          </ol>
        </div>

        {deviceCount > 0 ? (
          <div className="mt-3 flex items-center gap-2 rounded-[10px] border border-[rgba(29,158,117,0.25)] bg-[var(--green-pale)] px-[14px] py-[10px] text-[12.5px] font-medium text-[#0F6E56]">
            <CheckIcon color="#0F6E56" />
            Activated on {deviceCount} device{deviceCount === 1 ? "" : "s"} — manage them in the Devices tab.
          </div>
        ) : null}

        <div className="mt-3 flex flex-wrap gap-[10px]">
          <button
            type="button"
            onClick={props.openDesktopApp}
            className="inline-flex items-center gap-2 rounded-[9px] border border-[var(--orange)] bg-[var(--orange)] px-4 py-2 text-[13px] font-medium text-white hover:bg-[var(--orange-hover)]"
          >
            Open OpenReply app
          </button>
          <button
            type="button"
            onClick={props.downloadDesktopApp}
            className="inline-flex items-center gap-2 rounded-[9px] border border-[var(--border-strong)] bg-white px-4 py-2 text-[13px] font-medium text-[var(--text)] hover:border-[var(--orange)]"
          >
            Download the app
          </button>
        </div>
      </Step>
    </section>
  );
}
