import { DownloadLink } from "@/components/shell/DownloadLink";
import { PLANS } from "@/lib/constants";

export function PricingSection() {
  return (
    <section id="pricing" className="bg-[var(--cream-mid)] px-8 py-[100px]">
      <div className="mx-auto max-w-[1200px]">
        <div className="mx-auto max-w-[620px] text-center">
          <span className="section-label">Pricing</span>
          <h2 className="section-h2">Simple, transparent pricing.</h2>
          <p className="section-sub mx-auto">
            Token-based usage on top of a flat monthly seat. Bring your own AI
            key to control costs.
          </p>
        </div>
        <div className="mt-12 grid gap-6 md:grid-cols-2">
          {PLANS.map((plan) => {
            const featured = Boolean(plan.accent);
            return (
              <article
                key={plan.code}
                className={`pricing-card reveal relative rounded-[24px] border p-10 ${
                  featured
                    ? "border-transparent bg-[var(--dark)] text-white"
                    : "border-[var(--border-strong)] bg-white"
                }`}
              >
                {featured ? (
                  <span className="absolute right-6 top-6 rounded-full bg-[var(--orange)] px-3 py-[3px] text-[11px] font-medium uppercase tracking-[0.6px] text-white">
                    Most popular
                  </span>
                ) : null}
                <h3
                  className={`font-serif text-[28px] font-normal tracking-[-0.5px] ${
                    featured ? "text-white" : "text-[var(--dark)]"
                  }`}
                >
                  {plan.name}
                </h3>
                <p
                  className={`mt-1 text-[13.5px] ${
                    featured ? "text-white/60" : "text-[var(--muted)]"
                  }`}
                >
                  {plan.description}
                </p>
                <div className="mt-6 flex items-baseline gap-2">
                  <span
                    className={`font-serif text-[44px] font-normal leading-none ${
                      featured ? "text-white" : "text-[var(--dark)]"
                    }`}
                  >
                    {plan.price}
                  </span>
                  <span
                    className={`text-[13px] ${
                      featured ? "text-white/50" : "text-[var(--muted-light)]"
                    }`}
                  >
                    {plan.period}
                  </span>
                </div>
                <ul className="mt-6 flex flex-col gap-2">
                  {plan.features.map((f) => (
                    <li
                      key={f}
                      className={`flex gap-2 text-[14px] ${
                        featured ? "text-white/75" : "text-[var(--text)]"
                      }`}
                    >
                      <span
                        className={
                          featured ? "text-[var(--orange-light)]" : "text-[var(--orange)]"
                        }
                      >
                        ✓
                      </span>
                      {f}
                    </li>
                  ))}
                </ul>
                <DownloadLink
                  className={`btn btn-lg mt-8 w-full justify-center ${
                    featured ? "btn-orange" : "btn-ghost"
                  }`}
                >
                  {plan.cta}
                </DownloadLink>
              </article>
            );
          })}
        </div>
        <p className="mt-8 text-center text-[13.5px] text-[var(--muted)]">
          Need more tokens? Top up anytime. BYOK users get unlimited AI
          inference at cost.
        </p>
      </div>
    </section>
  );
}
