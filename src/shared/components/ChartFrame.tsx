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
  x: (i: number) => number;          // point i to pixels
  xv: (v: number) => number;         // a value on the x axis to pixels
  active: number | null;             // the point under the finger
  uid: string;                       // unique id for gradients
};

type Margin = { top: number; right: number; bottom: number; left: number };
const MARGIN: Margin = { top: 12, right: 14, bottom: 26, left: 6 };
const COMPACT: Margin = { top: 6, right: 8, bottom: 6, left: 4 };

export function ChartFrame(props: {
  count: number;                                  // number of points
  xs?: number[];                                  // each point's x value (default: its index)
  domain?: [number, number];                      // x range (default: first to last point)
  height: number;
  ariaLabel: string;                              // the chart's point in words
  labels?: (i: number) => string;                 // a short label under each point ("T")
  ticks?: { value: number; label: string }[];     // or labels at x values ("Noon")
  compact?: boolean;                              // small inline chart, no axis labels
  strong?: number;                                // label shown bold at rest (default: the last)
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
    <div ref={box} role="img" aria-label={props.ariaLabel} onClick={e => e.stopPropagation()} onContextMenu={e => e.preventDefault()}
      // Press-and-hold reads the chart: no text selection, magnifier or callout.
      style={{ position: "relative", width: "100%", height: props.height, userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none" } as React.CSSProperties}>
      {width > 0 && <Inner {...props} width={width} uid={uid} />}
    </div>
  );
}

function Inner({ width, height, count, xs, domain, labels, ticks, compact, strong, tooltip, uid, children }: {
  width: number; height: number; count: number; uid: string; xs?: number[]; domain?: [number, number];
  labels?: (i: number) => string; ticks?: { value: number; label: string }[]; compact?: boolean; strong?: number;
  tooltip?: (i: number) => React.ReactNode;
  children: (ctx: ChartCtx) => React.ReactNode;
}) {
  const m = compact ? COMPACT : MARGIN;
  const innerW = Math.max(0, width - m.left - m.right);
  const innerH = Math.max(0, height - m.top - m.bottom);
  const pos = (i: number) => (xs ? xs[i] : i);
  const dom: [number, number] = domain ?? [pos(0), Math.max(pos(0) + 1, pos(count - 1))];
  const xScale = scaleLinear({ domain: dom, range: [0, innerW] });
  const xv = (v: number) => xScale(v);
  const x = (i: number) => xScale(pos(i));
  const { tooltipOpen, tooltipLeft, tooltipData, showTooltip, hideTooltip } = useTooltip<number>();
  const last = useRef<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Finger (or mouse) position → the nearest point. Pointer events cover both.
  const scrub = useCallback((clientX: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || !tooltip || !count) return;
    const px = clientX - rect.left - m.left;
    let idx = 0, best = Infinity;
    for (let i = 0; i < count; i++) {
      const d = Math.abs(x(i) - px);
      if (d < best) { best = d; idx = i; }
    }
    if (idx !== last.current) { last.current = idx; haptic("select"); }
    showTooltip({ tooltipData: idx, tooltipLeft: m.left + x(idx), tooltipTop: 0 });
  }, [count, tooltip, xScale, showTooltip, m.left]); // eslint-disable-line react-hooks/exhaustive-deps

  const end = () => { last.current = null; hideTooltip(); };
  const active = tooltipOpen && tooltipData != null ? tooltipData : null;
  const label = (key: React.Key, at: number, text: string, strong: boolean) => (
    <text key={key} x={at} y={innerH + 18} textAnchor="middle"
      style={{ fill: strong ? T.text : T.text2, fontFamily: F.sans, fontSize: 12, fontWeight: strong ? 700 : 500 }}>{text}</text>
  );

  return (
    <>
      <svg ref={svgRef} width={width} height={height} style={{ display: "block", overflow: "visible", touchAction: "pan-y" }}
        onPointerDown={e => { (e.target as Element).setPointerCapture?.(e.pointerId); scrub(e.clientX); }}
        onPointerMove={e => { if (e.pointerType === "mouse" || e.buttons) scrub(e.clientX); }}
        onPointerUp={end} onPointerCancel={end} onPointerLeave={e => { if (e.pointerType === "mouse") end(); }}>
        <Group left={m.left} top={m.top}>
          {children({ width, height, innerW, innerH, x, xv, active, uid })}
          {active != null && (
            <Line from={{ x: x(active), y: compact ? 0 : -6 }} to={{ x: x(active), y: innerH }}
              style={{ stroke: T.text }} strokeOpacity={0.35} strokeWidth={1} strokeDasharray="2 3" pointerEvents="none" />
          )}
          {!compact && labels && Array.from({ length: count }, (_, i) => label(i, x(i), labels(i), i === active || (active == null && i === (strong ?? count - 1))))}
          {!compact && ticks?.map(t => label(t.label, xv(t.value), t.label, false))}
        </Group>
      </svg>
      {tooltip && active != null && (
        <TooltipWithBounds key={active} left={tooltipLeft} top={compact ? -34 : -8} offsetLeft={12} offsetTop={0}
          style={{
            ...defaultStyles, background: T.frost, color: T.text, border: `1px solid ${T.glass}`,
            backdropFilter: "blur(16px) saturate(170%)", WebkitBackdropFilter: "blur(16px) saturate(170%)",
            boxShadow: SHADOWS.md, borderRadius: 12, padding: "6px 10px", fontFamily: F.sans, fontSize: 13, pointerEvents: "none", whiteSpace: "nowrap",
          }}>
          {tooltip(active)}
        </TooltipWithBounds>
      )}
    </>
  );
}

// Tooltip body: a quiet title and the value in bold.
export function TipText({ title, value }: { title: string; value?: React.ReactNode }) {
  return <span><span style={{ color: T.text2 }}>{title}</span>{value != null && <> · <strong>{value}</strong></>}</span>;
}

// ─── TrendChart: a smooth line with a soft fill ────────────────────
// For a handful of days or nights (sleep, readiness, steps). Missing days
// leave a gap rather than a made-up value. The glow is a wider, faint
// stroke under the line (no blur filter, so it stays smooth on phones).
// `compact` is the small inline version for metric rows.
export function TrendChart({ values, color, height = 132, guide, labels, format, ariaLabel, detailLabel, compact }: {
  values: (number | null)[];
  color: string;                                   // an ATMOS chart color
  height?: number;
  guide?: { value: number; label: string };        // e.g. 7 hours
  labels?: (i: number) => string;                  // x labels ("M", "T", ...)
  detailLabel: (i: number) => string;              // tooltip title ("Tue, Oct 20")
  format: (v: number) => string;                   // tooltip value ("7.4 hours")
  ariaLabel: string;
  compact?: boolean;
}) {
  const known = values.filter((v): v is number => v != null);
  if (known.length < 2) return compact ? <div style={{ height }} /> : null;
  const all = guide ? [...known, guide.value] : known;
  const lo = Math.min(...all), hi = Math.max(...all);
  const pad = (hi - lo || 1) * (compact ? 0.12 : 0.25);
  const pts = values.map((v, i) => ({ i, v }));
  const defined = (d: { v: number | null }) => d.v != null;
  const lastIdx = values.reduce<number>((acc, v, i) => (v != null ? i : acc), -1);

  return (
    <ChartFrame count={values.length} height={height} ariaLabel={ariaLabel} labels={labels} compact={compact}
      tooltip={i => <TipText title={detailLabel(i)} value={values[i] == null ? "no data" : format(values[i]!)} />}>
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
                <stop offset="0%" style={{ stopColor: color, stopOpacity: compact ? 0.26 : 0.34 }} />
                <stop offset="100%" style={{ stopColor: color, stopOpacity: 0 }} />
              </linearGradient>
            </defs>
            {guide && (
              <>
                <Line from={{ x: 0, y: y(guide.value) }} to={{ x: x(values.length - 1), y: y(guide.value) }}
                  style={{ stroke: color }} strokeOpacity={0.45} strokeWidth={1.2} strokeDasharray="3 5" />
                {!compact && (
                  <text x={guideAt.x} y={y(guide.value) + guideAt.dy} textAnchor={guideAt.anchor}
                    style={{ fill: T.text2, fontFamily: F.sans, fontSize: 12, fontWeight: 600 }}>{guide.label}</text>
                )}
              </>
            )}
            <AreaClosed data={pts} x={d => x(d.i)} y={d => y(d.v ?? lo)} yScale={yScale} defined={defined}
              curve={curveMonotoneX} fill={`url(#tc-fill-${uid})`} className="hn-fade" />
            {/* Glow: the same line, wider and faint, underneath. */}
            <LinePath data={pts} x={d => x(d.i)} y={d => y(d.v ?? lo)} defined={defined} curve={curveMonotoneX}
              style={{ stroke: color }} strokeOpacity={0.22} strokeWidth={compact ? 6 : 9} strokeLinecap="round" strokeLinejoin="round" fill="none" />
            <LinePath data={pts} x={d => x(d.i)} y={d => y(d.v ?? lo)} defined={defined} curve={curveMonotoneX}
              style={{ stroke: color }} strokeWidth={compact ? 2 : 2.6} strokeLinecap="round" strokeLinejoin="round" fill="none"
              pathLength={1} strokeDasharray="1" className="hn-draw" />
            {!compact && values.map((v, i) => v == null || i === showIdx ? null : (
              <circle key={i} cx={x(i)} cy={y(v)} r={2.6} style={{ fill: T.surface, stroke: color }} strokeWidth={1.6} />
            ))}
            {showIdx >= 0 && values[showIdx] != null && (
              <g pointerEvents="none">
                <circle cx={x(showIdx)} cy={y(values[showIdx]!)} r={compact ? 7 : 11} style={{ fill: color }} fillOpacity={0.18} />
                <circle cx={x(showIdx)} cy={y(values[showIdx]!)} r={compact ? 3.6 : 5.5} style={{ fill: color, stroke: T.surface }} strokeWidth={compact ? 1.6 : 2} />
              </g>
            )}
          </>
        );
      }}
    </ChartFrame>
  );
}

