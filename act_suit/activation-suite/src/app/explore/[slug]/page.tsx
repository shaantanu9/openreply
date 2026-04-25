import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { SiteShell } from "@/components/shell/SiteShell";
import { ROUTES } from "@/lib/constants";
import { getPublishedBySlug } from "@/lib/community/publish";
import type { InsightsSnapshot } from "@/lib/community/types";
import { hasSupabaseConfig } from "@/lib/supabaseClient";

export const revalidate = 3600;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  if (!hasSupabaseConfig()) return { title: "Gap Map — Research" };
  const r = await getPublishedBySlug(slug);
  if (!r) return { title: "Gap Map — Not found" };
  return {
    title: `${r.title} — Gap Map`,
    description: r.description || `Published gap map: ${r.title}.`,
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

export default async function PublishedResearchPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!hasSupabaseConfig()) notFound();
  const r = await getPublishedBySlug(slug);
  if (!r) notFound();
  const snap = (r.insights_snapshot as InsightsSnapshot | null) || null;

  return (
    <SiteShell>
      <main className="mx-auto max-w-[760px] px-8 py-14">
        <Link href={ROUTES.explore} className="text-[12px] text-[var(--muted)] hover:underline">
          ← Explore
        </Link>
        <h1 className="mt-2 font-serif text-[40px] font-normal leading-tight tracking-[-1.4px] text-[var(--dark)]">
          {r.title}
        </h1>
        <p className="mt-2 text-[13.5px] text-[var(--muted)]">
          Published {r.pro_publish ? "anonymously by a Gap Map Pro user" : "via Gap Map Community"} on{" "}
          {formatDate(r.published_at)} ·{" "}
          <span className="text-[var(--orange)]">{r.view_count.toLocaleString()} views</span>
        </p>
        {r.description ? (
          <p className="mt-4 text-[15px] leading-[1.65] text-[var(--text)]">{r.description}</p>
        ) : null}

        {snap ? (
          <>
            <section className="mt-10">
              <h2 className="mb-3 font-serif text-[22px] font-normal text-[var(--dark)]">
                Sources &amp; scope
              </h2>
              <p className="text-[13.5px] text-[var(--muted)]">
                {snap.post_count.toLocaleString()} posts indexed · sources:{" "}
                {snap.sources.join(", ")}
              </p>
            </section>

            <section className="mt-8">
              <h2 className="mb-4 font-serif text-[22px] font-normal text-[var(--dark)]">
                Gap map — ranked insights
              </h2>
              <ul className="flex flex-col gap-3">
                {snap.insights.map((i, idx) => (
                  <li
                    key={`${i.title}-${idx}`}
                    className="rounded-[14px] border border-[var(--border-strong)] bg-white p-5"
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-[13px] uppercase tracking-[0.06em] text-[var(--muted-light)]">
                        #{idx + 1} {i.type}
                      </span>
                      <span className="text-[13px] font-medium text-[var(--orange)]">
                        {i.frequency_pct}% · {i.mention_count} mentions
                      </span>
                    </div>
                    <div className="text-[16px] font-medium text-[var(--dark)]">{i.title}</div>
                    {i.description ? (
                      <p className="mt-1 text-[13.5px] text-[var(--muted)]">{i.description}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>

            {snap.workarounds.length > 0 ? (
              <section className="mt-8">
                <h2 className="mb-4 font-serif text-[22px] font-normal text-[var(--dark)]">
                  Observed workarounds
                </h2>
                <ul className="flex flex-col gap-2">
                  {snap.workarounds.map((w, idx) => (
                    <li
                      key={`${w.title}-${idx}`}
                      className="rounded-[10px] border border-[var(--border)] bg-[var(--cream-mid)] px-[14px] py-3"
                    >
                      <div className="text-[13.5px] font-medium text-[var(--dark)]">{w.title}</div>
                      {w.description ? (
                        <p className="text-[12.5px] text-[var(--muted)]">{w.description}</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        ) : (
          <p className="mt-8 text-[13px] text-[var(--muted)]">
            Insights snapshot not available for this research.
          </p>
        )}

        <footer className="mt-12 rounded-[14px] border border-[var(--border)] bg-[var(--cream-mid)] p-5 text-[13px] text-[var(--muted)]">
          Powered by{" "}
          <Link href={ROUTES.home} className="text-[var(--orange)] hover:underline">
            {snap?.powered_by || "Gap Map"}
          </Link>
          . Want to run your own sweep?{" "}
          <Link href={ROUTES.workspaces} className="text-[var(--orange)] hover:underline">
            Create a workspace →
          </Link>
        </footer>
      </main>
    </SiteShell>
  );
}
