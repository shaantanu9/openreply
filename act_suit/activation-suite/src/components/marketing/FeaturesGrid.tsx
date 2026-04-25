import { DownloadLink } from "@/components/shell/DownloadLink";
import { FEATURE_CARDS } from "@/lib/constants";

function FeatureIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M10 2.5L3.75 5.833v5c0 3.333 2.5 6.25 6.25 7.083 3.75-.833 6.25-3.75 6.25-7.083v-5L10 2.5Z"
        stroke="#E07B3C"
        strokeWidth="1.4"
      />
    </svg>
  );
}

export function FeaturesGrid() {
  return (
    <section id="features" className="bg-[var(--cream-mid)] px-8 py-[100px]">
      <div className="mx-auto max-w-[1200px]">
        <div className="grid gap-10 md:grid-cols-2">
          <div>
            <span className="section-label">Capabilities</span>
            <h2 className="section-h2">
              Everything your
              <br />
              research team needs.
            </h2>
          </div>
          <div className="flex flex-col items-start justify-end gap-5">
            <p className="section-sub">
              Built for product teams that make evidence-based decisions. Every
              feature designed to reduce the gap between signal and shipped feature.
            </p>
            <DownloadLink className="btn btn-orange">Get started free →</DownloadLink>
          </div>
        </div>
        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {FEATURE_CARDS.map((f) => (
            <article
              key={f.title}
              className="feature-card reveal rounded-[24px] border border-[var(--border)] bg-white p-7 transition-shadow hover:shadow-[0_4px_20px_rgba(0,0,0,0.04)]"
            >
              <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-[10px] bg-[var(--orange-pale)]">
                <FeatureIcon />
              </div>
              <h3 className="mb-2 text-[17px] font-medium text-[var(--dark)]">
                {f.title}
              </h3>
              <p className="text-[14px] leading-[1.6] text-[var(--muted)]">
                {f.body}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
