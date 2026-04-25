"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "@/hooks/use-session";
import { ROUTES } from "@/lib/constants";
import {
  addSource,
  getSweep,
  getWorkspaceBundle,
  publishWorkspace,
  removeSource,
  startSweep,
  unpublishWorkspace,
  updateWorkspace,
} from "@/lib/community/communityClient";
import type {
  Insight,
  InsightType,
  Post,
  SourceType,
  Sweep,
  Workspace,
  WorkspaceSource,
} from "@/lib/community/types";

type Tab = "ingest" | "sweep" | "insights" | "report" | "settings";

const SOURCE_TYPES: Array<{ value: SourceType; label: string }> = [
  { value: "reddit", label: "Reddit" },
  { value: "hackernews", label: "Hacker News" },
  { value: "g2", label: "G2 Reviews" },
  { value: "twitter", label: "Twitter / X" },
  { value: "arxiv", label: "arXiv" },
  { value: "appstore", label: "App Store reviews" },
  { value: "producthunt", label: "Product Hunt" },
  { value: "devto", label: "dev.to" },
  { value: "capterra", label: "Capterra" },
  { value: "trustpilot", label: "Trustpilot" },
  { value: "github_issues", label: "GitHub Issues" },
  { value: "rss", label: "Custom RSS" },
  { value: "custom_inject", label: "Upload CSV/JSON" },
];

function insightTypeColor(t: InsightType): string {
  switch (t) {
    case "pain":
      return "bg-[rgba(224,123,60,0.12)] text-[var(--orange)]";
    case "workaround":
      return "bg-[rgba(29,158,117,0.12)] text-[var(--green)]";
    case "request":
      return "bg-[rgba(77,107,223,0.12)] text-[#4D6BDF]";
    case "praise":
      return "bg-[rgba(219,167,52,0.15)] text-[#B4851A]";
  }
}

