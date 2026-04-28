import { getSupabaseServerClient } from "@/lib/supabaseClient";
import type {
  DailyBrief,
  EnterpriseAction,
  EnterpriseActionPriority,
  EnterpriseActionStatus,
  Insight,
  InsightType,
  Post,
  Profile,
  Sweep,
  Workspace,
  WorkspaceSource,
  SourceType,
} from "@/lib/community/types";
import { slugify, slugWithSuffix } from "@/lib/community/slug";

/** Ensure a `profiles` row exists for this Supabase auth user. */
export async function ensureProfile(
  userId: string,
  email: string | null,
  fullName: string | null,
): Promise<Profile> {
  const sb = getSupabaseServerClient();
  const { data: existing } = await sb
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle<Profile>();
  if (existing) return existing;
  const fallback = (email || "user").split("@")[0] || `user_${userId.slice(0, 8)}`;
  const base = slugify(fallback);
  let username = base;
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data, error } = await sb
      .from("profiles")
      .insert({ id: userId, username, display_name: fullName || base })
      .select("*")
      .single<Profile>();
    if (data) return data;
    if (error && /unique/i.test(error.message)) {
      username = `${base}_${Math.random().toString(36).slice(2, 6)}`;
      continue;
    }
    throw new Error(error?.message || "ensureProfile failed");
  }
  throw new Error("could not allocate a unique username after 5 tries");
}

export async function listWorkspaces(userId: string): Promise<Workspace[]> {
  const sb = getSupabaseServerClient();
  const { data, error } = await sb
    .from("workspaces")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data as Workspace[]) || [];
}

export async function getWorkspace(
  userId: string,
  id: string,
): Promise<Workspace | null> {
  const sb = getSupabaseServerClient();
  const { data } = await sb
    .from("workspaces")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle<Workspace>();
  return data || null;
}

export async function createWorkspace(input: {
  userId: string;
  name: string;
  topic?: string;
  description?: string;
  isPublic?: boolean;
}): Promise<Workspace> {
  const sb = getSupabaseServerClient();
  const slug = slugWithSuffix(input.name);
  const { data, error } = await sb
    .from("workspaces")
    .insert({
      user_id: input.userId,
      name: input.name,
      slug,
      description: input.description || null,
      topic: input.topic || null,
      is_public: input.isPublic ?? true,
    })
    .select("*")
    .single<Workspace>();
  if (error || !data) throw new Error(error?.message || "create failed");
  return data;
}

export async function updateWorkspace(
  userId: string,
  id: string,
  patch: Partial<Pick<Workspace, "name" | "description" | "topic" | "is_public" | "status">>,
): Promise<Workspace> {
  const sb = getSupabaseServerClient();
  const { data, error } = await sb
    .from("workspaces")
    .update(patch)
    .eq("id", id)
    .eq("user_id", userId)
    .select("*")
    .single<Workspace>();
  if (error || !data) throw new Error(error?.message || "update failed");
  return data;
}

export async function deleteWorkspace(userId: string, id: string): Promise<void> {
  const sb = getSupabaseServerClient();
  const { error } = await sb.from("workspaces").delete().eq("id", id).eq("user_id", userId);
  if (error) throw new Error(error.message);
}

export async function listSources(workspaceId: string): Promise<WorkspaceSource[]> {
  const sb = getSupabaseServerClient();
  const { data, error } = await sb
    .from("workspace_sources")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data as WorkspaceSource[]) || [];
}

export async function addSource(input: {
  workspaceId: string;
  sourceType: SourceType;
  config?: Record<string, unknown>;
}): Promise<WorkspaceSource> {
  const sb = getSupabaseServerClient();
  const { data, error } = await sb
    .from("workspace_sources")
    .insert({
      workspace_id: input.workspaceId,
      source_type: input.sourceType,
      config: input.config ?? {},
      is_active: true,
    })
    .select("*")
    .single<WorkspaceSource>();
  if (error || !data) throw new Error(error?.message || "add source failed");
  return data;
}

export async function removeSource(id: string): Promise<void> {
  const sb = getSupabaseServerClient();
  const { error } = await sb.from("workspace_sources").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// ── Insights / posts / sweeps ───────────────────────────────────────────────

export async function listInsights(
  workspaceId: string,
  opts: { type?: InsightType; limit?: number } = {},
): Promise<Insight[]> {
  const sb = getSupabaseServerClient();
  let q = sb
    .from("insights")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("frequency_pct", { ascending: false });
  if (opts.type) q = q.eq("insight_type", opts.type);
  if (opts.limit) q = q.limit(opts.limit);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data as Insight[]) || [];
}

