// ─── Small charts ──────────────────────────────────────────────────
// Lightweight pictures for the hero cards: a day timeline, mini bars, a
// 7-day line and a progress ring. Plain SVG and CSS, no chart library.
// They are decoration for numbers already written out in words, so they
// are hidden from screen readers.
import { F, T, alpha } from "../../config/theme";

const label: React.CSSProperties = { fontFamily: F.sans, fontSize: 12, fontWeight: 600, fontVariantNumeric: "tabular-nums" };

// ── DayTimeline ────────────────────────────────────────────────────
// 6 AM to 10 PM, a dot for each timed event and a line for "now".
export function DayTimeline({ times, now = new Date(), color, soft, textColor = T.text2 }: {
  times: string[];             // "HH:MM" (24h)
  now?: Date;
  color: string;
  soft: string;
  textColor?: string;
}) {
  const START = 6, END = 22;
  const pos = (h: number) => Math.min(100, Math.max(0, ((h - START) / (END - START)) * 100));
  const hours = times
    .map(t => /^(\d{1,2}):(\d{2})/.exec(t))
    .filter((m): m is RegExpExecArray => !!m)
    .map(m => Number(m[1]) + Number(m[2]) / 60);
  const nowH = now.getHours() + now.getMinutes() / 60;
  return (
    <div aria-hidden="true">
      <div style={{ position: "relative", height: 26 }}>
        <div style={{ position: "absolute", left: 0, right: 0, top: 12, height: 3, borderRadius: 2, background: soft }} />
        <div className="hn-fade" style={{ position: "absolute", left: 0, top: 12, height: 3, width: `${pos(nowH)}%`, borderRadius: 2, background: color, opacity: 0.35 }} />
        {hours.map((h, i) => {
          const past = h < nowH;
          return (
            <span key={i} className="hn-fade" style={{
              position: "absolute", left: `${pos(h)}%`, top: 7, width: 13, height: 13, marginLeft: -6.5, borderRadius: "50%",
              background: past ? soft : color, border: `2px solid ${past ? color : T.onAction}`,
              boxShadow: past ? "none" : `0 2px 6px ${soft}`, animationDelay: `${i * 70}ms`,
            }} />
          );
        })}
        {nowH >= START && nowH <= END && (
          <span style={{ position: "absolute", left: `${pos(nowH)}%`, top: 2, bottom: 2, width: 2, marginLeft: -1, borderRadius: 1, background: T.text }} />
        )}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, color: textColor, ...label }}>
        <span>6 AM</span><span>Noon</span><span>6 PM</span><span>10 PM</span>
      </div>
    </div>
  );
}

// ── MiniBars ───────────────────────────────────────────────────────
// One bar per day. Empty days get a small stub so the week still reads.
export function MiniBars({ values, labels, color, soft, highlight, textColor = T.text2, height = 56 }: {
  values: number[];
  labels: string[];
  color: string;
  soft: string;
  highlight?: number;          // index drawn in full color
  textColor?: string;
  height?: number;
}) {
  const max = Math.max(...values, 1);
  return (
    <div aria-hidden="true">
      <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height }}>
        {values.map((v, i) => (
          <div key={i} style={{ flex: 1, height: "100%", display: "flex", alignItems: "flex-end" }}>
            <div className="hn-grow" style={{
              width: "100%", height: v > 0 ? `${Math.max(14, (v / max) * 100)}%` : 4, borderRadius: v > 0 ? 7 : 2,
              background: v > 0 ? (i === highlight ? color : `linear-gradient(180deg, ${color} 0%, ${soft} 140%)`) : soft,
              opacity: v > 0 && i !== highlight && highlight != null ? 0.75 : 1,
              animationDelay: `${i * 45}ms`,
            }} />
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
        {labels.map((l, i) => (
          <span key={i} style={{ flex: 1, textAlign: "center", color: textColor, fontWeight: i === highlight ? 800 : 600, ...label }}>{l}</span>
        ))}
      </div>
    </div>
  );
}

// ── SparkArea ──────────────────────────────────────────────────────
// A smooth 7-day line with a soft fill, an optional guide (say, 7 hours of
// sleep) and a dot on the latest day. Missing days are skipped.
export function SparkArea({ points, color, guide, height = 64, id }: {
  points: (number | null)[];
  color: string;
  guide?: number;
  height?: number;
  id: string;                  // unique per page, for the gradient
}) {
  const vals = points.map((v, i) => [i, v] as const).filter(([, v]) => v != null) as [number, number][];
  if (vals.length < 2) return <div style={{ height }} />;
  const ys = vals.map(([, v]) => v).concat(guide != null ? [guide] : []);
  const lo = Math.min(...ys), hi = Math.max(...ys);
  const span = hi - lo || 1;
  const W = 100, H = 100, padY = 12;
  const n = Math.max(points.length - 1, 1);
  const x = (i: number) => (i / n) * W;
  const y = (v: number) => H - padY - ((v - lo) / span) * (H - padY * 2);
  // Gentle curve through the points (cardinal spline, tension 0.5).
  const pts = vals.map(([i, v]) => [x(i), y(v)] as const);
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let k = 0; k < pts.length - 1; k++) {
    const p0 = pts[k - 1] || pts[k], p1 = pts[k], p2 = pts[k + 1], p3 = pts[k + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(2)},${c1[1].toFixed(2)} ${c2[0].toFixed(2)},${c2[1].toFixed(2)} ${p2[0].toFixed(2)},${p2[1].toFixed(2)}`;
  }
  const area = `${d} L${pts[pts.length - 1][0]},${H} L${pts[0][0]},${H} Z`;
  const last = pts[pts.length - 1];
  const gid = `sa-${id.replace(/[^\w-]/g, "_")}`;
  return (
    <div aria-hidden="true" className="hn-fade" style={{ position: "relative", height }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={height} preserveAspectRatio="none" style={{ display: "block", overflow: "visible" }}>
        <defs>
          <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.32} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        {guide != null && (
          <line x1={0} x2={W} y1={y(guide)} y2={y(guide)} stroke={color} strokeOpacity={0.45} strokeWidth={1.2} strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
        )}
        <path d={area} fill={`url(#${gid})`} />
        <path d={d} fill="none" stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      {/* The dot sits outside the stretched SVG so it stays round. */}
      <span style={{ position: "absolute", left: `${last[0]}%`, top: `${last[1]}%`, width: 10, height: 10, margin: "-5px 0 0 -5px", borderRadius: "50%", background: color, border: `2px solid ${T.surface}`, boxShadow: `0 0 0 4px ${alpha(color, 0.2)}` }} />
    </div>
  );
}

// ── ProgressRing ───────────────────────────────────────────────────
export function ProgressRing({ value, size = 72, stroke = 7, color, track, children }: {
  value: number;               // 0..1
  size?: number;
  stroke?: number;
  color: string;
  track: string;
  children?: React.ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.min(1, Math.max(0, value));
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg aria-hidden="true" width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)", display: "block" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - v)} style={{ transition: "stroke-dashoffset .8s cubic-bezier(.2,.8,.2,1)" }} />
      </svg>
      {children && <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center" }}>{children}</div>}
    </div>
  );
}
