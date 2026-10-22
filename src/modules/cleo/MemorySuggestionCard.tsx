// ─── "Want me to remember that?" ───────────────────────────────────
// Shown under Cleo's reply when she picked up something worth keeping.
// Nothing is remembered until the user taps Yes. Unanswered suggestions
// keep waiting in What Cleo knows, and chat never asks about them twice.
import { T, F, TYPE } from "../../config/theme";
import { Button } from "../../shared/components";
import { SparkleIcon } from "../../shared/components/Icons";
import type { HouseholdMemory } from "../../core/memoryServiceV2";

interface Props {
  suggestions: HouseholdMemory[];
  onAnswer: (memory: HouseholdMemory, remember: boolean) => void;
}

export function MemorySuggestionCard({ suggestions, onAnswer }: Props) {
  if (!suggestions.length) return null;
  return (
    <section aria-label="Memory suggestions" style={{ marginBottom: 12, maxWidth: "92%", background: T.cleoBg, borderRadius: 18, padding: "14px 16px" }}>
      <p style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: F.sans, fontSize: 15, fontWeight: 700, color: T.text, margin: "0 0 4px" }}>
        <SparkleIcon size={16} color={T.action} filled />
        {suggestions.length > 1 ? "Want me to remember these?" : "Want me to remember that?"}
      </p>
      {suggestions.map(m => (
        <div key={m.id} style={{ padding: "10px 0", borderTop: "1px solid rgba(94,74,140,0.15)" }}>
          <p style={{ fontFamily: F.sans, fontSize: TYPE.body, color: T.text, margin: "0 0 8px", lineHeight: 1.45 }}>{String(m.content ?? "")}</p>
          <div style={{ display: "flex", gap: 8 }}>
            <Button size="sm" onClick={() => onAnswer(m, true)} ariaLabel={`Yes, remember: ${m.content}`} style={{ width: "auto" }}>Yes</Button>
            <Button size="sm" variant="secondary" onClick={() => onAnswer(m, false)} ariaLabel={`No, don't remember: ${m.content}`} style={{ width: "auto" }}>No</Button>
          </div>
        </div>
      ))}
      <p style={{ fontFamily: F.sans, fontSize: 13, color: T.text2, margin: "4px 0 0" }}>
        You can change this anytime in What Cleo knows.
      </p>
    </section>
  );
}
