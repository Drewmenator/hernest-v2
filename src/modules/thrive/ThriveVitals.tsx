// ─── Thrive vitals dashboard ───────────────────────────────────────
// Body-intelligence view built entirely from wearable data (Oura primary).
// No manual logging — readiness, sleep, recovery, stress, activity, and
// 7-day trends. What a ring can't sense (mood) lives in the check-in hero;
// water was removed by design (no wearable tracks it).
import React from "react";
import { T, F } from "../../config/theme";
import type { WearableDay, WearableDayPoint } from "../../core/wellnessAutoTrack";

function band(score: number | null): { color: string; word: string } {
  if (score == null) return { color: T.taupe, word: "—" };
  if (score >= 85) return { color: T.sage, word: "Optimal" };
  if (score >= 70) return { color: "#8B9E4C", word: "Good" };
  if (score >= 60) return { color: T.goldText, word: "Fair" };
  return { color: T.blush, word: "Take it easy" };
}

// Tiny inline SVG trend. Nulls are skipped; a flat line renders for 1 point.
function Sparkline({ points, color }: { points: (number | null)[]; color: string }) {
  const vals = points.map((v, i) => [i, v] as const).filter(([, v]) => v != null) as [number, number][];
  if (vals.length < 2) return <div style={{ height: 22 }} />;
  const xs = vals.map(([i]) => i), ys = vals.map(([, v]) => v);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const w = 100, h = 22, pad = 2;
  const nx = (x: number) => pad + ((x - minX) / (maxX - minX || 1)) * (w - pad * 2);
  const ny = (y: number) => h - pad - ((y - minY) / (maxY - minY || 1)) * (h - pad * 2);
  const d = vals.map(([x, y], i) => `${i ? "L" : "M"}${nx(x).toFixed(1)},${ny(y).toFixed(1)}`).join(" ");
  const lastX = nx(xs[xs.length - 1]), lastY = ny(ys[ys.length - 1]);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={22} preserveAspectRatio="none" aria-hidden="true">
      <path d={d} fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lastX} cy={lastY} r={2} fill={color} />
    </svg>
  );
}

function Tile({ label, value, sub, color = T.esp }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{ flex: 1, background: T.ivory, border: `1px solid ${T.linen}`, borderRadius: 14, padding: "12px 10px", textAlign: "center" }}>
      <p style={{ fontFamily: F.serif, fontSize: 20, fontWeight: 700, color, margin: 0, lineHeight: 1 }}>{value}</p>
      <p style={{ fontFamily: F.sans, fontSize: 8.5, color: T.taupe, margin: "5px 0 0", textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</p>
      {sub && <p style={{ fontFamily: F.sans, fontSize: 9, color: T.taupe, margin: "1px 0 0" }}>{sub}</p>}
    </div>
  );
}

const capitalize = (s: string | null) => (s ? s[0].toUpperCase() + s.slice(1) : "—");

