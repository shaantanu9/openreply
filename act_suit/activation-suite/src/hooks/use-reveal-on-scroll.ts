"use client";

import { useEffect } from "react";

/** Adds `is-visible` to every `.reveal` once it enters the viewport. */
export function useRevealOnScroll(selector = ".reveal") {
  useEffect(() => {
    if (typeof window === "undefined") return;
    // Capture window in a non-narrowing local. Using `if (!("…" in window))`
    // narrows the *original* `window` symbol to `never` in the false branch
    // under TS 5+, which then breaks `window.clearTimeout` (Vercel build,
    // Apr 28 2026). Reading through `w` keeps the types clean.
    const w = window;

    const nodes = Array.from(
      document.querySelectorAll<HTMLElement>(selector),
    );
    if (!nodes.length) return;

    // Failsafe: never leave large blank sections hidden if observer timing
    // breaks. 200ms — long enough for the in-viewport observer to fade
    // visible nodes, short enough that the user never sees a blank
    // section even on slow paint or out-of-viewport scroll-skipping.
    // Explicit `w.setTimeout` returns `number`, sidestepping the
    // `NodeJS.Timeout` ambient type from `@types/node`.
    const forceVisibleTimer: number = w.setTimeout(() => {
      nodes.forEach((n) => n.classList.add("is-visible"));
    }, 200);

    const hasIO = typeof IntersectionObserver !== "undefined";
    if (!hasIO) {
      nodes.forEach((n) => n.classList.add("is-visible"));
      w.clearTimeout(forceVisibleTimer);
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry, idx) => {
          if (entry.isIntersecting) {
            const target = entry.target as HTMLElement;
            const delay = (idx % 3) * 80;
            target.style.transitionDelay = `${delay}ms`;
            target.classList.add("is-visible");
            io.unobserve(target);
          }
        });
      },
      { threshold: 0.12 },
    );

    nodes.forEach((n) => io.observe(n));
    return () => {
      w.clearTimeout(forceVisibleTimer);
      io.disconnect();
    };
  }, [selector]);
}
