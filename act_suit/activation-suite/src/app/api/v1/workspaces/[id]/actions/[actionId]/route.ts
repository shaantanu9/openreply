import { NextResponse } from "next/server";
import { requireSession } from "@/lib/community/routeAuth";
import {
  deleteEnterpriseAction,
  getWorkspace,
  updateEnterpriseAction,
} from "@/lib/community/workspaces";
import type { EnterpriseAction } from "@/lib/community/types";

export const runtime = "nodejs";

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string; actionId: string }> },
) {
  const auth = await requireSession(req);
  if (!auth.ok) return auth.response;
  const { id, actionId } = await ctx.params;
  const ws = await getWorkspace(auth.userId, id);
  if (!ws) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

  let body: Partial<
    Pick<EnterpriseAction, "title" | "notes" | "priority" | "status" | "due_at" | "insight_id">
  >;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }
  if (body.title !== undefined) body.title = body.title.trim();
  if (body.notes !== undefined && body.notes !== null) body.notes = body.notes.trim();

  try {
    const action = await updateEnterpriseAction({
      workspaceId: ws.id,
      actionId,
      patch: body,
    });
    return NextResponse.json({ ok: true, action });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "update action failed" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string; actionId: string }> },
) {
  const auth = await requireSession(req);
  if (!auth.ok) return auth.response;
  const { id, actionId } = await ctx.params;
  const ws = await getWorkspace(auth.userId, id);
  if (!ws) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  try {
    await deleteEnterpriseAction(ws.id, actionId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "delete action failed" },
      { status: 500 },
    );
  }
}
