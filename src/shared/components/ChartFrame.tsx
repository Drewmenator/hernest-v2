// ─── ChartFrame: the base for every chart ──────────────────────────
// One place for what makes a chart feel native on iPhone: it sizes to its
// card, uses the theme's colors (CSS variables, so Glow and Midnight both
// work), and reads by touch, not hover. Drag a finger across it and a
// crosshair and a glass tooltip follow; vertical drags still scroll the
// page. Built on visx (plain SVG, no canvas). Charts keep well under 300
// SVG nodes; long series are thinned before they get here.
import React, { useCallback, useId, useLayoutEffect, useRef, useState } from "react";
import { scaleLinear } from "@visx/scale";
import { Group } from "@visx/group";
import { LinePath, AreaClosed, Line } from "@visx/shape";
import { curveMonotoneX } from "@visx/curve";
import { useTooltip, TooltipWithBounds, defaultStyles } from "@visx/tooltip";
import { T, F, SHADOWS } from "../../config/theme";
import { haptic } from "../haptics";

export type ChartCtx = {
  width: number; height: number; innerW: number; innerH: number;
  x: (i: number) => number;          // index to pixels
  active: number | null;             // the point under the finger
  uid: string;                       // unique id for gradients
};

const MARGIN = { top: 12, right: 14, bottom: 26, left: 6 };

export function ChartFrame({ count, height, ariaLabel, labels, tooltip, children }: {
  count: number;                                  // number of points along x
  height: number;
  ariaLabel: string;                              // the chart's point in words
  labels?: (i: number) => string;                 // short x labels (e.g. "T")
  tooltip?: (i: number) => React.ReactNode;       // what the scrub shows
  children: (ctx: ChartCtx) => React.ReactNode;   // the marks
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  // Size to the card, and follow it if it changes (rotation, text size).
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth || 320);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // A tap on the chart reads it; it never also taps the card around it.
  return (
    <div ref={box} role="img" aria-label={ariaLabel} onClick={e => e.stopPropagation()} style={{ position: "relative", width: "100%", height }}>
      {width > 0 && <Inner width={width} height={height} count={count} labels={labels} tooltip={tooltip} uid={uid}>{children}</Inner>}
    </div>
  );
}

function Inner({ width, height, count, labels, tooltip, uid, children }: {
  width: number; height: number; count: number; uid: string;
  labels?: (i: number) => string;
  tooltip?: (i: number) => React.ReactNode;
  children: (ctx: ChartCtx) => React.ReactNode;
}) {
  const innerW = Math.max(0, width - MARGIN.left - MARGIN.right);
  const innerH = Math.max(0, height - MARGIN.top - MARGIN.bottom);
  const xScale = scaleLinear({ domain: [0, Math.max(1, count - 1)], range: [0, innerW] });
  const x = (i: number) => xScale(i);
  const { tooltipOpen, tooltipLeft, tooltipData, showTooltip, hideTooltip } = useTooltip<number>();
  const last = useRef<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Finger (or mouse) position → nearest point. Pointer events cover both.
  const scrub = useCallback((clientX: number) => {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box || !tooltip) return;
    const i = Math.round(xScale.invert(clientX - box.left - MARGIN.left));
    const idx = Math.min(count - 1, Math.max(0, i));
    if (idx !== last.current) { last.current = idx; haptic("select"); }
    showTooltip({ tooltipData: idx, tooltipLeft: MARGIN.left + x(idx), tooltipTop: 0 });
  }, [count, tooltip, xScale, showTooltip]); // eslint-disable-line react-hooks/exhaustive-deps

  const end = () => { last.current = null; hideTooltip(); };
  const active = tooltipOpen && tooltipData != null ? tooltipData : null;

  return (
    <>
      <svg ref={svgRef} width={width} height={height} style={{ display: "block", overflow: "visible", touchAction: "pan-y" }}
        onPointerDown={e => { (e.target as Element).setPointerCapture?.(e.pointerId); scrub(e.clientX); }}
        onPointerMove={e => { if (e.pointerType === "mouse" || e.buttons) scrub(e.clientX); }}
        onPointerUp={end} onPointerCancel={end} onPointerLeave={e => { if (e.pointerType === "mouse") end(); }}>
        <Group left={MARGIN.left} top={MARGIN.top}>
          {children({ width, height, innerW, innerH, x, active, uid })}
          {active != null && (
            <Line from={{ x: x(active), y: -6 }} to={{ x: x(active), y: innerH }}
              style={{ stroke: T.text }} strokeOpacity={0.35} strokeWidth={1} strokeDasharray="2 3" pointerEvents="none" />
          )}
          {labels && Array.from({ length: count }, (_, i) => (
            <text key={i} x={x(i)} y={innerH + 18} textAnchor="middle"
              style={{ fill: i === active ? T.text : T.text2, fontFamily: F.sans, fontSize: 12, fontWeight: i === active || i === count - 1 ? 700 : 500 }}>
              {labels(i)}
            </text>
          ))}
        </Group>
      </svg>
      {tooltip && active != null && (
        <TooltipWithBounds key={active} left={tooltipLeft} top={-8} offsetLeft={12} offsetTop={0}
          style={{
            ...defaultStyles, background: T.frost, color: T.text, border: `1px solid ${T.glass}`,
            backdropFilter: "blur(16px) saturate(170%)", WebkitBackdropFilter: "blur(16px) saturate(170%)",
            boxShadow: SHADOWS.md, borderRadius: 12, padding: "6px 10px", fontFamily: F.sans, fontSize: 13, pointerEvents: "none",
          }}>
          {tooltip(active)}
        </TooltipWithBounds>
      )}
    </>
  );
}

