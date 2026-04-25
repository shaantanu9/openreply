import { getSupabaseServerClient } from "@/lib/supabaseClient";
import type {
  Insight,
  InsightsSnapshot,
  PublishedResearch,
  SourceType,
  Workspace,
} from "@/lib/community/types";
import { listInsights } from "@/lib/community/workspaces";
import { slugify } from "@/lib/community/slug";

/**
 * Build the publishable snapshot for a workspace. Raw source post text is
 * NEVER included — only the structured, extracted insights (§6.2).
 */
export async function buildInsightsSnapshot(
  workspace: Workspace,
  publishedBy: string,
  poweredBy: "Gap Map Community" | "Gap Map Pro" = "Gap Map Community",
): Promise<InsightsSnapshot> {
  const sb = getSupabaseServerClient();
  const insights: Insight[] = await listInsights(workspace.id);
  // Source types come from the posts table directly — more reliable than
  // guessing from URLs and correctly reflects what was actually swept.
  const { data: sourceRows } = await sb
    .from("posts")
    .select("source_type")
    .eq("workspace_id", workspace.id);
  const sourceTypes = Array.from(
    new Set(((sourceRows as Array<{ source_type: string }> | null) || []).map((r) => r.source_type)),
  ) as SourceType[];

  return {
    title: workspace.name,
    topic: workspace.topic,
    sources: sourceTypes,
    post_count: workspace.post_count,
    sweep_date: workspace.last_sweep_at || new Date().toISOString(),
    insights: insights
      .filter((i) => i.insight_type === "pain" || i.insight_type === "request" || i.insight_type === "praise")
      .map((i) => ({
        type: i.insight_type,
        title: i.title,
        description: i.description,
        frequency_pct: i.frequency_pct,
        severity: i.severity,
        mention_count: i.frequency,
        tags: i.tags || [],
      })),
    workarounds: insights
      .filter((i) => i.insight_type === "workaround")
      .map((i) => ({
        title: i.title,
        description: i.description,
        mention_count: i.frequency,
      })),
    published_by: publishedBy,
    powered_by: poweredBy,
  };
}

export async function publishWorkspace(input: {
  userId: string | null;
  workspace: Workspace;
  publishedBy: string;
  poweredBy?: "Gap Map Community" | "Gap Map Pro";
}): Promise<PublishedResearch> {
  const sb = getSupabaseServerClient();
  const snapshot = await buildInsightsSnapshot(
    input.workspace,
    input.publishedBy,
    input.poweredBy || "Gap Map Community",
  );
  const slug = input.workspace.slug || slugify(input.workspace.name);

  // Upsert: keep the same row across re-publishes so SEO + view count survive.
  const { data: existing } = await sb
    .from("published_research")
    .select("id")
    .eq("workspace_id", input.workspace.id)
    .maybeSingle<{ id: string }>();

  if (existing) {
    const { data, error } = await sb
      .from("published_research")
      .update({
        title: input.workspace.name,
        description: input.workspace.description,
        insights_snapshot: snapshot,
        source_types: snapshot.sources,
        post_count: snapshot.post_count,
        insight_count: snapshot.insights.length + snapshot.workarounds.length,
        user_id: input.userId,
        pro_publish: input.poweredBy === "Gap Map Pro",
      })
      .eq("id", existing.id)
      .select("*")
      .single<PublishedResearch>();
    if (error || !data) throw new Error(error?.message || "publish update failed");
    return data;
  }

  const { data, error } = await sb
    .from("published_research")
    .insert({
      workspace_id: input.workspace.id,
      user_id: input.userId,
      slug,
      title: input.workspace.name,
      description: input.workspace.description,
      insights_snapshot: snapshot,
      source_types: snapshot.sources,
      post_count: snapshot.post_count,
      insight_count: snapshot.insights.length + snapshot.workarounds.length,
      pro_publish: input.poweredBy === "Gap Map Pro",
    })
    .select("*")
    .single<PublishedResearch>();
  if (error || !data) throw new Error(error?.message || "publish failed");
  return data;
}

export async function unpublishWorkspace(
  userId: string,
  workspaceId: string,
): Promise<boolean> {
  const sb = getSupabaseServerClient();
  const { error, count } = await sb
    .from("published_research")
    .delete({ count: "exact" })
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  return (count || 0) > 0;
}

export async function listPublishedFeed(
  opts: { limit?: number; featured?: boolean } = {},
): Promise<PublishedResearch[]> {
  const sb = getSupabaseServerClient();
  let q = sb
    .from("published_research")
    .select("*")
    .order("published_at", { ascending: false });
  if (opts.featured) q = q.eq("is_featured", true);
  if (opts.limit) q = q.limit(opts.limit);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data as PublishedResearch[]) || [];
}

export async function getPublishedBySlug(slug: string): Promise<PublishedResearch | null> {
  const sb = getSupabaseServerClient();
  const { data } = await sb
    .from("published_research")
    .select("*")
    .eq("slug", slug)
    .maybeSingle<PublishedResearch>();
  // Fire-and-forget view_count bump (best-effort; RLS allows public read only,
  // so this uses the service-role client).
  if (data) {
    await sb
      .from("published_research")
      .update({ view_count: data.view_count + 1 })
      .eq("id", data.id);
  }
  return data || null;
}

export async function getProfileByUsername(username: string) {
  const sb = getSupabaseServerClient();
  const { data } = await sb
    .from("profiles")
    .select("*")
    .ilike("username", username)
    .maybeSingle();
  return data;
}