export async function listPosts(
  workspaceId: string,
  limit = 50,
): Promise<Post[]> {
  const sb = getSupabaseServerClient();
  const { data, error } = await sb
    .from("posts")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("indexed_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data as Post[]) || [];
}

export async function getLatestSweep(workspaceId: string): Promise<Sweep | null> {
  const sb = getSupabaseServerClient();
  const { data } = await sb
    .from("sweeps")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle<Sweep>();
  return data || null;
}

export async function getSweepById(
  userId: string,
  id: string,
): Promise<Sweep | null> {
  const sb = getSupabaseServerClient();
  const { data } = await sb
    .from("sweeps")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle<Sweep>();
  return data || null;
}

// ── Daily brief + activity actions ───────────────────────────────────────────

export async function buildDailyBrief(workspaceId: string): Promise<DailyBrief> {
  const insights = await listInsights(workspaceId, { limit: 300 });
  const now = Date.now();
  const since24h = now - 24 * 60 * 60 * 1000;
  const totals = {
    insights: insights.length,
    pains: insights.filter((i) => i.insight_type === "pain").length,
    requests: insights.filter((i) => i.insight_type === "request").length,
    workarounds: insights.filter((i) => i.insight_type === "workaround").length,
    praise: insights.filter((i) => i.insight_type === "praise").length,
  };

  const newInsights = insights
    .filter((i) => new Date(i.created_at).getTime() >= since24h)
    .slice(0, 12)
    .map((i) => ({
      id: i.id,
      insight_type: i.insight_type,
      title: i.title,
      frequency_pct: i.frequency_pct,
      created_at: i.created_at,
    }));

  const rising = [...insights]
    .sort((a, b) => (b.frequency_pct || 0) - (a.frequency_pct || 0))
    .slice(0, 10)
    .map((i) => ({
      id: i.id,
      insight_type: i.insight_type,
      title: i.title,
      frequency_pct: i.frequency_pct,
      frequency: i.frequency,
    }));

  return {
    workspace_id: workspaceId,
    generated_at: new Date().toISOString(),
    totals,
    new_insights_24h: newInsights,
    rising_gaps: rising,
  };
}

type EnterpriseActionRow = {
  id: string;
  workspace_id: string;
  insight_id: string | null;
  owner_user_id: string;
  owner_name: string | null;
  title: string;
  notes: string | null;
  priority: EnterpriseActionPriority;
  status: EnterpriseActionStatus;
  due_at: string | null;
  created_at: string;
  updated_at: string;
};

export async function listEnterpriseActions(workspaceId: string): Promise<EnterpriseAction[]> {
  const sb = getSupabaseServerClient();
  const { data, error } = await sb
    .from("enterprise_actions")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data as EnterpriseActionRow[]) || [];
}

export async function createEnterpriseAction(input: {
  workspaceId: string;
  ownerUserId: string;
  ownerName?: string | null;
  title: string;
  notes?: string | null;
  priority?: EnterpriseActionPriority;
  status?: EnterpriseActionStatus;
  dueAt?: string | null;
  insightId?: string | null;
}): Promise<EnterpriseAction> {
  const sb = getSupabaseServerClient();
  const { data, error } = await sb
    .from("enterprise_actions")
    .insert({
      workspace_id: input.workspaceId,
      owner_user_id: input.ownerUserId,
      owner_name: input.ownerName || null,
      title: input.title,
      notes: input.notes || null,
      priority: input.priority || "medium",
      status: input.status || "open",
      due_at: input.dueAt || null,
      insight_id: input.insightId || null,
    })
    .select("*")
    .single<EnterpriseActionRow>();
  if (error || !data) throw new Error(error?.message || "create enterprise action failed");
  return data;
}

export async function updateEnterpriseAction(input: {
  workspaceId: string;
  actionId: string;
  patch: Partial<
    Pick<EnterpriseAction, "title" | "notes" | "priority" | "status" | "due_at" | "insight_id">
  >;
}): Promise<EnterpriseAction> {
  const sb = getSupabaseServerClient();
  const { data, error } = await sb
    .from("enterprise_actions")
    .update(input.patch)
    .eq("id", input.actionId)
    .eq("workspace_id", input.workspaceId)
    .select("*")
    .single<EnterpriseActionRow>();
  if (error || !data) throw new Error(error?.message || "update enterprise action failed");
  return data;
}

export async function deleteEnterpriseAction(workspaceId: string, actionId: string): Promise<void> {
  const sb = getSupabaseServerClient();
  const { error } = await sb
    .from("enterprise_actions")
    .delete()
    .eq("id", actionId)
    .eq("workspace_id", workspaceId);
  if (error) throw new Error(error.message);
}
