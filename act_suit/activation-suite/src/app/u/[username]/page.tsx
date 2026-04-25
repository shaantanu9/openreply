import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { SiteShell } from "@/components/shell/SiteShell";
import { ROUTES } from "@/lib/constants";
import { getSupabaseServerClient, hasSupabaseConfig } from "@/lib/supabaseClient";
import type { Profile, PublishedResearch } from "@/lib/community/types";

export const revalidate = 600;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>;
}): Promise<Metadata> {
  const { username } = await params;
  return {
    title: `@${username} — Gap Map`,
    description: `Public research profile of @${username} on Gap Map.`,
  };
}

function formatDate(iso: string): string {
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

export default async function UserProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  if (!hasSupabaseConfig()) notFound();
  const sb = getSupabaseServerClient();
  const { data: profile } = await sb
    .from("profiles")
    .select("*")
    .ilike("username", username)
    .maybeSingle<Profile>();
  if (!profile) notFound();
  const { data: published } = await sb
    .from("published_research")
    .select("*")
    .eq("user_id", profile.id)
    .order("published_at", { ascending: false });
  const items = (published as PublishedResearch[] | null) || [];

  return (
    <SiteShell>
      <main className="mx-auto max-w-[760px] px-8 py-14">
        <header className="mb-8 flex items-center gap-6">
          <div className="flex h-[72px] w-[72px] items-center justify-center rounded-full border border-[var(--border-strong)] bg-[var(--orange-pale)] text-[22px] font-semibold text-[var(--orange)]">
            {(profile.display_name || profile.username).slice(0, 2).toUpperCase()}
          </div>
          <div>
            <h1 className="font-serif text-[32px] font-normal leading-tight tracking-[-1px] text-[var(--dark)]">
              {profile.display_name || profile.username}
            </h1>
            <p className="text-[13.5px] text-[var(--muted)]">
              @{profile.username} · {profile.research_count} published ·{" "}
              {profile.follower_count} followers
            </p>
            {profile.bio ? (
              <p className="mt-2 max-w-[520px] text-[13.5px] text-[var(--text)]">{profile.bio}</p>
            ) : null}
            {profile.website ? (
              <a
                href={profile.website}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-block text-[12.5px] text-[var(--orange)] hover:underline"
              >
                {profile.website.replace(/^https?:\/\//, "")}
              </a>
            ) : null}
          </div>
        </header>

        <section>
          <h2 className="mb-4 font-serif text-[22px] font-normal text-[var(--dark)]">
            Published research
          </h2>
          {items.length === 0 ? (
            <div className="rounded-[10px] border border-dashed border-[var(--border)] bg-[var(--cream-mid)] px-4 py-6 text-[13px] text-[var(--muted)]">
              No public research yet.
            </div>
          ) : (
            <ul className="flex flex-col gap-3">
              {items.map((r) => (
                <li key={r.id} className="rounded-[14px] border border-[var(--border-strong)] bg-white p-5">
                  <Link
                    href={ROUTES.publishedResearch(r.slug)}
                    className="text-[15px] font-medium text-[var(--dark)] hover:text-[var(--orange)]"
                  >
                    {r.title}
                  </Link>
                  <p className="mt-1 text-[12.5px] text-[var(--muted)]">
                    {formatDate(r.published_at)} · {r.insight_count} insights · {r.view_count} views
                  </p>
                  {r.description ? (
                    <p className="mt-2 line-clamp-2 text-[13px] text-[var(--text)]">{r.description}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </SiteShell>
  );
}
