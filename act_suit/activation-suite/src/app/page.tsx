import { SiteShell } from "@/components/shell/SiteShell";
import { HeroSlider } from "@/components/marketing/HeroSlider";
import { MetricsStrip } from "@/components/marketing/MetricsStrip";
import { HowItWorks } from "@/components/marketing/HowItWorks";
import { FeaturesGrid } from "@/components/marketing/FeaturesGrid";
import { EvidenceArchitecture } from "@/components/marketing/EvidenceArchitecture";
import { PricingSection } from "@/components/marketing/PricingSection";
import { ComparisonTable } from "@/components/marketing/ComparisonTable";
import { Testimonials } from "@/components/marketing/Testimonials";
import { FaqAccordion } from "@/components/marketing/FaqAccordion";
import { CtaSection } from "@/components/marketing/CtaSection";
import { RevealOnScroll } from "@/components/marketing/RevealOnScroll";

// The marketing home is static — cache indefinitely, rebuild at release.
export const revalidate = 3600;

export default function MarketingHome() {
  return (
    <SiteShell>
      <HeroSlider />
      <div className="py-10">
        <MetricsStrip />
      </div>
      <HowItWorks />
      <FeaturesGrid />
      <EvidenceArchitecture />
      <PricingSection />
      <ComparisonTable />
      <Testimonials />
      <FaqAccordion />
      <CtaSection />
      <RevealOnScroll />
    </SiteShell>
  );
}
