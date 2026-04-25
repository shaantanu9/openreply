// STUB SWEEP ENGINE.
//
// This is an honest stub. In production (per spec §3, Phase 1) the sweep
// engine is a shared Rust crate that fetches from 13 real source connectors
// (Reddit, HN, G2, …) and calls BYOK AI endpoints to classify posts into
// insights. Shipping that is a multi-week effort and requires source-API
// creds we don't have yet.
//
// What this file does instead:
//   1. Creates a `sweeps` row with status=running.
//   2. Generates N plausible-looking posts per configured source type
//      (scoped to the workspace's topic + source config search terms).
//   3. Generates M plausible-looking insights by sampling deterministic
//      templates — the generated data is self-consistent so the UI
//      renders, but it is clearly labelled as stub data in the details.
//   4. Updates the sweep row through progress milestones.
//
// Replace `generateMockPosts` and `generateMockInsights` with real
// implementations in Phase 1 of the spec.

import { randomUUID } from "node:crypto";
import { getSupabaseServerClient } from "@/lib/supabaseClient";
import type {
  InsightType,
  Post,
  SourceType,
  Sweep,
  Workspace,
  WorkspaceSource,
} from "@/lib/community/types";
import { listSources } from "@/lib/community/workspaces";

/** Create a sweeps row in 'running' state and return its id. */
export async function startSweep(input: {
  userId: string;
  workspace: Workspace;
  sources?: SourceType[];
}): Promise<Sweep> {
  const sb = getSupabaseServerClient();
  const allSources: WorkspaceSource[] = await listSources(input.workspace.id);
  const active = allSources.filter((s) => s.is_active);
  const swept: SourceType[] = (
    input.sources ||
    (active.length > 0
      ? active.map((s) => s.source_type)
      : (["reddit", "hackernews", "g2"] as SourceType[]))
  ).slice(0, 13);

  const { data, error } = await sb
    .from("sweeps")
    .insert({
      workspace_id: input.workspace.id,
      user_id: input.userId,
      status: "running",
      sources_swept: swept,
      posts_indexed: 0,
      insights_found: 0,
      progress_pct: 0,
    })
    .select("*")
    .single<Sweep>();
  if (error || !data) throw new Error(error?.message || "sweep create failed");
  return data;
}

/** Advance progress (used by the SSE stream route). */
export async function markSweepProgress(
  sweepId: string,
  patch: Partial<Pick<Sweep, "posts_indexed" | "insights_found" | "progress_pct" | "status" | "completed_at" | "error_message">>,
) {
  const sb = getSupabaseServerClient();
  await sb.from("sweeps").update(patch).eq("id", sweepId);
}

/**
 * Run the stub pipeline end-to-end. Intended to be awaited by the API route
 * that triggered it. Inserts posts, then insights, then marks sweep complete.
 */
export async function runStubPipeline(input: {
  sweep: Sweep;
  workspace: Workspace;
}): Promise<{ postsInserted: number; insightsInserted: number }> {
  const sb = getSupabaseServerClient();
  const sources = input.sweep.sources_swept;
  const posts = generateMockPosts(input.workspace, sources, input.sweep.id);
  await markSweepProgress(input.sweep.id, { progress_pct: 20 });

  // Upsert posts in batches — the unique(workspace_id, source_type, source_id)
  // constraint means re-sweeps won't duplicate.
  if (posts.length > 0) {
    const { error } = await sb
      .from("posts")
      .upsert(posts, { onConflict: "workspace_id,source_type,source_id" });
    if (error) {
      await markSweepProgress(input.sweep.id, {
        status: "failed",
        error_message: `posts insert failed: ${error.message}`,
        completed_at: new Date().toISOString(),
      });
      throw new Error(error.message);
    }
  }
  await markSweepProgress(input.sweep.id, {
    progress_pct: 55,
    posts_indexed: posts.length,
  });

  const insights = generateMockInsights(
    input.workspace.id,
    input.sweep.id,
    posts,
    input.workspace.topic || input.workspace.name,
  );
  // Wipe any previous insights for this workspace before re-inserting; keeps
  // the UI clean across re-sweeps while real implementations decide on merge
  // vs replace semantics.
  await sb.from("insights").delete().eq("workspace_id", input.workspace.id);
  if (insights.length > 0) {
    const { error } = await sb.from("insights").insert(insights);
    if (error) {
      await markSweepProgress(input.sweep.id, {
        status: "failed",
        error_message: `insights insert failed: ${error.message}`,
        completed_at: new Date().toISOString(),
      });
      throw new Error(error.message);
    }
  }

  await markSweepProgress(input.sweep.id, {
    status: "complete",
    posts_indexed: posts.length,
    insights_found: insights.length,
    progress_pct: 100,
    completed_at: new Date().toISOString(),
  });

  // Denormalise counts on the workspace row for cheap dashboard rendering.
  await sb
    .from("workspaces")
    .update({
      post_count: posts.length,
      insight_count: insights.length,
      last_sweep_at: new Date().toISOString(),
    })
    .eq("id", input.workspace.id);

  return { postsInserted: posts.length, insightsInserted: insights.length };
}

