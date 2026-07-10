import React from "react";
import { T, F } from "../../config/theme";

// ═══════════════════════════════════════════════════════════════════
// READINESS RING COMPONENT
// ═══════════════════════════════════════════════════════════════════

export function ReadinessRing({ score, size = 80 }: { score: number; size?: number }) {
  const r = (size / 2) - 8;
  const circ = 2 * Math.PI * r;
  const color = score >= 80 ? T.sage : score >= 50 ? T.gold : T.blush;
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={T.linen} strokeWidth={6} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={6}
          strokeDasharray={circ} strokeDashoffset={circ * (1 - score / 100)}
          strokeLinecap="round" style={{ transition: "stroke-dashoffset 0.6s ease" }} />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontFamily: F.serif, fontSize: size * 0.22, fontWeight: 700, color, lineHeight: 1 }}>{score}%</span>
        <span style={{ fontFamily: F.sans, fontSize: size * 0.10, color: T.taupe, textTransform: "uppercase", letterSpacing: "0.06em" }}>Ready</span>
      </div>
    </div>
  );
}
