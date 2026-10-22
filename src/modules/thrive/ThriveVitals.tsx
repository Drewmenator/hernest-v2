// ─── Thrive vitals dashboard ───────────────────────────────────────
// Body view built entirely from wearable data, for Oura and Apple Health.
// No manual logging. Oura leads with readiness; Apple Health has no readiness
// score, so it leads with last night's sleep and compares heart data with her
// own usual. Tiles and trends with no data are left out, never filled in.
import React from "react";
import { T, F, ATMOS, ATMOS_TEXT2, SHADOWS } from "../../config/theme";
import { GlowCard, HeroNumber, Headline, Detail, SparkArea, ProgressRing } from "../../shared/components";
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

function Tile({ label, value, sub, color = T.esp }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{ flex: 1, minWidth: 0, background: "linear-gradient(180deg, rgba(255,255,255,.92), rgba(255,255,255,.72))", border: "1px solid rgba(255,255,255,.95)", borderRadius: 18, padding: "12px 12px 11px", boxShadow: SHADOWS.sm }}>
      <p style={{ fontFamily: F.sans, fontSize: 13, fontWeight: 600, color: T.text2, margin: 0 }}>{label}</p>
      <p style={{ fontFamily: F.sans, letterSpacing: "-0.03em", fontSize: 24, fontWeight: 800, color, margin: "4px 0 0", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{value}</p>
      {sub && <p style={{ fontFamily: F.sans, fontSize: 12, color: T.text2, margin: "4px 0 0", lineHeight: 1.3 }}>{sub}</p>}
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
  const a = ATMOS.personal;
  const heroTrend = trend(hasReadiness ? "readiness" : "sleepHours");
  const sleepUsual = vsUsual(w.sleepHours, w.history, "sleepHours", w.date);
  const sleepVs = sleepUsual
    ? `${sleepUsual.word === "about" ? "About" : sleepUsual.word === "above" ? "More than" : "Less than"} your usual of ${sleepUsual.usual} hours`
    : null;

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
      <GlowCard tint="personal" onClick={onToggle} ariaExpanded={expanded}
        ariaLabel={hasReadiness ? "Readiness detail" : "Body detail"}
        eyebrow={hasReadiness ? "Readiness today" : "Sleep last night"} reveal={false} style={{ marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {hasReadiness ? (
            <ProgressRing value={(w.readiness ?? 0) / 100} size={92} stroke={8} color={a.chart} track={a.chartSoft}>
              <span style={{ fontFamily: F.sans, fontSize: 30, fontWeight: 800, letterSpacing: "-0.04em", color: T.text }}>{w.readiness}</span>
            </ProgressRing>
          ) : (
            <HeroNumber value={w.sleepHours ?? "—"} unit={w.sleepHours != null ? "hours" : undefined} size={56} />
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span aria-hidden="true" style={{ width: 9, height: 9, borderRadius: "50%", background: r.color, flexShrink: 0 }} />
              <Headline size={22}>{r.word}</Headline>
            </div>
            {hasReadiness && w.sleepHours != null && <Detail style={{ marginTop: 4 }}>{w.sleepHours} hours of sleep</Detail>}
            {!hasReadiness && sleepVs && <Detail style={{ marginTop: 4 }}>{sleepVs}</Detail>}
          </div>
        </div>
        {heroTrend.filter(v => v != null).length >= 2 && (
          <div style={{ marginTop: 16 }}>
            <SparkArea id="vitals-hero" points={heroTrend} color={a.chart} guide={hasReadiness ? undefined : 7} height={70} />
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontFamily: F.sans, fontSize: 12, fontWeight: 600, color: ATMOS_TEXT2 }}>
              <span>{hasReadiness ? "Readiness, last 7 days" : "Last 7 nights"}</span>
              {!hasReadiness && <span>Dashed line: 7 hours</span>}
            </div>
          </div>
        )}
        <p style={{ fontFamily: F.sans, fontSize: 13, fontWeight: 600, color: a.ink, margin: "12px 0 0" }}>
          {hasReadiness ? "Tap for what's driving it" : "Tap for your heart data"} {expanded ? "▲" : "▾"}
        </p>
      </GlowCard>

      {/* Detail (expanded) */}
      {expanded && (
        <div style={{ background: T.surface, borderRadius: 20, padding: "14px 16px", marginBottom: 10, boxShadow: SHADOWS.sm }}>
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
          <p style={{ fontFamily: F.sans, fontSize: 12, color: T.taupe, margin: "8px 0 0", fontStyle: "italic" }}>From your {sourceName} · updates each morning</p>
        </div>
      )}

      {/* Vitals grid */}
      {rows.map((row, i) => (
        <div key={i} style={{ display: "flex", gap: 8, marginBottom: i === rows.length - 1 ? 12 : 8 }}>
          {row.map(t => <Tile key={t.label} label={t.label} value={t.value} sub={t.sub} color={t.color} />)}
        </div>
      ))}

      {/* 7-day trends */}
      {hist.length >= 2 && (
        <div style={{ background: T.surface, borderRadius: 20, padding: "16px 16px 6px", marginBottom: 12, boxShadow: SHADOWS.sm }}>
          <p style={{ fontFamily: F.sans, fontSize: 16, fontWeight: 700, color: T.text, margin: "0 0 12px" }}>Last 7 days</p>
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
      <span style={{ fontFamily: F.serif, letterSpacing: "-0.02em", fontSize: 14, fontWeight: 700, color: valueColor }}>{value}</span>
    </div>
  );
}

function TrendRow({ label, points, color, last }: { label: string; points: (number | null)[]; color: string; last: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
      <span style={{ fontFamily: F.sans, fontSize: 13, fontWeight: 600, color: T.text, width: 72, flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, minWidth: 0 }}><SparkArea id={`trend-${label}`} points={points} color={color} height={30} /></div>
      <span style={{ fontFamily: F.sans, letterSpacing: "-0.02em", fontSize: 15, fontWeight: 800, color: T.text, width: 50, textAlign: "right", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{last}</span>
    </div>
  );
}
