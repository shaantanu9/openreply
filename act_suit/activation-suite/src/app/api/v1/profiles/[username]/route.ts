import { NextResponse } from "next/server";
import { getSupabaseServerClient, hasSupabaseConfig } from "@/lib/supabaseClient";
import type { Profile, PublishedResearch } from "@/lib/community/types";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ username: string }> },
) {
  if (!hasSupabaseConfig()) {
    return NextResponse.json({ ok: false, error: "supabase required" }, { status: 503 });
  }
  const { username } = await ctx.params;
  const sb = getSupabaseServerClient();
  const { data: profile } = await sb
    .from("profiles")
    .select("*")
    .ilike("username", username)
    .maybeSingle<Profile>();
  if (!profile) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }
  const { data: published } = await sb
    .from("published_research")
    .select("*")
    .eq("user_id", profile.id)
    .order("published_at", { ascending: false });
  return NextResponse.json({
    ok: true,
    profile,
    published: (published as PublishedResearch[]) || [],
  });
}
