import { FINAL_PROMISE } from "@/lib/constants";

/**
 * Closing promise section right before the final CTA. Three numbered
 * commitments — the model is "what we'll be held to", not "what we
 * sell". Strong type contrast with the dark CTA that follows.
 */
export function FinalPromiseSection() {
  return (
    <section
      id="promise"
      className="bg-[var(--cream-mid)] px-8 py-[100px]"
    >
      <div className="mx-auto max-w-[1200px]">
        <div className="grid items-end gap-12 md:grid-cols-[1fr_1.4fr]">
          <div>
            <span className="section-label">Our promise</span>
            <h2 className="section-h2">
              {FINAL_PROMISE.headline.split(" ").slice(0, 2).join(" ")}
              <br />
              <em>
                {FINAL_PROMISE.headline.split(" ").slice(2).join(" ")}
              </em>
            </h2>
          </div>
          <div className="flex flex-col gap-3">
            {FINAL_PROMISE.promises.map((p) => (
              <article
                key={p.n}
                className="reveal flex items-start gap-6 border-b border-[var(--border-strong)] py-6 last:border-b-0"
              >
                <span className="font-serif text-[34px] font-normal leading-none tracking-[-1px] text-[var(--orange)]">
                  {p.n}
                </span>
                <div>
                  <p className="text-[18px] font-medium leading-snug text-[var(--dark)]">
                    {p.claim}
                  </p>
                  <p className="mt-2 text-[14px] leading-[1.65] text-[var(--muted)]">
                    {p.proof}
                  </p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
