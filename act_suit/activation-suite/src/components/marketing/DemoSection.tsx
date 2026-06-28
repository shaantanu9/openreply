"use client";

import { useState } from "react";
import { DEMO_FRAMES } from "@/lib/constants";

/**
 * Click-to-switch screenshot/demo carousel. The right column shows a
 * stylised "browser frame" of the active demo step — once we have real
 * GIFs/MP4s captured, swap the placeholder block for an autoplay video.
 *
 * The frame caption ('demo · 12s') hints at length so users self-select
 * their commitment level instead of bouncing on a 4-minute hero video.
 */
export function DemoSection() {
  const [active, setActive] = useState(0);
  const frame = DEMO_FRAMES[active];

  return (
    <section
      id="demo"
      className="bg-[var(--dark)] px-8 py-[100px] text-white"
    >
      <div className="mx-auto max-w-[1200px]">
        <div className="mx-auto max-w-[640px] text-center">
          <span className="section-label text-[var(--orange-light)]">
            See it in motion
          </span>
          <h2 className="section-h2 text-white">
            Four moments,
            <br />
            <em className="text-[var(--orange-light)]">three minutes total.</em>
          </h2>
          <p className="section-sub mx-auto text-white/55">
            Pick the part of the workflow you care about. We'll start a focused
            screen-capture instead of a marketing reel.
          </p>
        </div>

        <div className="mt-14 grid items-start gap-10 md:grid-cols-[0.85fr_1.15fr]">
          {/* LEFT — switcher list */}
          <div className="flex flex-col gap-3">
            {DEMO_FRAMES.map((f, i) => {
              const isActive = i === active;
              return (
                <button
                  key={f.eyebrow}
                  type="button"
                  onClick={() => setActive(i)}
                  aria-pressed={isActive}
                  className={`group flex flex-col gap-1 rounded-[18px] border p-5 text-left transition-all ${
                    isActive
                      ? "border-[var(--orange)] bg-white/[0.06]"
                      : "border-white/10 bg-transparent hover:border-white/20 hover:bg-white/[0.03]"
                  }`}
                >
                  <span
                    className={`text-[10.5px] font-mono font-medium uppercase tracking-[1.4px] ${
                      isActive ? "text-[var(--orange-light)]" : "text-white/40"
                    }`}
                  >
                    {f.eyebrow}
                  </span>
                  <span
                    className={`mt-1 font-serif text-[18px] font-normal leading-snug ${
                      isActive ? "text-white" : "text-white/65"
                    }`}
                  >
                    {f.title}
                  </span>
                </button>
              );
            })}
          </div>

          {/* RIGHT — animated frame */}
          <div className="relative">
            <div className="absolute -inset-4 -z-10 rounded-[32px] bg-[radial-gradient(700px_300px_at_70%_0%,rgba(224,123,60,0.18),transparent_70%)]" />
            <div className="overflow-hidden rounded-[24px] border border-white/10 bg-[#0E0A05] shadow-[0_30px_80px_rgba(0,0,0,0.6)]">
              {/* faux browser chrome */}
              <div className="flex items-center gap-2 border-b border-white/5 bg-[#15100A] px-4 py-3">
                <span className="h-3 w-3 rounded-full bg-white/10" />
                <span className="h-3 w-3 rounded-full bg-white/10" />
                <span className="h-3 w-3 rounded-full bg-white/10" />
                <span className="ml-3 rounded-md bg-white/[0.04] px-3 py-[3px] font-mono text-[11px] text-white/40">
                  openreply-map · {frame.eyebrow.split("·")[1]?.trim() || "demo"}
                </span>
                <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-[var(--orange)]/15 px-2.5 py-[3px] text-[10.5px] font-medium uppercase tracking-[1.2px] text-[var(--orange-light)]">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--orange-light)]" />
                  {frame.badge}
                </span>
              </div>
              {/* body */}
              <div className="flex min-h-[340px] flex-col justify-end gap-3 p-6 sm:p-10">
                <span className="text-[10.5px] font-mono uppercase tracking-[1.4px] text-[var(--orange-light)]">
                  {frame.eyebrow}
                </span>
                <p className="font-serif text-[28px] font-normal leading-tight tracking-[-0.5px] text-white">
                  {frame.title}
                </p>
                <p className="max-w-[460px] text-[14px] leading-[1.65] text-white/55">
                  {frame.body}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <span className="rounded-full border border-white/15 bg-white/[0.03] px-3 py-1 font-mono text-[11px] text-white/55">
                    macOS 13+
                  </span>
                  <span className="rounded-full border border-white/15 bg-white/[0.03] px-3 py-1 font-mono text-[11px] text-white/55">
                    Apple Silicon · Intel
                  </span>
                  <span className="rounded-full border border-[var(--orange)]/40 bg-[var(--orange)]/[0.08] px-3 py-1 font-mono text-[11px] text-[var(--orange-light)]">
                    no signup needed to watch
                  </span>
                </div>
              </div>
            </div>
            <p className="mt-4 text-center font-mono text-[11px] uppercase tracking-[1.4px] text-white/35">
              Click any moment on the left to switch the focus
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
