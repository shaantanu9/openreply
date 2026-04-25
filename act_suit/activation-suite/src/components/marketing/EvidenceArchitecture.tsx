import { EVIDENCE_LAYERS } from "@/lib/constants";

export function EvidenceArchitecture() {
  return (
    <section id="evidence" className="bg-[var(--cream)] px-8 py-[100px]">
      <div className="mx-auto max-w-[1200px]">
        <div className="max-w-[620px]">
          <span className="section-label">Evidence architecture</span>
          <h2 className="section-h2">
            Three layers. Zero
            <br />
            <em>black boxes.</em>
          </h2>
          <p className="section-sub mt-3">
            Every insight is traceable from conclusion back to raw source post.
            Research credibility starts with transparency.
          </p>
        </div>
        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {EVIDENCE_LAYERS.map((l) => (
            <article
              key={l.num}
              className={`evidence-layer reveal flex flex-col gap-4 rounded-[24px] border p-7 ${
                l.dark
                  ? "border-transparent bg-[var(--dark)] text-white"
                  : "border-[var(--border-strong)] bg-white"
              }`}
            >
              <span
                className={`text-[11px] font-medium tracking-[1.5px] ${
                  l.dark ? "text-[var(--orange-light)]" : "text-[var(--orange)]"
                }`}
              >
                {l.num}
              </span>
              <h3
                className={`font-serif text-[24px] font-normal leading-tight ${
                  l.dark ? "text-white" : "text-[var(--dark)]"
                }`}
              >
                {l.title}
              </h3>
              <p
                className={`text-[14px] leading-[1.65] ${
                  l.dark ? "text-white/60" : "text-[var(--muted)]"
                }`}
              >
                {l.body}
              </p>
              {l.tags?.length ? (
                <div className="mt-2 flex flex-wrap gap-[6px]">
                  {l.tags.map((t) => (
                    <span
                      key={t}
                      className="rounded-full border border-white/15 px-[10px] py-[3px] text-[11px] text-white/70"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              ) : null}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
