"use client";

import { useMemo, useState } from "react";

export function RoiSection() {
  const [weeklyHours, setWeeklyHours] = useState(16);
  const [teamSize, setTeamSize] = useState(4);
  const [hourlyRate, setHourlyRate] = useState(45);

  const roi = useMemo(() => {
    const monthlyHours = weeklyHours * 4 * teamSize;
    const baselineCost = monthlyHours * hourlyRate;
    const savingsCost = baselineCost * 0.45;
    const annualSavings = savingsCost * 12;
    return {
      monthlyHours: Math.round(monthlyHours),
      baselineCost: Math.round(baselineCost),
      savingsCost: Math.round(savingsCost),
      annualSavings: Math.round(annualSavings),
    };
  }, [weeklyHours, teamSize, hourlyRate]);

  return (
    <section id="roi" className="bg-[var(--cream-mid)] px-8 py-[80px]">
      <div className="mx-auto max-w-[1200px]">
        <div className="grid items-start gap-8 md:grid-cols-2">
          <div>
            <span className="section-label">Value math</span>
            <h2 className="section-h2">
              Estimate your research
              <br />
              <em>time-to-insight ROI.</em>
            </h2>
            <p className="section-sub">
              Conservative model: teams that move manual synthesis into Gap Map
              typically reclaim ~45% of research processing time.
            </p>
            <div className="mt-8 rounded-[20px] border border-[var(--border-strong)] bg-white p-5">
              <label className="mb-4 block text-[13px] font-medium text-[var(--dark)]">
                Hours/week spent on manual synthesis: {weeklyHours}h
              </label>
              <input
                type="range"
                min={6}
                max={40}
                step={1}
                value={weeklyHours}
                onChange={(e) => setWeeklyHours(Number(e.target.value))}
                className="w-full accent-[var(--orange)]"
              />
              <label className="mb-4 mt-6 block text-[13px] font-medium text-[var(--dark)]">
                Team members involved: {teamSize}
              </label>
              <input
                type="range"
                min={1}
                max={12}
                step={1}
                value={teamSize}
                onChange={(e) => setTeamSize(Number(e.target.value))}
                className="w-full accent-[var(--orange)]"
              />
              <label className="mb-4 mt-6 block text-[13px] font-medium text-[var(--dark)]">
                Blended hourly rate: ${hourlyRate}
              </label>
              <input
                type="range"
                min={20}
                max={140}
                step={5}
                value={hourlyRate}
                onChange={(e) => setHourlyRate(Number(e.target.value))}
                className="w-full accent-[var(--orange)]"
              />
            </div>
          </div>
          <div className="reveal rounded-[24px] border border-[var(--border-strong)] bg-[var(--dark)] p-8 text-white">
            <p className="text-[12px] font-medium uppercase tracking-[1px] text-[var(--orange-light)]">
              Your estimated upside
            </p>
            <div className="mt-6 grid grid-cols-2 gap-4">
              <div className="rounded-[14px] border border-white/10 bg-white/[0.04] p-4">
                <p className="text-[12px] text-white/55">Monthly research hours</p>
                <p className="mt-1 font-serif text-[30px] tracking-[-0.8px] text-white">
                  {roi.monthlyHours}h
                </p>
              </div>
              <div className="rounded-[14px] border border-white/10 bg-white/[0.04] p-4">
                <p className="text-[12px] text-white/55">Manual monthly cost</p>
                <p className="mt-1 font-serif text-[30px] tracking-[-0.8px] text-white">
                  ${roi.baselineCost.toLocaleString()}
                </p>
              </div>
              <div className="rounded-[14px] border border-[rgba(224,123,60,0.5)] bg-[rgba(224,123,60,0.16)] p-4">
                <p className="text-[12px] text-white/70">Potential monthly savings</p>
                <p className="mt-1 font-serif text-[30px] tracking-[-0.8px] text-[var(--orange-light)]">
                  ${roi.savingsCost.toLocaleString()}
                </p>
              </div>
              <div className="rounded-[14px] border border-white/10 bg-white/[0.04] p-4">
                <p className="text-[12px] text-white/55">Projected annual impact</p>
                <p className="mt-1 font-serif text-[30px] tracking-[-0.8px] text-white">
                  ${roi.annualSavings.toLocaleString()}
                </p>
              </div>
            </div>
            <p className="mt-6 text-[12.5px] leading-[1.6] text-white/60">
              Illustrative estimator for planning discussions. Your result depends on
              source volume, workflow maturity, and team process.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <a href="/sign-in" className="btn btn-orange">
                Join the founding beta →
              </a>
              <a href="/pricing" className="btn border border-white/20 bg-white/[0.06] text-white hover:bg-white/10">
                See what&rsquo;s included →
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
