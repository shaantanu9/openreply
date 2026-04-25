import type { Metadata } from "next";
import { SiteShell } from "@/components/shell/SiteShell";
import { WorkspaceDetailPanel } from "@/components/workspaces/WorkspaceDetailPanel";

export const metadata: Metadata = {
  title: "Gap Map — Workspace",
};

export const dynamic = "force-dynamic";

export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <SiteShell navVariant="compact" withFooter={false}>
      <WorkspaceDetailPanel workspaceId={id} />
    </SiteShell>
  );
}