export function ThriveVitals({ w, expanded, onToggle }: { w: WearableDay; expanded: boolean; onToggle: () => void }) {
  const r = band(w.readiness);
  const hist: WearableDayPoint[] = (w.history || []).slice(-7);
  const trend = (key: keyof WearableDayPoint) => hist.map(p => p[key] as number | null);
  const stepsStr = w.steps != null ? (w.steps >= 1000 ? `${(w.steps / 1000).toFixed(1)}k` : String(w.steps)) : "—";

  return (
    <>
      {/* Readiness hero */}
      <button onClick={onToggle} aria-label="Readiness detail" style={{ width: "100%", textAlign: "left", background: `linear-gradient(135deg,${r.color}14,${T.ivory})`, border: `1.5px solid ${r.color}40`, borderRadius: 20, padding: "18px 20px", marginBottom: 10, cursor: "pointer", display: "flex", alignItems: "center", gap: 16, touchAction: "manipulation" }}>
        <div style={{ width: 68, height: 68, borderRadius: "50%", border: `5px solid ${r.color}`, borderBottomColor: `${r.color}30`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <span style={{ fontFamily: F.serif, fontSize: 26, fontWeight: 700, color: T.esp }}>{w.readiness ?? "—"}</span>
        </div>
        <div style={{ flex: 1 }}>
          <p style={{ fontFamily: F.sans, fontSize: 9, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: T.taupe, margin: "0 0 3px" }}>Readiness today</p>
          <p style={{ fontFamily: F.serif, fontSize: 21, fontStyle: "italic", color: r.color, margin: "0 0 2px" }}>{r.word}</p>
          <p style={{ fontFamily: F.sans, fontSize: 11, color: T.taupe, margin: 0 }}>Tap for what's driving it {expanded ? "▲" : "▾"}</p>
        </div>
      </button>

      {/* Contributors (expanded) */}
      {expanded && (
        <div style={{ background: T.ivory, border: `1px solid ${T.linen}`, borderRadius: 16, padding: "14px 16px", marginBottom: 10 }}>
          {w.avgHrv != null && <Row label="Average HRV" value={`${w.avgHrv} ms`} />}
          {w.restingHr != null && <Row label="Resting heart rate" value={`${w.restingHr} bpm`} />}
          {w.stressHighMins != null && <Row label="Stress vs recovery (yesterday)" value={`${(w.stressHighMins / 60).toFixed(1)}h / ${((w.recoveryHighMins || 0) / 60).toFixed(1)}h`} />}
          {w.readinessContributors && Object.entries(w.readinessContributors).filter(([, v]) => typeof v === "number").slice(0, 5).map(([k, v]) => (
            <Row key={k} label={k.replace(/_/g, " ")} value={String(v)} valueColor={(v as number) >= 80 ? T.sage : (v as number) >= 60 ? T.goldText : T.blush} />
          ))}
          <p style={{ fontFamily: F.sans, fontSize: 10, color: T.taupe, margin: "8px 0 0", fontStyle: "italic" }}>From your {w.source === "oura" ? "Oura ring" : "wearable"} · updates each morning</p>
        </div>
      )}

      {/* Vitals grid */}
      <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
        <Tile label="Sleep" value={w.sleepHours != null ? `${w.sleepHours}h` : "—"} sub={w.sleepScore != null ? `score ${w.sleepScore}` : undefined} />
        <Tile label="Stress" value={capitalize(w.stressDay)} color={w.stressDay === "restored" ? T.sage : w.stressDay === "stressful" ? T.blush : T.esp} />
        <Tile label="Steps" value={stepsStr} sub={w.sedentaryMins != null ? `${Math.round(w.sedentaryMins / 60)}h sitting` : undefined} />
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        <Tile label="HRV" value={w.avgHrv != null ? `${w.avgHrv}` : "—"} sub="ms" />
        <Tile label="Resting HR" value={w.restingHr != null ? `${w.restingHr}` : "—"} sub="bpm" />
        <Tile label="Activity" value={w.activityScore != null ? `${w.activityScore}` : "—"} sub={w.activeCalories != null ? `${w.activeCalories} cal` : undefined} />
      </div>

      {/* 7-day trends */}
      {hist.length >= 2 && (
        <div style={{ background: T.ivory, border: `1px solid ${T.linen}`, borderRadius: 16, padding: "14px 16px", marginBottom: 12 }}>
          <p style={{ fontFamily: F.sans, fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: T.taupe, margin: "0 0 12px" }}>Last 7 days</p>
          <TrendRow label="Sleep" points={trend("sleepHours")} color={T.navy} last={w.sleepHours != null ? `${w.sleepHours}h` : "—"} />
          <TrendRow label="Readiness" points={trend("readiness")} color={T.sage} last={w.readiness != null ? String(w.readiness) : "—"} />
          <TrendRow label="HRV" points={trend("hrv")} color={T.goldText} last={w.avgHrv != null ? `${w.avgHrv}ms` : "—"} />
        </div>
      )}
    </>
  );
}

function Row({ label, value, valueColor = T.esp }: { label: string; value: string; valueColor?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: `1px solid ${T.linen}` }}>
      <span style={{ fontFamily: F.sans, fontSize: 12, color: T.taupe, textTransform: "capitalize" }}>{label}</span>
      <span style={{ fontFamily: F.serif, fontSize: 14, fontWeight: 700, color: valueColor }}>{value}</span>
    </div>
  );
}

function TrendRow({ label, points, color, last }: { label: string; points: (number | null)[]; color: string; last: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
      <span style={{ fontFamily: F.sans, fontSize: 11, color: T.esp, width: 66, flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1 }}><Sparkline points={points} color={color} /></div>
      <span style={{ fontFamily: F.serif, fontSize: 14, fontWeight: 700, color: T.esp, width: 44, textAlign: "right", flexShrink: 0 }}>{last}</span>
    </div>
  );
}
