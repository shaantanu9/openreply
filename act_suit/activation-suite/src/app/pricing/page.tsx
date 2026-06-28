import type { Metadata } from "next";
import Link from "next/link";
import { SiteShell } from "@/components/shell/SiteShell";
import { PricingSection } from "@/components/marketing/PricingSection";
import { ComparisonTable } from "@/components/marketing/ComparisonTable";
import { CtaSection } from "@/components/marketing/CtaSection";
import { ROUTES } from "@/lib/constants";

export const metadata: Metadata = {
  title: "OpenReply — Pricing",
};

export const revalidate = 3600;

const BILLING_ON = ["1", "true", "yes", "on"].includes(
  (process.env.NEXT_PUBLIC_BILLING_ENABLED || "").trim().toLowerCase(),
);

export default function PricingPage() {
  // Free-during-beta: don't show paid tiers while billing is off.
  if (!BILLING_ON) {
    return (
      <SiteShell offsetTop>
        <div className="px-8 py-24">
          <div className="mx-auto max-w-[680px] text-center">
            <span className="section-label">Pricing</span>
            <h1 className="font-serif text-[clamp(36px,4.2vw,52px)] font-normal leading-[1.1] tracking-[-1.2px] text-[var(--dark)]">
              Free while in beta.
            </h1>
            <p className="mt-4 text-[17px] leading-[1.7] text-[var(--muted)]">
              OpenReply is <strong>free during the invite-only beta</strong> — claim an
              invite, grab your license key, and activate the desktop app. Bring your
              own AI key, and your data stays local on your machine. No card, ever,
              while you&rsquo;re in beta.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link href="/sign-in" className="btn-sm orange">
                Claim your free beta invite →
              </Link>
              <Link href="/download" className="btn-sm">
                Download for Mac
              </Link>
            </div>
            <ul className="mx-auto mt-10 grid max-w-[420px] gap-2 text-left text-[14px] text-[var(--muted)]">
              <li>• No card needed · activation in ~2 minutes</li>
              <li>• Up to 2 devices per account</li>
              <li>• BYOK — your AI key, your inference costs</li>
              <li>• Local-first — SQLite on your machine, not our cloud</li>
            </ul>
            <p className="mt-10 text-[13px] text-[var(--muted-light)]">
              Paid plans arrive after beta. Early users keep access.
            </p>
          </div>
        </div>
        <CtaSection />
      </SiteShell>
    );
  }

  return (
    <SiteShell offsetTop>
      <div className="px-8 py-16">
        <div className="mx-auto max-w-[840px] text-center">
          <span className="section-label">Pricing</span>
          <h1 className="font-serif text-[clamp(36px,4.2vw,52px)] font-normal leading-[1.1] tracking-[-1.2px] text-[var(--dark)]">
            Simple plans for every product team.
          </h1>
          <p className="mt-4 text-[17px] leading-[1.7] text-[var(--muted)]">
            Start lean, then scale as your research volume grows. Every plan
            includes desktop app access, BYOK, and regular updates.
          </p>
          <p className="mt-3 text-[14px] text-[var(--muted)]">
            Have a coupon?{" "}
            <Link href={ROUTES.redeem} className="font-medium text-[var(--dark)] underline underline-offset-4 hover:opacity-80">
              Redeem it for a free activation key →
            </Link>
          </p>
        </div>
      </div>
      <PricingSection />
      <ComparisonTable />
      <CtaSection />
    </SiteShell>
  );
}
