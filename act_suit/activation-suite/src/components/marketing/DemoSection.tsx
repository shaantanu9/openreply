"use client";

import { useMemo, useRef, useState } from "react";
import {
  GRAPH_NODES,
  GRAPH_EDGES,
  GRAPH_KIND_COLOR,
  GRAPH_KIND_LABEL,
  type GraphNodeKind,
} from "@/lib/constants";
import {
  useForceGraph,
  type ForceLink,
  type ForceNode,
} from "@/hooks/use-force-graph";

/**
 * Interactive 2D evidence graph mirroring the in-app gap-map.
 *
 * Behaviour:
 *   - Nodes are physics-driven (charge + spring + center damping). They
 *     drift on mount and settle in ~1.5s; click → highlight + KE kick.
 *   - Drag a node to pin it. Release → unpin, simulation re-runs.
 *   - White 3px stroke on highlighted node, accent-blue lit edges.
 *     Matches the dark gap-map.html convention used in the desktop app.
 *   - No focus outline (CSS `outline: none`) — the white-stroke ring is
 *     the only visible selection cue.
 */

// Map our compact GRAPH_NODES (with x, y, size, kind, meta) into the
// shape the force simulator + UI need.
type ViewNode = ForceNode & {
  label: string;
  kind: GraphNodeKind;
  size: number;
  meta: string;
};

function buildInitialNodes(): ViewNode[] {
  return GRAPH_NODES.map((n) => ({
    id: n.id,
    label: n.label,
    kind: n.kind as GraphNodeKind,
    size: n.size,
    meta: n.meta,
    x: n.x,
    y: n.y,
    vx: 0,
    vy: 0,
    fx: null,
    fy: null,
  }));
}

const VIEWBOX = 100;

