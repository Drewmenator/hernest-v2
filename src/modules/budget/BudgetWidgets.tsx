import React, { useState } from "react";
import { T, F } from "../../config/theme";
import { gradeColor } from "./budgetShared";
import type { AIInsight } from "./budgetShared";

// ═══════════════════════════════════════════════════════════════════
// SUB-COMPONENTS
// ═══════════════════════════════════════════════════════════════════

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontFamily: F.sans, fontSize: 10, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: T.taupe, margin: "0 0 10px" }}>
      {children}
    </p>
  );
}

export function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{ flex: 1, minWidth: 0, padding: "14px 16px", background: T.ivory, borderRadius: 16, border: `1px solid ${T.linen}` }}>
      <p style={{ fontFamily: F.sans, fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: T.taupe, margin: "0 0 6px" }}>{label}</p>
      <p style={{ fontFamily: F.serif, fontSize: 20, fontWeight: 700, color: color || T.esp, margin: 0 }}>{value}</p>
      {sub && <p style={{ fontFamily: F.sans, fontSize: 11, color: T.taupe, margin: "3px 0 0" }}>{sub}</p>}
    </div>
  );
}

export function InsightCard({ insight, onDismiss }: { insight: AIInsight; onDismiss?: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const catColors: Record<string, string> = {
    spending: T.gold, savings: T.sage, debt: T.blush, cashflow: T.teal, stress: T.lav
  };
  const color = catColors[insight.category] || T.taupe;

  return (
    <div style={{ padding: "16px", background: T.ivory, borderRadius: 18, border: `1px solid ${T.linen}`, marginBottom: 10, borderLeft: `3px solid ${color}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div style={{ flex: 1 }}>
          <p style={{ fontFamily: F.sans, fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color, margin: "0 0 6px" }}>
            {insight.category.replace("_", " ")} · {insight.confidenceLevel}% confidence
          </p>
          <p style={{ fontFamily: F.sans, fontSize: 13, fontWeight: 600, color: T.esp, margin: "0 0 4px", lineHeight: 1.5 }}>{insight.observation}</p>
        </div>
        <button onClick={() => setExpanded(p => !p)} style={{ background: "none", border: "none", color: T.taupe, cursor: "pointer", fontSize: 18, flexShrink: 0, padding: 0 }}>
          {expanded ? "↑" : "↓"}
        </button>
      </div>

      {expanded && (
        <div style={{ marginTop: 12, borderTop: `1px solid ${T.linen}`, paddingTop: 12 }}>
          <p style={{ fontFamily: F.sans, fontSize: 12, color: T.bark, margin: "0 0 10px", lineHeight: 1.6 }}>
            <strong>Why it matters:</strong> {insight.whyItMatters}
          </p>
          {insight.options.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <p style={{ fontFamily: F.sans, fontSize: 11, fontWeight: 700, color: T.taupe, margin: "0 0 6px" }}>OPTIONS</p>
              {insight.options.map((o, i) => (
                <p key={i} style={{ fontFamily: F.sans, fontSize: 12, color: T.bark, margin: "0 0 4px", paddingLeft: 12, borderLeft: `2px solid ${T.linen}`, lineHeight: 1.5 }}>
                  {o}
                </p>
              ))}
            </div>
          )}
          <div style={{ padding: "10px 14px", background: `${color}10`, borderRadius: 10 }}>
            <p style={{ fontFamily: F.sans, fontSize: 12, fontWeight: 600, color: T.esp, margin: 0, lineHeight: 1.5 }}>
              ✦ {insight.recommendation}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export function HealthScoreRing({ score, grade }: { score: number; grade: string }) {
  const color = gradeColor(grade);
  const radius = 38;
  const circ = 2 * Math.PI * radius;
  const filled = (score / 100) * circ;

  return (
    <div style={{ position: "relative", width: 100, height: 100, flexShrink: 0 }}>
      <svg width={100} height={100} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={50} cy={50} r={radius} fill="none" stroke={T.linen} strokeWidth={8} />
        <circle cx={50} cy={50} r={radius} fill="none" stroke={color} strokeWidth={8}
          strokeDasharray={`${filled} ${circ - filled}`} strokeLinecap="round"
          style={{ transition: "stroke-dasharray 1s ease" }} />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontFamily: F.serif, fontSize: 22, fontWeight: 700, color }}>{grade}</span>
        <span style={{ fontFamily: F.sans, fontSize: 10, color: T.taupe }}>{score}/100</span>
      </div>
    </div>
  );
}
