// Wire types mirroring docs/licence/openreply-dual-app-spec.md §4.3 tables.
// Keep in sync with the Supabase schema; any new column goes both places.

export type SourceType =
  | "reddit"
  | "hackernews"
  | "g2"
  | "twitter"
  | "arxiv"
  | "appstore"
  | "producthunt"
  | "devto"
  | "capterra"
  | "trustpilot"
  | "github_issues"
  | "rss"
  | "custom_inject";

export type InsightType = "pain" | "workaround" | "request" | "praise";
export type ByokProvider = "anthropic" | "openai" | "gemini";

export type Profile = {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  website: string | null;
  twitter_handle: string | null;
  research_count: number;
  follower_count: number;
  is_verified: boolean;
  created_at: string;
  updated_at: string;
};

export type Workspace = {
  id: string;
  user_id: string;
  name: string;
  slug: string | null;
  description: string | null;
  topic: string | null;
  is_public: boolean;
  status: "active" | "archived";
  last_sweep_at: string | null;
  post_count: number;
  insight_count: number;
  created_at: string;
  updated_at: string;
};

export type WorkspaceSource = {
  id: string;
  workspace_id: string;
  source_type: SourceType;
  config: Record<string, unknown> | null;
  is_active: boolean;
  created_at: string;
};

export type Post = {
  id: string;
  workspace_id: string;
  sweep_id: string | null;
  source_type: SourceType;
  source_url: string | null;
  source_id: string | null;
  title: string | null;
  body: string | null;
  author: string | null;
  published_at: string | null;
  score: number | null;
  indexed_at: string;
};

export type Insight = {
  id: string;
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
  created_at: string;
};

export type Sweep = {
  id: string;
  workspace_id: string;
  user_id: string | null;
  status: "running" | "complete" | "failed";
  sources_swept: SourceType[];
  posts_indexed: number;
  insights_found: number;
  progress_pct: number;
  started_at: string;
  completed_at: string | null;
  error_message: string | null;
};

export type EnterpriseActionStatus = "open" | "in_progress" | "done" | "blocked";
export type EnterpriseActionPriority = "low" | "medium" | "high" | "critical";

export type EnterpriseAction = {
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

export type DailyBrief = {
  workspace_id: string;
  generated_at: string;
  totals: {
    insights: number;
    pains: number;
    requests: number;
    workarounds: number;
    praise: number;
  };
  new_insights_24h: Array<{
    id: string;
    insight_type: InsightType;
    title: string;
    frequency_pct: number;
    created_at: string;
  }>;
  rising_gaps: Array<{
    id: string;
    insight_type: InsightType;
    title: string;
    frequency_pct: number;
    frequency: number;
  }>;
};

export type PublishedResearch = {
  id: string;
  workspace_id: string;
  user_id: string | null;
  slug: string;
  title: string;
  description: string | null;
  insights_snapshot: InsightsSnapshot | null;
  source_types: string[];
  post_count: number;
  insight_count: number;
  view_count: number;
  upvote_count: number;
  is_featured: boolean;
  pro_publish: boolean;
  published_at: string;
  updated_at: string;
};

/**
 * What gets written into `published_research.insights_snapshot`.
 * Note: raw source post text NEVER appears here (§6.2).
 */
export type InsightsSnapshot = {
  title: string;
  topic: string | null;
  sources: SourceType[];
  post_count: number;
  sweep_date: string;
  insights: Array<{
    type: InsightType;
    title: string;
    description: string | null;
    frequency_pct: number;
    severity: number | null;
    mention_count: number;
    tags: string[];
  }>;
  workarounds: Array<{
    title: string;
    description: string | null;
    mention_count: number;
  }>;
  published_by: string; // username or "pro_user"
  powered_by: "OpenReply Community" | "OpenReply Pro";
};

export type ByokKey = {
  id: string;
  user_id: string;
  provider: ByokProvider;
  encrypted_key: string;
  key_preview: string | null;
  created_at: string;
  updated_at: string;
};
