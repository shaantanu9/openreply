import { TRUST_LOGOS } from "@/lib/constants";

/**
 * Logo-mark strip directly under the hero. We render brand initials
 * inside neutral pill tokens so the section ships without licensed
 * logo SVGs — swap in real marks when partner permission lands.
 *
 * Visual rule: monochrome at rest, orange-tint on hover so the eye
 * still reads "logos", not "buttons".
 */
export function TrustLogoBar() {
  return (
    <section
      aria-label="Teams using Gap Map"
      className="border-y border-[var(--border)] bg-[var(--cream-mid)]"
    >
      <div className="mx-auto flex max-w-[1200px] flex-col items-center gap-6 px-8 py-10 md:flex-row md:gap-10">
        <p className="shrink-0 text-[11px] font-medium uppercase tracking-[1.5px] text-[var(--muted-light)]">
          Trusted by research teams at
        </p>
        <div className="flex flex-wrap items-center justify-center gap-6 md:justify-start md:gap-9">
          {TRUST_LOGOS.map((l) => (
            <div
              key={l.name}
              className="group flex items-center gap-2 opacity-60 transition-opacity hover:opacity-100"
              title={l.name}
              aria-label={l.name}
            >
              <span
                className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border-strong)] bg-white text-[12px] font-semibold text-[var(--muted)] transition-colors group-hover:border-[var(--orange)] group-hover:text-[var(--orange)]"
                style={{ transform: `scale(${l.scale})` }}
              >
                {l.initials}
              </span>
              <span className="hidden text-[12.5px] font-medium tracking-tight text-[var(--muted)] transition-colors group-hover:text-[var(--dark)] sm:inline">
                {l.name}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
