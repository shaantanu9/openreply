import { METRICS } from "@/lib/constants";

export function MetricsStrip() {
  return (
    <section id="metrics" className="px-4 py-0 sm:px-8">
      <div className="mx-auto grid max-w-[1200px] grid-cols-2 gap-y-8 rounded-[24px] bg-[var(--dark)] px-5 py-8 sm:px-10 md:grid-cols-4 md:gap-y-0 md:px-16 md:py-12">
        {METRICS.map((m, i) => (
          <div
            key={m.label}
            className={`px-2 text-center sm:px-5 ${
              i < METRICS.length - 1
                ? "md:border-r md:border-white/10"
                : ""
            }`}
          >
            <div className="font-serif text-[34px] font-normal leading-none tracking-[-1px] text-white sm:text-[42px] sm:tracking-[-2px] md:text-[48px]">
              {m.value}
              {m.unit ? <span className="text-[var(--orange)]">{m.unit}</span> : null}
            </div>
            <div className="mt-2 text-[13px] leading-[1.4] text-white/45">
              {m.label}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
