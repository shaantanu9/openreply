import { NextResponse } from "next/server";
import { requireSession } from "@/lib/community/routeAuth";
import { getWorkspace, updateWorkspace } from "@/lib/community/workspaces";
import { publishWorkspace } from "@/lib/community/publish";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const auth = await requireSession(req);
  if (!auth.ok) return auth.response;

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
  let ws = await getWorkspace(auth.userId, wsId);
  if (!ws) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

  // Ensure the workspace is marked public in case the user triggered publish
  // while it was private — the publish intent is explicit.
  if (!ws.is_public) ws = await updateWorkspace(auth.userId, ws.id, { is_public: true });

  try {
    const published = await publishWorkspace({
      userId: auth.userId,
      workspace: ws,
      publishedBy: auth.profile.username,
      poweredBy: auth.isPaidPlan ? "Gap Map Pro" : "Gap Map Community",
    });
    return NextResponse.json({ ok: true, published });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "publish failed" },
      { status: 500 },
    );
  }
}
