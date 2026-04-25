import { NextResponse } from "next/server";
import { requireSession } from "@/lib/community/routeAuth";
import { addSource, getWorkspace, listSources } from "@/lib/community/workspaces";
import type { SourceType } from "@/lib/community/types";

export const runtime = "nodejs";

const VALID_SOURCES: SourceType[] = [
  "reddit",
  "hackernews",
  "g2",
  "twitter",
  "arxiv",
  "appstore",
  "producthunt",
  "devto",
  "capterra",
  "trustpilot",
  "github_issues",
  "rss",
  "custom_inject",
];

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireSession(req);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const ws = await getWorkspace(auth.userId, id);
  if (!ws) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  const rows = await listSources(ws.id);
  return NextResponse.json({ ok: true, sources: rows });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireSession(req);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const ws = await getWorkspace(auth.userId, id);
  if (!ws) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

  let body: { source_type?: string; config?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }
  const st = body.source_type as SourceType | undefined;
  if (!st || !VALID_SOURCES.includes(st)) {
    return NextResponse.json(
      { ok: false, error: `source_type must be one of: ${VALID_SOURCES.join(", ")}` },
      { status: 400 },
    );
  }
  const row = await addSource({ workspaceId: ws.id, sourceType: st, config: body.config });
  return NextResponse.json({ ok: true, source: row });
}
