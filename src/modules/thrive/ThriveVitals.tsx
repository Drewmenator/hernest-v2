// ─── Thrive vitals dashboard ───────────────────────────────────────
// Body view built entirely from wearable data, for Oura and Apple Health.
// No manual logging. Oura leads with readiness; Apple Health has no readiness
// score, so it leads with last night's sleep and compares heart data with her
// own usual. Tiles and trends with no data are left out, never filled in.
import React from "react";
import { T, F } from "../../config/theme";
import { vsUsual, type WearableDay, type WearableDayPoint } from "../../core/wellnessAutoTrack";

// Apple Health: last night's sleep in plain words.
function sleepBand(hours: number | null): { color: string; word: string } {
  if (hours == null) return { color: T.taupe, word: "No sleep data yet" };
  if (hours >= 7) return { color: T.sage, word: "Well rested" };
  if (hours >= 6) return { color: T.goldText, word: "A bit short" };
  return { color: T.blush, word: "Short night" };
}

const usualText = (v: ReturnType<typeof vsUsual>) => (v ? (v.word === "about" ? "about your usual" : `${v.word} your usual`) : undefined);

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
  const hasReadiness = w.readiness != null;
  const r = hasReadiness ? band(w.readiness) : sleepBand(w.sleepHours);
  const hist: WearableDayPoint[] = (w.history || []).slice(-7);
  const trend = (key: keyof WearableDayPoint) => hist.map(p => p[key] as number | null);
  const enough = (key: keyof WearableDayPoint) => trend(key).filter(v => v != null).length >= 2;
  const stepsStr = w.steps != null ? (w.steps >= 1000 ? `${(w.steps / 1000).toFixed(1)}k` : String(w.steps)) : "—";
  const hrvUsual = vsUsual(w.avgHrv, w.history, "hrv", w.date);
  const rhrUsual = vsUsual(w.restingHr, w.history, "restingHr", w.date);
  const sourceName = w.source === "oura" ? "Oura ring" : "Apple Health";

  // Oura: the full set (as before). Apple Health: only what it measured.
  const tiles: { label: string; value: string; sub?: string; color?: string; has: boolean }[] = [
    { label: "Sleep", value: w.sleepHours != null ? `${w.sleepHours}h` : "—", sub: w.sleepScore != null ? `score ${w.sleepScore}` : undefined, has: w.sleepHours != null },
    { label: "Stress", value: capitalize(w.stressDay), color: w.stressDay === "restored" ? T.sage : w.stressDay === "stressful" ? T.blush : T.esp, has: w.stressDay != null },
    { label: "Steps", value: stepsStr, sub: w.sedentaryMins != null ? `${Math.round(w.sedentaryMins / 60)}h sitting` : undefined, has: w.steps != null },
    { label: "HRV", value: w.avgHrv != null ? `${w.avgHrv}` : "—", sub: hasReadiness ? "ms" : usualText(hrvUsual) ?? "ms", has: w.avgHrv != null },
    { label: "Resting HR", value: w.restingHr != null ? `${w.restingHr}` : "—", sub: hasReadiness ? "bpm" : usualText(rhrUsual) ?? "bpm", has: w.restingHr != null },
    w.source === "oura"
      ? { label: "Activity", value: w.activityScore != null ? `${w.activityScore}` : "—", sub: w.activeCalories != null ? `${w.activeCalories} cal` : undefined, has: w.activityScore != null }
      : { label: "Active", value: w.activeMins != null ? `${w.activeMins}` : "—", sub: "min today", has: w.activeMins != null },
    ...(w.source === "apple_health" ? [{ label: "Mindful", value: w.mindfulMins ? `${w.mindfulMins}` : "—", sub: "min today", has: !!w.mindfulMins }] : []),
  ];
  const shown = w.source === "oura" ? tiles.filter(t => t.label !== "Mindful") : tiles.filter(t => t.has);
  const rows = [shown.slice(0, 3), shown.slice(3, 6)].filter(row => row.length);

  return (
    <>
      {/* Hero: readiness (Oura) or last night's sleep (Apple Health) */}
      <button onClick={onToggle} aria-label={hasReadiness ? "Readiness detail" : "Body detail"} style={{ width: "100%", textAlign: "left", background: `linear-gradient(135deg,${r.color}14,${T.ivory})`, border: `1.5px solid ${r.color}40`, borderRadius: 20, padding: "18px 20px", marginBottom: 10, cursor: "pointer", display: "flex", alignItems: "center", gap: 16, touchAction: "manipulation" }}>
        <div style={{ width: 68, height: 68, borderRadius: "50%", border: `5px solid ${r.color}`, borderBottomColor: `${r.color}30`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <span style={{ fontFamily: F.serif, fontSize: hasReadiness ? 26 : 22, fontWeight: 700, color: T.esp }}>
            {hasReadiness ? w.readiness : w.sleepHours != null ? `${w.sleepHours}h` : "—"}
          </span>
        </div>
        <div style={{ flex: 1 }}>
          <p style={{ fontFamily: F.sans, fontSize: 9, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: T.taupe, margin: "0 0 3px" }}>{hasReadiness ? "Readiness today" : "Sleep last night"}</p>
          <p style={{ fontFamily: F.serif, fontSize: 21, fontStyle: "italic", color: r.color, margin: "0 0 2px" }}>{r.word}</p>
          <p style={{ fontFamily: F.sans, fontSize: 11, color: T.taupe, margin: 0 }}>{hasReadiness ? "Tap for what's driving it" : "Tap for your heart data"} {expanded ? "▲" : "▾"}</p>
        </div>
      </button>

      {/* Detail (expanded) */}
      {expanded && (
        <div style={{ background: T.ivory, border: `1px solid ${T.linen}`, borderRadius: 16, padding: "14px 16px", marginBottom: 10 }}>
          {w.avgHrv != null && <Row label="Heart rate variability" value={`${w.avgHrv} ms`} />}
          {hrvUsual && <Row label="Your usual (last week)" value={`${hrvUsual.usual} ms`} />}
          {w.restingHr != null && <Row label="Resting heart rate" value={`${w.restingHr} bpm`} />}
          {rhrUsual && <Row label="Your usual (last week)" value={`${rhrUsual.usual} bpm`} />}
          {w.stressHighMins != null && <Row label="Stress vs recovery (yesterday)" value={`${(w.stressHighMins / 60).toFixed(1)}h / ${((w.recoveryHighMins || 0) / 60).toFixed(1)}h`} />}
          {w.readinessContributors && Object.entries(w.readinessContributors).filter(([, v]) => typeof v === "number").slice(0, 5).map(([k, v]) => (
            <Row key={k} label={k.replace(/_/g, " ")} value={String(v)} valueColor={(v as number) >= 80 ? T.sage : (v as number) >= 60 ? T.goldText : T.blush} />
          ))}
          {w.avgHrv == null && w.restingHr == null && !w.readinessContributors && (
            <p style={{ fontFamily: F.sans, fontSize: 12, color: T.taupe, margin: 0 }}>No heart data yet. An Apple Watch adds it automatically.</p>
          )}
          <p style={{ fontFamily: F.sans, fontSize: 10, color: T.taupe, margin: "8px 0 0", fontStyle: "italic" }}>From your {sourceName} · updates each morning</p>
        </div>
      )}

      {/* Vitals grid */}
      {rows.map((row, i) => (
        <div key={i} style={{ display: "flex", gap: 6, marginBottom: i === rows.length - 1 ? 12 : 6 }}>
          {row.map(t => <Tile key={t.label} label={t.label} value={t.value} sub={t.sub} color={t.color} />)}
        </div>
      ))}

      {/* 7-day trends */}
      {hist.length >= 2 && (
        <div style={{ background: T.ivory, border: `1px solid ${T.linen}`, borderRadius: 16, padding: "14px 16px", marginBottom: 12 }}>
          <p style={{ fontFamily: F.sans, fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: T.taupe, margin: "0 0 12px" }}>Last 7 days</p>
          {enough("sleepHours") && <TrendRow label="Sleep" points={trend("sleepHours")} color={T.navy} last={w.sleepHours != null ? `${w.sleepHours}h` : "—"} />}
          {enough("readiness") && <TrendRow label="Readiness" points={trend("readiness")} color={T.sage} last={w.readiness != null ? String(w.readiness) : "—"} />}
          {enough("hrv") && <TrendRow label="HRV" points={trend("hrv")} color={T.goldText} last={w.avgHrv != null ? `${w.avgHrv}ms` : "—"} />}
          {!hasReadiness && enough("restingHr") && <TrendRow label="Resting HR" points={trend("restingHr")} color={T.blush} last={w.restingHr != null ? `${w.restingHr}` : "—"} />}
          {!hasReadiness && enough("steps") && <TrendRow label="Steps" points={trend("steps")} color={T.sage} last={stepsStr} />}
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
