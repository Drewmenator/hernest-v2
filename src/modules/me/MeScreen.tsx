// ─── Me tab ────────────────────────────────────────────────────────
// The part of the app that is just for her: Wellness (Thrive) and Style.
// Wellness and Style share one segmented switch (Wisteria, warm blush).
import React from "react";
import { Segmented } from "../../shared/components";
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
      <Segmented label="Me" value={segment} onChange={pick} options={[{ id: "wellness", label: "Wellness" }, { id: "style", label: "Style" }]} />
      {segment === "style" ? <StyleScreen /> : <ThriveScreen />}
    </div>
  );
}
