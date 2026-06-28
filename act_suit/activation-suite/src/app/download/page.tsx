import type { Metadata } from "next";
import { SiteShell } from "@/components/shell/SiteShell";
import { DownloadLink } from "@/components/shell/DownloadLink";
import { fetchLatestRelease, RELEASES_PAGE_URL } from "@/lib/releases";
import { GITHUB } from "@/lib/constants";

export const metadata: Metadata = {
  title: "OpenReply — Download",
};

// Re-pull the latest release roughly every 15 min so the version stays fresh
// without re-rendering on every request.
export const revalidate = 900;

type Build = {
  /** platform key passed to /api/download */
  platform: string;
  /** secondary download (alt format), optional */
  altPlatform?: string;
  altLabel?: string;
};

const PLATFORMS: Array<{
  name: string;
  status: string;
  action: string;
  build: Build;
}> = [
  {
    name: "macOS — Apple Silicon",
    status: "Recommended for M1/M2/M3/M4 Macs · macOS 13+",
    action: "Download .dmg",
    build: { platform: "mac-arm" },
  },
  {
    name: "macOS — Intel",
    status: "For older Intel-based Macs · macOS 13+",
    action: "Download .dmg",
    build: { platform: "mac-intel" },
  },
  {
    name: "Windows",
    status: "Windows 10/11 · 64-bit",
    action: "Download installer",
    build: { platform: "windows", altPlatform: "windows-msi", altLabel: ".msi" },
  },
  {
    name: "Linux",
    status: "AppImage (portable) or .deb (Debian/Ubuntu)",
    action: "Download AppImage",
    build: { platform: "linux", altPlatform: "linux-deb", altLabel: ".deb" },
  },
];

export default async function DownloadPage() {
  const release = await fetchLatestRelease();

  return (
    <SiteShell offsetTop>
      <section className="px-8 py-20">
        <div className="mx-auto max-w-[1200px]">
          <div className="max-w-[620px]">
            <span className="section-label">Download</span>
            <h1 className="font-serif text-[clamp(36px,4.2vw,52px)] font-normal leading-[1.1] tracking-[-1.2px] text-[var(--dark)]">
              Install OpenReply and start
              <br />
              your first research run.
            </h1>
            <p className="mt-5 text-[17px] leading-[1.7] text-[var(--muted)]">
              Choose your platform, install the app, and onboard in minutes.
              Your workspace keeps all research organised in one desktop
              environment.
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-3 text-[13px]">
              {release ? (
                <span className="inline-flex items-center gap-2 rounded-full border border-[var(--border-strong)] bg-white px-3 py-1 font-medium text-[var(--dark)]">
                  <span className="h-2 w-2 rounded-full bg-[var(--orange)]" />
                  Latest: {release.tag}
                </span>
              ) : null}
              <a
                href={RELEASES_PAGE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--orange)] hover:underline"
              >
                View all releases &amp; changelog →
              </a>
              <a
                href={GITHUB.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-strong)] bg-white px-3 py-1 font-medium text-[var(--dark)] hover:border-[var(--orange)] hover:text-[var(--orange)]"
              >
                ⭐ Star us on GitHub
              </a>
            </div>
          </div>

          <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
            {PLATFORMS.map((p) => (
              <article
                key={p.name}
                className="flex flex-col items-start gap-4 rounded-[24px] border border-[var(--border-strong)] bg-white p-7"
              >
                <h2 className="font-serif text-[22px] leading-tight text-[var(--dark)]">
                  {p.name}
                </h2>
                <p className="flex-1 text-[13px] leading-[1.6] text-[var(--muted)]">
                  {p.status}
                </p>
                <DownloadLink
                  className="btn btn-orange"
                  platform={p.build.platform}
                >
                  {p.action}
                </DownloadLink>
                {p.build.altPlatform ? (
                  <DownloadLink
                    className="text-[12.5px] font-medium text-[var(--muted)] transition-colors hover:text-[var(--orange)]"
                    platform={p.build.altPlatform}
                  >
                    or download {p.build.altLabel}
                  </DownloadLink>
                ) : null}
              </article>
            ))}
          </div>

          <div className="mt-8 rounded-[24px] border border-[var(--border)] bg-[var(--cream-mid)] p-7 text-[14px] text-[var(--muted)]">
            <h3 className="mb-2 text-[16px] font-medium text-[var(--dark)]">
              Need help installing?
            </h3>
            <p className="leading-[1.7]">
              Use the in-app onboarding flow after installation. macOS may warn
              that the app is from an unidentified developer the first time —
              right-click the app and choose <strong>Open</strong> to bypass.
              For enterprise deployment help, contact support through the FAQ
              page or email{" "}
              <a
                href="mailto:support@openreply.app"
                className="text-[var(--orange)] hover:underline"
              >
                support@openreply.app
              </a>
              .
            </p>
          </div>
        </div>
      </section>
    </SiteShell>
  );
}
