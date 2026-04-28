"use client";

import { useEffect } from "react";

/** Adds `is-visible` to every `.reveal` once it enters the viewport. */
export function useRevealOnScroll(selector = ".reveal") {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const nodes = Array.from(
      document.querySelectorAll<HTMLElement>(selector),
    );
    if (!nodes.length) return;

    // Failsafe: never leave large blank sections hidden if observer timing
    // breaks. 200ms — long enough for the in-viewport observer to fade
    // visible nodes, short enough that the user never sees a blank
    // section even on slow paint or out-of-viewport scroll-skipping.
    const forceVisibleTimer = setTimeout(() => {
      nodes.forEach((n) => n.classList.add("is-visible"));
    }, 200);

    if (!("IntersectionObserver" in window)) {
      nodes.forEach((n) => n.classList.add("is-visible"));
      clearTimeout(forceVisibleTimer);
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
      clearTimeout(forceVisibleTimer);
      io.disconnect();
    };
  }, [selector]);
}
