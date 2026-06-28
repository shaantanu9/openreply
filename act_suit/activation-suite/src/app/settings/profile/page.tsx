import type { Metadata } from "next";
import { SiteShell } from "@/components/shell/SiteShell";
import { ProfileSettingsPanel } from "@/components/settings/ProfileSettingsPanel";

export const metadata: Metadata = { title: "OpenReply — Profile" };
export const dynamic = "force-dynamic";

export default function ProfileSettingsPage() {
  return (
    <SiteShell navVariant="compact" withFooter={false}>
      <ProfileSettingsPanel />
    </SiteShell>
  );
}
