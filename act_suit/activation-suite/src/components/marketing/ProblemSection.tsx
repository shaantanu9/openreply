import { PROBLEM_STATS } from "@/lib/constants";

/**
 * The "agitate" beat in the AIDA arc. Three statistics framed as a tax
 * the reader is paying right now. Heavy figures, restrained body copy.
 *
 * Layout: dark cream-mid panel with a thin accent rule under the
 * eyebrow so it visually separates from the lighter use-cases section
 * that follows.
 */
export function ProblemSection() {
  return (
    <section
      id="problem"
      className="bg-[var(--cream)] px-8 py-[100px]"
    >
      <div className="mx-auto max-w-[1200px]">
        <div className="grid gap-12 md:grid-cols-[1fr_1.4fr]">
          <div>
            <span className="section-label">The synthesis tax</span>
            <h2 className="section-h2">
              You&rsquo;re already paying
              <br />
              <em>for the work this replaces.</em>
            </h2>
            <p className="section-sub mt-4">
              Every product team with more than three customer-feedback channels
              runs into the same arithmetic: someone is doing it manually, badly,
              and on borrowed time.
            </p>
          </div>

          <div className="grid gap-5">
            {PROBLEM_STATS.map((s, i) => (
              <article
                key={s.label}
                className="reveal flex items-start gap-6 rounded-[20px] border border-[var(--border-strong)] bg-white p-6"
              >
                <div className="flex w-[120px] shrink-0 flex-col">
                  <span className="font-serif text-[44px] font-normal leading-none tracking-[-2px] text-[var(--dark)]">
                    {s.figure}
                  </span>
                  <span className="mt-2 text-[10.5px] font-medium uppercase tracking-[1.4px] text-[var(--orange)]">
                    {s.label}
                  </span>
                </div>
                <div className="flex flex-col gap-2 border-l border-[var(--border)] pl-6">
                  <p className="text-[14px] leading-[1.65] text-[var(--muted)]">
                    {s.body}
                  </p>
                  <span className="text-[10.5px] font-medium uppercase tracking-[1.2px] text-[var(--muted-light)]">
                    Source: internal benchmarks · proxy stat #{i + 1}
                  </span>
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
