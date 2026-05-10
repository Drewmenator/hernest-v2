// ─── HerNest V2 Tab Bar ───────────────────────────────────────────
import React from "react";
import { T, F } from "../../config/theme";
import { useStore } from "../../core/store";

const TABS = [
  { id: "home",     label: "Home",    icon: "⌂" },
  { id: "nora",     label: "Nora",    icon: "✦" },
  { id: "plan",     label: "Plan",    icon: "☐" },
  { id: "budget",   label: "Budget",  icon: "◎" },
  { id: "briefing", label: "Brief",   icon: "☀" },
];

const MORE_TABS = [
  { id: "thrive",  label: "Thrive",  icon: "🌿" },
  { id: "style",   label: "Style",   icon: "✦" },
  { id: "trips",   label: "Trips",   icon: "✈" },
  { id: "circle",  label: "Circle",  icon: "◉" },
  { id: "profile", label: "Profile", icon: "👩" },
];

export function TabBar() {
  const { activeTab, setActiveTab, showMore, setShowMore, setShowSettings } = useStore();

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
              <span style={{ fontSize: 16 }}>{t.icon}</span>
              <span style={{
                fontFamily: F.sans, fontSize: 12,
                fontWeight: activeTab === t.id ? 700 : 400,
                color: activeTab === t.id ? T.esp : T.bark,
              }}>
                {t.label}
              </span>
            </button>
          ))}
          <button
            onClick={() => { setShowSettings(true); setShowMore(false); }}
            style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "10px 14px", borderRadius: 14,
              background: "#fff", border: `1px solid ${T.linen}`, cursor: "pointer",
            }}
          >
            <span style={{ fontSize: 16 }}>⚙</span>
            <span style={{ fontFamily: F.sans, fontSize: 12, color: T.bark }}>Settings</span>
          </button>
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
            <span style={{ fontSize: 18, lineHeight: 1 }}>{t.icon}</span>
            <span style={{
              fontFamily: F.sans, fontSize: 9,
              fontWeight: activeTab === t.id ? 700 : 500,
              color: activeTab === t.id ? T.esp : T.taupe,
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
          <div style={{
            display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center",
            gap: 3, width: 22, height: 22,
          }}>
            {[0,1,2].map(i => (
              <div key={i} style={{
                width: 16, height: 2, borderRadius: 2,
                background: showMore || isMoreActive ? T.esp : T.taupe,
              }} />
            ))}
          </div>
          <span style={{
            fontFamily: F.sans, fontSize: 9,
            fontWeight: showMore || isMoreActive ? 700 : 500,
            color: showMore || isMoreActive ? T.esp : T.taupe,
            letterSpacing: 0.6,
          }}>
            More
          </span>
        </button>
      </div>
    </div>
  );
}
