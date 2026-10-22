// ─── HerNest V2 Tab Bar ───────────────────────────────────────────
// Five tabs, nothing hidden in "More" (simplification plan, section 3).
// Old tab ids still work: each screen lights up the tab it lives under.
import { T, F } from "../../config/theme";
import { HomeIcon, CleoIcon, PlanIcon, BudgetIcon, MeIcon } from "./Icons";
import { useStore } from "../../core/store";
import { tabFor } from "./tabParents";

const TABS = [
  { id: "home",   label: "Today", IC: HomeIcon },
  { id: "plan",   label: "Plan",  IC: PlanIcon },
  { id: "cleo",   label: "Cleo",  IC: CleoIcon },
  { id: "budget", label: "Bills", IC: BudgetIcon },   // "budget" id shows Bills
  { id: "me",     label: "Me",    IC: MeIcon },
];

// Wisteria tab bar: frosted ivory, deep violet for the selected tab with a
// filled icon, always a text label. Sits above the iPhone home indicator.
export function TabBar() {
  const activeTab = useStore(s => s.activeTab);
  const setActiveTab = useStore(s => s.setActiveTab);
  const current = tabFor(activeTab);

  return (
    <nav aria-label="Main" style={{
      position: "fixed", bottom: 0, left: "50%",
      transform: "translateX(-50%)",
      width: "100%", maxWidth: 430,
      background: "rgba(244,238,224,.88)",
      backdropFilter: "blur(22px) saturate(170%)",
      WebkitBackdropFilter: "blur(22px) saturate(170%)",
      borderTop: `1px solid ${T.divider}`,
      zIndex: 100,
      paddingBottom: "max(env(safe-area-inset-bottom, 0px), 8px)",
    }}>
      <div style={{ display: "flex", padding: "6px 4px 2px" }}>
        {TABS.map(t => {
          const on = current === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              aria-current={on ? "page" : undefined}
              style={{
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                gap: 3, background: "none", border: "none", cursor: "pointer",
                padding: "4px 6px", flex: 1,
                minHeight: 48, touchAction: "manipulation",
                color: on ? T.action : T.text2,
              }}
            >
              <t.IC size={25} color={on ? T.action : T.text2} filled={on} strokeWidth={1.8} />
              <span style={{ fontFamily: F.sans, fontSize: 12, fontWeight: on ? 700 : 500, letterSpacing: 0.1 }}>
                {t.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
