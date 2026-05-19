import React from "react";
import { T, F } from "../../../config/theme";
import { Card, ProgressBar } from "../../../shared/components";
import { gradeColor } from "./types";
import type { AIInsight } from "./types";

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontFamily: F.sans, fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: T.taupe, margin: "16px 0 8px" }}>
      {children}
    </p>
  );
}

export function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{ background: T.ivory, borderRadius: 16, padding: "14px 16px", border: `1px solid ${T.linen}` }}>
      <p style={{ fontFamily: F.sans, fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: T.taupe, margin: "0 0 6px" }}>{label}</p>
      <p style={{ fontFamily: F.serif, fontSize: 24, fontWeight: 700, color: color || T.esp, margin: "0 0 2px" }}>{value}</p>
      {sub && <p style={{ fontFamily: F.sans, fontSize: 11, color: T.taupe, margin: 0 }}>{sub}</p>}
    </div>
  );
}

export function InsightCard({ insight, onDismiss }: { insight: AIInsight; onDismiss?: () => void }) {
  const CATEGORY_COLORS: Record<string, string> = {
    spending: T.blush, savings: T.sage, debt: T.gold, cashflow: T.teal, stress: T.lav,
  };
  const color = CATEGORY_COLORS[insight.category] || T.teal;
  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
        <span style={{ fontFamily: F.sans, fontSize: 10, fontWeight: 700, color, textTransform: "uppercase", letterSpacing: "0.08em" }}>
          {insight.category} · {insight.confidenceLevel}% confidence
        </span>
        {onDismiss && (
          <button onClick={onDismiss} style={{ background: "none", border: "none", color: T.taupe, cursor: "pointer", fontSize: 16, padding: 0 }}>×</button>
        )}
      </div>
      <p style={{ fontFamily: F.sans, fontSize: 13, color: T.esp, margin: "0 0 8px", lineHeight: 1.6 }}>{insight.observation}</p>
      <p style={{ fontFamily: F.sans, fontSize: 12, color: T.taupe, margin: "0 0 10px", lineHeight: 1.5 }}>{insight.whyItMatters}</p>
      {insight.options.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          {insight.options.map((opt, i) => (
            <p key={i} style={{ fontFamily: F.sans, fontSize: 12, color: T.bark, margin: "0 0 4px", paddingLeft: 10, borderLeft: `2px solid ${T.linen}` }}>{opt}</p>
          ))}
        </div>
      )}
      <div style={{ padding: "8px 10px", background: `${color}10`, borderRadius: 8, borderLeft: `3px solid ${color}` }}>
        <p style={{ fontFamily: F.sans, fontSize: 12, fontWeight: 600, color: T.esp, margin: 0 }}>✦ {insight.recommendation}</p>
      </div>
    </Card>
  );
}

export function HealthScoreRing({ score, grade }: { score: number; grade: string }) {
  const r = 36; const circ = 2 * Math.PI * r;
  const color = gradeColor(grade);
  return (
    <div style={{ position: "relative", width: 90, height: 90 }}>
      <svg width={90} height={90} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={45} cy={45} r={r} fill="none" stroke={T.linen} strokeWidth={7} />
        <circle cx={45} cy={45} r={r} fill="none" stroke={color} strokeWidth={7}
          strokeDasharray={circ} strokeDashoffset={circ * (1 - score / 100)}
          strokeLinecap="round" style={{ transition: "stroke-dashoffset 0.8s ease" }} />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontFamily: F.serif, fontSize: 22, fontWeight: 700, color, lineHeight: 1 }}>{grade}</span>
        <span style={{ fontFamily: F.sans, fontSize: 10, color: T.taupe }}>{score}</span>
      </div>
    </div>
  );
}
