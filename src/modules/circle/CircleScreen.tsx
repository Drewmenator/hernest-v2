// ─── Circle → now part of "Your family" ──────────────────────────
// Circle's contacts, birthdays, gift ideas and check-in reminders moved into
// Your family (the one people list). The AI Companions are gone. This screen
// stays only so old links (e.g. the birthday push, which opens "circle") land
// somewhere sensible: it makes sure the contacts are copied over, then opens
// Your family. The saved circle data is left untouched.
import { useEffect } from "react";
import { T, F } from "../../config/theme";
import { useStore } from "../../core/store";
import { Spinner } from "../../shared/components";
import { ensurePeopleMerged } from "../../core/familyPeopleSync";

export function CircleScreen() {
  const { user, setActiveTab } = useStore();

  useEffect(() => {
    if (!user?.uid) return;
    let alive = true;
    ensurePeopleMerged(user.uid).finally(() => { if (alive) setActiveTab("family"); });
    return () => { alive = false; };
  }, [user?.uid, setActiveTab]);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "48px 16px", animation: "fadeUp .3s ease both" }}>
      <Spinner size={20} />
      <p style={{ fontFamily: F.sans, fontSize: 13, color: T.taupe, margin: 0, textAlign: "center" }}>Your circle is now part of Your family…</p>
    </div>
  );
}
