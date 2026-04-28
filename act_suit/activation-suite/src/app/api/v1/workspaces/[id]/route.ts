import { NextResponse } from "next/server";
import { requireSession } from "@/lib/community/routeAuth";
import {
  deleteWorkspace,
  getWorkspace,
  listInsights,
  listPosts,
  listSources,
  updateWorkspace,
  getLatestSweep,
} from "@/lib/community/workspaces";

export const runtime = "nodejs";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireSession(req);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const ws = await getWorkspace(auth.userId, id);
  if (!ws) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }
  const [sources, posts, insights, latestSweep] = await Promise.all([
    listSources(ws.id),
    listPosts(ws.id, 25),
    listInsights(ws.id),
    getLatestSweep(ws.id),
  ]);
  return NextResponse.json({
    ok: true,
    workspace: ws,
    sources,
    posts,
    insights,
    latest_sweep: latestSweep,
  });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireSession(req);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }
  const patch: Record<string, unknown> = {};
  if (typeof body.name === "string") patch.name = body.name.trim();
  if (typeof body.topic === "string") patch.topic = body.topic.trim();
  if (typeof body.description === "string") patch.description = body.description.trim();
  if (typeof body.is_public === "boolean") {
    if (body.is_public === false && !auth.isPaidPlan) {
      return NextResponse.json(
        {
          ok: false,
          error: "Private workspaces are available on paid plans only. Upgrade to Pro to keep research private.",
        },
        { status: 402 },
      );
    }
    patch.is_public = body.is_public;
  }
  if (body.status === "active" || body.status === "archived") patch.status = body.status;

  try {
    const ws = await updateWorkspace(
      auth.userId,
      id,
      patch as Parameters<typeof updateWorkspace>[2],
    );
    return NextResponse.json({ ok: true, workspace: ws });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "update failed" },
      { status: 500 },
    );
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireSession(req);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  try {
    await deleteWorkspace(auth.userId, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "delete failed" },
      { status: 500 },
    );
  }
}