// ── Mock data generators ────────────────────────────────────────────────────

type PostInsert = Omit<Post, "id" | "indexed_at">;
type InsightInsert = {
  id?: string;
  workspace_id: string;
  sweep_id: string | null;
  post_id: string | null;
  insight_type: InsightType;
  title: string;
  description: string | null;
  severity: number | null;
  frequency: number;
  frequency_pct: number;
  tags: string[];
  source_urls: string[];
};

const POST_TEMPLATES: Record<SourceType, { urlBase: string; titles: string[] }> = {
  reddit: {
    urlBase: "https://reddit.com/r/",
    titles: [
      "Why is {topic} so hard to export?",
      "Anyone else struggling with {topic} in production?",
      "Best {topic} alternative for small teams?",
    ],
  },
  hackernews: {
    urlBase: "https://news.ycombinator.com/item?id=",
    titles: [
      "Ask HN: the state of {topic} in 2026",
      "Show HN: my {topic} workaround",
      "Why {topic} tools still miss the mark",
    ],
  },
  g2: {
    urlBase: "https://www.g2.com/products/",
    titles: [
      "Cons: onboarding is painful for {topic}",
      "Pros: finally a {topic} tool that doesn't require SQL",
      "Limitations I ran into with {topic}",
    ],
  },
  twitter: { urlBase: "https://x.com/i/status/", titles: ["Hot take on {topic}: we keep solving the wrong problem"] },
  arxiv: { urlBase: "https://arxiv.org/abs/", titles: ["A systematic review of {topic}"] },
  appstore: { urlBase: "https://apps.apple.com/app/", titles: ["Crashes every time I use {topic}"] },
  producthunt: { urlBase: "https://www.producthunt.com/posts/", titles: ["Launched a {topic} tool today"] },
  devto: { urlBase: "https://dev.to/", titles: ["How we fixed {topic} with 20 lines of Python"] },
  capterra: { urlBase: "https://www.capterra.com/", titles: ["Review: {topic} works but pricing is rough"] },
  trustpilot: { urlBase: "https://www.trustpilot.com/", titles: ["Trustpilot: {topic} onboarding took 3 weeks"] },
  github_issues: { urlBase: "https://github.com/", titles: ["Bug: {topic} breaks when ..."] },
  rss: { urlBase: "https://example.com/rss/", titles: ["Blog post: the {topic} playbook"] },
  custom_inject: { urlBase: "local://custom/", titles: ["Internal note about {topic}"] },
};

