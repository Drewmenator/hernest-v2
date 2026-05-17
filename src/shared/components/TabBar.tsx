// ─── HerNest V2 Tab Bar ───────────────────────────────────────────
import React from "react";
import { T, F } from "../../config/theme";
import { HomeIcon, NoraIcon, PlanIcon, BudgetIcon, BriefIcon, FamilyIcon, ThriveIcon, StyleIcon, TripsIcon, CircleIcon, CalendarIcon, ProfileIcon, SettingsIcon, UpgradeIcon, MoreIcon } from "./Icons";
import { useStore } from "../../core/store";

const TABS = [
  { id: "home",     label: "Home",    IC: HomeIcon },
  { id: "nora",     label: "Nora",    IC: NoraIcon },
  { id: "plan",     label: "Plan",    IC: PlanIcon },
  { id: "budget",   label: "Budget",  IC: BudgetIcon },
  { id: "briefing", label: "Brief",   IC: BriefIcon },
];

const MORE_TABS = [
  { id: "family",   label: "Family",    IC: FamilyIcon },
  { id: "thrive",   label: "Thrive",    IC: ThriveIcon },
  { id: "style",    label: "Style",     IC: StyleIcon },
  { id: "trips",    label: "Trips",     IC: TripsIcon },
  { id: "circle",   label: "Circle",    IC: CircleIcon },
  { id: "calendar", label: "Calendar",  IC: CalendarIcon },
  { id: "profile",  label: "Profile",   IC: ProfileIcon },
  { id: "settings", label: "Settings",  IC: SettingsIcon },
  { id: "upgrade",  label: "Go Pro ✦",  IC: UpgradeIcon },
];

export function TabBar() {
  const { activeTab, setActiveTab, showMore, setShowMore } = useStore();

  const isMoreActive = MORE_TABS.some(t => t.id === activeTab);

  return (
    <div style={{
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
      {/* More drawer */}
      {showMore && (
        <div style={{
          background: "rgba(255,252,248,.99)",
          borderTop: `1px solid ${T.linen}`,
          padding: "12px 16px 16px",
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 8,
        }}>
          {MORE_TABS.map(t => (
            <button
              key={t.id}
              onClick={() => { setActiveTab(t.id); setShowMore(false); }}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "10px 14px", borderRadius: 14,
                background: activeTab === t.id ? T.sand : "#fff",
                border: `1px solid ${activeTab === t.id ? T.gold : T.linen}`,
                cursor: "pointer",
              }}
            >
              <t.IC size={18} color={activeTab === t.id ? T.gold : T.bark} strokeWidth={1.4}/>
              <span style={{
                fontFamily: F.sans, fontSize: 12,
                fontWeight: activeTab === t.id ? 700 : 400,
                color: activeTab === t.id ? T.gold : T.bark,
              }}>
                {t.label}
              </span>
            </button>
          ))}

        </div>
      )}

      {/* Primary tabs */}
      <div style={{ display: "flex", padding: "8px 4px 10px" }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => { setActiveTab(t.id); setShowMore(false); }}
            style={{
              display: "flex", flexDirection: "column", alignItems: "center",
              gap: 2, background: "none", border: "none", cursor: "pointer",
              padding: "6px 8px", borderRadius: 14, flex: 1,
              minHeight: 44, touchAction: "manipulation",
            }}
          >
            <div style={{
              width: 4, height: 4, borderRadius: 99,
              background: activeTab === t.id ? T.gold : "transparent",
              marginBottom: 1, transition: "all .2s",
            }} />
            <t.IC size={20} color={activeTab === t.id ? T.gold : T.taupe} strokeWidth={activeTab === t.id ? 1.8 : 1.3}/>
            <span style={{
              fontFamily: F.sans, fontSize: 9,
              fontWeight: activeTab === t.id ? 700 : 500,
              color: activeTab === t.id ? T.gold : T.taupe,
              letterSpacing: 0.6,
            }}>
              {t.label}
            </span>
          </button>
        ))}

        {/* More button */}
        <button
          onClick={() => setShowMore(!showMore)}
          style={{
            display: "flex", flexDirection: "column", alignItems: "center",
            gap: 2, background: "none", border: "none", cursor: "pointer",
            padding: "4px 8px", borderRadius: 14, flex: 1,
          }}
        >
          <div style={{
            width: 4, height: 4, borderRadius: 99,
            background: isMoreActive || showMore ? T.gold : "transparent",
            marginBottom: 1, transition: "all .2s",
          }} />
          <MoreIcon size={20} color={showMore || isMoreActive ? T.gold : T.taupe} strokeWidth={1.4}/>
          <span style={{
            fontFamily: F.sans, fontSize: 9,
            fontWeight: showMore || isMoreActive ? 700 : 500,
            color: showMore || isMoreActive ? T.gold : T.taupe,
            letterSpacing: 0.6,
          }}>
            More
          </span>
        </button>
      </div>
    </div>
  );
}
