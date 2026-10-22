// ─── "Want me to remember that?" ───────────────────────────────────
// Shown under Cleo's reply when she picked up something worth keeping.
// Nothing is remembered until the user taps Yes. Unanswered suggestions
// keep waiting in What Cleo knows, and chat never asks about them twice.
import { T, F } from "../../config/theme";
import type { HouseholdMemory } from "../../core/memoryServiceV2";

interface Props {
  suggestions: HouseholdMemory[];
  onAnswer: (memory: HouseholdMemory, remember: boolean) => void;
}

export function MemorySuggestionCard({ suggestions, onAnswer }: Props) {
  if (!suggestions.length) return null;
  return (
    <div style={{ marginLeft: 40, marginBottom: 12, maxWidth: "82%", background: `${T.lav}0D`, border: `1px solid ${T.lav}33`, borderRadius: 14, padding: "12px 14px" }}>
      <p style={{ fontFamily: F.sans, fontSize: 12, fontWeight: 700, color: T.esp, margin: "0 0 8px" }}>
        {suggestions.length > 1 ? "Want me to remember these?" : "Want me to remember that?"}
      </p>
      {suggestions.map(m => (
        <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderTop: `1px solid ${T.linen}` }}>
          <p style={{ flex: 1, fontFamily: F.sans, fontSize: 13, color: T.bark, margin: 0, lineHeight: 1.5 }}>{String(m.content ?? "")}</p>
          <button onClick={() => onAnswer(m, true)} aria-label={`Yes, remember: ${m.content}`}
            style={{ padding: "6px 12px", background: T.sage, color: "#fff", border: "none", borderRadius: 10, fontFamily: F.sans, fontSize: 12, fontWeight: 600, cursor: "pointer", minHeight: 34, touchAction: "manipulation" }}>
            Yes
          </button>
          <button onClick={() => onAnswer(m, false)} aria-label={`No, don't remember: ${m.content}`}
            style={{ padding: "6px 12px", background: "none", border: `1px solid ${T.linen}`, borderRadius: 10, fontFamily: F.sans, fontSize: 12, color: T.taupe, cursor: "pointer", minHeight: 34, touchAction: "manipulation" }}>
            No
          </button>
        </div>
      ))}
      <p style={{ fontFamily: F.sans, fontSize: 12, color: T.taupe, margin: "6px 0 0" }}>
        You can change this anytime in What Cleo knows.
      </p>
    </div>
  );
}
