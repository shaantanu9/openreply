import { NextResponse } from "next/server";
import { requireSession } from "@/lib/community/routeAuth";
import { getWorkspace, listInsights } from "@/lib/community/workspaces";
import type { InsightType } from "@/lib/community/types";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireSession(req);
  if (!auth.ok) return auth.response;
  const url = new URL(req.url);
  const wsId = url.searchParams.get("workspace_id") || "";
  const type = url.searchParams.get("type") as InsightType | null;
  const limit = Number(url.searchParams.get("limit") || "100");
  if (!wsId) {
    return NextResponse.json({ ok: false, error: "workspace_id required" }, { status: 400 });
  }
  const ws = await getWorkspace(auth.userId, wsId);
  if (!ws) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  const rows = await listInsights(ws.id, { type: type || undefined, limit });
  return NextResponse.json({ ok: true, insights: rows });
}
