import type { Metadata } from "next";
import { SiteShell } from "@/components/shell/SiteShell";
import { FeaturesGrid } from "@/components/marketing/FeaturesGrid";
import { EvidenceArchitecture } from "@/components/marketing/EvidenceArchitecture";
import { CtaSection } from "@/components/marketing/CtaSection";

export const metadata: Metadata = {
  title: "Gap Map — Features",
};

export const revalidate = 3600;

export default function FeaturesPage() {
  return (
    <SiteShell offsetTop>
      <div className="px-8 py-16">
        <div className="mx-auto max-w-[1200px]">
          <span className="section-label">Features</span>
          <h1 className="font-serif text-[clamp(36px,4.2vw,52px)] font-normal leading-[1.1] tracking-[-1.2px] text-[var(--dark)]">
            Everything your team needs to research faster.
          </h1>
          <p className="mt-4 max-w-[620px] text-[17px] leading-[1.7] text-[var(--muted)]">
            Gap Map combines data collection, analysis, and decision support
            into one workflow so teams can move from signal to roadmap in
            hours, not weeks.
          </p>
        </div>
      </div>
      <FeaturesGrid />
      <EvidenceArchitecture />
      <CtaSection />
    </SiteShell>
  );
}
