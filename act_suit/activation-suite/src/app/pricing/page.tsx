import type { Metadata } from "next";
import { SiteShell } from "@/components/shell/SiteShell";
import { PricingSection } from "@/components/marketing/PricingSection";
import { ComparisonTable } from "@/components/marketing/ComparisonTable";
import { CtaSection } from "@/components/marketing/CtaSection";

export const metadata: Metadata = {
  title: "Gap Map — Pricing",
};

export const revalidate = 3600;

export default function PricingPage() {
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
        </div>
      </div>
      <PricingSection />
      <ComparisonTable />
      <CtaSection />
    </SiteShell>
  );
}
