import { NextResponse } from "next/server";
import { requireSession } from "@/lib/community/routeAuth";
import { createWorkspace, listWorkspaces } from "@/lib/community/workspaces";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireSession(req);
  if (!auth.ok) return auth.response;
  const rows = await listWorkspaces(auth.userId);
  return NextResponse.json({ ok: true, workspaces: rows });
}

export async function POST(req: Request) {
  const auth = await requireSession(req);
  if (!auth.ok) return auth.response;

  let body: {
    name?: string;
    topic?: string;
    description?: string;
    is_public?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }
  const name = (body.name || "").trim();
  if (!name) {
    return NextResponse.json({ ok: false, error: "name required" }, { status: 400 });
  }
  try {
    const ws = await createWorkspace({
      userId: auth.userId,
      name,
      topic: body.topic?.trim() || undefined,
      description: body.description?.trim() || undefined,
      isPublic: body.is_public ?? true,
    });
    return NextResponse.json({ ok: true, workspace: ws });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "create failed" },
      { status: 500 },
    );
  }
}
