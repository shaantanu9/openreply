"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/hooks/use-session";
import { getSupabaseBrowserClient } from "@/lib/supabaseBrowser";
import { ROUTES } from "@/lib/constants";

type Profile = {
  id: string;
  username: string;
  display_name: string | null;
  bio: string | null;
  website: string | null;
  twitter_handle: string | null;
  avatar_url: string | null;
};

export function ProfileSettingsPanel() {
  const router = useRouter();
  const { user, status } = useSession();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const sb = getSupabaseBrowserClient();
      const { data, error: err } = await sb
        .from("profiles")
        .select("id, username, display_name, bio, website, twitter_handle, avatar_url")
        .eq("id", user.id)
        .maybeSingle<Profile>();
      if (err) throw err;
      setProfile(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (status === "ready" && !user) {
      router.replace(ROUTES.signIn);
      return;
    }
    if (status === "ready" && user) reload().catch(() => undefined);
  }, [status, user, router, reload]);

  async function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!profile) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const sb = getSupabaseBrowserClient();
      const fd = new FormData(e.currentTarget);
      const patch = {
        username: String(fd.get("username") || profile.username).trim(),
        display_name: String(fd.get("display_name") || "").trim() || null,
        bio: String(fd.get("bio") || "").trim() || null,
        website: String(fd.get("website") || "").trim() || null,
        twitter_handle: String(fd.get("twitter_handle") || "").trim() || null,
      };
      const { error: err } = await sb.from("profiles").update(patch).eq("id", profile.id);
      if (err) throw err;
      setInfo("Profile saved.");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (loading || !profile) {
    return (
      <div className="min-h-screen bg-[var(--cream)] px-8 py-14 text-center text-[13px] text-[var(--muted)]">
        {error || "Loading…"}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--cream)]">
      <main className="mx-auto max-w-[640px] px-8 py-14">
        <header className="mb-10">
          <h1 className="font-serif text-[32px] font-normal leading-tight tracking-[-1px] text-[var(--dark)]">
            Your <em className="italic text-[var(--orange)]">profile</em>
          </h1>
          <p className="mt-2 text-[13.5px] text-[var(--muted)]">
            Shown on your public researcher page at{" "}
            <Link
              href={ROUTES.userProfile(profile.username)}
              className="text-[var(--orange)] hover:underline"
            >
              /u/{profile.username}
            </Link>
            .
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

        <form
          onSubmit={handleSave}
          className="grid grid-cols-1 gap-4 rounded-[24px] border border-[var(--border-strong)] bg-white p-7"
        >
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-[var(--muted)]">Username</span>
            <input
              name="username"
              defaultValue={profile.username}
              pattern="[a-zA-Z0-9_]{2,}"
              title="Letters, numbers, underscore only"
              className="rounded-[10px] border border-[var(--border-strong)] bg-white px-[14px] py-[11px] text-[14px] outline-none focus:border-[var(--orange)]"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-[var(--muted)]">Display name</span>
            <input
              name="display_name"
              defaultValue={profile.display_name || ""}
              className="rounded-[10px] border border-[var(--border-strong)] bg-white px-[14px] py-[11px] text-[14px] outline-none focus:border-[var(--orange)]"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-[var(--muted)]">Bio</span>
            <textarea
              name="bio"
              defaultValue={profile.bio || ""}
              rows={3}
              className="rounded-[10px] border border-[var(--border-strong)] bg-white px-[14px] py-[11px] text-[14px] outline-none focus:border-[var(--orange)]"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-[var(--muted)]">Website</span>
            <input
              name="website"
              defaultValue={profile.website || ""}
              placeholder="https://..."
              className="rounded-[10px] border border-[var(--border-strong)] bg-white px-[14px] py-[11px] text-[14px] outline-none focus:border-[var(--orange)]"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-[var(--muted)]">Twitter / X handle</span>
            <input
              name="twitter_handle"
              defaultValue={profile.twitter_handle || ""}
              placeholder="@username"
              className="rounded-[10px] border border-[var(--border-strong)] bg-white px-[14px] py-[11px] text-[14px] outline-none focus:border-[var(--orange)]"
            />
          </label>
          <div>
            <button
              type="submit"
              disabled={busy}
              className="rounded-[10px] bg-[var(--dark)] px-4 py-[11px] text-[14px] font-medium text-white transition-all hover:bg-[var(--dark-mid)] disabled:opacity-60"
            >
              {busy ? "Saving…" : "Save profile"}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
