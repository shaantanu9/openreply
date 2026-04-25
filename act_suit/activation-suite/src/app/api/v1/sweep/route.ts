import { NextResponse } from "next/server";
import { requireSession } from "@/lib/community/routeAuth";
import { getWorkspace } from "@/lib/community/workspaces";
import { runStubPipeline, startSweep } from "@/lib/community/sweepEngine";
import type { SourceType } from "@/lib/community/types";

export const runtime = "nodejs";

type StartSweepBody = {
  workspace_id?: string;
  sources?: SourceType[];
};

export async function POST(req: Request) {
  const auth = await requireSession(req);
  if (!auth.ok) return auth.response;

  let body: StartSweepBody;
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
  if (!ws) {
    return NextResponse.json({ ok: false, error: "workspace not found" }, { status: 404 });
  }

  const sweep = await startSweep({
    userId: auth.userId,
    workspace: ws,
    sources: body.sources,
  });

  // Fire-and-forget the stub pipeline. Realtime clients follow progress via
  // GET /api/v1/sweep/[id]; we return 202 Accepted with the sweep id now.
  //
  // In a production run you'd enqueue this to a proper worker (BullMQ / QStash
  // / Supabase Edge Function). For the stub, a promise is good enough — Vercel
  // kills the function when the response is sent, but the stub is synchronous
  // enough to finish inline in ~50ms.
  try {
    await runStubPipeline({ sweep, workspace: ws });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "sweep failed",
        sweep_id: sweep.id,
      },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true, sweep_id: sweep.id, status: "complete" }, { status: 202 });
}
