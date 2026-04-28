import { PROBLEM_SYMPTOMS } from "@/lib/constants";

/**
 * The "agitate" beat. Honest framing — no invented dollar/hour metrics.
 * Each symptom is something the reader is invited to recognise from
 * their own week. Compact, single-section layout.
 */
export function ProblemSection() {
  return (
    <section
      id="problem"
      className="bg-[var(--cream)] px-8 py-[72px]"
    >
      <div className="mx-auto max-w-[1200px]">
        <div className="grid gap-10 md:grid-cols-[0.95fr_1.4fr]">
          {/* LEFT — agitator copy */}
          <div className="flex flex-col gap-5">
            <span className="section-label !mb-0">The synthesis tax</span>
            <h2 className="font-serif text-[clamp(30px,3.4vw,42px)] font-normal leading-[1.1] tracking-[-1.2px] text-[var(--dark)]">
              You&rsquo;re already paying
              <br />
              <em>for the work this replaces.</em>
            </h2>
            <p className="text-[15px] leading-[1.65] text-[var(--muted)]">
              Every product team with more than three customer-feedback channels
              runs into the same arithmetic: someone is doing it manually, badly,
              and on borrowed time. We&rsquo;re pre-launch and won&rsquo;t pretend
              to know your dollar figure — but you probably recognise the
              symptoms.
            </p>
          </div>

          {/* RIGHT — 2x2 symptom grid */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {PROBLEM_SYMPTOMS.map((s, i) => (
              <article
                key={s.title}
                className="reveal flex flex-col gap-3 rounded-[18px] border border-[var(--border-strong)] bg-white p-5"
              >
                <div className="flex items-baseline justify-between">
                  <span className="font-mono text-[10.5px] uppercase tracking-[1.4px] text-[var(--orange)]">
                    Symptom 0{i + 1}
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-[1.4px] text-[var(--muted-light)]">
                    you&rsquo;ve seen this
                  </span>
                </div>
                <h3 className="text-[15.5px] font-medium leading-snug text-[var(--dark)]">
                  {s.title}
                </h3>
                <p className="text-[13px] leading-[1.55] text-[var(--muted)]">
                  {s.body}
                </p>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
