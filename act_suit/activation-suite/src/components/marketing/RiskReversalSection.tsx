import { RISK_REVERSAL } from "@/lib/constants";

/**
 * Sits between Pricing and Security to remove buy-side fear:
 *   "yes the price is fair, but is it safe to commit?"
 *
 * Each card is a single concrete promise — no hand-wave language.
 * Visual rule: 2x2 grid on desktop, plain stack on mobile, hairline
 * borders only so the cards read as a list, not as competing CTAs.
 */
function ShieldIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 1.5L2.5 3.5v3.667c0 2.5 2.083 4.667 5.5 5.333 3.417-.666 5.5-2.833 5.5-5.333V3.5L8 1.5Z"
        stroke="#E07B3C"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M5.5 8L7 9.5l3.5-3.5"
        stroke="#E07B3C"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function RiskReversalSection() {
  return (
    <section
      id="risk-reversal"
      className="bg-[var(--cream)] px-8 py-[100px]"
    >
      <div className="mx-auto max-w-[1200px]">
        <div className="mx-auto max-w-[640px] text-center">
          <span className="section-label">Why it&rsquo;s safe to try</span>
          <h2 className="section-h2">
            Four reasons you can
            <br />
            <em>commit without worrying.</em>
          </h2>
          <p className="section-sub mx-auto mt-3">
            We removed the four anxieties product teams told us killed the
            install button. Each one is a concrete guarantee, not a slogan.
          </p>
        </div>

        <div className="mt-12 grid gap-5 md:grid-cols-2">
          {RISK_REVERSAL.map((item, i) => (
            <article
              key={item.title}
              className="reveal flex gap-5 rounded-[20px] border border-[var(--border-strong)] bg-white p-7"
            >
              <div className="flex flex-col items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-[12px] bg-[var(--orange-pale)]">
                  <ShieldIcon />
                </span>
                <span className="font-mono text-[10.5px] tracking-[1.5px] text-[var(--muted-light)]">
                  {`0${i + 1}`}
                </span>
              </div>
              <div className="flex-1 border-l border-[var(--border)] pl-5">
                <h3 className="text-[16px] font-medium text-[var(--dark)]">
                  {item.title}
                </h3>
                <p className="mt-2 text-[13.5px] leading-[1.65] text-[var(--muted)]">
                  {item.body}
                </p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
