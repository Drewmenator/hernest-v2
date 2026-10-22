// ─── Non-component helpers for the Bills screens ───────────────────
import type React from "react";
import { T, F } from "../../config/theme";

export const inputStyle: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", background: T.sand, border: `1.5px solid ${T.linen}`,
  borderRadius: 12, padding: "12px 14px", fontFamily: F.sans, fontSize: 16, color: T.esp,
  outline: "none", marginBottom: 10,
};

export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
