import { DownloadLink } from "@/components/shell/DownloadLink";
import { USE_CASES } from "@/lib/constants";

export function UseCasesSection() {
  return (
    <section id="use-cases" className="bg-[var(--cream)] px-8 py-[80px]">
      <div className="mx-auto max-w-[1200px]">
        <div className="max-w-[640px]">
          <span className="section-label">Use cases</span>
          <h2 className="section-h2">
            Built for teams that need
            <br />
            <em>evidence, not opinions.</em>
          </h2>
          <p className="section-sub mt-3">
            Same product, three high-leverage workflows. Pick your operating mode
            and ship with traceable confidence.
          </p>
        </div>
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {USE_CASES.map((item) => (
            <article
              key={item.persona}
              className="reveal rounded-[24px] border border-[var(--border-strong)] bg-white p-7"
            >
              <span className="inline-flex rounded-full border border-[var(--border)] bg-[var(--cream-mid)] px-3 py-[4px] text-[11px] font-medium text-[var(--muted)]">
                {item.persona}
              </span>
              <h3 className="mt-4 text-[18px] font-medium text-[var(--dark)]">
                {item.title}
              </h3>
              <p className="mt-2 text-[14px] leading-[1.65] text-[var(--muted)]">
                {item.pain}
              </p>
              <div className="mt-4 rounded-[14px] border border-[rgba(224,123,60,0.3)] bg-[var(--orange-pale)] p-4">
                <p className="text-[12.5px] leading-[1.55] text-[var(--dark)]">
                  <span className="font-medium text-[var(--orange)]">Outcome:</span>{" "}
                  {item.outcome}
                </p>
              </div>
              <p className="mt-4 text-[12.5px] font-medium text-[var(--muted)]">
                {item.proof}
              </p>
            </article>
          ))}
        </div>
        <div className="mt-10 flex flex-wrap items-center gap-3">
          <DownloadLink className="btn btn-orange">Download for Mac</DownloadLink>
          <a href="/sign-in" className="btn btn-ghost">
            Start free account →
          </a>
        </div>
      </div>
    </section>
  );
}
