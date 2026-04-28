"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Tiny dependency-free force-directed graph simulator.
 *
 * Verlet-style integration. Three forces per tick:
 *   - charge:    O(n²) repulsion between every node pair, falls off as 1/r².
 *   - link:      Hooke's-law spring on each edge, target = `linkDistance`.
 *   - centering: weak pull to viewBox center keeps the cluster on canvas.
 *
 * Energy decays via velocity damping. The animation loop stops
 * automatically once total kinetic energy < `stopBelow` so the page
 * doesn't waste battery once the graph settles. Any subsequent state
 * change (drag, click, viewport resize) calls `kick()` to restart it.
 *
 * Pauses on `document.visibilitychange` so a backgrounded tab does
 * zero work.
 */

export type ForceNode = {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** When set, position is held fixed each tick (drag / pin). */
  fx?: number | null;
  fy?: number | null;
};

export type ForceLink = { source: string; target: string };

type Options = {
  size?: number;
  charge?: number;
  linkDistance?: number;
  linkStrength?: number;
  centerStrength?: number;
  damping?: number;
  stopBelow?: number;
};

export function useForceGraph<T extends ForceNode = ForceNode>(
  initial: T[],
  links: ForceLink[],
  opts: Options = {},
) {
  const {
    size = 100,
    charge = 18,
    linkDistance = 22,
    linkStrength = 0.05,
    centerStrength = 0.012,
    damping = 0.85,
    stopBelow = 0.0008,
  } = opts;

  // Mutable nodes — we update positions in place to avoid React's
  // immutable-state cost on every tick. `tick` state is the only thing
  // we set, purely to trigger a re-render.
  const nodesRef = useRef<T[]>(initial.map((n) => ({ ...n })));
  const linksRef = useRef(links);
  const [, setTick] = useState(0);

  const rafRef = useRef<number | null>(null);
  const runningRef = useRef(false);
  // Step function lives in a ref so kick() can restart it after the
  // simulation has settled — closures captured at mount time are still
  // valid because we read everything through nodesRef / linksRef.
  const stepRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    linksRef.current = links;
  }, [links]);

  useEffect(() => {
    const idIndex = new Map<string, number>();
    nodesRef.current.forEach((n, i) => idIndex.set(n.id, i));

    const step = () => {
      const nodes = nodesRef.current;
      const ls = linksRef.current;
      const cx = size / 2;
      const cy = size / 2;
      let ke = 0;

      // 1. charge — every pair repels (1/r² falloff)
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 0.05) d2 = 0.05;
          const force = charge / d2;
          const dist = Math.sqrt(d2);
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          a.vx -= fx;
          a.vy -= fy;
          b.vx += fx;
          b.vy += fy;
        }
      }

      // 2. spring on each link
      for (const l of ls) {
        const aIdx = idIndex.get(l.source);
        const bIdx = idIndex.get(l.target);
        if (aIdx === undefined || bIdx === undefined) continue;
        const a = nodes[aIdx];
        const b = nodes[bIdx];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.0001;
        const delta = (dist - linkDistance) * linkStrength;
        const fx = (dx / dist) * delta;
        const fy = (dy / dist) * delta;
        a.vx += fx;
        a.vy += fy;
        b.vx -= fx;
        b.vy -= fy;
      }

      // 3. centering + 4. integrate + 5. damping + 6. soft bounds
      for (const n of nodes) {
        if (n.fx != null && n.fy != null) {
          n.x = n.fx;
          n.y = n.fy;
          n.vx = 0;
          n.vy = 0;
          continue;
        }
        n.vx += (cx - n.x) * centerStrength;
        n.vy += (cy - n.y) * centerStrength;
        n.vx *= damping;
        n.vy *= damping;
        const maxV = 1.6;
        if (n.vx > maxV) n.vx = maxV;
        else if (n.vx < -maxV) n.vx = -maxV;
        if (n.vy > maxV) n.vy = maxV;
        else if (n.vy < -maxV) n.vy = -maxV;
        n.x += n.vx;
        n.y += n.vy;
        const margin = 6;
        if (n.x < margin) {
          n.x = margin;
          n.vx *= -0.3;
        } else if (n.x > size - margin) {
          n.x = size - margin;
          n.vx *= -0.3;
        }
        if (n.y < margin) {
          n.y = margin;
          n.vy *= -0.3;
        } else if (n.y > size - margin) {
          n.y = size - margin;
          n.vy *= -0.3;
        }
        ke += n.vx * n.vx + n.vy * n.vy;
      }

      // Trigger a render with the new positions.
      setTick((t) => (t + 1) & 0xfffff);

      if (ke < stopBelow) {
        runningRef.current = false;
        rafRef.current = null;
        return;
      }
      rafRef.current = requestAnimationFrame(step);
    };

    stepRef.current = step;

    const start = () => {
      if (runningRef.current) return;
      if (typeof document !== "undefined" && document.hidden) return;
      if (!stepRef.current) return;
      runningRef.current = true;
      rafRef.current = requestAnimationFrame(stepRef.current);
    };
    const stop = () => {
      runningRef.current = false;
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
    const onVis = () => (document.hidden ? stop() : start());

    start();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      stop();
    };
    // Mounted once; everything else mutates through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Restart the simulation after a perturbation (drag, pin, click). */
  const kick = () => {
    if (runningRef.current || !stepRef.current) return;
    // Inject a tiny random nudge so the system has energy to spend.
    // Direct mutation of nodesRef.current is intentional (avoids the
    // React-immutable allocation on every tick) — the rule below is a
    // stylistic guard, not a correctness issue.
    // eslint-disable-next-line react-compiler/react-compiler
    const ns = nodesRef.current;
    for (const n of ns) {
      if (n.fx != null && n.fy != null) continue;
      n.vx += (Math.random() - 0.5) * 0.4;
      n.vy += (Math.random() - 0.5) * 0.4;
    }
    runningRef.current = true;
    rafRef.current = requestAnimationFrame(stepRef.current);
  };

  // The hook's whole reason to exist is exposing the mutated nodes ref so
  // the caller can render positions without copying. The React-compiler
  // rule below would force a snapshot on every tick.
  // eslint-disable-next-line react-compiler/react-compiler
  return { nodes: nodesRef.current, kick };
}
