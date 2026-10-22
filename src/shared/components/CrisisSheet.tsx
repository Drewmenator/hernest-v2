// ─── Crisis sheet ──────────────────────────────────────────────────
// Opens anywhere in the app when a screen that isn't a chat (bill line,
// school paste, trip) sees distress language (core/crisis.ts
// guardUserText). Same words and helplines as Cleo's chat reply, with tap-to-
// call and tap-to-text for 988.
import { useEffect, useState } from "react";
import { T, F } from "../../config/theme";
import { CRISIS_EVENT } from "../../core/crisis";

const linkStyle = {
  display: "block", textAlign: "center" as const, padding: "12px", borderRadius: 14, minHeight: 44,
  fontFamily: F.sans, fontSize: 14, fontWeight: 700, textDecoration: "none", boxSizing: "border-box" as const,
};

export function CrisisSheet() {
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    const open = (e: Event) => setText((e as CustomEvent<{ text: string }>).detail?.text || null);
    window.addEventListener(CRISIS_EVENT, open);
    return () => window.removeEventListener(CRISIS_EVENT, open);
  }, []);

  if (!text) return null;
  const us = text.includes("988");

  return (
    <div role="dialog" aria-modal="true" aria-label="Help is available"
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(42,31,24,0.55)", display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div style={{ background: "#fff", width: "100%", maxWidth: 480, borderRadius: "24px 24px 0 0", padding: "24px 20px calc(20px + env(safe-area-inset-bottom))", maxHeight: "85vh", overflowY: "auto" }}>
        {text.split("\n").filter(l => l.trim()).map((line, i) => {
          const parts = line.split(/\*\*(.*?)\*\*/g);
          return (
            <p key={i} style={{ fontFamily: F.sans, fontSize: 14, color: T.esp, margin: "0 0 10px", lineHeight: 1.6 }}>
              {parts.map((p, j) => (j % 2 === 1 ? <strong key={j}>{p}</strong> : p))}
            </p>
          );
        })}
        {us && (
          <div style={{ display: "grid", gap: 8, margin: "16px 0 8px" }}>
            <a href="tel:988" style={{ ...linkStyle, background: T.esp, color: "#fff" }}>Call 988</a>
            <a href="sms:988" style={{ ...linkStyle, background: T.sand, color: T.esp }}>Text 988</a>
          </div>
        )}
        <button onClick={() => setText(null)}
          style={{ width: "100%", padding: "12px", minHeight: 44, background: "none", border: `1px solid ${T.linen}`, borderRadius: 14, fontFamily: F.sans, fontSize: 14, color: T.esp, cursor: "pointer" }}>
          Close
        </button>
      </div>
    </div>
  );
}