// ─── TrendChart: a smooth line with a soft fill ────────────────────
// For a handful of days or nights (sleep, readiness, steps). Missing days
// leave a gap rather than a made-up value. The glow is a wider, faint
// stroke under the line (no blur filter, so it stays smooth on phones).
export function TrendChart({ values, color, height = 132, guide, labels, format, ariaLabel, detailLabel }: {
  values: (number | null)[];
  color: string;                                   // an ATMOS chart color
  height?: number;
  guide?: { value: number; label: string };        // e.g. 7 hours
  labels: (i: number) => string;                   // x labels ("M", "T", ...)
  detailLabel: (i: number) => string;              // tooltip title ("Tue, Oct 20")
  format: (v: number) => string;                   // tooltip value ("7.4 hours")
  ariaLabel: string;
}) {
  const known = values.filter((v): v is number => v != null);
  if (known.length < 2) return null;
  const all = guide ? [...known, guide.value] : known;
  const lo = Math.min(...all), hi = Math.max(...all);
  const pad = (hi - lo || 1) * 0.25;
  const pts = values.map((v, i) => ({ i, v }));
  const defined = (d: { v: number | null }) => d.v != null;
  const lastIdx = values.reduce<number>((acc, v, i) => (v != null ? i : acc), -1);

  return (
    <ChartFrame count={values.length} height={height} ariaLabel={ariaLabel} labels={labels}
      tooltip={i => values[i] == null
        ? <span style={{ color: T.text2 }}>{detailLabel(i)}: no data</span>
        : <span><span style={{ color: T.text2 }}>{detailLabel(i)}</span> · <strong>{format(values[i]!)}</strong></span>}>
      {({ innerH, x, active, uid }) => {
        const yScale = scaleLinear({ domain: [lo - pad, hi + pad], range: [innerH, 0] });
        const y = (v: number) => yScale(v);
        const showIdx = active != null && values[active] != null ? active : lastIdx;
        // The guide's label goes at whichever end the line is farthest from
        // the guide, on the opposite side of the guide from the line.
        const firstV = known[0], lastV = values[lastIdx]!;
        const atEnd = guide ? Math.abs(lastV - guide.value) >= Math.abs(firstV - guide.value) : true;
        const lineAbove = guide ? (atEnd ? lastV : firstV) >= guide.value : true;
        const guideAt = { x: atEnd ? x(values.length - 1) : 2, anchor: (atEnd ? "end" : "start") as "end" | "start", dy: lineAbove ? 16 : -7 };
        return (
          <>
            <defs>
              <linearGradient id={`tc-fill-${uid}`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" style={{ stopColor: color, stopOpacity: 0.34 }} />
                <stop offset="100%" style={{ stopColor: color, stopOpacity: 0 }} />
              </linearGradient>
            </defs>
            {guide && (
              <>
                <Line from={{ x: 0, y: y(guide.value) }} to={{ x: x(values.length - 1), y: y(guide.value) }}
                  style={{ stroke: color }} strokeOpacity={0.45} strokeWidth={1.2} strokeDasharray="3 5" />
                <text x={guideAt.x} y={y(guide.value) + guideAt.dy} textAnchor={guideAt.anchor}
                  style={{ fill: T.text2, fontFamily: F.sans, fontSize: 12, fontWeight: 600 }}>{guide.label}</text>
              </>
            )}
            <AreaClosed data={pts} x={d => x(d.i)} y={d => y(d.v ?? lo)} yScale={yScale} defined={defined}
              curve={curveMonotoneX} fill={`url(#tc-fill-${uid})`} className="hn-fade" />
            {/* Glow: the same line, wider and faint, underneath. */}
            <LinePath data={pts} x={d => x(d.i)} y={d => y(d.v ?? lo)} defined={defined} curve={curveMonotoneX}
              style={{ stroke: color }} strokeOpacity={0.22} strokeWidth={9} strokeLinecap="round" strokeLinejoin="round" fill="none" />
            <LinePath data={pts} x={d => x(d.i)} y={d => y(d.v ?? lo)} defined={defined} curve={curveMonotoneX}
              style={{ stroke: color }} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" fill="none"
              pathLength={1} strokeDasharray="1" className="hn-draw" />
            {values.map((v, i) => v == null ? null : (
              <circle key={i} cx={x(i)} cy={y(v)} r={i === showIdx ? 5.5 : 2.6}
                style={{ fill: i === showIdx ? color : T.surface, stroke: color, transition: "r .2s" }} strokeWidth={i === showIdx ? 3 : 1.6}
                strokeOpacity={1} />
            ))}
            {showIdx != null && values[showIdx] != null && (
              <circle cx={x(showIdx)} cy={y(values[showIdx]!)} r={11} style={{ fill: color }} fillOpacity={0.18} pointerEvents="none" />
            )}
            {/* Light dot centre on the highlighted point */}
            {showIdx != null && values[showIdx] != null && (
              <circle cx={x(showIdx)} cy={y(values[showIdx]!)} r={2} style={{ fill: T.surface }} pointerEvents="none" />
            )}
          </>
        );
      }}
    </ChartFrame>
  );
}
