import { METRICS } from "@/lib/constants";

export function MetricsStrip() {
  return (
    <section id="metrics" className="px-8 py-0">
      <div className="mx-auto grid max-w-[1200px] grid-cols-2 gap-0 rounded-[24px] bg-[var(--dark)] px-16 py-12 md:grid-cols-4">
        {METRICS.map((m, i) => (
          <div
            key={m.label}
            className={`px-5 text-center ${
              i < METRICS.length - 1
                ? "md:border-r md:border-white/10"
                : ""
            }`}
          >
            <div className="font-serif text-[48px] font-normal leading-none tracking-[-2px] text-white">
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
