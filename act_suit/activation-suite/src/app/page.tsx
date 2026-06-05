import { SiteShell } from "@/components/shell/SiteShell";
import { UrgencyBanner } from "@/components/marketing/UrgencyBanner";
import { InviteHero } from "@/components/marketing/InviteHero";
import { HeroSlider } from "@/components/marketing/HeroSlider";
import { TrustLogoBar } from "@/components/marketing/TrustLogoBar";
import { MetricsStrip } from "@/components/marketing/MetricsStrip";
import { ProblemSection } from "@/components/marketing/ProblemSection";
import { BeforeAfterSection } from "@/components/marketing/BeforeAfterSection";
import { HowItWorks } from "@/components/marketing/HowItWorks";
import { DemoSection } from "@/components/marketing/DemoSection";
import { FeaturesGrid } from "@/components/marketing/FeaturesGrid";
import { EvidenceArchitecture } from "@/components/marketing/EvidenceArchitecture";
import { UseCasesSection } from "@/components/marketing/UseCasesSection";
import { Testimonials } from "@/components/marketing/Testimonials";
import { RoiSection } from "@/components/marketing/RoiSection";
import { ComparisonTable } from "@/components/marketing/ComparisonTable";
import { PricingSection } from "@/components/marketing/PricingSection";
import { RiskReversalSection } from "@/components/marketing/RiskReversalSection";
import { SecurityTrustSection } from "@/components/marketing/SecurityTrustSection";
import { FaqAccordion } from "@/components/marketing/FaqAccordion";
import { FinalPromiseSection } from "@/components/marketing/FinalPromiseSection";
import { RequestInviteSection } from "@/components/marketing/RequestInviteSection";
import { CtaSection } from "@/components/marketing/CtaSection";
import { StickyDownloadBar } from "@/components/marketing/StickyDownloadBar";
import { SignedInWelcome } from "@/components/marketing/SignedInWelcome";
import { SignedOutOnly } from "@/components/shell/AuthGate";

// The marketing home is static — cache indefinitely, rebuild at release.
export const revalidate = 3600;

/**
 * Sales-page section order — AIDA + objection-stack:
 *
 *   ATTENTION  → Urgency banner · Hero · Trust logo bar · Metrics
 *   INTEREST   → Problem · Before/After · How it works · Demo
 *   DESIRE     → Features · Evidence architecture · Use cases · Testimonials
 *   ACTION     → ROI · Comparison · Pricing
 *   OBJECTION  → Risk reversal · Security · FAQ
 *   CLOSE      → Final promise · CTA · Sticky download bar
 *
 * Conversion logic: prove the pain BEFORE the product (Problem +
 * Before/After), surface social proof BEFORE pricing (Testimonials),
 * answer objections AFTER pricing so the FAQ doesn't kill momentum.
 */
export default function MarketingHome() {
  return (
    <>
      {/* Urgency banner is a conversion device — hide it once signed in. */}
      <SignedOutOnly>
        <UrgencyBanner />
      </SignedOutOnly>
      <SiteShell>
        {/* Signed-in users get a clean app-launcher instead of the invite
            funnel; renders nothing for logged-out visitors. */}
        <SignedInWelcome />

        {/* ── Invite capture (full-screen, top of page) — logged-out only ── */}
        <SignedOutOnly>
          <InviteHero />
        </SignedOutOnly>

        {/* ── ATTENTION ── */}
        <HeroSlider />
        <TrustLogoBar />
        <div className="bg-[var(--cream)] px-8 pt-16 pb-4">
          <MetricsStrip />
        </div>

        {/* ── INTEREST: agitate the pain, then show the shape of the fix ── */}
        <ProblemSection />
        <BeforeAfterSection />
        <HowItWorks />
        <DemoSection />

        {/* ── DESIRE: capability depth + social proof ── */}
        <FeaturesGrid />
        <EvidenceArchitecture />
        <UseCasesSection />
        <Testimonials />

        {/* ── ACTION: math, comparison, price ── */}
        <RoiSection />
        <ComparisonTable />
        <PricingSection />

        {/* ── OBJECTION: handle fear AFTER the price reveal ── */}
        <RiskReversalSection />
        <SecurityTrustSection />
        <FaqAccordion />

        {/* ── CLOSE ── (invite + beta CTAs are logged-out only) ── */}
        <FinalPromiseSection />
        <SignedOutOnly>
          <RequestInviteSection />
          <CtaSection />
        </SignedOutOnly>
      </SiteShell>
      <StickyDownloadBar />
    </>
  );
}
