import { NextResponse } from "next/server";
import { requireSession } from "@/lib/community/routeAuth";
import { getWorkspace, updateWorkspace } from "@/lib/community/workspaces";
import { unpublishWorkspace } from "@/lib/community/publish";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const auth = await requireSession(req);
  if (!auth.ok) return auth.response;
  if (!auth.isPaidPlan) {
    return NextResponse.json(
      {
        ok: false,
        error: "Private workspaces are available on paid plans only. Upgrade to Pro to keep research private.",
      },
      { status: 402 },
    );
  }

  let body: { workspace_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }
  const wsId = body.workspace_id || "";
  if (!wsId) {
    return NextResponse.json({ ok: false, error: "workspace_id required" }, { status: 400 });
  }
  const ws = await getWorkspace(auth.userId, wsId);
  if (!ws) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

  const removed = await unpublishWorkspace(auth.userId, ws.id);
  await updateWorkspace(auth.userId, ws.id, { is_public: false });
  return NextResponse.json({ ok: true, removed });
}
