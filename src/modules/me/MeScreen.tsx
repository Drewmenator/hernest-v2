// ─── Me tab ────────────────────────────────────────────────────────
// The part of the app that is just for her: Wellness (Thrive) and Style.
// Both screens are shown as they are; their redesign is a separate phase.
import React from "react";
import { T, F } from "../../config/theme";
import { useStore } from "../../core/store";
import { ME_SEGMENT_KEY, type MeSegment } from "./meSegment";

const ThriveScreen = React.lazy(() => import("../thrive/ThriveScreen").then(m => ({ default: m.ThriveScreen })));
const StyleScreen = React.lazy(() => import("../style/StyleScreen").then(m => ({ default: m.StyleScreen })));

export function MeScreen({ segment }: { segment: MeSegment }) {
  const setActiveTab = useStore(s => s.setActiveTab);
  const pick = (s: MeSegment) => {
    try { localStorage.setItem(ME_SEGMENT_KEY, s); } catch { /* private mode */ }
    // Keep the old tab ids so notifications and links ("thrive") still land here.
    setActiveTab(s === "style" ? "style" : "thrive");
  };

  return (
    <div>
      <div role="tablist" aria-label="Me" style={{ display: "flex", gap: 4, padding: 4, background: T.sand, borderRadius: 14, marginBottom: 16 }}>
        {([["wellness", "Wellness"], ["style", "Style"]] as const).map(([id, label]) => {
          const on = segment === id;
          return (
            <button key={id} role="tab" aria-selected={on} onClick={() => pick(id)}
              style={{ flex: 1, minHeight: 40, borderRadius: 11, border: "none", cursor: "pointer", touchAction: "manipulation",
                background: on ? "#fff" : "transparent", boxShadow: on ? "0 1px 4px rgba(46,31,20,.10)" : "none",
                fontFamily: F.sans, fontSize: 13, fontWeight: on ? 700 : 500, color: on ? T.esp : T.taupe }}>
              {label}
            </button>
          );
        })}
      </div>
      {segment === "style" ? <StyleScreen /> : <ThriveScreen />}
    </div>
  );
}
