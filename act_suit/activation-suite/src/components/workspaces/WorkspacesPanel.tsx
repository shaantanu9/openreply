"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/hooks/use-session";
import { ROUTES } from "@/lib/constants";
import {
  createWorkspace,
  deleteWorkspace,
  listWorkspaces,
} from "@/lib/community/communityClient";
import type { Workspace } from "@/lib/community/types";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

export function WorkspacesPanel() {
  const router = useRouter();
  const { user, status } = useSession();
  const [rows, setRows] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    topic: "",
    description: "",
    is_public: true,
  });

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await listWorkspaces());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === "ready" && !user) {
      router.replace(ROUTES.signIn);
      return;
    }
    if (status === "ready" && user) reload().catch(() => undefined);
  }, [status, user, router, reload]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const ws = await createWorkspace({
        name: form.name.trim(),
        topic: form.topic.trim() || undefined,
        description: form.description.trim() || undefined,
        is_public: form.is_public,
      });
      router.push(ROUTES.workspace(ws.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Delete this workspace and all its data? This cannot be undone.")) return;
    try {
      await deleteWorkspace(id);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="min-h-screen bg-[var(--cream)]">
      <main className="mx-auto max-w-[960px] px-8 py-14">
        <header className="mb-10 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="font-serif text-[36px] font-normal leading-tight tracking-[-1px] text-[var(--dark)]">
              Your <em className="italic text-[var(--orange)]">workspaces</em>
            </h1>
            <p className="mt-2 max-w-[520px] text-[15px] font-light text-[var(--muted)]">
              Each workspace is a research topic — configure sources, run sweeps,
              and publish insights. Workspaces default to public in Community.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={ROUTES.explore} className="btn-sm">
              Explore public research
            </Link>
            <Link href={ROUTES.dashboard} className="btn-sm">
              Licence &amp; devices
            </Link>
          </div>
        </header>

        {error ? (
          <div className="mb-6 rounded-[10px] border border-[#F5C5C0] bg-[#FDF0EF] px-[14px] py-3 text-[13.5px] text-[#C0392B]">
            {error}
          </div>
        ) : null}

        <section className="mb-10 rounded-[24px] border border-[var(--border-strong)] bg-white p-7">
          <div className="mb-4 text-[14px] font-medium text-[var(--dark)]">Create a workspace</div>
          <form onSubmit={handleCreate} className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-medium text-[var(--muted)]">Name</span>
              <input
                required
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. AI analytics tools"
                className="rounded-[10px] border border-[var(--border-strong)] bg-white px-[14px] py-[11px] text-[14px] outline-none transition-shadow focus:border-[var(--orange)] focus:shadow-[0_0_0_3px_rgba(224,123,60,0.12)]"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-medium text-[var(--muted)]">Topic / market</span>
              <input
                value={form.topic}
                onChange={(e) => setForm((f) => ({ ...f, topic: e.target.value }))}
                placeholder="e.g. product analytics"
                className="rounded-[10px] border border-[var(--border-strong)] bg-white px-[14px] py-[11px] text-[14px] outline-none transition-shadow focus:border-[var(--orange)] focus:shadow-[0_0_0_3px_rgba(224,123,60,0.12)]"
              />
            </label>
            <label className="md:col-span-2 flex flex-col gap-1">
              <span className="text-[12px] font-medium text-[var(--muted)]">Short description</span>
              <textarea
                rows={2}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="One sentence about the gap you're exploring."
                className="rounded-[10px] border border-[var(--border-strong)] bg-white px-[14px] py-[11px] text-[14px] outline-none transition-shadow focus:border-[var(--orange)] focus:shadow-[0_0_0_3px_rgba(224,123,60,0.12)]"
              />
            </label>
            <label className="md:col-span-2 flex items-center gap-2 text-[13px] text-[var(--text)]">
              <input
                type="checkbox"
                checked={form.is_public}
                onChange={(e) => setForm((f) => ({ ...f, is_public: e.target.checked }))}
              />
              Publish publicly on /explore (Gap Map Pro is required to keep workspaces private).
            </label>
            <div className="md:col-span-2">
              <button
                type="submit"
                disabled={creating || !form.name.trim()}
                className="rounded-[10px] bg-[var(--dark)] px-4 py-[11px] text-[14px] font-medium text-white transition-all hover:bg-[var(--dark-mid)] disabled:pointer-events-none disabled:opacity-60"
              >
                {creating ? "Creating…" : "Create workspace"}
              </button>
            </div>
          </form>
        </section>

        <section>
          <div className="mb-4 flex items-center justify-between">
            <div className="text-[14px] font-medium text-[var(--dark)]">
              {rows.length === 0 && !loading ? "No workspaces yet" : `${rows.length} workspace${rows.length === 1 ? "" : "s"}`}
            </div>
          </div>
          {loading ? (
            <div className="rounded-[10px] border border-dashed border-[var(--border)] bg-[var(--cream-mid)] px-4 py-8 text-center text-[13px] text-[var(--muted)]">
              Loading…
            </div>
          ) : rows.length === 0 ? (
            <div className="rounded-[10px] border border-dashed border-[var(--border)] bg-[var(--cream-mid)] px-4 py-8 text-center text-[13px] text-[var(--muted)]">
              Create your first workspace above — then add sources and run a sweep.
            </div>
          ) : (
            <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {rows.map((ws) => (
                <li
                  key={ws.id}
                  className="rounded-[16px] border border-[var(--border-strong)] bg-white p-5"
                >
                  <div className="flex items-center justify-between">
                    <Link
                      href={ROUTES.workspace(ws.id)}
                      className="text-[15px] font-medium text-[var(--dark)] hover:text-[var(--orange)]"
                    >
                      {ws.name}
                    </Link>
                    <span
                      className={`rounded-full px-[9px] py-[2px] text-[11px] font-medium ${
                        ws.is_public
                          ? "bg-[var(--green-pale)] text-[var(--green)]"
                          : "bg-[var(--cream-dark)] text-[var(--muted)]"
                      }`}
                    >
                      {ws.is_public ? "Public" : "Private"}
                    </span>
                  </div>
                  <div className="mt-1 text-[12px] text-[var(--muted)]">
                    {ws.topic || "no topic set"}
                  </div>
                  {ws.description ? (
                    <p className="mt-2 line-clamp-2 text-[13px] text-[var(--text)]">{ws.description}</p>
                  ) : null}
                  <div className="mt-3 flex items-center justify-between text-[11.5px] text-[var(--muted-light)]">
                    <span>
                      {ws.post_count} posts · {ws.insight_count} insights
                    </span>
                    <span>Last sweep {formatDate(ws.last_sweep_at)}</span>
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    <Link
                      href={ROUTES.workspace(ws.id)}
                      className="text-[12px] font-medium text-[var(--orange)] hover:underline"
                    >
                      Open workspace →
                    </Link>
                    <button
                      type="button"
                      onClick={() => handleDelete(ws.id)}
                      className="text-[12px] text-[var(--muted)] hover:text-[#C0392B]"
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
