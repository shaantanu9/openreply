"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/hooks/use-session";
import { ROUTES } from "@/lib/constants";
import {
  deleteByokKey,
  listByokKeys,
  saveByokKey,
  type ByokKeyPublic,
} from "@/lib/community/communityClient";
import type { ByokProvider } from "@/lib/community/types";

const PROVIDERS: Array<{ id: ByokProvider; label: string; note: string }> = [
  { id: "anthropic", label: "Anthropic", note: "Used for insight extraction (Claude)" },
  { id: "openai", label: "OpenAI", note: "GPT-4o fallback" },
  { id: "gemini", label: "Gemini", note: "Free-tier extraction" },
];

export function ByokPanel() {
  const router = useRouter();
  const { user, status } = useSession();
  const [rows, setRows] = useState<ByokKeyPublic[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [form, setForm] = useState({
    provider: "anthropic" as ByokProvider,
    raw_key: "",
    password: "",
    smoke_test: true,
  });

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await listByokKeys());
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

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setBusy("save");
    setError(null);
    setInfo(null);
    try {
      await saveByokKey(form);
      setInfo(`${form.provider} key saved (encrypted with your password).`);
      setForm((f) => ({ ...f, raw_key: "", password: "" }));
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete(p: ByokProvider) {
    if (!window.confirm(`Remove your ${p} key? You can add it again any time.`)) return;
    setBusy(`rm-${p}`);
    try {
      await deleteByokKey(p);
      setInfo(`${p} key removed.`);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const byProvider = new Map(rows.map((r) => [r.provider, r]));

  return (
    <div className="min-h-screen bg-[var(--cream)]">
      <main className="mx-auto max-w-[720px] px-8 py-14">
        <header className="mb-10">
          <h1 className="font-serif text-[32px] font-normal leading-tight tracking-[-1px] text-[var(--dark)]">
            BYOK <em className="italic text-[var(--orange)]">API keys</em>
          </h1>
          <p className="mt-2 max-w-[520px] text-[14px] font-light text-[var(--muted)]">
            Your keys are encrypted with your password before they hit the database.
            OpenReply cannot read them. If you forget your password your keys are
            unrecoverable — you&rsquo;ll need to re-enter them.
          </p>
        </header>

        {error ? (
          <div className="mb-4 rounded-[10px] border border-[#F5C5C0] bg-[#FDF0EF] px-[14px] py-3 text-[13.5px] text-[#C0392B]">
            {error}
          </div>
        ) : null}
        {info ? (
          <div className="mb-4 rounded-[10px] border border-[#9FE1CB] bg-[#EDF8F1] px-[14px] py-3 text-[13.5px] text-[#0F6E56]">
            {info}
          </div>
        ) : null}

        <section className="mb-8 rounded-[24px] border border-[var(--border-strong)] bg-white p-7">
          <div className="mb-5 text-[14px] font-medium text-[var(--dark)]">Add or update a key</div>
          <form onSubmit={handleSave} className="grid grid-cols-1 gap-4">
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-medium text-[var(--muted)]">Provider</span>
              <select
                value={form.provider}
                onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value as ByokProvider }))}
                className="rounded-[10px] border border-[var(--border-strong)] bg-white px-[14px] py-[11px] text-[14px]"
              >
                {PROVIDERS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label} — {p.note}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-medium text-[var(--muted)]">API key</span>
              <input
                type="password"
                autoComplete="off"
                value={form.raw_key}
                onChange={(e) => setForm((f) => ({ ...f, raw_key: e.target.value }))}
                placeholder="sk-..."
                className="rounded-[10px] border border-[var(--border-strong)] bg-white px-[14px] py-[11px] text-[14px] outline-none focus:border-[var(--orange)]"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-medium text-[var(--muted)]">Your OpenReply password</span>
              <input
                type="password"
                autoComplete="current-password"
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                className="rounded-[10px] border border-[var(--border-strong)] bg-white px-[14px] py-[11px] text-[14px] outline-none focus:border-[var(--orange)]"
              />
            </label>
            <label className="flex items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={form.smoke_test}
                onChange={(e) => setForm((f) => ({ ...f, smoke_test: e.target.checked }))}
              />
              Validate with the provider before saving (recommended).
            </label>
            <div>
              <button
                type="submit"
                disabled={busy === "save"}
                className="rounded-[10px] bg-[var(--dark)] px-4 py-[11px] text-[14px] font-medium text-white transition-all hover:bg-[var(--dark-mid)] disabled:opacity-60"
              >
                {busy === "save" ? "Saving…" : "Save key"}
              </button>
            </div>
          </form>
        </section>

        <section className="rounded-[24px] border border-[var(--border-strong)] bg-white p-7">
          <div className="mb-4 text-[14px] font-medium text-[var(--dark)]">Saved keys</div>
          {loading ? (
            <div className="rounded-[10px] border border-dashed border-[var(--border)] bg-[var(--cream-mid)] px-4 py-6 text-center text-[13px] text-[var(--muted)]">
              Loading…
            </div>
          ) : rows.length === 0 ? (
            <div className="rounded-[10px] border border-dashed border-[var(--border)] bg-[var(--cream-mid)] px-4 py-6 text-center text-[13px] text-[var(--muted)]">
              No keys stored yet.
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {PROVIDERS.map((p) => {
                const row = byProvider.get(p.id);
                return (
                  <li
                    key={p.id}
                    className="flex items-center justify-between rounded-[10px] border border-[var(--border)] bg-[var(--cream-mid)] px-[14px] py-3"
                  >
                    <div>
                      <div className="text-[13.5px] font-medium text-[var(--dark)]">
                        {p.label}
                      </div>
                      <div className="text-[11.5px] text-[var(--muted-light)]">{p.note}</div>
                    </div>
                    {row ? (
                      <div className="flex items-center gap-3">
                        <span className="rounded-[6px] bg-white px-2 py-1 font-mono text-[11px] text-[var(--muted)]">
                          ••••{row.key_preview || ""}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleDelete(p.id)}
                          disabled={busy === `rm-${p.id}`}
                          className="text-[12px] text-[var(--muted)] hover:text-[#C0392B]"
                        >
                          {busy === `rm-${p.id}` ? "Removing…" : "Remove"}
                        </button>
                      </div>
                    ) : (
                      <span className="text-[11.5px] text-[var(--muted-light)]">Not set</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
