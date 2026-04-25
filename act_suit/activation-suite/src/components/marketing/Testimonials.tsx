import { TESTIMONIALS } from "@/lib/constants";

export function Testimonials() {
  return (
    <section id="social" className="bg-[var(--dark)] px-8 py-[100px] text-white">
      <div className="mx-auto max-w-[1200px]">
        <div className="max-w-[620px]">
          <span className="section-label text-[var(--orange-light)]">
            What teams say
          </span>
          <h2 className="section-h2 text-white">
            Research teams ship
            <br />
            <em className="text-[var(--orange-light)]">with more confidence.</em>
          </h2>
        </div>
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {TESTIMONIALS.map((t) => (
            <article
              key={t.name}
              className="testimonial-card reveal flex h-full flex-col gap-6 rounded-[24px] border border-white/10 bg-white/[0.04] p-8"
            >
              <p className="font-serif text-[20px] font-light italic leading-[1.55] text-white/85">
                “{t.quote}”
              </p>
              <div className="mt-auto flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-[12px] font-medium text-white">
                  {t.initials}
                </span>
                <div>
                  <p className="text-[14px] font-medium text-white">{t.name}</p>
                  <p className="text-[12px] text-white/45">{t.role}</p>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
