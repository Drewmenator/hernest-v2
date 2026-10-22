// ─── HerNest V2 Tab Bar ───────────────────────────────────────────
// Five tabs, nothing hidden in "More" (simplification plan, section 3).
// Old tab ids still work: each screen lights up the tab it lives under.
import { T, F, MOTION } from "../../config/theme";
import { HomeIcon, CleoIcon, PlanIcon, BudgetIcon, MeIcon } from "./Icons";
import { useStore } from "../../core/store";
import { tabFor } from "./tabParents";
import { haptic } from "../haptics";

const TABS = [
  { id: "home",   label: "Today", IC: HomeIcon },
  { id: "plan",   label: "Plan",  IC: PlanIcon },
  { id: "cleo",   label: "Cleo",  IC: CleoIcon },
  { id: "budget", label: "Bills", IC: BudgetIcon },   // "budget" id shows Bills
  { id: "me",     label: "Me",    IC: MeIcon },
];

// Floating frosted tab bar: a rounded glass pill that hovers above the
// iPhone home indicator, with a lavender highlight that slides to the
// selected tab. Always a text label; the selected icon is filled.
export function TabBar() {
  const activeTab = useStore(s => s.activeTab);
  const setActiveTab = useStore(s => s.setActiveTab);
  const current = tabFor(activeTab);
  const idx = TABS.findIndex(t => t.id === current);

  return (
    <nav aria-label="Main" style={{
      position: "fixed", left: "50%", transform: "translateX(-50%)",
      bottom: "calc(max(env(safe-area-inset-bottom, 0px), 10px) + 2px)",
      width: "calc(100% - 24px)", maxWidth: 406,
      background: "rgba(252,249,243,.72)",
      backdropFilter: "blur(24px) saturate(180%)",
      WebkitBackdropFilter: "blur(24px) saturate(180%)",
      border: "1px solid rgba(255,255,255,.7)",
      borderRadius: 30,
      boxShadow: "0 1px 0 rgba(255,255,255,.8) inset, 0 12px 32px -8px rgba(28,61,90,.22), 0 2px 6px rgba(28,61,90,.06)",
      zIndex: 100,
    }}>
      <div style={{ position: "relative", display: "flex", padding: 5 }}>
        {idx >= 0 && (
          <span aria-hidden="true" style={{
            position: "absolute", top: 5, bottom: 5, left: 5, width: `calc((100% - 10px) / ${TABS.length})`,
            borderRadius: 24, background: "linear-gradient(180deg, rgba(230,221,240,.95), rgba(214,201,232,.9))",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,.7)",
            transform: `translateX(${idx * 100}%)`, transition: `transform .42s ${MOTION.ease}`,
          }} />
        )}
        {TABS.map(t => {
          const on = current === t.id;
          return (
            <button
              key={t.id}
              onClick={() => { haptic("select"); if (!on) setActiveTab(t.id); else window.scrollTo({ top: 0, behavior: "smooth" }); }}
              aria-current={on ? "page" : undefined}
              style={{
                position: "relative",
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                gap: 2, background: "none", border: "none", cursor: "pointer",
                padding: "4px 2px", flex: 1,
                minHeight: 52, touchAction: "manipulation",
                color: on ? T.actionPress : T.text2,
              }}
            >
              <t.IC size={24} color={on ? T.actionPress : T.text2} filled={on} strokeWidth={1.8} />
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
