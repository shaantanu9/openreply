import type { Metadata } from "next";
import { SiteShell } from "@/components/shell/SiteShell";
import { RedeemPanel } from "@/components/redeem/RedeemPanel";

export const metadata: Metadata = {
  title: "Gap Map — Redeem coupon",
  description: "Redeem a coupon code for a free Gap Map activation key.",
};

// Session-driven — never cache.
export const dynamic = "force-dynamic";

export default function RedeemPage() {
  return (
    <SiteShell navVariant="compact" withFooter={false}>
      <RedeemPanel />
    </SiteShell>
  );
}