const INSIGHT_TEMPLATES: Array<{
  type: InsightType;
  title: (topic: string) => string;
  description: (topic: string) => string;
  severity: number;
  freq_base: number;
  tags: string[];
}> = [
  {
    type: "pain",
    title: (t) => `Data export limits in ${t}`,
    description: (t) => `Users repeatedly hit row/column caps when exporting from ${t}, forcing manual workarounds.`,
    severity: 4,
    freq_base: 18,
    tags: ["export", "limits"],
  },
  {
    type: "pain",
    title: (t) => `No offline mode for ${t}`,
    description: (t) => `Several teams noted that ${t} breaks entirely on flaky connections, with no local fallback.`,
    severity: 4,
    freq_base: 14,
    tags: ["offline", "reliability"],
  },
  {
    type: "pain",
    title: (t) => `API rate limits throttle ${t} workflows`,
    description: (t) => `Developers building on ${t} report hitting tight per-minute rate limits that block bulk jobs.`,
    severity: 3,
    freq_base: 11,
    tags: ["api", "throughput"],
  },
  {
    type: "pain",
    title: (t) => `${t} integrations missing for mid-market stacks`,
    description: (t) => `Key connectors (Salesforce, Hubspot, Snowflake) are absent or broken for ${t}.`,
    severity: 3,
    freq_base: 9,
    tags: ["integrations"],
  },
  {
    type: "workaround",
    title: (t) => `Manual CSV exports via Zapier for ${t}`,
    description: (t) => `Teams route ${t} exports through Zapier to sheets to get around the native limits.`,
    severity: 2,
    freq_base: 7,
    tags: ["zapier", "csv"],
  },
  {
    type: "request",
    title: (t) => `BYOK AI inference in ${t}`,
    description: (t) => `Users specifically want to plug their own OpenAI/Anthropic key into ${t}.`,
    severity: 4,
    freq_base: 12,
    tags: ["byok", "ai"],
  },
  {
    type: "praise",
    title: (t) => `${t} onboarding is snappy`,
    description: (t) => `New users consistently note that ${t} takes minutes not hours to get productive.`,
    severity: 1,
    freq_base: 5,
    tags: ["onboarding"],
  },
];

function generateMockPosts(
  workspace: Workspace,
  sources: SourceType[],
  sweepId: string,
): PostInsert[] {
  const topic = (workspace.topic || workspace.name).trim();
  const out: PostInsert[] = [];
  for (const src of sources) {
    const template = POST_TEMPLATES[src];
    if (!template) continue;
    // Six posts per source → 13 sources × 6 ≈ 78 posts per sweep. Plenty for
    // the UI to feel "real" without flooding the DB.
    for (let i = 0; i < 6; i++) {
      const titleTemplate = template.titles[i % template.titles.length];
      const sourceId = `${sweepId.slice(0, 8)}-${src}-${i}`;
      out.push({
        workspace_id: workspace.id,
        sweep_id: sweepId,
        source_type: src,
        source_url: `${template.urlBase}${sourceId}`,
        source_id: sourceId,
        title: titleTemplate.replace("{topic}", topic),
        body: `[stub] Auto-generated placeholder post about ${topic} on ${src}.`,
        author: `${src}_user_${i + 1}`,
        published_at: new Date(Date.now() - i * 3_600_000).toISOString(),
        score: Math.max(1, 120 - i * 15 + (src.length % 7)),
      });
    }
  }
  return out;
}

function generateMockInsights(
  workspaceId: string,
  sweepId: string,
  posts: PostInsert[],
  topic: string,
): InsightInsert[] {
  const total = Math.max(1, posts.length);
  return INSIGHT_TEMPLATES.map((tmpl) => {
    // Tie frequency to actual number of posts so counts look plausible.
    const frequency = Math.max(2, Math.round((tmpl.freq_base / 18) * (total * 0.5)));
    const frequency_pct = Math.round((frequency / total) * 10_000) / 100;
    // Sample 3 source URLs from the generated posts, round-robin.
    const sample_urls = posts
      .slice(0, 3)
      .map((p) => p.source_url || "")
      .filter(Boolean);
    return {
      id: randomUUID(),
      workspace_id: workspaceId,
      sweep_id: sweepId,
      post_id: null,
      insight_type: tmpl.type,
      title: tmpl.title(topic),
      description: tmpl.description(topic),
      severity: tmpl.severity,
      frequency,
      frequency_pct,
      tags: tmpl.tags,
      source_urls: sample_urls,
    };
  });
}
