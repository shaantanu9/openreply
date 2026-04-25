import type { Metadata } from "next";
import { SiteShell } from "@/components/shell/SiteShell";
import { WorkspacesPanel } from "@/components/workspaces/WorkspacesPanel";

export const metadata: Metadata = {
  title: "Gap Map — Workspaces",
};

export const dynamic = "force-dynamic";

export default function WorkspacesPage() {
  return (
    <SiteShell navVariant="compact" withFooter={false}>
      <WorkspacesPanel />
    </SiteShell>
  );
}
