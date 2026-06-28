import type { Metadata } from "next";
import { SiteShell } from "@/components/shell/SiteShell";
import { DashboardPanel } from "@/components/dashboard/DashboardPanel";

export const metadata: Metadata = {
  title: "OpenReply — Dashboard",
};

// Session-driven; never cache.
export const dynamic = "force-dynamic";

export default function DashboardPage() {
  return (
    <SiteShell navVariant="compact" withFooter={false}>
      <DashboardPanel />
    </SiteShell>
  );
}
