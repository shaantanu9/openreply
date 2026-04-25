"use client";

import { useState } from "react";
import { BRAND, FAQS } from "@/lib/constants";

export function FaqAccordion() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section id="faq" className="bg-[var(--cream-mid)] px-8 py-[100px]">
      <div className="mx-auto grid max-w-[1200px] gap-16 md:grid-cols-[1fr_1.4fr]">
        <div>
          <span className="section-label">FAQ</span>
          <h2 className="font-serif text-[clamp(30px,3.4vw,40px)] font-normal leading-tight tracking-[-1px] text-[var(--dark)]">
            Questions we hear
            <br />
            from product teams.
          </h2>
          <p className="mt-5 text-[15px] leading-[1.65] text-[var(--muted)]">
            Can&rsquo;t find your answer here? Write to us at{" "}
            <a
              href={`mailto:${BRAND.supportEmail}`}
              className="text-[var(--orange)] hover:underline"
            >
              {BRAND.supportEmail}
            </a>{" "}
            and we&rsquo;ll reply within one business day.
          </p>
          <a
            href={`mailto:${BRAND.supportEmail}`}
            className="btn btn-ghost mt-6"
          >
            Contact support
          </a>
        </div>
        <div className="flex flex-col gap-3">
          {FAQS.map((item, idx) => {
            const isOpen = open === idx;
            return (
              <div
                key={item.q}
                className={`faq-item overflow-hidden rounded-[16px] border transition-colors ${
                  isOpen
                    ? "border-[var(--border-strong)] bg-white"
                    : "border-[var(--border)] bg-white/60"
                }`}
              >
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : idx)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left text-[15px] font-medium text-[var(--dark)]"
                >
                  <span>{item.q}</span>
                  <span
                    aria-hidden
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[var(--border-strong)] text-[14px] transition-transform ${
                      isOpen ? "rotate-45 text-[var(--orange)]" : "text-[var(--muted)]"
                    }`}
                  >
                    +
                  </span>
                </button>
                {isOpen ? (
                  <div className="px-6 pb-6 text-[14px] leading-[1.7] text-[var(--muted)]">
                    {item.a}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
