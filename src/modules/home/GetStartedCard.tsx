import React, { useEffect, useState } from "react";
import { T, F } from "../../config/theme";
import { useStore } from "../../core/store";
import { onEnterSpace } from "../../shared/utils/a11y";
import { loadHomeDocs } from "./homeData";
import { Check, ArrowRight } from "lucide-react";

// ── Post-onboarding guide ──────────────────────────────────────────
// Onboarding is delightful, then new users land on ten tiles with no map.
// Three steps to first real value; disappears once done or dismissed.
export function GetStartedCard() {
  const { user } = useStore();
  const setActiveTab = useStore(s => s.setActiveTab);
  const [dismissed, setDismissed] = useState(() => localStorage.getItem("hn_getstarted_done") === "1");
  const [steps, setSteps] = useState<{ bills: boolean; task: boolean; connect: boolean } | null>(null);

  useEffect(() => {
    if (!user?.uid || dismissed) return;
    let alive = true;
    (async () => {
      try {
        const docs = await loadHomeDocs(user.uid);
        const bills = (docs.bills?.bills as unknown[]) || [];
        const tasks = (docs.tasks?.tasks as unknown[]) || [];
        const { doc, getDoc } = await import("firebase/firestore");
        const { db } = await import("../../core/firebase");
        const snaps = await Promise.all(["google_calendar", "apple_calendar", "oura", "gmail"].map(d =>
          getDoc(doc(db, "users", user.uid, "integrations", d)).catch(() => null)));
        const connected = snaps.some(s => s?.exists());
        if (alive) setSteps({ bills: bills.length > 0, task: tasks.length > 0, connect: connected });
      } catch { if (alive) setSteps(null); }
    })();
    return () => { alive = false; };
  }, [user?.uid, dismissed]);

  if (dismissed || !steps) return null;
  const items = [
    { done: steps.bills, label: "Add your bills", sub: "we'll remind you before each one", tab: "budget" },
    { done: steps.task, label: "Add your first task", sub: "or just tell Cleo", tab: "plan" },
    { done: steps.connect, label: "Connect a calendar or your ring", sub: "so Cleo sees your real life", tab: "connections" },
  ];
  const doneCount = items.filter(i => i.done).length;
  if (doneCount === items.length) { localStorage.setItem("hn_getstarted_done", "1"); return null; }

  return (
    <div style={{ background: T.ivory, border: `1.5px solid ${T.gold}40`, borderRadius: 20, padding: "16px", marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <p style={{ fontFamily: F.sans, fontSize: 14, fontWeight: 600, color: T.goldText, margin: 0 }}>GETTING STARTED · {doneCount}/3</p>
        <button onClick={() => { localStorage.setItem("hn_getstarted_done", "1"); setDismissed(true); }}
          style={{ background: "none", border: "none", color: T.taupe, fontSize: 15, cursor: "pointer", padding: 0 }}>×</button>
      </div>
      {items.map((it, i) => (
        <div key={i} onClick={() => !it.done && setActiveTab(it.tab)}
          role="button" tabIndex={0} onKeyDown={onEnterSpace} aria-label={it.label}
          style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: i < items.length - 1 ? `1px solid ${T.linen}` : "none", cursor: it.done ? "default" : "pointer", opacity: it.done ? 0.55 : 1, touchAction: "manipulation" }}>
          <span style={{ width: 20, textAlign: "center", color: it.done ? T.sage : T.gold, fontSize: 14, flexShrink: 0, display: "inline-flex", justifyContent: "center" }}>{it.done ? <Check size={16} strokeWidth={2.2} aria-hidden="true" /> : <ArrowRight size={16} strokeWidth={2} aria-hidden="true" />}</span>
          <div style={{ flex: 1 }}>
            <p style={{ fontFamily: F.sans, fontSize: 13, fontWeight: 600, color: T.esp, margin: 0, textDecoration: it.done ? "line-through" : "none" }}>{it.label}</p>
            <p style={{ fontFamily: F.sans, fontSize: 12, color: T.taupe, margin: "1px 0 0" }}>{it.sub}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
