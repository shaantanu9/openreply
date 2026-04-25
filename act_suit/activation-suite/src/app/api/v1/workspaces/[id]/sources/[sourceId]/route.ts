import { NextResponse } from "next/server";
import { requireSession } from "@/lib/community/routeAuth";
import { getWorkspace, removeSource } from "@/lib/community/workspaces";

export const runtime = "nodejs";

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string; sourceId: string }> },
) {
  const auth = await requireSession(req);
  if (!auth.ok) return auth.response;
  const { id, sourceId } = await ctx.params;
  const ws = await getWorkspace(auth.userId, id);
  if (!ws) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  await removeSource(sourceId);
  return NextResponse.json({ ok: true });
}