export function WorkspaceDetailPanel({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const { user, status } = useSession();
  const [tab, setTab] = useState<Tab>("ingest");
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [sources, setSources] = useState<WorkspaceSource[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [latestSweep, setLatestSweep] = useState<Sweep | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [newSourceType, setNewSourceType] = useState<SourceType>("reddit");

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const bundle = await getWorkspaceBundle(workspaceId);
      setWorkspace(bundle.workspace);
      setSources(bundle.sources);
      setPosts(bundle.posts);
      setInsights(bundle.insights);
      setLatestSweep(bundle.latest_sweep);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (status === "ready" && !user) {
      router.replace(ROUTES.signIn);
      return;
    }
    if (status === "ready" && user) reload().catch(() => undefined);
  }, [status, user, router, reload]);

  const summary = useMemo(() => {
    const byType: Record<InsightType, number> = {
      pain: 0, workaround: 0, request: 0, praise: 0,
    };
    for (const i of insights) byType[i.insight_type] += 1;
    return byType;
  }, [insights]);

  async function handleAddSource() {
    setBusy("add-source");
    setError(null);
    try {
      await addSource(workspaceId, newSourceType);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleRemoveSource(id: string) {
    setBusy(`rm-${id}`);
    try {
      await removeSource(workspaceId, id);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleRunSweep() {
    setBusy("sweep");
    setError(null);
    try {
      const sweepId = await startSweep(workspaceId);
      // Poll every 800ms until complete/failed. Stub pipeline finishes fast.
      for (let i = 0; i < 30; i++) {
        const s = await getSweep(sweepId);
        setLatestSweep(s);
        if (s.status === "complete" || s.status === "failed") break;
        await new Promise((r) => setTimeout(r, 800));
      }
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleTogglePublish() {
    if (!workspace) return;
    setBusy("publish");
    setError(null);
    try {
      if (workspace.is_public) {
        await unpublishWorkspace(workspace.id);
      } else {
        await publishWorkspace(workspace.id);
      }
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleSaveMeta(patch: Partial<Workspace>) {
    if (!workspace) return;
    setBusy("save");
    try {
      const updated = await updateWorkspace(workspace.id, patch);
      setWorkspace(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  function exportMarkdown() {
    if (!workspace) return;
    const lines: string[] = [];
    lines.push(`# ${workspace.name}`);
    if (workspace.description) lines.push(`\n${workspace.description}`);
    lines.push(`\n_${insights.length} insights from ${posts.length} posts across ${sources.length} sources._\n`);
    for (const t of ["pain", "workaround", "request", "praise"] as InsightType[]) {
      const rows = insights.filter((i) => i.insight_type === t);
      if (rows.length === 0) continue;
      lines.push(`\n## ${t.charAt(0).toUpperCase() + t.slice(1)}s\n`);
      for (const i of rows) {
        lines.push(`- **${i.title}** — ${i.frequency_pct}% (${i.frequency} mentions)`);
        if (i.description) lines.push(`  ${i.description}`);
      }
    }
    const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${workspace.slug || workspace.id}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportCsv() {
    const header = ["type", "title", "description", "severity", "frequency", "frequency_pct", "tags"].join(",");
    const rows = insights.map((i) =>
      [
        i.insight_type,
        JSON.stringify(i.title),
        JSON.stringify(i.description || ""),
        i.severity ?? "",
        i.frequency,
        i.frequency_pct,
        JSON.stringify(i.tags.join("|")),
      ].join(","),
    );
    const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${workspace?.slug || workspaceId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--cream)] px-8 py-14 text-center text-[13px] text-[var(--muted)]">
        Loading workspace…
      </div>
    );
  }
  if (!workspace) {
    return (
      <div className="min-h-screen bg-[var(--cream)] px-8 py-14 text-center text-[13px] text-[var(--muted)]">
        {error || "Workspace not found."}{" "}
        <Link href={ROUTES.workspaces} className="text-[var(--orange)] hover:underline">
          Back to workspaces
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--cream)]">
      <main className="mx-auto max-w-[960px] px-8 py-14">
        <header className="mb-8 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <Link href={ROUTES.workspaces} className="text-[12px] text-[var(--muted)] hover:underline">
              ← Workspaces
            </Link>
            <h1 className="mt-1 font-serif text-[32px] font-normal leading-tight tracking-[-1px] text-[var(--dark)]">
              {workspace.name}
            </h1>
            <p className="mt-1 text-[14px] text-[var(--muted)]">
              {workspace.topic || "No topic set"} ·{" "}
              <span
                className={workspace.is_public ? "text-[var(--green)]" : "text-[var(--muted)]"}
              >
                {workspace.is_public ? "Public" : "Private"}
              </span>
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleRunSweep}
              disabled={busy === "sweep"}
              className="btn-sm orange"
            >
              {busy === "sweep" ? "Sweeping…" : "Run sweep"}
            </button>
            <button
              type="button"
              onClick={handleTogglePublish}
              disabled={busy === "publish"}
              className="btn-sm"
            >
              {workspace.is_public ? "Unpublish" : "Publish to explore"}
            </button>
          </div>
        </header>

        {error ? (
          <div className="mb-6 rounded-[10px] border border-[#F5C5C0] bg-[#FDF0EF] px-[14px] py-3 text-[13.5px] text-[#C0392B]">
            {error}
          </div>
        ) : null}

        <nav className="mb-6 flex border-b border-[var(--border)]">
          {(["ingest", "sweep", "insights", "report", "settings"] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`-mb-px border-b-2 px-4 py-2 text-[13px] font-medium capitalize transition-colors ${
                tab === t
                  ? "border-[var(--dark)] text-[var(--dark)]"
                  : "border-transparent text-[var(--muted)] hover:text-[var(--text)]"
              }`}
            >
              {t}
            </button>
          ))}
        </nav>

        {tab === "ingest" ? (
          <section className="rounded-[24px] border border-[var(--border-strong)] bg-white p-7">
            <div className="mb-1 text-[14px] font-medium text-[var(--dark)]">Source connectors</div>
            <p className="mb-5 text-[13px] text-[var(--muted)]">
              Add source types to include them in the next sweep. Current sweeps use stub fetchers —
              replace with real adapters in the shared core crate (spec §3, Phase 1).
            </p>
            <div className="mb-5 flex flex-wrap gap-2">
              <select
                value={newSourceType}
                onChange={(e) => setNewSourceType(e.target.value as SourceType)}
                className="rounded-[10px] border border-[var(--border-strong)] bg-white px-[12px] py-[10px] text-[13.5px]"
              >
                {SOURCE_TYPES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleAddSource}
                disabled={busy === "add-source"}
                className="btn-sm"
              >
                {busy === "add-source" ? "Adding…" : "Add source"}
              </button>
            </div>
            {sources.length === 0 ? (
              <div className="rounded-[10px] border border-dashed border-[var(--border)] bg-[var(--cream-mid)] px-4 py-5 text-[13px] text-[var(--muted)]">
                No sources configured yet. Add one above — a sweep will use default sources if none are set.
              </div>
            ) : (
              <ul className="flex flex-col gap-2">
                {sources.map((s) => (
                  <li
                    key={s.id}
                    className="flex items-center justify-between rounded-[10px] border border-[var(--border)] bg-[var(--cream-mid)] px-[14px] py-3"
                  >
                    <div className="text-[13px] text-[var(--dark)]">
                      {SOURCE_TYPES.find((t) => t.value === s.source_type)?.label || s.source_type}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveSource(s.id)}
                      disabled={busy === `rm-${s.id}`}
                      className="text-[12px] text-[var(--muted)] hover:text-[#C0392B] disabled:opacity-50"
                    >
                      {busy === `rm-${s.id}` ? "Removing…" : "Remove"}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}

        {tab === "sweep" ? (
          <section className="rounded-[24px] border border-[var(--border-strong)] bg-white p-7">
            <div className="mb-1 text-[14px] font-medium text-[var(--dark)]">Sweep engine</div>
            <p className="mb-5 text-[13px] text-[var(--muted)]">
              Kicks off a stubbed extraction pipeline that inserts plausible posts and insights.
              Replace with the real engine per spec §3 Phase 1.
            </p>
            <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="rounded-[10px] border border-[var(--border)] bg-[var(--cream-mid)] px-4 py-3">
                <div className="text-[11.5px] uppercase tracking-[0.06em] text-[var(--muted-light)]">
                  Posts indexed
                </div>
                <div className="mt-1 text-[20px] font-medium text-[var(--dark)]">
                  {workspace.post_count}
                </div>
              </div>
              <div className="rounded-[10px] border border-[var(--border)] bg-[var(--cream-mid)] px-4 py-3">
                <div className="text-[11.5px] uppercase tracking-[0.06em] text-[var(--muted-light)]">
                  Insights found
                </div>
                <div className="mt-1 text-[20px] font-medium text-[var(--dark)]">
                  {workspace.insight_count}
                </div>
              </div>
            </div>
            {latestSweep ? (
              <div className="rounded-[10px] border border-[var(--border)] bg-white px-4 py-3">
                <div className="flex items-center justify-between text-[13px]">
                  <span className="font-medium text-[var(--dark)]">
                    Latest sweep: <span className="capitalize">{latestSweep.status}</span>
                  </span>
                  <span className="text-[12px] text-[var(--muted)]">
                    {latestSweep.posts_indexed} posts · {latestSweep.insights_found} insights
                  </span>
                </div>
                {latestSweep.error_message ? (
                  <div className="mt-2 text-[12px] text-[#C0392B]">{latestSweep.error_message}</div>
                ) : null}
                <div className="mt-2 h-[6px] w-full rounded-full bg-[var(--cream-dark)]">
                  <div
                    className="h-[6px] rounded-full bg-[var(--orange)] transition-all"
                    style={{ width: `${Math.max(5, latestSweep.progress_pct)}%` }}
                  />
                </div>
              </div>
            ) : (
              <div className="rounded-[10px] border border-dashed border-[var(--border)] bg-[var(--cream-mid)] px-4 py-5 text-[13px] text-[var(--muted)]">
                No sweep has run yet. Click “Run sweep” above to generate insights.
              </div>
            )}
          </section>
        ) : null}

        {tab === "insights" ? (
          <section className="rounded-[24px] border border-[var(--border-strong)] bg-white p-7">
            <div className="mb-1 flex items-center justify-between">
              <div className="text-[14px] font-medium text-[var(--dark)]">Gap map</div>
              <div className="text-[12px] text-[var(--muted)]">
                {summary.pain} pains · {summary.request} requests · {summary.workaround} workarounds ·{" "}
                {summary.praise} praise
              </div>
            </div>
            <p className="mb-5 text-[13px] text-[var(--muted)]">
              Insights ranked by mention frequency across all sweeped sources.
            </p>
            {insights.length === 0 ? (
              <div className="rounded-[10px] border border-dashed border-[var(--border)] bg-[var(--cream-mid)] px-4 py-5 text-[13px] text-[var(--muted)]">
                Run a sweep to populate the gap map.
              </div>
            ) : (
              <ul className="flex flex-col gap-2">
                {insights.map((i) => (
                  <li
                    key={i.id}
                    className="rounded-[10px] border border-[var(--border)] bg-[var(--cream-mid)] px-4 py-3"
                  >
                    <div className="mb-1 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded-full px-[9px] py-[2px] text-[10.5px] font-medium uppercase tracking-[0.04em] ${insightTypeColor(
                            i.insight_type,
                          )}`}
                        >
                          {i.insight_type}
                        </span>
                        <span className="text-[13.5px] font-medium text-[var(--dark)]">
                          {i.title}
                        </span>
                      </div>
                      <div className="text-[12px] font-medium text-[var(--orange)]">
                        {i.frequency_pct}%
                      </div>
                    </div>
                    {i.description ? (
                      <p className="text-[12.5px] text-[var(--muted)]">{i.description}</p>
                    ) : null}
                    <div className="mt-2 h-[4px] rounded-full bg-[var(--cream-dark)]">
                      <div
                        className="h-[4px] rounded-full bg-[var(--orange)]"
                        style={{ width: `${Math.min(100, i.frequency_pct)}%` }}
                      />
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {i.tags.map((t) => (
                        <span
                          key={t}
                          className="rounded-[6px] bg-[var(--cream-dark)] px-[8px] py-[2px] text-[10.5px] text-[var(--muted)]"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}

        {tab === "report" ? (
          <section className="rounded-[24px] border border-[var(--border-strong)] bg-white p-7">
            <div className="mb-1 text-[14px] font-medium text-[var(--dark)]">Export</div>
            <p className="mb-5 text-[13px] text-[var(--muted)]">
              Export the current gap map. PDF export is planned; Markdown and CSV ship today.
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={exportMarkdown} className="btn-sm">
                Download markdown
              </button>
              <button type="button" onClick={exportCsv} className="btn-sm">
                Download CSV
              </button>
              <button
                type="button"
                disabled
                className="btn-sm opacity-50"
                title="PDF export requires the Pro app (gated feature)."
              >
                PDF (Pro)
              </button>
            </div>
          </section>
        ) : null}

        {tab === "settings" ? (
          <section className="rounded-[24px] border border-[var(--border-strong)] bg-white p-7">
            <div className="mb-1 text-[14px] font-medium text-[var(--dark)]">Workspace settings</div>
            <p className="mb-5 text-[13px] text-[var(--muted)]">
              Rename, change topic, flip publish visibility, or archive.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                handleSaveMeta({
                  name: String(fd.get("name") || workspace.name),
                  topic: String(fd.get("topic") || workspace.topic || ""),
                  description: String(fd.get("description") || workspace.description || ""),
                });
              }}
              className="grid grid-cols-1 gap-4"
            >
              <label className="flex flex-col gap-1">
                <span className="text-[12px] font-medium text-[var(--muted)]">Name</span>
                <input
                  name="name"
                  defaultValue={workspace.name}
                  className="rounded-[10px] border border-[var(--border-strong)] bg-white px-[14px] py-[11px] text-[14px] outline-none focus:border-[var(--orange)]"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[12px] font-medium text-[var(--muted)]">Topic</span>
                <input
                  name="topic"
                  defaultValue={workspace.topic || ""}
                  className="rounded-[10px] border border-[var(--border-strong)] bg-white px-[14px] py-[11px] text-[14px] outline-none focus:border-[var(--orange)]"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[12px] font-medium text-[var(--muted)]">Description</span>
                <textarea
                  name="description"
                  defaultValue={workspace.description || ""}
                  rows={2}
                  className="rounded-[10px] border border-[var(--border-strong)] bg-white px-[14px] py-[11px] text-[14px] outline-none focus:border-[var(--orange)]"
                />
              </label>
              <div className="flex items-center gap-3 text-[13px]">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    defaultChecked={workspace.is_public}
                    onChange={(e) => handleSaveMeta({ is_public: e.target.checked })}
                  />
                  Published on /explore
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    defaultChecked={workspace.status === "archived"}
                    onChange={(e) =>
                      handleSaveMeta({
                        status: e.target.checked ? "archived" : "active",
                      })
                    }
                  />
                  Archived
                </label>
              </div>
              <div>
                <button
                  type="submit"
                  disabled={busy === "save"}
                  className="rounded-[10px] bg-[var(--dark)] px-4 py-[11px] text-[14px] font-medium text-white transition-all hover:bg-[var(--dark-mid)] disabled:opacity-60"
                >
                  {busy === "save" ? "Saving…" : "Save changes"}
                </button>
              </div>
            </form>
          </section>
        ) : null}
      </main>
    </div>
  );
}
