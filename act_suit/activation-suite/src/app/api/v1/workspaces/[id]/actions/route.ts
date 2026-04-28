import { NextResponse } from "next/server";
import { requireSession } from "@/lib/community/routeAuth";
import {
  createEnterpriseAction,
  getWorkspace,
  listEnterpriseActions,
} from "@/lib/community/workspaces";
import type {
  EnterpriseActionPriority,
  EnterpriseActionStatus,
} from "@/lib/community/types";

export const runtime = "nodejs";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireSession(req);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const ws = await getWorkspace(auth.userId, id);
  if (!ws) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  const actions = await listEnterpriseActions(ws.id);
  return NextResponse.json({ ok: true, actions });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireSession(req);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const ws = await getWorkspace(auth.userId, id);
  if (!ws) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

  let body: {
    title?: string;
    notes?: string;
    priority?: EnterpriseActionPriority;
    status?: EnterpriseActionStatus;
    due_at?: string | null;
    insight_id?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }
  const title = (body.title || "").trim();
  if (!title) {
    return NextResponse.json({ ok: false, error: "title required" }, { status: 400 });
  }
  try {
    const action = await createEnterpriseAction({
      workspaceId: ws.id,
      ownerUserId: auth.userId,
      ownerName: auth.profile.display_name || auth.profile.username,
      title,
      notes: body.notes?.trim() || null,
      priority: body.priority || "medium",
      status: body.status || "open",
      dueAt: body.due_at || null,
      insightId: body.insight_id || null,
    });
    return NextResponse.json({ ok: true, action });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "create action failed" },
      { status: 500 },
    );
  }
}
