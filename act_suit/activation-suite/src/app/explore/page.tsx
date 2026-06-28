import type { Metadata } from "next";
import Link from "next/link";
import { SiteShell } from "@/components/shell/SiteShell";
import { ROUTES } from "@/lib/constants";
import { listPublishedFeed } from "@/lib/community/publish";
import { hasSupabaseConfig } from "@/lib/supabaseClient";

export const metadata: Metadata = {
  title: "OpenReply — Explore public research",
  description:
    "Browse published gap maps, ranked pain points, and DIY workarounds from the OpenReply Community.",
};

// Revalidate the feed every 10 minutes so the published list stays fresh
// without hammering the DB on every request.
export const revalidate = 600;

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

export default async function ExplorePage() {
  let items: Awaited<ReturnType<typeof listPublishedFeed>> = [];
  if (hasSupabaseConfig()) {
    try {
      items = await listPublishedFeed({ limit: 50 });
    } catch {
      items = [];
    }
  }
  return (
    <SiteShell>
      <main className="mx-auto max-w-[960px] px-8 py-14">
        <header className="mb-10">
          <h1 className="font-serif text-[36px] font-normal leading-tight tracking-[-1px] text-[var(--dark)]">
            Explore <em className="italic text-[var(--orange)]">public research</em>
          </h1>
          <p className="mt-2 max-w-[520px] text-[15px] font-light text-[var(--muted)]">
            Published gap maps from OpenReply Community. Every page links back to its
            extraction chain so you can inspect the signal yourself.
          </p>
        </header>
        {!hasSupabaseConfig() ? (
          <div className="rounded-[10px] border border-dashed border-[var(--border)] bg-[var(--cream-mid)] px-4 py-6 text-center text-[13px] text-[var(--muted)]">
            Supabase is not configured in this environment. Published research will appear here once it is.
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-[10px] border border-dashed border-[var(--border)] bg-[var(--cream-mid)] px-4 py-8 text-center text-[13px] text-[var(--muted)]">
            No research has been published yet. Be the first — create a workspace and flip it public.
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {items.map((r) => (
              <li
                key={r.id}
                className="flex flex-col gap-2 rounded-[16px] border border-[var(--border-strong)] bg-white p-5"
              >
                <Link
                  href={ROUTES.publishedResearch(r.slug)}
                  className="text-[15px] font-medium text-[var(--dark)] hover:text-[var(--orange)]"
                >
                  {r.title}
                </Link>
                <p className="line-clamp-2 text-[13px] text-[var(--muted)]">
                  {r.description || `${r.insight_count} insights across ${r.source_types.length} sources.`}
                </p>
                <div className="mt-auto flex items-center justify-between text-[11.5px] text-[var(--muted-light)]">
                  <span>{r.source_types.length} sources · {r.insight_count} insights</span>
                  <span>Published {formatDate(r.published_at)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </SiteShell>
  );
}
