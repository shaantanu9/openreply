import type { Metadata } from "next";
import { SiteShell } from "@/components/shell/SiteShell";
import { DownloadLink } from "@/components/shell/DownloadLink";

export const metadata: Metadata = {
  title: "Gap Map — Download",
};

export const revalidate = 3600;

const PLATFORMS = [
  {
    name: "macOS",
    status: "Recommended — macOS 13+, Apple Silicon & Intel",
    action: "Download .dmg",
    primary: true,
  },
  {
    name: "Windows",
    status: "Coming soon — targeted for next major release",
    action: "Join waitlist",
    primary: false,
  },
  {
    name: "Linux",
    status: "Planned",
    action: "Request access",
    primary: false,
  },
] as const;

export default function DownloadPage() {
  return (
    <SiteShell offsetTop>
      <section className="px-8 py-20">
        <div className="mx-auto max-w-[1200px]">
          <div className="max-w-[620px]">
            <span className="section-label">Download</span>
            <h1 className="font-serif text-[clamp(36px,4.2vw,52px)] font-normal leading-[1.1] tracking-[-1.2px] text-[var(--dark)]">
              Install Gap Map and start
              <br />
              your first research run.
            </h1>
            <p className="mt-5 text-[17px] leading-[1.7] text-[var(--muted)]">
              Choose your platform, install the app, and onboard in minutes.
              Your workspace keeps all research organised in one desktop
              environment.
            </p>
          </div>
          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {PLATFORMS.map((p) => (
              <article
                key={p.name}
                className="flex flex-col items-start gap-4 rounded-[24px] border border-[var(--border-strong)] bg-white p-7"
              >
                <h2 className="font-serif text-[28px] leading-none text-[var(--dark)]">
                  {p.name}
                </h2>
                <p className="text-[13px] text-[var(--muted)]">{p.status}</p>
                {p.primary ? (
                  <DownloadLink className="btn btn-orange">{p.action}</DownloadLink>
                ) : (
                  <button type="button" disabled className="btn btn-ghost">
                    {p.action}
                  </button>
                )}
              </article>
            ))}
          </div>
          <div className="mt-8 rounded-[24px] border border-[var(--border)] bg-[var(--cream-mid)] p-7 text-[14px] text-[var(--muted)]">
            <h3 className="mb-2 text-[16px] font-medium text-[var(--dark)]">
              Need help installing?
            </h3>
            <p className="leading-[1.7]">
              Use the in-app onboarding flow after installation. For enterprise
              deployment help, contact support through the FAQ page or email{" "}
              <a
                href="mailto:support@gapmap.app"
                className="text-[var(--orange)] hover:underline"
              >
                support@gapmap.app
              </a>
              .
            </p>
          </div>
        </div>
      </section>
    </SiteShell>
  );
}
