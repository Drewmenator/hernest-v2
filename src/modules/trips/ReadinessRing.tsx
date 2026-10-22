import React from "react";
import { T, F, alpha } from "../../config/theme";
import { ProgressRing } from "../../shared/components";

// ═══════════════════════════════════════════════════════════════════
// READINESS RING COMPONENT
// ═══════════════════════════════════════════════════════════════════

export function ReadinessRing({ score, size = 80 }: { score: number; size?: number }) {
  const color = score >= 80 ? T.householdInk : score >= 50 ? T.warn : T.blush;
  return (
    <div role="img" aria-label={`${score} percent ready`} style={{ flexShrink: 0 }}>
      <ProgressRing value={score / 100} size={size} stroke={size >= 72 ? 8 : 6} color={color} track={alpha(color, 0.18)}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", lineHeight: 1 }}>
          <span style={{ fontFamily: F.sans, fontSize: Math.max(14, Math.round(size * 0.26)), fontWeight: 800, letterSpacing: "-0.03em", color: T.text, fontVariantNumeric: "tabular-nums" }}>{score}%</span>
          {size >= 72 && <span style={{ fontFamily: F.sans, fontSize: 12, color: T.text2, marginTop: 2 }}>Ready</span>}
        </div>
      </ProgressRing>
    </div>
  );
}

// ── Stage chip ──────────────────────────────────────────────────────
export function TripStageChip({ label, color, bg }: { label: string; color: string; bg: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", background: bg, color, borderRadius: 99, padding: "4px 10px", fontFamily: F.sans, fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}>
      {label}
    </span>
  );
}

// ── Traveler avatars ────────────────────────────────────────────────
export function TravelerAvatars({ names, max = 4 }: { names: string[]; max?: number }) {
  const shown = names.slice(0, max);
  return (
    <div style={{ display: "flex", alignItems: "center" }}>
      {shown.map((n, i) => (
        <span key={i} title={n} style={{ width: 30, height: 30, borderRadius: "50%", marginLeft: i === 0 ? 0 : -8, background: T.surface, color: T.action, border: `2px solid ${T.cleoBg}`, display: "inline-grid", placeItems: "center", fontFamily: F.sans, fontSize: 13, fontWeight: 700 }}>
          {(n.trim()[0] || "?").toUpperCase()}
        </span>
      ))}
      {names.length > max && <span style={{ marginLeft: 8, fontFamily: F.sans, fontSize: 13, fontWeight: 600, color: T.text2 }}>+{names.length - max}</span>}
    </div>
  );
}