export function DemoSection() {
  const [activeId, setActiveId] = useState<string | null>("spam");
  const initial = useMemo(() => buildInitialNodes(), []);
  const links = useMemo<ForceLink[]>(
    () => GRAPH_EDGES.map((e) => ({ source: e.from, target: e.to })),
    [],
  );
  // Calmer physics tune (Apr 28 user feedback): less centering, more
  // damping, looser springs. The graph drifts into place over ~2s and
  // settles instead of overshoot-bouncing around the centroid.
  const { nodes, kick } = useForceGraph(initial, links, {
    size: VIEWBOX,
    charge: 14,
    linkDistance: 26,
    linkStrength: 0.045,
    centerStrength: 0.006,
    damping: 0.78,
    stopBelow: 0.002,
  });

  // Build adjacency for highlight lookup. Recomputes only if edges change.
  const adjacency = useMemo(() => {
    const adj = new Map<string, Set<string>>();
    for (const e of GRAPH_EDGES) {
      if (!adj.has(e.from)) adj.set(e.from, new Set());
      if (!adj.has(e.to)) adj.set(e.to, new Set());
      adj.get(e.from)!.add(e.to);
      adj.get(e.to)!.add(e.from);
    }
    return adj;
  }, []);

  const highlighted = useMemo(() => {
    if (!activeId) return new Set<string>();
    const set = new Set<string>([activeId]);
    adjacency.get(activeId)?.forEach((id) => set.add(id));
    return set;
  }, [activeId, adjacency]);

  const activeNode = activeId ? nodes.find((n) => n.id === activeId) : null;
  const activeNeighbours = activeId
    ? Array.from(adjacency.get(activeId) || [])
        .map((id) => nodes.find((n) => n.id === id))
        .filter(Boolean) as ViewNode[]
    : [];

  // Pan + zoom transform applied to the inner <g>. The viewBox stays
  // fixed at 0..VIEWBOX; we translate then scale around the cursor.
  const ZOOM_MIN = 0.5;
  const ZOOM_MAX = 3.5;
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startPan: { x: number; y: number };
  } | null>(null);

  // Drag handling — convert pointer pixels to viewBox coordinates,
  // accounting for the current pan + zoom so the dragged node tracks
  // the cursor regardless of how the canvas is transformed.
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<{ id: string; pointerId: number } | null>(null);
  const toViewBox = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const rawX = ((clientX - rect.left) / rect.width) * VIEWBOX;
    const rawY = ((clientY - rect.top) / rect.height) * VIEWBOX;
    return {
      x: (rawX - pan.x) / zoom,
      y: (rawY - pan.y) / zoom,
    };
  };

  const onWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    // Cursor position in viewBox coords (un-zoomed).
    const px = ((e.clientX - rect.left) / rect.width) * VIEWBOX;
    const py = ((e.clientY - rect.top) / rect.height) * VIEWBOX;
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom * factor));
    if (next === zoom) return;
    // Keep the cursor anchored in graph space across the zoom step.
    setPan({
      x: px - ((px - pan.x) * next) / zoom,
      y: py - ((py - pan.y) * next) / zoom,
    });
    setZoom(next);
  };

  const onSvgPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    // Only initiate a pan if the press landed on the SVG background
    // (not on a node — those swallow the event in their own handler).
    if (e.target !== e.currentTarget) return;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    panDragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startPan: pan,
    };
  };
  const onSvgPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const drag = panDragRef.current;
    if (!drag) return;
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const dx = ((e.clientX - drag.startX) / rect.width) * VIEWBOX;
    const dy = ((e.clientY - drag.startY) / rect.height) * VIEWBOX;
    setPan({ x: drag.startPan.x + dx, y: drag.startPan.y + dy });
  };
  const onSvgPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const drag = panDragRef.current;
    if (!drag) return;
    (e.currentTarget as Element).releasePointerCapture?.(drag.pointerId);
    panDragRef.current = null;
  };

  const stepZoom = (dir: 1 | -1) => {
    const factor = dir === 1 ? 1.18 : 1 / 1.18;
    setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z * factor)));
  };
  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const onPointerDown = (e: React.PointerEvent<SVGGElement>, id: string) => {
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = { id, pointerId: e.pointerId };
    setActiveId(id);
    const n = nodes.find((x) => x.id === id);
    if (n) {
      const p = toViewBox(e.clientX, e.clientY);
      n.fx = p.x;
      n.fy = p.y;
    }
    kick();
  };
  const onPointerMove = (e: React.PointerEvent<SVGGElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const n = nodes.find((x) => x.id === drag.id);
    if (!n) return;
    const p = toViewBox(e.clientX, e.clientY);
    n.fx = p.x;
    n.fy = p.y;
  };
  const onPointerUp = (e: React.PointerEvent<SVGGElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    (e.currentTarget as Element).releasePointerCapture?.(drag.pointerId);
    const n = nodes.find((x) => x.id === drag.id);
    if (n) {
      n.fx = null;
      n.fy = null;
    }
    dragRef.current = null;
    kick();
  };

  return (
    <section
      id="demo"
      className="bg-[var(--dark)] px-8 py-[88px] text-white"
    >
      <div className="mx-auto max-w-[1200px]">
        <div className="grid items-start gap-10 md:grid-cols-[1fr_1.2fr]">
          {/* LEFT — copy + active-node panel */}
          <div className="flex flex-col gap-5">
            <span className="section-label text-[var(--orange-light)]">
              See it in motion
            </span>
            <h2 className="font-serif text-[clamp(30px,3.4vw,42px)] font-normal leading-[1.1] tracking-[-1.2px] text-white">
              Every painpoint
              <br />
              <em className="text-[var(--orange-light)]">links back to its sources.</em>
            </h2>
            <p className="text-[14.5px] leading-[1.65] text-white/60">
              Drag any node. Click it to highlight which other nodes ground
              its evidence. The graph uses the same color coding and
              highlight rules as the gap-map view inside the desktop app.
            </p>

            <div className="mt-2 rounded-[18px] border border-white/10 bg-white/[0.04] p-5">
              {activeNode ? (
                <>
                  <div className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className="inline-flex h-2 w-2 rounded-full"
                      style={{ background: GRAPH_KIND_COLOR[activeNode.kind] }}
                    />
                    <span className="font-mono text-[10.5px] uppercase tracking-[1.4px] text-white/55">
                      {GRAPH_KIND_LABEL[activeNode.kind]}
                    </span>
                  </div>
                  <h3 className="mt-3 font-serif text-[22px] font-normal leading-tight tracking-[-0.4px] text-white">
                    {activeNode.label}
                  </h3>
                  <p className="mt-2 text-[13px] leading-[1.55] text-white/65">
                    {activeNode.meta}
                  </p>
                  {activeNeighbours.length > 0 && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {activeNeighbours.map((n) => (
                        <button
                          key={n.id}
                          type="button"
                          onClick={() => {
                            setActiveId(n.id);
                            kick();
                          }}
                          className="rounded-full border border-white/15 bg-white/[0.04] px-3 py-1 font-mono text-[11px] text-white/75 transition-colors hover:border-[var(--orange)] hover:text-[var(--orange-light)]"
                          style={{ outline: "none" }}
                        >
                          <span
                            aria-hidden
                            className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle"
                            style={{ background: GRAPH_KIND_COLOR[n.kind] }}
                          />
                          {n.label}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <p className="text-[13px] text-white/55">
                  Click any node to inspect.
                </p>
              )}
            </div>

            <p className="font-mono text-[11px] uppercase tracking-[1.3px] text-white/40">
              Pre-launch · interactive demo only · no live data fetch
            </p>
          </div>

          {/* RIGHT — SVG graph canvas */}
          <div className="relative">
            <div className="absolute -inset-4 -z-10 rounded-[32px] bg-[radial-gradient(700px_300px_at_70%_0%,rgba(224,123,60,0.15),transparent_70%)]" />
            <div className="overflow-hidden rounded-[24px] border border-white/10 bg-[#0b0e13] p-5 shadow-[0_30px_80px_rgba(0,0,0,0.55)]">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10.5px] uppercase tracking-[1.4px] text-white/50">
                  Evidence graph · click · drag · scroll to zoom
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setActiveId(null);
                    kick();
                  }}
                  className="font-mono text-[10.5px] uppercase tracking-[1.4px] text-white/40 transition-colors hover:text-white/80"
                  style={{ outline: "none" }}
                >
                  Reset
                </button>
              </div>
              <div className="relative mt-3">
                {/* zoom controls */}
                <div className="pointer-events-auto absolute right-2 top-2 z-10 flex flex-col overflow-hidden rounded-md border border-white/15 bg-[#15100A]/80 backdrop-blur">
                  <button
                    type="button"
                    onClick={() => stepZoom(1)}
                    className="px-2 py-1 font-mono text-[12px] text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                    aria-label="Zoom in"
                    style={{ outline: "none" }}
                  >
                    +
                  </button>
                  <button
                    type="button"
                    onClick={() => stepZoom(-1)}
                    className="border-t border-white/10 px-2 py-1 font-mono text-[12px] text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                    aria-label="Zoom out"
                    style={{ outline: "none" }}
                  >
                    −
                  </button>
                  <button
                    type="button"
                    onClick={resetView}
                    className="border-t border-white/10 px-2 py-1 font-mono text-[10px] text-white/55 transition-colors hover:bg-white/10 hover:text-white"
                    aria-label="Reset zoom"
                    style={{ outline: "none" }}
                  >
                    ⤾
                  </button>
                </div>
                <svg
                  ref={svgRef}
                  viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
                  className="force-graph h-auto w-full select-none touch-none"
                  role="img"
                  aria-label="Interactive evidence graph"
                  style={{
                    outline: "none",
                    // Cursor reflects whether a pan is in progress. We can't
                    // bind directly to panDragRef in the style prop without
                    // tripping React-compiler's "no ref read in render" rule,
                    // so just leave it as `grab` — pointer styling is
                    // cosmetic and the cursor still flips inside the
                    // pointermove handler if we ever want the upgrade.
                    cursor: "grab",
                  }}
                  onWheel={onWheel}
                  onPointerDown={onSvgPointerDown}
                  onPointerMove={onSvgPointerMove}
                  onPointerUp={onSvgPointerUp}
                  onPointerCancel={onSvgPointerUp}
                >
                  <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
                    {/* edges first so nodes render on top */}
                    {GRAPH_EDGES.map((e, i) => {
                      const a = nodes.find((n) => n.id === e.from);
                      const b = nodes.find((n) => n.id === e.to);
                      if (!a || !b) return null;
                      const isLit =
                        activeId !== null &&
                        (e.from === activeId || e.to === activeId);
                      return (
                        <line
                          key={i}
                          x1={a.x}
                          y1={a.y}
                          x2={b.x}
                          y2={b.y}
                          stroke={isLit ? "#58a6ff" : "#48505c"}
                          strokeOpacity={isLit ? 0.9 : 0.25}
                          strokeWidth={isLit ? 0.6 : 0.3}
                        />
                      );
                    })}
                    {nodes.map((n) => {
                      const dim = activeId !== null && !highlighted.has(n.id);
                      const isActive = n.id === activeId;
                      const fill = GRAPH_KIND_COLOR[n.kind];
                      return (
                        <g
                          key={n.id}
                          transform={`translate(${n.x} ${n.y})`}
                          style={{
                            opacity: dim ? 0.18 : 1,
                            cursor: "grab",
                            transition: "opacity 200ms ease",
                            outline: "none",
                          }}
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            onPointerDown(e, n.id);
                          }}
                          onPointerMove={onPointerMove}
                          onPointerUp={onPointerUp}
                          onPointerCancel={onPointerUp}
                          tabIndex={-1}
                        >
                          <circle
                            r={n.size}
                            fill={fill}
                            stroke={isActive ? "#ffffff" : "#0b0e13"}
                            strokeWidth={isActive ? 1.4 : 1.2}
                          />
                          <text
                            y={n.size + 3.4}
                            textAnchor="middle"
                            fontSize={2.4}
                            fontFamily="inherit"
                            fontWeight={isActive ? 700 : 500}
                            fill={isActive ? "#ffffff" : "#8b949e"}
                            style={{ pointerEvents: "none" }}
                          >
                            {n.label}
                          </text>
                        </g>
                      );
                    })}
                  </g>
                </svg>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-[10.5px] text-white/55">
                <div className="flex flex-wrap items-center gap-3">
                  {(["source", "painpoint", "subreddit"] as GraphNodeKind[]).map(
                    (k) => (
                      <span key={k} className="inline-flex items-center gap-1.5">
                        <span
                          className="inline-block h-2 w-2 rounded-full"
                          style={{ background: GRAPH_KIND_COLOR[k] }}
                        />
                        {GRAPH_KIND_LABEL[k]}
                      </span>
                    ),
                  )}
                </div>
                <span className="font-mono text-white/40">
                  {nodes.length} nodes · {GRAPH_EDGES.length} edges
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
