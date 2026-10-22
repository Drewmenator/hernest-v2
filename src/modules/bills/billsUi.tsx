// ─── Small shared pieces for the Bills screens ─────────────────────
import React from "react";
import { T, F } from "../../config/theme";

export function SectionHeading({ children, color = T.taupe }: { children: React.ReactNode; color?: string }) {
  return (
    <p style={{ fontFamily: F.sans, fontSize: 12, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color, margin: "18px 4px 8px" }}>
      {children}
    </p>
  );
}

export function PrimaryButton({ children, onClick, disabled, style }: {
  children: React.ReactNode; onClick: () => void; disabled?: boolean; style?: React.CSSProperties;
}) {
  return (
    <button onClick={onClick} disabled={disabled}
      style={{ width: "100%", background: disabled ? T.linen : T.esp, color: "#fff", border: "none", borderRadius: 14,
        padding: "14px 18px", fontFamily: F.sans, fontSize: 15, fontWeight: 700, cursor: disabled ? "default" : "pointer",
        minHeight: 50, touchAction: "manipulation", ...style }}>
      {children}
    </button>
  );
}

export function GhostButton({ children, onClick, style }: { children: React.ReactNode; onClick: () => void; style?: React.CSSProperties }) {
  return (
    <button onClick={onClick}
      style={{ background: "transparent", color: T.bark, border: `1.5px solid ${T.linen}`, borderRadius: 14,
        padding: "12px 16px", fontFamily: F.sans, fontSize: 14, fontWeight: 600, cursor: "pointer",
        minHeight: 46, touchAction: "manipulation", ...style }}>
      {children}
    </button>
  );
}

export function TextLink({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick}
      style={{ background: "none", border: "none", color: T.goldText, fontFamily: F.sans, fontSize: 13.5, fontWeight: 600,
        cursor: "pointer", padding: "10px 4px", minHeight: 44, touchAction: "manipulation" }}>
      {children}
    </button>
  );
}

// 1–31 grid plus an optional "Not sure".
export function DayPicker({ value, onPick, allowUnsure, onUnsure }: {
  value?: number; onPick: (d: number) => void; allowUnsure?: boolean; onUnsure?: () => void;
}) {
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6 }}>
        {Array.from({ length: 31 }, (_, i) => i + 1).map(d => (
          <button key={d} onClick={() => onPick(d)} aria-label={`Day ${d}`} aria-pressed={value === d}
            style={{ height: 40, borderRadius: 10, border: `1.5px solid ${value === d ? T.esp : T.linen}`,
              background: value === d ? T.esp : "#fff", color: value === d ? "#fff" : T.esp,
              fontFamily: F.sans, fontSize: 14, fontWeight: 600, cursor: "pointer", touchAction: "manipulation" }}>
            {d}
          </button>
        ))}
      </div>
      {allowUnsure && (
        <button onClick={onUnsure}
          style={{ marginTop: 8, width: "100%", height: 40, borderRadius: 10, border: `1.5px solid ${value ? T.linen : T.esp}`,
            background: value ? "#fff" : T.sand, color: T.bark, fontFamily: F.sans, fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}>
          Not sure yet
        </button>
      )}
    </div>
  );
}
