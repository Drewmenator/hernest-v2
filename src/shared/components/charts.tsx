// ─── ProgressRing ──────────────────────────────────────────────────
// The ring used for goals and readiness (Plan, Move this week, Oura,
// Trips). Line, bar and timeline charts live in ChartFrame.tsx.
import { useEffect, useId, useState } from "react";

export function ProgressRing({ value, size = 72, stroke = 7, color, track, children }: {
  value: number;               // 0..1
  size?: number;
  stroke?: number;
  color: string;
  track: string;
  children?: React.ReactNode;
}) {
  // Wisteria Luxe ring: a gradient arc with a faint glow under it, drawn in
  // from empty on first show (stroke-dashoffset), instant with Reduce Motion.
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.min(1, Math.max(0, value));
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setShown(v));
    return () => cancelAnimationFrame(raf);
  }, [v]);
  const arc = { cx: size / 2, cy: size / 2, r, fill: "none", strokeLinecap: "round" as const, strokeDasharray: c, strokeDashoffset: c * (1 - shown) };
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg aria-hidden="true" width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)", display: "block", overflow: "visible" }}>
        <defs>
          <linearGradient id={`pr-${id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" style={{ stopColor: color, stopOpacity: 0.55 }} />
            <stop offset="100%" style={{ stopColor: color, stopOpacity: 1 }} />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" style={{ stroke: track }} strokeWidth={stroke} />
        {v > 0 && <>
          {/* Glow: a wider, faint arc underneath (no blur filter). */}
          <circle {...arc} style={{ stroke: color, transition: "stroke-dashoffset .9s cubic-bezier(.2,.8,.2,1)" }} strokeOpacity={0.2} strokeWidth={stroke + 6} />
          <circle {...arc} style={{ stroke: `url(#pr-${id})`, transition: "stroke-dashoffset .9s cubic-bezier(.2,.8,.2,1)" }} strokeWidth={stroke} />
        </>}
      </svg>
      {children && <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center" }}>{children}</div>}
    </div>
  );
}
