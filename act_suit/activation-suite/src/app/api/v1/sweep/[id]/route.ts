import { NextResponse } from "next/server";
import { requireSession } from "@/lib/community/routeAuth";
import { getSweepById } from "@/lib/community/workspaces";

export const runtime = "nodejs";

/**
 * Poll-style sweep status endpoint.
 *
 * For a proper SSE stream we'd set `Content-Type: text/event-stream` and push
 * `progress_pct` updates. The stub pipeline finishes in a single request
 * cycle, so polling is enough here — the UI calls this every 1s until the
 * response's `status` is `complete` or `failed`.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireSession(req);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const sweep = await getSweepById(auth.userId, id);
  if (!sweep) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true, sweep });
}
