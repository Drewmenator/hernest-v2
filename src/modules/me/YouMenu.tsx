// ─── "You" menu ────────────────────────────────────────────────────
// Opened from the picture in Today's header. Everything that is set up once
// and rarely browsed: profile, family, connections, settings, Extras.
import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import { T, F } from "../../config/theme";
import { useStore } from "../../core/store";
import { setTripsEnabled, useTripsEnabled } from "./extras";
import { trackEvent } from "../../core/analytics";

const ROWS: { tab: string; label: string; sub: string; icon: string }[] = [
  { tab: "profile",     label: "About you",               sub: "Your details and what matters to you", icon: "◉" },
  { tab: "family",      label: "Your family",             sub: "Partner, kids and the people you care for", icon: "⌂" },
  { tab: "connections", label: "Connections",             sub: "Calendars, ring, email", icon: "⚯" },
  { tab: "settings",    label: "Notifications & account", sub: "Reminders, currency, sign out, delete account", icon: "🔔" },
  { tab: "memory",      label: "What Cleo knows",         sub: "See or remove what she remembers", icon: "✦" },
];

export function Avatar({ size = 40 }: { size?: number }) {
  const profile = useStore(s => s.profile);
  const name = profile?.name?.trim() || "";
  const pic = profile?.avatar && /^https?:\/\//.test(profile.avatar) ? profile.avatar : null;
  return (
    <span aria-hidden style={{ width: size, height: size, borderRadius: "50%", flexShrink: 0, overflow: "hidden",
      display: "flex", alignItems: "center", justifyContent: "center",
      background: `linear-gradient(135deg,${T.gold},${T.goldText})`, color: "#fff",
      fontFamily: F.serif, letterSpacing: "-0.02em", fontWeight: 700, fontSize: size * 0.45 }}>
      {pic ? <img src={pic} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : (name[0]?.toUpperCase() || "✦")}
    </span>
  );
}

export function YouMenu({ onClose }: { onClose: () => void }) {
  const uid = useStore(s => s.user?.uid);
  const name = useStore(s => s.profile?.name);
  const setActiveTab = useStore(s => s.setActiveTab);
  const tripsOn = useTripsEnabled();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const go = (tab: string) => { onClose(); setActiveTab(tab); };
  const toggleTrips = () => {
    if (!uid) return;
    const next = !tripsOn;
    trackEvent("extras_trips_toggled", { on: next });
    setTripsEnabled(uid, next).catch(() => {});
  };

  const row: React.CSSProperties = { display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "12px 4px", background: "none", border: "none", borderBottom: `1px solid ${T.linen}`, cursor: "pointer", textAlign: "left", minHeight: 52, touchAction: "manipulation" };
  const label: React.CSSProperties = { fontFamily: F.sans, fontSize: 14, fontWeight: 600, color: T.esp, margin: 0 };
  const sub: React.CSSProperties = { fontFamily: F.sans, fontSize: 12, color: T.taupe, margin: "1px 0 0" };
  const icon: React.CSSProperties = { width: 32, height: 32, borderRadius: 10, background: T.goldP, color: T.goldText, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, flexShrink: 0 };

  // Portal: the screen's fade-in animation would otherwise trap position:fixed.
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="You" onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(42,31,24,.35)", display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={e => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 430, maxHeight: "88svh", overflowY: "auto", background: T.ivory, borderRadius: "24px 24px 0 0", padding: "10px 20px calc(24px + env(safe-area-inset-bottom, 0px))", animation: "slideUp .25s ease both" }}>
        <div style={{ width: 36, height: 4, borderRadius: 4, background: T.linen, margin: "0 auto 14px" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
          <Avatar size={44} />
          <p style={{ fontFamily: F.serif, letterSpacing: "-0.02em", fontWeight: 700, fontSize: 22, color: T.esp, margin: 0, flex: 1 }}>{name || "You"}</p>
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", fontSize: 22, color: T.taupe, cursor: "pointer", minWidth: 44, minHeight: 44 }}>×</button>
        </div>

        {ROWS.map(r => (
          <button key={r.tab} style={row} onClick={() => go(r.tab)}>
            <span style={icon}>{r.icon}</span>
            <span style={{ flex: 1 }}><p style={label}>{r.label}</p><p style={sub}>{r.sub}</p></span>
            <span style={{ color: T.taupe, fontSize: 16 }}>›</span>
          </button>
        ))}

        <p style={{ fontFamily: F.sans, fontSize: 12, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: T.taupe, margin: "18px 0 2px" }}>Extras</p>
        <div style={{ ...row, cursor: "default" }}>
          <span style={icon}>✈</span>
          <span style={{ flex: 1 }}>
            <p style={label}>Trips</p>
            <p style={sub}>{tripsOn ? <>Shows upcoming trips on Today · <button onClick={() => go("trips")} style={{ background: "none", border: "none", padding: 0, color: T.goldText, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>Open Trips</button></> : "Plan trips, packing lists and travel days"}</p>
          </span>
          <button role="switch" aria-checked={tripsOn} aria-label="Trips" onClick={toggleTrips}
            style={{ width: 48, height: 28, borderRadius: 28, border: "none", padding: 3, cursor: "pointer", background: tripsOn ? T.sage : T.linen, transition: "background .2s", flexShrink: 0 }}>
            <span style={{ display: "block", width: 22, height: 22, borderRadius: "50%", background: "#fff", transform: tripsOn ? "translateX(20px)" : "none", transition: "transform .2s", boxShadow: "0 1px 3px rgba(0,0,0,.2)" }} />
          </button>
        </div>

        <button style={{ ...row, borderBottom: "none", marginTop: 8 }} onClick={() => go("privacy")}>
          <span style={icon}>🔒</span>
          <span style={{ flex: 1 }}><p style={label}>Account & privacy</p><p style={sub}>Partner sharing, export your data, legal</p></span>
          <span style={{ color: T.taupe, fontSize: 16 }}>›</span>
        </button>
      </div>
    </div>,
    document.body,
  );
}
