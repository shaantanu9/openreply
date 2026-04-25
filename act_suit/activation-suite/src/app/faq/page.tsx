import type { Metadata } from "next";
import { SiteShell } from "@/components/shell/SiteShell";
import { FaqAccordion } from "@/components/marketing/FaqAccordion";

export const metadata: Metadata = {
  title: "Gap Map — FAQ & Contact",
};

export const revalidate = 3600;

export default function FaqPage() {
  return (
    <SiteShell offsetTop>
      <div className="px-8 py-20">
        <div className="mx-auto max-w-[840px]">
          <span className="section-label">FAQ &amp; Contact</span>
          <h1 className="font-serif text-[clamp(36px,4.2vw,52px)] font-normal leading-[1.1] tracking-[-1.2px] text-[var(--dark)]">
            Everything you need before you download.
          </h1>
          <p className="mt-4 text-[17px] leading-[1.7] text-[var(--muted)]">
            Answers to common questions about setup, pricing, and support.
          </p>
        </div>
      </div>
      <FaqAccordion />
    </SiteShell>
  );
}
