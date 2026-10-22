// ─── HerNest V2 Tab Bar ───────────────────────────────────────────
// Five tabs, nothing hidden in "More" (simplification plan, section 3).
// Old tab ids still work: each screen lights up the tab it lives under.
import React from "react";
import { T, F } from "../../config/theme";
import { HomeIcon, CleoIcon, PlanIcon, BudgetIcon, HeartIcon } from "./Icons";
import { useStore } from "../../core/store";
import { tabFor } from "./tabParents";

const TABS = [
  { id: "home",   label: "Today", IC: HomeIcon },
  { id: "plan",   label: "Plan",  IC: PlanIcon },
  { id: "cleo",   label: "Cleo",  IC: CleoIcon },
  { id: "budget", label: "Bills", IC: BudgetIcon },   // "budget" id shows Bills
  { id: "me",     label: "Me",    IC: HeartIcon },
];

export function TabBar() {
  const activeTab = useStore(s => s.activeTab);
  const setActiveTab = useStore(s => s.setActiveTab);
  const current = tabFor(activeTab);

  return (
    <nav aria-label="Main" style={{
      position: "fixed", bottom: 0, left: "50%",
      transform: "translateX(-50%)",
      width: "100%", maxWidth: 430,
      background: "rgba(255,252,248,.97)",
      backdropFilter: "blur(24px)",
      WebkitBackdropFilter: "blur(24px)",
      borderTop: `1px solid rgba(229,217,201,.8)`,
      zIndex: 100,
      boxShadow: "0 -4px 24px rgba(46,31,20,.06)",
      paddingBottom: "env(safe-area-inset-bottom, 16px)",
    }}>
      <div style={{ display: "flex", padding: "8px 4px 10px" }}>
        {TABS.map(t => {
          const on = current === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              aria-current={on ? "page" : undefined}
              style={{
                display: "flex", flexDirection: "column", alignItems: "center",
                gap: 2, background: "none", border: "none", cursor: "pointer",
                padding: "6px 8px", borderRadius: 14, flex: 1,
                minHeight: 44, touchAction: "manipulation",
              }}
            >
              <div style={{
                width: 4, height: 4, borderRadius: 99,
                background: on ? T.gold : "transparent",
                marginBottom: 1, transition: "all .2s",
              }} />
              <t.IC size={20} color={on ? T.gold : T.taupe} strokeWidth={on ? 1.8 : 1.3}/>
              <span style={{
                fontFamily: F.sans, fontSize: 10,
                fontWeight: on ? 700 : 500,
                color: on ? T.goldText : T.taupe,
                letterSpacing: 0.4,
              }}>
                {t.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
