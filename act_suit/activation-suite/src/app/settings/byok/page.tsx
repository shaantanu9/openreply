import type { Metadata } from "next";
import { SiteShell } from "@/components/shell/SiteShell";
import { ByokPanel } from "@/components/settings/ByokPanel";

export const metadata: Metadata = { title: "Gap Map — BYOK keys" };
export const dynamic = "force-dynamic";

export default function ByokSettingsPage() {
  return (
    <SiteShell navVariant="compact" withFooter={false}>
      <ByokPanel />
    </SiteShell>
  );
}