// ─── TimelineChart: the day from 6 AM to 10 PM ─────────────────────
// A track with a dot for each timed event and a "now" line. Events already
// over are hollow; the next one glows. Scrub to read each event.
export function TimelineChart({ events, now = new Date(), color, height = 64, ariaLabel }: {
  events: { hour: number; label: string; time: string }[];   // hour as 16.5 for 4:30 PM
  now?: Date;
  color: string;
  height?: number;
  ariaLabel: string;
}) {
  const START = 6, END = 22;
  const clamp = (h: number) => Math.min(END, Math.max(START, h));
  const list = [...events].sort((a, b) => a.hour - b.hour);
  const nowH = now.getHours() + now.getMinutes() / 60;
  const nextIdx = list.findIndex(e => e.hour >= nowH);
  return (
    <ChartFrame count={list.length} xs={list.map(e => clamp(e.hour))} domain={[START, END]} height={height} ariaLabel={ariaLabel}
      ticks={[{ value: 6, label: "6 AM" }, { value: 12, label: "Noon" }, { value: 18, label: "6 PM" }, { value: 22, label: "10 PM" }]}
      tooltip={i => <TipText title={list[i].time} value={list[i].label} />}>
      {({ innerH, innerW, x, xv, active }) => {
        const cy = innerH / 2;
        const nowX = xv(clamp(nowH));
        const inDay = nowH >= START && nowH <= END;
        return (
          <>
            <rect x={0} y={cy - 2} width={innerW} height={4} rx={2} style={{ fill: color }} fillOpacity={0.16} />
            {inDay && <rect x={0} y={cy - 2} width={nowX} height={4} rx={2} style={{ fill: color }} fillOpacity={0.45} className="hn-fade" />}
            {list.map((e, i) => {
              const past = e.hour < nowH;
              const next = i === nextIdx;
              const on = i === active;
              return (
                <g key={i} className="hn-fade" style={{ animationDelay: `${i * 70}ms` }}>
                  {(next || on) && <circle cx={x(i)} cy={cy} r={12} style={{ fill: color }} fillOpacity={0.2} />}
                  <circle cx={x(i)} cy={cy} r={on || next ? 6.5 : 5}
                    style={{ fill: past && !on ? T.surface : color, stroke: past && !on ? color : T.surface }} strokeWidth={2} />
                </g>
              );
            })}
            {inDay && (
              <g pointerEvents="none">
                <line x1={nowX} x2={nowX} y1={cy - 13} y2={cy + 13} style={{ stroke: T.text }} strokeWidth={2} strokeLinecap="round" />
              </g>
            )}
          </>
        );
      }}
    </ChartFrame>
  );
}

