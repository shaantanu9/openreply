"use client";

import { getSupabaseBrowserClient } from "@/lib/supabaseBrowser";
import type {
  ByokProvider,
  DailyBrief,
  EnterpriseAction,
  EnterpriseActionPriority,
  EnterpriseActionStatus,
  Insight,
  Post,
  Sweep,
  SourceType,
  Workspace,
  WorkspaceSource,
} from "@/lib/community/types";

async function bearer(): Promise<Record<string, string>> {
  const sb = getSupabaseBrowserClient();
  const { data } = await sb.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sign in required.");
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = { ...(await bearer()), ...(init.headers || {}) };
  const res = await fetch(path, { ...init, headers });
  const body = await res.json().catch(() => ({ ok: false, error: `non-json ${res.status}` }));
  if (!res.ok || !body.ok) {
    throw new Error(body.error || `${path} failed (${res.status})`);
  }
  return body as T;
}

// ── Workspaces ──────────────────────────────────────────────────────────────

export async function listWorkspaces(): Promise<Workspace[]> {
  const body = await request<{ ok: true; workspaces: Workspace[] }>("/api/v1/workspaces");
  return body.workspaces;
}

export async function createWorkspace(input: {
  name: string;
  topic?: string;
  description?: string;
  is_public?: boolean;
}): Promise<Workspace> {
  const body = await request<{ ok: true; workspace: Workspace }>("/api/v1/workspaces", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return body.workspace;
}

export async function getWorkspaceBundle(id: string): Promise<{
  workspace: Workspace;
  sources: WorkspaceSource[];
  posts: Post[];
  insights: Insight[];
  latest_sweep: Sweep | null;
}> {
  return request(`/api/v1/workspaces/${id}`);
}

export async function updateWorkspace(
  id: string,
  patch: Partial<Pick<Workspace, "name" | "description" | "topic" | "is_public" | "status">>,
): Promise<Workspace> {
  const body = await request<{ ok: true; workspace: Workspace }>(`/api/v1/workspaces/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  return body.workspace;
}

export async function deleteWorkspace(id: string): Promise<void> {
  await request(`/api/v1/workspaces/${id}`, { method: "DELETE" });
}

// ── Sources ─────────────────────────────────────────────────────────────────

export async function addSource(
  workspaceId: string,
  sourceType: SourceType,
  config?: Record<string, unknown>,
): Promise<WorkspaceSource> {
  const body = await request<{ ok: true; source: WorkspaceSource }>(
    `/api/v1/workspaces/${workspaceId}/sources`,
    { method: "POST", body: JSON.stringify({ source_type: sourceType, config }) },
  );
  return body.source;
}

export async function removeSource(workspaceId: string, sourceId: string): Promise<void> {
  await request(`/api/v1/workspaces/${workspaceId}/sources/${sourceId}`, { method: "DELETE" });
}

// ── Sweeps ──────────────────────────────────────────────────────────────────

export async function startSweep(workspaceId: string, sources?: SourceType[]): Promise<string> {
  const body = await request<{ ok: true; sweep_id: string }>("/api/v1/sweep", {
    method: "POST",
    body: JSON.stringify({ workspace_id: workspaceId, sources }),
  });
  return body.sweep_id;
}

export async function getSweep(id: string): Promise<Sweep> {
  const body = await request<{ ok: true; sweep: Sweep }>(`/api/v1/sweep/${id}`);
  return body.sweep;
}

// ── Publish ─────────────────────────────────────────────────────────────────

export async function publishWorkspace(workspaceId: string) {
  return request<{ ok: true; published: { slug: string; id: string } }>("/api/v1/publish", {
    method: "POST",
    body: JSON.stringify({ workspace_id: workspaceId }),
  });
}

export async function unpublishWorkspace(workspaceId: string) {
  return request<{ ok: true; removed: boolean }>("/api/v1/unpublish", {
    method: "POST",
    body: JSON.stringify({ workspace_id: workspaceId }),
  });
}

// ── Daily brief + enterprise actions ────────────────────────────────────────

export async function getDailyBrief(workspaceId: string): Promise<DailyBrief> {
  const body = await request<{ ok: true; brief: DailyBrief }>(
    `/api/v1/workspaces/${workspaceId}/daily-brief`,
  );
  return body.brief;
}

export async function listEnterpriseActions(workspaceId: string): Promise<EnterpriseAction[]> {
  const body = await request<{ ok: true; actions: EnterpriseAction[] }>(
    `/api/v1/workspaces/${workspaceId}/actions`,
  );
  return body.actions;
}

export async function createEnterpriseAction(
  workspaceId: string,
  input: {
    title: string;
    notes?: string;
    priority?: EnterpriseActionPriority;
    status?: EnterpriseActionStatus;
    due_at?: string | null;
    insight_id?: string | null;
  },
): Promise<EnterpriseAction> {
  const body = await request<{ ok: true; action: EnterpriseAction }>(
    `/api/v1/workspaces/${workspaceId}/actions`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
  return body.action;
}

export async function updateEnterpriseAction(
  workspaceId: string,
  actionId: string,
  patch: Partial<
    Pick<EnterpriseAction, "title" | "notes" | "priority" | "status" | "due_at" | "insight_id">
  >,
): Promise<EnterpriseAction> {
  const body = await request<{ ok: true; action: EnterpriseAction }>(
    `/api/v1/workspaces/${workspaceId}/actions/${actionId}`,
    {
      method: "PATCH",
      body: JSON.stringify(patch),
    },
  );
  return body.action;
}

export async function deleteEnterpriseAction(workspaceId: string, actionId: string): Promise<void> {
  await request(`/api/v1/workspaces/${workspaceId}/actions/${actionId}`, {
    method: "DELETE",
  });
}

// ── BYOK ────────────────────────────────────────────────────────────────────

export type ByokKeyPublic = {
  id: string;
  provider: ByokProvider;
  key_preview: string | null;
  created_at: string;
  updated_at: string;
};

export async function listByokKeys(): Promise<ByokKeyPublic[]> {
  const body = await request<{ ok: true; keys: ByokKeyPublic[] }>("/api/v1/byok");
  return body.keys;
}

export async function saveByokKey(input: {
  provider: ByokProvider;
  raw_key: string;
  password: string;
  smoke_test?: boolean;
}) {
  return request<{ ok: true; key: ByokKeyPublic }>("/api/v1/byok", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function deleteByokKey(provider: ByokProvider) {
  return request<{ ok: true }>(`/api/v1/byok?provider=${encodeURIComponent(provider)}`, {
    method: "DELETE",
  });
}
