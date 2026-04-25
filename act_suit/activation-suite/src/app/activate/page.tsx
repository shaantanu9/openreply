import type { Metadata } from "next";
import { SiteShell } from "@/components/shell/SiteShell";
import { ActivatePanel } from "@/components/activate/ActivatePanel";

export const metadata: Metadata = {
  title: "Gap Map — Activate your licence",
};

export const dynamic = "force-dynamic";

export default function ActivatePage() {
  return (
    <SiteShell navVariant="compact" withFooter={false}>
      <ActivatePanel />
    </SiteShell>
  );
}