// ─── BarsChart: one rounded bar per day ────────────────────────────
// Bars rise from the baseline (transform only); empty days keep a short
// stub so the week still reads. Scrub to read each day.
export function BarsChart({ values, labels, color, highlight, height = 96, tooltip, ariaLabel }: {
  values: number[];
  labels: (i: number) => string;
  color: string;
  highlight?: number;                         // drawn in full color
  height?: number;
  tooltip: (i: number) => React.ReactNode;
  ariaLabel: string;
}) {
  const n = values.length;
  const max = Math.max(...values, 1);
  return (
    <ChartFrame count={n} domain={[-0.5, n - 0.5]} height={height} ariaLabel={ariaLabel} labels={labels} tooltip={tooltip} strong={highlight ?? -1}>
      {({ innerH, innerW, x, active, uid }) => {
        const bw = Math.min(30, (innerW / n) * 0.62);
        return (
          <>
            <defs>
              <linearGradient id={`bc-fill-${uid}`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" style={{ stopColor: color, stopOpacity: 0.95 }} />
                <stop offset="100%" style={{ stopColor: color, stopOpacity: 0.45 }} />
              </linearGradient>
            </defs>
            {values.map((v, i) => {
              const h = v > 0 ? Math.max(10, (v / max) * innerH) : 4;
              const strong = i === active || (active == null && i === highlight);
              return (
                <g key={i}>
                  {strong && v > 0 && <rect x={x(i) - bw / 2 - 4} y={innerH - h - 4} width={bw + 8} height={h + 4} rx={(bw + 8) / 3} style={{ fill: color }} fillOpacity={0.16} />}
                  <rect x={x(i) - bw / 2} y={innerH - h} width={bw} height={h} rx={v > 0 ? Math.min(bw / 2.6, 9) : 2}
                    className="hn-grow-svg" style={{ fill: v > 0 ? `url(#bc-fill-${uid})` : color, animationDelay: `${i * 45}ms` }}
                    fillOpacity={v > 0 ? (strong || highlight == null ? 1 : 0.55) : 0.2} />
                </g>
              );
            })}
          </>
        );
      }}
    </ChartFrame>
  );
}
