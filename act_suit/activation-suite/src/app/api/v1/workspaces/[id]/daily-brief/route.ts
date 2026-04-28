import { NextResponse } from "next/server";
import { requireSession } from "@/lib/community/routeAuth";
import { buildDailyBrief, getWorkspace } from "@/lib/community/workspaces";

export const runtime = "nodejs";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireSession(req);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const ws = await getWorkspace(auth.userId, id);
  if (!ws) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }
  try {
    const brief = await buildDailyBrief(ws.id);
    return NextResponse.json({ ok: true, brief });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "daily brief failed" },
      { status: 500 },
    );
  }
}
