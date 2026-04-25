import { HOW_STEPS, PIPELINE_SOURCES, PIPELINE_OUTPUT } from "@/lib/constants";

export function HowItWorks() {
  return (
    <section id="how" className="bg-[var(--cream)] px-8 py-[100px]">
      <div className="mx-auto max-w-[1200px]">
        <div className="max-w-[560px]">
          <span className="section-label">Methodology</span>
          <h2 className="section-h2">
            Auditable and repeatable.
            <br />
            <em>Every time.</em>
          </h2>
        </div>
        <div className="mt-16 grid grid-cols-1 items-center gap-20 md:grid-cols-2">
          <div className="flex flex-col gap-0">
            {HOW_STEPS.map((step) => (
              <div
                key={step.num}
                className="how-step group flex cursor-pointer gap-5 border-b border-[var(--border)] py-6 transition-colors last:border-b-0 reveal"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--border-strong)] bg-[var(--cream-dark)] text-[13px] font-medium text-[var(--muted)] transition-colors group-hover:bg-[var(--orange)] group-hover:text-white">
                  {step.num.replace("0", "")}
                </span>
                <div>
                  <h3 className="text-[16px] font-medium text-[var(--dark)]">
                    {step.title}
                  </h3>
                  <p className="mt-[5px] text-[14px] leading-[1.6] text-[var(--muted)]">
                    {step.body}
                  </p>
                </div>
              </div>
            ))}
          </div>
          <div className="relative">
            <div className="rounded-[24px] border border-[var(--border-strong)] bg-white p-6 shadow-[0_4px_40px_rgba(0,0,0,0.07)]">
              <p className="mb-4 text-[12px] font-medium uppercase tracking-[0.8px] text-[var(--muted-light)]">
                Source pipeline · last sweep 1h ago
              </p>
              <div className="flex flex-col gap-2">
                {PIPELINE_SOURCES.map((s) => (
                  <div
                    key={s.label}
                    className="flex items-center justify-between rounded-[10px] border border-[var(--border)] bg-[var(--cream-mid)] px-[14px] py-[10px]"
                  >
                    <div className="flex items-center gap-[10px]">
                      <span
                        className="flex h-7 w-7 items-center justify-center rounded-md text-[11px] font-semibold text-white"
                        style={{ background: s.markBg }}
                      >
                        {s.mark}
                      </span>
                      <div>
                        <div className="text-[13px] font-medium text-[var(--dark)]">
                          {s.label}
                        </div>
                        <div className="text-[11px] text-[var(--muted-light)]">
                          {s.count}
                        </div>
                      </div>
                    </div>
                    <span
                      className={`rounded-full px-[9px] py-[2px] text-[10.5px] font-medium ${
                        s.tone === "green"
                          ? "bg-[#EDF8F1] text-[#0F6E56]"
                          : "bg-[var(--orange-pale)] text-[var(--orange)]"
                      }`}
                    >
                      {s.status}
                    </span>
                  </div>
                ))}
              </div>
              <div className="my-4 flex justify-center text-[var(--muted-light)]">↓</div>
              <div className="rounded-[16px] border border-[rgba(224,123,60,0.25)] bg-[var(--orange-pale)] p-4">
                <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.8px] text-[var(--orange)]">
                  AI-extracted gaps
                </p>
                <div className="flex flex-wrap gap-[6px]">
                  {PIPELINE_OUTPUT.map((p) => (
                    <span
                      key={p.label}
                      className="inline-flex items-center gap-[6px] rounded-full border border-[var(--border)] bg-white px-[10px] py-[4px] text-[11.5px] text-[var(--dark)]"
                    >
                      <span
                        className="h-[7px] w-[7px] rounded-full"
                        style={{ background: p.dot }}
                      />
                      {p.label}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
